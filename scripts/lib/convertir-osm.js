import { infraestructuraBici } from '../../server/infraestructura-bici.js';
const CLASES = { motorway: 'autopista', trunk: 'autopista', primary: 'primaria', secondary: 'secundaria', cycleway: 'ciclovia', residential: 'residencial', service: 'residencial', living_street: 'residencial' };
export function convertirVia(elemento, semaforos = new Map()) {
  const t = elemento.tags ?? {};
  const base = t.highway.replace(/_link$/, '');
  const independiente = t.highway === 'cycleway' || ['path', 'footway', 'pedestrian'].includes(t.highway) && t.bicycle === 'designated';
  const via = {
    o: elemento.id, n: t.name ?? '', c: independiente ? 'ciclovia' : CLASES[base] ?? 'menor',
    s: (elemento.nodes ?? []).filter((id) => semaforos.has(id)).map((id) => semaforos.get(id)),
    g: elemento.geometry.map((p) => [Number(p.lon.toFixed(6)), Number(p.lat.toFixed(6))]),
  };
  const b = infraestructuraBici(t);
  if (b.length || independiente) via.b = b;
  if (t.highway.endsWith('_link')) via.r = 1;
  if (t.bridge && t.bridge !== 'no' || t.tunnel && t.tunnel !== 'no' || t.layer && t.layer !== '0') via.d = 1;
  return via;
}
