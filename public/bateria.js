// Estimación de batería para scooters y motos eléctricas. Es una aproximación: subir gasta más que ir en plano
// (subir 100 m con persona y vehículo gasta más o menos lo mismo que avanzar 1,5 km en plano).

const KM_POR_METRO_DE_SUBIDA = 0.015;
const MARGEN = 0.8; // conviene llegar con al menos un 20% de batería

// ruta: { distanciaMetros, subidaMetros, bajadaMetros }; autonomiaKm: lo que le queda a la batería.
export function estimarBateria(ruta, autonomiaKm, idaYVuelta = false) {
  if (!(autonomiaKm > 0)) return null;
  const km = ruta.distanciaMetros / 1000;
  const subida = ruta.subidaMetros ?? 0;
  const bajada = ruta.bajadaMetros ?? 0;
  // A la vuelta se sube lo que a la ida se bajó.
  const necesarios = idaYVuelta ? 2 * km + (subida + bajada) * KM_POR_METRO_DE_SUBIDA : km + subida * KM_POR_METRO_DE_SUBIDA;
  const usados = Math.round(necesarios * 10) / 10;
  const estado = necesarios <= autonomiaKm * MARGEN ? 'alcanza' : necesarios <= autonomiaKm ? 'justo' : 'noAlcanza';
  const tramo = idaYVuelta ? 'ida y vuelta' : 'el viaje';
  const cifras = `${String(usados).replace('.', ',')} km de tus ${autonomiaKm} km`;
  const texto = {
    alcanza: `Te alcanza para ${tramo}: usarías unos ${cifras}.`,
    justo: `Muy justo para ${tramo}: usarías unos ${cifras}. Carga antes de salir si puedes.`,
    noAlcanza: `No te alcanza para ${tramo}: necesitarías unos ${cifras}. Carga la batería o elige otra ruta.`,
  }[estado];
  return { estado, usados, texto };
}
