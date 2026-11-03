// Interfaz de Ruta Tranquila: formulario, mapa (Leaflet + OpenStreetMap) y resultados.
// Los textos que vienen del servidor se insertan siempre con textContent, nunca como HTML.

import { iniciarViaje } from './viaje.js';

const LIMA = [-12.09, -77.03];
const COLORES = { tranquila: '#15803d', alternativa: '#7c3aed', rapida: '#475569' };
const NOMBRE_TIPO = { tranquila: 'Más tranquila', rapida: 'Más rápida', alternativa: 'Alternativa' };
const NOMBRE_CLASE = {
  residencial: 'calles tranquilas',
  menor: 'calles con más movimiento',
  secundaria: 'avenidas medianas',
  primaria: 'avenidas grandes',
  autopista: 'vías rápidas',
  ciclovia: 'ciclovías',
  vereda: 'veredas o parques (a pie)',
};
const TIPOS_ALERTA = new Set(['cruce', 'tramo', 'trafico']);

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
  if (!respuesta.ok) throw new Error(datos.error || `Error ${respuesta.status}`);
  return datos;
}

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

const capaRutas = L.layerGroup().addTo(mapa);
const capaAlertas = L.layerGroup().addTo(mapa);

const puntos = { origen: null, destino: null };
let modoMapa = null;
let rutas = [];
let lineas = [];
let alertas = [];

const iconoMarca = (cual) =>
  L.divIcon({
    className: 'contenedor-marca',
    html: `<div class="marca-mapa ${cual}"><span>${cual === 'origen' ? 'A' : 'B'}</span></div>`,
    iconSize: [30, 30],
    iconAnchor: [15, 36],
  });

const svgAlerta = (tipo) =>
  `<svg class="icono-alerta tipo-${TIPOS_ALERTA.has(tipo) ? tipo : 'cruce'}" viewBox="0 0 24 24" aria-hidden="true">` +
  '<path d="M12 2.5 1.5 21h21z"/><rect x="11" y="8.5" width="2" height="7" rx="1"/><circle cx="12" cy="18.2" r="1.2"/></svg>';

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

function ponerPunto(cual, lat, lon, datos = {}) {
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
  capaAlertas.clearLayers();
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

function seleccionar(i, ajustar = false) {
  lineas.forEach((linea, k) => {
    linea.setStyle(estiloLinea(rutas[k], k === i));
    if (k === i) linea.bringToFront();
  });
  document.querySelectorAll('.ruta').forEach((tarjeta, k) => {
    tarjeta.classList.toggle('seleccionada', k === i);
    tarjeta.setAttribute('aria-current', k === i ? 'true' : 'false');
  });
  capaAlertas.clearLayers();
  alertas = rutas[i].puntosCriticos.map((p) =>
    L.marker([p.lat, p.lon], { icon: iconoAlerta(p.tipo), title: p.titulo, keyboard: false })
      .bindPopup(el('div', {}, el('strong', {}, p.titulo), el('br'), p.detalle))
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

const tiempoDe = (ruta) => (ruta.trafico?.confiable ? ruta.trafico.duracionSegundos : ruta.duracionSegundos);

function tarjeta(ruta, i) {
  const tipo = ruta.tipos[0];
  const titulo = ruta.tipos.map((t, k) => (k ? NOMBRE_TIPO[t].toLowerCase() : NOMBRE_TIPO[t])).join(' y ');
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
        extra > 0 && el('p', { class: 'ruta-datos' }, `${extra} min más que la más rápida`),
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
    el(
      'ul',
      { class: 'leyenda' },
      Object.entries(puntaje.porcentajes).map(([clase, pct]) => el('li', { class: `clase-${clase}` }, `${pct}% ${NOMBRE_CLASE[clase]}`)),
    ),
    el('p', { class: 'explicacion' }, puntaje.explicacion),
    usaViaRapida &&
      el('p', { class: 'nota-ruta' }, 'Usa vías rápidas como la Vía Expresa o la Panamericana. Si recién empiezas, mejor evítalas; algunas motos y scooters tienen restricciones ahí.'),
    el(
      'details',
      { open: i === 0 },
      el('summary', {}, criticos.length ? `${criticos.length} ${criticos.length === 1 ? 'punto crítico' : 'puntos críticos'}` : 'Sin puntos críticos'),
      criticos.length ? listaCriticos : el('p', { class: 'nota-ruta' }, 'No encontré cruces ni tramos por avenidas grandes o medianas.'),
    ),
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
  mapa.setZoom(17);
  iniciarViaje(rutas[i], {
    mapa,
    el,
    ensayo,
    alRecalcular: (pos) => {
      if (!pos) return;
      $('origen').value = 'Tu ubicación';
      ponerPunto('origen', pos.lat, pos.lon, { etiqueta: 'Tu ubicación', texto: 'Tu ubicación' });
      $('formulario').requestSubmit();
    },
  });
}

function mostrarResultados({ rutas: lista, horario, trafico }) {
  rutas = lista;
  const mensajes = [];
  if (horario.mensaje) {
    mensajes.push(el('p', { class: 'aviso aviso-hora' }, el('strong', {}, horario.enHoraPunta ? 'Hora punta. ' : 'Atento a la hora. '), horario.mensaje));
  }
  if (rutas.length === 1) mensajes.push(el('p', { class: 'aviso aviso-info' }, 'La ruta más rápida también es la más tranquila que encontré.'));
  if (trafico.mensaje) mensajes.push(el('p', { class: 'aviso aviso-info' }, trafico.mensaje));
  mostrarMensajes(...mensajes);

  $('resultados').replaceChildren(...rutas.map(tarjeta));
  lineas = rutas.map((ruta, i) => L.polyline(ruta.geometria, estiloLinea(ruta, false)).on('click', () => seleccionar(i)).addTo(capaRutas));
  seleccionar(0, true);
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
    const datos = await api('/api/rutas', {
      origen: { lat: origen.lat, lon: origen.lon },
      destino: { lat: destino.lat, lon: destino.lon },
      salida,
      vehiculo: valorDe('vehiculo'),
      nivel: valorDe('nivel'),
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
function sugerir(cual) {
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
                    ponerPunto(cual, l.lat, l.lon, { etiqueta: l.etiqueta, exacto: l.exacto, texto: l.etiqueta });
                    mapa.panTo([l.lat, l.lon]);
                    lista.hidden = true;
                  },
                },
                el('strong', {}, l.nombre),
                el('span', {}, l.zona || l.etiqueta),
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
