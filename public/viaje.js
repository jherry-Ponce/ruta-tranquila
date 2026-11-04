import { enlaceWhatsApp, mensajeEnCamino, mensajeLlegue } from './enlaces.js';

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

// Dentro de la app Android (Capacitor) hay GPS y voz nativos, que siguen funcionando con la pantalla
// apagada. En el navegador se usan los de la web.
// La web se carga desde Vercel sin la librería de Capacitor: no existe `Capacitor.registerPlugin`, solo las
// funciones del puente que la app inyecta (`nativePromise` para llamadas y `nativeCallback` para avisos repetidos).
const capacitor = typeof window !== 'undefined' ? window.Capacitor : undefined;
const nativo = capacitor?.isNativePlatform?.() === true && typeof capacitor.nativePromise === 'function';
const llamarNativo = (plugin, metodo, opciones = {}) => window.Capacitor.nativePromise(plugin, metodo, opciones);
const seguirNativo = (plugin, metodo, opciones, aviso) => window.Capacitor.nativeCallback(plugin, metodo, opciones, aviso);

let idiomaNativo = null;
async function hablarNativo(texto, urgente) {
  idiomaNativo ??= (async () => {
    for (const lang of ['es-PE', 'es-419', 'es-US', 'es-MX', 'es-ES']) {
      try {
        if ((await llamarNativo('TextToSpeech', 'isLanguageSupported', { lang })).supported) return lang;
      } catch {
        // Se prueba el siguiente.
      }
    }
    return 'es-ES';
  })();
  try {
    // queueStrategy: 0 corta lo que se está diciendo, 1 lo pone en cola.
    await llamarNativo('TextToSpeech', 'speak', { text: paraVoz(texto), lang: await idiomaNativo, rate: 1, queueStrategy: urgente ? 0 : 1 });
  } catch (error) {
    console.warn('Voz nativa:', error);
  }
}

function callar() {
  if (nativo) llamarNativo('TextToSpeech', 'stop').catch(() => {});
  else window.speechSynthesis?.cancel();
}

