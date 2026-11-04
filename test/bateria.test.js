import { test } from 'node:test';
import assert from 'node:assert/strict';
import { estimarBateria } from '../public/bateria.js';

const ruta = { distanciaMetros: 8000, subidaMetros: 100, bajadaMetros: 40 };

test('sin autonomía no estima nada', () => {
  assert.equal(estimarBateria(ruta, 0), null);
  assert.equal(estimarBateria(ruta, undefined), null);
});

test('la subida cuenta como distancia extra', () => {
  // 8 km + 100 m de subida × 0,015 = 9,5 km
  assert.equal(estimarBateria(ruta, 20).usados, 9.5);
  assert.equal(estimarBateria(ruta, 20).estado, 'alcanza');
});

test('ida y vuelta: a la vuelta se sube lo que se bajó', () => {
  // 16 km + (100 + 40) × 0,015 = 18,1 km
  const e = estimarBateria(ruta, 20, true);
  assert.equal(e.usados, 18.1);
  assert.equal(e.estado, 'justo');
  assert.match(e.texto, /Muy justo para ida y vuelta: usarías unos 18,1 km de tus 20 km/);
});

test('avisa cuando no alcanza', () => {
  const e = estimarBateria(ruta, 9);
  assert.equal(e.estado, 'noAlcanza');
  assert.match(e.texto, /No te alcanza/);
});

test('vuelvo al inicio también se puede pedir por nombre', () => {
  assert.equal(estimarBateria(ruta, 20, 'inicio').usados, 18.1);
  assert.equal(estimarBateria(ruta, 20, 'quedo').usados, 9.5);
});

test('seguir a otro lugar suma el tramo siguiente con sus subidas', () => {
  // Ida 9,5 km + (6 km + 200 m × 0,015 = 9 km) = 18,5 km
  const e = estimarBateria(ruta, 30, { distanciaMetros: 6000, subidaMetros: 200, bajadaMetros: 0, nombre: 'Casa' });
  assert.equal(e.usados, 18.5);
  assert.equal(e.estado, 'alcanza');
  assert.match(e.texto, /Te alcanza para ir y seguir a Casa: usarías unos 18,5 km de tus 30 km/);
  assert.deepEqual(e.tramos.map((t) => t.clave), ['ida', 'despues']);
});

test('dice cuál tramo no alcanza', () => {
  const casa = { distanciaMetros: 6000, subidaMetros: 200, nombre: 'Casa' };
  const llega = estimarBateria(ruta, 15, casa);
  assert.equal(llega.estado, 'soloIda');
  assert.match(llega.texto, /Llegas, pero no te alcanza para seguir a Casa: te faltarían unos 3,5 km/);
  const vuelta = estimarBateria(ruta, 12, 'inicio');
  assert.equal(vuelta.estado, 'soloIda');
  assert.match(vuelta.texto, /no te alcanza para volver/);
  const nada = estimarBateria(ruta, 9, casa);
  assert.equal(nada.estado, 'noAlcanza');
  assert.match(nada.texto, /No te alcanza ni para llegar: necesitarías unos 9,5 km de tus 9 km/);
});
