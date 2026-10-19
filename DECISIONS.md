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
