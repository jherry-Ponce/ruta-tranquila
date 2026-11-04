// Genera rutas candidatas, las puntúa y elige la más tranquila, la más rápida y una alternativa.
//
// OpenRouteService no permite pedir "evita avenidas", así que se piden varias rutas con driving-car:
// - la más rápida y sus alternativas;
// - sin recorrer avenidas grandes (zonas a evitar sobre primarias, troncales y autopistas), "fastest" y "shortest";
// - sin recorrer avenidas grandes ni medianas, "shortest".
// Se probó también el perfil cycling-regular, pero en Lima sigue las ciclovías de las avenidas y, recalculado
// para auto, terminaba en vías rápidas; por eso no se usa.

import { pedirRutas, ErrorServicio } from './ors.js';
import { zonasAEvitar } from './zonas.js';
import { medirTrafico, hayKeyTomTom } from './trafico.js';
import { analizarRuta, tramosPorClase } from './analisis.js';
import { calcularPuntaje } from './puntaje.js';
import { armarPasos, abreviar, formatoDistancia, avisoCruce } from './pasos.js';
import { evaluarHorario } from './horario.js';
import { aMetros, distancia, fraccionCompartida } from './geo.js';
import { analizarGiros } from './giros.js';
import { snapACiclovia } from './snap-ciclovia.js';

const ALTERNATIVAS = { target_count: 3, weight_factor: 1.6, share_factor: 0.6 };
const BASE = { extra_info: ['waytype'], instructions: true, language: 'es', units: 'm' };
const ERRORES_DEFINITIVOS = new Set(['sin_key', 'key_invalida', 'limite', 'red', 2009, 2010]);

const NOMBRE_CLASE = { autopista: 'vía rápida', primaria: 'avenida grande', secundaria: 'avenida mediana' };
const CONSEJO_TRAMO = {
  autopista: 'Vía rápida: los vehículos van muy rápido. Si recién empiezas, evítala o ve acompañado.',
  primaria: 'Avenida grande: ve por el carril derecho, a velocidad constante y con distancia.',
  secundaria: 'Avenida mediana: atento a combis y buses que se detienen y a autos que giran.',
};

// Pasa una ruta GeoJSON de ORS a un formato interno.
function leerRuta(feature, origen) {
  const props = feature.properties;
  const pasos = props.segments.flatMap((segmento) => segmento.steps ?? []);
  const coordenadas = feature.geometry.coordinates.map(([lon, lat]) => [lon, lat]);
  return {
    origen,
    coordenadas,
    metros: coordenadas.map(aMetros),
    distancia: props.summary?.distance ?? 0,
    duracion: props.summary?.duration ?? 0,
    pasos,
    waytype: props.extras?.waytype?.values ?? [],
  };
}

async function conAlternativas(perfil, cuerpo, origen) {
  try {
    const fc = await pedirRutas(perfil, { ...cuerpo, alternative_routes: ALTERNATIVAS });
    return fc.features.map((f, i) => leerRuta(f, i === 0 ? origen : `${origen}-alt${i}`));
  } catch (error) {
    // Las rutas alternativas tienen límites propios (por ejemplo de distancia); se reintenta sin ellas.
    if (ERRORES_DEFINITIVOS.has(error.codigo)) throw error;
    const fc = await pedirRutas(perfil, cuerpo);
    return fc.features.map((f) => leerRuta(f, origen));
  }
}

// Una ruta que evita recorrer ciertas clases de vía. Si ORS la rechaza (por ejemplo porque las zonas
// dejan aislado un punto), se descarta sin cortar la búsqueda.
async function sinAvenidas(cuerpo, red, extremos, clases, preference, origen, perfil = 'driving-car') {
  const zonas = clases.size ? zonasAEvitar(red, extremos, clases) : [];
  const opciones = zonas.length ? { avoid_polygons: { type: 'MultiPolygon', coordinates: zonas } } : {};
  if (perfil !== 'driving-car') opciones.avoid_features = ['steps'];
  try {
    const fc = await pedirRutas(perfil, { ...cuerpo, preference, options: opciones });
    return { ruta: leerRuta(fc.features[0], origen) };
  } catch (error) {
    if (ERRORES_DEFINITIVOS.has(error.codigo) && error.codigo !== 2009 && error.codigo !== 2010) throw error;
    return { descartada: `${origen}: ORS no pudo calcularla (${error.message})` };
  }
}

