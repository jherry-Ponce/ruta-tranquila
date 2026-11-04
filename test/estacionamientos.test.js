import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { convertirEstacionamientos, cargarEstacionamientos, estacionamientosCerca } from '../server/estacionamientos.js';

const destino = { lat: -12.0773, lon: -77.0829 };
const elementos = [
  { type: 'node', lat: -12.0775, lon: -77.0829, tags: { amenity: 'parking', name: 'Playa Centro', fee: 'yes' } }, // ~20 m
  { type: 'way', center: { lat: -12.0782, lon: -77.0829 }, tags: { amenity: 'parking', access: 'customers' } }, // ~100 m
  { type: 'node', lat: -12.0776, lon: -77.0829, tags: { amenity: 'parking', access: 'private' } }, // privado: no
  { type: 'node', lat: -12.0820, lon: -77.0829, tags: { amenity: 'parking' } }, // ~520 m: lejos
  { type: 'node', lat: -12.0774, lon: -77.0831, tags: { amenity: 'bicycle_parking' } },
  { type: 'node', lat: -12.0779, lon: -77.0829, tags: { amenity: 'motorcycle_parking' } },
  { type: 'node', lat: -12.0777, lon: -77.0827, tags: { amenity: 'parking', motorcycle: 'no' } },
];

function datosDePrueba() {
  const dir = mkdtempSync(join(tmpdir(), 'estac-'));
  const archivo = join(dir, 'e.json');
  writeFileSync(archivo, JSON.stringify({ lugares: convertirEstacionamientos(elementos) }));
  return cargarEstacionamientos(archivo);
}

test('descarta los estacionamientos privados', () => {
  assert.equal(convertirEstacionamientos(elementos).length, 6);
});

test('al auto le sugiere los cercanos, del más cercano al más lejano, y dice si son de pago o para clientes', () => {
  const lista = estacionamientosCerca(datosDePrueba(), destino, 'auto');
  assert.deepEqual(lista.map((l) => [l.nombre, l.pago, l.clientes]), [['Playa Centro', 1, false], [null, null, false], [null, null, true]]);
  assert.ok(lista.every((l) => l.metros <= 400));
});

test('a la bici solo le sugiere estacionamientos de bicis', () => {
  const lista = estacionamientosCerca(datosDePrueba(), destino, 'bici');
  assert.equal(lista.length, 1);
  assert.equal(lista[0].tipo, 'b');
});

test('a la moto le sirven los de motos y los de autos que no prohíben motos', () => {
  const lista = estacionamientosCerca(datosDePrueba(), destino, 'motoElectrica', 5);
  assert.ok(lista.some((l) => l.tipo === 'm'));
  assert.ok(lista.every((l) => l.tipo === 'm' || l.tipo === 'a'));
  assert.equal(lista.length, 3);
});

test('sin archivo de datos no sugiere nada', () => {
  assert.equal(cargarEstacionamientos(join(tmpdir(), 'no-existe-estac.json')), null);
  assert.deepEqual(estacionamientosCerca(null, destino, 'auto'), []);
});
