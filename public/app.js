import { obtenerUbicacion } from './ubicacion.js';
// Interfaz de Voy Tranqui: formulario, mapa (Leaflet + OpenStreetMap) y resultados.
// Los textos que vienen del servidor se insertan siempre con textContent, nunca como HTML.

import { iniciarViaje } from './viaje.js';
import { leer, guardar, borrarTodo } from './almacen.js';
import { estimarBateria, MARGEN } from './bateria.js';
import { enlaceStreetView, rumboEn } from './enlaces.js';
import { esDeNoche, horaDeLuces } from './noche.js';

const LIMA = [-12.09, -77.03];
const COLORES = { tranquila: '#15803d', alternativa: '#7c3aed', rapida: '#475569', practica: '#0f5e57' };
const NOMBRE_TIPO = { tranquila: 'Más tranquila', rapida: 'Más rápida', alternativa: 'Alternativa', practica: 'Circuito de práctica' };
const NOMBRE_CLASE = {
  residencial: 'calles tranquilas',
  menor: 'calles con más movimiento',
  secundaria: 'avenidas medianas',
  primaria: 'avenidas grandes',
  autopista: 'vías rápidas',
  ciclovia: 'ciclovías separadas',
  carrilBici: 'carriles bici señalizados',
  sendaCompartida: 'sendas compartidas con peatones',
  vereda: 'veredas o parques (a pie)',
  caminata: 'tramo a pie',
};
const TIPOS_ALERTA = new Set(['cruce', 'tramo', 'trafico', 'caminata']);

const $ = (id) => document.getElementById(id);
const valorDe = (nombre) => document.querySelector(`input[name="${nombre}"]:checked`).value;

function el(etiqueta, props = {}, ...hijos) {
  const nodo = document.createElement(etiqueta);
  for (const [clave, valor] of Object.entries(props)) {
    if (valor === undefined || valor === null || valor === false) continue;
    if (clave === 'class') nodo.className = valor;
    else if (clave.startsWith('on')) nodo.addEventListener(clave.slice(2), valor);
    else nodo.setAttribute(clave, valor === true ? '' : valor);
  }
  for (const hijo of hijos.flat()) if (hijo !== null && hijo !== undefined && hijo !== false) nodo.append(hijo);
  return nodo;
}

async function api(ruta, cuerpo) {
  const respuesta = await fetch(
    ruta,
    cuerpo ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo) } : undefined,
  );
  let datos = {};
  try {
    datos = await respuesta.json();
  } catch {
    // Respuesta vacía o no JSON.
  }
  if (!respuesta.ok) {
    // Sin mensaje del servidor (por ejemplo, Vercel cortó una búsqueda demasiado larga): explicarlo en simple.
    const sinMensaje = [502, 503, 504].includes(respuesta.status)
      ? 'La búsqueda tardó demasiado: el servicio de rutas está lento. Intenta otra vez en un momento.'
      : 'Algo falló en el servidor. Intenta otra vez en un momento.';
    throw new Error(datos.error || sinMensaje);
  }
  return datos;
}

// ----- Errores en producción -----
// Si algo falla en el celular de alguien, se avisa al servidor (máximo 5 por visita, sin repetir el mismo).
// Solo texto técnico: nunca ubicaciones ni direcciones.
const erroresEnviados = new Set();
function reportarError(mensaje, pila = '', archivo = '', linea = 0) {
  const clave = `${mensaje}|${archivo}|${linea}`;
  if (erroresEnviados.size >= 5 || erroresEnviados.has(clave)) return;
  erroresEnviados.add(clave);
  const limpiar = (t) => String(t ?? '').replace(/-?\d{1,3}\.\d{4,}/g, '#'); // por si un mensaje trae coordenadas
  fetch('/api/errores', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      mensaje: limpiar(mensaje),
      pila: limpiar(pila),
      archivo: String(archivo).split('?')[0],
      linea,
      pagina: location.pathname,
      app: window.Capacitor?.isNativePlatform?.() === true,
      navegador: navigator.userAgent,
    }),
    keepalive: true,
  }).catch(() => {});
}
window.addEventListener('error', (ev) => reportarError(ev.message, ev.error?.stack, ev.filename, ev.lineno));
window.addEventListener('unhandledrejection', (ev) => reportarError(`Promesa rechazada: ${ev.reason?.message ?? ev.reason}`, ev.reason?.stack));

const formatoKm = (m) => `${(m / 1000).toFixed(1).replace('.', ',')} km`;

