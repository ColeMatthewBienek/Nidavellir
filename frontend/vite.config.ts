import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    watch: {
      // WSL2 inotify doesn't fire on /mnt/c paths — use polling so HMR works
      usePolling: true,
      interval: 200,
    },
  },
  define: {
    __API_BASE__: JSON.stringify('http://localhost:7430'),
  },
});
