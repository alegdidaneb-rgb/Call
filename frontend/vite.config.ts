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
    /*
     * The app is reviewed through a proxy on a host that is not localhost, and
     * Vite rejects an unlisted Host header outright. `true` accepts any host,
     * which is appropriate for a dev server that binds on purpose and carries no
     * secrets of its own -- the Supabase key here is the same public client key
     * that ships in the production bundle.
     */
    allowedHosts: true,
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
