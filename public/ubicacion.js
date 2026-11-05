// Una sola lectura solicitada por la persona; no mantiene seguimiento del origen.
function mensajeError(error) {
  if (error?.code === 1 || error?.code === 'NOT_AUTHORIZED') return 'Permite el acceso a tu ubicación en los ajustes del navegador o de Voy Tranqui y vuelve a intentarlo.';
  if (error?.code === 3) return 'El GPS está tardando. Acércate a un lugar con mejor señal y vuelve a tocar Mi ubicación actual.';
  return 'No pude obtener tu ubicación. Comprueba que el GPS esté activado o elige el punto en el mapa.';
}
function leerPosicion(p) {
  const lat = p?.latitude;
  const lon = p?.longitude;
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) throw new Error('El GPS no entregó una posición válida. Vuelve a intentarlo.');
  return { lat, lon, precision: Number.isFinite(p.accuracy) && p.accuracy >= 0 ? Math.round(p.accuracy) : null };
}

export function obtenerUbicacion({ navegador = globalThis.navigator, ventana = globalThis.window, espera = 15000 } = {}) {
  const cap = ventana?.Capacitor;
  const nativo = cap?.isNativePlatform?.() === true && typeof cap.nativeCallback === 'function' && typeof cap.nativePromise === 'function';
  if (!nativo && ventana?.isSecureContext === false) return Promise.reject(new Error('Abre Voy Tranqui con HTTPS para usar tu ubicación, o elige el punto en el mapa.'));
  if (!nativo && !navegador?.geolocation) return Promise.reject(new Error('Este navegador no puede dar tu ubicación. Puedes elegir el punto en el mapa.'));
  return new Promise((resolve, reject) => {
    let terminado = false;
    let id = null;
    const detener = () => {
      if (nativo && id !== null) {
        const actual = id;
        Promise.resolve().then(() => cap.nativePromise('BackgroundGeolocation', 'removeWatcher', { id: actual })).catch(() => {});
      }
    };
    const finalizar = (posicion, error) => {
      if (terminado) { detener(); return; }
      terminado = true;
      clearTimeout(reloj);
      detener();
      if (error) { reject(new Error(mensajeError(error))); return; }
      try { resolve(leerPosicion(posicion)); } catch (error) { reject(error); }
    };
    const reloj = setTimeout(() => finalizar(null, { code: 3 }), espera);
    try {
      if (nativo) {
        // Sin backgroundMessage: solo primer plano, sin iniciar el servicio de viaje.
        const registro = cap.nativeCallback('BackgroundGeolocation', 'addWatcher', { requestPermissions: true, stale: false, distanceFilter: 0 }, (posicion, error) => {
          if (posicion || error) finalizar(posicion, error);
        });
        Promise.resolve(registro).then((valor) => { id = valor; if (terminado) detener(); }, (error) => finalizar(null, error));
      } else {
        navegador.geolocation.getCurrentPosition((p) => finalizar(p.coords), (error) => finalizar(null, error), { enableHighAccuracy: true, maximumAge: 0, timeout: espera });
      }
    } catch (error) { finalizar(null, error); }
  });
}
