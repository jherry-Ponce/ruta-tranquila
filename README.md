# Ruta Tranquila

Mini app web para quienes están aprendiendo a manejar moto, moto eléctrica, scooter o auto en Lima y Callao. Sugiere rutas por calles con menos avenidas grandes, aunque tarden un poco más, y muestra los cruces y tramos difíciles que no se pueden evitar.

> **Aviso:** la ruta es una sugerencia automática basada en datos de mapas. No reemplaza tu atención al manejar ni las señales de tránsito.

## Requisitos

- Node.js 22.9 o más nuevo. No hace falta `npm install`, porque la app no tiene dependencias.
- Una key gratuita de OpenRouteService (obligatoria).
- Una key de TomTom (opcional, pero recomendada). Se usa para encontrar las direcciones con su número de casa y para el tráfico del momento.

## Cómo correrla

1. Copia `.env.example` con el nombre `.env` y pega tu key de OpenRouteService en `ORS_API_KEY`.
2. En esta carpeta, ejecuta:

   ```bash
   npm start
   ```

3. Abre http://localhost:3000

El archivo `.env` está en `.gitignore`, así que tus keys no se suben a git. El navegador nunca ve las keys: todas las consultas pasan por el servidor local.

## Elegir un punto mediante Google Maps

En Desde o Hasta puedes pegar el enlace completo de un lugar o pin de Google Maps, o un enlace corto compartido. Selecciona la sugerencia o busca la ruta para colocar el punto. Si el enlace solo contiene el centro de la cámara, un recorrido o un identificador sin coordenadas, la app pide compartir un lugar o elegir el punto en el mapa. Los puntos deben estar en Lima o Callao.

La dirección Jirón Manuel Candamo 820, Lince tiene una corrección puntual confirmada por el usuario: el proveedor la ubicaba aproximadamente 1,64 km al oeste. No se modifican otras numeraciones.

## Conseguir las keys

### OpenRouteService (obligatoria)

