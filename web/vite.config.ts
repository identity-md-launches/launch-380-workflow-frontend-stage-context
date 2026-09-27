import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
const exportDir = fileURLToPath(new URL("../dist/", import.meta.url));
export default defineConfig({
  plugins: [
    react(),
    {
      name: "runtime-manifest-in-dev",
      configureServer(server) {
        server.middlewares.use(async (request, response, next) => {
          const path = request.url?.split("?")[0];
          if (
            path !== "/imd-deployment.json" &&
            !/^\/abi\/[A-Za-z0-9]+\.json$/.test(path ?? "")
          )
            return next();
          try {
            response.setHeader("Content-Type", "application/json");
            response.end(await readFile(resolve(exportDir, path!.slice(1))));
          } catch {
            response.statusCode = 503;
            response.end("Build the static export first: npm run build");
          }
        });
      },
    },
  ],
  base: "./",
  build: { outDir: "../dist", emptyOutDir: true, sourcemap: false },
});
