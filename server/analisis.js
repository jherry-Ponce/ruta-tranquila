// Clasifica cada tramo de una ruta por tipo de vía y detecta los cruces y tramos por vías principales.
//
// Las extras de OpenRouteService (waytype) juntan secundarias y terciarias en un mismo valor, y no
// informan las avenidas que la ruta cruza. Por eso se compara la geometría de la ruta con el archivo
// local de vías principales de OpenStreetMap.

import { aMetros, aGrados, distancia, puntoEnSegmento, angulo, contacto } from './geo.js';
import { RANGO, segmentoDe } from './vias.js';

// waytype de OpenRouteService: 1 State Road (primary, trunk, motorway), 2 Road (secondary, tertiary,
// unclassified), 3 Street (residential, service), 4 Path, 5 Track, 6 Cycleway, 7 Footway, 8 Steps.
const CLASE_POR_WAYTYPE = { 1: 'primaria', 2: 'menor', 3: 'residencial', 4: 'vereda', 6: 'ciclovia', 7: 'vereda', 8: 'vereda' };
// Ciclovías y veredas corren junto a las avenidas: no se confunden con ir por la avenida.
const SIN_CALZADA = new Set([4, 6, 7, 8]);
export const PRINCIPALES = new Set(['autopista', 'primaria', 'secundaria']);

const DISTANCIA_SOBRE = 5; // m: la ruta "va por" una vía si está así de cerca y en paralelo
const ANGULO_SOBRE = 20; // grados
const ANGULO_CRUCE = 35; // grados: por debajo de esto no se considera un cruce
const TOLERANCIA_CRUCE = 1.5; // m
const SEPARACION_CRUCES = 90; // m: toques más cercanos son un mismo cruce (doble calzada, auxiliares, Vía Expresa)
const MARGEN_TRAMO = 60; // m: un toque así de cerca de un tramo de la misma vía es su entrada o salida
const TRAMO_MINIMO = 80; // m
const HUECO_TRAMO = 40; // m: interrupciones más cortas no cortan un tramo

export function analizarRuta(coordenadas, valoresWaytype, red) {
  const P = coordenadas.map(aMetros);
  const n = P.length - 1;
  const acumulado = new Float64Array(P.length);
  for (let i = 0; i < n; i++) acumulado[i + 1] = acumulado[i] + distancia(P[i], P[i + 1]);

  const waytype = new Array(n).fill(0);
  for (const [desde, hasta, valor] of valoresWaytype ?? []) {
    for (let i = desde; i < Math.min(hasta, n); i++) waytype[i] = valor;
  }

  const segmentos = [];
  const toques = [];
  for (let i = 0; i < n; i++) {
    const a = P[i];
    const b = P[i + 1];
    const largo = acumulado[i + 1] - acumulado[i];
    const claseWaytype = CLASE_POR_WAYTYPE[waytype[i]] ?? 'menor';
    if (largo < 0.5) {
      const previo = segmentos.at(-1);
      segmentos.push({ indice: i, desde: acumulado[i], largo, clase: previo?.clase ?? claseWaytype, via: previo?.via ?? null });
      continue;
    }

    const candidatos = [];
    red.indice.buscar(
      Math.min(a[0], b[0]) - 8,
      Math.min(a[1], b[1]) - 8,
      Math.max(a[0], b[0]) + 8,
      Math.max(a[1], b[1]) + 8,
      (id) => candidatos.push(segmentoDe(red, id)),
    );

    const medio = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    let sobre = null;
    let enDesnivel = false;
    for (const { via, a: c, b: d } of candidatos) {
      if (angulo(a, b, c, d) > ANGULO_SOBRE || puntoEnSegmento(medio, c, d).d > DISTANCIA_SOBRE) continue;
      if (via.desnivel) enDesnivel = true;
      if (via.clase !== 'menor' && (!sobre || RANGO[via.clase] > RANGO[sobre.clase])) sobre = via;
    }
    if (SIN_CALZADA.has(waytype[i])) sobre = null;

    // Si la ruta va por un puente o túnel, lo que pasa por debajo o por encima no es un cruce.
    if (!enDesnivel) {
      for (const { via, a: c, b: d } of candidatos) {
        if (via.clase === 'menor' || via.desnivel || via === sobre) continue;
        if (angulo(a, b, c, d) < ANGULO_CRUCE) continue;
        const t = contacto(a, b, c, d, TOLERANCIA_CRUCE);
        if (t === null) continue;
        toques.push({
          en: acumulado[i] + t * largo,
          via,
          punto: [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])],
        });
      }
    }

    segmentos.push({ indice: i, desde: acumulado[i], largo, clase: sobre ? sobre.clase : claseWaytype, via: sobre });
  }

  const metrosPorClase = {};
  for (const s of segmentos) metrosPorClase[s.clase] = (metrosPorClase[s.clase] ?? 0) + s.largo;

  const tramos = unirTramos(segmentos, P);
  const cruces = agruparCruces(toques, tramos);

  return { distancia: acumulado[n] ?? 0, acumulado, segmentos, metrosPorClase, tramos, cruces };
}

