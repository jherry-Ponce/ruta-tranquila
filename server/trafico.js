// Tráfico del momento con TomTom: se le envía la ruta ya calculada (supportingPoints) y devuelve
// el retraso por tráfico y los tramos con atasco. Es opcional: sin TOMTOM_API_KEY no se usa.

import { aMetros, aGrados, distancia } from './geo.js';

export const hayKeyTomTom = () => Boolean(process.env.TOMTOM_API_KEY);

const CATEGORIAS = {
  JAM: 'Tráfico lento o atasco',
  ROAD_WORK: 'Obras en la vía',
  ROAD_CLOSURE: 'Vía cerrada',
  OTHER: 'Incidente de tránsito',
};

// TomTom: magnitudeOfDelay 0 desconocido, 1 leve, 2 moderado, 3 fuerte, 4 indefinido (cierres).
const gravedad = (magnitud) => (magnitud === 4 ? 3 : Math.max(1, magnitud ?? 1));

// Quita puntos a menos de 10 m del anterior: TomTom reconstruye la ruta igual y el pedido pesa menos.
function puntosDeApoyo(coordenadas) {
  const salida = [coordenadas[0]];
  let previo = aMetros(coordenadas[0]);
  for (const c of coordenadas.slice(1, -1)) {
    const p = aMetros(c);
    if (distancia(previo, p) >= 10) {
      salida.push(c);
      previo = p;
    }
  }
  salida.push(coordenadas.at(-1));
  return salida.map(([lon, lat]) => ({ latitude: lat, longitude: lon }));
}

// coordenadas: [[lon, lat], ...] de la ruta; distanciaOrs: su largo según OpenRouteService.
export async function medirTrafico(coordenadas, distanciaOrs) {
  const [olon, olat] = coordenadas[0];
  const [dlon, dlat] = coordenadas.at(-1);
  const q = new URLSearchParams({
    key: process.env.TOMTOM_API_KEY,
    traffic: 'true',
    sectionType: 'traffic',
    computeTravelTimeFor: 'all',
    travelMode: 'car',
    routeType: 'fastest',
  });
  const url = `https://api.tomtom.com/routing/1/calculateRoute/${olat},${olon}:${dlat},${dlon}/json?${q}`;

  // A veces la conexión se corta al abrirla; se reintenta una vez.
  let respuesta;
  for (let intento = 1; !respuesta; intento++) {
    try {
      respuesta = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ supportingPoints: puntosDeApoyo(coordenadas) }),
        // Responde en 1-3 s; si la conexión no se abre, conviene cortar pronto y reintentar.
        signal: AbortSignal.timeout(8_000),
      });
    } catch {
      if (intento >= 2) return { error: 'no pude conectarme con TomTom' };
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  if (respuesta.status === 401 || respuesta.status === 403) return { error: 'TomTom rechazó la key TOMTOM_API_KEY' };
  if (respuesta.status === 429) return { error: 'se alcanzó el límite de consultas de TomTom' };
  if (!respuesta.ok) return { error: `TomTom respondió con el error ${respuesta.status}` };

  const ruta = (await respuesta.json()).routes?.[0];
  if (!ruta) return { error: 'TomTom no devolvió una ruta' };

  const puntos = ruta.legs.flatMap((leg) => leg.points);
  const resumen = ruta.summary;
  const tramos = (ruta.sections ?? [])
    .filter((s) => s.sectionType === 'TRAFFIC')
    .map((s) => {
      const medio = puntos[Math.floor((s.startPointIndex + s.endPointIndex) / 2)] ?? puntos[s.startPointIndex];
      return {
        gravedad: gravedad(s.magnitudeOfDelay),
        categoria: CATEGORIAS[s.simpleCategory] ?? CATEGORIAS.OTHER,
        velocidadKmh: s.effectiveSpeedInKmh ?? null,
        retrasoSegundos: s.delayInSeconds ?? 0,
        lat: medio.latitude,
        lon: medio.longitude,
      };
    });

  // Si TomTom recorrió algo muy distinto, sus datos no describen nuestra ruta.
  const confiable = Math.abs(resumen.lengthInMeters - distanciaOrs) <= 0.15 * distanciaOrs;
  return {
    confiable,
    duracionSegundos: resumen.travelTimeInSeconds,
    sinTraficoSegundos: resumen.noTrafficTravelTimeInSeconds ?? null,
    retrasoSegundos: resumen.trafficDelayInSeconds ?? 0,
    longitudMetros: resumen.lengthInMeters,
    tramos,
  };
}

// ----- Atascos y cierres de la zona, para que la ruta no entre en ellos -----
// Un solo pedido a TomTom Traffic Incidents por búsqueda (solo si se sale "ahora"). Cada atasco o cierre
// llega con el trazo de la calle afectada; se cubre con rectángulos angostos, igual que las avenidas en
// zonas.js, para que OpenRouteService arme la ruta por otras calles. Si TomTom falla, se sigue sin esto.


