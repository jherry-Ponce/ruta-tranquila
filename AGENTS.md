# Guía para agentes (Codex, Claude Code y otros)

Este archivo es el contexto compartido del proyecto. Lo leen Codex (AGENTS.md) y Claude Code (vía CLAUDE.md).
Si tomas una decisión de diseño que el código no explica por sí solo, agrégala aquí en el mismo commit.

## Qué es

**Voy Tranqui** (antes "Ruta Tranquila"): app que busca rutas por calles tranquilas en Lima para quien está
aprendiendo a manejar (auto, moto eléctrica) o va en bici/monopatín. Producción web: https://ruta-tranquila.vercel.app

- Marca comercial elegida por el usuario el 2026-11-03: **Voy Tranqui** (lema: "Maneja con confianza por Lima").
  El repo y el dominio de Vercel siguen con el nombre viejo; la web todavía muestra "Ruta Tranquila".
- App Android en `android-app/` (Capacitor, id `pe.voytranqui.app`): carga la web de Vercel y agrega GPS y voz
  nativos para guiar con la pantalla apagada. Ver `android-app/README.md`.

## Comandos

- `npm start`: servidor local en http://localhost:3000 (necesita `.env`, ver `.env.example`).
- `npm test`: pruebas con `node --test`. Deben pasar antes de cada push.
- `npm run datos`: vuelve a descargar las vías de OSM a `data/vias-principales-lima.json`.

## Forma de trabajo

- Antes de implementar, analizar y presentar opciones, plan y ejemplos. Esperar el acuerdo del usuario y luego ejecutar el alcance aprobado.

## Reglas del proyecto

- **Sin dependencias.** Node >= 22.9 puro en el servidor; en el navegador solo Leaflet por CDN. No agregar paquetes npm sin acordarlo.
- **Todo en español:** código, comentarios, textos de la interfaz y mensajes de commit.
- **Publicar = `git push` a `main`.** Vercel está conectado al repo (proyecto `ruta-tranquila`) y publica cada push en ~30 s. No hace falta el CLI de Vercel. Las keys (`ORS_API_KEY`, `TOMTOM_API_KEY`) están en las variables del proyecto en Vercel y en `.env` local; nunca en el repo.
- **Dos máquinas y dos agentes:** haz `git pull` antes de empezar y commits pequeños, para no pisar trabajo ajeno.

## Decisiones ya tomadas (no revertir sin hablarlo)

- OpenRouteService en `api.heigit.org/openrouteservice/v2` (el dominio viejo quedó obsoleto). `custom_model` no está disponible en la API pública.
- Rutas tranquilas con `avoid_polygons` sobre avenidas (`server/zonas.js`); se clasifica la ruta con el archivo local de OSM (`server/analisis.js`) porque el `waytype` de ORS no distingue lo suficiente.
- `cycling-regular` no se usa para auto: en Lima terminaba en la Vía Expresa. Para bici sí.
- Geocoding con TomTom primero (Pelias de ORS ubicaba mal los números).
- Tráfico TomTom: se mide en todas las rutas elegidas o en ninguna. La licencia gratuita de TomTom no permite la guía en tiempo real: el modo viaje no usa TomTom.
- No usar Google Routes API (términos 19.2). Google Maps solo mediante enlaces (Maps URLs).
- Bici: `bonoCiclovia` en `config/tranquilidad.js`. Se ajusta el **origen** a una ciclovía solo si se sale por una avenida (`server/snap-ciclovia.js`); el **destino** nunca, porque producía rodeos largos.
- App Android: Capacitor y no Flutter ni Kotlin, para no reescribir la app; carga la web remota para que cada push
  llegue sin reinstalar. GitHub Actions arma y firma el APK (`.github/workflows/apk.yml`); la llave nunca va al repo.
