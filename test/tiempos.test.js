import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ajustarDuracion } from '../server/planificador.js';

// Ruta de 2 pasos: 1 km a 60 km/h (60 s) y 1 km a 20 km/h (180 s).
const ruta = () => ({
  duracion: 240,
  pasos: [
    { distance: 1000, duration: 60 },
    { distance: 1000, duration: 180 },
  ],
});

test('el auto conserva el tiempo de OpenRouteService', () => {
  const r = ruta();
  ajustarDuracion(r, 'auto');
  assert.equal(r.duracion, 240);
  assert.equal(r.duracionOrs, 240);
});

test('la moto eléctrica no va a más de ~40 km/h en ningún tramo', () => {
  const r = ruta();
  ajustarDuracion(r, 'motoElectrica');
  // El paso rápido pasa de 60 s a 1000 m / (40,5 km/h) ≈ 88,9 s; el lento no cambia.
  assert.ok(Math.abs(r.duracion - (1000 / (40.5 / 3.6) + 180)) < 0.01, String(r.duracion));
});

test('la bici o monopatín se calcula a unos 15 km/h en vez de 18', () => {
  const r = ruta();
  ajustarDuracion(r, 'bici');
  assert.equal(r.duracion, 240 * 1.2);
});

test('el ritmo personal se aplica encima', () => {
  const r = ruta();
  ajustarDuracion(r, 'auto', 1.25);
  assert.equal(r.duracion, 300);
  assert.equal(r.ajusteRitmo, 1.25);
});
