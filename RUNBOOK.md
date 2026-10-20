# RUNBOOK — diagnóstico de problemas

Cada sección: síntoma → cómo confirmarlo → qué hacer. Los comandos asumen la raíz del repo y `gh`
autenticado (`gh auth status`).

## Cómo me entero de que algo falló
GitHub envía un correo cuando una tarea (workflow) falla. Si no llegan: en GitHub, foto de perfil ›
Settings › Notifications › **Actions** → marcar "Email" y "Only notify for failed workflows".
Ver las últimas ejecuciones: `gh run list --limit 20` · ver el error de una: `gh run view <id> --log-failed`.

## El sitio no carga
1. ¿Pasó la última publicación? `gh run list --workflow deploy.yml --limit 5`.
2. Si falló en `npm ci`/`npm run build`: leer el log (`gh run view <id> --log-failed`), reproducir local con
   `cd web && npm ci && npm run build`.
3. Si la publicación pasó pero la página está en blanco: abrir la consola del navegador. Si dice
   "Worker failed to load", revisar el bloque `setWorkerUrl` en `web/src/main.ts` (ver CLAUDE.md).
4. Si el mapa de fondo no aparece pero los distritos sí: OpenFreeMap caído. Comprobar
   `curl -I https://tiles.openfreemap.org/styles/positron`. Alternativa temporal: cambiar `ESTILO_BASE`
   en `web/src/main.ts` (ver DECISIONS.md › Mapa base).
5. GitHub Pages desactivado: `gh api repos/{owner}/{repo}/pages` debe responder con `"build_type": "workflow"`.

## El sitio muestra la versión anterior después de publicar
GitHub Pages deja la página en caché ~10 minutos. Esperar o abrir el enlace con `?v=2` al final. Los datos de
noticias se piden con revalidación (`cache: "no-cache"`), así que se actualizan solos.
Si el mapa está **instalado como app** (PWA): la página se pide primero a la red, así que basta cerrar la app y
volver a abrirla. Si aun así sigue vieja: en el navegador, Ajustes del sitio › Borrar datos (borra solo la caché
del mapa) y volver a entrar.

## El ETL de una fuente falló
1. Leer el mensaje: los ETL fallan a propósito con `EtlError` cuando la fuente cambió
   ("la estructura cambió, faltan columnas …", "Llegaron solo N distritos …").
2. Correr local: `.venv/bin/python -m etl.<fuente>.run`.
3. Si la fuente cambió de URL o de columnas: buscar la nueva en `SOURCES.md` › "cómo obtenerla a mano",
   ajustar el script y sus tests, y anotar el cambio en `SOURCES.md`.
4. Mientras tanto la web sigue mostrando la última versión buena (nunca se guardan datos a medias).

## Límites: falta un distrito o aparece uno nuevo
Los distritos vienen del servicio INEI/ANA (`etl/limites/run.py`). Si el INEI crea distritos nuevos, el
servicio los incorpora y basta con correr el ETL (`gh workflow run etl.yml -f fuente=limites`).
Si el servicio de la ANA desaparece: ver la alternativa IGN/HDX en `SOURCES.md`.

## Las tareas programadas dejaron de correr
GitHub apaga los `schedule` tras 60 días sin actividad en el repo. Mientras el robot de noticias guarde
datos no pasa, pero si ocurre: Actions › elegir la tarea › "Enable workflow", o
`gh workflow enable <archivo>.yml`.

## Se superó un límite gratuito
- GitHub Pages: sitio ≤ 1 GB, ~100 GB/mes de transferencia. Ver tamaño: `du -sh web/dist`.
  Si se acerca: reducir días de noticias publicados o mover PMTiles grandes (ver DECISIONS.md).
- Archivo > 100 MB: GitHub rechaza el `push`. Dividir el archivo o filtrarlo (p. ej. concesiones vigentes).

