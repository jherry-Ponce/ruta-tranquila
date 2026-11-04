// Prueba el armado completo de rutas con respuestas simuladas de OpenRouteService.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import cfg from '../config/tranquilidad.js';
import { cargarRed } from '../server/vias.js';
import { aGrados, aMetros, distancia } from '../server/geo.js';
import { planificar } from '../server/planificador.js';
import { formatoDistancia } from '../server/pasos.js';
import { snapACiclovia, sobreAvenida } from '../server/snap-ciclovia.js';

const red = cargarRed();
const largo = (coords) => coords.map(aMetros).reduce((s, p, i, arr) => (i ? s + distancia(arr[i - 1], p) : 0), 0);

// Recorrido por el mar frente a Miraflores: ninguna vía cerca, así que cuenta como calle tranquila.
const calma = Array.from({ length: 31 }, (_, i) => [-77.07, -12.14 + i * 0.001]);
// Recorrido por la vía más larga de la Av. Brasil.
const brasil = red.vias
  .filter((v) => v.nombre === 'Avenida Brasil' && v.clase === 'primaria' && !v.desnivel)
  .sort((a, b) => b.puntos.length - a.puntos.length)[0]
  .puntos.map(aGrados);

// Una salida sobre una avenida, a distancia caminable de una ciclovía (busca en los datos reales).
function salidaEnAvenidaCercaDeCiclovia(destino) {
  for (const via of red.vias.filter((v) => v.clase === 'ciclovia' && !v.ramal && v.puntos.length > 1)) {
    const [a, b] = via.puntos;
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const largo = Math.hypot(dx, dy);
    if (largo < 1) continue;
    for (const lado of [1, -1]) {
      for (const metros of [60, 100, 150, 200]) {
        const x = (a[0] + b[0]) / 2 - lado * (dy / largo) * metros;
        const y = (a[1] + b[1]) / 2 + lado * (dx / largo) * metros;
        if (!sobreAvenida(red, [x, y])) continue;
        const [lon, lat] = aGrados([x, y]);
        const snap = snapACiclovia({ lon, lat }, red, destino);
        if (snap) return { origen: { lon, lat }, snap };
      }
    }
  }
  throw new Error('No hay en los datos una avenida junto a una ciclovía');
}

function ruta(coords, duracion, waytype, tramos = 1) {
  const n = coords.length - 1;
  const corte = Math.floor(n / 2);
  const d = largo(coords);
  const segmentos =
    tramos === 1
      ? [{ steps: [{ type: 11, name: 'Jirón Prueba', distance: d, duration: duracion, way_points: [0, n] }, { type: 10, name: '-', distance: 0, duration: 0, way_points: [n, n] }] }]
      : [
          { steps: [{ type: 11, name: 'Jirón Prueba', distance: d / 2, duration: duracion / 2, way_points: [0, corte] }, { type: 10, name: '-', distance: 0, duration: 0, way_points: [corte, corte] }] },
          { steps: [{ type: 11, name: 'Jirón Prueba', distance: d / 2, duration: duracion / 2, way_points: [corte, n] }, { type: 10, name: '-', distance: 0, duration: 0, way_points: [n, n] }] },
        ];
  return {
    type: 'Feature',
    geometry: { type: 'LineString', coordinates: coords },
    properties: { summary: { distance: d, duration: duracion }, segments: segmentos, extras: { waytype: { values: [[0, n, waytype]] } } },
  };
}

let fetchOriginal;
const pedidos = [];
let duracionBrasil = 300;

before(() => {
  process.env.ORS_API_KEY = 'prueba';
  delete process.env.TOMTOM_API_KEY;
  fetchOriginal = globalThis.fetch;
  globalThis.fetch = async (url, opciones) => {
    const cuerpo = JSON.parse(opciones.body);
    pedidos.push({ url: String(url), cuerpo });
    // Las variantes "sin avenidas" siempre mandan `options`; la rápida no.
    const features = 'options' in cuerpo ? [ruta(calma, 430, 3)] : [ruta(brasil, duracionBrasil, 1), ruta(calma, 450, 3, 2)];
    return new Response(JSON.stringify({ type: 'FeatureCollection', features }), { status: 200 });
  };
});

after(() => {
  globalThis.fetch = fetchOriginal;
  delete process.env.ORS_API_KEY;
});

