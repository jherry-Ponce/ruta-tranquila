import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aGrados, aMetros, IndiceSegmentos } from '../server/geo.js';
import { snapACiclovia } from '../server/snap-ciclovia.js';

// Una ciclovía de oeste a este y, 80 m al norte, una avenida paralela (o una calle menor).
function redDePrueba(claseParalela = 'primaria') {
  const ciclovia = [aMetros([-77.03, -12.05]), aMetros([-77.029, -12.05])];
  const paralela = ciclovia.map(([x, y]) => [x, y + 80]);
  const indiceCiclovias = new IndiceSegmentos(150);
  indiceCiclovias.agregar(ciclovia[0], ciclovia[1], 0);
  const indice = new IndiceSegmentos(150);
  indice.agregar(paralela[0], paralela[1], 4096);
  return {
    vias: [
      { nombre: 'Ciclovía de prueba', clase: 'ciclovia', ramal: false, puntos: ciclovia },
      { nombre: 'Avenida de prueba', clase: claseParalela, ramal: false, puntos: paralela },
    ],
    indice,
    indiceCiclovias,
  };
}

const sobreLaParalela = (red, dx = 40) => {
  const [lon, lat] = aGrados([red.vias[1].puntos[0][0] + dx, red.vias[1].puntos[0][1]]);
  return { lon, lat };
};

test('saliendo por una avenida, ubica la ciclovía más cercana a distancia caminable', () => {
  const red = redDePrueba();

  const snap = snapACiclovia(sobreLaParalela(red), red);

  assert.ok(snap);
  assert.equal(snap.nombre, 'Ciclovía de prueba');
  assert.equal(snap.distanciaCaminata, 80);
  assert.equal(snap.minutosCaminata, 1);
  const [x, y] = aMetros([snap.lon, snap.lat]);
  assert.ok(Math.abs(x - (red.vias[0].puntos[0][0] + 40)) < 0.001);
  assert.ok(Math.abs(y - red.vias[0].puntos[0][1]) < 0.001);
});

test('no ajusta un punto que ya está sobre la ciclovía ni uno demasiado lejano', () => {
  const red = redDePrueba();

  assert.equal(snapACiclovia({ lon: -77.0295, lat: -12.05 }, red), null);
  assert.equal(snapACiclovia({ lon: -77.0295, lat: -12.046 }, red), null);
});

test('saliendo de una calle tranquila, no obliga a caminar hasta la ciclovía', () => {
  const red = redDePrueba('menor');

  assert.equal(snapACiclovia(sobreLaParalela(red), red), null);
});

test('no ajusta si la ciclovía queda en sentido contrario al destino', () => {
  const red = redDePrueba();
  const origen = sobreLaParalela(red);
  const [lon, lat] = aGrados(aMetros([origen.lon, origen.lat]).map((v, i) => (i ? v + 2000 : v)));

  assert.equal(snapACiclovia(origen, red, { lon, lat }), null);
  assert.ok(snapACiclovia(origen, red, { lon, lat: lat - 0.04 }));
});
