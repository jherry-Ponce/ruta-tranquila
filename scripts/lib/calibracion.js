import { readFileSync } from 'node:fs';
import { calcularPuntaje } from '../../server/puntaje.js';
import { analizarGiros } from '../../server/giros.js';

export const referencias = JSON.parse(readFileSync(new URL('../../data/calibracion-puntaje.json', import.meta.url), 'utf8'));

export function evaluarReferencia(ruta, vehiculo, cfg) {
  const distancia = Object.values(ruta.metrosPorClase).reduce((s, m) => s + m, 0);
  const maniobras = ruta.maniobras ?? [];
  const acumulado = [...maniobras.map((m) => m.en), distancia];
  const pasos = maniobras.map((m, i) => ({ type: m.tipo, way_points: [i, i + 1] }));
  const analisis = {
    distancia, metrosPorClase: ruta.metrosPorClase, cruces: ruta.cruces ?? [],
    giros: analizarGiros(pasos, acumulado, cfg.giros),
  };
  return calcularPuntaje(analisis, ruta.trafico ?? null, cfg, vehiculo);
}
