"""Lectura de config/sources.yaml: medios, secciones excluidas y pistas de región."""
from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from urllib.parse import urlparse

import re

import yaml

ROOT = Path(__file__).resolve().parent.parent


@lru_cache(maxsize=1)
def config() -> dict:
    return yaml.safe_load((ROOT / "config" / "sources.yaml").read_text(encoding="utf-8"))


def medios(solo_activos: bool = True) -> list[dict]:
    return [m for m in config()["medios"] if m.get("activo", True) or not solo_activos]


def medio(id_: str) -> dict | None:
    return next((m for m in config()["medios"] if m["id"] == id_), None)


def seccion_excluida(url: str) -> bool:
    """True si la URL pertenece a una sección sin territorio (deportes, espectáculos, mundo…)."""
    tramos = urlparse(url).path.strip("/").split("/")[:3]
    return bool(set(config().get("secciones_excluidas", [])) & set(tramos))


def pistas_departamento(medio_id: str, url: str) -> list[str]:
    pistas = list((medio(medio_id) or {}).get("departamentos", []) or [])
    ruta = urlparse(url).path
    for fragmento, deps in (config().get("pistas_url") or {}).items():
        if fragmento in ruta:
            pistas = list(deps) + [d for d in pistas if d not in deps]
    return pistas


def titulo_excluido(titulo: str) -> bool:
    """True para portadas, ediciones digitales y titulares sin contenido (ver `titulos_excluidos`)."""
    t = (titulo or "").strip().lower()
    return not t or any(re.search(p, t) for p in config().get("titulos_excluidos", []))
