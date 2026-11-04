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

// Fuzzy Search incluye direcciones y establecimientos; /geocode no encuentra negocios por nombre.
const normalizarNombre = (texto) => texto.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

async function buscarTomTom(texto, limites, sugerencias) {
  const q = new URLSearchParams({
    key: process.env.TOMTOM_API_KEY, countrySet: 'PE', language: 'es-419',
    limit: '12', typeahead: String(sugerencias), lat: '-12.09', lon: '-77.03',
    topLeft: limites.norte + ',' + limites.oeste,
    btmRight: limites.sur + ',' + limites.este,
  });
  const json = await pedirTomTom(BASE + '/search/' + encodeURIComponent(texto) + '.json?' + q);
  const consultaCompleta = normalizarNombre(texto);
  const rango = (nombre, consulta) => {
    if (nombre === consulta) return 0;
    if (nombre.replace(/^centro comercial /, '') === consulta) return 1;
    const palabras = consulta.split(' ');
    const coincide = palabras.every((p) => nombre.split(' ').some((n) => n.startsWith(p)));
    if (coincide && (nombre === palabras[0] || nombre.startsWith(palabras[0] + ' '))) return 1.5;
    return coincide ? 2 : 3;
  };
  const prioridad = (lugar) => {
    if (lugar.tipo !== 'POI') return 3;
    const nombre = normalizarNombre(lugar.nombre);
    // "Larcomar Miraflores": "Miraflores" es el distrito del lugar, no parte de su nombre. Si no se quita,
    // gana un hospedaje llamado "...Larcomar Miraflores" sobre el centro comercial "Larcomar". Se compara
    // con y sin el distrito y vale la mejor, porque a veces el distrito sí es parte del nombre
    // (Plaza San Miguel, en San Miguel).
    const delDistrito = new Set(normalizarNombre(lugar.zona ?? '').split(' ').concat('lima'));
    const sinDistrito = consultaCompleta.split(' ').filter((p) => !delDistrito.has(p)).join(' ');
    return Math.min(rango(nombre, consultaCompleta), sinDistrito ? rango(nombre, sinDistrito) : 3);
  };
  const vistos = new Set();
  return (json.results ?? []).map((r) => {
    const direccion = r.address?.freeformAddress ?? '';
    const nombre = r.poi?.name || [r.address?.streetName, r.address?.streetNumber].filter(Boolean).join(' ') || direccion.split(',')[0];
    return {
      nombre, direccion,
      etiqueta: r.poi?.name ? [nombre, direccion].filter(Boolean).join(' · ') : direccion,
      zona: [r.address?.municipalitySubdivision, r.address?.municipality].filter(Boolean).join(', '),
      lat: r.position?.lat, lon: r.position?.lon,
      // Un punto de interés no garantiza la entrada exacta del edificio.
      exacto: r.type === 'Point Address', tipo: r.type,
    };
  }).filter((l) => {
    if (!dentro(l, limites)) return false;
    const clave = l.nombre + ':' + l.lat + ':' + l.lon;
    if (vistos.has(clave)) return false;
    vistos.add(clave);
    return true;
  }).sort((a, b) => prioridad(a) - prioridad(b)).slice(0, sugerencias ? 6 : 5);
}

async function buscar(texto, limites, sugerencias) {
  const confirmado = ubicacionConfirmada(texto) ?? await puntoDeEnlace(texto, limites);
  if (confirmado) return dentro(confirmado, limites) ? [confirmado] : [];
  if (hayKeyTomTom()) {
    try {
      const lugares = await buscarTomTom(texto, limites, sugerencias);
      if (lugares.length) return lugares;
    } catch (error) { avisar(error); }
  }
  const lugares = await (sugerencias ? autocompletar(texto, limites) : geocodificar(texto, limites));
  return lugares.filter((l) => dentro(l, limites));
}

export const buscarDireccion = (texto, limites) => buscar(texto, limites, false);
export const sugerirLugares = (texto, limites) => buscar(texto, limites, true);

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
