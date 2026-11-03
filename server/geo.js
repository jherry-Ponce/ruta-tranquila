// Geometría plana en metros. Para un área del tamaño de Lima, esta proyección local
// tiene un error despreciable y permite calcular distancias y cruces con operaciones simples.

const LAT0 = -12.05;
const LON0 = -77.03;
const METROS_POR_GRADO_LAT = 110_574;
const METROS_POR_GRADO_LON = 111_320 * Math.cos((LAT0 * Math.PI) / 180);

export const aMetros = ([lon, lat]) => [
  (lon - LON0) * METROS_POR_GRADO_LON,
  (lat - LAT0) * METROS_POR_GRADO_LAT,
];

export const aGrados = ([x, y]) => [x / METROS_POR_GRADO_LON + LON0, y / METROS_POR_GRADO_LAT + LAT0];

export const distancia = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);

// Punto de AB más cercano a P: fracción t sobre AB, coordenadas y distancia.
export function puntoEnSegmento(p, a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  let t = l2 === 0 ? 0 : ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2;
  t = Math.max(0, Math.min(1, t));
  const x = a[0] + t * dx;
  const y = a[1] + t * dy;
  return { t, x, y, d: Math.hypot(p[0] - x, p[1] - y) };
}

// Ángulo entre dos segmentos sin importar el sentido: 0° paralelos, 90° perpendiculares.
export function angulo(a, b, c, d) {
  const r1 = Math.atan2(b[1] - a[1], b[0] - a[0]);
  const r2 = Math.atan2(d[1] - c[1], d[0] - c[0]);
  const g = ((Math.abs(r1 - r2) * 180) / Math.PI) % 180;
  return g > 90 ? 180 - g : g;
}

// Fracción t sobre AB donde AB toca a CD, o null si no se tocan.
// La tolerancia cubre las calles que comparten un nodo con la avenida (se tocan en un extremo).
export function contacto(a, b, c, d, tolerancia) {
  const r = [b[0] - a[0], b[1] - a[1]];
  const s = [d[0] - c[0], d[1] - c[1]];
  const den = r[0] * s[1] - r[1] * s[0];
  if (den !== 0) {
    const q = [c[0] - a[0], c[1] - a[1]];
    const t = (q[0] * s[1] - q[1] * s[0]) / den;
    const u = (q[0] * r[1] - q[1] * r[0]) / den;
    if (t >= 0 && t <= 1 && u >= 0 && u <= 1) return t;
  }
  const opciones = [
    { ...puntoEnSegmento(c, a, b) },
    { ...puntoEnSegmento(d, a, b) },
    { t: 0, d: puntoEnSegmento(a, c, d).d },
    { t: 1, d: puntoEnSegmento(b, c, d).d },
  ].filter((o) => o.d <= tolerancia);
  if (!opciones.length) return null;
  return opciones.reduce((m, o) => (o.d < m.d ? o : m)).t;
}

// Índice espacial por celdas para encontrar rápido los segmentos cercanos a un punto o segmento.
export class IndiceSegmentos {
  constructor(celda = 150) {
    this.celda = celda;
    this.celdas = new Map();
  }

  #clave(ix, iy) {
    return (ix + 50_000) * 100_000 + (iy + 50_000);
  }

  agregar(a, b, id) {
    const c = this.celda;
    for (let ix = Math.floor(Math.min(a[0], b[0]) / c); ix <= Math.floor(Math.max(a[0], b[0]) / c); ix++) {
      for (let iy = Math.floor(Math.min(a[1], b[1]) / c); iy <= Math.floor(Math.max(a[1], b[1]) / c); iy++) {
        const k = this.#clave(ix, iy);
        const lista = this.celdas.get(k);
        if (lista) lista.push(id);
        else this.celdas.set(k, [id]);
      }
    }
  }

  // Llama a fn(id) una vez por cada segmento registrado en las celdas del rectángulo.
  buscar(minX, minY, maxX, maxY, fn) {
    const c = this.celda;
    const vistos = new Set();
    for (let ix = Math.floor(minX / c); ix <= Math.floor(maxX / c); ix++) {
      for (let iy = Math.floor(minY / c); iy <= Math.floor(maxY / c); iy++) {
        for (const id of this.celdas.get(this.#clave(ix, iy)) ?? []) {
          if (vistos.has(id)) continue;
          vistos.add(id);
          fn(id);
        }
      }
    }
  }
}

// Qué fracción del recorrido A (en metros) pasa a menos de `radio` metros del recorrido B.
export function fraccionCompartida(A, B, paso = 40, radio = 20) {
  const indice = new IndiceSegmentos(100);
  for (let j = 0; j < B.length - 1; j++) indice.agregar(B[j], B[j + 1], j);
  let muestras = 0;
  let cerca = 0;
  let recorrido = 0;
  let siguiente = 0;
  for (let i = 0; i < A.length - 1; i++) {
    const largo = distancia(A[i], A[i + 1]);
    while (largo > 0 && siguiente <= recorrido + largo) {
      const t = (siguiente - recorrido) / largo;
      const p = [A[i][0] + t * (A[i + 1][0] - A[i][0]), A[i][1] + t * (A[i + 1][1] - A[i][1])];
      muestras++;
      let encontrado = false;
      indice.buscar(p[0] - radio, p[1] - radio, p[0] + radio, p[1] + radio, (j) => {
        if (!encontrado && puntoEnSegmento(p, B[j], B[j + 1]).d <= radio) encontrado = true;
      });
      if (encontrado) cerca++;
      siguiente += paso;
    }
    recorrido += largo;
  }
  return muestras ? cerca / muestras : 0;
}
