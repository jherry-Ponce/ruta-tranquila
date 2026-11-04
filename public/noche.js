// ¿Es de noche? Se calcula con la altura del sol en Lima (fórmula astronómica simple, sin servicios externos).
// La usan el mapa oscuro automático y el aviso de encender las luces en bici.

const LIMA = { lat: -12.06, lon: -77.04 };
const rad = (g) => (g * Math.PI) / 180;
const grados = (r) => (r * 180) / Math.PI;

// Altura del sol sobre el horizonte, en grados (negativa: ya se ocultó). Error de pocas décimas.
export function alturaSol(fecha = new Date(), { lat, lon } = LIMA) {
  const d = fecha.getTime() / 86_400_000 + 2_440_587.5 - 2_451_545; // días desde el año 2000 (J2000)
  const anomalia = rad(357.529 + 0.98560028 * d);
  const media = 280.459 + 0.98564736 * d;
  const longitud = rad(media + 1.915 * Math.sin(anomalia) + 0.02 * Math.sin(2 * anomalia));
  const oblicuidad = rad(23.439 - 0.00000036 * d);
  const ascension = Math.atan2(Math.cos(oblicuidad) * Math.sin(longitud), Math.cos(longitud));
  const declinacion = Math.asin(Math.sin(oblicuidad) * Math.sin(longitud));
  const horaSideral = (280.46061837 + 360.98564736629 * d + lon) % 360;
  const angulo = rad(horaSideral) - ascension;
  return grados(Math.asin(Math.sin(rad(lat)) * Math.sin(declinacion) + Math.cos(rad(lat)) * Math.cos(declinacion) * Math.cos(angulo)));
}

// El sol se ve ocultarse a −0,83° (refracción y radio del disco).
export const esDeNoche = (fecha, lugar) => alturaSol(fecha, lugar) < -0.83;

// Para las luces de la bici: desde un rato antes de la puesta del sol (unos 15 minutos), cuando ya baja la luz.
export const horaDeLuces = (fecha, lugar) => alturaSol(fecha, lugar) < 4;
