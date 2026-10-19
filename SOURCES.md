# Fuentes de datos

Verificadas el 2026-10-19. "Última carga" se actualiza cuando corre el ETL de cada fuente (el valor exacto
está en `data/layers/<capa>.meta.json`).

## Capas

| Capa | Fuente | URL | Formato | Licencia | Actualización | Estado |
|---|---|---|---|---|---|---|
| Límites distritales | INEI (servicio publicado por la ANA) | `https://geosnirh.ana.gob.pe/server/rest/services/ONRH/Limite_Distrital_Estandarizado_v2/FeatureServer/0` | ArcGIS REST → GeoJSON (paginado, 1 891 distritos) | Dato público del Estado peruano; citar INEI | Cuando el INEI crea distritos | ✅ cargada (`etl/limites`) |
| Centros poblados | INEI Censo 2017 (servicio ANA) | `https://geosnirh.ana.gob.pe/server/rest/services/ONRH/CCPP_2017/FeatureServer/17` | ArcGIS REST, 94 922 puntos, UBIGEO numérico | Dato público; citar INEI | Censal (2017) | ✅ cargada (`etl/ccpp`) |
| Pobreza monetaria distrital | INEI, Mapa de Pobreza Monetaria 2018 (feb-2020) | `https://www.inei.gob.pe/media/MenuRecursivo/publicaciones_digitales/Est/Lib1718/` | XLSX oficial «Anexo Estadístico» en gob.pe (Anexo 2: 1 874 distritos, IC 95 %) | Dato público; citar INEI | Edición más reciente disponible | ✅ cargada (`etl/pobreza`) |
| Conflictos sociales | Defensoría del Pueblo, reporte mensual | `https://www.defensoria.gob.pe/areas_tematicas/paz-social-y-prevencion-de-conflictos/` (PDF n.º 270, ago-2026: `/wp-content/uploads/2026/09/Reporte-de-conflictos-sociales-n-270.pdf`) | PDF ~117–136 págs. | Dato público; citar Defensoría | Mensual (~mitad de mes) | ✅ cargada (`etl/conflictos`, semanal) |
| Concesiones mineras | INGEMMET GEOCATMIN | `https://geocatmin.ingemmet.gob.pe/arcgis/rest/services/SERV_CATASTRO_MINERO_WGS84/MapServer/0` | ArcGIS REST, 67 202 polígonos, **sin paginación** (descargar por `DEPA`, máx. 2 000 por consulta) | Dato público; citar INGEMMET | Diaria | ✅ cargada (`etl/concesiones`, semanal; PMTiles en release `capas`) |
| Establecimientos de salud | SUSALUD RENIPRESS (datosabiertos.gob.pe) | `https://www.datosabiertos.gob.pe/dataset/registro-nacional-de-entidades-prestadoras-de-servicios-de-salud-renipress` (CSV `RENIPRESS_DD-MM-AAAA.csv`) | CSV `;` UTF-8 con BOM; columnas `NORTE`=lat, `ESTE`=lon | Datos abiertos; citar SUSALUD | Mensual (fin de mes) | ✅ cargada a mano (`etl/salud --archivo`): el portal bloquea descargas automáticas |
| Mapa base | OpenFreeMap (OpenStreetMap / OpenMapTiles) | `https://tiles.openfreemap.org/styles/positron` | Estilo MapLibre | ODbL; atribución automática | Continua | ✅ en uso |

### Cómo obtenerlas a mano si el script falla
- **Límites (alternativa)**: HDX "Peru – Subnational Administrative Boundaries" (IGN 2020, CC BY-IGO):
  `https://data.humdata.org/dataset/cod-ab-per` → `per_admin_boundaries.geojson.zip`, archivo
  `per_admin3.geojson`; el ubigeo es `adm3_pcode` sin el prefijo `PE`. Le faltan 19 distritos nuevos.
- **Centros poblados**: mismo servidor ANA; en el navegador abrir la URL de la capa + `/query?where=1=1&outFields=*&f=geojson&resultOffset=0&resultRecordCount=2000`.
- **Pobreza**: XLSX oficial `https://cdn.www.gob.pe/uploads/document/file/3340937/Anexo%20Estad%C3%ADstico.xlsx` (página: gob.pe › INEI › «Mapa de Pobreza Provincial y Distrital 2018»). Si no: en inei.gob.pe buscar "Mapa de Pobreza Monetaria Provincial y Distrital 2018"; referencia
  cruzada: paquete R `perupobreza2018` (calderonsamuel.r-universe.dev).
- **Defensoría**: la página de "Paz social y prevención de conflictos" lista los PDF de cada mes.
- **INGEMMET**: visor `https://geocatmin.ingemmet.gob.pe/geocatmin/` › Catastro minero › descargar.
- **RENIPRESS**: la página del dataset lista un CSV por mes; tomar el más reciente.

## Medios con RSS (verificados el 2026-10-19)
La lista vigente y editable está en `config/sources.yaml` (34 feeds de 33 medios). Su estado en cada ejecución queda en `data/status/estado.json`. Funcionando: RPP, El Comercio,
La República (sociedad y política), Correo, Gestión, Infobae Perú, Andina, Canal N, RCR, El Búho, El Pueblo,
Los Andes, Pachamama Radio, Onda Azul, Radio Uno, Prensa Regional, Sin Fronteras, Jornada, Diario Ahora
(Huánuco), El Tiempo, Cutivalú, Radio Marañón, Diario de Chimbote, Satélite, Pro & Contra, La Región,
Noticias SER, Inforegión, Actualidad Ambiental, Mongabay Latam, Rumbo Minero, CooperAcción, DAR.

Sin RSS utilizable hoy: Perú21 (403), Exitosa, Ojo Público, Servindi (congelado en 2018), Convoca (sin
novedades desde enero 2026), El Peruano, Primicia, La Industria, Diario del Cusco, Radio Universal, Voces.
Huecos regionales: Cusco, Junín, Ucayali, San Martín.

Observado el 2026-10-19: Inforegión responde HTTP 403 a los servidores de GitHub (desde una conexión doméstica funciona). Si el chequeo de salud lo marca 24 h seguidas, desactivarlo en `config/sources.yaml`.

## Descartadas
- **GDELT**: límite de uso inmediato en su API (ver DECISIONS.md).
- **ESCALE (MINEDU)**: descarga detrás de una aplicación dinámica; posible capa de una fase posterior.
