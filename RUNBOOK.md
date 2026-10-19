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
1. Mirar la tarea: `gh run list --workflow noticias.yml --limit 5`. Si no aparece nada reciente, puede estar
   apagada (ver "Las tareas programadas dejaron de correr") o GitHub la está retrasando (normal hasta ~30 min).
2. Si falló: `gh run view <id> --log-failed`. Errores típicos:
   - `git push` rechazado: otra tarea escribió al mismo tiempo. Se corrige sola en la siguiente ejecución.
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
