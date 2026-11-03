import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cargarRed } from '../server/vias.js';
import { zonasAEvitar } from '../server/zonas.js';
import { aMetros, distancia } from '../server/geo.js';

const red = cargarRed();
const O = [-77.05958, -12.09454]; // Juan de Aliaga 455
const D = [-76.97704, -12.10015]; // Jr. Santorín 243

test('cubre avenidas del trayecto pero deja libres el origen y el destino', () => {
  const zonas = zonasAEvitar(red, [O, D], new Set(['autopista', 'primaria']));
  assert.ok(zonas.length > 100);
  const extremos = [O, D].map(aMetros);
  for (const [anillo] of zonas) {
    assert.equal(anillo.length, 5);
    assert.deepEqual(anillo[0], anillo[4]);
    for (const p of anillo) assert.ok(extremos.every((e) => distancia(e, aMetros(p)) > 200));
  }
});

test('incluir las avenidas medianas agrega más zonas', () => {
  const grandes = zonasAEvitar(red, [O, D], new Set(['autopista', 'primaria']));
  const medianas = zonasAEvitar(red, [O, D], new Set(['autopista', 'primaria', 'secundaria']));
  assert.ok(medianas.length > grandes.length);
});

test('lejos de las avenidas no hay zonas', () => {
  // En el mar frente a Miraflores.
  assert.equal(zonasAEvitar(red, [[-77.2, -12.4], [-77.19, -12.4]], new Set(['autopista', 'primaria'])).length, 0);
});
