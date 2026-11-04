// Descarga desde OpenStreetMap (Overpass API) las vías principales de Lima y Callao,
// más los puentes y túneles de calles menores, y las guarda en data/vias-principales-lima.json.
// Uso: npm run datos

import { writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import config from '../config/tranquilidad.js';

const SERVIDORES = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];
const SALIDA = fileURLToPath(new URL('../data/vias-principales-lima.json', import.meta.url));

const CLASES = {
  motorway: 'autopista',
  trunk: 'autopista',
  primary: 'primaria',
  secondary: 'secundaria',
  cycleway: 'ciclovia',
};

const { sur, oeste, norte, este } = config.limitesLima;
const bbox = `${sur},${oeste},${norte},${este}`;
const menores = '^(tertiary|tertiary_link|unclassified|residential|service|living_street|road)$';

const consulta = `[out:json][timeout:240];
(
  way["highway"~"^(motorway|trunk|primary|secondary)(_link)?$"](${bbox});
  way["highway"="cycleway"](${bbox});
  way["highway"~"${menores}"]["bridge"]["bridge"!="no"](${bbox});
  way["highway"~"${menores}"]["tunnel"]["tunnel"!="no"](${bbox});
);
out tags geom qt;`;

function esDesnivel(tags) {
  const puente = tags.bridge && tags.bridge !== 'no';
  const tunel = tags.tunnel && tags.tunnel !== 'no';
  const capa = tags.layer && tags.layer !== '0';
  return Boolean(puente || tunel || capa);
}

function convertir(elemento) {
  const tags = elemento.tags ?? {};
  const base = tags.highway.replace(/_link$/, '');
  const via = {
    n: tags.name ?? '',
    c: CLASES[base] ?? 'menor',
    g: elemento.geometry.map((p) => [Number(p.lon.toFixed(6)), Number(p.lat.toFixed(6))]),
  };
  if (tags.highway.endsWith('_link')) via.r = 1;
  if (esDesnivel(tags)) via.d = 1;
  // Las ciclovías que forman parte de una calzada principal se marcan como ramal para
  // no confundirlas con ciclovías independientes al hacer el snap.
  if (base === 'cycleway' && (tags.cycleway || tags['cycleway:right'] || tags['cycleway:left'])) via.r = 1;
  return via;
}

// Overpass pide reintentar con espera creciente cuando está saturado.
async function consultarOverpass() {
  let espera = 10;
  for (let intento = 1; intento <= 6; intento++) {
    const servidor = SERVIDORES[(intento - 1) % SERVIDORES.length];
    console.log(`Intento ${intento}: consultando ${new URL(servidor).host} (puede tardar uno o dos minutos)...`);
    try {
      const respuesta = await fetch(servidor, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'RutaTranquila/0.1 (descarga de vias principales de Lima)',
        },
        body: new URLSearchParams({ data: consulta }),
      });
      if (respuesta.ok) return await respuesta.json();
      console.warn(`  Respondió ${respuesta.status}.`);
    } catch (error) {
      console.warn(`  Falló la conexión: ${error.message}`);
    }
    if (intento < 6) {
      console.warn(`  Reintento en ${espera} s.`);
      await new Promise((r) => setTimeout(r, espera * 1000));
      espera *= 2;
    }
  }
  console.error('Overpass no respondió. Vuelve a intentar más tarde con: npm run datos');
  process.exit(1);
}

const json = await consultarOverpass();
const vias = json.elements
  .filter((e) => e.type === 'way' && e.geometry?.length >= 2)
  .map(convertir);

const datos = {
  generado: new Date().toISOString(),
  fuente: '© Colaboradores de OpenStreetMap (licencia ODbL), descargado con Overpass API',
  datosOsm: json.osm3s?.timestamp_osm_base ?? null,
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
