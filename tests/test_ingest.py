from pipeline.fuentes import pistas_departamento, seccion_excluida, titulo_excluido
from pipeline.ingest import url_canonica
from pipeline.temas import clasificar
from pipeline.textnorm import limpiar_html, recortar


def test_url_canonica_quita_rastreo():
    a = url_canonica("https://www.rpp.pe/peru/nota-123/?utm_source=x&fbclid=y")
    b = url_canonica("http://rpp.pe/peru/nota-123")
    assert a == b == "https://rpp.pe/peru/nota-123"


def test_secciones_y_titulos_excluidos():
    assert seccion_excluida("https://rpp.pe/futbol/liga-1/algo")
    assert seccion_excluida("https://www.infobae.com/peru/deportes/2026/10/19/x/")
    assert not seccion_excluida("https://rpp.pe/peru/puno/algo")
    assert titulo_excluido("DIARIO LOS ANDES PUNO: 18/10/26")
    assert titulo_excluido("La Prensa Regional – Lunes 19 de octubre de 2026")
    assert not titulo_excluido("Puno: vecinos bloquean vía")


def test_pistas_de_region():
    assert pistas_departamento("correo", "https://diariocorreo.pe/edicion/ica/nota/") == ["11"]
    assert pistas_departamento("radiouno", "https://www.radiouno.pe/noticias/x") == ["23"]
    assert pistas_departamento("rpp", "https://rpp.pe/x") == []


def test_limpieza_y_recorte():
    t = limpiar_html("<p>Hola &amp; chau</p> The post Algo first appeared on Diario.")
    assert t == "Hola & chau"
    r = recortar("palabra " * 100, 300)
    assert len(r) <= 300 and r.endswith("…")


def test_temas():
    assert clasificar("Paro: transportistas bloquean la carretera")[0] == "conflicto_social"
    assert clasificar("Huaico deja damnificados en Chosica")[0] == "desastres"
    assert clasificar("Receta de causa limeña") == ["otros"]
