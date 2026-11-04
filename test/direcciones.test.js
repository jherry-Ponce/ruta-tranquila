import { test } from 'node:test';
import assert from 'node:assert/strict';
import cfg from '../config/tranquilidad.js';
import { buscarDireccion, sugerirLugares } from '../server/direcciones.js';
import { ubicacionConfirmada } from '../server/ubicaciones-confirmadas.js';
import { puntoDeEnlace } from '../server/enlaces-mapas.js';
const enlace = 'https://www.google.com/maps/place/Jir%C3%B3n+Manuel+Candamo+820,+Lince+15046/@-12.0816676,-77.0306614,17z/data=!3m1!4b1!4m6!3m5!1s0x9105c88bdbc7caab:0xfc98efceccfbc425!8m2!3d-12.0816676!4d-77.0280865!16s%2Fg%2F11smysmwzx';
const verificar = (p) => { assert.equal(p.lat, -12.0816676); assert.equal(p.lon, -77.0280865); };

test('Manuel Candamo 820 usa la ubicación confirmada en búsqueda y sugerencias sin consultar APIs', async (t) => {
  t.mock.method(globalThis, 'fetch', () => { throw new Error('No debe consultar al proveedor'); });
  for (const texto of ['Jirón Manuel Candamo 820, Lince', 'JR. MANUEL CANDAMO 820, LINCE LIMA 15046', 'manuel candamo 820']) {
    verificar((await buscarDireccion(texto, cfg.limitesLima))[0]);
    verificar((await sugerirLugares(texto, cfg.limitesLima))[0]);
  }
});
test('la corrección no modifica otros números o distritos', () => {
  for (const texto of ['Manuel Candamo 821, Lince', 'Manuel Candamo 820, Jesús María', 'Manuel Candamo 8200, Lince']) assert.equal(ubicacionConfirmada(texto), null);
});
test('el enlace del usuario usa el punto del lugar y no el centro de la cámara', async () => {
  verificar(await puntoDeEnlace(enlace, cfg.limitesLima));
  verificar((await buscarDireccion(enlace, cfg.limitesLima))[0]);
  verificar((await sugerirLugares(enlace, cfg.limitesLima))[0]);
});
test('acepta enlaces con coordenadas explícitas de un pin', async () => {
  for (const url of ['https://www.google.com/maps/search/?api=1&query=-12.0816676,-77.0280865', 'https://maps.google.com/?q=-12.0816676,-77.0280865']) verificar(await puntoDeEnlace(url, cfg.limitesLima));
});
test('no inventa un destino desde la cámara, un recorrido o un lugar sin coordenadas', async () => {
  for (const url of ['https://www.google.com/maps/@-12.08,-77.03,17z', 'https://www.google.com/maps/dir/?destination=-12.08,-77.03', 'https://www.google.com/maps/place/Lince']) await assert.rejects(puntoDeEnlace(url, cfg.limitesLima), { estado: 400 });
});
test('expande enlaces cortos sin seguir redirecciones a otros servidores', async (t) => {
  const mock = t.mock.method(globalThis, 'fetch', async () => new Response(null, { status: 302, headers: { location: enlace } }));
  verificar(await puntoDeEnlace('https://maps.app.goo.gl/ejemplo', cfg.limitesLima));
  assert.equal(mock.mock.calls[0].arguments[1].redirect, 'manual');
  mock.mock.mockImplementation(async () => new Response(null, { status: 302, headers: { location: 'https://otro.example/punto' } }));
  await assert.rejects(puntoDeEnlace('https://maps.app.goo.gl/ejemplo', cfg.limitesLima), { estado: 400 });
  assert.equal(mock.mock.calls.length, 2);
});
test('rechaza enlaces ajenos y puntos fuera de Lima', async () => {
  for (const url of ['https://google.com.ejemplo/maps?q=-12,-77', 'https://www.google.com/maps?q=0,0', 'http://www.google.com/maps?q=-12,-77']) await assert.rejects(puntoDeEnlace(url, cfg.limitesLima), { estado: 400 });
});