const ATASCO = 6; // iconCategory de TomTom: 6 atasco, 8 vía cerrada
const CIERRE = 8;
const MAGNITUD_MINIMA = 2; // moderado o fuerte: un tráfico leve no justifica dar un rodeo
const MARGEN_ZONA = 1500; // m alrededor del trayecto donde se buscan incidentes
const JUNTO_A_EXTREMO = 150; // m: un atasco pegado a la salida o la llegada no se puede esquivar
const MEDIO_ANCHO_INCIDENTE = 6; // m a cada lado del trazo

const distanciaAlSegmento = (p, a, b) => {
  const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
  const largo2 = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / largo2));
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
};

// extremos: [[lon, lat], [lon, lat]]. Devuelve [{ tipo: 'atasco' | 'cierre', trazo: [[x, y] en metros] }].
export async function incidentesDeLaZona(extremos, { bici = false } = {}) {
  if (!hayKeyTomTom()) return [];
  const [a, b] = extremos.map(aMetros);
  const minimo = aGrados([Math.min(a[0], b[0]) - MARGEN_ZONA, Math.min(a[1], b[1]) - MARGEN_ZONA]);
  const maximo = aGrados([Math.max(a[0], b[0]) + MARGEN_ZONA, Math.max(a[1], b[1]) + MARGEN_ZONA]);
  const campos = '{incidents{geometry{type,coordinates},properties{iconCategory,magnitudeOfDelay}}}';
  const q = new URLSearchParams({
    key: process.env.TOMTOM_API_KEY,
    bbox: [...minimo, ...maximo].map((v) => v.toFixed(5)).join(','),
    fields: campos,
    timeValidityFilter: 'present',
  });
  try {
    const respuesta = await fetch(`https://api.tomtom.com/traffic/services/5/incidentDetails?${q}`, { signal: AbortSignal.timeout(4_000) });
    if (!respuesta.ok) return [];
    const { incidents = [] } = await respuesta.json();
    return incidents
      .filter(({ properties: p }) => p.iconCategory === CIERRE || (!bici && p.iconCategory === ATASCO && p.magnitudeOfDelay >= MAGNITUD_MINIMA))
      .map(({ geometry, properties }) => ({
        tipo: properties.iconCategory === CIERRE ? 'cierre' : 'atasco',
        trazo: (geometry.type === 'Point' ? [geometry.coordinates] : geometry.coordinates).map(aMetros),
      }));
  } catch {
    // Sin respuesta a tiempo: la búsqueda sigue como antes, sin esquivar el tráfico.
    return [];
  }
}

// Convierte los incidentes en zonas a evitar (MultiPolygon de ORS). Los que tocan la salida o la llegada no se
// esquivan (habría que pasar igual) y se informan aparte. `cerca` cuenta los que están junto al trayecto, para
// decirlo en la interfaz sin exagerar con los de toda la zona.
export function zonasDeIncidentes(incidentes, extremos) {
  const [a, b] = extremos.map(aMetros);
  const corredor = Math.max(500, 0.15 * distancia(a, b));
  const resultado = { zonas: [], cerca: { atascos: 0, cierres: 0 }, junto: { salida: false, llegada: false } };
  for (const { tipo, trazo } of incidentes) {
    const enSalida = trazo.some((p) => distancia(p, a) < JUNTO_A_EXTREMO);
    const enLlegada = trazo.some((p) => distancia(p, b) < JUNTO_A_EXTREMO);
    if (enSalida || enLlegada) {
      if (tipo === 'atasco') {
        resultado.junto.salida ||= enSalida;
        resultado.junto.llegada ||= enLlegada;
      }
      continue;
    }
    if (trazo.some((p) => distanciaAlSegmento(p, a, b) <= corredor)) resultado.cerca[tipo === 'cierre' ? 'cierres' : 'atascos']++;
    const puntos = trazo.length === 1 ? [trazo[0], [trazo[0][0] + 1, trazo[0][1]]] : trazo;
    for (let i = 0; i < puntos.length - 1; i++) {
      const [p, q] = [puntos[i], puntos[i + 1]];
      const largo = distancia(p, q) || 1;
      const u = [(q[0] - p[0]) / largo, (q[1] - p[1]) / largo];
      // Se alarga un poco cada tramo para que no queden huecos entre rectángulos seguidos.
      const [p0, p1] = [[p[0] - u[0] * 3, p[1] - u[1] * 3], [q[0] + u[0] * 3, q[1] + u[1] * 3]];
      const n = [-u[1] * MEDIO_ANCHO_INCIDENTE, u[0] * MEDIO_ANCHO_INCIDENTE];
      const anillo = [
        [p0[0] + n[0], p0[1] + n[1]],
        [p1[0] + n[0], p1[1] + n[1]],
        [p1[0] - n[0], p1[1] - n[1]],
        [p0[0] - n[0], p0[1] - n[1]],
      ].map((v) => aGrados(v).map((c) => Number(c.toFixed(6))));
      anillo.push(anillo[0]);
      resultado.zonas.push([anillo]);
    }
  }
  return resultado;
}
