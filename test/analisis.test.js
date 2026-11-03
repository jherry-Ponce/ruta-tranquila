import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cargarRed } from '../server/vias.js';
import { analizarRuta } from '../server/analisis.js';
import { aGrados, distancia } from '../server/geo.js';

const red = cargarRed();

// Un tramo recto de una vía real, de al menos 150 m y sin puentes, para construir rutas de prueba.
function tramoRecto(nombre, clase) {
  for (const via of red.vias) {
    if (via.nombre !== nombre || via.clase !== clase || via.desnivel || via.ramal) continue;
    for (let j = 0; j < via.puntos.length - 1; j++) {
      if (distancia(via.puntos[j], via.puntos[j + 1]) >= 150) return [via.puntos[j], via.puntos[j + 1]];
    }
  }
  throw new Error(`No encontré un tramo recto de ${nombre}`);
}

// Ruta perpendicular que atraviesa el centro del tramo, de `largo` metros a cada lado.
function rutaPerpendicular([a, b], largo = 120) {
  const medio = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const d = distancia(a, b);
  const normal = [-(b[1] - a[1]) / d, (b[0] - a[0]) / d];
  const puntos = [];
  for (let s = -largo; s <= largo; s += 20) puntos.push([medio[0] + normal[0] * s, medio[1] + normal[1] * s]);
  return puntos.map(aGrados);
}

const todoResidencial = (coords) => [[0, coords.length - 1, 3]];

test('detecta el cruce con la Av. Javier Prado Este como un solo punto crítico', () => {
  const coords = rutaPerpendicular(tramoRecto('Avenida Javier Prado Este', 'primaria'));
  const r = analizarRuta(coords, todoResidencial(coords), red);
  const cruces = r.cruces.filter((c) => c.nombres.includes('Avenida Javier Prado Este'));
  assert.equal(cruces.length, 1);
  assert.ok(['primaria', 'autopista'].includes(cruces[0].clase));
  assert.equal(r.tramos.length, 0);
});

test('ir por la Av. Brasil cuenta como tramo de avenida grande y no como cruce', () => {
  const [a, b] = tramoRecto('Avenida Brasil', 'primaria');
  const coords = [];
  for (let t = 0; t <= 1.0001; t += 0.1) coords.push(aGrados([a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])]));
  const r = analizarRuta(coords, [[0, coords.length - 1, 1]], red);
  assert.equal(r.tramos.length, 1);
  assert.equal(r.tramos[0].clase, 'primaria');
  assert.deepEqual(r.tramos[0].nombres, ['Avenida Brasil']);
  assert.equal(r.cruces.filter((c) => c.nombres.includes('Avenida Brasil')).length, 0);
  assert.ok(r.metrosPorClase.primaria / r.distancia > 0.95);
});

test('una avenida secundaria se distingue de una calle menor aunque ORS diga waytype 2', () => {
  const [a, b] = tramoRecto('Avenida Arequipa', 'secundaria');
  const coords = [aGrados(a), aGrados(b)];
  const r = analizarRuta(coords, [[0, 1, 2]], red);
  assert.equal(r.segmentos[0].clase, 'secundaria');
});

test('una calle lejos de las avenidas queda como residencial', () => {
  // Punto en el mar frente a Miraflores: no hay vías cerca.
  const coords = [[-77.06, -12.135], [-77.059, -12.135]];
  const r = analizarRuta(coords, todoResidencial(coords), red);
  assert.equal(r.segmentos[0].clase, 'residencial');
  assert.equal(r.cruces.length, 0);
});
