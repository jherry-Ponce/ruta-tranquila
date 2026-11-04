import { test } from 'node:test';
import assert from 'node:assert/strict';
import { proyectarEnRuta, enlaceSeguirEnGoogle } from '../public/viaje.js';

// Ruta recta de 5 km hacia el este, con un punto cada 100 m (en metros).
const P = Array.from({ length: 51 }, (_, i) => [i * 100, 0]);
const acumulado = P.map(([x]) => x);

test('normalmente busca la posición solo cerca de donde ibas', () => {
  const lejos = proyectarEnRuta(P, acumulado, [3500, 5], 500);
  assert.ok(lejos.d > 40, 'a 3 km de distancia no debe engancharse');
});

test('al volver a encender la pantalla encuentra la posición aunque hayas avanzado mucho', () => {
  const r = proyectarEnRuta(P, acumulado, [3500, 5], 500, true);
  assert.ok(r.d < 6);
  assert.ok(Math.abs(r.s - 3500) < 1);
});

test('el enlace a Google Maps parte de tu ubicación y sigue lo que falta de la ruta', () => {
  const geometria = Array.from({ length: 51 }, (_, i) => [-12.1, -77.05 + i * 0.001]);
  const url = new URL(enlaceSeguirEnGoogle(geometria, acumulado, 1000, 'bicycling'));
  const q = url.searchParams;

  assert.equal(q.get('origin'), null);
  assert.equal(q.get('travelmode'), 'bicycling');
  assert.equal(q.get('dir_action'), 'navigate');
  assert.equal(q.get('destination'), '-12.10000,-77.00000');
  const puntos = q.get('waypoints').split('|');
  assert.equal(puntos.length, 3);
  // Los puntos de paso están después de lo ya recorrido (1 km = índice 10).
  assert.ok(puntos.every((p) => Number(p.split(',')[1]) > -77.04));
});

test('si falta poco, el enlace va directo al destino', () => {
  const geometria = Array.from({ length: 51 }, (_, i) => [-12.1, -77.05 + i * 0.001]);
  const q = new URL(enlaceSeguirEnGoogle(geometria, acumulado, 4000)).searchParams;
  assert.equal(q.get('waypoints'), null);
  assert.equal(q.get('travelmode'), 'driving');
});
