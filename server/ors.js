// Cliente mínimo de OpenRouteService. La key se queda en el servidor.

// api.openrouteservice.org quedó obsoleto en 2026 (con cuota reducida); HeiGIT usa api.heigit.org/<servicio>/<versión>.
const RUTAS = 'https://api.heigit.org/openrouteservice/v2';
const GEOCODING = 'https://api.heigit.org/pelias/v1';

export class ErrorServicio extends Error {
  constructor(mensaje, estado = 502, codigo = null) {
    super(mensaje);
    this.estado = estado;
    this.codigo = codigo;
  }
}

export const hayKeyOrs = () => Boolean(process.env.ORS_API_KEY);

// limiteMs: tiempo máximo para este pedido, reintento incluido. Una búsqueda de rutas tiene que terminar
// antes de que Vercel corte la función (60 s), así que cada pedido recibe lo que queda de su plazo.
async function pedir(url, opciones = {}, limiteMs = 80_000) {
  const plazo = Date.now() + limiteMs;
  if (!hayKeyOrs()) {
    throw new ErrorServicio('Falta la key de OpenRouteService. Ponla en el archivo .env (ORS_API_KEY) y reinicia.', 503, 'sin_key');
  }
  // La conexión con api.heigit.org a veces se corta al abrirla; se reintenta una vez.
  let respuesta;
  for (let intento = 1; !respuesta; intento++) {
    try {
      respuesta = await fetch(url, {
        ...opciones,
        headers: {
          Authorization: process.env.ORS_API_KEY,
          Accept: 'application/json, application/geo+json',
          ...(opciones.body ? { 'Content-Type': 'application/json' } : {}),
        },
        // Las rutas con muchas zonas a evitar pueden tardar más de 10 segundos.
        signal: AbortSignal.timeout(Math.max(1_000, Math.min(40_000, plazo - Date.now()))),
      });
    } catch (error) {
      // Solo el código del error de red, nunca la URL ni el cuerpo (llevan direcciones o coordenadas).
      console.warn(`Conexión con OpenRouteService falló (intento ${intento}): ${error.cause?.code ?? error.name}`);
      // Sin tiempo para otro intento: se avisa como demora, que el planificador puede tolerar.
      if (plazo - Date.now() < 3_000) {
        throw new ErrorServicio('OpenRouteService está tardando más de lo normal. Intenta otra vez en un momento.', 504, 'tiempo');
      }
      if (intento >= 2) {
        throw new ErrorServicio('No pude conectarme con OpenRouteService. Revisa tu conexión a internet.', 502, 'red');
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
  }

  const texto = await respuesta.text();
  let json = null;
  try {
    json = JSON.parse(texto);
  } catch {
    // Algunas respuestas de error no son JSON.
  }
  if (respuesta.ok && json) return json;

  const codigo = json?.error?.code ?? null;
  if (respuesta.status === 401 || respuesta.status === 403) {
    throw new ErrorServicio('OpenRouteService rechazó la key. Revisa ORS_API_KEY en el archivo .env.', 502, 'key_invalida');
  }
  if (respuesta.status === 429) {
    throw new ErrorServicio('Se alcanzó el límite de consultas gratuitas de OpenRouteService. Espera un minuto e intenta otra vez.', 429, 'limite');
  }
  if (codigo === 2010) {
    throw new ErrorServicio('No encontré una calle cerca de uno de los puntos. Muévelo un poco hacia una calle.', 422, codigo);
  }
  if (codigo === 2009) {
    throw new ErrorServicio('No encontré una ruta entre esos dos puntos.', 422, codigo);
  }
  throw new ErrorServicio(
    `OpenRouteService respondió con un error (${respuesta.status}${codigo ? `, código ${codigo}` : ''}).`,
    502,
    codigo,
  );
}

// Devuelve un FeatureCollection GeoJSON con una o varias rutas.
export function pedirRutas(perfil, cuerpo, limiteMs) {
  return pedir(`${RUTAS}/directions/${perfil}/geojson`, { method: 'POST', body: JSON.stringify(cuerpo) }, limiteMs);
}

function parametrosLima(limites) {
  return {
    'boundary.country': 'PE',
    'boundary.rect.min_lon': limites.oeste,
    'boundary.rect.min_lat': limites.sur,
    'boundary.rect.max_lon': limites.este,
    'boundary.rect.max_lat': limites.norte,
  };
}

const aLugar = (f) => ({
  etiqueta: f.properties.label,
  lon: f.geometry.coordinates[0],
  lat: f.geometry.coordinates[1],
  exacto: f.properties.layer === 'address',
  tipo: f.properties.layer,
});

export async function geocodificar(texto, limites) {
  const q = new URLSearchParams({
    text: texto,
    size: '5',
    'focus.point.lat': '-12.06',
    'focus.point.lon': '-77.03',
    ...parametrosLima(limites),
  });
  const json = await pedir(`${GEOCODING}/search?${q}`);
  return (json.features ?? []).map(aLugar);
}

// Sugerencias mientras se escribe: lugares, calles y zonas, como en Google Maps o Waze.
export async function autocompletar(texto, limites) {
  const q = new URLSearchParams({ text: texto, size: '6', 'focus.point.lat': '-12.09', 'focus.point.lon': '-77.03', ...parametrosLima(limites) });
  const json = await pedir(`${GEOCODING}/autocomplete?${q}`);
  return (json.features ?? []).map((f) => {
    const p = f.properties;
    return {
      ...aLugar(f),
      nombre: p.name,
      zona: [p.neighbourhood, p.locality ?? p.localadmin].filter(Boolean).join(', '),
      exacto: ['address', 'venue'].includes(p.layer),
    };
  });
}

export async function geocodificarInverso(lat, lon) {
  const q = new URLSearchParams({ 'point.lat': lat, 'point.lon': lon, size: '1', 'boundary.country': 'PE' });
  const json = await pedir(`${GEOCODING}/reverse?${q}`);
  const f = json.features?.[0];
  return f ? aLugar(f) : null;
}
