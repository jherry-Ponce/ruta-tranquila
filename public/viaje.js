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

const MANTENER_PARA_SALIR = 2000; // ms: en modo bolsillo, mantener presionado para volver

// Ubica un punto sobre la ruta (P y acumulado en metros). Normalmente busca cerca de donde ibas para
// no saltar a otro tramo; con `amplia` busca en todo lo que falta, porque al volver a encender la
// pantalla la persona pudo avanzar mucho sin que el navegador recibiera el GPS.
export function proyectarEnRuta(P, acumulado, xy, recorrido, amplia = false) {
  let mejor = { d: Infinity, s: recorrido };
  for (let i = 0; i < P.length - 1; i++) {
    if (acumulado[i + 1] < recorrido - 200 || (!amplia && acumulado[i] > recorrido + 1000)) continue;
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

// Enlace para seguir lo que falta de la ruta con Google Maps, que sí guía con la pantalla apagada.
// Sin origen, Google Maps parte de la ubicación actual; hasta 3 puntos de paso (el límite en el
// celular) lo mantienen sobre el recorrido tranquilo.
export function enlaceSeguirEnGoogle(geometria, acumulado, recorrido, modo = 'driving') {
  const total = acumulado.at(-1);
  const fmt = ([lat, lon]) => `${lat.toFixed(5)},${lon.toFixed(5)}`;
  const q = new URLSearchParams({ api: '1', destination: fmt(geometria.at(-1)), travelmode: modo, dir_action: 'navigate' });
  const falta = total - recorrido;
  if (falta > 1500) {
    const puntos = [0.25, 0.5, 0.75].map((f) => geometria[Math.max(0, acumulado.findIndex((a) => a >= recorrido + f * falta))]);
    q.set('waypoints', puntos.map(fmt).join('|'));
  }
  return `https://www.google.com/maps/dir/?${q}`;
}

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
  let buscarEnTodo = false; // tras volver a encender la pantalla
  let repetirSiguiente = false;
  const marcador = L.circleMarker(ruta.geometria[0], { radius: 9, color: '#fff', weight: 3, fillColor: '#2563eb', fillOpacity: 1 }).addTo(mapa);

  const caja = document.getElementById('viaje');
  const instruccion = el('p', { class: 'viaje-instruccion' }, 'Preparando…');
  const detalle = el('p', { class: 'viaje-detalle' });
  const botonRecalcular = el('button', { type: 'button', class: 'boton-secundario', hidden: true, onclick: () => { terminar(false); alRecalcular(posicionActual); } }, 'Recalcular desde aquí');
  const modoGoogle = ruta.enlaceGoogleMaps?.includes('travelmode=bicycling') ? 'bicycling' : 'driving';
  const enlaceGoogle = el(
    'a',
    { class: 'viaje-google', target: '_blank', rel: 'noopener noreferrer', href: ruta.enlaceGoogleMaps ?? '#' },
    'Seguir con Google Maps (guía con la pantalla apagada)',
  );
  // El enlace se arma al tocarlo, con lo que falta del recorrido. Nuestra guía termina para que no
  // hablen dos voces a la vez.
  enlaceGoogle.addEventListener('click', () => {
    enlaceGoogle.href = enlaceSeguirEnGoogle(ruta.geometria, acumulado, recorrido, modoGoogle);
    terminar(true);
  });
  const botonBolsillo = el('button', { type: 'button', class: 'boton-secundario', hidden: ensayo, onclick: () => activarBolsillo() }, 'Modo bolsillo');
  caja.replaceChildren(
    el(
      'p',
      { class: 'viaje-seguridad' },
      ensayo
        ? 'Ensayo: la guía avanza sola para que la escuches antes de salir.'
        : 'Pon el celular en un soporte. Si tienes que guardarlo, toca "Modo bolsillo" y no apagues la pantalla con el botón: apagada, el navegador deja de recibir tu ubicación.',
    ),
    instruccion,
    detalle,
    el('div', { class: 'viaje-botones' }, botonRecalcular, botonBolsillo, el('button', { type: 'button', class: 'boton-principal', onclick: () => terminar(true) }, 'Terminar')),
    ...(ensayo ? [] : [enlaceGoogle]),
  );
  caja.hidden = false;
  let posicionActual = null;

  function actualizar(lat, lon) {
    if (terminado) return;
    posicionActual = { lat, lon };
    marcador.setLatLng([lat, lon]);
    mapa.panTo([lat, lon], { animate: true });
    const { d, s } = proyectarEnRuta(P, acumulado, aXY([lat, lon]), recorrido, buscarEnTodo);
    buscarEnTodo = false;

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
    if (repetirSiguiente) {
      // Al retomar se repite la próxima indicación aunque ya se hubiera dicho.
      repetirSiguiente = false;
      if (faltan > AVISO_AHORA) {
        siguiente.dichoLejos = true;
        hablar(`Retomando la guía. En ${redondear(faltan)} metros, ${siguiente.maniobra.charAt(0).toLowerCase()}${siguiente.maniobra.slice(1)}.`, true);
        return;
      }
    }
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
  // Con la pantalla apagada el navegador congela la página: no hay GPS ni voz. Al ocultarse se intenta
  // avisar por voz (en algunos celulares alcanza a sonar) y al volver se retoma desde donde estés.
  const alCambiarVisibilidad = () => {
    if (terminado || ensayo) return;
    if (document.visibilityState === 'hidden') {
      hablar('La guía queda en pausa mientras la pantalla esté apagada o en otra app. Para guardar el celular, usa el modo bolsillo.', true);
      return;
    }
    pedirBloqueo();
    buscarEnTodo = true;
    repetirSiguiente = true;
    reiniciarGps();
  };
  document.addEventListener('visibilitychange', alCambiarVisibilidad);
  pedirBloqueo();

  // Modo bolsillo: pantalla negra y bloqueada al tacto, pero encendida, para que el GPS y la voz sigan
  // funcionando con el celular guardado. Para salir se mantiene presionado 2 segundos.
  let capaBolsillo = null;
  function activarBolsillo() {
    if (capaBolsillo) return;
    const barra = el('span', { class: 'bolsillo-progreso' });
    capaBolsillo = el(
      'div',
      { class: 'bolsillo', role: 'button', 'aria-label': 'Modo bolsillo activo. Mantén presionado dos segundos para salir.' },
      el('p', {}, 'Modo bolsillo · la guía sigue por voz'),
      el('p', {}, 'Mantén presionado 2 segundos para salir'),
      barra,
    );
    let temporizador = null;
    const soltar = () => {
      clearTimeout(temporizador);
      barra.classList.remove('llenando');
    };
    capaBolsillo.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      barra.classList.add('llenando');
      temporizador = setTimeout(salirBolsillo, MANTENER_PARA_SALIR);
    });
    for (const evento of ['pointerup', 'pointercancel', 'pointerleave']) capaBolsillo.addEventListener(evento, soltar);
    capaBolsillo.addEventListener('contextmenu', (e) => e.preventDefault());
    document.body.append(capaBolsillo);
    document.documentElement.requestFullscreen?.().catch(() => {});
    pedirBloqueo().then(() => {
      hablar(
        bloqueo
          ? 'Modo bolsillo activado. Guarda el celular sin apagar la pantalla; te seguiré guiando por voz.'
          : 'Modo bolsillo activado, pero este navegador no puede mantener la pantalla encendida. Desactiva el bloqueo automático del celular.',
        true,
      );
    });
  }
  function salirBolsillo() {
    capaBolsillo?.remove();
    capaBolsillo = null;
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    if (!terminado && posicionActual) {
      repetirSiguiente = true;
      actualizar(posicionActual.lat, posicionActual.lon);
    }
  }

  let detener;
  let reiniciarGps = () => {};
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
    let id = null;
    // Algunos navegadores no reanudan el seguimiento del GPS tras congelar la página: se vuelve a pedir.
    reiniciarGps = () => {
      if (id !== null) navigator.geolocation.clearWatch(id);
      id = navigator.geolocation.watchPosition(
        (p) => actualizar(p.coords.latitude, p.coords.longitude),
        (e) => {
          instruccion.textContent = e.code === 1 ? 'Activa el permiso de ubicación para usar el modo viaje.' : 'No puedo obtener tu ubicación.';
        },
        { enableHighAccuracy: true, maximumAge: 2000, timeout: 15000 },
      );
    };
    reiniciarGps();
    detener = () => navigator.geolocation.clearWatch(id);
  }

  hablar(ensayo ? 'Ensayo de la ruta.' : 'Iniciando viaje. Maneja con calma.', true);

  function terminar(cancelar, espera = 0) {
    terminado = true;
    detener();
    document.removeEventListener('visibilitychange', alCambiarVisibilidad);
    if (capaBolsillo) salirBolsillo();
    bloqueo?.release?.().catch(() => {});
    if (cancelar) speechSynthesis?.cancel();
    setTimeout(() => {
      marcador.remove();
      caja.hidden = true;
    }, espera);
  }
}
