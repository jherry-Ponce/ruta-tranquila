// Ajustes del puntaje de tranquilidad y de los avisos.
// Puedes cambiar estos números sin tocar el resto del código; reinicia el servidor después.

export default {
  // Peso de cada tipo de vía (1 = muy tranquila, 0 = nada tranquila).
  // El puntaje base es el promedio de estos pesos según los metros recorridos en cada tipo.
  pesos: {
    residencial: 1.0, // residential, service, living_street
    menor: 0.75, // tertiary, unclassified
    secundaria: 0.35, // secondary: Av. Arequipa, Av. Sucre, Av. Juan de Aliaga
    primaria: 0.1, // primary: Av. Brasil, Av. Benavides, Av. La Marina
    autopista: 0.0, // motorway y trunk: Vía Expresa, Panamericana Sur
    ciclovia: 1.0, // solo en rutas de bicicleta o monopatín
    vereda: 0.3, // veredas, parques o caminos: hay que bajarse y caminar
  },

  // Solo para bicicleta o monopatín: una ciclovía protegida aporta seguridad adicional
  // que no se refleja al tratarla igual que una calle residencial. El tope impide que
  // unos pocos kilómetros de ciclovía oculten cruces o avenidas peligrosas del resto.
  bonoCiclovia: {
    puntosPorPorcentaje: 1.5,
    maximo: 15,
  },

  // Puntos que se restan por cada cruce a nivel con una vía principal, contados por cada
  // kmReferenciaCruces km de recorrido (en rutas más cortas no se agrandan).
  penalizacionCruce: {
    autopista: 8,
    primaria: 5,
    secundaria: 2,
  },
  kmReferenciaCruces: 5,
  topePenalizacionCruces: 30,

  // Puntos que se restan por cada tramo con tráfico según TomTom (gravedad 1, 2 o 3).
  penalizacionTrafico: { 1: 2, 2: 4, 3: 8 },
  topePenalizacionTrafico: 20,

  // Etiquetas del puntaje final, de mayor a menor.
  etiquetas: [
    { desde: 80, texto: 'Muy tranquila' },
    { desde: 60, texto: 'Tranquila' },
    { desde: 40, texto: 'Exigente' },
    { desde: 0, texto: 'Difícil para principiantes' },
  ],

  // Una ruta tranquila puede tardar más que la rápida, pero no sin límite:
  // se descartan las que superen (tiempo de la rápida × factor) + minutosExtra.
  // Las calles tranquilas de Lima son lentas: en la ruta de ejemplo la más tranquila tarda 2,5 veces la rápida.
  tiempoMaximo: {
    principiante: { factor: 2.5, minutosExtra: 10 },
    intermedio: { factor: 1.6, minutosExtra: 5 },
    normal: { factor: 1.3, minutosExtra: 3 },
  },

  // Horas punta de Lima (hora local, lunes = 1 ... domingo = 7). No incluye feriados.
  horasPunta: [
    { dias: [1, 2, 3, 4, 5], desde: '07:00', hasta: '09:30' },
    { dias: [1, 2, 3, 4, 5], desde: '17:00', hasta: '20:00' },
  ],
  // Minutos antes de una hora punta en que ya se muestra un aviso suave.
  avisoPrevioMinutos: 45,

  // Límites de Lima Metropolitana y Callao. Fuera de este rectángulo la app no calcula rutas.
  limitesLima: { sur: -12.53, oeste: -77.25, norte: -11.56, este: -76.55 },
};
