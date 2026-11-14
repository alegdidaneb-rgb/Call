import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: 3000,
    host: true,
  },
  build: {
    outDir: "dist",
    sourcemap: false,
    rollupOptions: {
      output: {
        /*
         * Keep the framework in its own bundle. Application code changes on
         * most commits; React does not, so splitting it means a UI change no
         * longer invalidates ~180 kB in every agent's cache.
         */
        manualChunks: {
          react: ["react", "react-dom", "react-router-dom", "scheduler"],
        },
      },
    },
  },
});
