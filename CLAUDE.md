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
- [x] Fase 2: noticias (34 RSS cada 2 h → geoparsing Nivel 1 → mapa con pines, radio 1–50 km, filtros 7/30/90 días,
      tema y medio; evaluación 94 % a nivel distrito; chequeo de salud diario con aviso por correo) — 2026-10-19
- [ ] Fase 3: capas (pobreza 2018, conflictos Defensoría, concesiones INGEMMET, salud RENIPRESS), dibujo de
      polígono y ficha de zona completa con indicadores
- [ ] Fase 4: pulido, PWA, página de fuentes
- [ ] Fase 5: botón "Revisar con IA" (Modo B gratis por defecto; Modo A con API apagado)

## Dónde está cada cosa
| Ruta | Qué hay |
|---|---|
| `etl/common.py` | utilidades de ETL: descargas con reintentos, ArcGIS paginado, `ubigeo6`, `require_fields`, `write_meta` |
| `etl/<fuente>/run.py` | un ETL por fuente, idempotente. Se corre con `python -m etl.<fuente>.run` |
| `data/layers/` | capas publicadas (GeoJSON / PMTiles) + `<capa>.meta.json` (fuente, fecha de corte, fecha de carga) |
| `data/gazetteer/` | `ubigeos.json` (1 891 distritos) y `ccpp.json` (94 922 centros poblados, Censo 2017) |
| `pipeline/` | noticias: `ingest.py` (RSS→archivos), `geoparse.py` (dónde ocurre), `gazetteer.py`, `temas.py`, `evaluar.py`, `salud.py` |
| `data/news/` | `AAAA-MM-DD.json` (noticias **ubicadas** de ese día, hora de Lima) + `index.json`. Las publica la web |
| `data/pending/` | noticias sin lugar o con confianza < 0.35 (no se publican; materia prima del botón IA, Fase 5) |
| `data/archive/` | días que salieron de la ventana (90 días noticias, 30 pendientes). No se borra nada |
| `data/state/vistos.json` | URLs/titulares ya procesados (10 días) para no repetir |
| `data/status/` | `estado.json` (última ejecución, estado de cada medio) y `temas.json` (colores para la web) |
| `data/eval/set.jsonl` | set de prueba: 129 noticias reales del 2026-10-19 etiquetadas a mano (lugar esperado) |
| `data/raw/` | descargas crudas; **ignorado por git** (se re-descarga, ver SOURCES.md) |
| `config/` | todo lo editable sin tocar código: medios RSS, temas, exclusiones, alias, interruptor IA |
| `web/` | Vite + TypeScript **sin framework** + MapLibre. `web/src/main.ts` es la entrada |
| `tests/` | pytest (lógica y validación de los datos generados) |
| `.github/workflows/` | `noticias.yml` (cada 2 h), `salud.yml` (diario), `evaluar.yml` (a mano), `ci.yml` (pruebas), `deploy.yml` (publicar), `etl.yml` (capas, mensual) |

## Cómo correr todo (desde la raíz del repo)
```bash
uv venv --python 3.12 .venv && uv pip install --python .venv/bin/python -r requirements.txt   # una vez
.venv/bin/python -m pytest                      # pruebas Python
.venv/bin/python -m etl.limites.run             # regenerar límites (~10 s)
.venv/bin/python -m etl.ccpp.run                # regenerar centros poblados (~25 s)
.venv/bin/python -m pipeline.ingest             # leer RSS y actualizar data/news (~1,5 min)
.venv/bin/python -m pipeline.ingest --solo rpp  # probar un solo medio
.venv/bin/python -m pipeline.evaluar --detalle  # medir el geoparsing contra data/eval/set.jsonl
.venv/bin/python -m pipeline.salud              # chequeo de salud (falla si algo anda mal)
cd web && npm ci && npm run dev                 # web local en http://localhost:5173
cd web && npm test                              # pruebas de la web (vitest)
cd web && npm run build                         # compila a web/dist (copia data/layers, news, status)
```
En la Mac del dueño la vista previa se lanza con `mapa-noticias-peru` (dev, puerto 5178) o
`mapa-noticias-peru-compilado` (versión compilada como en Pages, puerto 5179) de
`~/Documents/Claude/Web/.claude/launch.json`. Ojo: en el navegador interno de la app, recargar la misma
pestaña a veces deja el mapa en "Cargando…" ~30 s; abrir una pestaña nueva lo evita (no pasa en celulares).

## Formato de una noticia (`data/news/AAAA-MM-DD.json` → `noticias[]`)
`id` (hash de la URL), `titulo`, `resumen` (≤ 300 car.), `medio`, `medio_id`, `url`, `fecha` (UTC),
`temas` (1–2 claves de `config/temas.yaml`, el primero es el principal), `lugares[]` (`nombre`, `ubigeo`,
`ccpp?`, `precision` = departamento|provincia|distrito|centro_poblado, `provincia`, `departamento`, `lon`,
`lat`, `confianza` 0–1, `principal`), `grupo?` (misma noticia en otro medio), `revisar?` (confianza < 0.6).
La web pone pin solo a precisión distrito/centro poblado; provincia/región van a la lista de la zona.

## Cómo funciona el geoparsing (resumen; detalle en `pipeline/geoparse.py`)
Busca nombres del gazetteer (el más largo gana), exige mayúscula, descarta frases de `config/exclusiones.yaml`
(clubes, personas, países, calles) y nombres pegados a otra palabra con mayúscula ("Tomás Gálvez").
Desempata con palabras de contexto ("distrito de", "región", "en", "comisaría de"), otros lugares mencionados,
la región del medio y la población. Elige el lugar más específico coherente. **Antes de cambiar reglas,
correr `pipeline.evaluar --detalle` y después de cambiarlas otra vez**: `tests/test_geoparse.py` exige ≥ 80 %
a nivel distrito. Preferir arreglos en `config/` (alias, exclusiones) antes que en el código.

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
