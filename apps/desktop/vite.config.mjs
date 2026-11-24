import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  base: "./",
  publicDir: fileURLToPath(
    new URL("../../node_modules/@mediapipe/tasks-vision/wasm", import.meta.url),
  ),
  build: {
    outDir: fileURLToPath(new URL("../../dist-desktop", import.meta.url)),
    emptyOutDir: true,
  },
});