const sonIguales = (a, b) => fraccionCompartida(a.metros, b.metros) > 0.9 && fraccionCompartida(b.metros, a.metros) > 0.9;

function kmEnRuta(ruta, lon, lat) {
  const p = aMetros([lon, lat]);
  let mejor = 0;
  let menor = Infinity;
  ruta.metros.forEach((q, i) => {
    const d = distancia(p, q);
    if (d < menor) {
      menor = d;
      mejor = i;
    }
  });
  return ruta.analisis.acumulado[mejor] / 1000;
}

function puntosCriticos(ruta, vehiculo, snapInicio) {
  const { tramos, cruces, distancia: total } = ruta.analisis;
  // En bici o monopatín, una avenida al salir o al llegar se recorre a pie, empujando, hasta la
  // ciclovía o calle tranquila más cercana: es más seguro que meterse a la avenida.
  const aPie = (t) => vehiculo === 'bici' && t.longitud <= 400 && (t.desde < 300 || total - t.hasta < 300);
  const lista = [
    ...tramos.filter(aPie).map((t) => ({
      tipo: 'tramo',
      clase: t.clase,
      titulo: `Camina ${formatoDistancia(t.longitud)} empujando la bici por ${t.nombres.map(abreviar).join(' y ') || 'la avenida'}`,
      detalle: 'Bájate y ve por la vereda hasta la ciclovía o la calle tranquila más cercana; no vayas por la pista de la avenida.',
      lon: t.punto[0],
      lat: t.punto[1],
      km: t.desde / 1000,
    })),
    ...tramos.filter((t) => !aPie(t)).map((t) => ({
      tipo: 'tramo',
      clase: t.clase,
      titulo: `Tramo de ${formatoDistancia(t.longitud)} por ${t.nombres.length ? t.nombres.map(abreviar).join(' y ') : `una ${NOMBRE_CLASE[t.clase]}`}`,
      detalle: CONSEJO_TRAMO[t.clase],
      lon: t.punto[0],
      lat: t.punto[1],
      km: t.desde / 1000,
    })),
    ...cruces.map((c) => ({
      tipo: 'cruce',
      clase: c.clase,
      titulo: `Cruce con ${c.nombres.length ? c.nombres.map(abreviar).join(' y ') : `una ${NOMBRE_CLASE[c.clase]}`}`,
      detalle: avisoCruce(c),
      lon: c.punto[0],
      lat: c.punto[1],
      km: c.en / 1000,
    })),
  ];
  if (ruta.trafico?.confiable) {
    for (const t of ruta.trafico.tramos) {
      const minutos = Math.round(t.retrasoSegundos / 60);
      lista.push({
        tipo: 'trafico',
        clase: 'trafico',
        titulo: `${t.categoria}${t.velocidadKmh ? ` (${Math.round(t.velocidadKmh)} km/h)` : ''}`,
        detalle: `Según TomTom, ahora mismo${minutos >= 1 ? ` hay unos ${minutos} min de demora aquí` : ' hay tráfico aquí'}. Ten paciencia y guarda distancia.`,
        lon: t.lon,
        lat: t.lat,
        km: kmEnRuta(ruta, t.lon, t.lat),
      });
    }
  }

  // Aviso de caminata al inicio cuando el snap mueve el origen a la ciclovía.
  if (snapInicio) {
    lista.unshift({
      tipo: 'caminata',
      clase: 'caminata',
      titulo: `Camina ${formatoDistancia(snapInicio.distanciaCaminata)} hasta la ciclovía${snapInicio.nombre ? ` (${abreviar(snapInicio.nombre)})` : ''}`,
      detalle: `Sales junto a una avenida: antes de montar, ve a pie por la vereda (unos ${snapInicio.minutosCaminata} min) hasta la entrada de la ciclovía. La ruta comienza ahí.`,
      lon: snapInicio.origenLon,
      lat: snapInicio.origenLat,
      km: 0,
    });
  }
  return lista.sort((a, b) => a.km - b.km).map((p) => ({ ...p, metros: Math.round(p.km * 1000), km: Math.round(p.km * 10) / 10 }));
}

