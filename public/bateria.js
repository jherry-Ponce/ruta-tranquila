// Estimación de batería para scooters y motos eléctricas. Es una aproximación: subir gasta más que ir en plano
// (subir 100 m con persona y vehículo gasta más o menos lo mismo que avanzar 1,5 km en plano).

const KM_POR_METRO_DE_SUBIDA = 0.015;
export const MARGEN = 0.8; // conviene llegar con al menos un 20% de batería

const km = (n) => String(Math.round(n * 10) / 10).replace('.', ',');
const gasto = (distanciaMetros, subidaMetros = 0) => distanciaMetros / 1000 + subidaMetros * KM_POR_METRO_DE_SUBIDA;

// ruta: { distanciaMetros, subidaMetros, bajadaMetros }; autonomiaKm: lo que le queda a la batería.
// despues: qué hace la persona al llegar.
//   false o 'quedo'  → se queda ahí (solo la ida);
//   true o 'inicio'  → vuelve al punto de salida por el mismo camino (a la vuelta sube lo que a la ida bajó);
//   { distanciaMetros, subidaMetros, nombre } → sigue a otro lugar (tramo calculado aparte).
// Devuelve el estado, el texto y los tramos (km de batería de cada uno) para dibujar la barra.
export function estimarBateria(ruta, autonomiaKm, despues = false) {
  if (!(autonomiaKm > 0)) return null;
  const ida = gasto(ruta.distanciaMetros, ruta.subidaMetros);
  let segundo = null;
  if (despues === true || despues === 'inicio') {
    segundo = { km: gasto(ruta.distanciaMetros, ruta.bajadaMetros), vuelta: true };
  } else if (despues && typeof despues === 'object') {
    segundo = { km: gasto(despues.distanciaMetros, despues.subidaMetros), nombre: despues.nombre || 'el otro lugar' };
  }
  const necesarios = ida + (segundo?.km ?? 0);
  const usados = Math.round(necesarios * 10) / 10;
  const tramos = [{ km: ida, clave: 'ida' }, ...(segundo ? [{ km: segundo.km, clave: 'despues' }] : [])];

  let estado;
  if (necesarios <= autonomiaKm * MARGEN) estado = 'alcanza';
  else if (necesarios <= autonomiaKm) estado = 'justo';
  else if (segundo && ida <= autonomiaKm) estado = 'soloIda';
  else estado = 'noAlcanza';

  const tramo = !segundo ? 'el viaje' : segundo.vuelta ? 'ida y vuelta' : `ir y seguir a ${segundo.nombre}`;
  const cifras = `${km(usados)} km de tus ${autonomiaKm} km`;
  const seguir = segundo?.vuelta ? 'volver' : `seguir a ${segundo?.nombre}`;
  const texto = {
    alcanza: `Te alcanza para ${tramo}: usarías unos ${cifras}.`,
    justo: `Muy justo para ${tramo}: usarías unos ${cifras}. Carga antes de salir si puedes.`,
    soloIda: `Llegas, pero no te alcanza para ${seguir}: te faltarían unos ${km(necesarios - autonomiaKm)} km. Carga en el destino si puedes.`,
    noAlcanza: `No te alcanza ${segundo ? 'ni ' : ''}para llegar: necesitarías unos ${km(ida)} km de tus ${autonomiaKm} km. Carga la batería o elige otra ruta.`,
  }[estado];
  return { estado, usados, texto, tramos, autonomiaKm };
}
