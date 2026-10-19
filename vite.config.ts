import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import { cpSync, mkdirSync, existsSync } from "node:fs";
mkdirSync("public/pdfjs", { recursive: true });
for (const folder of ["cmaps", "standard_fonts", "wasm"])
  cpSync(`node_modules/pdfjs-dist/${folder}`, `public/pdfjs/${folder}`, {
    recursive: true,
  });
mkdirSync("public/licenses", { recursive: true });
for (const name of [
  "react",
  "react-dom",
  "pdfjs-dist",
  "dexie",
  "jszip",
  "zustand",
  "zod",
  "lucide-react",
  "vite-plugin-pwa",
  "workbox-window",
  "workbox-core",
  "workbox-precaching",
  "workbox-routing",
  "workbox-strategies",
  "workbox-expiration",
]) {
  for (const file of [
    "LICENSE",
    "LICENSE.txt",
    "LICENSE.md",
    "LICENSE.markdown",
  ])
    if (existsSync(`node_modules/${name}/${file}`))
      cpSync(`node_modules/${name}/${file}`, `public/licenses/${name}-${file}`);
}
export default defineConfig({
  base: "./",
  plugins: [
    react(),
    VitePWA({
      registerType: "prompt",
      includeAssets: ["favicon.svg", "sample.pdf"],
      manifest: {
        id: "./",
        start_url: "./",
        scope: "./",
        name: "PaperTranslator",
        short_name: "PaperTranslator",
        lang: "zh-Hant",
        description: "逐段讀懂英文論文",
        theme_color: "#355c4b",
        background_color: "#fafbf6",
        display: "standalone",
        icons: [
          {
            src: "favicon.svg",
            sizes: "any",
            type: "image/svg+xml",
            purpose: "any",
          },
        ],
      },
      workbox: {
        cacheId: "PaperTranslator-v1",
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        globPatterns: [
          "**/*.{js,mjs,css,html,svg,pdf,woff,woff2,ttf,pfb,wasm,bcmap}",
        ],
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  build: { chunkSizeWarningLimit: 1600 },
});
