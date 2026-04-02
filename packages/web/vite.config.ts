import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 11000,
    proxy: {
      '/ws': {
        target: 'http://localhost:11001',
        ws: true,
      },
      '/api': {
        target: 'http://localhost:11001',
      },
    },
  },
});
