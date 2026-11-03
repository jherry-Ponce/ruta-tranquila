import { test } from 'node:test';
import assert from 'node:assert/strict';
import cfg from '../config/tranquilidad.js';
import { calcularPuntaje } from '../server/puntaje.js';

const analisis = (metrosPorClase, cruces = []) => ({
  distancia: Object.values(metrosPorClase).reduce((a, b) => a + b, 0),
  metrosPorClase,
  cruces,
});

test('una ruta solo por calles residenciales y sin cruces vale 100', () => {
  const p = calcularPuntaje(analisis({ residencial: 3000 }), null, cfg);
  assert.equal(p.valor, 100);
  assert.equal(p.etiqueta, 'Muy tranquila');
  assert.match(p.explicacion, /100% por calles tranquilas/);
});

test('pondera por distancia y resta los cruces', () => {
  const p = calcularPuntaje(
    analisis({ residencial: 6000, secundaria: 2000, primaria: 2000 }, [{ clase: 'primaria' }, { clase: 'secundaria' }]),
    null,
    cfg,
  );
  // 0.6×100 + 0.2×35 + 0.2×10 = 69. Los cruces (5 + 2) se cuentan por cada 5 km: en 10 km valen la mitad.
  assert.equal(p.desglose.base, 69);
  assert.equal(p.desglose.cruces, -4);
  assert.equal(p.valor, 65);
  assert.match(p.explicacion, /Cruzas 1 avenida grande y 1 avenida mediana\./);
});

test('los porcentajes suman 100', () => {
  const p = calcularPuntaje(analisis({ residencial: 1, menor: 1, secundaria: 1 }), null, cfg);
  assert.equal(Object.values(p.porcentajes).reduce((a, b) => a + b, 0), 100);
});

test('la penalización por cruces tiene tope', () => {
  const cruces = Array.from({ length: 10 }, () => ({ clase: 'autopista' }));
  const p = calcularPuntaje(analisis({ residencial: 1000 }, cruces), null, cfg);
  assert.equal(p.desglose.cruces, -cfg.topePenalizacionCruces);
});

test('el tráfico resta solo si la medición es confiable', () => {
  const tramos = [{ gravedad: 3 }, { gravedad: 1 }];
  const con = calcularPuntaje(analisis({ residencial: 1000 }), { confiable: true, tramos }, cfg);
  const sin = calcularPuntaje(analisis({ residencial: 1000 }), { confiable: false, tramos }, cfg);
  assert.equal(con.valor, 90);
  assert.match(con.explicacion, /tráfico en 2 tramos/);
  assert.equal(sin.valor, 100);
});
