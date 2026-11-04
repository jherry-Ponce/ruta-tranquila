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
