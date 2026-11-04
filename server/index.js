// Servidor de Voy Tranqui: sirve la página y hace de intermediario con OpenRouteService y TomTom.
// No guarda ubicaciones ni direcciones: no hay base de datos y los registros no incluyen datos del pedido.

import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import cfg from '../config/tranquilidad.js';
import { cargarRed, ARCHIVO_VIAS } from './vias.js';
import { ErrorServicio, hayKeyOrs } from './ors.js';
import { buscarDireccion, direccionDePunto, sugerirLugares } from './direcciones.js';
import { hayKeyTomTom } from './trafico.js';
import { planificar, practicar } from './planificador.js';
import { aGrados } from './geo.js';

const PUBLICO = fileURLToPath(new URL('../public/', import.meta.url));
const PUERTO = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || 'localhost';

const TIPOS = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};

const POLITICA = [
  "default-src 'self'",
  "script-src 'self' https://unpkg.com",
  "style-src 'self' 'unsafe-inline' https://unpkg.com https://fonts.googleapis.com",
  "font-src https://fonts.gstatic.com",
  "img-src 'self' data: https://unpkg.com https://tile.openstreetmap.org",
  "connect-src 'self'",
].join('; ');

let red = null;
let ciclovias = null; // se arma una sola vez, al primer pedido
if (existsSync(ARCHIVO_VIAS)) {
  red = cargarRed();
} else {
  console.warn('No existe data/vias-principales-lima.json. Ejecuta: npm run datos');
}

// Límite simple para no agotar la cuota gratuita (cada búsqueda de rutas hace 4 pedidos a ORS).
function limitador(maximo, ventanaMs) {
  const marcas = [];
  return () => {
    const ahora = Date.now();
    while (marcas.length && ahora - marcas[0] > ventanaMs) marcas.shift();
    if (marcas.length >= maximo) return false;
    marcas.push(ahora);
    return true;
  };
}
const puedeBuscarRutas = limitador(6, 60_000);
const puedeGeocodificar = limitador(60, 60_000);
const puedeSugerir = limitador(120, 60_000);
const puedeReportarError = limitador(30, 60_000);

// Puntos que la persona marcó para evitar: solo coordenadas válidas dentro de Lima, como máximo 20.
function puntosEvitar(lista) {
  if (!Array.isArray(lista)) return [];
  const { sur, norte, oeste, este } = cfg.limitesLima;
  return lista
    .slice(0, 20)
    .map((p) => ({ lat: Number(p?.lat), lon: Number(p?.lon) }))
    .filter(({ lat, lon }) => lat >= sur && lat <= norte && lon >= oeste && lon <= este);
}

async function leerJson(req) {
  // Vercel ya entrega el cuerpo leído.
  if (req.body !== undefined) return typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body;
  const partes = [];
  let tamano = 0;
  for await (const parte of req) {
    tamano += parte.length;
    if (tamano > 10_000) throw new ErrorServicio('El pedido es demasiado grande.', 413);
    partes.push(parte);
  }
  try {
    return JSON.parse(Buffer.concat(partes).toString('utf8') || '{}');
  } catch {
    throw new ErrorServicio('El pedido no es un JSON válido.', 400);
  }
}

function validarPunto(p, nombre) {
  const lat = Number(p?.lat);
  const lon = Number(p?.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) throw new ErrorServicio(`Falta el punto de ${nombre}.`, 400);
  const { sur, norte, oeste, este } = cfg.limitesLima;
  if (lat < sur || lat > norte || lon < oeste || lon > este) {
    throw new ErrorServicio(`El punto de ${nombre} está fuera de Lima y Callao. Por ahora la app solo funciona ahí.`, 400);
  }
  return { lat, lon };
}

