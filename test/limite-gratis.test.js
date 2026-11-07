// Si se acaba el plan gratis (TomTom responde 429), la app no se cae: sigue sin esos extras.
// Así nunca hace falta pasar a un plan de pago para que funcione.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import cfg from '../config/tranquilidad.js';
import { cargarRed } from '../server/vias.js';
import { planificar } from '../server/planificador.js';
import { buscarDireccion, sugerirLugares, direccionDePunto } from '../server/direcciones.js';

const red = cargarRed();
const recta = [[-77.07, -12.14], [-77.07, -12.11]];
const feature = {
  type: 'Feature',
  geometry: { type: 'LineString', coordinates: recta },
  properties: {
    summary: { distance: 3300, duration: 600 },
    segments: [{ steps: [{ type: 11, name: 'Jirón Prueba', distance: 3300, duration: 600, way_points: [0, 1] }, { type: 10, name: '-', distance: 0, duration: 0, way_points: [1, 1] }] }],
    extras: { waytype: { values: [[0, 1, 3]] } },
  },
};
let llamadasTomTom = 0;
let fetchOriginal;

before(() => {
  process.env.ORS_API_KEY = 'prueba';
  process.env.TOMTOM_API_KEY = 'prueba';
  fetchOriginal = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes('api.tomtom.com')) {
      llamadasTomTom++;
      return new Response('{"error":"limit"}', { status: 429 });
    }
    if (u.includes('/pelias/')) {
      return new Response(JSON.stringify({ features: [{ geometry: { coordinates: [-77.03, -12.13] }, properties: { label: 'Larcomar, Miraflores', name: 'Larcomar', layer: 'venue' } }] }), { status: 200 });
    }
    return new Response(JSON.stringify({ type: 'FeatureCollection', features: [feature] }), { status: 200 });
  };
});

after(() => {
  globalThis.fetch = fetchOriginal;
  delete process.env.ORS_API_KEY;
  delete process.env.TOMTOM_API_KEY;
});

test('sin cupo de TomTom, la búsqueda de lugares usa OpenRouteService', async (t) => {
  t.mock.method(console, 'warn', () => {});
  llamadasTomTom = 0;
  assert.match((await buscarDireccion('Larcomar', cfg.limitesLima))[0].etiqueta, /Larcomar/);
  assert.match((await sugerirLugares('Larcomar', cfg.limitesLima))[0].etiqueta, /Larcomar/);
  assert.ok(await direccionDePunto(-12.13, -77.03));
  assert.ok(llamadasTomTom > 0);
});

test('sin cupo de TomTom, la ruta se calcula igual: sin esquivar atascos ni medir el tráfico', async () => {
  llamadasTomTom = 0;
  const resultado = await planificar({ origen: { lat: -12.14, lon: -77.07 }, destino: { lat: -12.11, lon: -77.07 }, salida: null, vehiculo: 'auto' }, { red, cfg });
  assert.ok(resultado.rutas.length > 0);
  assert.equal(resultado.esquivados, undefined);
  assert.match(resultado.trafico.mensaje, /límite de consultas de TomTom/);
  assert.ok(llamadasTomTom > 0);
});

test('la misma zona no se vuelve a pedir a TomTom durante 3 minutos', async () => {
  const { incidentesDeLaZona } = await import('../server/trafico.js');
  const anterior = globalThis.fetch;
  let pedidos = 0;
  globalThis.fetch = async () => { pedidos++; return new Response(JSON.stringify({ incidents: [] }), { status: 200 }); };
  const extremos = [[-77.06, -12.09], [-77.03, -12.08]];
  await incidentesDeLaZona(extremos);
  await incidentesDeLaZona(extremos);
  globalThis.fetch = anterior;
  assert.equal(pedidos, 1);
});
