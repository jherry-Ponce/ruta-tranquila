import { test } from 'node:test';
import assert from 'node:assert/strict';
import { alturaSol, esDeNoche, horaDeLuces } from '../public/noche.js';

const lima = (iso) => new Date(`${iso}-05:00`);

test('al mediodía de Lima el sol está alto', () => {
  assert.ok(alturaSol(lima('2026-11-04T12:00:00')) > 70);
  assert.equal(esDeNoche(lima('2026-11-04T12:00:00')), false);
  assert.equal(horaDeLuces(lima('2026-11-04T12:00:00')), false);
});

test('en noviembre oscurece poco después de las 6 de la tarde', () => {
  assert.equal(esDeNoche(lima('2026-11-04T17:55:00')), false);
  assert.equal(esDeNoche(lima('2026-11-04T18:20:00')), true);
  assert.equal(esDeNoche(lima('2026-11-04T23:00:00')), true);
  assert.equal(esDeNoche(lima('2026-11-04T06:00:00')), false);
});

test('en junio oscurece antes y amanece más tarde', () => {
  assert.equal(esDeNoche(lima('2026-06-21T18:05:00')), true);
  assert.equal(esDeNoche(lima('2026-06-21T06:15:00')), true);
  assert.equal(esDeNoche(lima('2026-06-21T07:00:00')), false);
});

test('las luces de la bici se piden un rato antes de que se oculte el sol', () => {
  assert.equal(horaDeLuces(lima('2026-11-04T17:55:00')), true);
  assert.equal(horaDeLuces(lima('2026-11-04T17:00:00')), false);
});
