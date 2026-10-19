"""ETL de conflictos sociales (Defensoría del Pueblo, Reporte Mensual de Conflictos Sociales).

La Defensoría publica un PDF por mes. Este script:
  1. busca en su página el reporte de número más alto,
  2. extrae el texto (pypdf) y lo parte en casos usando "Código: NNNN-NNNN",
  3. ubica cada caso con el mismo geoparser de las noticias leyendo su "Ubicación: Distrito de X, provincia
     de Y, departamento de Z" (si no hay esa línea, usa el inicio del caso),
  4. escribe data/layers/conflictos.geojson (un punto por caso) y su .meta.json.

Limitaciones (también en la meta y en SOURCES.md): el formato del PDF varía entre meses y algunas tablas no
traen ubicación clara; los casos que no se pueden ubicar se cuentan en la meta. La fuente oficial es el PDF.

Uso:  python -m etl.conflictos.run            (último reporte)
      python -m etl.conflictos.run --pdf RUTA (un PDF ya descargado)
"""
from __future__ import annotations

import argparse
import io
import re
import sys
from pathlib import Path

from pypdf import PdfReader

from etl.common import EtlError, LAYERS_DIR, RAW_DIR, http_get, write_json, write_meta
from pipeline.geoparse import geoparse

PAGINA = "https://www.defensoria.gob.pe/areas_tematicas/paz-social-y-prevencion-de-conflictos/"
PATRON_PDF = re.compile(r"https://www\.defensoria\.gob\.pe/wp-content/uploads/\d{4}/\d{2}/[^\"']*?"
                        r"[Rr]eporte[^\"']*?n[-.º°]*-?(\d{3})[^\"']*?\.pdf")
MIN_CASOS = 40


def ultimo_reporte() -> tuple[str, int]:
    html = http_get(PAGINA).text
    hallados = {(m.group(0), int(m.group(1))) for m in PATRON_PDF.finditer(html)}
    if not hallados:
        raise EtlError(f"No encontré enlaces a reportes en {PAGINA}. ¿Cambió la página?")
    return max(hallados, key=lambda x: x[1])


def limpiar(texto: str) -> str:
    return re.sub(r"\s+", " ", texto).strip(" .;,")


def casos(texto: str) -> list[dict]:
    # Quitar encabezados de página repetidos.
    texto = re.sub(r"Reporte Mensual de Conflictos Sociales N\.?\s*°.*?\n", "\n", texto)
    texto = re.sub(r"ADJUNTÍA PARA LA PREVENCIÓN.*?DEFENSORÍA DEL PUEBLO\s*\d*", "\n", texto)
    salida, vistos = [], set()
    for bloque in re.split(r"\bC[oó]digo:\s*", texto)[1:]:
        m = re.match(r"\s*(\d{3,4}-\d{4})", bloque)
        if not m:
            continue
        codigo = m.group(1)
        cuerpo = bloque[:2500]
        tipo = re.search(r"Tipo(?: de conflicto)?:\s*(.+?)(?:\.|\n)", cuerpo)
        caso = re.search(r"Caso:\s*(.+?)(?:Ubicaci[oó]n|Actores|Tipo|$)", cuerpo, re.S)
        ubic = re.search(r"Ubicaci[oó]n:?\s*(.+?)(?:Actores|Hechos|HAY DI|NO HAY DI|\n\s*\n|$)", cuerpo, re.S)
        dialogo = "Hay diálogo" if "HAY DIÁLOGO" in cuerpo and "NO HAY DIÁLOGO" not in cuerpo else (
            "No hay diálogo" if "NO HAY DIÁLOGO" in cuerpo else None)
        texto_ubic = limpiar(ubic.group(1))[:400] if ubic else ""
        lugares = geoparse(texto_ubic, "") if texto_ubic else []
        if not lugares:  # sin línea de ubicación: el inicio del caso suele nombrar el distrito
            lugares = geoparse(limpiar(cuerpo[:900]), "")
        principal = next((x for x in lugares if x["principal"]), None)
        registro = {
            "codigo": codigo,
            "tipo": limpiar(tipo.group(1)).capitalize() if tipo else "",
            "caso": limpiar(caso.group(1))[:300] if caso else limpiar(cuerpo[:300]),
            "ubicacion": texto_ubic[:250],
            "dialogo": dialogo,
            "principal": principal,
            "distritos": sorted({x["ubigeo"] for x in lugares
                                 if x["precision"] in ("distrito", "centro_poblado") and x["confianza"] >= 0.35}),
        }
        # Un caso puede aparecer dos veces (resumen + detalle): quedarse con la versión mejor ubicada.
        previo = next((c for c in salida if c["codigo"] == codigo), None)
        if previo is None:
            salida.append(registro)
        elif not previo["principal"] and principal:
            salida[salida.index(previo)] = registro
        vistos.add(codigo)
    return salida


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--pdf", type=Path, help="PDF del reporte ya descargado")
    args = ap.parse_args()
    if args.pdf:
        contenido, url, numero = args.pdf.read_bytes(), str(args.pdf), None
    else:
        url, numero = ultimo_reporte()
        contenido = http_get(url, timeout=300).content
    (RAW_DIR / "conflictos").mkdir(parents=True, exist_ok=True)
    (RAW_DIR / "conflictos" / "reporte.pdf").write_bytes(contenido)

    paginas = PdfReader(io.BytesIO(contenido)).pages
    texto = "\n".join(p.extract_text() or "" for p in paginas)
    cab = re.search(r"Reporte Mensual de Conflictos Sociales N\.?\s*°\s*(\d+)\s*[–-]\s*([A-ZÁÉÍÓÚ]+\s+\d{4})", texto)
    periodo = cab.group(2).capitalize() if cab else "mes no identificado"
    numero = numero or (int(cab.group(1)) if cab else None)

    lista = casos(texto)
    if len(lista) < MIN_CASOS:
        raise EtlError(f"Solo encontré {len(lista)} casos en el reporte (mínimo {MIN_CASOS}): ¿cambió el formato?")
    feats = []
    for c in lista:
        p = c.pop("principal")
        if not p or p["confianza"] < 0.35:
            continue
        feats.append({
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [p["lon"], p["lat"]]},
            "properties": {**c, "lugar": p["nombre"], "precision": p["precision"], "ubigeo": p["ubigeo"],
                           "provincia": p["provincia"], "departamento": p["departamento"]},
        })
    write_json(LAYERS_DIR / "conflictos.geojson", {"type": "FeatureCollection", "features": feats})
    sin = len(lista) - len(feats)
    write_meta(
        "conflictos",
        fuente=f"Defensoría del Pueblo – Reporte Mensual de Conflictos Sociales N.° {numero} ({periodo})",
        url=url,
        fecha_corte=periodo,
        visualizacion="puntos",
        registros=len(feats),
        notas=(f"{len(lista)} casos con código en el reporte; {len(feats)} ubicados automáticamente y {sin} sin ubicar. "
               "La ubicación se extrae del texto del PDF: ante dudas, consultar el reporte oficial."),
        estilo={"color": "#c2410c"},
    )
    print(f"OK: reporte {numero} ({periodo}): {len(lista)} casos, {len(feats)} ubicados, {sin} sin ubicar")
    return 0


if __name__ == "__main__":
    sys.exit(main())
