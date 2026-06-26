import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const hmrHost = String(env.VITE_HMR_HOST || "").trim();
  const publicOrigin = String(env.VITE_PUBLIC_ORIGIN || "").trim();

  return {
    plugins: [react()],
    server: {
      host: "0.0.0.0",
      port: 5173,
      strictPort: true,
      allowedHosts: ["furlabac.share.zrok.io", ".zrok.io"],
      hmr: {
        protocol: "wss",
        clientPort: 443,
        ...(hmrHost ? { host: hmrHost } : {}),
      },
      ...(publicOrigin ? { origin: publicOrigin } : {}),
      proxy: {
        "/api": {
          target: "http://127.0.0.1:5500",
          changeOrigin: true,
          secure: false,
        },
      },
    },
    build: {
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (id.includes("node_modules/pdfmake")) return "pdfmake";
            return undefined;
          },
        },
      },
    },
  };
});
