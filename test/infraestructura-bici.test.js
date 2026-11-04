import { test } from 'node:test';
import assert from 'node:assert/strict';
import { infraestructuraBici } from '../server/infraestructura-bici.js';
import { convertirVia } from '../scripts/lib/convertir-osm.js';
import { analizarRuta } from '../server/analisis.js';
import { aGrados, IndiceSegmentos } from '../server/geo.js';
import { calcularPuntaje } from '../server/puntaje.js';
import cfg from '../config/tranquilidad.js';

function redDe(tags) {
  const puntos = [[0, 0], [200, 0]];
  const via = { clase: tags.highway === 'secondary' ? 'secundaria' : tags.highway === 'cycleway' ? 'ciclovia' : 'residencial', nombre: 'Prueba', puntos, infraestructura: infraestructuraBici(tags) };
  const indice = new IndiceSegmentos(150);
  const indiceInfraBici = new IndiceSegmentos(150);
  if (via.clase !== 'ciclovia') indice.agregar(...puntos, 0);
  if (via.infraestructura.length) indiceInfraBici.agregar(...puntos, 0);
  return { vias: [via], indice, indiceInfraBici };
}
function analizar(tags, vehiculo = 'bici', invertir = false, offset = 0, waytype = 3) {
  const red = redDe(tags);
  let coords = [[0, offset], [100, offset], [200, offset]].map(aGrados);
  if (invertir) coords = coords.reverse();
  return analizarRuta(coords, [[0, 2, waytype]], red, vehiculo);
}

test('interpreta ciclovías separadas, carriles y espacios compartidos sin equipararlos', () => {
  assert.equal(infraestructuraBici({ highway: 'secondary', 'cycleway:right': 'track' })[0].tipo, 'separada');
  assert.equal(infraestructuraBici({ highway: 'residential', cycleway: 'lane' })[0].tipo, 'carril');
  assert.equal(infraestructuraBici({ highway: 'residential', cycleway: 'shared_lane' })[0].tipo, 'compartida');
  assert.equal(infraestructuraBici({ highway: 'path', bicycle: 'designated', foot: 'designated', segregated: 'no' })[0].tipo, 'sendaCompartida');
});
test('no inventa ciclovías a partir de separate, no, proposed o acceso prohibido', () => {
  for (const valor of ['separate', 'no', 'yes', 'proposed']) assert.deepEqual(infraestructuraBici({ highway: 'residential', cycleway: valor }), []);
  for (const bicycle of ['no', 'dismount', 'private']) assert.deepEqual(infraestructuraBici({ highway: 'cycleway', bicycle }), []);
});
test('conserva identidad OSM y la clase de la calzada al descargar', () => {
  const via = convertirVia({ id: 42, tags: { highway: 'secondary', name: 'Inclán', 'cycleway:right': 'lane' }, geometry: [{lon: -77.1, lat: -12.1}, {lon: -77.11, lat: -12.1}] });
  assert.equal(via.o, 42); assert.equal(via.c, 'secundaria'); assert.equal(via.b[0].tipo, 'carril');
});
test('clasifica carriles para bici sin convertir una avenida en ciclovía para auto o moto', () => {
  const tags = { highway: 'secondary', 'cycleway:right': 'lane' };
  assert.ok(analizar(tags).metrosPorClase.carrilBici > 190);
  for (const vehiculo of ['auto', 'motoElectrica']) assert.ok(analizar(tags, vehiculo).metrosPorClase.secundaria > 190);
});
test('respeta el sentido de la infraestructura y no asigna un carril a una vereda paralela', () => {
  const tags = { highway: 'residential', 'cycleway:right': 'lane' };
  assert.equal(analizar(tags, 'bici', true).metrosPorClase.carrilBici, undefined);
  assert.equal(analizar(tags, 'bici', false, 15).metrosPorClase.carrilBici, undefined);
  assert.equal(analizar(tags, 'bici', false, 0, 7).metrosPorClase.carrilBici, undefined);
  assert.ok(analizar({ ...tags, 'cycleway:right:oneway': 'no' }, 'bici', true).metrosPorClase.carrilBici > 190);
});
test('compartir calzada conserva el riesgo de avenida y los carriles no reciben bono protegido', () => {
  assert.ok(analizar({ highway: 'secondary', cycleway: 'shared_lane' }).metrosPorClase.secundaria > 190);
  const carril = analizar({ highway: 'residential', cycleway: 'lane' });
  const separada = analizar({ highway: 'residential', cycleway: 'track' });
  const p = calcularPuntaje(carril, null, cfg, 'bici');
  assert.equal(p.desglose.ciclovias, 0); assert.ok(p.valor < calcularPuntaje(separada, null, cfg, 'bici').valor);
  assert.equal(Object.values(p.porcentajes).reduce((s,v) => s + v, 0), 100);
});

test('las etiquetas laterales reemplazan a both y respetan no y separate', () => {
  const ambos = infraestructuraBici({ highway: 'residential', 'cycleway:both': 'lane', 'cycleway:left': 'no' });
  assert.equal(ambos.length, 1); assert.equal(ambos[0].lado, 'right'); assert.equal(ambos[0].sentido, 1);
  const lateral = infraestructuraBici({ highway: 'residential', 'cycleway:both': 'lane', 'cycleway:right': 'separate' });
  assert.equal(lateral.length, 1); assert.equal(lateral[0].lado, 'left');
});

test('el sentido único de bicicletas prevalece sobre el lado izquierdo de la calzada', () => {
  const tags = { highway: 'residential', oneway: 'yes', 'oneway:bicycle': 'yes', 'cycleway:left': 'track' };
  assert.equal(infraestructuraBici(tags)[0].sentido, 1);
  assert.ok(analizar(tags).metrosPorClase.ciclovia > 190);
  assert.equal(analizar(tags, 'bici', true).metrosPorClase.ciclovia, undefined);
});
test('la red descargada contiene las ciclovías reportadas de González Prada, Inclán y Grau', async () => {
  const { cargarRed } = await import('../server/vias.js');
  const red = cargarRed();
  for (const id of [24306502, 24306573, 284892467]) {
    const via = red.vias.find((v) => v.idOsm === id);
    assert.ok(via, 'Falta vía OSM ' + id);
    assert.ok(via.infraestructura.some((b) => b.tipo === 'separada'));
    const r = analizarRuta(via.puntos.map(aGrados), [[0, via.puntos.length - 1, 3]], red, 'bici');
    assert.ok((r.metrosPorClase.ciclovia ?? 0) / r.distancia > 0.9, via.nombre);
  }
});
test('una réplica atrasada agrega ciclovías sin reemplazar avenidas ni semáforos recientes', async () => {
  const { fusionarVias } = await import('../scripts/lib/fusionar-vias.js');
  const actual = { o: 1, n: 'Avenida', c: 'primaria', s: [[1, 2]], g: [[0, 0], [1, 1]] };
  const antigua = { ...actual, c: 'secundaria', s: [], b: [{ tipo: 'carril' }] };
  const extra = { ...antigua, o: 2, n: 'Inclán' };
  const fusion = fusionarVias([actual], [antigua, extra]);
  assert.equal(fusion[0].c, 'primaria'); assert.deepEqual(fusion[0].s, [[1, 2]]);
  assert.deepEqual(fusion[0].b, antigua.b); assert.equal(fusion[1].x, 1);
  assert.equal(fusionarVias(fusion, [antigua, extra]).length, 2);
});
