// Conserva la red vial más reciente si una réplica de Overpass está atrasada.
export function fusionarVias(anteriores, nuevas) {
  const resultado = anteriores.map((v) => ({ ...v }));
  const clave = (v) => v.n + ':' + JSON.stringify(v.g);
  const porGeometria = new Map(resultado.map((v, i) => [clave(v), i]));
  const porId = new Map(resultado.filter((v) => v.o).map((v) => [v.o, resultado.indexOf(v)]));
  for (const via of nuevas.filter((v) => v.b?.length)) {
    const i = porId.get(via.o) ?? porGeometria.get(clave(via));
    if (i !== undefined) {
      // Los datos ciclistas no reemplazan semáforos ni clasificación vial recientes.
      resultado[i] = resultado[i].x ? { ...via, x: 1 } : { ...resultado[i], o: via.o, b: via.b };
    } else {
      porGeometria.set(clave(via), resultado.length);
      if (via.o) porId.set(via.o, resultado.length);
      resultado.push({ ...via, x: 1 }); // Solo capa ciclista: no duplica avenidas ni cruces.
    }
  }
  return resultado;
}