function unirTramos(segmentos, P) {
  const tramos = [];
  let actual = null;
  const cerrar = () => {
    if (!actual) return;
    const longitud = actual.hasta - actual.desde;
    if (longitud >= TRAMO_MINIMO) {
      // La clase del tramo es la más peligrosa que ocupe al menos un 30%; si no, la más larga.
      const umbral = 0.3 * longitud;
      const clase =
        Object.keys(RANGO)
          .filter((c) => (actual.metros[c] ?? 0) >= umbral)
          .sort((x, y) => RANGO[y] - RANGO[x])[0] ??
        Object.entries(actual.metros).sort((x, y) => y[1] - x[1])[0][0];
      const nombres = [...actual.nombres.entries()]
        .filter(([, m]) => m >= 50)
        .sort((x, y) => y[1] - x[1])
        .slice(0, 2)
        .map(([nombre]) => nombre);
      tramos.push({
        clase,
        nombres,
        todos: new Set(actual.nombres.keys()),
        desde: actual.desde,
        hasta: actual.hasta,
        longitud,
        punto: aGrados(P[actual.indice]),
      });
    }
    actual = null;
  };

  for (const s of segmentos) {
    if (!PRINCIPALES.has(s.clase)) continue;
    if (!actual || s.desde - actual.hasta > HUECO_TRAMO) {
      cerrar();
      actual = { desde: s.desde, hasta: s.desde, indice: s.indice, metros: {}, nombres: new Map() };
    }
    actual.hasta = s.desde + s.largo;
    actual.metros[s.clase] = (actual.metros[s.clase] ?? 0) + s.largo;
    if (s.via?.nombre) actual.nombres.set(s.via.nombre, (actual.nombres.get(s.via.nombre) ?? 0) + s.largo);
  }
  cerrar();
  return tramos;
}

function agruparCruces(toques, tramos) {
  const cercaDeTramo = (t) =>
    tramos.some(
      (tramo) =>
        t.en >= tramo.desde - MARGEN_TRAMO &&
        t.en <= tramo.hasta + MARGEN_TRAMO &&
        (!t.via.nombre || tramo.todos.has(t.via.nombre)),
    );

  const grupos = [];
  for (const t of toques.filter((t) => !cercaDeTramo(t)).sort((x, y) => x.en - y.en)) {
    const ultimo = grupos.at(-1);
    if (ultimo && t.en - ultimo.hasta <= SEPARACION_CRUCES) {
      ultimo.hasta = t.en;
      ultimo.toques.push(t);
    } else {
      grupos.push({ desde: t.en, hasta: t.en, toques: [t] });
    }
  }

  return grupos.map((g) => {
    const clase = g.toques.map((t) => t.via.clase).sort((x, y) => RANGO[y] - RANGO[x])[0];
    // OSM a veces escribe el mismo nombre con distinta mayúscula ("Av. del Parque Sur" / "Av. Del Parque Sur").
    const nombres = [...new Map(g.toques.filter((t) => t.via.nombre).map((t) => [t.via.nombre.toLowerCase(), t.via.nombre])).values()];
    const medio = g.toques[Math.floor(g.toques.length / 2)];
    return { clase, nombres, en: g.desde, punto: aGrados(medio.punto) };
  });
}
