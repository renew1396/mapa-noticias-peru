import { cpSync, existsSync, createReadStream, statSync } from "node:fs";
import { resolve, join, normalize } from "node:path";
import { defineConfig, type Plugin } from "vite";

// Los datos viven en ../data (los generan los scripts de pipeline/ y etl/).
// La web los sirve bajo /data/... : en desarrollo directo desde el disco,
// y al compilar se copian a dist/data. Solo se publican estas carpetas:
const DATA_DIR = resolve(import.meta.dirname, "../data");
const PUBLISHED = ["layers", "news", "status"];

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
  plugins: [dataPlugin()],
  build: { target: "es2022", chunkSizeWarningLimit: 1500 },
  worker: { format: "es" },
  optimizeDeps: { exclude: ["maplibre-gl"] },
});