function activarTomTom(t) {
  const anterior = process.env.TOMTOM_API_KEY;
  process.env.TOMTOM_API_KEY = 'prueba';
  t.after(() => { if (anterior === undefined) delete process.env.TOMTOM_API_KEY; else process.env.TOMTOM_API_KEY = anterior; });
}
const lugarSimulado = (nombre, lat = -12.077006, lon = -77.082336) => ({
  type: 'POI', poi: { name: nombre }, position: { lat, lon },
  address: { freeformAddress: 'Avenida La Marina 2100, San Miguel, Lima', municipalitySubdivision: 'San Miguel', municipality: 'Lima' },
});
test('busca establecimientos por nombre y prioriza Plaza San Miguel sobre sus tiendas', async (t) => {
  activarTomTom(t);
  const mock = t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ results: [lugarSimulado('Fridays Plaza San Miguel'), lugarSimulado('Centro Comercial Plaza San Miguel'), lugarSimulado('Plaza San Miguel'), lugarSimulado('Plaza San Miguel', 0, 0)] })));
  for (const buscar of [buscarDireccion, sugerirLugares]) {
    const lugares = await buscar('plaza san miguel', cfg.limitesLima);
    assert.deepEqual(lugares.map((l) => l.nombre), ['Plaza San Miguel', 'Centro Comercial Plaza San Miguel', 'Fridays Plaza San Miguel']);
    assert.match(lugares[0].etiqueta, /Plaza San Miguel.*La Marina/);
    assert.match(lugares[0].zona, /San Miguel/);
    assert.equal(lugares[0].exacto, false);
  }
  const urls = mock.mock.calls.map((c) => new URL(c.arguments[0]));
  assert.ok(urls.every((u) => u.pathname.includes('/search/2/search/')));
  assert.equal(urls[0].searchParams.get('typeahead'), 'false');
  assert.equal(urls[1].searchParams.get('typeahead'), 'true');
  assert.equal(urls[0].searchParams.get('topLeft'), cfg.limitesLima.norte + ',' + cfg.limitesLima.oeste);
});
test('conserva las direcciones numeradas y elimina resultados repetidos', async (t) => {
  activarTomTom(t);
  const direccion = { type: 'Point Address', position: { lat: -12.09444, lon: -77.05956 }, address: { freeformAddress: 'Avenida Juan de Aliaga 457, Magdalena del Mar', streetName: 'Avenida Juan de Aliaga', streetNumber: '457' } };
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({results: [direccion, direccion]})));
  const lugares = await buscarDireccion('Juan de Aliaga 457', cfg.limitesLima);
  assert.equal(lugares.length, 1); assert.equal(lugares[0].exacto, true);
  assert.equal(lugares[0].etiqueta, direccion.address.freeformAddress);
});
test('si TomTom falla utiliza el respaldo para lugares por nombre', async (t) => {
  activarTomTom(t);
  const anterior = process.env.ORS_API_KEY; process.env.ORS_API_KEY = 'prueba';
  t.after(() => { if (anterior === undefined) delete process.env.ORS_API_KEY; else process.env.ORS_API_KEY = anterior; });
  t.mock.method(console, 'warn', () => {});
  t.mock.method(globalThis, 'fetch', async (url) => String(url).includes('api.tomtom.com')
    ? new Response('{}', {status: 503})
    : new Response(JSON.stringify({features: [{geometry: {coordinates: [-77.082336, -12.077006]}, properties: {label: 'Plaza San Miguel, Lima', name: 'Plaza San Miguel', layer: 'venue', locality: 'Lima'}}]})));
  for (const buscar of [buscarDireccion, sugerirLugares]) assert.match((await buscar('Plaza San Miguel', cfg.limitesLima))[0].etiqueta, /Plaza San Miguel/);
});

test('el hospital principal aparece antes que un estacionamiento cuyo nombre lo contiene', async (t) => {
  activarTomTom(t);
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({results: [lugarSimulado('Los Portales Hospital Rebagliati'), lugarSimulado('Hospital Edgardo Rebagliati Martins')]})));
  const lugares = await buscarDireccion('hospital rebagliati', cfg.limitesLima);
  assert.equal(lugares[0].nombre, 'Hospital Edgardo Rebagliati Martins');
});
