import { test } from 'node:test';
import assert from 'node:assert/strict';
import { obtenerUbicacion } from '../public/ubicacion.js';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

test('web: pide una lectura reciente y precisa solo al solicitarla', async () => {
  let llamadas = 0;
  const opciones = { ventana: { isSecureContext: true }, navegador: { geolocation: { getCurrentPosition(ok, error, cfg) {
    llamadas++; assert.equal(cfg.maximumAge, 0); assert.equal(cfg.enableHighAccuracy, true);
    ok({ coords: { latitude: -12.09, longitude: -77.06, accuracy: 12.4 } });
  } } } };
  assert.equal(llamadas, 0);
  assert.deepEqual(await obtenerUbicacion(opciones), {lat: -12.09, lon: -77.06, precision: 12});
});
test('web: explica permiso denegado, tiempo agotado y GPS no disponible', async () => {
  for (const [code, mensaje] of [[1, /Permite el acceso/], [2, /GPS/], [3, /tardando/]]) {
    await assert.rejects(obtenerUbicacion({ ventana: {isSecureContext: true}, navegador: { geolocation: { getCurrentPosition(ok, error) {error({code});} } } }), mensaje);
  }
  await assert.rejects(obtenerUbicacion({ventana: {isSecureContext: false}, navegador: {}}), /HTTPS/);
  await assert.rejects(obtenerUbicacion({ventana: {}, navegador: {}}), /no puede dar/);
});
test('nativo: obtiene el origen sin servicio en segundo plano y cierra el watcher', async () => {
  const llamadas = [];
  const cap = {
    isNativePlatform: () => true,
    nativeCallback(plugin, metodo, cfg, aviso) {
      assert.equal(plugin, 'BackgroundGeolocation'); assert.equal(metodo, 'addWatcher');
      assert.equal(cfg.stale, false); assert.equal(cfg.backgroundMessage, undefined);
      aviso({latitude: -12.09, longitude: -77.06, accuracy: 8});
      return 'lectura-origen';
    },
    nativePromise(...args) {llamadas.push(args); return Promise.resolve();},
  };
  const pos = await obtenerUbicacion({ventana: {Capacitor: cap}, navegador: {}});
  await Promise.resolve(); await Promise.resolve();
  assert.equal(pos.precision, 8);
  assert.deepEqual(llamadas, [['BackgroundGeolocation', 'removeWatcher', {id: 'lectura-origen'}]]);
});
test('nativo: al agotar el tiempo retira la lectura y rechaza posiciones tardías', async (t) => {
  t.mock.timers.enable({apis: ['setTimeout']});
  let aviso; const eliminados = [];
  const capacitor = { isNativePlatform: () => true, nativeCallback(p,m,c,cb) {aviso=cb; return 'lenta';}, nativePromise(p,m,c) {eliminados.push(c.id); return Promise.resolve();} };
  const pendiente = obtenerUbicacion({ventana: {Capacitor: capacitor}, navegador: {}, espera: 100});
  const rechazo = assert.rejects(pendiente, /tardando/);
  await Promise.resolve(); t.mock.timers.tick(100); await rechazo; await Promise.resolve();
  assert.ok(eliminados.includes('lenta'));
  aviso({latitude: -12, longitude: -77, accuracy: 2});
  await Promise.resolve(); assert.ok(eliminados.length >= 2);
});
test('rechaza coordenadas inválidas en vez de colocar un marcador incorrecto', async () => {
  await assert.rejects(obtenerUbicacion({ventana: {}, navegador: {geolocation: {getCurrentPosition(ok) {ok({coords: {latitude: NaN, longitude: -77}});}}}}), /posición válida/);
});

// Ejercita el controlador real de la interfaz sin solicitar ubicación al equipo de pruebas.
const fuente = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const controlador = fuente.slice(fuente.indexOf('let buscandoUbicacion = false;'), fuente.indexOf("$('origen-ubicacion').addEventListener"));
function interfaz(obtener) {
  const nodos = Object.fromEntries(['origen', 'destino', 'origen-ubicacion', 'practica-ubicacion', 'origen-sugerencias'].map((id) => [id, { value: id === 'origen' ? 'Origen previo' : '', textContent: id, disabled: false, hidden: false, setAttribute() {}, removeAttribute() {}, focus() {this.enfocado=true;} }]));
  const puntos = []; const mensajes = [];
  const ctx = vm.createContext({ versionOrigen: 0, $: (id) => nodos[id], obtenerUbicacion: obtener, el: (...args) => args, mostrarMensajes: (...args) => mensajes.push(args), terminarModoMapa() {}, terminarModoEvitar() {}, ponerPunto(...args) {puntos.push(args);ctx.versionOrigen++;}, mapa: {setView() {}} });
  vm.runInContext(controlador + ';globalThis.usar = usarUbicacionActual;', ctx);
  return {ctx,nodos,puntos,mensajes};
}
test('el botón coloca el origen, muestra precisión y lleva el foco al destino', async () => {
  const i = interfaz(async () => ({lat:-12.09,lon:-77.06,precision:15}));
  await i.ctx.usar();
  assert.equal(i.nodos.origen.value, 'Mi ubicación actual');
  assert.equal(i.puntos[0][0], 'origen'); assert.equal(i.puntos[0][3].exacto, false);
  assert.match(i.puntos[0][3].etiqueta, /15 m/);
  assert.equal(i.nodos.destino.enfocado, true);
  assert.equal(i.nodos['origen-ubicacion'].disabled, false);
});
test('no pisa un origen elegido mientras espera y evita solicitudes duplicadas', async () => {
  let completar; let llamadas = 0;
  const i = interfaz(() => {llamadas++;return new Promise((r) => {completar=r;});});
  const primera=i.ctx.usar(); await i.ctx.usar();
  assert.equal(llamadas,1); assert.equal(i.nodos['origen-ubicacion'].disabled,true);
  i.ctx.versionOrigen++;i.nodos.origen.value='Otro origen';completar({lat:-12,lon:-77,precision:5});await primera;
  assert.equal(i.puntos.length,0);assert.equal(i.nodos.origen.value,'Otro origen');
});
test('si el GPS falla conserva el origen y permite reintentar', async () => {
  const i=interfaz(async () => {throw new Error('Permiso denegado');});
  await i.ctx.usar();assert.equal(i.nodos.origen.value,'Origen previo');assert.equal(i.puntos.length,0);
  assert.equal(i.nodos['origen-ubicacion'].disabled,false);assert.match(JSON.stringify(i.mensajes),/Permiso denegado/);
});

test('en práctica conserva el foco y una lectura poco precisa pide revisar el marcador', async () => {
  const i=interfaz(async () => ({lat:-12.09,lon:-77.06,precision:250}));
  await i.ctx.usar(true);
  assert.equal(i.nodos.destino.enfocado,undefined);
  assert.match(JSON.stringify(i.mensajes),/poca precisión/);
  assert.equal(i.puntos[0][3].exacto,false);
});