test('elige la ruta tranquila y la rápida, y quita las casi iguales', async () => {
  const resultado = await planificar(
    { origen: { lat: -12.14, lon: -77.07 }, destino: { lat: -12.11, lon: -77.07 }, salida: '2026-11-07T11:00', depurar: true },
    { red, cfg },
  );

  assert.equal(resultado.rutas.length, 2);
  const [tranquila, rapida] = resultado.rutas;
  assert.deepEqual(tranquila.tipos, ['tranquila']);
  assert.deepEqual(rapida.tipos, ['rapida']);
  assert.equal(tranquila.puntaje.valor, 100);
  assert.ok(rapida.puntaje.valor < 40);
  assert.ok(rapida.puntosCriticos.some((p) => p.tipo === 'tramo' && p.titulo.includes('Av. Brasil')));

  // Nivel principiante: la rápida con alternativas y dos variantes sin avenidas, todas con driving-car.
  assert.equal(pedidos.length, 3);
  assert.ok(pedidos.every((p) => p.url.includes('/openrouteservice/v2/directions/driving-car/')));
  assert.deepEqual(pedidos.filter((p) => 'options' in p.cuerpo).map((p) => p.cuerpo.preference), ['shortest', 'shortest']);
  assert.ok(resultado.comparacion.some((c) => c.nota === 'descartada: casi igual a otra'));

  assert.equal(tranquila.pasos.at(-1).texto, 'Llegaste a tu destino.');
  assert.match(tranquila.enlaceGoogleMaps, /^https:\/\/www\.google\.com\/maps\/dir\/\?api=1&/);
  assert.match(tranquila.enlaceGoogleMaps, /waypoints=/);
  assert.equal(resultado.trafico.estado, 'sin_key');
  assert.equal(resultado.horario.enHoraPunta, false);
});

test('quita la ruta que otra supera en tiempo y en tranquilidad', async () => {
  duracionBrasil = 600; // por la Av. Brasil ahora es más lenta que por las calles tranquilas
  try {
    const resultado = await planificar(
      { origen: { lat: -12.14, lon: -77.07 }, destino: { lat: -12.11, lon: -77.07 }, salida: '2026-11-07T11:00', depurar: true },
      { red, cfg },
    );
    assert.equal(resultado.rutas.length, 1);
    assert.deepEqual(resultado.rutas[0].tipos, ['tranquila', 'rapida']);
    assert.ok(resultado.comparacion.some((c) => c.nota === 'descartada: otra ruta es más rápida y más tranquila'));
  } finally {
    duracionBrasil = 300;
  }
});

test('en bici, si sale por una avenida, ajusta el origen a una ciclovía cercana y avisa la caminata', async () => {
  pedidos.length = 0;
  // Este cruce está cerca de la Ciclovía Costa Verde, pero esa vía no es una llegada útil:
  // el destino que se entrega a ORS debe seguir siendo el punto real elegido por la persona.
  const destino = { lat: -12.0797622, lon: -77.1059029 };
  const { origen, snap } = salidaEnAvenidaCercaDeCiclovia(destino);
  const resultado = await planificar(
    { origen, destino, salida: '2026-11-07T11:00', vehiculo: 'bici' },
    { red, cfg },
  );

  assert.equal(pedidos.length, 3);
  assert.ok(pedidos.every((p) => p.url.includes('/openrouteservice/v2/directions/cycling-regular/')));
  assert.deepEqual(pedidos[0].cuerpo.coordinates[0], [snap.lon, snap.lat]);
  assert.deepEqual(pedidos[0].cuerpo.coordinates[1], [destino.lon, destino.lat]);

  const [primera] = resultado.rutas;
  const aviso = primera.puntosCriticos.find((p) => p.tipo === 'caminata' && p.metros === 0);
  assert.ok(aviso);
  assert.equal(aviso.lon, origen.lon);
  assert.equal(aviso.lat, origen.lat);
  assert.ok(aviso.titulo.startsWith(`Camina ${formatoDistancia(snap.distanciaCaminata)} hasta la ciclovía`));
  assert.equal(primera.duracionTotalSegundos, primera.duracionSegundos + snap.minutosCaminata * 60);
  assert.equal(primera.caminataInicial.metros, snap.distanciaCaminata);
  assert.equal(primera.caminataInicial.geometria.length, 2);
  // Los tramos por clase cubren toda la geometría, sin huecos ni solapes.
  const tramos = primera.tramosPorClase;
  assert.equal(tramos[0][0], 0);
  assert.equal(tramos.at(-1)[1], primera.geometria.length - 1);
  tramos.forEach((t, i) => i && assert.equal(t[0], tramos[i - 1][1]));
});

test('en bici, si sale de una calle tranquila, no cambia el origen', async () => {
  pedidos.length = 0;
  const origen = { lon: calma[0][0], lat: calma[0][1] };
  const destino = { lon: calma.at(-1)[0], lat: calma.at(-1)[1] };
  const resultado = await planificar({ origen, destino, salida: '2026-11-07T11:00', vehiculo: 'bici' }, { red, cfg });

  assert.ok(resultado.rutas.every((r) => r.duracionTotalSegundos === r.duracionSegundos));
  assert.deepEqual(pedidos[0].cuerpo.coordinates[0], [origen.lon, origen.lat]);
  assert.ok(resultado.rutas.every((r) => r.caminataInicial === null && !r.puntosCriticos.some((p) => p.tipo === 'caminata')));
});
