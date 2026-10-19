"""ETL de establecimientos de salud (SUSALUD, RENIPRESS) en datosabiertos.gob.pe.

Toma el CSV del dataset (se publica uno por mes: RENIPRESS_DD-MM-AAAA.csv), se queda con los establecimientos
ACTIVOS con coordenadas dentro del Perú y escribe:
  data/layers/salud.geojson   puntos (propiedades cortas, ver CAMPOS)
  data/layers/salud.meta.json

Uso:  python -m etl.salud.run --archivo ~/Downloads/RENIPRESS_30-09-2026.csv

IMPORTANTE: datosabiertos.gob.pe tiene un firewall que bloquea (HTTP 418) toda descarga que no venga de un
navegador. No se disfraza el script de navegador: el CSV se baja A MANO desde un navegador normal (ver
RUNBOOK.md › "Actualizar la capa de salud") y se le pasa al script con --archivo. Sin --archivo, el script
intenta la descarga directa por si el portal levanta el bloqueo.
"""
from __future__ import annotations

import argparse
import csv
import io
import re
import sys
from pathlib import Path
from datetime import datetime

from etl.common import (EtlError, LAYERS_DIR, RAW_DIR, http_get, require_fields, ubigeo6, write_json,
                        write_meta)

DATASET = ("https://www.datosabiertos.gob.pe/dataset/"
           "registro-nacional-de-entidades-prestadoras-de-servicios-de-salud-renipress")
COLUMNAS = ["COD_IPRESS", "NOMBRE", "CLASIFICACION", "INSTITUCION", "UBIGEO", "CATEGORIA", "ESTADO", "NORTE", "ESTE"]
MIN_ACTIVOS = 15_000
PERU = (-81.5, -18.5, -68.5, 0.1)

# Propiedades del GeoJSON (cortas para que pese menos en el celular):
#   n nombre · c categoría (I-1 … III-E) · t clasificación · i institución · u ubigeo · p público (1/0)
INSTITUCIONES_PUBLICAS = {"GOBIERNO REGIONAL", "MINSA", "ESSALUD", "MUNICIPALIDAD PROVINCIAL", "MUNICIPALIDAD DISTRITAL",
                          "SANIDAD DE LA POLICIA NACIONAL DEL PERU", "SANIDAD DEL EJERCITO DEL PERU",
                          "SANIDAD DE LA FUERZA AEREA DEL PERU", "SANIDAD DE LA MARINA DE GUERRA DEL PERU", "INPE"}


def _fecha_de(nombre: str) -> str:
    m = re.search(r"RENIPRESS_(\d{2})-(\d{2})-(\d{4})", nombre)
    if not m:
        raise EtlError(f"El archivo {nombre!r} no se llama RENIPRESS_DD-MM-AAAA.csv: no sé su fecha de corte.")
    d, mes, a = m.groups()
    return f"{a}-{mes}-{d}"


def ultimo_csv() -> tuple[str, str]:
    try:
        html = http_get(DATASET, tries=1).text
    except EtlError as e:
        raise EtlError(f"{e}\nEl portal bloquea descargas automáticas: bajar el CSV con un navegador y correr "
                       "python -m etl.salud.run --archivo RUTA (ver RUNBOOK.md).") from None
    enlaces = set(re.findall(r"https?://[^\"' ]+RENIPRESS_\d{2}-\d{2}-\d{4}\.csv", html))
    if not enlaces:
        raise EtlError(f"No encontré ningún RENIPRESS_DD-MM-AAAA.csv en {DATASET}. ¿Cambió la página?")
    def fecha(u: str) -> datetime:
        d, m, a = re.search(r"RENIPRESS_(\d{2})-(\d{2})-(\d{4})", u).groups()
        return datetime(int(a), int(m), int(d))
    url = max(enlaces, key=fecha)
    return url, fecha(url).strftime("%Y-%m-%d")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--archivo", type=Path, help="CSV de RENIPRESS bajado a mano desde datosabiertos.gob.pe")
    args = ap.parse_args()
    if args.archivo:
        contenido = args.archivo.expanduser().read_bytes()
        corte = _fecha_de(args.archivo.name)
        url = f"{DATASET} (archivo RENIPRESS_{corte[8:10]}-{corte[5:7]}-{corte[:4]}.csv)"
    else:
        url, corte = ultimo_csv()
        contenido = http_get(url, timeout=300).content
    (RAW_DIR / "salud").mkdir(parents=True, exist_ok=True)
    (RAW_DIR / "salud" / f"RENIPRESS_{corte}.csv").write_bytes(contenido)

    filas = list(csv.DictReader(io.StringIO(contenido.decode("utf-8-sig")), delimiter=";"))
    if not filas:
        raise EtlError(f"{url} vino vacío")
    require_fields(filas[0], COLUMNAS, "RENIPRESS")

    o, s, e, n = PERU
    feats = []
    for f in filas:
        if f["ESTADO"].strip().upper() != "ACTIVO":
            continue
        try:
            lat, lon = float(f["NORTE"]), float(f["ESTE"])
        except ValueError:
            continue
        if not (o <= lon <= e and s <= lat <= n):
            continue
        inst = f["INSTITUCION"].strip().upper()
        feats.append({
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [round(lon, 5), round(lat, 5)]},
            "properties": {
                "n": f["NOMBRE"].strip().title(),
                "c": f["CATEGORIA"].strip(),
                "t": f["CLASIFICACION"].strip().capitalize(),
                "i": inst.title(),
                "u": ubigeo6(f["UBIGEO"]),
                "p": 0 if inst == "PRIVADO" else 1,
            },
        })
    if len(feats) < MIN_ACTIVOS:
        raise EtlError(f"Solo {len(feats)} establecimientos activos con coordenadas (mínimo {MIN_ACTIVOS}).")
    feats.sort(key=lambda x: (x["properties"]["u"], x["properties"]["n"]))
    write_json(LAYERS_DIR / "salud.geojson", {"type": "FeatureCollection", "features": feats})
    publicos = sum(x["properties"]["p"] for x in feats)
    write_meta(
        "salud",
        fuente="SUSALUD – Registro Nacional de IPRESS (RENIPRESS), datosabiertos.gob.pe",
        url=url,
        fecha_corte=corte,
        visualizacion="puntos_agrupados",
        registros=len(feats),
        notas=f"Solo establecimientos ACTIVOS con coordenadas: {publicos} públicos y {len(feats) - publicos} privados. "
              "Propiedades: n nombre, c categoría, t clasificación, i institución, u ubigeo, p público.",
        estilo={"publico": "#be185d", "privado": "#9ca3af"},
    )
    print(f"OK: {len(feats)} establecimientos activos ({publicos} públicos), corte {corte}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
