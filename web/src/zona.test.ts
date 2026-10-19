import { describe, expect, it } from "vitest";
import type { FeatureCollection } from "geojson";
import { distanciaKm, filtrar, noticiasEnZona } from "./zona";
import type { Noticia, Precision } from "./tipos";

// Dos "distritos" cuadrados de ~11 km de lado, uno al lado del otro, cerca de Lima.
const distritos: FeatureCollection = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      properties: { ubigeo: "150101", distrito: "A", provincia: "Lima", departamento: "Lima" },
      geometry: { type: "Polygon", coordinates: [[[-77.1, -12.1], [-77.0, -12.1], [-77.0, -12.0], [-77.1, -12.0], [-77.1, -12.1]]] },
    },
    {
      type: "Feature",
      properties: { ubigeo: "150102", distrito: "B", provincia: "Lima", departamento: "Lima" },
      geometry: { type: "Polygon", coordinates: [[[-77.0, -12.1], [-76.9, -12.1], [-76.9, -12.0], [-77.0, -12.0], [-77.0, -12.1]]] },
    },
  ],
};

function noticia(id: string, precision: Precision, ubigeo: string, lon: number, lat: number, fecha = "2026-10-19T12:00:00Z", temas = ["agua"]): Noticia {
  return {
    id, titulo: id, resumen: "", medio: "RPP", medio_id: "rpp", url: "https://x", fecha, temas,
    lugares: [{ nombre: id, ubigeo, precision, provincia: "", departamento: "", lon, lat, confianza: 0.9, principal: true }],
  };
}

describe("distanciaKm", () => {
  it("mide ~111 km por grado de latitud", () => {
    expect(distanciaKm([-77, -12], [-77, -13])).toBeCloseTo(111.2, 0);
  });
});

describe("noticiasEnZona", () => {
  const ns = [
    noticia("cerca", "distrito", "150101", -77.05, -12.05),
    noticia("lejos", "distrito", "150102", -76.91, -12.05),
    noticia("provincia", "provincia", "150100", -77.03, -12.04),
    noticia("otra-region", "departamento", "040000", -71.5, -16.4),
  ];
  it("separa noticias con pin dentro del radio de las de provincia o región", () => {
    const r = noticiasEnZona(ns, distritos, [-77.05, -12.05], 3);
    expect(r.distritos.map((d) => d.properties.ubigeo)).toEqual(["150101"]);
    expect(r.puntuales.map((n) => n.id)).toEqual(["cerca"]);
    expect(r.amplias.map((n) => n.id)).toEqual(["provincia"]);
  });
  it("un radio mayor toca ambos distritos", () => {
    const r = noticiasEnZona(ns, distritos, [-77.0, -12.05], 15);
    expect(r.distritos).toHaveLength(2);
    expect(r.puntuales.map((n) => n.id).sort()).toEqual(["cerca", "lejos"]);
  });
});

describe("filtrar", () => {
  it("por días, tema y medio", () => {
    const ahora = Date.parse("2026-10-20T00:00:00Z");
    const ns = [
      noticia("hoy", "distrito", "150101", 0, 0, "2026-10-19T12:00:00Z", ["agua"]),
      noticia("vieja", "distrito", "150101", 0, 0, "2026-09-01T12:00:00Z", ["agua"]),
      noticia("mineria", "distrito", "150101", 0, 0, "2026-10-19T12:00:00Z", ["mineria", "agua"]),
    ];
    expect(filtrar(ns, { dias: 7, tema: "", medio: "" }, ahora).map((n) => n.id)).toEqual(["hoy", "mineria"]);
    expect(filtrar(ns, { dias: 90, tema: "mineria", medio: "" }, ahora).map((n) => n.id)).toEqual(["mineria"]);
    expect(filtrar(ns, { dias: 90, tema: "", medio: "Otro" }, ahora)).toEqual([]);
  });
});
