// Zonas a evitar (avoid_polygons) para que OpenRouteService no avance por avenidas.
//
// OpenRouteService no permite bajar la prioridad de un tipo de vía en su API pública. En cambio, acepta
// polígonos por los que la ruta no puede pasar. Se cubre con un rectángulo la parte central de cada tramo
// largo de avenida y se dejan libres sus puntas (las intersecciones) y los puentes o túneles que la cruzan.
// Así la ruta puede cruzar una avenida, pero no recorrerla.

import { aMetros, aGrados, distancia, contacto } from './geo.js';
import { segmentoDe } from './vias.js';

const LARGO_MINIMO = 40; // m: tramos más cortos quedan libres
const MARGEN_NODO = 16; // m libres en cada punta del tramo
const MARGEN_DESNIVEL = 25; // m libres a cada lado de un puente o túnel que cruza el tramo
const MEDIO_ANCHO = 4; // m a cada lado del eje: basta para cortar la vía y deja libres ciclovías y auxiliares
const LIBRE_EXTREMOS = 250; // m alrededor del origen y del destino, para poder salir y llegar

// Devuelve las coordenadas de un MultiPolygon GeoJSON ([lon, lat]) o un arreglo vacío.
export function zonasAEvitar(red, extremos, clases) {
  const puntos = extremos.map(aMetros);
  // El área cubierta rodea el trayecto con holgura para que la ruta no rodee por fuera hasta otra avenida.
  const margen = Math.min(3000, Math.max(1500, 0.3 * distancia(puntos[0], puntos[1])));
  const minX = Math.min(puntos[0][0], puntos[1][0]) - margen;
  const maxX = Math.max(puntos[0][0], puntos[1][0]) + margen;
  const minY = Math.min(puntos[0][1], puntos[1][1]) - margen;
  const maxY = Math.max(puntos[0][1], puntos[1][1]) + margen;

  const poligonos = [];
  red.indice.buscar(minX, minY, maxX, maxY, (id) => {
    const { via, a, b } = segmentoDe(red, id);
    // Las vías rápidas se cubren enteras: también sus ramales y aunque pasen junto al origen o el destino.
    const rapida = via.clase === 'autopista';
    if (!clases.has(via.clase) || via.desnivel || (via.ramal && !rapida)) return;
    const largo = distancia(a, b);
    if (largo < (rapida ? 10 : LARGO_MINIMO)) return;
    if (!rapida && puntos.some((p) => Math.min(distancia(p, a), distancia(p, b)) < LIBRE_EXTREMOS)) return;

    const cortes = [];
    red.indice.buscar(Math.min(a[0], b[0]) - 5, Math.min(a[1], b[1]) - 5, Math.max(a[0], b[0]) + 5, Math.max(a[1], b[1]) + 5, (otro) => {
      const s = segmentoDe(red, otro);
      if (!s.via.desnivel) return;
      const t = contacto(a, b, s.a, s.b, 3);
      if (t !== null) cortes.push(t * largo);
    });

    const libres = [];
    const margenNodo = rapida ? 3 : MARGEN_NODO;
    let inicio = margenNodo;
    for (const corte of cortes.sort((x, y) => x - y)) {
      if (corte - MARGEN_DESNIVEL > inicio) libres.push([inicio, corte - MARGEN_DESNIVEL]);
      inicio = Math.max(inicio, corte + MARGEN_DESNIVEL);
    }
    if (largo - margenNodo > inicio) libres.push([inicio, largo - margenNodo]);

    const u = [(b[0] - a[0]) / largo, (b[1] - a[1]) / largo];
    const n = [-u[1] * MEDIO_ANCHO, u[0] * MEDIO_ANCHO];
    for (const [s0, s1] of libres) {
      if (s1 - s0 < (rapida ? 3 : 8)) continue;
      const p0 = [a[0] + u[0] * s0, a[1] + u[1] * s0];
      const p1 = [a[0] + u[0] * s1, a[1] + u[1] * s1];
      const anillo = [
        [p0[0] + n[0], p0[1] + n[1]],
        [p1[0] + n[0], p1[1] + n[1]],
        [p1[0] - n[0], p1[1] - n[1]],
        [p0[0] - n[0], p0[1] - n[1]],
      ].map((p) => aGrados(p).map((v) => Number(v.toFixed(6))));
      anillo.push(anillo[0]);
      poligonos.push([anillo]);
    }
  });
  return poligonos;
}