function formatoTiempo(segundos) {
  const min = Math.max(1, Math.round(segundos / 60));
  return min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${min % 60} min`;
}

// ----- Mapa -----

const mapa = L.map('mapa').setView(LIMA, 12);
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">colaboradores de OpenStreetMap</a>',
}).addTo(mapa);

// De noche el mapa se oscurece solo, para no encandilar al manejar. Se revisa cada minuto.
// ?noche=1 o ?noche=0 fuerza el modo (para revisar cómo se ve).
const forzarNoche = new URLSearchParams(location.search).get('noche');
const deNoche = () => (forzarNoche === null ? esDeNoche() : forzarNoche === '1');
const horaLuces = () => (forzarNoche === null ? horaDeLuces() : forzarNoche === '1');
function revisarNoche() {
  const noche = deNoche();
  document.documentElement.classList.toggle('noche', noche);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', noche ? '#0b1f1c' : '#0f5e57');
}
revisarNoche();
setInterval(revisarNoche, 60_000);

// La red de ciclovías va en un panel propio, debajo de las rutas.
mapa.createPane('ciclovias').style.zIndex = 350;
const capaCiclovias = L.layerGroup();
const capaRutas = L.layerGroup().addTo(mapa);
const capaTramos = L.layerGroup().addTo(mapa); // ruta elegida pintada por tipo de vía
const capaAlertas = L.layerGroup().addTo(mapa);
const capaLlegada = L.layerGroup().addTo(mapa); // estacionamientos cerca del destino

// Colores por tipo de vía: los mismos de la barrita de cada tarjeta.
const colorCss = (nombre, porDefecto) => getComputedStyle(document.documentElement).getPropertyValue(nombre).trim() || porDefecto;
const COLOR_TRAMO = {
  ciclovia: '#0e7490',
  carrilBici: '#2563eb',
  sendaCompartida: '#9333ea',
  residencial: colorCss('--clase-residencial', '#16a34a'),
  menor: colorCss('--clase-menor', '#84cc16'),
  secundaria: colorCss('--clase-secundaria', '#f59e0b'),
  primaria: colorCss('--clase-primaria', '#ea580c'),
  autopista: colorCss('--clase-autopista', '#dc2626'),
  vereda: colorCss('--clase-noApta', '#6b7280'),
};
const NOMBRE_LEYENDA = {
  ciclovia: 'Ciclovía separada',
  carrilBici: 'Carril bici señalizado',
  sendaCompartida: 'Senda compartida',
  residencial: 'Calle tranquila',
  menor: 'Calle con movimiento',
  secundaria: 'Avenida mediana',
  primaria: 'Avenida grande',
  autopista: 'Vía rápida',
  vereda: 'A pie',
};

// ----- Controles del mapa: pantalla completa y red de ciclovías -----

const ICONO_AMPLIAR =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const ICONO_REDUCIR =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const ICONO_BICI =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="16" r="3.5"/><circle cx="18" cy="16" r="3.5"/><path d="M6 16l4-7h5l3 7M10 9l3 7h-7M14 6h2.5"/></g></svg>';

const ICONO_EVITAR =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="12" cy="12" r="8"/><path d="M6.5 17.5l11-11"/></g></svg>';

const botonCompleto = document.createElement('button');
botonCompleto.type = 'button';
const botonEvitar = document.createElement('button');
botonEvitar.type = 'button';
botonEvitar.innerHTML = ICONO_EVITAR;
botonEvitar.title = 'Marcar un lugar para evitarlo';
botonEvitar.setAttribute('aria-label', 'Marcar en el mapa un lugar que quieres evitar');
botonEvitar.setAttribute('aria-pressed', 'false');
const botonCiclovias = document.createElement('button');
botonCiclovias.type = 'button';
botonCiclovias.innerHTML = ICONO_BICI;
botonCiclovias.title = 'Ver infraestructura ciclista';
botonCiclovias.setAttribute('aria-label', 'Ver infraestructura ciclista registrada en Lima');
botonCiclovias.setAttribute('aria-pressed', 'false');

const controles = L.control({ position: 'topright' });
controles.onAdd = () => {
  const caja = L.DomUtil.create('div', 'leaflet-bar controles-mapa');
  caja.append(botonCompleto, botonCiclovias, botonEvitar);
  L.DomEvent.disableClickPropagation(caja);
  return caja;
};
controles.addTo(mapa);

// Pantalla completa: el mapa cubre toda la pantalla (igual en la web y en la app). En Android, el botón
// "atrás" la cierra gracias a una entrada en el historial.
let mapaCompleto = false;
function aplicarCompleto(activar) {
  mapaCompleto = activar;
  document.body.classList.toggle('mapa-completo', activar);
  botonCompleto.innerHTML = activar ? ICONO_REDUCIR : ICONO_AMPLIAR;
  botonCompleto.title = activar ? 'Salir de pantalla completa' : 'Mapa en pantalla completa';
  botonCompleto.setAttribute('aria-label', botonCompleto.title);
  setTimeout(() => mapa.invalidateSize(), 60);
}
function pantallaCompleta(activar) {
  if (activar === mapaCompleto) return;
  aplicarCompleto(activar);
  if (activar) history.pushState({ mapaCompleto: true }, '');
  else if (history.state?.mapaCompleto) history.back();
}
aplicarCompleto(false);
botonCompleto.addEventListener('click', () => pantallaCompleta(!mapaCompleto));
window.addEventListener('popstate', () => {
  if (mapaCompleto && !history.state?.mapaCompleto) aplicarCompleto(false);
});
document.addEventListener('keydown', (ev) => {
  if (ev.key === 'Escape' && mapaCompleto) pantallaCompleta(false);
});

// Red de ciclovías de Lima: se descarga una sola vez, al activarla.
let mostrandoCiclovias = false;
let redOcultaEnViaje = false; // durante el viaje solo se ve el camino
let cicloviasCargadas = false;
async function alternarCiclovias(mostrar = !mostrandoCiclovias) {
  mostrandoCiclovias = mostrar;
  botonCiclovias.setAttribute('aria-pressed', String(mostrar));
  try {
    localStorage.setItem('verCiclovias', mostrar ? '1' : '0');
  } catch {
    // Sin almacenamiento: solo no se recuerda la preferencia.
  }
  if (mostrar && !cicloviasCargadas) {
    botonCiclovias.classList.add('cargando');
    try {
      const { ciclovias } = await api('/api/ciclovias', {});
      const lienzo = L.canvas({ pane: 'ciclovias' });
      for (const [nombre, puntos, tipo = 'separada'] of ciclovias) {
        // Red de fondo: colores apagados y línea fina, para que la ruta elegida siempre se distinga.
        // El tipo se ve al tocar o pasar sobre la línea.
        const estilos = {
          separada: { color: '#6f9ea6', dashArray: null, titulo: 'Ciclovía separada' },
          carril: { color: '#8a9cc4', dashArray: '7 4', titulo: 'Carril bici señalizado' },
          compartida: { color: '#b9a084', dashArray: '2 6', titulo: 'Vía compartida con vehículos' },
          sendaCompartida: { color: '#a996bd', dashArray: '3 5', titulo: 'Senda compartida con peatones' },
        };
        const estilo = estilos[tipo] ?? estilos.compartida;
        L.polyline(puntos, { renderer: lienzo, pane: 'ciclovias', color: estilo.color, weight: 2, opacity: 0.6, dashArray: estilo.dashArray })
          .bindTooltip((nombre ? nombre + ' · ' : '') + estilo.titulo + ' (OSM)', { sticky: true })
          .addTo(capaCiclovias);
      }
      cicloviasCargadas = true;
    } catch (error) {
      mostrandoCiclovias = false;
      botonCiclovias.setAttribute('aria-pressed', 'false');
      mostrarMensajes(el('p', { class: 'aviso aviso-error' }, `No pude cargar las ciclovías: ${error.message}`));
    } finally {
      botonCiclovias.classList.remove('cargando');
    }
  }
  if (mostrandoCiclovias && !redOcultaEnViaje) capaCiclovias.addTo(mapa);
  else capaCiclovias.remove();
  actualizarLeyenda();
}
botonCiclovias.addEventListener('click', () => alternarCiclovias());

// Leyenda: solo los tipos de vía que tiene la ruta elegida (y la red de ciclovías si está visible).
let clasesRuta = [];
const leyenda = L.control({ position: 'bottomleft' });
leyenda.onAdd = () => {
  const caja = L.DomUtil.create('div', 'leyenda-mapa');
  L.DomEvent.disableClickPropagation(caja);
  return caja;
};
let leyendaVisible = false;
function actualizarLeyenda() {
  const items = Object.keys(NOMBRE_LEYENDA)
    .filter((c) => clasesRuta.includes(c))
    .map((c) => el('span', { class: 'leyenda-item' }, el('i', { class: c === 'vereda' ? 'a-pie' : '', style: `background:${COLOR_TRAMO[c]}` }), NOMBRE_LEYENDA[c]));
  if (mostrandoCiclovias && !redOcultaEnViaje) items.push(el('span', { class: 'leyenda-item' }, el('i', { class: 'otras' }), 'Red ciclista (fondo)'));
  if (!items.length) {
    if (leyendaVisible) leyenda.remove();
    leyendaVisible = false;
    return;
  }
  if (!leyendaVisible) leyenda.addTo(mapa);
  leyendaVisible = true;
  leyenda.getContainer().replaceChildren(...items);
}

const puntos = { origen: null, destino: null };
let modoMapa = null;
let rutas = [];
let lineas = [];
let alertas = [];

const iconoMarca = (cual) =>
  L.divIcon({
    className: 'contenedor-marca',
    html: `<div class="marca-mapa ${cual}"><span>${{ origen: 'A', destino: 'B', siguiente: 'C' }[cual]}</span></div>`,
    iconSize: [30, 30],
    iconAnchor: [15, 36],
  });

const svgAlerta = (tipo) => {
  if (tipo === 'caminata') {
    // Ícono de persona caminando
    return `<svg class="icono-alerta tipo-caminata" viewBox="0 0 24 24" aria-hidden="true">` +
      '<circle cx="12" cy="4" r="2"/>' +
      '<path d="M10 7.5 7 22h2l1.5-6L13 19l.5 3H15.5l-1-7 2-3.5V22h2V10.5l-3-1-1-2z"/>' +
      '</svg>';
  }
  return `<svg class="icono-alerta tipo-${TIPOS_ALERTA.has(tipo) ? tipo : 'cruce'}" viewBox="0 0 24 24" aria-hidden="true">` +
    '<path d="M12 2.5 1.5 21h21z"/><rect x="11" y="8.5" width="2" height="7" rx="1"/><circle cx="12" cy="18.2" r="1.2"/></svg>';
};

const iconoAlerta = (tipo) =>
  L.divIcon({ className: 'contenedor-alerta', html: svgAlerta(tipo), iconSize: [26, 26], iconAnchor: [13, 15] });

function elementoAlerta(tipo) {
  const caja = document.createElement('span');
  caja.innerHTML = svgAlerta(tipo);
  return caja.firstChild;
}

// ----- Puntos de origen y destino -----

function mostrarInfo(cual, opciones = []) {
  const caja = $(`${cual}-info`);
  caja.replaceChildren();
  const p = puntos[cual];
  if (!p) return;
  caja.append(el('span', {}, p.etiqueta ? `Te ubiqué en: ${p.etiqueta}` : 'Punto elegido en el mapa.'));
  if (!p.exacto) caja.append(' ', el('span', { class: 'aproximado' }, '(aproximado: arrastra el marcador si no es el lugar exacto)'));
  caja.append(' ', botonGuardarFavorito(cual));
  if (opciones.length) {
    caja.append(
      el(
        'div',
        { class: 'otras-opciones' },
        el('span', {}, '¿No es?'),
        opciones.map((o) =>
          el(
            'button',
            {
              type: 'button',
              onclick: () => {
                $(cual).value = o.etiqueta;
                ponerPunto(cual, o.lat, o.lon, { ...o, texto: o.etiqueta });
                mapa.panTo([o.lat, o.lon]);
              },
            },
            o.etiqueta,
          ),
        ),
      ),
    );
  }
}

let versionOrigen = 0;
$('origen').addEventListener('input', () => { versionOrigen++; });

function ponerPunto(cual, lat, lon, datos = {}) {
  if (cual === 'origen') versionOrigen++;
  let marcador = puntos[cual]?.marcador;
  if (marcador) {
    marcador.setLatLng([lat, lon]);
  } else {
    marcador = L.marker([lat, lon], {
      icon: iconoMarca(cual),
      draggable: true,
      autoPan: true,
      title: cual === 'origen' ? 'Salida (puedes arrastrarlo)' : 'Llegada (puedes arrastrarlo)',
    }).addTo(mapa);
    marcador.on('dragend', () => {
      const { lat: la, lng } = marcador.getLatLng();
      elegirEnMapa(cual, la, lng);
    });
  }
  puntos[cual] = {
    lat,
    lon,
    etiqueta: datos.etiqueta ?? null,
    exacto: datos.exacto ?? true,
    texto: datos.texto ?? $(cual).value.trim(),
    marcador,
  };
  mostrarInfo(cual, datos.opciones);
  limpiarRutas();
}

async function elegirEnMapa(cual, lat, lon) {
  const provisional = 'Punto elegido en el mapa';
  $(cual).value = provisional;
  ponerPunto(cual, lat, lon, { texto: provisional });
  try {
    const { lugar } = await api('/api/inverso', { lat, lon });
    if (lugar && puntos[cual]?.lat === lat) {
      $(cual).value = lugar.etiqueta;
      puntos[cual].texto = lugar.etiqueta;
      puntos[cual].etiqueta = lugar.etiqueta;
      mostrarInfo(cual);
    }
  } catch (error) {
    $(`${cual}-info`).replaceChildren(el('span', { class: 'aproximado' }, error.message));
  }
}

async function asegurarPunto(cual) {
  const texto = $(cual).value.trim();
  if (puntos[cual] && puntos[cual].texto === texto) return;
  if (!texto) throw new Error(cual === 'origen' ? 'Escribe de dónde sales o toca el mapa.' : 'Escribe a dónde vas o toca el mapa.');
  const { lugares } = await api('/api/geocodificar', { texto });
  if (!lugares.length) throw new Error(`No encontré "${texto}" en Lima. Prueba escribiéndolo de otra forma o toca el mapa.`);
  const [primero, ...resto] = lugares;
  ponerPunto(cual, primero.lat, primero.lon, {
    etiqueta: primero.etiqueta,
    exacto: primero.exacto,
    texto,
    opciones: primero.exacto ? [] : resto.slice(0, 3),
  });
}

function iniciarModoMapa(cual) {
  terminarModoEvitar();
  modoMapa = cual;
  document.querySelectorAll('[data-elegir]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.elegir === cual)));
  const pista = $('modo-mapa');
  pista.hidden = false;
  pista.textContent = `Toca el mapa para marcar ${cual === 'origen' ? 'la salida (A)' : 'la llegada (B)'}.`;
  mapa.getContainer().style.cursor = 'crosshair';
}

function terminarModoMapa() {
  modoMapa = null;
  document.querySelectorAll('[data-elegir]').forEach((b) => b.setAttribute('aria-pressed', 'false'));
  $('modo-mapa').hidden = true;
  mapa.getContainer().style.cursor = '';
}

document.querySelectorAll('[data-elegir]').forEach((boton) =>
  boton.addEventListener('click', () => {
    const cual = boton.dataset.elegir;
    if (modoMapa === cual) terminarModoMapa();
    else iniciarModoMapa(cual);
  }),
);

mapa.on('click', (e) => {
  if (modoEvitar) {
    terminarModoEvitar();
    elegirMotivo(e.latlng);
    return;
  }
  const cual = modoMapa ?? (!puntos.origen ? 'origen' : !puntos.destino ? 'destino' : null);
  if (!cual) return;
  terminarModoMapa();
  elegirEnMapa(cual, e.latlng.lat, e.latlng.lng);
});

// ----- Hora de salida -----

function horaPorDefecto() {
  const d = new Date(Date.now() + 60 * 60 * 1000);
  d.setMinutes(0, 0, 0);
  const dos = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${dos(d.getMonth() + 1)}-${dos(d.getDate())}T${dos(d.getHours())}:00`;
}