- Código web que corre dentro de la app: la web se carga remota y **no incluye `@capacitor/core`**, así que no existe
  `Capacitor.registerPlugin`; los plugins se llaman con `Capacitor.nativePromise(plugin, método, opciones)` y
  `Capacitor.nativeCallback(...)`. El WebView de Android **no tiene `speechSynthesis`**: nunca usarlo como global
  sin `window.`. Todo cambio en `public/viaje.js` debe probarse en web y en app (ver `test/viaje.test.js`).
- Modo viaje (`public/viaje.js`): la guía es por voz porque el novato no va con el celular en la mano. Un navegador no recibe GPS con la pantalla apagada; por eso hay modo bolsillo (pantalla negra encendida con Wake Lock), retomar al volver y "Seguir con Google Maps". La solución completa en segundo plano requeriría una app nativa.

- Tiempo total: incluye la caminata inicial a la ciclovía. Se conserva la duración del recorrido y se entrega `duracionTotalSegundos` por separado; la caminata sigue siendo una estimación en línea recta, no una ruta peatonal.
- Semáforos: solo se reduce la penalización si todas las calzadas detectadas en el cruce tienen una señal OSM en esa misma vía, a no más de 35 m. Sin coincidencia significa información desconocida. Se comparan las alternativas existentes; no se fuerza el paso por una señal.
- Giros: se usan maniobras ORS, no curvas geométricas. Se toleran 2 giros ponderados por km (mínimo 4 por viaje), con peso adicional para giros cerrados, vueltas en U y maniobras separadas por menos de 80 m. El descuento máximo es 12 puntos; ajustes en `config/tranquilidad.js`.

- Puntaje: el bono de ciclovía solo completa hasta 100 la base redondeada del recorrido, antes de restar cruces, tráfico y giros. El desglose muestra el bono aplicado, no el teórico; así los riesgos no desaparecen al saturar en 100.
- Calibración: `npm run calibrar` compara casos sintéticos de referencia y comprueba su orden esperado. No representan trayectos reales ni validación de seguridad en campo; para ajustar pesos con Lima se necesitan recorridos revisados por el usuario.

- Dirección confirmada por el usuario: Jirón Manuel Candamo 820, Lince = lat -12.0816676, lon -77.0280865. TomTom devolvía un punto 1,64 km al oeste aunque lo etiquetaba como exacto. La corrección vive en `server/ubicaciones-confirmadas.js`, aplica a búsqueda y sugerencias y no se extiende a otros números ni distritos.
- Enlaces de Google Maps: se acepta un punto explícito del lugar (`!3d...!4d...`, `query` o `q` con coordenadas); `@lat,lon` solo es el centro de cámara y no se usa como destino. Los enlaces cortos se expanden con redirecciones manuales solo a hosts de Google Maps permitidos. No se consulta Google Routes.

## Infraestructura ciclista y revisión de Magdalena

