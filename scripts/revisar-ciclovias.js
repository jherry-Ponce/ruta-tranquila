// Auditoría reproducible del corredor reportado por el usuario, sin inferir infraestructura ausente.
import { readFile, writeFile } from 'node:fs/promises';
const datos = JSON.parse(await readFile(new URL('../data/vias-principales-lima.json', import.meta.url), 'utf8'));
const tipos = {};
for (const via of datos.vias) for (const tipo of new Set((via.b ?? (via.c === 'ciclovia' ? [{ tipo: 'separada' }] : [])).map((b) => b.tipo))) tipos[tipo] = (tipos[tipo] ?? 0) + 1;
const nombres = [/gonz[aá]le[sz] prada/i, /incl[aá]n/i, /grau/i];
const corredor = datos.vias.filter((v) => nombres.some((n) => n.test(v.n)) && v.g.some(([lon, lat]) => lon > -77.11 && lon < -77.05 && lat > -12.11 && lat < -12.07)).map((v) => ({
  idOsm: v.o ?? null, nombre: v.n, claseCalzada: v.c, infraestructura: v.b ?? [],
  enlaceOsm: v.o ? 'https://www.openstreetmap.org/way/' + v.o : null,
}));
const revision = {
  generado: new Date().toISOString(), datosOsm: datos.datosOsm, datosInfraBici: datos.datosInfraBici, revisionCorredor: datos.revisionCorredor,
  alcance: 'Etiquetas OSM en Lima y Callao. El conteo es de objetos, no de kilómetros ni de ciclovías completas.',
  limite: 'La auditoría de nombres no acredita continuidad, acceso ni estado físico de las conexiones.',
  conteoPorTipo: tipos, corredor,
};
await writeFile(new URL('../data/revision-ciclovias-magdalena.json', import.meta.url), JSON.stringify(revision, null, 2) + '\n');
console.log(JSON.stringify(revision, null, 2));
