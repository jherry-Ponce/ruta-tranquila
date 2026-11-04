import { ubicacionConfirmada } from './ubicaciones-confirmadas.js';
import { puntoDeEnlace } from './enlaces-mapas.js';
// Búsqueda de direcciones. Con key de TomTom se usa su geocoding, que en Lima suele encontrar el número
// de casa; si no hay key o TomTom falla, se usa el de OpenRouteService (que a menudo solo ubica la calle).

import { geocodificar, geocodificarInverso, autocompletar } from './ors.js';
import { hayKeyTomTom } from './trafico.js';

const BASE = 'https://api.tomtom.com/search/2';

// En algunas redes la conexión a veces no se abre; una búsqueda normal responde en menos de 2 s, así que
// se corta a los 5 s y se reintenta hasta 3 veces en vez de esperar los 10 s que tarda en fallar sola.
async function pedirTomTom(url) {
  let respuesta;
  for (let intento = 1; !respuesta; intento++) {
    try {
      respuesta = await fetch(url, { signal: AbortSignal.timeout(5_000) });
    } catch (error) {
      if (intento >= 3) throw error;
    }
  }
  if (!respuesta.ok) throw new Error(`TomTom respondió ${respuesta.status}`);
  return respuesta.json();
}

// Solo el motivo, nunca la dirección buscada.
const avisar = (error) => console.warn(`Búsqueda en TomTom falló (${error.message}); se usa OpenRouteService.`);

const dentro = ({ lat, lon }, l) => lat >= l.sur && lat <= l.norte && lon >= l.oeste && lon <= l.este;

export async function buscarDireccion(texto, limites) {
  const confirmado = ubicacionConfirmada(texto) ?? await puntoDeEnlace(texto, limites);
  if (confirmado) return dentro(confirmado, limites) ? [confirmado] : [];
  if (hayKeyTomTom()) {
    try {
      const q = new URLSearchParams({
        key: process.env.TOMTOM_API_KEY,
        countrySet: 'PE',
        language: 'es-419',
        limit: '5',
        lat: '-12.06',
        lon: '-77.03',
      });
      const json = await pedirTomTom(`${BASE}/geocode/${encodeURIComponent(texto)}.json?${q}`);
      const lugares = (json.results ?? [])
        .map((r) => ({
          etiqueta: r.address.freeformAddress,
          lat: r.position.lat,
          lon: r.position.lon,
          exacto: r.type === 'Point Address',
          tipo: r.type,
        }))
        .filter((l) => dentro(l, limites));
      if (lugares.length) return lugares;
    } catch (error) {
      avisar(error);
    }
  }
  return (await geocodificar(texto, limites)).filter((l) => dentro(l, limites));
}

// Sugerencias mientras se escribe: TomTom en modo "typeahead" y, si no da nada, OpenRouteService.
export async function sugerirLugares(texto, limites) {
  const confirmado = ubicacionConfirmada(texto) ?? await puntoDeEnlace(texto, limites);
  if (confirmado) return dentro(confirmado, limites) ? [confirmado] : [];
  if (hayKeyTomTom()) {
    try {
      const q = new URLSearchParams({ key: process.env.TOMTOM_API_KEY, countrySet: 'PE', language: 'es-419', limit: '6', typeahead: 'true', lat: '-12.09', lon: '-77.03' });
      const json = await pedirTomTom(`${BASE}/geocode/${encodeURIComponent(texto)}.json?${q}`);
      const lugares = (json.results ?? [])
        .map((r) => ({
          etiqueta: r.address.freeformAddress,
          nombre: [r.address.streetName, r.address.streetNumber].filter(Boolean).join(' ') || r.address.freeformAddress.split(',')[0],
          zona: [r.address.municipalitySubdivision, r.address.municipality].filter(Boolean).join(', '),
          lat: r.position.lat,
          lon: r.position.lon,
          exacto: r.type === 'Point Address',
        }))
        .filter((l) => dentro(l, limites));
      if (lugares.length) return lugares;
    } catch (error) {
      avisar(error);
    }
  }
  return autocompletar(texto, limites);
}

export async function direccionDePunto(lat, lon) {
  if (hayKeyTomTom()) {
    try {
      const q = new URLSearchParams({ key: process.env.TOMTOM_API_KEY, language: 'es-419' });
      const json = await pedirTomTom(`${BASE}/reverseGeocode/${lat},${lon}.json?${q}`);
      const direccion = json.addresses?.[0]?.address?.freeformAddress;
      if (direccion) return { etiqueta: direccion, lat, lon, exacto: false, tipo: 'reverse' };
    } catch (error) {
      avisar(error);
    }
  }
  return geocodificarInverso(lat, lon);
}
