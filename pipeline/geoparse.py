"""Geoparsing Nivel 1 (gratis): encuentra DÓNDE ocurre una noticia usando solo el gazetteer.

Pasos:
 1. Busca en título y resumen todos los nombres del gazetteer (el más largo gana: "San Juan de
    Lurigancho" antes que "San Juan"). Ignora frases excluidas (clubes, personas, calles) y exige
    mayúscula inicial, salvo en textos escritos todo en mayúsculas.
 2. Para cada mención mira el contexto: "distrito de", "provincia de", "región", "en", "desde", el
    formato "Puno: …" al inicio del título, y fechas de cabecera ("Lima, 18 de octubre") que no cuentan.
 3. Si un nombre corresponde a varios lugares, desempata con: la palabra de contexto, otros lugares
    mencionados (su provincia o departamento), la pista de región del medio y la población.
 4. Elige el lugar principal: el de mayor puntaje sumando el apoyo de los lugares que lo contienen
    ("Santa Rosa" + "Melgar" + "Puno" → Santa Rosa, distrito de Melgar).

Devuelve una lista de lugares con `principal`, `precision` y `confianza` (0–1).
"""
from __future__ import annotations

from dataclasses import dataclass, field

from pipeline.gazetteer import Gazetteer, Lugar, cargar
from pipeline.textnorm import CONECTORES, Token, es_mayuscula, sin_tildes, tokenizar

# Palabras de contexto antes del nombre → qué tipo de lugar sugieren.
PISTAS: dict[tuple[str, ...], str] = {
    ("distrito", "de"): "distrito", ("distrito",): "distrito", ("distritos", "de"): "distrito",
    ("regiones", "de"): "departamento", ("provincia", "de"): "provincia", ("provincia",): "provincia", ("provincias", "de"): "provincia",
    ("region",): "departamento", ("region", "de"): "departamento", ("departamento", "de"): "departamento",
    ("departamento",): "departamento", ("gobierno", "regional", "de"): "departamento",
    ("gobernador", "regional", "de"): "departamento", ("gobernadora", "regional", "de"): "departamento",
    ("consejo", "regional", "de"): "departamento", ("diresa",): "departamento", ("geresa",): "departamento",
    ("corte", "superior", "de", "justicia", "de"): "departamento", ("corte", "de"): "departamento",
    ("municipalidad", "provincial", "de"): "provincia", ("municipalidad", "distrital", "de"): "distrito",
    ("municipalidad", "de"): "municipio", ("municipio", "de"): "municipio", ("alcalde", "de"): "municipio",
    ("alcaldesa", "de"): "municipio", ("comuna", "de"): "municipio",
    ("comisaria", "de"): "ciudad", ("posta", "de"): "ciudad", ("centro", "de", "salud", "de"): "ciudad",
    ("hospital", "de"): "ciudad", ("penal", "de"): "ciudad", ("puerto", "de"): "ciudad",
    ("ciudad", "de"): "ciudad", ("la", "ciudad", "de"): "ciudad", ("centro", "de"): "ciudad",
    ("centro", "poblado", "de"): "ccpp", ("centro", "poblado"): "ccpp", ("localidad", "de"): "ccpp",
    ("comunidad", "campesina", "de"): "ccpp", ("comunidad", "nativa", "de"): "ccpp", ("comunidad", "de"): "ccpp",
    ("comunidad", "campesina"): "ccpp", ("comunidad", "nativa"): "ccpp", ("caserio", "de"): "ccpp",
    ("caserio",): "ccpp", ("anexo", "de"): "ccpp", ("anexo",): "ccpp", ("poblado", "de"): "ccpp",
    ("valle", "de"): "provincia",
}
MAX_PISTA = max(len(k) for k in PISTAS)
PISTAS_ADMIN = {"distrito", "provincia", "departamento", "ccpp"}

# Palabras en todo el texto que inclinan un nombre repetido (Puno región / Puno ciudad).
AMBIENTE_REGION = {"region", "regional", "regiones", "gobernador", "gobernadora", "gore", "diresa", "geresa",
                   "dre", "drep", "departamento", "vicegobernadora", "vicegobernador"}
