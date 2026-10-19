# Decisiones técnicas

Formato: fecha · decisión · motivo · alternativas descartadas.

## 2026-10-19 · Arquitectura estática (GitHub Actions + GitHub Pages)
Sin servidores ni base de datos: Actions genera archivos y Pages los publica; la web calcula en el navegador.
Motivo: costo cero y nada que mantener. Si algún día no alcanza, la opción sería Supabase (plan gratuito con
PostGIS), con pausas por inactividad.

## 2026-10-19 · Repositorio público + GitHub Pages
Pages gratuito exige repo público; Actions es ilimitado en repos públicos (2 000 min/mes en privados).
Todo el contenido es información pública; las zonas que consulta el usuario no se guardan (se calculan en el
celular). Alternativa si se quisiera privado: Cloudflare Pages (500 compilaciones/mes, 25 MiB por archivo).
Confirmado por el dueño.

## 2026-10-19 · Límites: INEI vía servicio ArcGIS de la ANA
1 891 distritos, incluye los creados después de 2020. La versión IGN en HDX (2020) tiene 1 873 y le faltan 19.
Simplificación con `shapely.coverage_simplify` (sin huecos ni solapes entre vecinos), tolerancia 0.003° (~330 m):
~4 MB / ~1 MB comprimido. Provincias y departamentos se obtienen uniendo distritos.

## 2026-10-19 · Mapa base OpenFreeMap (estilo positron)
Gratis, sin clave, sin límite de vistas; atribución a OpenStreetMap. Sin garantía de servicio. Etiquetas
forzadas a español (`name:es` → `name`). Alternativa si cae: Protomaps (requiere alojar un PMTiles del Perú).

## 2026-10-19 · Web: Vite + TypeScript sin framework
Menos dependencias que se rompan con el tiempo; la interfaz es un mapa con paneles. Versiones exactas en
`web/package.json`. MapLibre 6 es solo ESM y su worker se empaqueta a mano (`?worker&url` + `setWorkerUrl`).

## 2026-10-19 · Sin Dependabot por ahora
Abriría PRs que el dueño tendría que revisar. Las versiones están fijadas; se actualizan en sesiones de
mantenimiento eligiendo versiones con ≥ 2 semanas de publicadas.

## 2026-10-19 · GDELT fuera del MVP
Su API respondió con el aviso de límite de uso desde la primera consulta; desde IPs compartidas de GitHub sería
peor. Reevaluar después del MVP.

## 2026-10-19 · Capa 4 = establecimientos de salud (RENIPRESS)
CSV mensual limpio en datosabiertos.gob.pe; 97 % de los establecimientos públicos activos con coordenadas.
ESCALE (educación) se descarga desde una aplicación dinámica, más frágil. Confirmado por el dueño.

## 2026-10-19 · Botón "Revisar con IA": Modo B por defecto, sin Cloudflare
Claude Pro no incluye la API (artículo oficial de soporte de Anthropic). Modo B (copiar/pegar en Claude) es
gratis. Para guardar resultados o disparar el Modo A, la web usa un token personal de GitHub limitado a este
repo, guardado solo en el celular del dueño; la clave de Anthropic vivirá como secreto de GitHub. Así no hace
falta un Cloudflare Worker. Confirmado por el dueño.

## 2026-10-19 · Decisiones propuestas (vigentes salvo que el dueño diga otra cosa)
- Noticias cada 2 horas.
- Temas: conflicto_social, medio_ambiente, mineria, agua, seguridad, salud, educacion, infraestructura,
  transporte, desastres, politica_local, economia, otros.
- Tope mensual del Modo A cuando se active: US$ 2.
- Noticias en un archivo por día (no por mes): cada ejecución toca un solo archivo y la web carga solo los días
  del filtro.

## 2026-10-19 · Geoparsing Nivel 1 propio (reglas + gazetteer INEI), sin IA
Gazetteer: 1 891 distritos, 196 provincias, 25 departamentos (INEI/ANA) + centros poblados del Censo 2017
(≥ 50 hab.; los de < 1 000 hab. solo con palabra de contexto). Reglas generales (no ajustes por noticia):
mayúscula obligatoria, exclusiones configurables, nombres pegados a otra palabra con mayúscula = persona u
organización, pistas de contexto, titular pesa 3× el resumen, el lugar más específico coherente gana,
enumeraciones de ≥ 3 regiones = alcance nacional. Resultado en el set de prueba: 94 % distrito, 96 %
departamento, 5 % falsos positivos. **Ojo**: las reglas se afinaron mirando ese mismo set; para una medición
limpia conviene etiquetar un segundo set nuevo (otra semana) y medir sin tocar reglas.

## 2026-10-19 · Noticias en archivos diarios + pendientes aparte
Solo se publican las noticias ubicadas con confianza ≥ 0.35; las demás van a `data/pending/` (no se publican,
sirven para el botón IA de la Fase 5). Los días que salen de la ventana se mueven a `data/archive/` (nada se
borra). La deduplicación usa URL canónica + titular normalizado; títulos casi iguales en distintos medios
comparten `grupo`.

## 2026-10-19 · Web: pines solo para distrito/centro poblado
Una noticia "de Puno" (región) con pin en la capital confundiría la búsqueda por radio. Las de provincia o
región aparecen en la ficha de la zona, en una sección aparte. Los distritos con noticias se tiñen.

## 2026-10-19 · Chequeo de salud propio
`pipeline/salud.py` corre a diario y falla (→ correo de GitHub) si la tarea de noticias no corre hace 6 h, no
entran noticias hace 48 h, un medio falla 24 h seguidas o el sitio no responde. Tiene opción para fallar a
propósito y comprobar el correo.
