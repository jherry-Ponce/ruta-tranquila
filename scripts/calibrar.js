// Comparaciones reproducibles sin consumir APIs ni usar ubicaciones personales.
import cfg from '../config/tranquilidad.js';
import { referencias, evaluarReferencia } from './lib/calibracion.js';

console.log(referencias.descripcion);
const filas = referencias.casos.map((c) => {
  const preferida = evaluarReferencia(c.preferida, c.vehiculo, cfg).valor;
  const alternativa = evaluarReferencia(c.alternativa, c.vehiculo, cfg).valor;
  return { caso: c.nombre, preferida, alternativa, resultado: preferida > alternativa ? 'Correcto' : 'REVISAR' };
});
console.table(filas);
if (filas.some((f) => f.resultado === 'REVISAR')) process.exitCode = 1;
