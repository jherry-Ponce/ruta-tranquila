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
- Modo viaje (`public/viaje.js`): la guía es por voz porque el novato no va con el celular en la mano. Un navegador no recibe GPS con la pantalla apagada; por eso hay modo bolsillo (pantalla negra encendida con Wake Lock), retomar al volver y "Seguir con Google Maps". La solución completa en segundo plano requeriría una app nativa.

- Tiempo total: incluye la caminata inicial a la ciclovía. Se conserva la duración del recorrido y se entrega `duracionTotalSegundos` por separado; la caminata sigue siendo una estimación en línea recta, no una ruta peatonal.
- Semáforos: solo se reduce la penalización si todas las calzadas detectadas en el cruce tienen una señal OSM en esa misma vía, a no más de 35 m. Sin coincidencia significa información desconocida. Se comparan las alternativas existentes; no se fuerza el paso por una señal.
- Giros: se usan maniobras ORS, no curvas geométricas. Se toleran 2 giros ponderados por km (mínimo 4 por viaje), con peso adicional para giros cerrados, vueltas en U y maniobras separadas por menos de 80 m. El descuento máximo es 12 puntos; ajustes en `config/tranquilidad.js`.

- Puntaje: el bono de ciclovía solo completa hasta 100 la base redondeada del recorrido, antes de restar cruces, tráfico y giros. El desglose muestra el bono aplicado, no el teórico; así los riesgos no desaparecen al saturar en 100.
- Calibración: `npm run calibrar` compara casos sintéticos de referencia y comprueba su orden esperado. No representan trayectos reales ni validación de seguridad en campo; para ajustar pesos con Lima se necesitan recorridos revisados por el usuario.

- Dirección confirmada por el usuario: Jirón Manuel Candamo 820, Lince = lat -12.0816676, lon -77.0280865. TomTom devolvía un punto 1,64 km al oeste aunque lo etiquetaba como exacto. La corrección vive en `server/ubicaciones-confirmadas.js`, aplica a búsqueda y sugerencias y no se extiende a otros números ni distritos.
- Enlaces de Google Maps: se acepta un punto explícito del lugar (`!3d...!4d...`, `query` o `q` con coordenadas); `@lat,lon` solo es el centro de cámara y no se usa como destino. Los enlaces cortos se expanden con redirecciones manuales solo a hosts de Google Maps permitidos. No se consulta Google Routes.

## Ideas abiertas

- Cambiar los textos visibles de la web de "Ruta Tranquila" a "Voy Tranqui" (pendiente de aprobar).
- Publicar en Play Store (USD 25) cuando se quiera comercializar: misma llave de firma y mismo id.
