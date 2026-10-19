"""ETL de límites administrativos (distritos, provincias, departamentos).

Fuente: límites distritales del INEI publicados por la ANA como servicio ArcGIS.
Si el servicio cae o cambia, ver SOURCES.md › Límites para la alternativa (IGN vía HDX).

Salidas:
  data/layers/distritos.geojson      polígonos simplificados (para el mapa)
  data/layers/provincias.geojson     disueltos a partir de los distritos
  data/layers/departamentos.geojson  ídem
  data/gazetteer/ubigeos.json        lista de ubigeos con nombres y un punto interior
  data/layers/distritos.meta.json    metadatos de la capa

Uso:  python -m etl.limites.run
"""
from __future__ import annotations

import sys
from collections import defaultdict

import shapely
from shapely.geometry import mapping, shape

from etl.common import (ROOT, EtlError, LAYERS_DIR, arcgis_query_all, require_fields, ubigeo6,
                        write_json, write_meta)

SERVICE = ("https://geosnirh.ana.gob.pe/server/rest/services/ONRH/"
           "Limite_Distrital_Estandarizado_v2/FeatureServer/0")
FIELDS = ["UBIGEO", "nombdep", "nombprov", "nombdist", "NOMBCAP", "FUENTE"]
MIN_DISTRITOS = 1880          # hoy son 1 891; si baja de esto, algo anda mal en la fuente
TOLERANCIA_GRADOS = 0.003      # ~330 m; ~1 MB comprimido, carga rápida en 4G
DECIMALES = 5                  # ~1 m de precisión en las coordenadas


def _round(geom):
    return shapely.set_precision(geom, 10 ** -DECIMALES)


def _feature(geom, props: dict) -> dict:
    return {"type": "Feature", "properties": props, "geometry": mapping(geom)}


def main() -> int:
    feats = arcgis_query_all(SERVICE, order_by="OBJECTID_12_13", out_fields=",".join(FIELDS))
    if len(feats) < MIN_DISTRITOS:
        raise EtlError(f"Llegaron solo {len(feats)} distritos (mínimo esperado {MIN_DISTRITOS}).")
    require_fields(feats[0]["properties"], FIELDS, "Límites INEI/ANA")

    rows = []
    vistos: set[str] = set()
    for f in feats:
        p = f["properties"]
        ub = ubigeo6(p["UBIGEO"])
        if ub in vistos:
            raise EtlError(f"Ubigeo duplicado en la fuente: {ub}")
        vistos.add(ub)
        geom = shapely.make_valid(shape(f["geometry"]))
        rows.append({
            "ubigeo": ub,
            "distrito": p["nombdist"].strip(),
            "provincia": p["nombprov"].strip(),
            "departamento": p["nombdep"].strip(),
            "capital": (p.get("NOMBCAP") or "").strip(),
            "geom": geom,
        })

    # Simplificación de cobertura: mantiene los bordes compartidos sin huecos ni solapes.
    simples = shapely.coverage_simplify([r["geom"] for r in rows], TOLERANCIA_GRADOS)
    for r, g in zip(rows, simples):
        r["simple"] = _round(shapely.make_valid(g))

    distritos = [_feature(r["simple"], {k: r[k] for k in ("ubigeo", "distrito", "provincia", "departamento")})
                 for r in rows]
    write_json(LAYERS_DIR / "distritos.geojson", {"type": "FeatureCollection", "features": distritos})

    # Provincias y departamentos: unión de los distritos (sin descargar otra fuente).
    for nivel, largo, nombre in (("provincias", 4, "provincia"), ("departamentos", 2, "departamento")):
        grupos: dict[str, list] = defaultdict(list)
        nombres: dict[str, dict] = {}
        for r in rows:
            cod = r["ubigeo"][:largo]
            grupos[cod].append(r["simple"])
            nombres[cod] = {"codigo": cod, "nombre": r[nombre], "departamento": r["departamento"]}
        out = [_feature(_round(shapely.coverage_union_all(gs)), nombres[c]) for c, gs in sorted(grupos.items())]
        write_json(LAYERS_DIR / f"{nivel}.geojson", {"type": "FeatureCollection", "features": out})

    # Lista de ubigeos para el gazetteer (Fase 2): punto interior del polígono original.
    ubigeos = []
    for r in rows:
        pt = r["geom"].representative_point()
        ubigeos.append({"ubigeo": r["ubigeo"], "distrito": r["distrito"], "provincia": r["provincia"],
                        "departamento": r["departamento"], "capital": r["capital"],
                        "lon": round(pt.x, 5), "lat": round(pt.y, 5)})
    ubigeos.sort(key=lambda x: x["ubigeo"])
    write_json(ROOT / "data" / "gazetteer" / "ubigeos.json", ubigeos, compact=False)

    write_meta(
        "distritos",
        fuente="INEI (límites censales), servicio publicado por la ANA",
        url=SERVICE,
        fecha_corte="Versión vigente del servicio al momento de la carga",
        visualizacion="poligonos",
        registros=len(distritos),
        notas=f"Simplificado con tolerancia {TOLERANCIA_GRADOS}° (~330 m). Provincias y departamentos "
              "se obtienen uniendo distritos.",
    )
    print(f"OK: {len(distritos)} distritos, "
          f"{len({r['ubigeo'][:4] for r in rows})} provincias, {len({r['ubigeo'][:2] for r in rows})} departamentos")
    return 0


if __name__ == "__main__":
    sys.exit(main())
