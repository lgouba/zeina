import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: "0.0.0.0",
    proxy: {
      "/v1": { target: "http://localhost:3030", changeOrigin: true },
      "/health": { target: "http://localhost:3030", changeOrigin: true },
    },
  },
});