function hablar(texto, urgente = false) {
  if (nativo) return void hablarNativo(texto, urgente);
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

// Opciones: alRecalcular(pos) recálculo manual; alDesviarse(pos) → Promise<ruta> recálculo automático;
// alOpinar(opinion) guarda la opinión del viaje; alLlegar(medicion) recibe el tiempo real para aprender el ritmo; alTerminar() al cerrar; destino: nombre para los mensajes;
// practica: { nivel } si es un circuito de práctica.
export function iniciarViaje(rutaInicial, { mapa, el, ensayo, alRecalcular, alTerminar, alDesviarse, alOpinar, alLlegar, alMarcarLugar, destino = '', practica = null }) {
  // La ruta se puede reemplazar a mitad de camino (recálculo automático) sin cortar la guía.
  let ruta, P, acumulado, total, pasos, criticos;
  let recorrido = 0;
  function cargarRuta(nueva) {
    ruta = nueva;
    P = ruta.geometria.map(aXY);
    acumulado = [0];
    for (let i = 1; i < P.length; i++) acumulado.push(acumulado[i - 1] + Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]));
    total = acumulado.at(-1);
    pasos = ruta.pasos.map((p) => ({ ...p, dichoLejos: false, dichoAhora: false }));
    criticos = ruta.puntosCriticos.filter((p) => p.tipo !== 'trafico').map((p) => ({ ...p, dicho: false }));
    recorrido = 0;
  }
  cargarRuta(rutaInicial);

  let fueraDesde = null;
  let ultimoAvisoFuera = 0;
  let terminado = false;
  let bloqueo = null;
  let buscarEnTodo = false; // tras volver a encender la pantalla
  let repetirSiguiente = false;
  let fraseRetomar = 'Retomando la guía.';
  let recalculando = false;
  // Para aprender el ritmo real: solo viajes completos, sin recálculo ni pausas largas del GPS.
  let inicioMovimiento = null;
  let recorridoInicio = 0;
  let ultimaUbicacion = null;
  let huboPausa = false;
  let rutaCambiada = false;
  const marcador = L.circleMarker(rutaInicial.geometria[0], { radius: 9, color: '#fff', weight: 3, fillColor: '#2563eb', fillOpacity: 1 }).addTo(mapa);

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
  // También en el ensayo, para probarlo en casa antes de salir.
  // En la app no hace falta: la guía sigue con la pantalla apagada.
  const botonBolsillo = el('button', { type: 'button', class: 'boton-secundario', hidden: nativo, onclick: () => activarBolsillo() }, 'Modo bolsillo');
  // Avisar a la familia por WhatsApp con la hora estimada de llegada (se arma al tocarlo).
  const botonAvisar = el('a', { class: 'boton-secundario boton-avisar', target: '_blank', rel: 'noopener noreferrer', href: '#' }, 'Avisar');
  botonAvisar.addEventListener('click', () => {
    const duracion = ruta.duracionTotalSegundos ?? ruta.duracionSegundos ?? 0;
    botonAvisar.href = enlaceWhatsApp(mensajeEnCamino(destino, duracion * (1 - recorrido / (total || 1))));
  });
  caja.replaceChildren(
    el(
      'p',
      { class: 'viaje-seguridad' },
      ensayo
        ? 'Ensayo: la guía avanza sola para que la escuches antes de salir.'
        : nativo
          ? 'Pon el celular en un soporte. Si se cae o tienes que guardarlo, puedes apagar la pantalla: la guía sigue por voz.'
          : 'Pon el celular en un soporte. Si tienes que guardarlo, toca "Modo bolsillo" y no apagues la pantalla con el botón: apagada, el navegador deja de recibir tu ubicación.',
    ),
    instruccion,
    detalle,
    el(
      'div',
      { class: 'viaje-botones' },
      botonRecalcular,
      botonBolsillo,
      !ensayo && !practica && botonAvisar,
      el('button', { type: 'button', class: 'boton-principal', onclick: () => terminar(true, true) }, 'Terminar'),
    ),
    ...(ensayo ? [] : [enlaceGoogle]),
  );
  caja.hidden = false;
  let posicionActual = null;

  function actualizar(lat, lon) {
    if (terminado) return;
    posicionActual = { lat, lon };
    const ahora = Date.now();
    if (ultimaUbicacion && ahora - ultimaUbicacion > 120_000) huboPausa = true; // p. ej. pantalla apagada en la web
    ultimaUbicacion = ahora;
    marcador.setLatLng([lat, lon]);
    mapa.panTo([lat, lon], { animate: true });
    const { d, s } = proyectarEnRuta(P, acumulado, aXY([lat, lon]), recorrido, buscarEnTodo);
    buscarEnTodo = false;

    if (d > FUERA_DE_RUTA) {
      fueraDesde ??= Date.now();
      if (Date.now() - fueraDesde > 8000 && !recalculando && Date.now() - ultimoAvisoFuera > 45000) {
        ultimoAvisoFuera = Date.now();
        if (alDesviarse && !ensayo) {
          recalcularSolo();
        } else {
          hablar('Te saliste de la ruta. Cuando puedas, estaciónate en un lugar seguro y revisa el mapa.', true);
          mostrarFueraDeRuta();
        }
      }
      return;
    }
    if (fueraDesde && botonRecalcular.hidden === false) hablar('Volviste a la ruta.');
    fueraDesde = null;
    botonRecalcular.hidden = true;
    recorrido = Math.max(recorrido, s);
    if (!inicioMovimiento && recorrido > 30) {
      inicioMovimiento = ahora;
      recorridoInicio = recorrido;
    }

    if (total - recorrido < 25) return llegar();

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
    let acabaDeRetomar = false;
    if (repetirSiguiente) {
      // Al retomar (pantalla encendida de nuevo o ruta nueva) se repite la próxima indicación.
      repetirSiguiente = false;
      const frase = fraseRetomar;
      fraseRetomar = 'Retomando la guía.';
      if (faltan > AVISO_AHORA) {
        siguiente.dichoLejos = true;
        hablar(`${frase} En ${redondear(faltan)} metros, ${siguiente.maniobra.charAt(0).toLowerCase()}${siguiente.maniobra.slice(1)}.`, true);
        return;
      }
      hablar(frase, true);
      acabaDeRetomar = true;
    }
    if (!siguiente.dichoAhora && faltan <= AVISO_AHORA) {
      siguiente.dichoAhora = siguiente.dichoLejos = true;
      hablar(`Ahora, ${siguiente.maniobra.charAt(0).toLowerCase()}${siguiente.maniobra.slice(1)}.`, !acabaDeRetomar);
    } else if (!siguiente.dichoLejos && faltan <= AVISO_LEJOS) {
      siguiente.dichoLejos = true;
      hablar(`En ${redondear(faltan)} metros, ${siguiente.maniobra.charAt(0).toLowerCase()}${siguiente.maniobra.slice(1)}.`);
    }
  }

  function mostrarFueraDeRuta() {
    instruccion.textContent = 'Te saliste de la ruta';
    detalle.textContent = 'Estaciónate en un lugar seguro y toca "Recalcular desde aquí".';
    botonRecalcular.hidden = false;
  }

  // Recálculo automático: busca otra ruta tranquila desde donde estás, sin que toques el celular.
  async function recalcularSolo() {
    recalculando = true;
    hablar('Tranquilo, te desviaste. Busco otra ruta tranquila desde aquí; sigue con calma.', true);
    instruccion.textContent = 'Buscando otra ruta tranquila…';
    detalle.textContent = 'Sigue con calma; no hace falta tocar el celular.';
    try {
      const nueva = await alDesviarse(posicionActual);
      if (terminado) return;
      if (!nueva) throw new Error('Sin ruta nueva');
      cargarRuta(nueva);
      rutaCambiada = true;
      fueraDesde = null;
      botonRecalcular.hidden = true;
      buscarEnTodo = true;
      repetirSiguiente = true;
      fraseRetomar = 'Listo, encontré otra ruta tranquila.';
      if (posicionActual) actualizar(posicionActual.lat, posicionActual.lon);
    } catch {
      if (terminado) return;
      hablar('No pude buscar otra ruta. Cuando puedas, estaciónate en un lugar seguro y revisa el mapa.', true);
      mostrarFueraDeRuta();
    } finally {
      recalculando = false;
    }
  }

  // Compara el tiempo real con el estimado para que la app aprenda tu ritmo.
  function medirRitmo() {
    if (ensayo || rutaCambiada || huboPausa || !inicioMovimiento || !alLlegar || total < 1000) return;
    const segundosEstimados = (ruta.duracionSegundos ?? 0) * ((total - recorridoInicio) / total);
    if (segundosEstimados < 120) return;
    try {
      alLlegar({ segundosReales: (Date.now() - inicioMovimiento) / 1000, segundosEstimados, ajusteAplicado: ruta.ajusteRitmo ?? 1 });
    } catch (error) {
      console.warn('Al medir el ritmo:', error);
    }
  }

  function llegar() {
    medirRitmo();
    hablar(practica ? '¡Terminaste la práctica! Bien hecho.' : 'Llegaste a tu destino.', true);
    detenerSeguimiento(false);
    if (ensayo || !alOpinar) {
      instruccion.textContent = practica ? 'Práctica terminada' : 'Llegaste a tu destino';
      detalle.textContent = '';
      setTimeout(cerrar, 4000);
      return;
    }
    mostrarOpinion(true);
  }

  // "¿Qué tal estuvo?": una valoración y los puntos difíciles, que se evitarán en las próximas rutas.
  function mostrarOpinion(llego) {
    const pasados = criticos.filter((c) => (c.tipo === 'cruce' || c.tipo === 'tramo') && c.metros <= recorrido + 30);
    let valoracion = null;
    const elegidos = new Set();
    const opciones = [
      ['tranquilo', '😌 Tranquilo'],
      ['normal', '🙂 Normal'],
      ['estresante', '😰 Estresante'],
    ];
    const botones = opciones.map(([valor, texto]) =>
      el('button', { type: 'button', class: 'boton-opinion', 'aria-pressed': 'false', 'data-valor': valor }, texto),
    );
    botones.forEach((b) =>
      b.addEventListener('click', () => {
        valoracion = b.dataset.valor;
        botones.forEach((o) => o.setAttribute('aria-pressed', String(o === b)));
      }),
    );
    const lista = pasados.length
      ? el(
          'ul',
          { class: 'opinion-puntos' },
          pasados.map((c, k) =>
            el(
              'li',
              {},
              el(
                'label',
                {},
                el('input', { type: 'checkbox', onchange: (ev) => (ev.target.checked ? elegidos.add(k) : elegidos.delete(k)) }),
                ` ${c.titulo}`,
              ),
            ),
          ),
        )
      : null;
    const listo = (luego) => {
      if (valoracion || elegidos.size) {
        try {
          alOpinar({
            valoracion,
            llego,
            practica: practica ? practica.nivel : null,
            metros: Math.round(recorrido),
            dificiles: [...elegidos].map((k) => ({ lat: pasados[k].lat, lon: pasados[k].lon, titulo: pasados[k].titulo, motivo: 'dificil' })),
          });
        } catch (error) {
          console.warn('Al guardar la opinión:', error);
        }
      }
      cerrar();
      try {
        luego?.();
      } catch (error) {
        console.warn('Al marcar un lugar:', error);
      }
    };
    // Un lugar inseguro no tiene por qué ser un cruce: se marca tocando el mapa, ya con el viaje cerrado.
    const marcarInseguro =
      alMarcarLugar &&
      el('button', { type: 'button', class: 'enlace-boton opinion-inseguro', onclick: () => listo(alMarcarLugar) }, '¿Te sentiste inseguro en alguna parte? Márcala en el mapa');
    const avisarLlegue = el(
      'a',
      { class: 'boton-secundario boton-avisar', target: '_blank', rel: 'noopener noreferrer', href: enlaceWhatsApp(mensajeLlegue(destino)) },
      'Avisar que llegué',
    );
    caja.replaceChildren(
      el('p', { class: 'viaje-instruccion' }, llego ? (practica ? '¡Práctica terminada! 👏' : 'Llegaste 🙂') : 'Viaje terminado'),
      el('p', { class: 'viaje-detalle' }, '¿Qué tal estuvo?'),
      el('div', { class: 'opinion-valores' }, botones),
      lista && el('p', { class: 'viaje-detalle' }, '¿Algún punto fue difícil? Márcalo y lo evitaré la próxima vez:'),
      lista,
      marcarInseguro,
      el('div', { class: 'viaje-botones' }, llego && !practica && avisarLlegue, el('button', { type: 'button', class: 'boton-principal', onclick: () => listo() }, 'Listo')),
    );
    caja.classList.add('viaje-opinion');
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
    // En la app el GPS y la voz nativos no se pausan.
    if (terminado || ensayo || nativo) return;
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

  let detener = () => {};
  let reiniciarGps = () => {};

  // GPS nativo con un servicio en primer plano: Android muestra una notificación fija y sigue entregando
  // la ubicación con la pantalla apagada o el celular en el bolsillo. Si no se puede iniciar, devuelve
  // false y el viaje sigue con el GPS de la web.
  function iniciarGpsNativo() {
    try {
      const idNativo = seguirNativo(
        'BackgroundGeolocation',
        'addWatcher',
        {
          backgroundTitle: 'Voy Tranqui · viaje en curso',
          backgroundMessage: 'Te sigo guiando por voz aunque apagues la pantalla.',
          requestPermissions: true,
          stale: false,
          distanceFilter: 5,
        },
        (posicion, error) => {
          if (terminado) return;
          if (error) {
            if (error.code === 'NOT_AUTHORIZED') {
              instruccion.textContent = 'Activa el permiso de ubicación de Voy Tranqui para usar el modo viaje.';
              if (window.confirm('Voy Tranqui necesita tu ubicación para guiarte. ¿Abrir los ajustes ahora?')) {
                llamarNativo('BackgroundGeolocation', 'openSettings').catch(() => {});
              }
            } else {
              instruccion.textContent = `No puedo obtener tu ubicación (${error.message || error.code || 'GPS'}).`;
            }
            return;
          }
          if (posicion) actualizar(posicion.latitude, posicion.longitude);
        },
      );
      instruccion.textContent = 'Buscando tu ubicación…';
      detener = () => llamarNativo('BackgroundGeolocation', 'removeWatcher', { id: idNativo }).catch(() => {});
      return true;
    } catch (error) {
      console.warn('GPS nativo:', error);
      return false;
    }
  }
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
  } else if (nativo && iniciarGpsNativo()) {
    // GPS nativo iniciado (ver iniciarGpsNativo).
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

  hablar(
    practica
      ? `${ensayo ? 'Ensayo de la' : 'Iniciando la'} práctica de nivel ${practica.nivel}. Vuelves al punto de partida.`
      : ensayo
        ? 'Ensayo de la ruta.'
        : 'Iniciando viaje. Maneja con calma.',
    true,
  );

  // Apaga GPS, voz y bloqueo de pantalla; la barra sigue visible (por ejemplo, para la opinión).
  function detenerSeguimiento(cancelar) {
    terminado = true;
    // Pase lo que pase al apagar el GPS o la voz, la barra del viaje se puede cerrar.
    for (const paso of [
      () => detener(),
      () => document.removeEventListener('visibilitychange', alCambiarVisibilidad),
      () => capaBolsillo && salirBolsillo(),
      () => bloqueo?.release?.().catch(() => {}),
      () => cancelar && callar(),
    ]) {
      try {
        paso();
      } catch (error) {
        console.warn('Al terminar el viaje:', error);
      }
    }
  }

  function cerrar() {
    marcador.remove();
    caja.hidden = true;
    caja.classList.remove('viaje-opinion');
    try {
      alTerminar?.();
    } catch (error) {
      console.warn('Al cerrar el viaje:', error);
    }
  }

  // opinar: solo el botón "Terminar"; si ya recorriste algo, pregunta qué tal estuvo antes de cerrar.
  function terminar(cancelar, opinar = false) {
    if (terminado) return cerrar();
    detenerSeguimiento(cancelar);
    if (opinar && !ensayo && alOpinar && recorrido > 500) mostrarOpinion(false);
    else cerrar();
  }
}
