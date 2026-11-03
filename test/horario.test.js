import { test } from 'node:test';
import assert from 'node:assert/strict';
import cfg from '../config/tranquilidad.js';
import { evaluarHorario, leerSalida } from '../server/horario.js';

test('un martes a las 18:30 es hora punta', () => {
  const h = evaluarHorario('2026-11-03T18:30', cfg);
  assert.equal(h.enHoraPunta, true);
  assert.match(h.mensaje, /después de las 20:00/);
});

test('un sábado a las 18:30 no es hora punta', () => {
  const h = evaluarHorario('2026-11-07T18:30', cfg);
  assert.equal(h.enHoraPunta, false);
  assert.equal(h.mensaje, null);
});

test('avisa cuando falta poco para la hora punta', () => {
  const h = evaluarHorario('2026-11-03T16:30', cfg);
  assert.equal(h.enHoraPunta, false);
  assert.match(h.mensaje, /empieza a las 17:00/);
});

test('las 9:30 ya no son hora punta', () => {
  assert.equal(evaluarHorario('2026-11-04T09:30', cfg).enHoraPunta, false);
  assert.equal(evaluarHorario('2026-11-04T09:29', cfg).enHoraPunta, true);
});

test('"ahora" usa la hora de Lima aunque el servidor esté en otra zona', () => {
  // 2026-11-03 13:00 UTC = 8:00 en Lima (UTC−5), martes.
  const h = evaluarHorario(null, cfg, new Date('2026-11-03T13:00:00Z'));
  assert.equal(h.cuando, 'ahora');
  assert.equal(h.hora, '8:00');
  assert.equal(h.enHoraPunta, true);
});

test('rechaza horas mal escritas', () => {
  assert.equal(leerSalida('2026-11-03 18:30'), null);
  assert.equal(leerSalida('2026-11-03T25:00'), null);
});