## No se actualizan las noticias
1. Mirar la tarea: `gh run list --workflow noticias.yml --limit 5`. Está programada **cada hora**, pero GitHub se
   salta ejecuciones programadas con frecuencia: huecos de 2–5 horas son normales. La web avisa ("⚠ Noticias sin
   actualizar") y el chequeo de salud falla recién después de 8 horas sin correr. Si no aparece nada en un día,
   puede estar apagada (ver "Las tareas programadas dejaron de correr").
2. Si falló: `gh run view <id> --log-failed`. Errores típicos:
   - `git push` rechazado ("fatal error in commit_refs" u otra tarea escribió al mismo tiempo): la tarea ya reintenta
     3 veces; si igual falla, se corrige sola en la siguiente ejecución (las noticias siguen en los RSS un tiempo).
   - Error de Python en `pipeline/ingest.py`: reproducir con `.venv/bin/python -m pipeline.ingest` y arreglar.
3. Si corre pero no entran noticias: revisar `data/status/estado.json` (`nuevas`, y `medios.*.error`).
4. Forzar una ejecución: `gh workflow run noticias.yml`.

## Un RSS dejó de funcionar
El chequeo de salud avisa cuando un medio lleva ≥ 12 ejecuciones (24 h) fallando. En `data/status/estado.json`
→ `medios.<id>.error` dice por qué (HTTP 403/404, sin respuesta, feed vacío, robots.txt).
1. Probarlo: `.venv/bin/python -m pipeline.ingest --solo <id>` y `curl -sI <url del feed>`.
2. Si cambió de URL: buscar la nueva (suele ser `/feed/`, `/rss`, `/arcio/rss/`), verificar que traiga ítems
   recientes y actualizar `config/sources.yaml`.
3. Si ya no tiene RSS: poner `activo: false` en `config/sources.yaml` y anotarlo en SOURCES.md.
   **No** hacer scraping de la página sin preguntar al dueño.

## El geoparsing ubica mal una noticia
1. Reproducir: `.venv/bin/python -c "from pipeline.geoparse import geoparse; print(geoparse('titular', 'resumen'))"`.
2. Arreglo preferido (sin código): `config/exclusiones.yaml` (frases que no son lugares, nombres que piden
   contexto, países) o `config/gazetteer_alias.yaml` (nombres de ciudades que no son distritos).
3. Medir antes y después: `.venv/bin/python -m pipeline.evaluar --detalle`. No bajar de 80 % a nivel distrito.
4. Las noticias ya guardadas no se recalculan solas: si hace falta, reprocesar es borrar `data/state/vistos.json`
   y los días afectados (pedir permiso al dueño antes de borrar).

## Probar que llega el correo de aviso
`gh workflow run salud.yml -f probar_aviso=true` → la tarea falla a propósito y GitHub manda el correo.

## Actualizar capas
- Automático: `etl.yml` corre los lunes (conflictos y concesiones). A mano: `gh workflow run etl.yml -f fuente=conflictos`
  (opciones: todas, limites, ccpp, pobreza, conflictos, concesiones).
- **Salud (RENIPRESS) es manual** porque datosabiertos.gob.pe bloquea descargas automáticas (HTTP 418):
  1. En un navegador abrir https://www.datosabiertos.gob.pe/dataset/registro-nacional-de-entidades-prestadoras-de-servicios-de-salud-renipress
  2. Bajar el CSV más reciente (`RENIPRESS_DD-MM-AAAA.csv`, sin cambiarle el nombre).
  3. `.venv/bin/python -m etl.salud.run --archivo ~/Downloads/RENIPRESS_DD-MM-AAAA.csv` → pruebas → commit y push.
  Cada 3–4 meses es suficiente (el chequeo de salud avisa a los 120 días).
- Límites y centros poblados vienen del servidor de la ANA, que **no responde a GitHub** (sí desde el Perú):
  correr en la Mac `.venv/bin/python -m etl.limites.run` / `etl.ccpp.run`, pruebas, commit y push. Casi nunca cambian.
- Pobreza (INEI 2018) no cambia hasta que el INEI publique un mapa nuevo: entonces actualizar `URL` en `etl/pobreza/run.py`.

## Falta la capa de concesiones
El sitio baja `concesiones.pmtiles` de la release `capas` al publicar. Revisar: `gh release view capas`.
Si no existe o está vacía: `gh workflow run etl.yml -f fuente=concesiones` (la crea y sube el archivo) y luego
`gh workflow run deploy.yml`. Si INGEMMET da error de certificado ("unable to get local issuer certificate"),
revisar que `etl/certs/sectigo-ov-r36.pem` siga siendo el intermedio que indica el certificado del servidor
(`openssl s_client -connect geocatmin.ingemmet.gob.pe:443` → "CA Issuers - URI"): bajarlo de esa URL oficial.

## La capa de conflictos ubica mal un caso
La ubicación se lee del texto del PDF con el geoparser. Revisar el caso en el PDF (código en la ficha) y, si el
nombre es ambiguo, agregar contexto en `config/exclusiones.yaml` o un alias. Los casos sin ubicar se cuentan en
`data/layers/conflictos.meta.json`. Si el formato del PDF cambia mucho, `etl/conflictos/run.py` falla (mínimo 40 casos).
