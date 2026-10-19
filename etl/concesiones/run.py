"""ETL de concesiones mineras vigentes (INGEMMET, Catastro Minero – GEOCATMIN).

"Vigentes" = estado TITULADO o EN TRÁMITE (se excluyen extinguidas, bloqueadas y otros).

Salidas:
  data/layers/concesiones.pmtiles          polígonos en teselas (PMTiles) para el mapa. NO va a git: es grande;
                                           se publica como archivo de la release "capas" de GitHub (ver deploy.yml)
  data/layers/concesiones_centros.json     [[lon, lat, hectáreas], …] para contar concesiones dentro de una zona
  data/layers/concesiones_distritos.json   {ubigeo: [n_concesiones, %_del_distrito_con_concesión]}
  data/layers/concesiones.meta.json

Requiere `tippecanoe` instalado (en GitHub Actions: apt install tippecanoe).
Uso:  python -m etl.concesiones.run
"""
from __future__ import annotations

import json
import re
import shutil
import subprocess
import sys
from datetime import datetime, timezone

import shapely
from shapely.geometry import shape

from etl.common import EtlError, LAYERS_DIR, RAW_DIR, http_get, require_fields, write_json, write_meta

CAPA = "https://geocatmin.ingemmet.gob.pe/arcgis/rest/services/SERV_CATASTRO_MINERO_WGS84/MapServer/0"
VISOR = "https://geocatmin.ingemmet.gob.pe/geocatmin/"
DONDE = "LEYENDA IN ('TITULADO','TRAMITE')"
CAMPOS = ["OBJECTID", "CODIGOU", "CONCESION", "TIT_CONCES", "HECTAGIS", "LEYENDA", "SUSTANCIA", "FEC_DENU",
          "FECHA_ACTUALIZACION"]
POR_CONSULTA = 300
MIN_CONCESIONES = 50_000

# El titular se muestra solo si es una empresa; si parece una persona natural se reemplaza (protección de datos).
EMPRESA = re.compile(r"\b(S\.?\s?A\.?C?\.?|S\.?R\.?L\.?|E\.?I\.?R\.?L\.?|S\.?A\.?A\.?|SOCIEDAD|MINERA|MINERO|COMPA[ÑN]IA|"
                     r"CORPORACI[OÓ]N|EMPRESA|COOPERATIVA|ASOCIACI[OÓ]N|CONSORCIO|INVERSIONES|GRUPO|LIMITED|LTD|"
                     r"INC|CORP|MINING|RESOURCES|HOLDING|COMUNIDAD|MUNICIPALIDAD|GOBIERNO|INGEMMET|ACTIVOS MINEROS)\b",
                     re.I)


def titular_publico(t: str | None) -> str:
    t = (t or "").strip()
    if not t:
        return ""
    return t.title() if EMPRESA.search(t) else "Persona natural"


def descargar() -> list[dict]:
    ids = http_get(f"{CAPA}/query", params={"where": DONDE, "returnIdsOnly": "true", "f": "json"}, timeout=300).json()
    if "objectIds" not in ids:
        raise EtlError(f"INGEMMET no devolvió la lista de ids: {str(ids)[:300]}")
    ids = sorted(ids["objectIds"])
    if len(ids) < MIN_CONCESIONES:
        raise EtlError(f"Solo {len(ids)} concesiones vigentes (mínimo esperado {MIN_CONCESIONES}).")
    feats = []
    for i in range(0, len(ids), POR_CONSULTA):
        lote = ids[i:i + POR_CONSULTA]
        d = http_get(f"{CAPA}/query", params={
            "objectIds": ",".join(map(str, lote)), "outFields": ",".join(CAMPOS), "outSR": 4326,
            "geometryPrecision": 5, "maxAllowableOffset": 0.0002, "f": "geojson"}, timeout=300).json()
        if "features" not in d:
            raise EtlError(f"Respuesta inesperada de INGEMMET en el lote {i}: {str(d)[:300]}")
        feats.extend(d["features"])
        if i == 0 and feats:
            require_fields(feats[0]["properties"], CAMPOS, "Catastro minero INGEMMET")
        if i % 6000 == 0:
            print(f"  … {len(feats)}/{len(ids)}", flush=True)
    return feats