document.querySelectorAll('input[name="cuando"]').forEach((radio) =>
  radio.addEventListener('change', () => {
    const otra = radio.value === 'otra' && radio.checked;
    $('hora').hidden = !otra;
    if (otra && !$('hora').value) $('hora').value = horaPorDefecto();
  }),
);

// ----- Resultados -----

function limpiarRutas() {
  rutas = [];
  lineas = [];
  alertas = [];
  capaRutas.clearLayers();
  capaTramos.clearLayers();
  capaAlertas.clearLayers();
  capaLlegada.clearLayers();
  estacionamientos = [];
  clasesRuta = [];
  actualizarLeyenda();
  $('resultados').replaceChildren();
}

const mostrarMensajes = (...nodos) => $('mensajes').replaceChildren(...nodos);

function estiloLinea(ruta, activa) {
  const tipo = ruta.tipos[0];
  return {
    color: COLORES[tipo],
    weight: activa ? 7 : 5,
    opacity: activa ? 0.95 : 0.5,
    dashArray: tipo === 'rapida' ? '10 8' : null,
    lineCap: 'round',
  };
}

// La ruta elegida se pinta por tramos según el tipo de vía, sobre un borde blanco para que se lea en el mapa.
function dibujarTramos(ruta) {
  capaTramos.clearLayers();
  const tramos = ruta.tramosPorClase ?? [];
  for (const [desde, hasta, clase] of tramos) {
    L.polyline(ruta.geometria.slice(desde, hasta + 1), {
      color: COLOR_TRAMO[clase] ?? COLORES[ruta.tipos[0]],
      weight: 6,
      opacity: 1,
      lineCap: 'round',
      lineJoin: 'round',
      dashArray: clase === 'vereda' ? '1 9' : null,
      interactive: false,
    }).addTo(capaTramos);
  }
  clasesRuta = [...new Set(tramos.map((t) => t[2]))];
  actualizarLeyenda();
}

let seleccionada = 0;
function seleccionar(i, ajustar = false) {
  seleccionada = i;
  const porTramos = Boolean(rutas[i].tramosPorClase?.length);
  lineas.forEach((linea, k) => {
    // Borde oscuro bajo la ruta elegida: se distingue sobre el mapa y sobre la red de ciclovías.
    linea.setStyle(k === i && porTramos ? { color: '#1f2937', weight: 11, opacity: 0.85, dashArray: null } : estiloLinea(rutas[k], k === i));
    if (k === i) linea.bringToFront();
  });
  dibujarTramos(rutas[i]);
  document.querySelectorAll('.ruta').forEach((tarjeta, k) => {
    tarjeta.classList.toggle('seleccionada', k === i);
    tarjeta.setAttribute('aria-current', k === i ? 'true' : 'false');
  });
  capaAlertas.clearLayers();
  // Tramo a pie hasta la ciclovía: línea punteada desde la salida real hasta donde empieza la ruta.
  const caminata = rutas[i].caminataInicial;
  if (caminata) {
    L.polyline(caminata.geometria, { color: '#0e7490', weight: 4, opacity: 0.9, dashArray: '2 8', lineCap: 'round', interactive: false })
      .addTo(capaAlertas);
  }
  alertas = rutas[i].puntosCriticos.map((p) =>
    L.marker([p.lat, p.lon], { icon: iconoAlerta(p.tipo), title: p.titulo, keyboard: false })
      .bindPopup(el('div', {}, el('strong', {}, p.titulo), el('br'), p.detalle, el('br'), enlaceVerCalle(rutas[i], p)))
      .addTo(capaAlertas),
  );
  if (ajustar) mapa.fitBounds(L.featureGroup(lineas).getBounds(), { padding: [24, 24] });
}

function nivel(valor) {
  if (valor >= 80) return 4;
  if (valor >= 60) return 3;
  if (valor >= 40) return 2;
  return 1;
}

const tiempoDe = (ruta) => ruta.duracionTotalSegundos ?? (ruta.trafico?.confiable ? ruta.trafico.duracionSegundos : ruta.duracionSegundos);

// Una línea con lo que el novato debe saber antes de elegir: cuántos cruces y tramos difíciles tiene.
function resumenCriticos(criticos) {
  const contar = (tipo) => criticos.filter((p) => p.tipo === tipo).length;
  const plural = (n, uno, varios) => `${n} ${n === 1 ? uno : varios}`;
  const cruces = contar('cruce');
  const tramos = contar('tramo');
  const trafico = contar('trafico');
  const partes = [
    cruces && `cruzas ${plural(cruces, 'avenida', 'avenidas')}`,
    tramos && `${plural(tramos, 'tramo', 'tramos')} por avenida`,
    trafico && `tráfico en ${plural(trafico, 'punto', 'puntos')}`,
    contar('caminata') && 'caminas al inicio',
  ].filter(Boolean);
  if (!partes.length) return 'Sin cruces ni tramos por avenidas.';
  const texto = partes.length > 1 ? `${partes.slice(0, -1).join(', ')} y ${partes.at(-1)}` : partes[0];
  return `${texto.charAt(0).toUpperCase()}${texto.slice(1)}. Están marcados en el mapa.`;
}

// En bici, una avenida al final ya aparece como "camina empujando la bici" en los puntos críticos.
function llegaPorAvenida(ruta) {
  const llegada = ruta.llegadaPorAvenida;
  if (!llegada || ruta.practica || valorDe('vehiculo') === 'bici') return null;
  return el(
    'p',
    { class: 'nota-llegada' },
    `Llegas por ${llegada.nombre ?? 'una avenida'}: no te detengas en la pista. Estaciona antes, en una calle lateral o en un estacionamiento.`,
  );
}

const PUNTAJE_TRANQUILA = 40; // por debajo, la etiqueta es "Difícil para principiantes"
const sinRutaTranquila = (ruta) => !ruta.practica && ruta.puntaje.valor < PUNTAJE_TRANQUILA;

