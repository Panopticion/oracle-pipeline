import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import { defineConfig } from "vite";
import { nitro } from "nitro/vite";
import tsConfigPaths from "vite-tsconfig-paths";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  ssr: {
    external: ["pdf-parse", "pdf-parse/lib/pdf-parse.js"],
  },
  plugins: [
    tanstackStart({ srcDirectory: "app" }),
    nitro(),
    tsConfigPaths({ projects: ["./tsconfig.json"] }),
    tailwindcss(),
  ],
});
