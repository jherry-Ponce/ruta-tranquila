import { fusionarVias } from './lib/fusionar-vias.js';
import { convertirVia } from './lib/convertir-osm.js';
// Descarga desde OpenStreetMap (Overpass API) las vías principales de Lima y Callao,
// más los puentes y túneles de calles menores, y las guarda en data/vias-principales-lima.json.
// Uso: npm run datos

import { gzipSync, gunzipSync } from 'node:zlib';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import config from '../config/tranquilidad.js';

const SERVIDORES = [
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass-api.de/api/interpreter',
];
const SALIDA = fileURLToPath(new URL('../data/vias-principales-lima.json', import.meta.url));

const { sur, oeste, norte, este } = config.limitesLima;
const bbox = `${sur},${oeste},${norte},${este}`;
const menores = '^(tertiary|tertiary_link|unclassified|residential|service|living_street|road)$';

const consulta = `[out:json][timeout:240];
(
  way["highway"~"^(motorway|trunk|primary|secondary)(_link)?$"](${bbox});
  way["highway"="cycleway"](${bbox});
  way["highway"][~"^cycleway(:left|:right|:both)?$"~"^(track|lane|opposite_track|opposite_lane|shared_lane|share_busway)$"](${bbox});
  way["highway"~"^(path|footway|pedestrian)$"]["bicycle"="designated"](${bbox});
  node["highway"="traffic_signals"](${bbox});
  way["highway"~"${menores}"]["bridge"]["bridge"!="no"](${bbox});
  way["highway"~"${menores}"]["tunnel"]["tunnel"!="no"](${bbox});
);
out body geom qt;`;

// Overpass pide reintentar con espera creciente cuando está saturado.
async function consultarOverpass() {
  let espera = 10;
  for (let intento = 1; intento <= 6; intento++) {
    const servidor = SERVIDORES[(intento - 1) % SERVIDORES.length];
    console.log(`Intento ${intento}: consultando ${new URL(servidor).host} (puede tardar uno o dos minutos)...`);
    try {
      const respuesta = await fetch(servidor, {
        method: 'POST',
        signal: AbortSignal.timeout(90000),
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'RutaTranquila/0.1 (descarga de vias principales de Lima)',
        },
        body: new URLSearchParams({ data: consulta }),
      });
      if (respuesta.ok) {
        const datos = await respuesta.json();
        if (datos.remark || !Array.isArray(datos.elements) || !datos.elements.some((e) => e.type === 'way')) throw new Error('OSM devolvió datos incompletos');
        return datos;
      }
      console.warn(`  Respondió ${respuesta.status}.`);
    } catch (error) {
      console.warn(`  Falló la conexión: ${error.message}`);
    }
    if (intento < 6) {
      console.warn(`  Reintento en ${espera} s.`);
      await new Promise((r) => setTimeout(r, espera * 1000));
      espera = Math.min(60, espera * 2);
    }
  }
  console.error('Overpass no respondió. Vuelve a intentar más tarde con: npm run datos');
  process.exit(1);
}

const archivoLocal = process.argv[2] === '--desde' ? process.argv[3] : null;
const json = archivoLocal
  ? JSON.parse(gunzipSync(await readFile(archivoLocal)).toString('utf8'))
  : await consultarOverpass();
if (json.remark || !Array.isArray(json.elements) || !json.elements.some((e) => e.type === 'way')) throw new Error('El archivo OSM está incompleto');
const semaforosPorId = new Map(json.elements.filter((e) => e.type === 'node' && e.tags?.highway === 'traffic_signals').map((e) => [e.id, [e.lon, e.lat]]));
let vias = json.elements
  .filter((e) => e.type === 'way' && e.geometry?.length >= 2)
  .map((e) => convertirVia(e, semaforosPorId));

// Conserva el original para auditar etiquetas y reprocesar sin volver a consultar OSM.
const respaldo = new URL('../referencias/osm-lima-original.json.gz', import.meta.url);
await mkdir(fileURLToPath(new URL('../referencias/', import.meta.url)), { recursive: true });
await writeFile(respaldo, gzipSync(JSON.stringify(json)));


let anterior = null;
try { anterior = JSON.parse(await readFile(SALIDA, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
const atrasada = anterior?.datosOsm && json.osm3s?.timestamp_osm_base < anterior.datosOsm;
if (atrasada) {
  console.warn('La réplica OSM está atrasada: se conserva la red vial reciente y se agregan solo datos ciclistas.');
  vias = fusionarVias(anterior.vias, vias);
}
// Revisión puntual actual del corredor: conserva los originales y no extrapola a otras calles.
let revisionCorredor = null;
try {
  const original = JSON.parse(gunzipSync(await readFile(new URL('../referencias/osm-corredor-magdalena.json.gz', import.meta.url))).toString('utf8'));
  const nodos = new Map(original.elements.filter((e) => e.type === 'node').map((e) => [e.id, e]));
  const ciclistas = original.elements.filter((e) => e.type === 'way' && e.tags?.highway).map((e) => ({ ...e, geometry: e.nodes.map((id) => nodos.get(id)).filter(Boolean) })).filter((e) => e.geometry.length === e.nodes.length && e.geometry.length >= 2).map((e) => convertirVia(e));
  vias = fusionarVias(vias, ciclistas);
  revisionCorredor = 'referencias/osm-corredor-magdalena.json.gz';
} catch (error) { if (error.code !== 'ENOENT') throw error; }
const datos = {
  generado: new Date().toISOString(),
  fuente: '© Colaboradores de OpenStreetMap (licencia ODbL), descargado con Overpass API',
  datosOsm: atrasada ? anterior.datosOsm : json.osm3s?.timestamp_osm_base ?? null,
  datosInfraBici: json.osm3s?.timestamp_osm_base ?? null,
  revisionCorredor,
  limites: config.limitesLima,
  vias,
};

await mkdir(path.dirname(SALIDA), { recursive: true });
const texto = JSON.stringify(datos);
await writeFile(SALIDA, texto);

const conteo = {};
for (const v of vias) {
  const clave = v.d && v.c === 'menor' ? 'puentes/túneles menores' : v.c;
  conteo[clave] = (conteo[clave] ?? 0) + 1;
}
console.log(`Guardadas ${vias.length} vías en ${path.relative(process.cwd(), SALIDA)} (${(texto.length / 1e6).toFixed(1)} MB)`);
console.log(conteo);
