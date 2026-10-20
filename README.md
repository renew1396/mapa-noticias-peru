# Mapa de noticias del Perú

**Sitio:** https://renew1396.github.io/mapa-noticias-peru/

Mapa del Perú, pensado para el celular, que reúne:

- **Noticias recientes ubicadas por lugar**: titulares de 33 medios con RSS (nacionales, regionales y temáticos),
  ubicados automáticamente en su distrito o centro poblado.
- **Datos públicos**: pobreza monetaria por distrito (INEI 2018), conflictos sociales (Defensoría del Pueblo),
  concesiones mineras vigentes (INGEMMET) y establecimientos de salud (SUSALUD).

Tocas un punto (o dibujas una zona) y ves qué está pasando ahí: noticias, indicadores, conflictos y concesiones,
siempre con su fuente y fecha. Se puede instalar en el celular como una app.

## Cómo funciona
No hay servidores: tareas automáticas de GitHub leen las fuentes y guardan archivos de datos, y GitHub Pages publica
la web, que hace los cálculos en el navegador. Costo: cero.

## Para quien mantenga el proyecto
Empieza por [`CLAUDE.md`](CLAUDE.md) (cómo está armado), [`RUNBOOK.md`](RUNBOOK.md) (qué hacer cuando algo falla),
[`DECISIONS.md`](DECISIONS.md) (por qué se hizo así) y [`SOURCES.md`](SOURCES.md) (de dónde sale cada dato).

## Créditos de datos
INEI · Defensoría del Pueblo · INGEMMET · SUSALUD · ANA · mapa base © OpenStreetMap / OpenMapTiles vía OpenFreeMap.
Las noticias pertenecen a sus medios: aquí solo se muestra el titular, un resumen corto y el enlace al original.