AMBIENTE_CIUDAD = {"ciudad", "alcalde", "alcaldesa", "municipalidad", "municipio", "barrio", "plaza", "avenida",
                   "jiron", "urbanizacion", "mercado", "terminal", "centro", "distrito", "vecinos", "calles"}

MESES = {"enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "setiembre",
         "octubre", "noviembre", "diciembre"}
NEGATIVAS = {("desde",), ("natural", "de"), ("oriundo", "de"), ("oriunda", "de"), ("procedente", "de"),
             ("procedentes", "de"), ("viajaba", "de"), ("hacia",)}

# "en Lima y el Perú", "Lima y regiones": alcance nacional, no local.
NACIONAL = {("y", "el", "peru"), ("y", "regiones"), ("y", "provincias"), ("y", "todo", "el"), ("y", "el", "pais")}

BASE_TIPO = {"departamento": 2.0, "provincia": 1.6, "distrito": 1.4}


@dataclass
class Mencion:
    clave: tuple[str, ...]
    texto: str
    candidatos: list[Lugar]
    en_titulo: bool
    pista: str | None = None
    prefijo: bool = False    # "Puno: …" al inicio del título
    tras_en: bool = False    # "… en Vinchos"
    negativa: bool = False   # "desde Lima", "natural de Cusco"
    peso: float = 0.0
    elegido: Lugar | None = None
    certeza: float = 0.0


@dataclass
class LugarEncontrado:
    lugar: Lugar
    puntaje: float
    certeza: float
    menciones: list[str] = field(default_factory=list)
    pesos: list[float] = field(default_factory=list)
    principal: bool = False
    confianza: float = 0.0

    def como_dict(self) -> dict:
        lg = self.lugar
        return {
            "nombre": lg.nombre,
            "ubigeo": lg.ubigeo,
            **({"ccpp": lg.ccpp} if lg.ccpp else {}),
            "precision": lg.tipo,
            "provincia": lg.provincia,
            "departamento": lg.departamento,
            "lon": lg.lon,
            "lat": lg.lat,
            "confianza": round(self.confianza, 2),
            "principal": self.principal,
        }


def _ccpp_base(lg: Lugar) -> float:
    if lg.poblacion >= 50_000:
        return 1.5
    if lg.poblacion >= 10_000:
        return 1.1
    if lg.poblacion >= 1_000:
        return 0.7
    return 0.3


def _base(lg: Lugar) -> float:
    return BASE_TIPO.get(lg.tipo) or _ccpp_base(lg)


def _todo_mayusculas(texto: str) -> bool:
    letras = [c for c in texto if c.isalpha()]
    return len(letras) > 20 and sum(c.isupper() for c in letras) / len(letras) > 0.7


def _excluir_frases(toks: list[Token], g: Gazetteer) -> list[bool]:
    """Marca los tokens que forman parte de una frase excluida."""
    tapado = [False] * len(toks)
    ns = [t.n for t in toks]
    for frase in g.frases_excluidas:
        k = len(frase)
        for i in range(len(ns) - k + 1):
            if tuple(ns[i:i + k]) == frase:
                for j in range(i, i + k):
                    tapado[j] = True
    return tapado


def _pegado(texto: str, toks: list[Token], ns: list[str], g: Gazetteer, vecino: int, borde: int) -> bool:
    """¿El token `vecino` está pegado al lugar (solo un espacio en medio) y es otra palabra con mayúscula
    que no es conector, ni palabra permitida, ni un lugar? Entonces el lugar es parte de un nombre
    propio más largo: "María Julia", "Tomás Gálvez", "Radio Marañón", "Olivia Mejía"."""
    if vecino < 0 or vecino >= len(toks):
        return False
    a, b = sorted((vecino, borde))
    if texto[toks[a].fin:toks[b].ini] != " ":
        return False
    tok, n = toks[vecino], ns[vecino]
    return (tok.orig[:1].isupper() and not tok.orig.isupper() and n not in CONECTORES
            and n not in g.vecinos_permitidos and (n,) not in g.indice)