1. Entra a [openrouteservice.org](https://openrouteservice.org) y regístrate con **Sign up**. También puedes entrar con tu cuenta de GitHub.
2. Confirma tu correo con el enlace de activación. Si no llega, revisa la carpeta de spam.
3. En el panel (Dashboard), crea un token del tipo **Standard**, ponle un nombre (por ejemplo `ruta-tranquila`) y cópialo.
4. Pégalo en `.env`:

   ```
   ORS_API_KEY=tu_key_aquí
   ```

5. Reinicia el servidor con `npm start`.

El plan gratuito Standard permite 2,000 rutas al día y 40 por minuto. Cada búsqueda de la app pide 4 rutas, así que alcanza para unas 500 búsquedas diarias.

La app usa la dirección nueva de HeiGIT, `api.heigit.org`. La antigua, `api.openrouteservice.org`, quedó obsoleta en 2026 y su cuota se redujo al 10%. La misma key funciona en las dos.

### TomTom (opcional, recomendada)

1. Regístrate en el [portal de desarrolladores de TomTom](https://developer.tomtom.com/user/register) y confirma tu correo.
2. En **My Dashboard** ya aparece una key creada, llamada "My first API key". Cópiala.
3. Pégala en `.env` como `TOMTOM_API_KEY=...` y reinicia.

Sin esta key la app funciona igual, pero no muestra tráfico, y el buscador de OpenRouteService suele ubicar solo la calle, no el número de casa. Con la ruta de ejemplo, OpenRouteService dejó "Jr. Santorín 243, Santiago de Surco" en el centro de Surco, a unos 5 km del lugar real; TomTom encontró la dirección exacta.

El plan gratuito de TomTom incluye cada mes 20,000 búsquedas de direcciones, 20,000 búsquedas inversas y 20,000 rutas (la app las usa para medir el tráfico). El tráfico solo se mide cuando eliges salir "Ahora".

Sin un plan de suscripción, la licencia gratuita de TomTom cubre solo evaluación y pruebas internas. Para abrir la app a otras personas hay que contratar uno de sus planes. TomTom pide mostrar su atribución, que ya aparece al pie de la página.

## Probarla en tu celular

1. En `.env`, cambia `HOST=localhost` por `HOST=0.0.0.0` y reinicia. Si Windows pregunta por el firewall, permite el acceso en redes privadas.
2. Busca la IP de tu computadora con `ipconfig`, en la línea "Dirección IPv4" (por ejemplo `192.168.1.20`).
3. Con el celular en la misma red Wi-Fi, abre `http://192.168.1.20:3000`.

Con `HOST=0.0.0.0`, cualquier persona conectada a tu Wi-Fi puede usar la app y gastar tu cuota. Vuelve a `localhost` cuando termines.

## Vehículo, nivel y modo viaje

- **Vehículo:**
  - **Auto o moto:** usa la red de autos.
  - **Moto eléctrica:** igual que auto o moto, pero nunca por vías rápidas.
  - **Bicicleta o monopatín:** perfil `cycling-regular`, siempre sin recorrer avenidas, porque la R.M. 127-2021-MTC solo permite ciclovías, calles o jirones. Las ciclovías cuentan como lo más tranquilo y las veredas se marcan como "bájate y camina". Para estos vehículos no se mide tráfico.
    - Si la salida está sobre una avenida (a menos de 45 m de su eje) y hay una ciclovía a menos de 350 m que no aleja del destino, la ruta empieza en la ciclovía: el mapa dibuja el tramo a pie con una línea punteada y la lista avisa "Camina N m hasta la ciclovía". Si se sale de una calle tranquila, se monta ahí mismo. El destino nunca se ajusta, porque la ciclovía más cercana puede no estar bien conectada en la red real.
- **Nivel:**
  - **Recién aprendo:** evita avenidas grandes y medianas, y acepta hasta 2,5 veces el tiempo de la ruta rápida más 10 minutos.
  - **Ya manejo un poco:** evita solo las avenidas grandes, con un tope de 1,6 veces más 5 minutos.
  - **Manejo con confianza:** solo agrega una alternativa sin avenidas grandes, con un tope de 1,3 veces más 3 minutos.
  - Los topes están en `config/tranquilidad.js`.
- **Iniciar viaje con voz:** sigue tu ubicación sobre la ruta, anuncia cada maniobra a unos 200 m y otra vez al llegar, y avisa 150 m antes de cada cruce o tramo crítico. Si te sales de la ruta, te pide estacionarte y ofrece "Recalcular desde aquí". Mantiene la pantalla encendida, porque con la pantalla apagada el navegador deja de dar la ubicación. Tu ubicación se queda en el celular, salvo cuando eliges recalcular. El modo viaje no usa datos de TomTom, porque su licencia gratuita excluye la guía en tiempo real.
- **Si se cae el soporte o hay que guardar el celular:** ningún navegador da la ubicación ni habla con la pantalla apagada. Por eso el modo viaje ofrece:
  - **Modo bolsillo:** deja la pantalla encendida pero negra y bloqueada al tacto (mantener presionado 2 s para salir), así la guía sigue por voz o por el auricular con el celular guardado. Si se apaga con el botón de encendido, la guía se detiene igual.
  - **Retomar:** al volver a encender la pantalla, la guía busca tu posición en todo lo que falta del recorrido y repite la próxima indicación ("Retomando la guía…"), en vez de decir que te saliste de la ruta.
  - **Seguir con Google Maps:** abre la navegación de Google Maps desde donde estés hasta el destino, con hasta 3 puntos de paso de lo que falta de la ruta tranquila. Google Maps sí guía con la pantalla apagada, pero entre esos puntos puede elegir otras calles.
- **Ensayar recorrido:** recorre la ruta sola, a unos 40 m por segundo, para escuchar la guía antes de salir.

### Instalarla en el celular (PWA) y usar la ubicación

El celular solo permite instalar la app y darle tu ubicación si la abres con **HTTPS**. La dirección `http://192.168.x.x` de tu Wi-Fi no sirve. Hay dos opciones:

1. **Publicarla en un servicio con HTTPS**, como Render o Railway (crea la cuenta tú).
   - Comando de inicio: `npm start`.
   - Variables: `ORS_API_KEY`, `TOMTOM_API_KEY` y `HOST=0.0.0.0`.
   - El servicio asigna `PORT` solo.
   - Cualquiera con el enlace podría gastar tu cuota.
2. **Probar con un túnel temporal**, por ejemplo `cloudflared tunnel --url http://localhost:3000`, que da una dirección `https://...trycloudflare.com`.

Luego, en Android abre la app en Chrome y elige "Instalar app". En iPhone, ábrela en Safari y usa Compartir → "Agregar a pantalla de inicio".

## Comprobar el puntaje

Ejecuta `npm run calibrar` para comparar 12 pares de rutas sintéticas sin consumir APIs. Los casos están en `data/calibracion-puntaje.json`: cada par declara una ruta preferida y una alternativa. El comando falla si el puntaje no respeta ese orden; las mismas comparaciones forman parte de `npm test`.

El bono de ciclovía completa la base del recorrido hasta 100 antes de restar cruces, tráfico y giros. Por ejemplo, una ciclovía sin cruces puede tener 100 y una idéntica con un cruce de avenida grande sin información de semáforo, 95. El desglose muestra solo el bono efectivamente aplicado.

Estos casos verifican coherencia del cálculo, no validan calles de Lima. Para calibrar con experiencia real hacen falta origen y destino (pueden ser lugares públicos), vehículo, nivel y las calles que se prefieren o se evitan. Se comparan las alternativas propuestas con esa expectativa antes de ajustar los pesos.

## Cómo funciona

### Rutas candidatas

OpenRouteService no tiene una opción para evitar avenidas en su API pública: el `custom_model`, que permitiría bajar la prioridad de un tipo de vía, responde "no disponible" para `driving-car`. Sí acepta zonas por las que la ruta no puede pasar (`avoid_polygons`). La app arma esas zonas en [`server/zonas.js`](server/zonas.js): cubre con un rectángulo la parte central de cada tramo largo de avenida y deja libres sus puntas (las intersecciones) y los puentes o túneles que la cruzan. Así la ruta puede cruzar una avenida, pero no recorrerla.

Por cada búsqueda se piden 4 rutas, todas con el perfil `driving-car`, que respeta los sentidos de circulación:

1. **La más rápida**, con sus alternativas.
2. **Sin recorrer avenidas grandes** (primarias, troncales y autopistas), con preferencia `fastest`.
3. **Sin recorrer avenidas grandes**, con preferencia `shortest`.
4. **Sin recorrer avenidas grandes ni medianas**, con preferencia `shortest`.

Luego se quitan las rutas casi iguales (comparten más del 90% del recorrido) y las que tardan demasiado. Por defecto se descartan las que superan 2,5 veces el tiempo de la más rápida más 10 minutos, porque las calles tranquilas de Lima son lentas. Se muestran la más tranquila, la más rápida y, si existe, una alternativa.

Con las zonas a evitar, cada búsqueda tarda unos 15 a 20 segundos.

#### Comparación con la ruta de ejemplo

Juan de Aliaga 455, Magdalena del Mar → Jr. Santorín 243, Santiago de Surco. El puntaje base es el que se calcula antes de restar cruces y tráfico.

| Estrategia | km | min (sin tráfico) | Puntaje base |
|---|---|---|---|
| `driving-car` más rápida | 10.7 | 18 | 8 |
| `driving-car` corta, con `avoid_features: highways` | 10.4 | 21 | 28 |
| `cycling-regular`, solo como referencia | 11.5–12.3 | 39–41 | puntaje final 2–29 |
| `cycling-regular` recalculada con `driving-car` | 13.5 | 27 | puntaje final 0 (usa la Vía Expresa) |
| Sin avenidas grandes, `shortest` | 11.0 | 27 | 56 |
| Sin avenidas grandes ni medianas, `shortest` | 16.1 | 46 | 82 |

El perfil `cycling-regular` no se usa para auto, porque al recalcular una ruta de bici como ruta de auto puede terminar en vías rápidas. Para bici o monopatín sí se usa directamente, junto con la clasificación local y el bono de ciclovías.

### Puntaje de tranquilidad (0 a 100)

Cada tramo de la ruta recibe un peso según el tipo de vía:

| Tipo de vía | Ejemplos | Peso |
|---|---|---|
| Residencial o de servicio | calles de barrio | 1.00 |
| Terciaria o menor | calles con algo más de movimiento | 0.75 |
| Secundaria (avenida mediana) | Av. Arequipa, Av. Sucre, Av. Juan de Aliaga | 0.35 |
| Primaria (avenida grande) | Av. Brasil, Av. Benavides, Av. La Marina | 0.10 |
| Troncal o autopista (vía rápida) | Vía Expresa, Panamericana Sur | 0.00 |

**Puntaje = 100 × promedio de pesos según los metros recorridos − penalización por cruces − penalización por tráfico**

Para **bici o monopatín**, las ciclovías además reciben un bono de seguridad de 1,5 puntos por cada 1% del recorrido que transcurre sobre ellas, hasta un máximo de 15 puntos. Así una ruta que aprovecha una red de ciclovías protegidas no queda por debajo de otra que solo evita avenidas usando calles de barrio.

- **Cruces a nivel:** −8 con una vía rápida, −5 con una avenida grande y −2 con una mediana. Se cuentan por cada 5 km de recorrido, porque un viaje largo por Lima cruza muchas avenidas por fuerza, y el máximo es −30. Los pasos a desnivel, como puentes y túneles, no restan.
- **Tráfico de TomTom:** −2, −4 u −8 por cada tramo con tráfico leve, moderado o fuerte, hasta un máximo de −20.
- **Etiquetas:** 80 o más es "Muy tranquila", 60 a 79 "Tranquila", 40 a 59 "Exigente" y menos de 40 "Difícil para principiantes".

Todos estos números están en [`config/tranquilidad.js`](config/tranquilidad.js). Puedes cambiarlos y reiniciar el servidor.

### Por qué hay un archivo de vías local

OpenRouteService informa el tipo de vía de cada tramo (`waytype`), pero junta las avenidas secundarias con las terciarias y no informa las avenidas que la ruta cruza. Por eso la app trae en `data/vias-principales-lima.json` las vías principales de Lima descargadas de OpenStreetMap, más los puentes y túneles de calles menores. Las compara con la geometría de cada ruta para:

- distinguir una avenida mediana de una calle menor;
- detectar los cruces con avenidas, contando como un solo cruce las dos calzadas y las vías auxiliares de una misma avenida;
- separar los tramos que recorren una avenida de los cruces;
- ignorar los cruces por puente o túnel.

Para actualizar el archivo:

```bash
npm run datos
```

### Hora punta

Si la salida cae de lunes a viernes entre las 7:00 y las 9:30 o entre las 17:00 y las 20:00 (hora de Lima), la app sugiere salir en otro momento. También avisa 45 minutos antes de que empiece la hora punta. Los horarios se configuran en `config/tranquilidad.js` y no tienen en cuenta los feriados.

## Privacidad

- El servidor no guarda ubicaciones ni direcciones: no tiene base de datos, y sus registros solo anotan el método, la ruta y el estado de cada pedido.
- Las direcciones y coordenadas viajan siempre en el cuerpo de un POST, nunca en la URL.
- Para buscar las direcciones y calcular la ruta, el servidor las envía a TomTom (si hay key) y a OpenRouteService.
- El mapa pide sus imágenes a OpenStreetMap.
- El botón "Ver tráfico en Google Maps" envía la ruta a Google solo si lo tocas.

## Límites conocidos

- **Tráfico:** el puntaje mide el tipo de vía, no el tráfico real. Una calle residencial puede estar llena de autos o combis.
- **Rutas:** la app elige entre las candidatas que devuelve OpenRouteService. Podría existir una ruta más tranquila que no aparezca.
- **Tiempo y giros:** la ruta más tranquila puede tardar el doble que la rápida y tener muchos más giros (47 instrucciones en la ruta de ejemplo, contra 13 de la rápida).
- **Cruces cercanos al destino:** en la ruta de ejemplo no se puede evitar el intercambio vial El Derby para llegar a Jr. Santorín, así que aparece como tramo crítico.
- **Datos de mapas:** la calidad depende de OpenStreetMap. Algunas avenidas están clasificadas de forma desigual según el tramo, por ejemplo la Av. Javier Prado Este.
- **Direcciones:** el buscador puede ubicar la calle y no el número exacto. En ese caso lo marca como aproximado y puedes arrastrar el marcador.
- **Ciclovías:** la ruta se calcula para vehículos, pero puede pasar junto a ciclovías. Las motos y scooters que superan la velocidad permitida en ellas no deben usarlas.
- **Google Maps:** el botón pasa como máximo 3 puntos de paso, así que Google puede cambiar parte del recorrido.
- **Datos de OpenStreetMap:** el uso de las imágenes del mapa de openstreetmap.org está pensado para pruebas y poco tráfico. Para publicar la app hay que usar otro proveedor de mapas.

## Publicar (Vercel)

Está publicada en Vercel (proyecto `ruta-tranquila`, equipo `jherryponces-projects`), conectada a este
repositorio de GitHub: cada `git push` a `main` se publica solo, desde cualquier máquina. Los pull requests
generan una vista previa. El workflow [.github/workflows/pruebas.yml](.github/workflows/pruebas.yml) corre
`npm test` en cada push.

Para conectarlo (una sola vez, con la cuenta dueña del proyecto): en Vercel, **ruta-tranquila → Settings → Git →
Connect Git Repository → GitHub → jherry-Ponce/ruta-tranquila**, o desde una máquina con esa cuenta en el CLI:
`npx vercel git connect https://github.com/jherry-Ponce/ruta-tranquila`.

Las keys de ORS y TomTom siguen en las variables de entorno del proyecto en Vercel; no van en el repositorio.

## Tests

```bash
npm test
```

Prueban el puntaje, la detección de cruces con vías reales de Lima, las zonas a evitar, el aviso de hora punta, las instrucciones y el armado de rutas con respuestas simuladas de OpenRouteService.

## Estructura

```text
ruta-tranquila/
├─ config/tranquilidad.js      pesos, penalizaciones, horas punta y límites de Lima
├─ data/vias-principales-lima.json   vías de OpenStreetMap (npm run datos)
├─ scripts/descargar-vias.js   descarga las vías con Overpass API
├─ server/
│  ├─ index.js        servidor HTTP: página y endpoints
│  ├─ ors.js          cliente de OpenRouteService (rutas y direcciones)
│  ├─ direcciones.js  búsqueda de direcciones: TomTom y, si falla, OpenRouteService
│  ├─ trafico.js      cliente de TomTom (tráfico)
│  ├─ zonas.js        zonas a evitar sobre los tramos de avenida
│  ├─ planificador.js rutas candidatas, selección y respuesta
│  ├─ analisis.js     tipo de vía por tramo, cruces y tramos críticos
│  ├─ puntaje.js      puntaje y explicación
│  ├─ horario.js      aviso de hora punta
│  ├─ pasos.js        instrucciones en español
│  ├─ vias.js, geo.js datos de vías y geometría
├─ public/            index.html, app.js, estilos.css (Leaflet + OpenStreetMap)
└─ test/
```

### Endpoints

Todos reciben y devuelven JSON.

| Endpoint | Recibe | Devuelve |
|---|---|---|
| `POST /api/geocodificar` | `{ texto }` | hasta 5 lugares en Lima y Callao |
| `POST /api/inverso` | `{ lat, lon }` | la dirección aproximada de un punto del mapa |
| `POST /api/rutas` | `{ origen: {lat, lon}, destino: {lat, lon}, salida? }` | rutas, aviso de horario y estado del tráfico |
| `GET /api/estado` | nada | si las keys están configuradas y la fecha de los datos de vías |

En `/api/rutas`, `salida` es opcional y usa el formato `"2026-11-03T18:30"` en hora de Lima. Si se envía `"depurar": true`, la respuesta también trae la comparación de todas las rutas candidatas.

## Créditos

- Datos de mapas © colaboradores de [OpenStreetMap](https://www.openstreetmap.org/copyright), licencia ODbL.
- Rutas y búsqueda de direcciones: [openrouteservice](https://openrouteservice.org) (HeiGIT).
- Tráfico: [TomTom](https://developer.tomtom.com).
- Mapa: [Leaflet](https://leafletjs.com).
