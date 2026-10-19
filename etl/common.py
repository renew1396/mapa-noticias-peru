"""Utilidades compartidas por todos los ETL.

Reglas del proyecto (ver CLAUDE.md):
- El ubigeo SIEMPRE es texto de 6 dígitos (normalizar con `ubigeo6`).
- Si una fuente cambia de estructura, fallar con `EtlError` y un mensaje claro;
  nunca escribir datos a medias.
- Cada capa publicada lleva un `<capa>.meta.json` (ver `write_meta`).
"""
from __future__ import annotations

import json
import time
from datetime import datetime, timezone
from pathlib import Path

import certifi
import requests

ROOT = Path(__file__).resolve().parent.parent
LAYERS_DIR = ROOT / "data" / "layers"
RAW_DIR = ROOT / "data" / "raw"

USER_AGENT = "mapa-noticias-peru/1.0 (+https://github.com/; datos publicos, uso no comercial)"


# Algunos servidores del Estado (p. ej. INGEMMET) a veces no envían el certificado intermedio. Se sigue
# verificando HTTPS, pero con los certificados de certifi + los intermedios oficiales guardados en etl/certs/.
_CERTS_EXTRA = sorted((Path(__file__).resolve().parent / "certs").glob("*.pem"))
_BUNDLE: str | None = None


def certificados() -> str:
    global _BUNDLE
    if _BUNDLE is None:
        import tempfile
        f = tempfile.NamedTemporaryFile("w", suffix=".pem", delete=False)
        f.write(Path(certifi.where()).read_text())
        for c in _CERTS_EXTRA:
            f.write("\n" + c.read_text())
        f.close()
        _BUNDLE = f.name
    return _BUNDLE


class EtlError(RuntimeError):
    """Error de ETL con mensaje pensado para leerse en el log de GitHub Actions."""


def http_get(url: str, *, params: dict | None = None, timeout: int = 120, tries: int = 4) -> requests.Response:
    """GET con reintentos (los servidores del Estado fallan a ratos)."""
    last: Exception | None = None
    for i in range(tries):
        try:
            r = requests.get(url, params=params, timeout=timeout, headers={"User-Agent": USER_AGENT},
                             verify=certificados())
            r.raise_for_status()
            return r
        except requests.RequestException as e:  # red, timeout, 5xx
            last = e
            time.sleep(5 * (i + 1))
    raise EtlError(f"No se pudo descargar {url} tras {tries} intentos: {last}")


def arcgis_query_all(layer_url: str, *, order_by: str, where: str = "1=1", out_fields: str = "*",
                     page_size: int = 1000, out_sr: int = 4326) -> list[dict]:
    """Descarga todas las entidades de una capa ArcGIS REST como features GeoJSON.

    Usa paginación (`resultOffset`) ordenando por `order_by` (el campo id de la capa,
    para que las páginas no se solapen). Para capas sin paginación usar filtros `where`.
    """
    count = http_get(f"{layer_url}/query", params={"where": where, "returnCountOnly": "true", "f": "json"}).json()
    if "count" not in count:
        raise EtlError(f"Respuesta inesperada al contar {layer_url}: {str(count)[:300]}")
    total = count["count"]
    feats: list[dict] = []
    offset = 0
    while offset < total:
        data = http_get(f"{layer_url}/query", params={
            "where": where, "outFields": out_fields, "outSR": out_sr, "f": "geojson",
            "resultOffset": offset, "resultRecordCount": page_size, "orderByFields": f"{order_by} ASC",
        }).json()
        if "features" not in data:
            raise EtlError(f"Respuesta inesperada en {layer_url} (offset {offset}): {str(data)[:300]}")
        if not data["features"]:
            break
        feats.extend(data["features"])
        offset += len(data["features"])
    if len(feats) != total:
        raise EtlError(f"{layer_url}: se esperaban {total} entidades y llegaron {len(feats)}")
    return feats


def ubigeo6(value) -> str:
    """Normaliza un ubigeo a texto de 6 dígitos ('10101' -> '010101'). Falla si no es válido."""
    if value is None:
        raise EtlError("Ubigeo vacío")
    s = str(value).strip()
    if s.endswith(".0"):
        s = s[:-2]
    if not s.isdigit() or not 5 <= len(s) <= 6:
        raise EtlError(f"Ubigeo inválido: {value!r}")
    return s.zfill(6)


def require_fields(props: dict, fields: list[str], fuente: str) -> None:
    """Corta el ETL si la fuente dejó de traer columnas que necesitamos."""
    missing = [f for f in fields if f not in props]
    if missing:
        raise EtlError(f"{fuente}: la estructura cambió, faltan columnas {missing}. "
                       f"Columnas recibidas: {sorted(props)}. Ver RUNBOOK.md › 'El ETL de una fuente falló'.")


def write_json(path: Path, obj, *, compact: bool = True) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    with tmp.open("w", encoding="utf-8") as f:
        if compact:
            json.dump(obj, f, ensure_ascii=False, separators=(",", ":"))
        else:
            json.dump(obj, f, ensure_ascii=False, indent=2)
            f.write("\n")
    tmp.replace(path)  # escritura atómica: nunca queda un archivo a medias


def write_meta(layer: str, *, fuente: str, url: str, fecha_corte: str, visualizacion: str,
               registros: int, notas: str = "", estilo: dict | None = None) -> None:
    write_json(LAYERS_DIR / f"{layer}.meta.json", {
        "capa": layer,
        "fuente": fuente,
        "url": url,
        "fecha_corte": fecha_corte,
        "fecha_carga": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "visualizacion": visualizacion,
        "registros": registros,
        "estilo": estilo or {},
        "notas": notas,
    }, compact=False)