- Descarga: geometrías independientes (highway=cycleway y sendas designadas) y cycleway, cycleway:left/right/both sobre calles. track = separada; lane = carril; shared_lane/share_busway = compartida con vehículos. separate remite a otra geometría: no duplicarla. bicycle=yes no prueba protección.
- Interpretación en server/infraestructura-bici.js y conversión en scripts/lib/convertir-osm.js. Campos: o = id OSM, b = infraestructura y sentido, c = clase de la calzada. x=1 marca objetos añadidos solo para la capa ciclista: no entran al índice de avenidas ni generan cruces.
- Mapa: incluye conexiones cortas antes excluidas por ramal y distingue separada, carril, compartida con autos y con peatones. Los carriles etiquetados sobre calles se representan sobre el eje: no se inventa una geometría lateral.
- Solo bici usa esa infraestructura al clasificar rutas; se cotejan cercanía, paralelismo y sentido. Carriles y sendas tienen pesos propios (0,8 y 0,65), sin bono protegido. Compartir con autos conserva el riesgo vial original. El snap inicial sigue limitado a geometrías independientes separadas; nunca al eje de una avenida con carril lateral.
- Corredor confirmado: Avenida Parque Gonzales Prada (24306502, 24306643), Jirón Inclan (24306573), Jirón Miguel Grau (284892467 y otros) tienen cycleway:left=track. oneway:bicycle=yes prevalece sobre el lado izquierdo al determinar sentido. No extender la etiqueta a todas las cuadras por compartir nombre.
- La réplica global entregó base 2026-07-28: no sustituye la red vial existente de 2026-11-04 UTC. scripts/lib/fusionar-vias.js conserva avenidas y semáforos recientes y añade infraestructura. El corredor se contrastó con la API OSM el 2026-11-03 (hora de Lima). Metadatos separados: datosOsm, datosInfraBici, revisionCorredor. No afirmar que toda la información ciclista es de noviembre.
- Originales: referencias/osm-lima-original.json.gz y referencias/osm-corredor-magdalena.json.gz. Reproceso sin red: npm run datos -- --desde referencias/osm-lima-original.json.gz. Auditoría: npm run revisar:ciclovias → data/revision-ciclovias-magdalena.json (objetos, no kilómetros ni circuitos completos).
- Prueba real Juan de Aliaga 457 → La Paz 2551, bici: ORS entrega una alternativa por González Prada e Inclán; se reconoce 35% de ciclovías en ella. No se fuerza su elección: sigue comparándose dificultad, cruces y tiempo. Las etiquetas no garantizan continuidad física de toda la red.
- Fuentes: https://wiki.openstreetmap.org/wiki/Key:cycleway ; https://wiki.openstreetmap.org/wiki/Key:cycleway:right ; https://wiki.openstreetmap.org/wiki/Tag:highway%3Dcycleway ; https://wiki.openstreetmap.org/wiki/Overpass_API ; https://wiki.openstreetmap.org/wiki/API_v0.6 .

## Búsqueda de lugares por nombre

- Desde y Hasta usan TomTom Fuzzy Search (/search/2/search), que combina direcciones y puntos de interés. El endpoint /geocode no encontraba Plaza San Miguel por nombre. Se conservan las ubicaciones confirmadas y enlaces de Maps antes de consultar al proveedor, y ORS como respaldo.
- Se consultan 12 resultados limitados a Lima/Callao; se devuelven hasta 6 sugerencias o 5 resultados finales. Nombre completo coincidente primero, luego el centro comercial equivalente y nombres principales que incluyen las palabras consultadas; se conserva el orden del proveedor en empates. No se fija Plaza San Miguel a mano.
- Sugerencias: nombre, dirección y distrito. La etiqueta del punto conserva nombre y dirección al seleccionarlo. Los POI no se marcan como puerta exacta; las direcciones Point Address mantienen su indicador previo.
- Pruebas reales: Plaza San Miguel aparece primero; Hospital Rebagliati se encuentra por nombre; Juan de Aliaga 457 y Manuel Candamo 820 siguen funcionando. Pruebas simuladas cubren orden, límites, duplicados, respaldo y direcciones numeradas.
- Fuente: https://docs.tomtom.com/search-api/documentation/search-service/fuzzy-search .

## Funciones para el usuario (2026-11-04)

- Nombre visible: Voy Tranqui (título, encabezado, manifest). Política en `public/privacidad.html`: si cambia qué datos se usan, actualizarla.
- Datos del usuario solo en su equipo (`public/almacen.js`, prefijo `voytranqui:`): favoritos, opiniones, puntos a evitar (máx. 20), progreso de práctica, batería. Botón "Borrar mis datos de este equipo".
- Puntos a evitar: se envían en `/api/rutas` y `/api/practica` como `evitar`; el servidor los convierte en cuadrados de ~80 m (`zonasDePuntos`), omite los que están a menos de 150 m de la salida o llegada y no los guarda.
- Inseguridad (2026-11-04): no hay datos públicos de delitos por calle en Lima (SIDPOL quedó reservado por la PNP en
  agosto de 2025; lo publicado es por distrito, en PDF). No usar datos filtrados ni marcar distritos enteros. Se usa la
  experiencia propia: botón ⊘ del mapa o "¿Te sentiste inseguro…?" en la opinión → punto a evitar con `motivo`
  (`inseguro` | `dificil`), solo local; al servidor van solo las coordenadas. Medido el mismo día: solo 1,7 % de las
  calles de Lima (6,7 % en Lima moderna) tiene `lit` en OSM, así que la iluminación no sirve todavía para elegir rutas.