function enlaceGoogleMaps(ruta) {
  const c = ruta.coordenadas;
  const { acumulado, distancia: total } = ruta.analisis;
  const fmt = ([lon, lat]) => `${lat.toFixed(5)},${lon.toFixed(5)}`;
  const q = new URLSearchParams({ api: '1', origin: fmt(c[0]), destination: fmt(c.at(-1)), travelmode: 'driving' });
  // En el navegador del celular Google Maps acepta como máximo 3 puntos de paso.
  if (total > 1500) {
    const puntos = [0.25, 0.5, 0.75].map((f) => c[Math.max(0, acumulado.findIndex((s) => s >= f * total))]);
    q.set('waypoints', puntos.map(fmt).join('|'));
  }
  return `https://www.google.com/maps/dir/?${q}`;
}

function resumen(ruta, nota) {
  return {
    origen: ruta.origen,
    km: Math.round(ruta.distancia / 100) / 10,
    minutos: Math.round((ruta.duracion + (ruta.caminataSegundos ?? 0)) / 60),
    puntaje: ruta.puntaje?.valor ?? null,
    cruces: ruta.analisis?.cruces.length ?? null,
    nota,
  };
}

export async function planificar({ origen, destino, salida, depurar, vehiculo = 'auto', nivel = 'principiante' }, { red, cfg }) {
  // En modo bici, si la salida está sobre una avenida, se ajusta el origen a una ciclovía cercana. No se ajusta el destino:
  // la ciclovía geométricamente más cercana puede ser una vía costera o aislada y obligar a ORS
  // a dar una vuelta larga para entrar en ella. ORS debe calcular el último tramo al destino real.
  let origenRuta = origen;
  let destinoRuta = destino;
  let snapInicio = null;
  if (vehiculo === 'bici') {
    const sO = snapACiclovia(origen, red, destino);
    if (sO) {
      snapInicio = { ...sO, origenLon: origen.lon, origenLat: origen.lat };
      origenRuta = { lon: sO.lon, lat: sO.lat };
    }
  }

  const extremos = [
    [origenRuta.lon, origenRuta.lat],
    [destinoRuta.lon, destinoRuta.lat],
  ];
  const cuerpo = { ...BASE, coordinates: extremos };
  const horario = evaluarHorario(salida, cfg);

  const grandes = new Set(['autopista', 'primaria']);
  const medianas = new Set(['autopista', 'primaria', 'secundaria']);
  let pedidos;
  if (vehiculo === 'bici') {
    // Bicicleta o monopatín (R.M. 127-2021-MTC: solo ciclovías, calles o jirones): nunca por avenidas.
    pedidos = [
      // Sin zonas: el perfil de bici elige por sí mismo las ciclovías, incluso las que van junto a una avenida.
      sinAvenidas(cuerpo, red, extremos, new Set(['autopista']), 'recommended', 'bici-ciclovias', 'cycling-regular'),
      sinAvenidas(cuerpo, red, extremos, medianas, 'recommended', 'bici', 'cycling-regular'),
      sinAvenidas(cuerpo, red, extremos, medianas, 'shortest', 'bici-corta', 'cycling-regular'),
    ];
  } else {
    // La moto eléctrica nunca va por vías rápidas, ni siquiera en la ruta más rápida.
    const base = vehiculo === 'motoElectrica' ? new Set(['autopista']) : new Set();
    const rapida = base.size
      ? sinAvenidas(cuerpo, red, extremos, base, 'fastest', 'rapida')
      : conAlternativas('driving-car', cuerpo, 'rapida').then((rutas) => rutas.map((ruta) => ({ ruta })));
    const variantes = {
      principiante: [[grandes, 'shortest', 'sin-grandes-corta'], [medianas, 'shortest', 'sin-medianas-corta']],
      intermedio: [[grandes, 'fastest', 'sin-grandes'], [grandes, 'shortest', 'sin-grandes-corta']],
      normal: [[grandes, 'fastest', 'sin-grandes']],
    }[nivel];
    pedidos = [rapida, ...variantes.map(([clases, pref, id]) => sinAvenidas(cuerpo, red, extremos, clases, pref, id))];
  }
  const resultados = (await Promise.all(pedidos)).flat();

  const comparacion = [];
  const candidatas = [];
  for (const v of resultados) {
    if (v.ruta) candidatas.push(v.ruta);
    else comparacion.push({ nota: `descartada: ${v.descartada}` });
  }
  if (!candidatas.length) throw new ErrorServicio('No encontré una ruta que evite las avenidas entre esos puntos.', 422);

  for (const ruta of candidatas) {
    ruta.caminataSegundos = (snapInicio?.minutosCaminata ?? 0) * 60;
    ruta.analisis = analizarRuta(ruta.coordenadas, ruta.waytype, red);
    ruta.analisis.giros = analizarGiros(ruta.pasos, ruta.analisis.acumulado, cfg.giros);
    ruta.puntaje = calcularPuntaje(ruta.analisis, null, cfg, vehiculo);
  }

  const caminataSegundos = (snapInicio?.minutosCaminata ?? 0) * 60;
  const tiempoTotal = (r) => (r.trafico?.confiable ? r.trafico.duracionSegundos : r.duracion) + caminataSegundos;
  const masRapida = candidatas.reduce((m, r) => (r.duracion < m.duracion ? r : m));
  const tope = cfg.tiempoMaximo[nivel];
  const limite = tiempoTotal(masRapida) * tope.factor + tope.minutosExtra * 60;
  const unicas = [];
  for (const ruta of candidatas.toSorted((a, b) => b.puntaje.valor - a.puntaje.valor || a.duracion - b.duracion)) {
    if (tiempoTotal(ruta) > limite) {
      comparacion.push(resumen(ruta, 'descartada: demora demasiado'));
    } else if (unicas.some((u) => sonIguales(u, ruta))) {
      comparacion.push(resumen(ruta, 'descartada: casi igual a otra'));
    } else {
      unicas.push(ruta);
    }
  }

  let seleccion = [unicas[0]];
  const rapida = unicas.reduce((m, r) => (r.duracion < m.duracion ? r : m));
  const alternativa = unicas.find((r) => r !== unicas[0] && r !== rapida);
  if (alternativa) seleccion.push(alternativa);
  if (rapida !== unicas[0]) seleccion.push(rapida);

  // Tráfico del momento (solo si se sale ahora y hay key de TomTom).
  let trafico = { estado: 'ok', mensaje: null };
  if (vehiculo === 'bici') {
    trafico = { estado: 'no_aplica', mensaje: null };
  } else if (!hayKeyTomTom()) {
    trafico = { estado: 'sin_key', mensaje: 'El tráfico en vivo no está activado (falta TOMTOM_API_KEY).' };
  } else if (horario.cuando !== 'ahora') {
    trafico = { estado: 'hora_elegida', mensaje: 'El tráfico en vivo solo se mide si sales ahora.' };
  } else {
    const mediciones = await Promise.all(seleccion.map((r) => medirTrafico(r.coordenadas, r.distancia)));
    const fallo = mediciones.find((m) => m.error || !m.confiable);
    if (fallo) {
      // Comparar un tiempo con tráfico contra otro sin tráfico engaña: o se mide en todas, o en ninguna.
      const motivo = fallo.error ?? 'TomTom no siguió el mismo recorrido';
      trafico = { estado: 'error', mensaje: `No se pudo medir el tráfico de todas las rutas (${motivo}). Los tiempos no lo incluyen.` };
    } else {
      seleccion.forEach((r, i) => {
        r.trafico = mediciones[i];
        r.puntaje = calcularPuntaje(r.analisis, r.trafico, cfg, vehiculo);
      });
    }
  }

  // Con el tráfico, el orden puede cambiar: se vuelve a elegir con los mismos candidatos.
  // Una ruta que otra supera a la vez en tiempo y en tranquilidad no le sirve a nadie y se quita.
  const tiempo = tiempoTotal;
  const superada = (r, o) =>
    tiempo(o) <= tiempo(r) && o.puntaje.valor >= r.puntaje.valor && (tiempo(o) < tiempo(r) || o.puntaje.valor > r.puntaje.valor);
  for (const r of seleccion.filter((r) => seleccion.some((o) => o !== r && superada(r, o)))) {
    comparacion.push(resumen(r, 'descartada: otra ruta es más rápida y más tranquila'));
  }
  seleccion = seleccion.filter((r) => !seleccion.some((o) => o !== r && superada(r, o)));
  const tranquila = seleccion.toSorted((a, b) => b.puntaje.valor - a.puntaje.valor || tiempo(a) - tiempo(b))[0];
  const rapidaFinal = seleccion.reduce((m, r) => (tiempo(r) < tiempo(m) ? r : m));
  seleccion = [tranquila, ...seleccion.filter((r) => r !== tranquila && r !== rapidaFinal), ...(rapidaFinal !== tranquila ? [rapidaFinal] : [])];

  const rutas = seleccion.map((r) => {
    const tipos = [];
    if (r === tranquila) tipos.push('tranquila');
    if (r === rapidaFinal) tipos.push('rapida');
    if (!tipos.length) tipos.push('alternativa');
    return {
      id: r.origen,
      tipos,
      distanciaMetros: Math.round(r.distancia),
      duracionSegundos: Math.round(r.duracion),
      duracionTotalSegundos: Math.round(tiempoTotal(r)),
      trafico: r.trafico
        ? { confiable: r.trafico.confiable, duracionSegundos: r.trafico.duracionSegundos, retrasoSegundos: r.trafico.retrasoSegundos }
        : null,
      puntaje: r.puntaje,
      puntosCriticos: puntosCriticos(r, vehiculo, snapInicio),
      // Tramo a pie desde la salida real hasta la entrada a la ciclovía, para dibujarlo en el mapa.
      caminataInicial: snapInicio
        ? {
            metros: snapInicio.distanciaCaminata,
            minutos: snapInicio.minutosCaminata,
            geometria: [[snapInicio.origenLat, snapInicio.origenLon], [snapInicio.lat, snapInicio.lon]].map(([lat, lon]) => [
              Number(lat.toFixed(6)),
              Number(lon.toFixed(6)),
            ]),
          }
        : null,
      pasos: armarPasos(r.pasos, r.coordenadas, r.analisis),
      geometria: r.coordenadas.map(([lon, lat]) => [Number(lat.toFixed(6)), Number(lon.toFixed(6))]),
      // Para pintar en el mapa qué partes van por ciclovía, calle, avenida o a pie.
      tramosPorClase: tramosPorClase(r.analisis.segmentos),
      enlaceGoogleMaps: enlaceGoogleMaps(r).replace('travelmode=driving', vehiculo === 'bici' ? 'travelmode=bicycling' : 'travelmode=driving'),
    };
  });

  return {
    rutas,
    horario,
    trafico,
    ...(depurar ? { comparacion: [...seleccion.map((r) => resumen(r, 'elegida')), ...comparacion] } : {}),
  };
}
