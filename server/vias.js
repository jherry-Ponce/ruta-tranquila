// Carga las vías principales de Lima (descargadas de OpenStreetMap) y arma un índice espacial.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { aMetros, IndiceSegmentos } from './geo.js';

export const ARCHIVO_VIAS = fileURLToPath(new URL('../data/vias-principales-lima.json', import.meta.url));

// Orden de "peligrosidad" de cada clase de vía.
export const RANGO = { menor: 0, secundaria: 1, primaria: 2, autopista: 3 };

// Cada segmento se identifica con un número: índice de vía × MAX_NODOS + índice de segmento.
const MAX_NODOS = 4096;

export function cargarRed(archivo = ARCHIVO_VIAS) {
  const datos = JSON.parse(readFileSync(archivo, 'utf8'));
  const vias = datos.vias.map((v) => ({
    nombre: v.n,
    semaforos: (v.s ?? []).map(aMetros),
    clase: v.c,
    ramal: Boolean(v.r),
    desnivel: Boolean(v.d),
    puntos: v.g.slice(0, MAX_NODOS).map(aMetros),
  }));
  const indice = new IndiceSegmentos(150);
  const indiceCiclovias = new IndiceSegmentos(150);
  vias.forEach((via, i) => {
    for (let j = 0; j < via.puntos.length - 1; j++) {
      const id = i * MAX_NODOS + j;
      if (via.clase === 'ciclovia' && !via.ramal) {
        indiceCiclovias.agregar(via.puntos[j], via.puntos[j + 1], id);
      } else if (via.clase !== 'ciclovia') {
        indice.agregar(via.puntos[j], via.puntos[j + 1], id);
      }
    }
  });
  return {
    vias,
    indice,
    indiceCiclovias,
    info: { generado: datos.generado, datosOsm: datos.datosOsm, total: vias.length },
  };
}

export function segmentoDe(red, id) {
  const via = red.vias[Math.floor(id / MAX_NODOS)];
  const j = id % MAX_NODOS;
  return { via, a: via.puntos[j], b: via.puntos[j + 1] };
}
