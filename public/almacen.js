// Datos que se guardan solo en este equipo (favoritos, opiniones, puntos a evitar, práctica, batería).
// localStorage puede no estar disponible (modo privado, vista previa): todo falla en silencio.

const PREFIJO = 'voytranqui:';

export function leer(clave, porDefecto) {
  try {
    const texto = localStorage.getItem(PREFIJO + clave);
    return texto === null ? porDefecto : JSON.parse(texto);
  } catch {
    return porDefecto;
  }
}

export function guardar(clave, valor) {
  try {
    localStorage.setItem(PREFIJO + clave, JSON.stringify(valor));
    return true;
  } catch {
    return false;
  }
}

// Borra todo lo de la app en este equipo, incluidas las preferencias viejas sin prefijo.
export function borrarTodo() {
  try {
    for (const clave of Object.keys(localStorage)) {
      if (clave.startsWith(PREFIJO) || clave.startsWith('ruta-tranquila-') || clave === 'verCiclovias') localStorage.removeItem(clave);
    }
  } catch {
    // Nada que borrar.
  }
}
