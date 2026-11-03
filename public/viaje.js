// Modo viaje: sigue tu ubicación sobre la ruta y te guía por voz. La ubicación se queda en el celular.
// "Ensayo" recorre la ruta solo, a velocidad rápida, para escuchar la guía antes de salir.

const M_LAT = 110_574;
const M_LON = 111_320 * Math.cos((-12.05 * Math.PI) / 180);
const aXY = ([lat, lon]) => [lon * M_LON, lat * M_LAT];

const AVISO_LEJOS = 200; // m antes de una maniobra
const AVISO_AHORA = 35;
const AVISO_CRITICO = 150;
const FUERA_DE_RUTA = 40; // m de distancia a la ruta
const PASO_ENSAYO = 40; // m por segundo en el ensayo

// Las abreviaturas se leen mal en voz alta.
const paraVoz = (t) =>
  t.replace(/\bav\./gi, 'Avenida').replace(/\bjr\./gi, 'Jirón').replace(/\bpsje\./gi, 'Pasaje').replace(/\bprol\./gi, 'Prolongación');

function hablar(texto, urgente = false) {
  if (!('speechSynthesis' in window)) return;
  if (urgente) speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(paraVoz(texto));
  const voces = speechSynthesis.getVoices().filter((v) => v.lang.startsWith('es'));
  u.voice = ['es-PE', 'es-419', 'es-US', 'es-MX', 'es-ES'].map((l) => voces.find((v) => v.lang === l)).find(Boolean) ?? voces[0] ?? null;
  u.lang = u.voice?.lang ?? 'es-PE';
  speechSynthesis.speak(u);
}

const redondear = (m) => (m > 100 ? Math.round(m / 50) * 50 : Math.round(m / 10) * 10);