function tarjeta(ruta, i) {
  const tipo = ruta.tipos[0];
  // Si ni la mejor es tranquila (puntaje bajo 40), no se le llama "Más tranquila": se dice lo que es.
  const nombreTipo = (t) => (t === 'tranquila' && sinRutaTranquila(ruta) ? 'La menos difícil' : NOMBRE_TIPO[t]);
  const titulo = ruta.tipos.map((t, k) => (k ? nombreTipo(t).toLowerCase() : nombreTipo(t))).join(' y ');
  const conTrafico = ruta.trafico?.confiable;
  const tiempo = tiempoDe(ruta);
  const { puntaje } = ruta;
  const rapida = rutas.find((r) => r.tipos.includes('rapida'));
  const extra = rapida && rapida !== ruta ? Math.round((tiempo - tiempoDe(rapida)) / 60) : 0;

  const barra = el('div', { class: 'barra', 'aria-hidden': 'true' });
  for (const [clase, pct] of Object.entries(puntaje.porcentajes)) {
    const parte = el('span', { class: `clase-${clase}`, title: `${pct}% ${NOMBRE_CLASE[clase]}` });
    parte.style.width = `${pct}%`;
    barra.append(parte);
  }

  const criticos = ruta.puntosCriticos;
  const listaCriticos = el(
    'ol',
    { class: 'lista-criticos' },
    criticos.map((p, k) =>
      el(
        'li',
        {},
        elementoAlerta(p.tipo),
        el(
          'button',
          {
            type: 'button',
            onclick: (ev) => {
              ev.stopPropagation();
              seleccionar(i);
              mapa.setView([p.lat, p.lon], Math.max(mapa.getZoom(), 16));
              alertas[k]?.openPopup();
            },
          },
          el('span', { class: 'titulo-critico' }, p.titulo),
          el('span', { class: 'detalle-critico' }, ` · km ${String(p.km).replace('.', ',')}. ${p.detalle}`),
        ),
        enlaceVerCalle(ruta, p),
      ),
    ),
  );

  // Un 1-4% suele ser un ramal de intercambio; el aviso es para rutas que de verdad recorren vías rápidas.
  const usaViaRapida = (puntaje.porcentajes.autopista ?? 0) >= 5;

  const nodo = el(
    'article',
    {
      class: `ruta ${tipo}`,
      tabindex: '0',
      onclick: () => seleccionar(i),
      onkeydown: (ev) => {
        if (ev.key === 'Enter' && ev.target === ev.currentTarget) seleccionar(i);
      },
    },
    el(
      'div',
      { class: 'ruta-cabecera' },
      el(
        'div',
        {},
        el('h2', { class: 'ruta-tipo' }, titulo),
        el(
          'p',
          { class: 'ruta-datos' },
          `${formatoKm(ruta.distanciaMetros)} · ${formatoTiempo(tiempo)} ${conTrafico ? 'con el tráfico de ahora' : 'sin contar tráfico'}`,
        ),
        ruta.caminataInicial && el('p', { class: 'ruta-datos' }, `Total aprox.: ${ruta.caminataInicial.minutos} min caminando + ${formatoTiempo(ruta.duracionSegundos)} en bici. Caminata estimada en línea recta.`),
        extra > 0 && el('p', { class: 'ruta-datos' }, `${extra} min más que la más rápida`),
        lineaRitmo(ruta),
        lineaBateria(ruta),
      ),
      el(
        'div',
        { class: `puntaje nivel-${nivel(puntaje.valor)}`, role: 'img', 'aria-label': `Tranquilidad: ${puntaje.valor} de 100` },
        el('strong', {}, String(puntaje.valor)),
        el('span', {}, 'de 100'),
      ),
    ),
    el('p', { class: 'puntaje-etiqueta' }, puntaje.etiqueta),
    barra,
    el('p', { class: 'resumen-ruta' }, resumenCriticos(criticos)),
    llegaPorAvenida(ruta),
    usaViaRapida &&
      el('p', { class: 'nota-ruta' }, 'Usa vías rápidas como la Vía Expresa o la Panamericana. Si recién empiezas, mejor evítalas; algunas motos y scooters tienen restricciones ahí.'),
    // Lo demás, para quien quiere saber más: el novato decide con el resumen de arriba.
    el(
      'details',
      { class: 'detalle-ruta' },
      el('summary', {}, 'Ver detalle'),
      el(
        'ul',
        { class: 'leyenda' },
        Object.entries(puntaje.porcentajes).map(([clase, pct]) => el('li', { class: `clase-${clase}` }, `${pct}% ${NOMBRE_CLASE[clase]}`)),
      ),
      el('p', { class: 'explicacion' }, puntaje.explicacion),
      criticos.length > 0 && el('h3', { class: 'titulo-detalle' }, criticos.length === 1 ? 'Punto crítico' : `${criticos.length} puntos críticos`),
      criticos.length > 0 && listaCriticos,
      el(
        'details',
        {},
        el('summary', {}, `Instrucciones paso a paso (${ruta.pasos.length})`),
        el(
          'ol',
          { class: 'lista-pasos' },
          ruta.pasos.map((p) => el('li', {}, el('span', {}, p.texto, p.avisos.map((a) => el('span', { class: 'aviso-paso' }, a))))),
        ),
      ),
    ),
    el(
      'div',
      { class: 'acciones-ruta' },
      el('button', { type: 'button', class: 'boton-viaje', onclick: (ev) => empezarViaje(ev, i, false) }, 'Iniciar viaje con voz'),
      el('button', { type: 'button', class: 'boton-secundario', onclick: (ev) => empezarViaje(ev, i, true) }, 'Ensayar recorrido'),
      el(
        'a',
        { class: 'enlace-google', href: ruta.enlaceGoogleMaps, target: '_blank', rel: 'noopener noreferrer', onclick: (ev) => ev.stopPropagation() },
        'Ver en Google Maps',
      ),
    ),
  );
  return nodo;
}

function empezarViaje(ev, i, ensayo) {
  ev.stopPropagation();
  if (!ensayo && !(window.isSecureContext && 'geolocation' in navigator)) {
    mostrarMensajes(el('p', { class: 'aviso aviso-error' }, 'El modo viaje necesita abrir la app con HTTPS (o en localhost) para usar tu ubicación. Mira el README.'));
    return;
  }
  seleccionar(i);
  // Durante el viaje el mapa ocupa toda la pantalla; al terminar vuelve como estaba.
  const estabaCompleto = mapaCompleto;
  pantallaCompleta(true);
  redOcultaEnViaje = true;
  capaCiclovias.remove();
  actualizarLeyenda();
  mapa.setZoom(17);
  const ruta = rutas[i];
  const practica = ruta.practica ?? null;
  // En la práctica se vuelve al punto de partida; si no, al destino elegido.
  const meta = practica ? { lat: ruta.geometria[0][0], lon: ruta.geometria[0][1] } : { lat: puntos.destino.lat, lon: puntos.destino.lon };
  iniciarViaje(ruta, {
    mapa,
    el,
    ensayo,
    practica,
    destino: practica ? '' : (puntos.destino?.etiqueta ?? $('destino').value.trim()),
    alDesviarse: async (pos) => {
      const datos = await api('/api/rutas', {
        origen: { lat: pos.lat, lon: pos.lon },
        destino: meta,
        salida: null,
        vehiculo: valorDe('vehiculo'),
        nivel: valorDe('nivel'),
        evitar: puntosEvitar(),
        ajusteRitmo: ritmoPersonal(),
      });
      const nueva = datos.rutas?.[0];
      if (!nueva) return null;
      if (practica) nueva.practica = practica;
      mostrarResultados(datos, { ajustar: false, avisos: false });
      return nueva;
    },
    alOpinar: (opinion) => guardarOpinion(opinion),
    alTerminar: () => {
      if (!estabaCompleto) pantallaCompleta(false);
      redOcultaEnViaje = false;
      if (mostrandoCiclovias) capaCiclovias.addTo(mapa);
      actualizarLeyenda();
    },
    alLlegar: (medicion) => registrarRitmo(medicion),
    alMarcarLugar: () => iniciarModoEvitar(),
    avisoLlegada: practica ? '' : fraseEstacionamiento(),
    avisoInicial: !ensayo && valorDe('vehiculo') === 'bici' && horaLuces() ? 'Está oscureciendo: enciende tus luces, la blanca adelante y la roja atrás.' : '',
    alRecalcular: (pos) => {
      if (!pos) return;
      $('origen').value = 'Tu ubicación';
      ponerPunto('origen', pos.lat, pos.lon, { etiqueta: 'Tu ubicación', texto: 'Tu ubicación' });
      $('formulario').requestSubmit();
    },
  });
}

// ----- Al llegar: dónde estacionar (OpenStreetMap) -----

let estacionamientos = [];
const NOMBRE_ESTACIONAMIENTO = { a: 'Estacionamiento', m: 'Estacionamiento de motos', b: 'Estacionamiento de bicis' };
const iconoEstacionamiento = (tipo) =>
  L.divIcon({ className: 'contenedor-estacionamiento', html: `<span class="marca-estacionamiento tipo-${tipo}">P</span>`, iconSize: [24, 24], iconAnchor: [12, 12] });

function datosEstacionamiento(l) {
  const extras = [l.clientes ? 'solo para clientes' : null, l.pago === 1 ? 'de pago' : l.pago === 0 ? 'gratis' : null].filter(Boolean);
  return `a ${l.metros} m del destino${extras.length ? `, ${extras.join(', ')}` : ''}`;
}

function bloqueLlegada() {
  capaLlegada.clearLayers();
  if (!estacionamientos.length || rutas[0]?.practica) return '';
  const marcas = estacionamientos.map((l) =>
    L.marker([l.lat, l.lon], { icon: iconoEstacionamiento(l.tipo), keyboard: false, title: l.nombre ?? NOMBRE_ESTACIONAMIENTO[l.tipo] })
      .bindPopup(() => el('div', { class: 'popup-estacionamiento' }, el('strong', {}, l.nombre ?? NOMBRE_ESTACIONAMIENTO[l.tipo]), el('p', {}, datosEstacionamiento(l))))
      .addTo(capaLlegada),
  );
  return el(
    'section',
    { class: 'llegada', 'aria-label': 'Dónde estacionar al llegar' },
    el('h2', {}, valorDe('vehiculo') === 'bici' ? 'Dónde dejar la bici al llegar' : 'Dónde estacionar al llegar'),
    el(
      'ul',
      {},
      estacionamientos.map((l, k) =>
        el(
          'li',
          {},
          el(
            'button',
            {
              type: 'button',
              onclick: () => {
                mapa.setView([l.lat, l.lon], Math.max(mapa.getZoom(), 17), { animate: false });
                marcas[k].openPopup();
                if (!mapaCompleto) mapa.getContainer().scrollIntoView({ behavior: 'smooth', block: 'center' });
              },
            },
            el('span', { class: `marca-estacionamiento tipo-${l.tipo}`, 'aria-hidden': 'true' }, 'P'),
            el('span', {}, el('strong', {}, l.nombre ?? NOMBRE_ESTACIONAMIENTO[l.tipo]), el('span', { class: 'datos-estacionamiento' }, datosEstacionamiento(l))),
          ),
        ),
      ),
    ),
    el('p', { class: 'nota-ruta' }, 'Registrados en OpenStreetMap: confirma en el lugar si están abiertos y cuánto cobran.'),
  );
}

