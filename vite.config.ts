import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  build: {
    target: "node20",
    outDir: "dist",
    lib: {
      entry: resolve(__dirname, "src/index.ts"),
      formats: ["es"],
      fileName: "index",
    },
    rollupOptions: {
      external: [
        /^node:/,
        "commander",
        "viem",
        "viem/accounts",
        "viem/chains",
        "@metamask/smart-accounts-kit",
      ],
      output: {
        banner: "#!/usr/bin/env node",
      },
    },
    minify: false,
  },
  test: {
    testTimeout: 30_000,
  },
});
