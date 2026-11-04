# Voy Tranqui · app Android

App Android hecha con [Capacitor](https://capacitorjs.com). **Carga la web publicada**
(https://ruta-tranquila.vercel.app), así que cada `git push` de la web se ve en la app sin reinstalar.
Lo único nativo es lo que una web no puede hacer:

- **GPS con la pantalla apagada:** `@capacitor-community/background-geolocation`. Mientras dura el
  modo viaje, Android muestra la notificación fija "Voy Tranqui · viaje en curso".
- **Voz del sistema:** `@capacitor-community/text-to-speech`. Suena con la pantalla apagada y por el auricular.

`public/viaje.js` detecta si corre dentro de la app (`window.Capacitor.isNativePlatform()`) y usa esos
plugins; en el navegador sigue con el GPS y la voz de la web (y el modo bolsillo).

Las dependencias de npm viven solo en esta carpeta: el servidor sigue sin dependencias.

## Cómo se arma el APK

No hace falta Android Studio. El workflow [`.github/workflows/apk.yml`](../.github/workflows/apk.yml)
compila en GitHub cada vez que cambia algo en `android-app/`:

- En `main` publica el APK firmado en **Releases** del repositorio (`voy-tranqui-1.0.N.apk`).
- Para instalarlo: abre la página de Releases desde el celular, descarga el APK y ábrelo. La primera
  vez Android pide permitir "instalar apps de origen desconocido". Las versiones siguientes se instalan
  encima, sin perder nada, porque se firman siempre con la misma llave.

## Llave de firma (una sola vez)

La llave no está en el repositorio. Va como secretos de GitHub en
**Settings → Secrets and variables → Actions → New repository secret**:

| Secreto | Valor |
|---|---|
| `ANDROID_KEYSTORE_BASE64` | el contenido de `ANDROID_KEYSTORE_BASE64.txt` |
| `ANDROID_KEYSTORE_PASSWORD` | el contenido de `ANDROID_KEYSTORE_PASSWORD.txt` |

Esos archivos y la llave (`voytranqui.jks`, alias `voytranqui`) están fuera del repositorio, en la
carpeta privada del dueño. **Si se pierde la llave, no se puede actualizar la app instalada ni publicarla
en Play Store con la misma identidad:** hay que tener una copia de respaldo.

## Cambiar la parte nativa

```sh
cd android-app
npm install
npx cap sync android
```

- Identificador: `pe.voytranqui.app` (no cambiarlo: es la identidad de la app en Play Store).
- Ícono: `android/app/src/main/res/drawable/ic_launcher_voytranqui.xml` (mismo dibujo que `public/icono.svg`).
- Notificación: textos en `public/viaje.js` (`addWatcher`) e ícono/color en `res/values/strings.xml`.
- Versiones fijadas: Capacitor 7.6.9, background-geolocation 1.2.26, text-to-speech 6.1.0.
