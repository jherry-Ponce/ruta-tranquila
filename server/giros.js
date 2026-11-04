// Cuenta decisiones de conducción, no curvas de la geometría.
export function analizarGiros(pasos, acumulado, cfg) {
  // Un óvalo se cuenta al entrar; su salida no añade una segunda decisión.
  // Los giros suaves y mantenerse a un lado pesan la mitad; una vuelta en U, el triple.
  const pesos = { 0: 1, 1: 1, 2: 2, 3: 2, 4: 0.5, 5: 0.5, 7: 1, 9: 3, 12: 0.5, 13: 0.5 };
  const giros = pasos.filter((p) => pesos[p.type]).map((p) => ({ peso: pesos[p.type], en: acumulado[p.way_points[0]] ?? 0 }));
  const seguidos = giros.filter((g, i) => i > 0 && g.en - giros[i - 1].en < cfg.distanciaSeguidos).length;
  const km = (acumulado.at(-1) ?? 0) / 1000;
  const tolerancia = Math.max(cfg.minimoSinPenalizar, km * cfg.porKmSinPenalizar);
  const exceso = Math.max(0, giros.reduce((s, g) => s + g.peso, 0) - tolerancia);
  const penalizacion = Math.min(cfg.tope, Math.round(exceso * cfg.puntosPorExceso + seguidos * cfg.puntosPorGiroSeguido));
  return { cantidad: giros.length, seguidos, penalizacion };
}