const API = {
  async '/api/estado'() {
    return { ors: hayKeyOrs(), tomtom: hayKeyTomTom(), vias: red?.info ?? null, horasPunta: cfg.horasPunta };
  },

  async '/api/geocodificar'(cuerpo) {
    const texto = String(cuerpo.texto ?? '').trim();
    if (texto.length < 3 || texto.length > (/^https?:\/\//i.test(texto) ? 2048 : 200)) throw new ErrorServicio('Escribe una dirección de entre 3 y 200 caracteres o pega un enlace de Google Maps (máximo 2048).', 400);
    if (!puedeGeocodificar()) throw new ErrorServicio('Demasiadas búsquedas seguidas. Espera un momento.', 429);
    return { lugares: await buscarDireccion(texto, cfg.limitesLima) };
  },

  async '/api/sugerencias'(cuerpo) {
    const texto = String(cuerpo.texto ?? '').trim();
    if (texto.length < 3 || texto.length > (/^https?:\/\//i.test(texto) ? 2048 : 200)) return { lugares: [] };
    if (!puedeSugerir()) throw new ErrorServicio('Demasiadas búsquedas seguidas. Espera un momento.', 429);
    return { lugares: await sugerirLugares(texto, cfg.limitesLima) };
  },

  async '/api/inverso'(cuerpo) {
    const { lat, lon } = validarPunto(cuerpo, 'mapa');
    if (!puedeGeocodificar()) throw new ErrorServicio('Demasiadas búsquedas seguidas. Espera un momento.', 429);
    return { lugar: await direccionDePunto(lat, lon) };
  },

  // Infraestructura ciclista OSM: incluye conexiones cortas y distingue el tipo de espacio.
  async '/api/ciclovias'() {
    if (!red) throw new ErrorServicio('Faltan los datos de vías. Ejecuta: npm run datos', 503);
    ciclovias ??= red.vias
      .filter((v) => v.infraestructura.length)
      .flatMap((v) => [...new Set(v.infraestructura.map((b) => b.tipo))].map((tipo) => [v.nombre, v.puntos.map(aGrados).map(([lon, lat]) => [Number(lat.toFixed(5)), Number(lon.toFixed(5))]), tipo]));
    return { ciclovias };
  },

  // Errores de la interfaz en los celulares: quedan en los registros del servidor (en Vercel: pestaña Logs).
  // Solo texto técnico; la interfaz no envía ubicaciones ni direcciones.
  async '/api/errores'(cuerpo) {
    if (!puedeReportarError()) return { ok: false };
    const texto = (v, max) => String(v ?? '').slice(0, max);
    console.error(
      '[error-interfaz]',
      JSON.stringify({
        mensaje: texto(cuerpo.mensaje, 300),
        pila: texto(cuerpo.pila, 1500),
        archivo: texto(cuerpo.archivo, 200),
        linea: Number(cuerpo.linea) || null,
        pagina: texto(cuerpo.pagina, 100),
        app: Boolean(cuerpo.app),
        navegador: texto(cuerpo.navegador, 200),
      }),
    );
    return { ok: true };
  },

  async '/api/rutas'(cuerpo) {
    if (!red) throw new ErrorServicio('Faltan los datos de vías. Ejecuta: npm run datos', 503);
    const origen = validarPunto(cuerpo.origen, 'origen');
    const destino = validarPunto(cuerpo.destino, 'destino');
    if (Math.abs(origen.lat - destino.lat) < 0.0004 && Math.abs(origen.lon - destino.lon) < 0.0004) {
      throw new ErrorServicio('El origen y el destino están casi en el mismo lugar.', 400);
    }
    const salida = cuerpo.salida ? String(cuerpo.salida) : null;
    if (!puedeBuscarRutas()) throw new ErrorServicio('Demasiadas búsquedas de rutas en un minuto. Espera un momento.', 429);
    const vehiculo = ['auto', 'motoElectrica', 'bici'].includes(cuerpo.vehiculo) ? cuerpo.vehiculo : 'auto';
    const nivel = ['principiante', 'intermedio', 'normal'].includes(cuerpo.nivel) ? cuerpo.nivel : 'principiante';
    const evitar = puntosEvitar(cuerpo.evitar);
    return planificar({ origen, destino, salida, vehiculo, nivel, evitar, depurar: Boolean(cuerpo.depurar) }, { red, cfg });
  },

  // Circuito de práctica que sale y vuelve al mismo punto.
  async '/api/practica'(cuerpo) {
    if (!red) throw new ErrorServicio('Faltan los datos de vías. Ejecuta: npm run datos', 503);
    const origen = validarPunto(cuerpo.origen, 'salida');
    if (!puedeBuscarRutas()) throw new ErrorServicio('Demasiadas búsquedas de rutas en un minuto. Espera un momento.', 429);
    const vehiculo = ['auto', 'motoElectrica', 'bici'].includes(cuerpo.vehiculo) ? cuerpo.vehiculo : 'auto';
    const minutos = [10, 20, 30].includes(Number(cuerpo.minutos)) ? Number(cuerpo.minutos) : 20;
    const nivel = [1, 2, 3, 4].includes(Number(cuerpo.nivel)) ? Number(cuerpo.nivel) : 1;
    const semilla = Math.max(1, Math.min(10_000, Math.floor(Number(cuerpo.semilla)) || 1));
    return practicar({ origen, minutos, nivel, vehiculo, semilla, evitar: puntosEvitar(cuerpo.evitar) }, { red, cfg });
  },
};

async function servirArchivo(res, ruta, soloCabeceras) {
  const relativa = ruta === '/' ? 'index.html' : decodeURIComponent(ruta).replace(/^\/+/, '');
  const archivo = path.resolve(PUBLICO, relativa);
  if (!archivo.startsWith(PUBLICO)) return 404;
  try {
    const contenido = await readFile(archivo);
    res.writeHead(200, {
      'Content-Type': TIPOS[path.extname(archivo)] ?? 'application/octet-stream',
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': POLITICA,
    });
    res.end(soloCabeceras ? undefined : contenido);
    return 200;
  } catch {
    return 404;
  }
}

function responder(res, estado, datos) {
  res.writeHead(estado, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(datos));
}

// También sirve como función de Vercel (api/index.js).
export default async function manejar(req, res) {
  const inicio = Date.now();
  const ruta = new URL(req.url, 'http://localhost').pathname;
  let estado = 500;
  try {
    if (ruta.startsWith('/api/')) {
      const accion = API[ruta];
      if (!accion) {
        estado = 404;
        responder(res, estado, { error: 'No existe ese recurso.' });
      } else if (ruta !== '/api/estado' && req.method !== 'POST') {
        estado = 405;
        responder(res, estado, { error: 'Usa POST.' });
      } else {
        const cuerpo = req.method === 'POST' ? await leerJson(req) : {};
        const datos = await accion(cuerpo);
        estado = 200;
        responder(res, estado, datos);
      }
    } else if (req.method === 'GET' || req.method === 'HEAD') {
      estado = await servirArchivo(res, ruta, req.method === 'HEAD');
      if (estado === 404) responder(res, 404, { error: 'No encontrado.' });
    } else {
      estado = 405;
      responder(res, estado, { error: 'Método no permitido.' });
    }
  } catch (error) {
    estado = error instanceof ErrorServicio ? error.estado : 500;
    if (!(error instanceof ErrorServicio)) console.error(error);
    responder(res, estado, { error: error instanceof ErrorServicio ? error.message : 'Ocurrió un error inesperado.' });
  } finally {
    // Solo método, ruta y estado: nunca direcciones ni coordenadas.
    console.log(`${new Date().toLocaleTimeString('es-PE')} ${req.method} ${ruta} → ${estado} (${Date.now() - inicio} ms)`);
  }
}

if (!process.env.VERCEL) http.createServer(manejar).listen(PUERTO, HOST, () => {
  console.log(`Voy Tranqui lista en http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PUERTO}`);
  console.log(`  OpenRouteService: ${hayKeyOrs() ? 'key configurada' : 'FALTA ORS_API_KEY en .env'}`);
  console.log(`  TomTom (tráfico): ${hayKeyTomTom() ? 'key configurada' : 'sin key (opcional)'}`);
  if (red) console.log(`  Vías de OSM: ${red.info.total} (datos del ${red.info.datosOsm?.slice(0, 10) ?? '?'})`);
});
