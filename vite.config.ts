import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        secure: false,
      },
      '/route': {
        target: 'http://localhost:8989',
        changeOrigin: true,
        secure: false,
      }
    }
  }
});