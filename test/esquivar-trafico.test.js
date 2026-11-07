import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import cfg from '../config/tranquilidad.js';
import { cargarRed } from '../server/vias.js';
import { aMetros } from '../server/geo.js';
import { planificar } from '../server/planificador.js';
import { zonasDeIncidentes } from '../server/trafico.js';

const red = cargarRed();
const origen = { lat: -12.14, lon: -77.07 };
const destino = { lat: -12.11, lon: -77.07 };
const extremos = [[origen.lon, origen.lat], [destino.lon, destino.lat]];
// Un atasco a media ruta (lejos de la salida y la llegada) y una calle cerrada al lado.
const atasco = { type: 'LineString', coordinates: [[-77.0705, -12.125], [-77.0695, -12.125]] };
const cierre = { type: 'LineString', coordinates: [[-77.0705, -12.12], [-77.0695, -12.12]] };
const junto = { type: 'LineString', coordinates: [[-77.0702, -12.1399], [-77.0698, -12.1399]] };

const recta = [[-77.07, -12.14], [-77.07, -12.11]];
const feature = () => ({
  type: 'Feature',
  geometry: { type: 'LineString', coordinates: recta },
  properties: {
    summary: { distance: 3300, duration: 600 },
    segments: [{ steps: [{ type: 11, name: 'Jirón Prueba', distance: 3300, duration: 600, way_points: [0, 1] }, { type: 10, name: '-', distance: 0, duration: 0, way_points: [1, 1] }] }],
    extras: { waytype: { values: [[0, 1, 3]] } },
  },
});

let pedidos = [];
let incidentes = [];
let orsFalla = null; // función que decide si ORS responde "sin ruta" (2009)
let fetchOriginal;

before(() => {
  process.env.ORS_API_KEY = 'prueba';
  process.env.TOMTOM_API_KEY = 'prueba';
  fetchOriginal = globalThis.fetch;
  globalThis.fetch = async (url, opciones = {}) => {
    const u = String(url);
    if (u.includes('/traffic/services/5/incidentDetails')) {
      pedidos.push({ tipo: 'incidentes', url: u });
      return new Response(JSON.stringify({ incidents: incidentes }), { status: 200 });
    }
    if (u.includes('api.tomtom.com/routing')) return new Response('{}', { status: 500 });
    const cuerpo = JSON.parse(opciones.body);
    pedidos.push({ tipo: 'ors', cuerpo });
    if (orsFalla?.(cuerpo)) return new Response(JSON.stringify({ error: { code: 2009 } }), { status: 404 });
    return new Response(JSON.stringify({ type: 'FeatureCollection', features: [feature()] }), { status: 200 });
  };
});

after(() => {
  globalThis.fetch = fetchOriginal;
  delete process.env.ORS_API_KEY;
  delete process.env.TOMTOM_API_KEY;
});

const incidente = (geometry, iconCategory, magnitudeOfDelay = 3) => ({ geometry, properties: { iconCategory, magnitudeOfDelay } });
const poligonos = (cuerpo) => cuerpo.options?.avoid_polygons?.coordinates.length ?? 0;

test('los atascos y cierres se vuelven zonas a evitar; el pegado a la salida solo se avisa', () => {
  const trazo = (g) => g.coordinates.map(aMetros);
  const r = zonasDeIncidentes(
    [
      { tipo: 'atasco', trazo: trazo(atasco) },
      { tipo: 'cierre', trazo: trazo(cierre) },
      { tipo: 'atasco', trazo: trazo(junto) },
    ],
    extremos,
  );
  assert.equal(r.zonas.length, 2); // un rectángulo por tramo; el de la salida no se cubre
  assert.deepEqual(r.cerca, { atascos: 1, cierres: 1 });
  assert.deepEqual(r.junto, { salida: true, llegada: false });
  // Cada zona es un anillo cerrado de 5 puntos en [lon, lat].
  assert.equal(r.zonas[0][0].length, 5);
  assert.deepEqual(r.zonas[0][0][0], r.zonas[0][0][4]);
});

test('saliendo ahora, las rutas evitan el atasco y la calle cerrada y se cuenta en una línea', async () => {
  pedidos = [];
  orsFalla = null;
  incidentes = [incidente(atasco, 6), incidente(cierre, 8), incidente(junto, 6), incidente(atasco, 6, 1)];
  const resultado = await planificar({ origen, destino, salida: null, vehiculo: 'auto' }, { red, cfg });
  assert.equal(pedidos.filter((p) => p.tipo === 'incidentes').length, 1);
  const ors = pedidos.filter((p) => p.tipo === 'ors');
  // Todas, incluida la rápida, llevan las zonas de tráfico.
  assert.ok(ors.every((p) => poligonos(p.cuerpo) > 0));
  assert.deepEqual(resultado.esquivados, { atascos: 1, cierres: 1, junto: { salida: true, llegada: false } });
});

test('en bici solo se esquivan las calles cerradas', async () => {
  pedidos = [];
  incidentes = [incidente(atasco, 6), incidente(cierre, 8)];
  const resultado = await planificar({ origen, destino, salida: null, vehiculo: 'bici' }, { red, cfg });
  assert.deepEqual(resultado.esquivados, { atascos: 0, cierres: 1, junto: { salida: false, llegada: false } });
});

test('a otra hora no consulta el tráfico de ahora', async () => {
  pedidos = [];
  incidentes = [incidente(atasco, 6)];
  const resultado = await planificar({ origen, destino, salida: '2026-11-07T11:00', vehiculo: 'auto' }, { red, cfg });
  assert.equal(pedidos.filter((p) => p.tipo === 'incidentes').length, 0);
  assert.equal(resultado.esquivados, undefined);
});

test('si esquivar los cierres deja sin ruta, busca otra vez sin esquivarlos', async () => {
  pedidos = [];
  incidentes = [incidente(cierre, 8)];
  let conZonas = 0;
  // ORS no encuentra camino mientras las zonas de tráfico estén puestas.
  orsFalla = (cuerpo) => {
    const tieneTrafico = (cuerpo.options?.avoid_polygons?.coordinates ?? []).some((pol) => pol[0].some(([lon, lat]) => Math.abs(lat + 12.12) < 0.001));
    if (tieneTrafico) conZonas++;
    return tieneTrafico;
  };
  const resultado = await planificar({ origen, destino, salida: null, vehiculo: 'auto' }, { red, cfg });
  orsFalla = null;
  assert.ok(conZonas > 0);
  assert.ok(resultado.rutas.length > 0);
  assert.equal(resultado.esquivados, undefined);
});