export function iniciarViaje(ruta, { mapa, el, ensayo, alRecalcular }) {
  const P = ruta.geometria.map(aXY);
  const acumulado = [0];
  for (let i = 1; i < P.length; i++) acumulado.push(acumulado[i - 1] + Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]));
  const total = acumulado.at(-1);
  const pasos = ruta.pasos.map((p) => ({ ...p, dichoLejos: false, dichoAhora: false }));
  const criticos = ruta.puntosCriticos.filter((p) => p.tipo !== 'trafico').map((p) => ({ ...p, dicho: false }));

  let recorrido = 0;
  let fueraDesde = null;
  let ultimoAvisoFuera = 0;
  let terminado = false;
  let bloqueo = null;
  const marcador = L.circleMarker(ruta.geometria[0], { radius: 9, color: '#fff', weight: 3, fillColor: '#2563eb', fillOpacity: 1 }).addTo(mapa);

  const caja = document.getElementById('viaje');
  const instruccion = el('p', { class: 'viaje-instruccion' }, 'Preparando…');
  const detalle = el('p', { class: 'viaje-detalle' });
  const botonRecalcular = el('button', { type: 'button', class: 'boton-secundario', hidden: true, onclick: () => { terminar(false); alRecalcular(posicionActual); } }, 'Recalcular desde aquí');
  caja.replaceChildren(
    el('p', { class: 'viaje-seguridad' }, ensayo ? 'Ensayo: la guía avanza sola para que la escuches antes de salir.' : 'Pon el celular en un soporte. Si necesitas mirar el mapa, estaciónate en un lugar seguro.'),
    instruccion,
    detalle,
    el('div', { class: 'viaje-botones' }, botonRecalcular, el('button', { type: 'button', class: 'boton-principal', onclick: () => terminar(true) }, 'Terminar')),
  );
  caja.hidden = false;
  let posicionActual = null;

  // Proyecta la posición sobre la ruta, buscando cerca de donde ibas para no saltar a otro tramo.
  function proyectar(xy) {
    let mejor = { d: Infinity, s: recorrido };
    for (let i = 0; i < P.length - 1; i++) {
      if (acumulado[i + 1] < recorrido - 200 || acumulado[i] > recorrido + 1000) continue;
      const [a, b] = [P[i], P[i + 1]];
      const dx = b[0] - a[0];
      const dy = b[1] - a[1];
      const l2 = dx * dx + dy * dy || 1;
      const t = Math.max(0, Math.min(1, ((xy[0] - a[0]) * dx + (xy[1] - a[1]) * dy) / l2));
      const d = Math.hypot(xy[0] - a[0] - t * dx, xy[1] - a[1] - t * dy);
      if (d < mejor.d) mejor = { d, s: acumulado[i] + t * Math.sqrt(l2) };
    }
    return mejor;
  }

  function actualizar(lat, lon) {
    if (terminado) return;
    posicionActual = { lat, lon };
    marcador.setLatLng([lat, lon]);
    mapa.panTo([lat, lon], { animate: true });
    const { d, s } = proyectar(aXY([lat, lon]));

    if (d > FUERA_DE_RUTA) {
      fueraDesde ??= Date.now();
      if (Date.now() - fueraDesde > 8000 && Date.now() - ultimoAvisoFuera > 60000) {
        ultimoAvisoFuera = Date.now();
        hablar('Te saliste de la ruta. Cuando puedas, estaciónate en un lugar seguro y revisa el mapa.', true);
        instruccion.textContent = 'Te saliste de la ruta';
        detalle.textContent = 'Estaciónate en un lugar seguro y toca "Recalcular desde aquí".';
        botonRecalcular.hidden = false;
      }
      return;
    }
    if (fueraDesde && botonRecalcular.hidden === false) hablar('Volviste a la ruta.');
    fueraDesde = null;
    botonRecalcular.hidden = true;
    recorrido = Math.max(recorrido, s);

    if (total - recorrido < 25) {
      hablar('Llegaste a tu destino.', true);
      instruccion.textContent = 'Llegaste a tu destino';
      detalle.textContent = '';
      return terminar(false, 4000);
    }

    for (const c of criticos) {
      const faltan = c.metros - recorrido;
      if (!c.dicho && faltan <= AVISO_CRITICO && faltan > -20) {
        c.dicho = true;
        hablar(`Atención: en ${redondear(Math.max(faltan, 10))} metros, ${c.titulo.toLowerCase()}. ${c.detalle}`);
      }
    }

    const siguiente = pasos.find((p) => p.inicioMetros > recorrido + 5);
    if (!siguiente) return;
    const faltan = siguiente.inicioMetros - recorrido;
    instruccion.textContent = siguiente.maniobra;
    detalle.textContent = `En ${redondear(faltan)} m${siguiente.avisos[0] ? ` · ${siguiente.avisos[0]}` : ''}`;
    if (!siguiente.dichoAhora && faltan <= AVISO_AHORA) {
      siguiente.dichoAhora = siguiente.dichoLejos = true;
      hablar(`Ahora, ${siguiente.maniobra.charAt(0).toLowerCase()}${siguiente.maniobra.slice(1)}.`, true);
    } else if (!siguiente.dichoLejos && faltan <= AVISO_LEJOS) {
      siguiente.dichoLejos = true;
      hablar(`En ${redondear(faltan)} metros, ${siguiente.maniobra.charAt(0).toLowerCase()}${siguiente.maniobra.slice(1)}.`);
    }
  }

  // La pantalla debe quedar encendida: con la pantalla apagada el navegador deja de dar la ubicación.
  const pedirBloqueo = async () => {
    try {
      bloqueo = await navigator.wakeLock?.request('screen');
    } catch {
      // No disponible: la guía sigue, pero conviene desactivar el bloqueo automático.
    }
  };
  const alVolver = () => document.visibilityState === 'visible' && !terminado && pedirBloqueo();
  document.addEventListener('visibilitychange', alVolver);
  pedirBloqueo();

  let detener;
  if (ensayo) {
    let s = 0;
    const id = setInterval(() => {
      s = Math.min(total, s + PASO_ENSAYO);
      const i = Math.max(0, acumulado.findIndex((a) => a >= s) - 1);
      const t = (s - acumulado[i]) / (acumulado[i + 1] - acumulado[i] || 1);
      const [la, lo] = [ruta.geometria[i], ruta.geometria[i + 1] ?? ruta.geometria[i]];
      actualizar(la[0] + t * (lo[0] - la[0]), la[1] + t * (lo[1] - la[1]));
    }, 1000);
    detener = () => clearInterval(id);
  } else {
    const id = navigator.geolocation.watchPosition(
      (p) => actualizar(p.coords.latitude, p.coords.longitude),
      (e) => {
        instruccion.textContent = e.code === 1 ? 'Activa el permiso de ubicación para usar el modo viaje.' : 'No puedo obtener tu ubicación.';
      },
      { enableHighAccuracy: true, maximumAge: 2000, timeout: 15000 },
    );
    detener = () => navigator.geolocation.clearWatch(id);
  }

  hablar(ensayo ? 'Ensayo de la ruta.' : 'Iniciando viaje. Maneja con calma.', true);

  function terminar(cancelar, espera = 0) {
    terminado = true;
    detener();
    document.removeEventListener('visibilitychange', alVolver);
    bloqueo?.release?.().catch(() => {});
    if (cancelar) speechSynthesis?.cancel();
    setTimeout(() => {
      marcador.remove();
      caja.hidden = true;
    }, espera);
  }
}
