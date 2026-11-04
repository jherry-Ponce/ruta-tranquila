// Solo se extraen puntos compartidos por el usuario; no se consulta Google Routes.
import { ErrorServicio } from './ors.js';
const error = (mensaje) => new ErrorServicio(mensaje, 400);
const permitida = (u) => u.protocol === 'https:' && !u.username && !u.password && !u.port && (
  ['google.com', 'www.google.com', 'maps.google.com'].includes(u.hostname) && (u.pathname.startsWith('/maps') || u.hostname === 'maps.google.com') ||
  u.hostname === 'maps.app.goo.gl' || u.hostname === 'goo.gl' && u.pathname.startsWith('/maps/')
);
const numero = '-?[0-9]+(?:[.][0-9]+)?';
const par = new RegExp('^(' + numero + '),[ ]*(' + numero + ')$');
const datos = new RegExp('!3d(' + numero + ')!4d(' + numero + ')');

export async function puntoDeEnlace(texto, limites) {
  if (!/^https?:\/\//i.test(texto)) return null;
  let url;
  try { url = new URL(texto); } catch { throw error('El enlace no es válido.'); }
  if (!permitida(url)) throw error('Pega un enlace HTTPS de Google Maps o elige el punto en el mapa.');
  for (let salto = 0; salto < 6; salto++) {
    if (!permitida(url)) throw error('El enlace redirige fuera de Google Maps.');
    let ruta;
    try { ruta = decodeURIComponent(url.pathname); } catch { throw error('El enlace no es válido.'); }
    if (ruta.includes('/dir/')) throw error('Comparte el enlace de un lugar, no el de un recorrido.');
    const coincidencia = datos.exec(ruta) ?? par.exec(url.searchParams.get('query') ?? url.searchParams.get('q') ?? '');
    if (coincidencia) {
      const lat = Number(coincidencia[1]);
      const lon = Number(coincidencia[2]);
      if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < limites.sur || lat > limites.norte || lon < limites.oeste || lon > limites.este) throw error('El punto del enlace debe estar en Lima o Callao.');
      return { lat, lon, etiqueta: 'Punto compartido desde Google Maps', nombre: 'Punto de Google Maps', zona: 'Ubicación del enlace', exacto: true, tipo: 'enlace' };
    }
    if (!['maps.app.goo.gl', 'goo.gl'].includes(url.hostname)) break;
    let respuesta;
    try { respuesta = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(5000) }); }
    catch { throw error('No pude abrir el enlace corto. Pega el enlace completo de Google Maps o elige el punto en el mapa.'); }
    const destino = respuesta.headers.get('location');
    await respuesta.body?.cancel();
    if (respuesta.status < 300 || respuesta.status >= 400 || !destino) break;
    try { url = new URL(destino, url); } catch { throw error('El enlace no es válido.'); }
  }
  // @lat,lon solo indica el centro de la cámara y puede estar lejos del destino.
  throw error('El enlace no contiene un punto identificable. Comparte un lugar o un pin de Google Maps, o elígelo en el mapa.');
}
