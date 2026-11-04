// Puntaje de tranquilidad (0-100) y su explicación en lenguaje simple.

const NOMBRES_CLASE = {
  residencial: 'calles tranquilas',
  menor: 'calles con algo más de movimiento',
  secundaria: 'avenidas medianas',
  primaria: 'avenidas grandes',
  autopista: 'vías rápidas',
  ciclovia: 'ciclovías',
  vereda: 'veredas o parques (a pie)',
};

const ORDEN_CLASES = ['ciclovia', 'residencial', 'menor', 'secundaria', 'primaria', 'autopista', 'vereda'];

const CRUCE_SINGULAR = { autopista: 'vía rápida', primaria: 'avenida grande', secundaria: 'avenida mediana' };
const CRUCE_PLURAL = { autopista: 'vías rápidas', primaria: 'avenidas grandes', secundaria: 'avenidas medianas' };

// Porcentajes enteros que siempre suman 100 (método del mayor resto).
function porcentajes(metros, total) {
  const filas = ORDEN_CLASES.filter((c) => metros[c] > 0).map((c) => {
    const exacto = (100 * metros[c]) / total;
    return { clase: c, valor: Math.floor(exacto), resto: exacto % 1 };
  });
  let faltan = 100 - filas.reduce((s, f) => s + f.valor, 0);
  for (const f of [...filas].sort((x, y) => y.resto - x.resto)) {
    if (faltan <= 0) break;
    f.valor++;
    faltan--;
  }
  return Object.fromEntries(filas.filter((f) => f.valor > 0).map((f) => [f.clase, f.valor]));
}

function enumerar(partes) {
  if (partes.length <= 1) return partes.join('');
  return `${partes.slice(0, -1).join(', ')} y ${partes.at(-1)}`;
}

function frasesCruces(cruces) {
  const conteo = {};
  for (const c of cruces) conteo[c.clase] = (conteo[c.clase] ?? 0) + 1;
  const partes = ['autopista', 'primaria', 'secundaria']
    .filter((c) => conteo[c])
    .map((c) => `${conteo[c]} ${conteo[c] === 1 ? CRUCE_SINGULAR[c] : CRUCE_PLURAL[c]}`);
  return partes.length ? `Cruzas ${enumerar(partes)}.` : 'No cruzas avenidas grandes ni medianas.';
}

export function calcularPuntaje(analisis, trafico, cfg, vehiculo = 'auto') {
  const total = analisis.distancia || 1;
  let base = 0;
  for (const [clase, metros] of Object.entries(analisis.metrosPorClase)) base += (cfg.pesos[clase] ?? 0) * metros;
  base = (100 * base) / total;

  // En bici o monopatín, una ciclovía separada de los autos es más segura que una calle
  // residencial. Se premia de forma explícita y acotada para que los cruces sigan pesando.
  const porcentajeCiclovia = (100 * (analisis.metrosPorClase.ciclovia ?? 0)) / total;
  const bonoCiclovia =
    vehiculo === 'bici'
      ? Math.min(cfg.bonoCiclovia.maximo, Math.round(porcentajeCiclovia * cfg.bonoCiclovia.puntosPorPorcentaje))
      : 0;

  // Los cruces se cuentan por cada `kmReferenciaCruces` km: un viaje largo cruza más avenidas por fuerza,
  // y así el puntaje compara qué tan seguido aparecen, no solo cuántos son.
  const escala = Math.min(1, cfg.kmReferenciaCruces / Math.max(total / 1000, 0.001));
  const penalCruces = Math.min(
    cfg.topePenalizacionCruces,
    Math.round(escala * analisis.cruces.reduce((s, c) => s + (cfg.penalizacionCruce[c.clase] ?? 0) * (c.semaforo ? cfg.factorCruceConSemaforo : 1), 0)),
  );
  const tramosTrafico = trafico?.confiable ? trafico.tramos : [];
  const penalTrafico = Math.min(
    cfg.topePenalizacionTrafico,
    tramosTrafico.reduce((s, t) => s + (cfg.penalizacionTrafico[t.gravedad] ?? 0), 0),
  );

  const penalGiros = analisis.giros?.penalizacion ?? 0;
  const valor = Math.max(0, Math.min(100, Math.round(base + bonoCiclovia - penalCruces - penalTrafico - penalGiros)));
  const etiqueta = cfg.etiquetas.find((e) => valor >= e.desde)?.texto ?? '';
  const pct = porcentajes(analisis.metrosPorClase, total);

  const recorrido = enumerar(Object.entries(pct).map(([c, v]) => `${v}% por ${NOMBRES_CLASE[c]}`));
  let explicacion = `${recorrido.charAt(0).toUpperCase()}${recorrido.slice(1)}. ${frasesCruces(analisis.cruces)}`;
  if (penalTrafico > 0) {
    const n = tramosTrafico.length;
    explicacion += ` Ahora hay tráfico en ${n} ${n === 1 ? 'tramo' : 'tramos'} (−${penalTrafico}).`;
  }
  if (bonoCiclovia > 0) {
    explicacion += ` Para bici o monopatín, el uso de ciclovías protegidas suma +${bonoCiclovia} puntos.`;
  }

  const conSemaforo = analisis.cruces.filter((c) => c.semaforo).length;
  if (conSemaforo) explicacion += ` ${conSemaforo} ${conSemaforo === 1 ? 'cruce con semáforo registrado' : 'cruces con semáforo registrado'} en OSM.`;
  if (analisis.giros) explicacion += ` ${analisis.giros.cantidad} maniobras de giro${penalGiros ? `; su complejidad resta ${penalGiros} puntos` : ''}.`;
  return {
    valor,
    etiqueta,
    explicacion,
    porcentajes: pct,
    desglose: { base: Math.round(base), ciclovias: bonoCiclovia, cruces: -penalCruces, trafico: -penalTrafico, giros: -penalGiros },
  };
}
