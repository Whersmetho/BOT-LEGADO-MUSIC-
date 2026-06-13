# Configuración de Lavalink con Spotify (LavaSrc)

## El problema
Lavalink en Render intenta reproducir desde YouTube, que bloquea las peticiones de servidores cloud.
La solución es usar el plugin **LavaSrc** que permite reproducir **directamente desde Spotify**.

## Paso 1: Actualizar tu Lavalink en Render

Necesitas que tu Lavalink use **LavaSrc plugin**. Hay dos opciones:

### Opción A: Usar una imagen Docker con LavaSrc ya incluido (recomendado)

En Render, cambia la imagen de tu servicio Lavalink a:
```
ghcr.io/lavalink-devs/lavalink:4
```

Luego sube el archivo `application.yml` a tu repositorio de Lavalink y configura las variables:

### Opción B: Lavalink con plugin manual
Si controlas el Dockerfile de Lavalink, agrega en `application.yml`:
```yaml
lavalink:
  plugins:
    - dependency: "com.github.topi314.lavasrc:lavasrc-plugin:4.2.0"
      repository: "https://maven.topi314.dev/releases"
```

---

## Paso 2: Configurar el application.yml de Lavalink

Edita el archivo `application.yml` (en tu repositorio de Lavalink) con tus credenciales:

```yaml
plugins:
  lavasrc:
    sources:
      spotify: true
    spotify:
      clientId: "TU_SPOTIFY_CLIENT_ID"       # de developer.spotify.com
      clientSecret: "TU_SPOTIFY_CLIENT_SECRET"
```

---

## Paso 3: Variables de entorno en Railway (bot)

En tu servicio de Railway, asegúrate de tener:

| Variable              | Valor                         |
|-----------------------|-------------------------------|
| `TOKEN`               | Token de tu bot Discord       |
| `LAVALINK_HOST`       | URL de tu Lavalink en Render  |
| `LAVALINK_PORT`       | 443 (si usa HTTPS/WSS)        |
| `LAVALINK_PASSWORD`   | Password de tu Lavalink       |
| `LAVALINK_SECURE`     | `true` (si usa HTTPS)         |
| `SPOTIFY_CLIENT_ID`   | De developer.spotify.com      |
| `SPOTIFY_CLIENT_SECRET` | De developer.spotify.com    |

---

## Paso 4: Cómo funciona ahora el bot

1. `l!play despacito` → busca en **Spotify** primero (`spsearch:`)
2. `l!play https://open.spotify.com/track/...` → carga la canción directo de Spotify
3. `l!play https://open.spotify.com/playlist/...` → carga toda la playlist de Spotify
4. Si Spotify no tiene resultados → fallback a YouTube (`ytsearch:`)

---

## Verificar que LavaSrc funciona

En los logs del bot deberías ver:
```
🟢 Nodo Lavalink listo: tu-lavalink.onrender.com:443
```

Y al reproducir una canción de Spotify:
```
🟢 Spotify search: 1 tracks
```

Si ves `🔴 YouTube fallback` significa que LavaSrc no está activo en Lavalink.

---

## Notas importantes

- Las credenciales de Spotify en `application.yml` (Lavalink) y `SPOTIFY_CLIENT_ID` env var (bot) 
  pueden ser las mismas — el bot las usa para obtener metadatos de playlists largas como fallback.
- El `application.yml` va en el **repositorio de Lavalink** (en Render), NO en el repositorio del bot.