def _pista_antes(ns: list[str], i: int) -> str | None:
    for k in range(MAX_PISTA, 0, -1):
        if i - k >= 0 and tuple(ns[i - k:i]) in PISTAS:
            return PISTAS[tuple(ns[i - k:i])]
    return None


def _menciones(texto: str, en_titulo: bool, g: Gazetteer) -> list[tuple[Mencion, int, int, list[str]]]:
    toks = tokenizar(texto)
    ns = [g.sinonimos.get(t.n, t.n) for t in toks]
    tapado = _excluir_frases(toks, g)
    mayus = _todo_mayusculas(texto)
    salida = []
    i = 0
    while i < len(toks):
        hallado = None
        for k in range(min(g.max_tokens, len(toks) - i), 0, -1):
            clave = tuple(ns[i:i + k])
            if clave[-1] in CONECTORES or clave[0] in CONECTORES and k == 1:
                continue
            if any(tapado[i:i + k]):
                continue
            cands = g.buscar(clave)
            if not cands:
                continue
            # Mayúscula en cada palabra del nombre (los conectores internos pueden ir en minúscula, pero
            # el artículo inicial no: "La Victoria" sí, "la victoria" no; "El Valle" sí, "el valle" no).
            if not mayus and not (es_mayuscula(toks[i]) and all(
                    es_mayuscula(t) for t, n in zip(toks[i:i + k], clave) if n not in CONECTORES)):
                continue
            hallado = (clave, k, cands)
            break
        if not hallado:
            i += 1
            continue
        clave, k, cands = hallado
        previo = tuple(ns[max(0, i - 2):i])
        # Calles, colegios, estadios: "avenida Arequipa" no es Arequipa ("colegio de Piura" sí es Piura).
        if previo[-1:] and ((previo[-1],) in g.prefijos_calle or previo in g.prefijos_calle):
            i += k
            continue
        # Parte de un nombre de persona u organización: "María Julia", "Tomás Gálvez", "Radio Marañón".
        pista = _pista_antes(ns, i)
        if not mayus and pista is None and (
                _pegado(texto, toks, ns, g, i - 1, i) or _pegado(texto, toks, ns, g, i + k, i + k - 1)):
            i += k
            continue
        # Fecha de cabecera: "Lima, 18 de octubre" / "Lima (Andina). –"
        sig = ns[i + k:i + k + 3]
        if len(sig) >= 3 and sig[0].isdigit() and sig[1] == "de" and sig[2] in MESES:
            i += k
            continue
        m = Mencion(clave, " ".join(t.orig for t in toks[i:i + k]), list(cands), en_titulo)
        m.pista = pista
        m.prefijo = en_titulo and i == 0 and texto[toks[i + k - 1].fin:].lstrip().startswith(":")
        m.tras_en = previo[-1:] == ("en",)
        m.negativa = (previo[-1:] in NEGATIVAS or previo in NEGATIVAS
                      or tuple(ns[i + k:i + k + 3]) in NACIONAL or tuple(ns[i + k:i + k + 2]) in NACIONAL)
        salida.append((m, i, k, ns))
        i += k
    return salida


def _peso(m: Mencion) -> float:
    """Cuánto indica esta mención que el hecho ocurre ahí."""
    w = 3.0 if m.en_titulo else 1.0   # el titular es la mejor señal de qué trata la noticia
    if m.prefijo:
        w += 2.0
    if m.tras_en:
        w += 1.0
    if m.pista in PISTAS_ADMIN or m.pista in ("municipio", "ciudad"):
        w += 1.0
    if m.negativa:
        w -= 2.5
    return w