// Frase para la voz al llegar: el estacionamiento más cercano, si hay.
function fraseEstacionamiento() {
  const l = estacionamientos[0];
  if (!l) return '';
  const lugar = l.tipo === 'b' ? 'un estacionamiento de bicis' : 'un estacionamiento';
  return `Hay ${lugar} a unos ${l.metros} metros${l.nombre ? `: ${l.nombre}` : ''}.`;
}

function mostrarResultados({ rutas: lista, horario = {}, trafico = {}, estacionamientos: lugares = [] }, { ajustar = true, avisos = true } = {}) {
  rutas = lista;
  estacionamientos = lugares;
  const mensajes = [];
  if (!avisos) {
    // Recálculo durante el viaje o práctica: los avisos de la búsqueda no aplican.
  } else if (horario.mensaje) {
    mensajes.push(el('p', { class: 'aviso aviso-hora' }, el('strong', {}, horario.enHoraPunta ? 'Hora punta. ' : 'Atento a la hora. '), horario.mensaje));
  }
  const mejor = rutas.find((r) => r.tipos.includes('tranquila'));
  if (avisos && mejor && sinRutaTranquila(mejor)) {
    // Si sin el tráfico de ahora la ruta sí sería tranquila, la causa es la hora, no el camino.
    const porTrafico = mejor.puntaje.valor - (mejor.puntaje.desglose?.trafico ?? 0) >= PUNTAJE_TRANQUILA;
    mensajes.push(
      el(
        'p',
        { class: 'aviso aviso-hora' },
        porTrafico
          ? [el('strong', {}, 'Ahora hay mucho tráfico en todas las rutas. '), 'Te muestro la menos difícil; a otra hora este camino es más tranquilo.']
          : [
              el('strong', {}, 'No hay una ruta tranquila entre estos puntos. '),
              'Cualquier camino cruza o recorre avenidas; te muestro la menos difícil. Si recién empiezas, ensaya el recorrido antes o ve acompañado la primera vez.',
            ],
      ),
    );
  } else if (avisos && rutas.length === 1) {
    mensajes.push(el('p', { class: 'aviso aviso-info' }, 'La ruta más rápida también es la más tranquila que encontré.'));
  }
  if (avisos && trafico.mensaje) mensajes.push(el('p', { class: 'aviso aviso-info' }, trafico.mensaje));
  if (avisos) mostrarMensajes(...mensajes);

  const tarjetas = rutas.map(tarjeta);
  // Dónde estacionar va después de la ruta recomendada: es lo siguiente que se pregunta el novato.
  $('resultados').replaceChildren(tarjetas[0] ?? '', bloqueLlegada(), ...tarjetas.slice(1));
  lineas = rutas.map((ruta, i) => L.polyline(ruta.geometria, estiloLinea(ruta, false)).on('click', () => seleccionar(i)).addTo(capaRutas));
  seleccionar(0, ajustar);
}

$('formulario').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  terminarModoMapa();
  const boton = $('buscar');
  boton.disabled = true;
  boton.textContent = 'Buscando…';
  mostrarMensajes(el('p', { class: 'cargando' }, 'Ubicando las direcciones y comparando rutas. Puede tardar unos 20 segundos…'));
  try {
    await asegurarPunto('origen');
    await asegurarPunto('destino');
    const otraHora = document.querySelector('input[name="cuando"]:checked').value === 'otra';
    const salida = otraHora ? $('hora').value : null;
    if (otraHora && !salida) throw new Error('Elige la fecha y hora de salida.');
    limpiarRutas();
    const { origen, destino } = puntos;
    // El tramo B → C (si sigues a otro lugar) se pide junto con las rutas: no alarga la espera.
    if (conLugarSiguiente()) await asegurarSiguiente();
    calcularTramoSiguiente();
    const datos = await api('/api/rutas', {
      origen: { lat: origen.lat, lon: origen.lon },
      destino: { lat: destino.lat, lon: destino.lon },
      salida,
      vehiculo: valorDe('vehiculo'),
      nivel: valorDe('nivel'),
      evitar: puntosEvitar(),
      ajusteRitmo: ritmoPersonal(),
    });
    mostrarResultados(datos);
    if (window.matchMedia('(max-width: 899px)').matches) $('resultados').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (error) {
    mostrarMensajes(el('p', { class: 'aviso aviso-error' }, error.message));
  } finally {
    boton.disabled = false;
    boton.textContent = 'Buscar ruta tranquila';
  }
});

// ----- Preferencias y app instalable -----

// Vehículo y nivel se recuerdan en este navegador (solo es una comodidad: si falla, se usan los valores por defecto).
for (const nombre of ['vehiculo', 'nivel']) {
  try {
    const guardado = localStorage.getItem(`ruta-tranquila-${nombre}`);
    const radio = document.querySelector(`input[name="${nombre}"][value="${CSS.escape(guardado ?? '')}"]`);
    if (radio) radio.checked = true;
  } catch {}
  document.querySelectorAll(`input[name="${nombre}"]`).forEach((r) =>
    r.addEventListener('change', () => {
      try {
        localStorage.setItem(`ruta-tranquila-${nombre}`, valorDe(nombre));
      } catch {}
    }),
  );
}

// Sugerencias mientras escribes (lugares, calles y zonas de Lima).
function sugerir(cual, alElegir = (l) => {
  ponerPunto(cual, l.lat, l.lon, { etiqueta: l.etiqueta, exacto: l.exacto, texto: l.etiqueta });
  mapa.panTo([l.lat, l.lon]);
}) {
  const entrada = $(cual);
  const lista = $(`${cual}-sugerencias`);
  let espera;
  entrada.addEventListener('input', () => {
    clearTimeout(espera);
    const texto = entrada.value.trim();
    if (texto.length < 3) return (lista.hidden = true);
    espera = setTimeout(async () => {
      try {
        const { lugares } = await api('/api/sugerencias', { texto });
        if (texto !== entrada.value.trim()) return;
        lista.replaceChildren(
          ...lugares.map((l) =>
            el(
              'li',
              {},
              el(
                'button',
                {
                  type: 'button',
                  onmousedown: (ev) => ev.preventDefault(),
                  onclick: () => {
                    entrada.value = l.etiqueta;
                    alElegir(l);
                    lista.hidden = true;
                  },
                },
                el('strong', {}, l.nombre),
                el('span', {}, [l.direccion, l.zona].filter(Boolean).join(' · ') || l.etiqueta),
              ),
            ),
          ),
        );
        lista.hidden = !lugares.length;
      } catch {
        lista.hidden = true;
      }
    }, 350);
  });
  entrada.addEventListener('blur', () => setTimeout(() => (lista.hidden = true), 150));
  entrada.addEventListener('keydown', (ev) => ev.key === 'Escape' && (lista.hidden = true));
}
sugerir('origen');
sugerir('destino');

if ('serviceWorker' in navigator && window.isSecureContext) navigator.serviceWorker.register('/sw.js').catch(() => {});

// ----- Estado del servidor -----

api('/api/estado')
  .then((estado) => {
    const problemas = [];
    if (!estado.ors) problemas.push('Falta la key de OpenRouteService en el archivo .env (ORS_API_KEY). Sin ella no se pueden buscar direcciones ni rutas. Mira el README.');
    if (!estado.vias) problemas.push('Faltan los datos de vías de Lima. Ejecuta: npm run datos');
    if (problemas.length) {
      const caja = $('aviso-config');
      caja.replaceChildren(...problemas.map((p) => el('span', {}, p, el('br'))));
      caja.hidden = false;
    }
  })
  .catch(() => {});

// Recordar si la persona dejó visible la red de ciclovías.
try {
  if (localStorage.getItem('verCiclovias') === '1') alternarCiclovias(true);
} catch {
  // Sin almacenamiento disponible.
}

// ----- Ver la calle antes de salir (Street View) -----

function enlaceVerCalle(ruta, p) {
  return el(
    'a',
    {
      class: 'ver-calle',
      href: enlaceStreetView(p.lat, p.lon, rumboEn(ruta.geometria, p.lat, p.lon)),
      target: '_blank',
      rel: 'noopener noreferrer',
      onclick: (ev) => ev.stopPropagation(),
    },
    '👁 Ver cómo es',
  );
}

// ----- Batería (scooter o moto eléctrica) -----

const usaBateria = () => ['motoElectrica', 'bici'].includes(valorDe('vehiculo'));

// "Después de llegar": me quedo, vuelvo al inicio o sigo a otro lugar (C). El tramo a C se calcula aparte
// con un solo pedido y solo sirve para la cuenta de batería; la guía sigue terminando en B.
let siguiente = null; // { nombre, etiqueta, texto, lat, lon }
let marcadorSiguiente = null;
let tramo = { clave: null, estado: 'nada', datos: null };

const autonomiaKm = () => Number($('autonomia').value);
const despuesElegido = () => document.querySelector('input[name="despues"]:checked')?.value ?? 'quedo';
const conLugarSiguiente = () => usaBateria() && autonomiaKm() > 0 && despuesElegido() === 'otro';
const nombreCorto = (etiqueta) => {
  const primero = String(etiqueta ?? '').split(',')[0].trim();
  return primero.length > 28 ? `${primero.slice(0, 27)}…` : primero || 'el otro lugar';
};
const claveTramo = () =>
  siguiente && puntos.destino ? [puntos.destino.lat, puntos.destino.lon, siguiente.lat, siguiente.lon, valorDe('vehiculo')].join('|') : null;

