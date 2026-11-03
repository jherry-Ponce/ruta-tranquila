import { test } from 'node:test';
import assert from 'node:assert/strict';
import { armarPasos, abreviar, formatoDistancia } from '../server/pasos.js';

test('abrevia los tipos de vía comunes en Lima', () => {
  assert.equal(abreviar('Avenida Javier Prado Este'), 'Av. Javier Prado Este');
  assert.equal(abreviar('Jirón Santorín'), 'Jr. Santorín');
  assert.equal(abreviar('-'), '');
});

test('formatea distancias cortas y largas', () => {
  assert.equal(formatoDistancia(287), '290 m');
  assert.equal(formatoDistancia(1530), '1,5 km');
});

test('arma frases simples con avisos de avenida y de cruce', () => {
  const coords = [[-77.0, -12.1], [-77.0, -12.101], [-77.0, -12.102], [-77.0, -12.103]];
  const analisis = {
    acumulado: [0, 100, 200, 300],
    segmentos: [
      { clase: 'residencial', largo: 100 },
      { clase: 'primaria', largo: 100 },
      { clase: 'residencial', largo: 100 },
    ],
    cruces: [{ en: 250, clase: 'secundaria', nombres: ['Avenida Arequipa'] }],
  };
  const pasos = armarPasos(
    [
      { type: 11, name: 'Jirón Santorín', distance: 100, way_points: [0, 1] },
      { type: 1, name: 'Avenida Brasil', distance: 100, way_points: [1, 2] },
      { type: 0, name: '-', distance: 100, way_points: [2, 3] },
      { type: 10, name: '-', distance: 0, way_points: [3, 3] },
    ],
    coords,
    analisis,
  );
  assert.equal(pasos[0].texto, 'Empieza por Jr. Santorín y sigue 100 m.');
  assert.equal(pasos[1].texto, 'Gira a la derecha en Av. Brasil y sigue 100 m.');
  assert.match(pasos[1].avisos[0], /Avenida grande/);
  assert.equal(pasos[2].texto, 'Gira a la izquierda y sigue 100 m.');
  assert.match(pasos[2].avisos[0], /Cruzas Av. Arequipa/);
  assert.equal(pasos[3].texto, 'Llegaste a tu destino.');
});
