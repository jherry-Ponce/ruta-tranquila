// Descarga de OpenStreetMap (Overpass API) los estacionamientos de Lima y Callao (autos, motos y bicis)
// y los guarda en data/estacionamientos-lima.json, para sugerir dónde estacionar al llegar.
// Uso: npm run datos:estacionamientos            (consulta Overpass)
//      npm run datos:estacionamientos -- --desde referencias/osm-estacionamientos-original.json.gz   (sin red)

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { gzipSync, gunzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import config from '../config/tranquilidad.js';
import { convertirEstacionamientos } from '../server/estacionamientos.js';

const SERVIDORES = [
  'https://overpass-api.de/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];
const SALIDA = fileURLToPath(new URL('../data/estacionamientos-lima.json', import.meta.url));
const { sur, oeste, norte, este } = config.limitesLima;
const consulta = `[out:json][timeout:180];
nwr["amenity"~"^(parking|motorcycle_parking|bicycle_parking)$"](${sur},${oeste},${norte},${este});
out tags center qt;`;

async function consultarOverpass() {
  for (let intento = 1; intento <= 6; intento++) {
    const servidor = SERVIDORES[(intento - 1) % SERVIDORES.length];
    console.log(`Intento ${intento}: consultando ${new URL(servidor).host}...`);
    try {
      const respuesta = await fetch(servidor, {
        method: 'POST',
        signal: AbortSignal.timeout(190_000),
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'VoyTranqui/1.0 (estacionamientos de Lima)' },
        body: new URLSearchParams({ data: consulta }),
      });
      if (respuesta.ok) {
        const datos = await respuesta.json();
        if (!datos.remark && Array.isArray(datos.elements)) return datos;
        console.warn('  OSM devolvió datos incompletos.');
      } else console.warn(`  Respondió ${respuesta.status}.`);
    } catch (error) {
      console.warn(`  Falló la conexión: ${error.message}`);
    }
    await new Promise((r) => setTimeout(r, Math.min(60, 10 * intento) * 1000));
  }
  console.error('Overpass no respondió. Vuelve a intentar más tarde.');
  process.exit(1);
}

const archivoLocal = process.argv[2] === '--desde' ? process.argv[3] : null;
const RESPALDO = fileURLToPath(new URL('../referencias/osm-estacionamientos-original.json.gz', import.meta.url));
let json;
if (archivoLocal) {
  const contenido = await readFile(archivoLocal);
  json = JSON.parse((archivoLocal.endsWith('.gz') ? gunzipSync(contenido) : contenido).toString('utf8'));
} else {
  json = await consultarOverpass();
}
// Conserva la respuesta original para reprocesar sin volver a consultar OSM.
if (!archivoLocal || !archivoLocal.endsWith('.gz')) await writeFile(RESPALDO, gzipSync(JSON.stringify(json)));
const lugares = convertirEstacionamientos(json.elements);
const datos = {
  generado: new Date().toISOString(),
  fuente: '© Colaboradores de OpenStreetMap (licencia ODbL), descargado con Overpass API',
  datosOsm: json.osm3s?.timestamp_osm_base ?? null,
  // Cada lugar: [lat, lon, tipo (a = autos, m = motos, b = bicis), nombre, pago (1 sí, 0 no, null sin dato), solo clientes (1), sin motos (1)]
  lugares,
};
await mkdir(path.dirname(SALIDA), { recursive: true });
await writeFile(SALIDA, JSON.stringify(datos));
const conteo = lugares.reduce((c, l) => ({ ...c, [l[2]]: (c[l[2]] ?? 0) + 1 }), {});
console.log(`Guardados ${lugares.length} estacionamientos en ${path.relative(process.cwd(), SALIDA)}:`, conteo);
