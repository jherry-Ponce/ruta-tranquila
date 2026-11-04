import { test } from 'node:test';
import assert from 'node:assert/strict';
import cfg from '../config/tranquilidad.js';
import { referencias, evaluarReferencia } from '../scripts/lib/calibracion.js';

for (const caso of referencias.casos) {
  test('Referencia sintética: ' + caso.nombre, () => {
    const preferida = evaluarReferencia(caso.preferida, caso.vehiculo, cfg);
    const alternativa = evaluarReferencia(caso.alternativa, caso.vehiculo, cfg);
    assert.ok(preferida.valor > alternativa.valor, JSON.stringify({ preferida, alternativa }));
    for (const p of [preferida, alternativa]) {
      const suma = Object.values(p.desglose).reduce((s, n) => s + n, 0);
      assert.equal(p.valor, Math.max(0, suma));
    }
  });
}
