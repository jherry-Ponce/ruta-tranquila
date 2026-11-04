import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analizarGiros } from '../server/giros.js';
import cfg from '../config/tranquilidad.js';
const medir = (tipos, separacion = 200, total = 3000) => analizarGiros(tipos.map((type, i) => ({ type, way_points: [i, i + 1] })), [...tipos.map((_, i) => i * separacion), total], cfg.giros);
test('ignora salida, llegada, seguir derecho y salida de óvalo', () => {
  assert.deepEqual(medir([11, 6, 8, 10]), { cantidad: 0, seguidos: 0, penalizacion: 0 });
});
test('prefiere cuatro giros frente a doce en una distancia similar', () => {
  assert.equal(medir(Array(4).fill(0)).penalizacion, 0);
  assert.ok(medir(Array(12).fill(0)).penalizacion > 0);
});
test('pondera vueltas en U, giros cerrados y maniobras seguidas', () => {
  assert.ok(medir([9, 9, 9]).penalizacion > medir([0, 0, 0]).penalizacion);
  assert.ok(medir([2, 2, 2, 2]).penalizacion > medir([0, 0, 0, 0]).penalizacion);
  assert.ok(medir([0, 1, 0, 1], 40).penalizacion > medir([0, 1, 0, 1], 200).penalizacion);
});
test('normaliza por distancia y limita el descuento máximo', () => {
  assert.ok(medir(Array(12).fill(0), 200, 10000).penalizacion < medir(Array(12).fill(0)).penalizacion);
  assert.equal(medir(Array(40).fill(9), 10).penalizacion, cfg.giros.tope);
});

test('con una distancia de referencia, un rodeo no gana giros sin penalizar', () => {
  const pasos = Array.from({ length: 20 }, (_, i) => ({ type: 1, way_points: [i, i + 1] }));
  const acumulado = [...pasos.map((_, i) => i * 600), 12000];
  const propio = analizarGiros(pasos, acumulado, cfg.giros);
  const comparado = analizarGiros(pasos, acumulado, cfg.giros, 5);
  assert.ok(comparado.penalizacion > propio.penalizacion);
});
