import { cpSync, existsSync, createReadStream, statSync, writeFileSync } from "node:fs";
import { resolve, join, normalize } from "node:path";
import { defineConfig, type Plugin } from "vite";

// Los datos viven en ../data (los generan los scripts de pipeline/ y etl/).
// La web los sirve bajo /data/... : en desarrollo directo desde el disco,
// y al compilar se copian a dist/data. Solo se publican estas carpetas:
const DATA_DIR = resolve(import.meta.dirname, "../data");
const PUBLISHED = ["layers", "news", "status"];

// Service worker (PWA): se genera en cada compilación con su propia versión, para que el celular descarte
// el contenido viejo. Estrategia: el código (assets con hash) desde caché; la página y los datos JSON primero
// desde la red y, si no hay internet, desde la caché. No toca el mapa base (otro dominio) ni los PMTiles.
function swPlugin(): Plugin {
  let archivos: string[] = [];
  return {
    name: "service-worker",
    apply: "build",
    generateBundle(_, bundle) {
      archivos = Object.keys(bundle).filter((f) => f.startsWith("assets/"));
    },
    closeBundle() {
      const version = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
      const precache = ["./", "manifest.webmanifest", "iconos/icono-192.png", ...archivos];
      const codigo = `// Generado por vite.config.ts (swPlugin). No editar a mano.
const VERSION = "${version}";
const CACHE_APP = "app-" + VERSION;
const CACHE_DATOS = "datos";
const PRECACHE = ${JSON.stringify(precache)};

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE_APP).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys()
    .then((ks) => Promise.all(ks.filter((k) => k.startsWith("app-") && k !== CACHE_APP).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});
async function redPrimero(req, cache) {
  try {
    const r = await fetch(req);
    if (r.ok) (await caches.open(cache)).put(req, r.clone());
    return r;
  } catch (err) {
    const guardado = await caches.match(req, { ignoreSearch: req.mode === "navigate" });
    if (guardado) return guardado;
    throw err;
  }
}
self.addEventListener("fetch", (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== self.location.origin || req.headers.has("range") || url.pathname.endsWith(".pmtiles")) return;
  if (req.mode === "navigate") return e.respondWith(redPrimero(req, CACHE_APP));
  if (url.pathname.includes("/assets/")) {
    return e.respondWith(caches.match(req).then((g) => g || fetch(req).then((r) => {
      if (r.ok) caches.open(CACHE_APP).then((c) => c.put(req, r.clone()));
      return r;
    })));
  }
  if (url.pathname.includes("/data/")) return e.respondWith(redPrimero(req, CACHE_DATOS));
});
`;
      writeFileSync(resolve(import.meta.dirname, "dist/sw.js"), codigo);
    },
  };
}

function dataPlugin(): Plugin {
  return {
    name: "datos-del-repo",
    configureServer(server) {
      server.middlewares.use("/data", (req, res, next) => {
        const rel = normalize(decodeURIComponent((req.url ?? "/").split("?")[0]));
        const top = rel.split("/").filter(Boolean)[0];
        const file = join(DATA_DIR, rel);
        if (!PUBLISHED.includes(top) || !file.startsWith(DATA_DIR) || !existsSync(file) || !statSync(file).isFile()) {
          return next();
        }
        res.setHeader("Content-Type", file.endsWith("json") ? "application/json" : "application/octet-stream");
        createReadStream(file).pipe(res);
      });
    },
    closeBundle() {
      for (const dir of PUBLISHED) {
        const src = join(DATA_DIR, dir);
        if (existsSync(src)) cpSync(src, resolve(import.meta.dirname, "dist/data", dir), { recursive: true });
      }
    },
  };
}

export default defineConfig({
  base: "./", // funciona tanto en usuario.github.io/repo/ como en local
  plugins: [dataPlugin(), swPlugin()],
  build: { target: "es2022", chunkSizeWarningLimit: 1500 },
  worker: { format: "es" },
  optimizeDeps: { exclude: ["maplibre-gl"] },
});
