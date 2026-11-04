// Estacionamientos cerca del destino (OpenStreetMap): dónde dejar el auto, la moto o la bici al llegar.
// Datos en data/estacionamientos-lima.json (npm run datos:estacionamientos). Si falta el archivo, no se sugiere nada.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { aMetros, distancia } from './geo.js';

export const ARCHIVO_ESTACIONAMIENTOS = fileURLToPath(new URL('../data/estacionamientos-lima.json', import.meta.url));

const TIPO = { parking: 'a', motorcycle_parking: 'm', bicycle_parking: 'b' };
const SIN_ACCESO = new Set(['private', 'no', 'permit', 'delivery']);
const PAGO = { yes: 1, no: 0 };

// Elementos de Overpass → [lat, lon, tipo, nombre, pago, soloClientes]. Se descartan los privados.
export function convertirEstacionamientos(elementos) {
  const lugares = [];
  for (const e of elementos) {
    const t = e.tags ?? {};
    const tipo = TIPO[t.amenity];
    const lat = e.lat ?? e.center?.lat;
    const lon = e.lon ?? e.center?.lon;
    if (!tipo || lat === undefined || lon === undefined || SIN_ACCESO.has(t.access)) continue;
    lugares.push([
      Number(lat.toFixed(6)),
      Number(lon.toFixed(6)),
      tipo,
      t.name?.trim() || null,
      PAGO[t.fee] ?? null,
      t.access === 'customers' ? 1 : 0,
      tipo === 'a' && t.motorcycle === 'no' ? 1 : 0,
    ]);
  }
  return lugares;
}

export function cargarEstacionamientos(archivo = ARCHIVO_ESTACIONAMIENTOS) {
  let datos;
  try {
    datos = JSON.parse(readFileSync(archivo, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
  const celda = 250;
  const celdas = new Map();
  const lugares = datos.lugares.map(([lat, lon, tipo, nombre, pago, clientes, sinMotos]) => {
    const xy = aMetros([lon, lat]);
    const lugar = { lat, lon, tipo, nombre, pago, clientes: Boolean(clientes), sinMotos: Boolean(sinMotos), xy };
    const clave = `${Math.floor(xy[0] / celda)},${Math.floor(xy[1] / celda)}`;
    (celdas.get(clave) ?? celdas.set(clave, []).get(clave)).push(lugar);
    return lugar;
  });
  return { lugares, celdas, celda, info: { datosOsm: datos.datosOsm, total: lugares.length } };
}

// Qué estacionamientos sirven a cada vehículo y hasta qué distancia se sugieren (unos 5 min a pie).
const ACEPTA = {
  auto: (l) => l.tipo === 'a',
  motoElectrica: (l) => l.tipo === 'm' || (l.tipo === 'a' && !l.sinMotos),
  bici: (l) => l.tipo === 'b',
};
const RADIO = { auto: 400, motoElectrica: 400, bici: 300 };

export function estacionamientosCerca(datos, { lat, lon }, vehiculo = 'auto', maximo = 3) {
  if (!datos) return [];
  const acepta = ACEPTA[vehiculo] ?? ACEPTA.auto;
  const radio = RADIO[vehiculo] ?? 400;
  const p = aMetros([lon, lat]);
  const { celda, celdas } = datos;
  const encontrados = [];
  for (let ix = Math.floor((p[0] - radio) / celda); ix <= Math.floor((p[0] + radio) / celda); ix++) {
    for (let iy = Math.floor((p[1] - radio) / celda); iy <= Math.floor((p[1] + radio) / celda); iy++) {
      for (const l of celdas.get(`${ix},${iy}`) ?? []) {
        const metros = distancia(p, l.xy);
        if (metros <= radio && acepta(l)) encontrados.push({ ...l, metros });
      }
    }
  }
  // Por cercanía; los "solo clientes" (de una tienda o centro comercial) se dicen así en la interfaz.
  return encontrados
    .sort((a, b) => a.metros - b.metros)
    .filter((l, i, lista) => !lista.slice(0, i).some((o) => distancia(o.xy, l.xy) < 30))
    .slice(0, maximo)
    .map(({ lat, lon, tipo, nombre, pago, clientes, metros }) => ({ lat, lon, tipo, nombre, pago, clientes, metros: Math.round(metros / 10) * 10 }));
}
