"""ETL de centros poblados (INEI, Censo 2017) para el gazetteer.

Fuente: servicio ArcGIS de la ANA con los 94 922 centros poblados del censo 2017.
Salida: data/gazetteer/ccpp.json  (lista compacta, ordenada por ubigeo)
  [ubigeo, codigo_ccpp, nombre, lon, lat, poblacion, clase]

Uso:  python -m etl.ccpp.run
"""
from __future__ import annotations

import sys

from etl.common import ROOT, EtlError, arcgis_query_all, require_fields, ubigeo6, write_json

SERVICE = "https://geosnirh.ana.gob.pe/server/rest/services/ONRH/CCPP_2017/FeatureServer/17"
FIELDS = ["IDCCPP", "NOMBCCPP", "UBIGEO", "Pob", "Class_DS"]
MIN_CCPP = 90_000
PERU = (-81.5, -18.5, -68.5, 0.1)


def main() -> int:
    feats = arcgis_query_all(SERVICE, order_by="OBJECTID_1", out_fields=",".join(FIELDS), page_size=2000)
    if len(feats) < MIN_CCPP:
        raise EtlError(f"Llegaron solo {len(feats)} centros poblados (mínimo esperado {MIN_CCPP}).")
    require_fields(feats[0]["properties"], FIELDS, "Centros poblados INEI/ANA")

    o, s, e, n = PERU
    filas, descartados = [], 0
    for f in feats:
        p, g = f["properties"], f.get("geometry")
        nombre = (p.get("NOMBCCPP") or "").strip()
        if not g or not nombre:
            descartados += 1
            continue
        lon, lat = g["coordinates"][:2]
        if not (o <= lon <= e and s <= lat <= n):
            descartados += 1
            continue
        ub = ubigeo6(p["UBIGEO"])
        cod = str(int(p["IDCCPP"])).zfill(10) if p.get("IDCCPP") is not None else ub + "0000"
        filas.append([ub, cod, nombre, round(lon, 5), round(lat, 5), int(round(p.get("Pob") or 0)),
                      (p.get("Class_DS") or "").strip()])
    filas.sort(key=lambda r: (r[0], r[1]))
    write_json(ROOT / "data" / "gazetteer" / "ccpp.json", {
        "fuente": "INEI, Censo 2017 (servicio ANA ONRH/CCPP_2017)",
        "url": SERVICE,
        "columnas": ["ubigeo", "codigo", "nombre", "lon", "lat", "poblacion", "clase"],
        "filas": filas,
    })
    print(f"OK: {len(filas)} centros poblados ({descartados} descartados sin nombre/coordenadas)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
