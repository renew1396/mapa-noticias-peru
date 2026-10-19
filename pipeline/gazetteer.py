"""Gazetteer: todos los nombres de lugares del Perú que el geoparser sabe reconocer.

Se arma con:
  data/gazetteer/ubigeos.json   departamentos, provincias y distritos (INEI, 1 891 distritos)
  data/gazetteer/ccpp.json      centros poblados del Censo 2017 (INEI)
  config/gazetteer_alias.yaml   nombres alternativos y sinónimos
  config/exclusiones.yaml       frases que no son lugares y nombres que piden contexto

Códigos: siempre ubigeo de 6 dígitos ("150000" departamento, "150100" provincia, "150101" distrito).
Un centro poblado lleva además su código INEI de 10 dígitos en `ccpp`.
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path

import yaml

from pipeline.textnorm import norm

ROOT = Path(__file__).resolve().parent.parent

# Centros poblados que se aceptan sin palabra de contexto (más chicos piden "comunidad de", etc.).
POB_CCPP_LIBRE = 1000
POB_CCPP_MINIMA = 50


@dataclass(frozen=True)
class Lugar:
    ubigeo: str            # 6 dígitos
    tipo: str              # departamento | provincia | distrito | centro_poblado
    nombre: str            # nombre para mostrar
    departamento: str      # nombre del departamento
    provincia: str = ""    # nombre de la provincia ("" si es departamento)
    lon: float = 0.0
    lat: float = 0.0
    ccpp: str = ""         # código de 10 dígitos si es centro poblado
    poblacion: int = 0
    requiere_contexto: bool = False

    @property
    def dep(self) -> str:
        return self.ubigeo[:2]

    @property
    def prov(self) -> str:
        return self.ubigeo[:4]

    def contiene(self, otro: "Lugar") -> bool:
        """¿`otro` está dentro de este lugar?"""
        if self is otro or self.ubigeo == otro.ubigeo and self.ccpp == otro.ccpp:
            return False
        if self.tipo == "departamento":
            return otro.dep == self.dep
        if self.tipo == "provincia":
            return otro.prov == self.prov and otro.tipo in ("distrito", "centro_poblado")
        if self.tipo == "distrito":
            return otro.tipo == "centro_poblado" and otro.ubigeo == self.ubigeo
        return False


@dataclass
class Gazetteer:
    indice: dict[tuple[str, ...], list[Lugar]] = field(default_factory=dict)
    por_codigo: dict[str, Lugar] = field(default_factory=dict)
    sinonimos: dict[str, str] = field(default_factory=dict)
    frases_excluidas: list[tuple[str, ...]] = field(default_factory=list)
    prefijos_calle: set[tuple[str, ...]] = field(default_factory=set)
    solo_con_contexto: set[tuple[str, ...]] = field(default_factory=set)
    nunca: set[tuple[str, ...]] = field(default_factory=set)
    vecinos_permitidos: set[str] = field(default_factory=set)
    alias: set[tuple[tuple[str, ...], str, str]] = field(default_factory=set)
    max_tokens: int = 1

    def agregar(self, nombre: str, lugar: Lugar) -> None:
        clave = tuple(norm(nombre).split())
        if not clave or clave in self.nunca:
            return
        lista = self.indice.setdefault(clave, [])
        if lugar not in lista:
            lista.append(lugar)
        self.max_tokens = max(self.max_tokens, len(clave))

    def buscar(self, clave: tuple[str, ...]) -> list[Lugar]:
        return self.indice.get(clave, [])


def _yaml(nombre: str) -> dict:
    return yaml.safe_load((ROOT / "config" / nombre).read_text(encoding="utf-8")) or {}


def _tuplas(lista) -> list[tuple[str, ...]]:
    return [tuple(norm(x).split()) for x in (lista or []) if norm(x)]


@lru_cache(maxsize=1)
def cargar() -> Gazetteer:
    g = Gazetteer()
    excl = _yaml("exclusiones.yaml")
    g.nunca = set(_tuplas(excl.get("nunca")))
    # Las frases excluidas y los nombres "nunca" (países, ciudades extranjeras) se tapan en el texto.
    # ("peru" no se tapa: es parte de nombres como "Cáceres del Perú"; igual nunca se acepta como lugar.)
    g.frases_excluidas = sorted(set(_tuplas(excl.get("frases_excluidas"))) | (g.nunca - {("peru",)}),
                                key=len, reverse=True)
    g.vecinos_permitidos = {norm(x) for x in excl.get("vecinos_permitidos") or []}
    g.prefijos_calle = set(_tuplas(excl.get("prefijos_calle")))
    g.solo_con_contexto = set(_tuplas(excl.get("solo_con_contexto")))

    distritos = json.loads((ROOT / "data/gazetteer/ubigeos.json").read_text(encoding="utf-8"))
    ccpp = json.loads((ROOT / "data/gazetteer/ccpp.json").read_text(encoding="utf-8"))["filas"]

    # Punto de cada distrito: su capital (centro poblado 0001) si existe; si no, un punto interior.
    capitales = {c[0]: c for c in ccpp if c[1].endswith("0001")}
    poblacion: dict[str, int] = {}
    for c in ccpp:
        poblacion[c[0]] = poblacion.get(c[0], 0) + int(c[5])

    def punto(ub: str, d: dict) -> tuple[float, float]:
        c = capitales.get(ub)
        return (c[3], c[4]) if c else (d["lon"], d["lat"])

    info = {d["ubigeo"]: d for d in distritos}
    for d in distritos:
        ub = d["ubigeo"]
        lon, lat = punto(ub, d)
        lugar = Lugar(ub, "distrito", d["distrito"], d["departamento"], d["provincia"], lon, lat,
                      poblacion=poblacion.get(ub, 0))
        g.por_codigo[ub] = lugar
        g.agregar(d["distrito"], lugar)

    # Provincias y departamentos: el punto es el de su capital (distrito XXYY01 / XX0101).
    for d in distritos:
        ub = d["ubigeo"]
        prov, dep = ub[:4] + "00", ub[:2] + "0000"
        if prov not in g.por_codigo:
            cap = info.get(ub[:4] + "01", d)
            lon, lat = punto(cap["ubigeo"], cap)
            g.por_codigo[prov] = Lugar(prov, "provincia", d["provincia"], d["departamento"], d["provincia"], lon, lat)
            g.agregar(d["provincia"], g.por_codigo[prov])
        if dep not in g.por_codigo:
            cap = info.get(ub[:2] + "0101", d)
            lon, lat = punto(cap["ubigeo"], cap)
            g.por_codigo[dep] = Lugar(dep, "departamento", d["departamento"], d["departamento"], "", lon, lat)
            g.agregar(d["departamento"], g.por_codigo[dep])

    # Centros poblados (sin los que se llaman igual que su distrito: ese ya está).
    for ub, cod, nombre, lon, lat, pob, _clase in ccpp:
        if pob < POB_CCPP_MINIMA or ub not in info:
            continue
        d = info[ub]
        if norm(nombre) == norm(d["distrito"]):
            continue
        lugar = Lugar(ub, "centro_poblado", nombre, d["departamento"], d["provincia"], lon, lat, cod, pob,
                      requiere_contexto=pob < POB_CCPP_LIBRE)
        g.por_codigo[cod] = lugar
        g.agregar(nombre, lugar)

    alias = _yaml("gazetteer_alias.yaml")
    g.sinonimos = {norm(k): norm(v) for k, v in (alias.get("sinonimos") or {}).items()}
    for nombre, codigo in (alias.get("alias") or {}).items():
        lugar = g.por_codigo.get(str(codigo))
        if lugar is None:
            raise ValueError(f"gazetteer_alias.yaml: el código {codigo!r} de {nombre!r} no existe")
        # El alias se suma a los lugares con ese nombre y recibe un bono al desempatar.
        clave = tuple(norm(nombre).split())
        g.agregar(nombre, lugar)
        g.alias.add((clave, lugar.ubigeo, lugar.ccpp))
    return g
