import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // Evita CORS em desenvolvimento: o CRM fala com a API pelo mesmo host.
      '/api': { target: 'http://localhost:3333', changeOrigin: true, rewrite: (p) => p.replace(/^\/api/, '') },
    },
  },
});
