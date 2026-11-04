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