function lineaBateria(ruta) {
  if (!usaBateria()) return null;
  const subida = ruta.subidaMetros ?? 0;
  let textoSubida = subida >= 15 ? ` Sube ${subida} m en total.` : '';
  let despues = despuesElegido() === 'inicio' ? 'inicio' : false;
  let pendiente = null;
  if (conLugarSiguiente() && siguiente) {
    const vigente = tramo.clave === claveTramo();
    if (vigente && tramo.estado === 'listo') despues = { ...tramo.datos, nombre: siguiente.nombre };
    else if (vigente && tramo.estado === 'error') pendiente = `No pude calcular el tramo a ${siguiente.nombre}: por ahora cuento solo la ida.`;
    else pendiente = `Calculando cuánto gastas en seguir a ${siguiente.nombre}…`;
  }
  const estimacion = estimarBateria(ruta, autonomiaKm(), despues);
  if (!estimacion) return textoSubida ? el('p', { class: 'ruta-datos' }, textoSubida.trim()) : null;
  // Con dos tramos la pila ya muestra cuánto pesa cada uno; la subida de la ida sola confundiría.
  if (estimacion.tramos.length > 1) textoSubida = '';
  const icono = { alcanza: '🔋', justo: '⚠️', soloIda: '⚠️', noAlcanza: '⛔' }[estimacion.estado];
  const nombreDespues = despues === 'inicio' ? 'Vuelta' : despues ? `A ${despues.nombre}` : null;
  return el(
    'div',
    { class: `bateria bateria-${estimacion.estado}` },
    el('p', {}, `${icono} ${estimacion.texto}${textoSubida}`),
    medidorBateria(estimacion, nombreDespues),
    pendiente && el('p', { class: 'bateria-pendiente' }, pendiente),
  );
}

// Una pila dibujada: cada tramo ocupa lo que gasta de la batería; la franja rayada del final es la reserva (20 %).
function medidorBateria({ tramos, autonomiaKm: capacidad }, nombreDespues) {
  let libre = 100;
  const anchos = tramos.map((t) => {
    const ancho = Math.min(libre, (t.km / capacidad) * 100);
    libre -= ancho;
    return ancho;
  });
  const pila = el('div', { class: 'medidor-pila' }, el('span', { class: 'medidor-reserva' }));
  pila.firstChild.style.left = `${MARGEN * 100}%`;
  tramos.forEach((t, k) => {
    const parte = el('span', { class: `medidor-tramo tramo-${t.clave}` });
    parte.style.width = `${anchos[k]}%`;
    pila.append(parte);
  });
  const medidor = el('div', { class: 'medidor', 'aria-hidden': 'true' }, pila);
  if (nombreDespues) {
    // Nombre de cada tramo debajo de su parte (solo si cabe).
    const leyenda = el('div', { class: 'medidor-leyenda' });
    ['Ida', nombreDespues].forEach((nombre, k) => {
      const etiqueta = el('span', {}, anchos[k] >= 12 ? nombre : '');
      etiqueta.style.width = `${anchos[k]}%`;
      leyenda.append(etiqueta);
    });
    medidor.append(leyenda);
  }
  return medidor;
}

function actualizarCampoBateria() {
  const usa = usaBateria();
  $('campo-bateria').hidden = !usa;
  $('bloque-despues').hidden = !(usa && autonomiaKm() > 0);
  $('campo-siguiente').hidden = !conLugarSiguiente();
  pintarAtajosSiguiente();
  const verMarcador = conLugarSiguiente() && siguiente;
  if (verMarcador && !marcadorSiguiente) {
    marcadorSiguiente = L.marker([siguiente.lat, siguiente.lon], {
      icon: iconoMarca('siguiente'),
      title: 'Después sigues aquí (solo para la cuenta de batería)',
      keyboard: false,
    }).addTo(mapa);
  } else if (verMarcador) {
    marcadorSiguiente.setLatLng([siguiente.lat, siguiente.lon]);
  } else if (marcadorSiguiente) {
    marcadorSiguiente.remove();
    marcadorSiguiente = null;
  }
}

function repintarTarjetas() {
  if (!rutas.length) return;
  $('resultados').replaceChildren(...rutas.map(tarjeta));
  seleccionar(Math.min(seleccionada, rutas.length - 1));
}

function guardarBateria() {
  const lugar = siguiente && { nombre: siguiente.nombre, etiqueta: siguiente.etiqueta, lat: siguiente.lat, lon: siguiente.lon };
  guardar('bateria', { autonomia: autonomiaKm() || null, despues: despuesElegido(), siguiente: lugar || null });
}

function ponerSiguiente({ lat, lon, etiqueta, nombre = nombreCorto(etiqueta) }) {
  siguiente = { lat, lon, etiqueta, nombre, texto: etiqueta };
  $('siguiente').value = etiqueta;
  $('siguiente-info').replaceChildren(el('span', {}, `Te ubiqué en: ${etiqueta}`));
  guardarBateria();
  actualizarCampoBateria();
  calcularTramoSiguiente();
  repintarTarjetas();
}

function quitarSiguiente() {
  siguiente = null;
  tramo = { clave: null, estado: 'nada', datos: null };
  $('siguiente').value = '';
  $('siguiente-info').replaceChildren();
  actualizarCampoBateria();
}

// Si escribiste el lugar sin elegir una sugerencia, se busca el primero que coincida.
async function asegurarSiguiente() {
  const texto = $('siguiente').value.trim();
  if (!texto) {
    if (siguiente) {
      quitarSiguiente();
      guardarBateria();
      repintarTarjetas();
    }
    return;
  }
  if (siguiente?.texto === texto) return;
  try {
    const { lugares } = await api('/api/geocodificar', { texto });
    if (!lugares.length) {
      siguiente = null;
      $('siguiente-info').replaceChildren(el('span', { class: 'aproximado' }, `No encontré "${texto}". Prueba escribiéndolo de otra forma.`));
      repintarTarjetas();
      return;
    }
    ponerSiguiente(lugares[0]);
  } catch (error) {
    $('siguiente-info').replaceChildren(el('span', { class: 'aproximado' }, error.message));
  }
}

function calcularTramoSiguiente() {
  const clave = claveTramo();
  if (!conLugarSiguiente() || !clave) return;
  if (tramo.clave === clave && tramo.estado !== 'error') return;
  tramo = { clave, estado: 'calculando', datos: null };
  const { destino } = puntos;
  api('/api/tramo', {
    desde: { lat: destino.lat, lon: destino.lon },
    hasta: { lat: siguiente.lat, lon: siguiente.lon },
    vehiculo: valorDe('vehiculo'),
    evitar: puntosEvitar(),
  })
    .then((datos) => tramo.clave === clave && (tramo = { clave, estado: 'listo', datos }))
    .catch(() => tramo.clave === clave && (tramo = { clave, estado: 'error', datos: null }))
    .finally(() => tramo.clave === clave && repintarTarjetas());
}

// Tus lugares guardados como atajo para el punto C.
function pintarAtajosSiguiente() {
  const caja = $('siguiente-favoritos');
  const lista = leer('favoritos', []).filter((f) => !siguiente || Math.hypot(f.lat - siguiente.lat, f.lon - siguiente.lon) > 0.0002);
  caja.hidden = !lista.length || !conLugarSiguiente();
  caja.replaceChildren(
    ...lista.map((f) =>
      el('button', { type: 'button', class: 'chip', title: f.etiqueta, onclick: () => ponerSiguiente({ ...f, nombre: f.nombre }) }, `${ICONO_FAVORITO[f.nombre] ?? '⭐'} ${f.nombre}`),
    ),
  );
}

{
  const bateria = leer('bateria', {});
  if (bateria.autonomia) $('autonomia').value = bateria.autonomia;
  const despues = bateria.despues ?? (bateria.idaYVuelta ? 'inicio' : 'quedo');
  const radio = document.querySelector(`input[name="despues"][value="${CSS.escape(despues)}"]`);
  if (radio) radio.checked = true;
  if (bateria.siguiente?.lat) {
    siguiente = { ...bateria.siguiente, texto: bateria.siguiente.etiqueta };
    $('siguiente').value = siguiente.etiqueta;
  }
  const alCambiar = () => {
    guardarBateria();
    actualizarCampoBateria();
    calcularTramoSiguiente();
    repintarTarjetas();
  };
  // Al escribir los km aparece al toque la pregunta "Después de llegar".
  $('autonomia').addEventListener('input', actualizarCampoBateria);
  $('autonomia').addEventListener('change', alCambiar);
  document.querySelectorAll('input[name="despues"]').forEach((r) =>
    r.addEventListener('change', () => {
      alCambiar();
      if (despuesElegido() === 'otro' && !siguiente) $('siguiente').focus();
    }),
  );
  $('siguiente').addEventListener('change', asegurarSiguiente);
  sugerir('siguiente', (l) => ponerSiguiente(l));
  document.querySelectorAll('input[name="vehiculo"]').forEach((r) =>
    r.addEventListener('change', () => {
      actualizarCampoBateria();
      calcularTramoSiguiente();
    }),
  );
}

// ----- Ritmo personal (se aprende solo, sin preguntar nada) -----
// Tras cada viaje completo se compara el tiempo real con el estimado. Desde 2 viajes con el mismo vehículo,
// los tiempos se ajustan con la mediana de los últimos 5 (entre 0,7 y 2 veces el cálculo).

function ritmoPersonal(vehiculo = valorDe('vehiculo')) {
  const medidas = leer('ritmo', {})[vehiculo] ?? [];
  if (medidas.length < 2) return 1;
  const orden = [...medidas].sort((a, b) => a - b);
  const mitad = Math.floor(orden.length / 2);
  const mediana = orden.length % 2 ? orden[mitad] : (orden[mitad - 1] + orden[mitad]) / 2;
  return Math.round(Math.min(2, Math.max(0.7, mediana)) * 100) / 100;
}

