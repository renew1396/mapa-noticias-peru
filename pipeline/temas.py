"""Clasificación temática por palabras clave (gratis). Lista cerrada en config/temas.yaml."""
from __future__ import annotations

import re
from functools import lru_cache

import yaml

from pipeline.fuentes import ROOT
from pipeline.textnorm import norm


@lru_cache(maxsize=1)
def temas() -> dict:
    return yaml.safe_load((ROOT / "config" / "temas.yaml").read_text(encoding="utf-8"))["temas"]


@lru_cache(maxsize=1)
def _patrones() -> dict[str, re.Pattern]:
    out = {}
    for clave, t in temas().items():
        palabras = [norm(p) for p in t.get("palabras", []) if norm(p)]
        if palabras:
            out[clave] = re.compile(r"\b(" + "|".join(re.escape(p) for p in sorted(palabras, key=len, reverse=True))
                                    + r")\b")
    return out


def clasificar(titulo: str, resumen: str = "") -> list[str]:
    """Devuelve hasta 2 temas, el principal primero. El título cuenta doble."""
    t, r = norm(titulo or ""), norm(resumen or "")
    puntos = {}
    for clave, pat in _patrones().items():
        n = 2 * len(pat.findall(t)) + len(pat.findall(r))
        if n:
            puntos[clave] = n
    if not puntos:
        return ["otros"]
    orden = sorted(puntos, key=lambda k: (-puntos[k], list(temas()).index(k)))
    return orden[:2]
