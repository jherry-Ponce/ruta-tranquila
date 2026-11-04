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

test('para bici o monopatín una ruta con más ciclovía puede superar a una con más calles de barrio', () => {
  const mayormenteCalles = analisis({ ciclovia: 500, residencial: 2600, menor: 6900 });
  const masCiclovia = analisis({ ciclovia: 1000, residencial: 1800, menor: 6800, secundaria: 100, primaria: 200, vereda: 100 });

  const autoA = calcularPuntaje(mayormenteCalles, null, cfg);
  const autoB = calcularPuntaje(masCiclovia, null, cfg);
  const biciA = calcularPuntaje(mayormenteCalles, null, cfg, 'bici');
  const biciB = calcularPuntaje(masCiclovia, null, cfg, 'bici');

  assert.ok(autoA.valor > autoB.valor);
  assert.ok(biciB.valor > biciA.valor);
  assert.equal(biciB.desglose.ciclovias, cfg.bonoCiclovia.maximo);
  assert.match(biciB.explicacion, /ciclovías protegidas suma \+15 puntos/);
});

test('un semáforo reduce parcialmente la penalización y los giros restan', () => {
  const desconocido = calcularPuntaje(analisis({ residencial: 3000 }, [{ clase: 'primaria' }]), null, cfg);
  const datos = analisis({ residencial: 3000 }, [{ clase: 'primaria', semaforo: true }]);
  const señalizado = calcularPuntaje(datos, null, cfg);
  assert.ok(señalizado.valor > desconocido.valor);
  assert.ok(señalizado.desglose.cruces < 0);
  datos.giros = { cantidad: 12, penalizacion: 6 };
  const complejo = calcularPuntaje(datos, null, cfg);
  assert.equal(complejo.valor, señalizado.valor - 6);
  assert.equal(complejo.desglose.giros, -6);
});
