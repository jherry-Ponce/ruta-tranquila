// Tráfico del momento con TomTom: se le envía la ruta ya calculada (supportingPoints) y devuelve
// el retraso por tráfico y los tramos con atasco. Es opcional: sin TOMTOM_API_KEY no se usa.

import { aMetros, distancia } from './geo.js';

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
