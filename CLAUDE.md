# Mapa territorial de noticias del Perú — guía para Claude Code

Lee esto primero. Luego `RUNBOOK.md` si vienes a arreglar algo, `DECISIONS.md` si vas a cambiar
la arquitectura y `SOURCES.md` si tocas una fuente de datos.

## Qué es
Web estática (pensada para celular) con un mapa del Perú: noticias geolocalizadas de medios con RSS +
capas de datos públicos (INEI, Defensoría, INGEMMET, SUSALUD). **Sin servidor**: GitHub Actions genera
archivos de datos y GitHub Pages publica la web, que hace todos los cálculos en el navegador.

**El dueño no programa.** Habla con él en español claro, sin jerga, y pídele permiso antes de:
cualquier costo, borrar datos, cambiar la arquitectura o hacer scraping de un sitio sin RSS/API.

## Enlaces
- Sitio: https://renew1396.github.io/mapa-noticias-peru/
- Repositorio (público): https://github.com/renew1396/mapa-noticias-peru · cuenta GitHub del dueño: `renew1396`
- `gh` está instalado en `~/.local/bin/gh` (no hay Homebrew en esta Mac).

## Estado por fases
- [x] Fase 0: verificación de fuentes y plan (ver SOURCES.md)
- [x] Fase 1: base — límites distritales, mapa con distritos tocables, workflows, docs (publicada 2026-10-19)
  - Pendiente para Fase 4: la primera carga tarda ~6–8 s (JS de MapLibre ~290 KB + distritos ~1 MB comprimidos).
- [ ] Fase 2: noticias (RSS → geoparsing Nivel 1 → mapa, radio, filtros, evaluación, chequeo de salud)
- [ ] Fase 3: capas (pobreza 2018, conflictos Defensoría, concesiones INGEMMET, salud RENIPRESS) y ficha de zona
- [ ] Fase 4: pulido, PWA, página de fuentes
- [ ] Fase 5: botón "Revisar con IA" (Modo B gratis por defecto; Modo A con API apagado)

## Dónde está cada cosa
| Ruta | Qué hay |
|---|---|
| `etl/common.py` | utilidades de ETL: descargas con reintentos, ArcGIS paginado, `ubigeo6`, `require_fields`, `write_meta` |
| `etl/<fuente>/run.py` | un ETL por fuente, idempotente. Se corre con `python -m etl.<fuente>.run` |
| `data/layers/` | capas publicadas (GeoJSON / PMTiles) + `<capa>.meta.json` (fuente, fecha de corte, fecha de carga) |
| `data/gazetteer/` | nombres de lugares para el geoparsing (`ubigeos.json`: 1 891 distritos con punto interior) |
| `data/news/` | (Fase 2) un JSON por día con las noticias ubicadas |
| `data/raw/` | descargas crudas; **ignorado por git** (se re-descarga, ver SOURCES.md) |
| `config/` | todo lo editable sin tocar código: medios RSS, temas, exclusiones, alias, interruptor IA |
| `web/` | Vite + TypeScript **sin framework** + MapLibre. `web/src/main.ts` es la entrada |
| `tests/` | pytest (lógica y validación de los datos generados) |
| `.github/workflows/` | `ci.yml` (pruebas), `deploy.yml` (publicar), `etl.yml` (capas, mensual) |

## Cómo correr todo (desde la raíz del repo)
```bash
uv venv --python 3.12 .venv && uv pip install --python .venv/bin/python -r requirements.txt   # una vez
.venv/bin/python -m pytest                      # pruebas Python
.venv/bin/python -m etl.limites.run             # regenerar límites (~10 s)
cd web && npm ci && npm run dev                 # web local en http://localhost:5173
cd web && npm run build                         # compila a web/dist (copia data/layers, news, status)
```
En la Mac del dueño la vista previa se lanza con la configuración `mapa-noticias-peru` de
`~/Documents/Claude/Web/.claude/launch.json` (puerto 5178).

## Convenciones (obligatorias)
- **Ubigeo = texto de 6 dígitos** siempre. Normalizar con `etl.common.ubigeo6` (los servicios ArcGIS lo
  devuelven como número y pierden el cero inicial).
- Coordenadas WGS84 (lon, lat), 5 decimales.
- Fechas guardadas en **UTC** (ISO 8601 con `Z`); se muestran en `America/Lima`.
- Si una fuente cambia de estructura: lanzar `EtlError` con mensaje claro. Nunca guardar datos a medias
  (`write_json` escribe de forma atómica).
- Toda capa nueva lleva `<capa>.meta.json` vía `write_meta` y su fila en `SOURCES.md`.
- Noticias: guardar solo titular, resumen ≤ 300 caracteres, medio, fecha y enlace. Nunca el artículo.
- Datos sociales (SISFOH, etc.): **solo agregados por distrito**. Nada de personas u hogares (Ley 29733).
- Versiones fijadas: `requirements.txt` (exactas) y `web/package.json` (exactas, sin `^`). Al subir una
  versión, elegir una publicada hace ≥ 2 semanas.
- Mensajes de commit en español, claros ("Noticias: …", "Datos: …", "Web: …", "Docs: …").
- MapLibre 6 es solo ESM y su worker se importa explícitamente en `main.ts` (`?worker&url` + `setWorkerUrl`).
  No quitar eso: sin él el mapa queda en blanco.

## Lo que NO se debe tocar
- No agregar servidores, bases de datos ni servicios de pago sin aprobación explícita del dueño.
- No poner claves en el repo (es **público**). Los secretos van en *Settings › Secrets* de GitHub.
- No cambiar el formato de `data/layers/*.geojson` ni de `data/news/` sin actualizar la web y los tests.
- No hacer scraping de sitios sin RSS/API sin preguntar.

## Al terminar una sesión de trabajo
Actualizar este archivo (estado por fases) y `RUNBOOK.md` si cambió algo operativo; registrar decisiones
nuevas en `DECISIONS.md`.