function registrarRitmo({ segundosReales, segundosEstimados, ajusteAplicado = 1 }) {
  // Se guarda la relación con el cálculo base (sin el ajuste que ya se había aplicado).
  const relacion = segundosReales / (segundosEstimados / ajusteAplicado);
  if (!Number.isFinite(relacion) || relacion < 0.4 || relacion > 3) return; // viaje atípico (paradas largas, etc.)
  const vehiculo = valorDe('vehiculo');
  const ritmo = leer('ritmo', {});
  ritmo[vehiculo] = [...(ritmo[vehiculo] ?? []), Math.round(relacion * 100) / 100].slice(-5);
  guardar('ritmo', ritmo);
}

function lineaRitmo(ruta) {
  const ajuste = ruta.ajusteRitmo ?? 1;
  if (Math.abs(ajuste - 1) < 0.05) return null;
  const porcentaje = Math.round((ajuste - 1) * 100);
  return el('p', { class: 'ruta-datos' }, `⏱ Tiempo ajustado a tu ritmo real (${porcentaje > 0 ? '+' : ''}${porcentaje} %).`);
}

// ----- Opiniones y puntos a evitar (solo en este equipo) -----

const MAX_EVITAR = 20;
const puntosEvitar = () => leer('evitar', []).map(({ lat, lon }) => ({ lat, lon }));

function guardarOpinion(opinion) {
  const opiniones = leer('opiniones', []);
  opiniones.push({ ...opinion, fecha: new Date().toISOString(), vehiculo: valorDe('vehiculo') });
  guardar('opiniones', opiniones.slice(-200));

  // Puntos difíciles: se evitarán en las próximas rutas (sin repetir los que están a menos de 40 m).
  agregarEvitados(opinion.dificiles);

  const mensajes = [];
  if (opinion.dificiles.length) {
    mensajes.push(el('p', { class: 'aviso aviso-info' }, `Anotado: evitaré ${opinion.dificiles.length === 1 ? 'ese punto' : `esos ${opinion.dificiles.length} puntos`} en tus próximas rutas.`));
  }
  if (opinion.practica && opinion.llego) mensajes.push(registrarPractica(opinion.practica, opinion.valoracion));
  if (mensajes.length) mostrarMensajes(...mensajes.filter(Boolean));
  pintarDatosGuardados();
}

// ----- Lugares a evitar: difíciles o donde te sentiste inseguro (solo en este equipo) -----
// No hay datos públicos de delitos por calle en Lima: se usa tu experiencia. Las rutas esquivan unos 80 m
// alrededor de cada lugar (menos los que están junto a la salida o la llegada).

const capaEvitar = L.layerGroup().addTo(mapa);
const iconoEvitar = L.divIcon({ className: 'contenedor-evitar', html: '<span class="marca-evitar"></span>', iconSize: [22, 22], iconAnchor: [11, 11] });
let modoEvitar = false;
const avisoEvitar = el(
  'div',
  { class: 'aviso-mapa', hidden: true },
  el('span', {}, 'Toca el lugar que quieres evitar'),
  el('button', { type: 'button', class: 'enlace-boton', onclick: () => terminarModoEvitar() }, 'Cancelar'),
);
L.DomEvent.disableClickPropagation(avisoEvitar);
mapa.getContainer().append(avisoEvitar);

function iniciarModoEvitar() {
  terminarModoMapa();
  modoEvitar = true;
  botonEvitar.setAttribute('aria-pressed', 'true');
  avisoEvitar.hidden = false;
  mapa.getContainer().style.cursor = 'crosshair';
  if (!mapaCompleto) mapa.getContainer().scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function terminarModoEvitar() {
  if (!modoEvitar) return;
  modoEvitar = false;
  botonEvitar.setAttribute('aria-pressed', 'false');
  avisoEvitar.hidden = true;
  mapa.getContainer().style.cursor = '';
}

botonEvitar.addEventListener('click', () => (modoEvitar ? terminarModoEvitar() : iniciarModoEvitar()));

function elegirMotivo(latlng) {
  const opcion = (motivo, texto) =>
    el('button', { type: 'button', class: 'boton-motivo', onclick: () => marcarEvitado(latlng, motivo) }, texto);
  L.popup({ className: 'popup-motivo' })
    .setLatLng(latlng)
    .setContent(
      el(
        'div',
        { class: 'elegir-motivo' },
        el('strong', {}, '¿Por qué quieres evitarlo?'),
        opcion('inseguro', '😟 Me siento inseguro ahí'),
        opcion('dificil', '😰 Es difícil manejar ahí'),
      ),
    )
    .openOn(mapa);
}

const TITULO_MOTIVO = { inseguro: 'Aquí te sentiste inseguro', dificil: 'Lugar difícil' };

// Agrega lugares sin repetir los que están a menos de 40 m de otro ya guardado. Devuelve cuántos agregó.
function agregarEvitados(nuevos) {
  const evitar = leer('evitar', []);
  const cerca = (a, b) => Math.hypot((a.lat - b.lat) * 110_574, (a.lon - b.lon) * 108_900) < 40;
  let agregados = 0;
  for (const d of nuevos) {
    if (evitar.some((e) => cerca(e, d))) continue;
    evitar.push(d);
    agregados++;
  }
  guardar('evitar', evitar.slice(-MAX_EVITAR));
  pintarEvitados();
  return agregados;
}

function marcarEvitado({ lat, lng }, motivo) {
  mapa.closePopup();
  const punto = { lat: Math.round(lat * 1e5) / 1e5, lon: Math.round(lng * 1e5) / 1e5, motivo, titulo: TITULO_MOTIVO[motivo] };
  const agregado = agregarEvitados([punto]);
  pintarDatosGuardados();
  const texto = !agregado
    ? 'Ese lugar ya estaba marcado.'
    : rutas.length
      ? 'Anotado. Vuelve a buscar la ruta para que lo esquive.'
      : 'Anotado: tus próximas rutas esquivarán ese lugar.';
  mostrarMensajes(el('p', { class: 'aviso aviso-info' }, texto));
}

function quitarEvitado(k) {
  const evitar = leer('evitar', []);
  evitar.splice(k, 1);
  guardar('evitar', evitar);
  mapa.closePopup();
  pintarEvitados();
  pintarDatosGuardados();
}

function pintarEvitados() {
  capaEvitar.clearLayers();
  leer('evitar', []).forEach((p, k) =>
    L.marker([p.lat, p.lon], { icon: iconoEvitar, keyboard: false, title: TITULO_MOTIVO[p.motivo] ?? p.titulo ?? 'Lugar a evitar' })
      .bindPopup(() =>
        el(
          'div',
          { class: 'popup-evitar' },
          el('strong', {}, p.motivo === 'inseguro' ? TITULO_MOTIVO.inseguro : (p.titulo ?? TITULO_MOTIVO.dificil)),
          el('p', {}, 'Tus rutas pasan lejos de aquí, a unos 80 m. Solo se guarda en este equipo.'),
          el('button', { type: 'button', class: 'enlace-boton', onclick: () => quitarEvitado(k) }, 'Dejar de evitar'),
        ),
      )
      .addTo(capaEvitar),
  );
}
pintarEvitados();

// ----- Favoritos -----

const ICONO_FAVORITO = { Casa: '🏠', Trabajo: '💼', Academia: '🎓' };
const MAX_FAVORITOS = 8;
let ultimoCampo = { cual: 'origen', cuando: 0 };
for (const cual of ['origen', 'destino']) $(cual).addEventListener('focus', () => (ultimoCampo = { cual, cuando: Date.now() }));

function pintarFavoritos() {
  const lista = leer('favoritos', []);
  const caja = $('favoritos');
  caja.hidden = !lista.length;
  caja.replaceChildren(
    el('span', { class: 'favoritos-titulo' }, 'Tus lugares:'),
    ...lista.map((f, k) =>
      el(
        'span',
        { class: 'chip-favorito' },
        el('button', { type: 'button', class: 'chip', title: f.etiqueta, onclick: () => usarFavorito(f) }, `${ICONO_FAVORITO[f.nombre] ?? '⭐'} ${f.nombre}`),
        el('button', { type: 'button', class: 'chip-quitar', 'aria-label': `Quitar ${f.nombre}`, title: `Quitar ${f.nombre}`, onclick: () => quitarFavorito(k) }, '×'),
      ),
    ),
  );
}

// Va al campo que tocaste hace poco; si no, al primero vacío.
function usarFavorito(f) {
  const reciente = Date.now() - ultimoCampo.cuando < 8000;
  const cual = reciente ? ultimoCampo.cual : !puntos.origen ? 'origen' : 'destino';
  $(cual).value = f.etiqueta;
  ponerPunto(cual, f.lat, f.lon, { etiqueta: f.etiqueta, texto: f.etiqueta, exacto: true });
  mapa.panTo([f.lat, f.lon]);
}

function quitarFavorito(k) {
  const lista = leer('favoritos', []);
  lista.splice(k, 1);
  guardar('favoritos', lista);
  pintarFavoritos();
}

function guardarFavorito(cual, nombre) {
  const p = puntos[cual];
  if (!p || !nombre) return;
  const lista = leer('favoritos', []).filter((f) => f.nombre.toLowerCase() !== nombre.toLowerCase());
  lista.push({ nombre, etiqueta: p.etiqueta ?? $(cual).value.trim(), lat: p.lat, lon: p.lon });
  guardar('favoritos', lista.slice(-MAX_FAVORITOS));
  pintarFavoritos();
}

// Botón "☆ Guardar" junto al punto elegido, con nombres rápidos.
function botonGuardarFavorito(cual) {
  const caja = el('span', { class: 'guardar-favorito' });
  const abrir = el('button', { type: 'button', class: 'enlace-boton' }, '☆ Guardar como favorito');
  abrir.addEventListener('click', () => {
    const otro = el('input', { type: 'text', maxlength: '20', placeholder: 'Otro nombre', 'aria-label': 'Nombre del lugar' });
    const listo = (nombre) => {
      guardarFavorito(cual, nombre.trim());
      caja.replaceChildren(el('span', { class: 'guardado' }, `✓ Guardado como "${nombre.trim()}"`));
    };
    caja.replaceChildren(
      ...['Casa', 'Trabajo', 'Academia'].map((n) => el('button', { type: 'button', class: 'chip', onclick: () => listo(n) }, `${ICONO_FAVORITO[n]} ${n}`)),
      otro,
      el('button', { type: 'button', class: 'chip', onclick: () => otro.value.trim() && listo(otro.value) }, 'Guardar'),
    );
    otro.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') {
        ev.preventDefault();
        if (otro.value.trim()) listo(otro.value);
      }
    });
  });
  caja.append(abrir);
  return caja;
}

