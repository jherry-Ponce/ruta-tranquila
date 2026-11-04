// Correcciones puntuales confirmadas por el usuario; no se infieren otras numeraciones.
const normalizar = (texto) => texto.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

export function ubicacionConfirmada(texto) {
  const t = normalizar(texto);
  if (!/^(?:(?:jr|jiron) )?manuel candamo 820(?: lince(?: lima)?(?: 15046)?(?: peru)?)?$/.test(t)) return null;
  return {
    etiqueta: 'Jirón Manuel Candamo 820, Lince, Lima',
    nombre: 'Jirón Manuel Candamo 820', zona: 'Lince, Lima',
    lat: -12.0816676, lon: -77.0280865, exacto: true, tipo: 'confirmado',
  };
}
