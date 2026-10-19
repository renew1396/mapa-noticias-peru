"""Normalización de texto compartida por el gazetteer, el geoparser y la clasificación."""
from __future__ import annotations

import html
import re
import unicodedata
from dataclasses import dataclass

TOKEN_RE = re.compile(r"[0-9A-Za-zÀ-ÖØ-öø-ÿ]+(?:[-'’][0-9A-Za-zÀ-ÖØ-öø-ÿ]+)*")

# Palabras que pueden ir en minúscula dentro de un nombre de lugar ("San Juan de Lurigancho").
CONECTORES = {"de", "del", "la", "las", "los", "el", "y"}


def sin_tildes(texto: str) -> str:
    """Minúsculas sin tildes ni diéresis (la ñ pasa a n)."""
    t = unicodedata.normalize("NFD", texto.lower())
    return "".join(c for c in t if unicodedata.category(c) != "Mn")


def norm(texto: str) -> str:
    """Forma canónica de un nombre: tokens sin tildes separados por un espacio."""
    return " ".join(sin_tildes(m.group(0)).replace("’", "'") for m in TOKEN_RE.finditer(texto))


@dataclass(frozen=True)
class Token:
    orig: str      # tal como aparece en el texto
    n: str         # normalizado
    ini: int       # posición del primer carácter en el texto
    fin: int


def tokenizar(texto: str) -> list[Token]:
    return [Token(m.group(0), sin_tildes(m.group(0)).replace("’", "'"), m.start(), m.end())
            for m in TOKEN_RE.finditer(texto)]


def es_mayuscula(tok: Token) -> bool:
    return tok.orig[:1].isupper() or tok.orig[:1].isdigit()


def limpiar_html(texto: str) -> str:
    t = re.sub(r"<[^>]+>", " ", texto or "")
    t = html.unescape(t)
    # Coletillas automáticas de WordPress
    t = re.sub(r"(The post|La entrada) .{0,300}?(first appeared on|se public[oó] primero en) .*$", "", t, flags=re.S)
    return re.sub(r"\s+", " ", t).strip()


def recortar(texto: str, maximo: int = 300) -> str:
    if len(texto) <= maximo:
        return texto
    corte = texto[: maximo - 1].rsplit(" ", 1)[0].rstrip(",;:-–")
    return corte + "…"