def main() -> int:
    if not shutil.which("tippecanoe"):
        raise EtlError("Falta el programa tippecanoe (en Ubuntu: sudo apt install tippecanoe).")
    feats = descargar()
    crudo = RAW_DIR / "concesiones" / "concesiones.geojsonl"
    crudo.parent.mkdir(parents=True, exist_ok=True)

    centros, geoms, actualizacion = [], [], 0
    with crudo.open("w", encoding="utf-8") as f:
        for ft in feats:
            p, g = ft["properties"], ft.get("geometry")
            if not g:
                continue
            actualizacion = max(actualizacion, p.get("FECHA_ACTUALIZACION") or 0)
            fecha = p.get("FEC_DENU")
            props = {
                "codigo": p["CODIGOU"], "nombre": (p["CONCESION"] or "").strip(), "estado":
                "Titulada" if p["LEYENDA"] == "TITULADO" else "En trámite",
                "sustancia": {"M": "Metálica", "N": "No metálica"}.get((p["SUSTANCIA"] or "").strip(), ""),
                "ha": round(p["HECTAGIS"] or 0), "titular": titular_publico(p["TIT_CONCES"]),
                "anio": datetime.fromtimestamp(fecha / 1000, tz=timezone.utc).year if fecha else None,
            }
            f.write(json.dumps({"type": "Feature", "properties": props, "geometry": g}, ensure_ascii=False) + "\n")
            geom = shapely.make_valid(shape(g))
            geoms.append(geom)
            c = geom.representative_point()
            centros.append([round(c.x, 4), round(c.y, 4), props["ha"]])

    salida = LAYERS_DIR / "concesiones.pmtiles"
    subprocess.run(["tippecanoe", "-o", str(salida), "--force", "-l", "concesiones", "-Z4", "-z12",
                    "--drop-densest-as-needed", "--extend-zooms-if-still-dropping", "--simplification=4",
                    "--maximum-tile-bytes=800000",
                    "-P", str(crudo)], check=True)

    # Cuántas concesiones tocan cada distrito y qué porcentaje de su superficie cubren.
    distritos = json.loads((LAYERS_DIR / "distritos.geojson").read_text(encoding="utf-8"))["features"]
    arbol = shapely.STRtree(geoms)
    union_cache: dict[str, list] = {}
    for d in distritos:
        dg = shapely.make_valid(shape(d["geometry"]))
        idx = arbol.query(dg, predicate="intersects")
        if len(idx):
            cubierto = shapely.union_all([geoms[i] for i in idx]).intersection(dg).area
            union_cache[d["properties"]["ubigeo"]] = [int(len(idx)), round(100 * cubierto / dg.area, 1)]
    write_json(LAYERS_DIR / "concesiones_distritos.json", dict(sorted(union_cache.items())))
    write_json(LAYERS_DIR / "concesiones_centros.json", centros)

    corte = (datetime.fromtimestamp(actualizacion / 1000, tz=timezone.utc).strftime("%Y-%m-%d")
             if actualizacion else datetime.now(timezone.utc).strftime("%Y-%m-%d"))
    tam = salida.stat().st_size / 1e6
    write_meta(
        "concesiones",
        fuente="INGEMMET – Catastro Minero (GEOCATMIN)",
        url=VISOR,
        fecha_corte=corte,
        visualizacion="poligonos",
        registros=len(geoms),
        notas=(f"Concesiones vigentes (tituladas y en trámite). PMTiles de {tam:.1f} MB publicado aparte (release "
               "'capas'). Los titulares que parecen personas naturales se muestran como 'Persona natural'. "
               "Conteo por zona: por punto interior de cada concesión."),
        estilo={"Titulada": "#7c3aed", "En trámite": "#c4b5fd"},
    )
    print(f"OK: {len(geoms)} concesiones vigentes, PMTiles {tam:.1f} MB, {len(union_cache)} distritos con concesiones")
    return 0


if __name__ == "__main__":
    sys.exit(main())