pintarFavoritos();

// ----- Modo práctica -----

const NIVELES_PRACTICA = {
  1: { corto: '1 · Calles', meta: 'Calles tranquilas y pocos giros a la izquierda: para acostumbrarte al vehículo.' },
  2: { corto: '2 · Izquierdas', meta: 'Calles tranquilas con giros a la izquierda donde hay poco tráfico.' },
  3: { corto: '3 · Cruces', meta: 'Cruzar avenidas medianas, mejor con semáforo, sin recorrerlas.' },
  4: { corto: '4 · Avenida', meta: 'Unas cuadras por una avenida mediana y vuelta a calles tranquilas.' },
};
const PRACTICAS_PARA_SUBIR = 3;
const progresoPractica = () => leer('practica', { desbloqueado: 1, completadas: {} });

function pintarNiveles() {
  const { desbloqueado, completadas } = progresoPractica();
  const actual = Number(document.querySelector('input[name="nivelPractica"]:checked')?.value) || desbloqueado;
  $('practica-niveles').replaceChildren(
    el('legend', {}, 'Nivel'),
    ...Object.entries(NIVELES_PRACTICA).map(([n, d]) => {
      const bloqueado = Number(n) > desbloqueado;
      return el(
        'label',
        { title: bloqueado ? `Completa ${PRACTICAS_PARA_SUBIR} prácticas del nivel anterior para desbloquearlo` : d.meta },
        el('input', { type: 'radio', name: 'nivelPractica', value: n, disabled: bloqueado, checked: Number(n) === Math.min(actual, desbloqueado) }),
        el('span', {}, `${bloqueado ? '🔒 ' : ''}${d.corto}`),
      );
    }),
  );
  const nivel = Number(document.querySelector('input[name="nivelPractica"]:checked')?.value) || 1;
  const hechas = completadas[nivel] ?? 0;
  $('practica-meta').textContent = `${NIVELES_PRACTICA[nivel].meta} Llevas ${hechas} ${hechas === 1 ? 'práctica' : 'prácticas'} en este nivel.`;
}
$('practica-niveles').addEventListener('change', pintarNiveles);

// Cuenta una práctica terminada; tres sin estrés desbloquean el nivel siguiente.
function registrarPractica(nivel, valoracion) {
  const progreso = progresoPractica();
  if (valoracion === 'estresante') {
    pintarNiveles();
    return el('p', { class: 'aviso aviso-info' }, 'Gracias por contarlo. Repite este nivel con calma; no cuenta para subir hasta que se sienta tranquilo.');
  }
  progreso.completadas[nivel] = (progreso.completadas[nivel] ?? 0) + 1;
  let texto = `¡Bien! Llevas ${progreso.completadas[nivel]} de ${PRACTICAS_PARA_SUBIR} prácticas del nivel ${nivel}.`;
  if (progreso.completadas[nivel] >= PRACTICAS_PARA_SUBIR && progreso.desbloqueado === nivel && nivel < 4) {
    progreso.desbloqueado = nivel + 1;
    texto = `🎉 ¡Desbloqueaste el nivel ${nivel + 1}! ${NIVELES_PRACTICA[nivel + 1].meta}`;
  }
  guardar('practica', progreso);
  pintarNiveles();
  return el('p', { class: 'aviso aviso-info' }, texto);
}

let buscandoUbicacion = false;
async function usarUbicacionActual(enPractica = false) {
  if (buscandoUbicacion) return;
  buscandoUbicacion = true;
  const revision = versionOrigen;
  const botones = [$('origen-ubicacion'), $('practica-ubicacion')];
  const textos = botones.map((b) => b.textContent);
  botones.forEach((b) => { b.disabled = true; b.setAttribute('aria-busy', 'true'); b.textContent = 'Buscando ubicación…'; });
  mostrarMensajes(el('p', { class: 'cargando' }, 'Buscando tu ubicación… Si te lo pide, permite el acceso.'));
  try {
    const pos = await obtenerUbicacion();
    // Si eligió otro origen mientras esperaba, no se pisa su elección.
    if (revision !== versionOrigen) { mostrarMensajes(); return; }
    terminarModoMapa();
    terminarModoEvitar();
    $('origen-sugerencias').hidden = true;
    const texto = 'Mi ubicación actual';
    $('origen').value = texto;
    ponerPunto('origen', pos.lat, pos.lon, {
      texto, exacto: false,
      etiqueta: texto + (pos.precision !== null ? ' (precisión aproximada: ±' + pos.precision + ' m)' : ''),
    });
    mapa.setView([pos.lat, pos.lon], 16);
    if (pos.precision !== null && pos.precision > 100) {
      mostrarMensajes(el('p', { class: 'aviso aviso-info' }, 'La ubicación tiene poca precisión. Revisa el punto A y arrástralo si hace falta.'));
    } else mostrarMensajes();
    if (!enPractica) $('destino').focus();
  } catch (error) {
    if (revision === versionOrigen) mostrarMensajes(el('p', { class: 'aviso aviso-error' }, error.message));
  } finally {
    buscandoUbicacion = false;
    botones.forEach((b, i) => { b.disabled = false; b.removeAttribute('aria-busy'); b.textContent = textos[i]; });
  }
}
$('origen-ubicacion').addEventListener('click', () => usarUbicacionActual());
$('practica-ubicacion').addEventListener('click', () => usarUbicacionActual(true));

$('practica-armar').addEventListener('click', async () => {
  const boton = $('practica-armar');
  try {
    if ($('origen').value.trim() && !puntos.origen) await asegurarPunto('origen');
    if (!puntos.origen) throw new Error('Elige desde dónde sales: escribe el punto "Desde" o toca "Usar mi ubicación".');
    boton.disabled = true;
    boton.textContent = 'Armando…';
    mostrarMensajes(el('p', { class: 'cargando' }, 'Armando un circuito de práctica cerca de ti…'));
    const nivel = Number(document.querySelector('input[name="nivelPractica"]:checked')?.value) || 1;
    const datos = await api('/api/practica', {
      origen: { lat: puntos.origen.lat, lon: puntos.origen.lon },
      minutos: Number(document.querySelector('input[name="minutos"]:checked').value),
      nivel,
      vehiculo: valorDe('vehiculo'),
      semilla: leer('semillaPractica', 1),
      evitar: puntosEvitar(),
      ajusteRitmo: ritmoPersonal(),
    });
    guardar('semillaPractica', datos.siguienteSemilla); // la próxima vez, otro circuito
    datos.ruta.practica = { nivel: datos.nivel };
    mostrarResultados({ rutas: [datos.ruta] }, { avisos: false });
    mostrarMensajes(
      el('p', { class: 'aviso aviso-info' }, el('strong', {}, `Práctica nivel ${datos.nivel}: ${datos.titulo}. `), `${datos.meta} Este circuito: ${datos.resumen}.`),
    );
    if (window.matchMedia('(max-width: 899px)').matches) $('resultados').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (error) {
    mostrarMensajes(el('p', { class: 'aviso aviso-error' }, error.message));
  } finally {
    boton.disabled = false;
    boton.textContent = 'Armar práctica';
  }
});

pintarNiveles();

// ----- Datos guardados en este equipo -----

function pintarDatosGuardados() {
  const evitar = leer('evitar', []).length;
  const boton = $('borrar-datos');
  if (boton) boton.textContent = evitar ? `Borrar mis datos de este equipo (incluye ${evitar} ${evitar === 1 ? 'punto' : 'puntos'} a evitar)` : 'Borrar mis datos de este equipo';
}

$('borrar-datos')?.addEventListener('click', () => {
  if (!window.confirm('¿Borrar tus favoritos, opiniones, puntos a evitar y progreso de práctica de este equipo?')) return;
  borrarTodo();
  pintarEvitados();
  $('autonomia').value = '';
  document.querySelector('input[name="despues"][value="quedo"]').checked = true;
  quitarSiguiente();
  actualizarCampoBateria();
  pintarFavoritos();
  pintarNiveles();
  pintarDatosGuardados();
  mostrarMensajes(el('p', { class: 'aviso aviso-info' }, 'Listo: borré los datos guardados en este equipo.'));
});

pintarDatosGuardados();

// Al final: usa los favoritos como atajos para el punto C.
actualizarCampoBateria();
