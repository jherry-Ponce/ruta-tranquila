// Enlaces a otras apps: Street View para mirar un cruce antes de salir y WhatsApp para avisar a la familia.
// Solo se abren si la persona los toca.

const M_LAT = 110_574;
const M_LON = 111_320 * Math.cos((-12.05 * Math.PI) / 180);

// Dirección de avance de la ruta (0 = norte, 90 = este) cerca de un punto, para mirar en Street View
// hacia donde vas a llegar.
export function rumboEn(geometria, lat, lon) {
  let mejor = 0;
  let menor = Infinity;
  geometria.forEach(([la, lo], i) => {
    const d = ((la - lat) * M_LAT) ** 2 + ((lo - lon) * M_LON) ** 2;
    if (d < menor) {
      menor = d;
      mejor = i;
    }
  });
  const a = geometria[Math.max(0, Math.min(mejor, geometria.length - 2))];
  const b = geometria[Math.min(geometria.length - 1, Math.max(mejor, 0) + 1)];
  if (!a || !b || a === b) return 0;
  const grados = (Math.atan2((b[1] - a[1]) * M_LON, (b[0] - a[0]) * M_LAT) * 180) / Math.PI;
  return Math.round((grados + 360) % 360);
}

export function enlaceStreetView(lat, lon, rumbo = 0) {
  const q = new URLSearchParams({ api: '1', map_action: 'pano', viewpoint: `${lat.toFixed(6)},${lon.toFixed(6)}`, heading: String(rumbo), pitch: '0', fov: '90' });
  return `https://www.google.com/maps/@?${q}`;
}

const hora = (fecha) => fecha.toLocaleTimeString('es-PE', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Lima' });

export function mensajeEnCamino(destino, segundosRestantes, ahora = new Date()) {
  const llegada = new Date(ahora.getTime() + Math.max(0, segundosRestantes) * 1000);
  // Sin punto final: la hora ya puede terminar en "p. m.".
  return `Voy en camino${destino ? ` a ${destino}` : ''} con Voy Tranqui 🙂. Llego aprox. a las ${hora(llegada)}`;
}

export const mensajeLlegue = (destino) => `Ya llegué bien${destino ? ` a ${destino}` : ''} 🙂 (Voy Tranqui)`;

export const enlaceWhatsApp = (texto) => `https://wa.me/?text=${encodeURIComponent(texto)}`;
