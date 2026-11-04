// En bici o monopatín, cuando la salida está sobre una avenida, busca la ciclovía más cercana y
// devuelve su punto de entrada (proyección sobre el segmento más cercano) para empezar la ruta ahí.
//
// Solo se ajusta si:
// - la salida está junto a una vía principal: si ya está en una calle tranquila, se puede montar
//   ahí mismo y caminar hasta una ciclovía no aporta nada;
// - la ciclovía está a distancia caminable y no hace retroceder respecto del destino.

import { aMetros, aGrados, distancia, puntoEnSegmento } from './geo.js';
import { segmentoDe } from './vias.js';

const MAX_CAMINATA = 350; // m: radio máximo para buscar una ciclovía cercana
const TOLERANCIA_SOBRE = 8; // m: si ya está así de cerca, no hace falta ajustar
// m: a esta distancia del eje de una vía principal, se sale por la avenida. Las direcciones se ubican en
// la fachada: en la Av. Arequipa 2450 (doble calzada y ciclovía central) el número queda a 33 m del eje.
const DISTANCIA_AVENIDA = 45;
const RETROCESO_MAXIMO = 50; // m: cuánto puede alejarse del destino la entrada a la ciclovía
const PRINCIPALES = new Set(['autopista', 'primaria', 'secundaria']);
export const METROS_POR_MINUTO_A_PIE = 70; // empujando la bici, algo más lento que caminar

function masCercana(indice, red, p, radio, filtro = () => true) {
  let mejor = null;
  indice.buscar(p[0] - radio, p[1] - radio, p[0] + radio, p[1] + radio, (id) => {
    const { via, a, b } = segmentoDe(red, id);
    if (!filtro(via)) return;
    const proj = puntoEnSegmento(p, a, b);
    if (proj.d <= radio && (!mejor || proj.d < mejor.d)) mejor = { ...proj, via };
  });
  return mejor;
}

// ¿El punto (en metros) está sobre una avenida, troncal o vía rápida?
export function sobreAvenida(red, p) {
  if (!red?.indice) return false;
  return Boolean(masCercana(red.indice, red, p, DISTANCIA_AVENIDA, (via) => PRINCIPALES.has(via.clase)));
}

// Devuelve { lon, lat, distanciaCaminata, minutosCaminata, nombre } o null si no conviene ajustar.
export function snapACiclovia(punto, red, destino = null) {
  if (!red?.indiceCiclovias) return null;

  const p = aMetros([punto.lon, punto.lat]);
  if (!sobreAvenida(red, p)) return null;

  const mejor = masCercana(red.indiceCiclovias, red, p, MAX_CAMINATA);
  if (!mejor || mejor.d < TOLERANCIA_SOBRE) return null;

  if (destino) {
    const q = aMetros([destino.lon, destino.lat]);
    if (distancia([mejor.x, mejor.y], q) > distancia(p, q) + RETROCESO_MAXIMO) return null;
  }

  const [lon, lat] = aGrados([mejor.x, mejor.y]);
  const metros = Math.round(mejor.d);
  return {
    lon,
    lat,
    distanciaCaminata: metros,
    minutosCaminata: Math.max(1, Math.round(metros / METROS_POR_MINUTO_A_PIE)),
    nombre: mejor.via.nombre,
  };
}
