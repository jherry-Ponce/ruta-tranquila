// Interpretación de etiquetas OSM. Una vía compartida no equivale a una ciclovía protegida.
export function infraestructuraBici(t = {}) {
  if (['no', 'private', 'dismount'].includes(t.bicycle) || ['no', 'private'].includes(t.access) || ['construction', 'proposed'].includes(t.highway)) return [];
  const sentido = (valor, defecto) => valor === 'no' ? 0 : valor === '-1' ? -1 : valor === 'yes' || valor === '1' ? 1 : defecto;
  if (t.highway === 'cycleway' || ['path', 'footway', 'pedestrian'].includes(t.highway) && t.bicycle === 'designated') {
    const compartida = ['yes', 'designated'].includes(t.foot) && t.segregated !== 'yes' || t.highway !== 'cycleway' && t.segregated !== 'yes';
    return [{ tipo: compartida ? 'sendaCompartida' : 'separada', lado: 'independiente', sentido: sentido(t['oneway:bicycle'] ?? t.oneway, 0) }];
  }
  const resultado = [];
  const especificos = ['left', 'right', 'both'].some((l) => t['cycleway:' + l] !== undefined);
  const lados = especificos ? ['left', 'right'] : ['general'];
  for (const lado of lados) {
    const clave = lado === 'general' ? 'cycleway' : t['cycleway:' + lado] !== undefined ? 'cycleway:' + lado : t['cycleway:both'] !== undefined ? 'cycleway:both' : 'cycleway';
    const valor = t[clave];
    const tipo = { track: 'separada', opposite_track: 'separada', lane: 'carril', opposite_lane: 'carril', shared_lane: 'compartida', share_busway: 'compartida' }[valor];
    // separate remite a otra geometría; no se dibuja ni se premia de nuevo sobre la calzada.
    if (!tipo) continue;
    const unSentido = t['oneway:bicycle'] === 'yes' || t.oneway === 'yes' && t['oneway:bicycle'] !== 'no';
    const defecto = valor.startsWith('opposite_') ? -1 : unSentido ? 1 : lado === 'left' ? -1 : lado === 'right' ? 1 : 0;
    resultado.push({ tipo, lado, sentido: sentido(t['cycleway:' + lado + ':oneway'] ?? t[clave + ':oneway'], defecto) });
  }
  return resultado;
}

export const NOMBRES_INFRA = {
  separada: 'Ciclovía separada', carril: 'Carril bici señalizado',
  compartida: 'Vía compartida con vehículos', sendaCompartida: 'Senda compartida con peatones',
};