- Street View: enlace "Ver cómo es" en cada punto crítico (Maps URLs `map_action=pano`, rumbo de la ruta). Solo se abre si se toca.
- Recálculo automático: si sales de la ruta más de 8 s, `viaje.js` llama `alDesviarse` (una vez cada 45 s) y reemplaza la ruta sin cortar la guía (`cargarRuta`). Si falla, vuelve al aviso de estacionarse.
- Batería (`public/bateria.js`): ORS con `elevation: true`; 100 m de subida ≈ 1,5 km; margen de 20 %. Es una estimación y la interfaz lo dice.
- Batería, después de llegar: "Me quedo ahí", "Vuelvo al inicio" (mismo camino, sube lo que bajó) o "Sigo a otro lugar" (punto C).
  La pregunta aparece solo al escribir los km. El tramo B → C sale de `/api/tramo` (`tramoSiguiente`): **un** pedido ORS sin
  avenidas grandes (bici: sin avenidas), pedido en paralelo con `/api/rutas`; solo sirve para la cuenta, la guía termina en B.
  La tarjeta dice qué tramo no alcanza (`soloIda`) y dibuja una pila con un tramo por color y la reserva rayada.
- Opinión al llegar o al terminar tras 500 m: valoración y puntos difíciles. Avisar por WhatsApp con `wa.me` (lo envía la persona).
- Modo práctica (`practicar` en `server/planificador.js`): ORS `round_trip`, 4 circuitos por nivel con semillas propias del nivel (nivel×1000 + semilla), se elige con `valorar` del nivel. El resumen dice lo que trae el circuito real; en barrios rodeados de avenidas no siempre se puede cumplir el nivel. 3 prácticas sin "estresante" desbloquean el siguiente.
- Límite: el plan gratuito de ORS admite ~40 rutas por minuto; cada búsqueda usa 3-4 y cada práctica 4.
- Errores en producción: `window.onerror` → `/api/errores` → `console.error('[error-interfaz]')` (Vercel → Logs; en Hobby se guardan poco tiempo). Sin ubicaciones.

- Tiempos (`ajustarDuracion` en `server/planificador.js`): auto = ORS `driving-car`; moto eléctrica = mismo perfil pero ningún paso a más de 40,5 km/h (90 % de 45); bici o monopatín = ORS `cycling-regular` (~18 km/h medido) × 18/15. Decisión del usuario: no agregar selectores de velocidad para no recargar la pantalla.
- Ritmo personal: al llegar sin recálculo ni pausas >2 min (viaje >1 km), `viaje.js` envía tiempo real vs. estimado; `app.js` guarda la relación con el cálculo base (últimas 5 por vehículo, descarta <0,4 o >3) y desde 2 viajes manda `ajusteRitmo` (mediana, 0,7–2) a `/api/rutas` y `/api/practica`. Con tráfico TomTom se multiplica; la moto eléctrica nunca baja de su propio tope.
- Mapa: la red ciclista es fondo (colores apagados, 2 px, una línea en la leyenda) y la ruta elegida lleva borde oscuro (#1f2937). La red se oculta durante el viaje o ensayo y vuelve al terminar.

## Versión 2 (pendiente, en una rama aparte; no empezar sin acuerdo)

- Pasar los mapas de los tiles de OpenStreetMap (su política no admite uso intensivo) a un proveedor con plan gratuito antes de lanzar.
- Mejorar la búsqueda (15-40 s): mostrar la primera ruta apenas esté y guardar búsquedas repetidas.
- Errores: un registro persistente (los logs de Vercel Hobby duran poco).

## Ideas abiertas

- Publicar en Play Store (USD 25) cuando se quiera comercializar: misma llave de firma y mismo id.
