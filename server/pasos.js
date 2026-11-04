// Instrucciones paso a paso en español sencillo, con avisos donde hay avenidas o cruces.

import { PRINCIPALES } from './analisis.js';

export function abreviar(nombre) {
  if (!nombre || nombre === '-') return '';
  return nombre
    .replace(/\bAvenida\b/g, 'Av.')
    .replace(/\bJirón\b/g, 'Jr.')
    .replace(/\bPasaje\b/g, 'Psje.')
    .replace(/\bProlongación\b/g, 'Prol.');
}

export function formatoDistancia(metros) {
  if (metros < 950) return `${Math.max(10, Math.round(metros / 10) * 10)} m`;
  return `${(metros / 1000).toFixed(1).replace('.', ',')} km`;
}

const ORDINALES = ['', 'primera', 'segunda', 'tercera', 'cuarta', 'quinta', 'sexta', 'séptima', 'octava'];

// Tipos de maniobra de OpenRouteService.
function frase(paso, calle) {
  const en = calle ? ` en ${calle}` : '';
  const por = calle ? ` por ${calle}` : '';
  switch (paso.type) {
    case 0: return `Gira a la izquierda${en}`;
    case 1: return `Gira a la derecha${en}`;
    case 2: return `Gira bien cerrado a la izquierda${en}`;
    case 3: return `Gira bien cerrado a la derecha${en}`;
    case 4: return `Ve ligeramente a la izquierda${por}`;
    case 5: return `Ve ligeramente a la derecha${por}`;
    case 6: return `Sigue derecho${por}`;
    case 7: {
      if (!paso.exit_number) return 'Entra al óvalo';
      const ordinal = ORDINALES[paso.exit_number];
      const salida = ordinal ? `${ordinal} salida` : `salida ${paso.exit_number}`;
      return `En el óvalo, toma la ${salida}${calle ? ` hacia ${calle}` : ''}`;
    }
    case 8: return `Sal del óvalo${por}`;
    case 9: return `Da la vuelta en U${en}, solo donde esté permitido y sin apuro`;
    case 10: return 'Llegaste a tu destino';
    case 11: return calle ? `Empieza por ${calle}` : 'Empieza el recorrido';
    case 12: return `Mantente a la izquierda${por}`;
    case 13: return `Mantente a la derecha${por}`;
    default: return `Continúa${por}`;
  }
}

export function avisoCruce(cruce) {
  return cruce.semaforo
    ? 'Semáforo registrado en OSM: espera la señal que corresponda a tu paso y comprueba que el cruce esté despejado.'
    : 'Sin información de semáforo: comprueba la señalización y cruza solo cuando sea seguro.';
}

export function armarPasos(pasosOrs, coordenadas, analisis) {
  return pasosOrs.map((paso) => {
    const [desde, hasta] = paso.way_points;
    const calle = abreviar(paso.name);
    const maniobra = frase(paso, calle);
    let texto = maniobra;
    if (paso.type !== 10 && paso.distance >= 10) texto += ` y sigue ${formatoDistancia(paso.distance)}`;
    texto += '.';

    const metros = {};
    for (const s of analisis.segmentos.slice(desde, hasta)) metros[s.clase] = (metros[s.clase] ?? 0) + s.largo;
    const inicio = analisis.acumulado[desde];
    const fin = analisis.acumulado[hasta];

    const avisos = [];
    const grande = metros.primaria ?? 0;
    const mediana = metros.secundaria ?? 0;
    if ((metros.autopista ?? 0) > 50) avisos.push('Vía rápida: ve por el carril derecho y mantén distancia.');
    else if (grande > 50 && grande >= mediana) avisos.push('Avenida grande: ve por el carril derecho, a velocidad constante.');
    else if (mediana > 50) avisos.push('Avenida mediana: atento a combis y buses que se detienen.');
    if ((metros.vereda ?? 0) > 20) avisos.push('Tramo por vereda o parque: bájate y camina.');

    // Los cruces se asignan al paso en cuyo recorrido ocurren.
    for (const cruce of analisis.cruces.filter((c) => c.en >= inicio && c.en < fin && PRINCIPALES.has(c.clase))) {
      const via = cruce.nombres.length ? cruce.nombres.map(abreviar).join(' / ') : 'una avenida';
      avisos.push(`Cruzas ${via}: ${avisoCruce(cruce)}`);
    }

    const [lon, lat] = coordenadas[desde];
    // maniobra e inicioMetros sirven a la guía por voz del modo viaje.
    return { texto, maniobra, inicioMetros: Math.round(inicio), distanciaMetros: Math.round(paso.distance), avisos, lat, lon };
  });
}