def _bono_pista(lg: Lugar, pistas: set[str]) -> float:
    """Bono por palabras de contexto ("distrito de", "región", "comunidad de"…) que calzan con el tipo."""
    bono = 0.0
    for p in pistas:
        if p in ("distrito", "provincia", "departamento") and lg.tipo == p:
            bono = max(bono, 3.0)
        elif p == "ccpp" and lg.tipo == "centro_poblado":
            bono = max(bono, 3.0)
        elif p == "municipio" and lg.tipo in ("provincia", "distrito"):
            bono = max(bono, 1.5 + (0.3 if lg.tipo == "provincia" else 0))
        elif p == "ciudad" and lg.tipo in ("distrito", "centro_poblado"):
            bono = max(bono, 2.0)
    return bono


def norm_ok(x: Lugar, m: Mencion) -> bool:
    """Un candidato de otra mención cuenta como 'contenido' solo si no es el mismo nombre repetido."""
    return x.nombre.lower() != m.texto.lower()


def geoparse(titulo: str, resumen: str = "", pistas_dep: list[str] | None = None) -> list[dict]:
    """Ubica una noticia. `pistas_dep` = códigos de departamento probables (medio regional o URL)."""
    g = cargar()
    pistas_dep = pistas_dep or []
    menciones: list[Mencion] = []
    for texto, en_titulo in ((titulo or "", True), (resumen or "", False)):
        for m, _i, _k, _ns in _menciones(texto, en_titulo, g):
            m.peso = _peso(m)
            menciones.append(m)
    if not menciones:
        return []

    todas = set()
    for t in ((titulo or "") + " " + (resumen or "")).split():
        todas.add(t.strip(".,;:()\"'«»“”").lower())
    ambiente = {sin_tildes(w) for w in todas}
    hay_region = bool(ambiente & AMBIENTE_REGION)
    hay_ciudad = bool(ambiente & AMBIENTE_CIUDAD)

    # Lugares sin ambigüedad (un solo candidato) sirven para desempatar a los demás.
    seguros = [m.candidatos[0] for m in menciones if len(m.candidatos) == 1]

    # Cada nombre se resuelve UNA vez, con el contexto de todas sus menciones.
    grupos: dict[tuple[str, ...], list[Mencion]] = {}
    for m in menciones:
        grupos.setdefault(m.clave, []).append(m)

    for ms in grupos.values():
        m = ms[0]
        pistas_m = {x.pista for x in ms if x.pista}
        # Candidatos de las OTRAS menciones (sin contar repeticiones del mismo nombre).
        otros = [x for mm in menciones if mm.clave != m.clave for x in mm.candidatos]
        puntajes: list[tuple[float, Lugar]] = []
        for lg in m.candidatos:
            s = _base(lg) + _bono_pista(lg, pistas_m)
            # Apoyo de otros lugares mencionados que lo contienen (su provincia o departamento).
            for otro in otros:
                if otro.contiene(lg) and otro.tipo in ("provincia", "departamento", "distrito"):
                    s += 2.5 if otro in seguros else 1.2
            # Si contiene a otros lugares mencionados, probablemente es la región/provincia que los agrupa.
            if lg.tipo in ("departamento", "provincia") and any(
                    lg.contiene(x) and x.dep == lg.dep and norm_ok(x, m) for x in otros):
                s += 1.5
            if (m.clave, lg.ubigeo, lg.ccpp) in g.alias:
                s += 1.0
            if lg.dep in pistas_dep:
                s += 1.2
            if lg.tipo == "distrito":  # último desempate entre distritos homónimos: población (Censo 2017)
                s += 0.6 * min(1.0, lg.poblacion / 300_000)
            # Nombre de capital repetido (Puno región / provincia / ciudad).
            mismos = [x for x in m.candidatos if x.dep == lg.dep]
            if len(mismos) > 1 and lg.tipo in ("departamento", "provincia", "distrito"):
                tipos = {x.tipo for x in mismos}
                contiene_otros = any(x.dep == lg.dep and x.nombre.lower() != m.texto.lower()
                                     and x.tipo in ("distrito", "centro_poblado", "provincia") for x in otros)
                if not pistas_m and not contiene_otros:
                    if lg.dep in ("15", "07"):  # Lima y Callao: la ciudad es la provincia
                        s += 2.0 if lg.tipo == "provincia" else 0
                    elif hay_region and lg.tipo == "departamento":
                        s += 1.5
                    elif not hay_region and lg.tipo == "distrito" and {"departamento", "provincia"} & tipos:
                        s += 1.5
                    elif hay_ciudad and lg.tipo == "distrito":
                        s += 1.0
            # Nombres que también son palabras comunes o apellidos: piden contexto.
            if lg.requiere_contexto or m.clave in g.solo_con_contexto:
                apoyado = (any(x.pista or x.prefijo or x.tras_en for x in ms)
                           or any(x.contiene(lg) for x in otros))
                if not apoyado:
                    s = -1.0
            puntajes.append((s, lg))
        puntajes.sort(key=lambda x: (-x[0], x[1].tipo != "distrito"))
        mejor, lg = puntajes[0]
        if mejor <= 0:
            continue
        segundo = puntajes[1][0] if len(puntajes) > 1 else None
        if segundo is None:
            certeza = 0.9
        else:
            margen = mejor - segundo
            certeza = 0.85 if margen >= 2.5 else 0.7 if margen >= 1.2 else 0.5
            if {x.dep for _, x in puntajes[:2]} == {lg.dep}:  # empate solo entre niveles del mismo lugar
                certeza = max(certeza, 0.6)
        for x in ms:
            x.elegido, x.certeza = lg, certeza

    # Juntar menciones del mismo lugar.
    encontrados: dict[tuple[str, str], LugarEncontrado] = {}
    for m in menciones:
        if not m.elegido:
            continue
        key = (m.elegido.ubigeo, m.elegido.ccpp)
        e = encontrados.get(key)
        if e is None:
            e = encontrados[key] = LugarEncontrado(m.elegido, 0.0, m.certeza)
        e.pesos.append(m.peso)
        e.certeza = max(e.certeza, m.certeza)
        e.menciones.append(m.texto)
    for e in encontrados.values():
        # Repetir un nombre suma cada vez menos; la región del medio suma un poco.
        pesos = sorted(e.pesos, reverse=True)
        e.puntaje = pesos[0] + 0.5 * sum(pesos[1:]) + (1.0 if e.lugar.dep in pistas_dep else 0.0)
    if not encontrados:
        return []

    lista = list(encontrados.values())
    # Apoyo jerárquico: los lugares que contienen a otro le suman la mitad de su puntaje.
    apoyo = {}
    for e in lista:
        apoyo[id(e)] = e.puntaje + 0.5 * sum(o.puntaje for o in lista if o.lugar.contiene(e.lugar))
    orden = sorted(lista, key=lambda e: (-apoyo[id(e)], ["centro_poblado", "distrito", "provincia",
                                                          "departamento"].index(e.lugar.tipo)))
    principal = orden[0]
    if principal.puntaje <= 0:
        return []
    # El más específico que sea coherente: si el ganador es una región o provincia y dentro de ella se
    # menciona un lugar más chico con peso propio, el hecho ocurre en ese lugar más chico.
    contenidos = [e for e in orden[1:] if principal.lugar.contiene(e.lugar) and e.puntaje >= 1.0]
    if contenidos:
        principal = contenidos[0]
    principal.principal = True

    rival = next((e for e in orden if e.lugar.dep != principal.lugar.dep), None)
    dominio = 1.0
    if rival is not None and apoyo[id(rival)] >= 0.8 * apoyo[id(principal)]:
        dominio = 0.7
    # Enumeración de 3 o más regiones sin una que destaque: noticia de alcance nacional.
    deps = {e.lugar.dep for e in lista if e.puntaje >= 1.0}
    if len(deps) >= 3 and (rival is None or apoyo[id(principal)] < 2 * apoyo[id(rival)]):
        dominio = 0.3
    for e in lista:
        e.confianza = e.certeza * (dominio if e.principal else 1.0)
        if not e.principal and e.lugar.contiene(principal.lugar):
            e.confianza = max(e.confianza, principal.confianza)
    return [e.como_dict() for e in sorted(lista, key=lambda e: not e.principal)]
