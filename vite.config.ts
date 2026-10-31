import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Throwaway renderer only: not the Electron application.
export default defineConfig({
  root: '.scratch/swcc-desktop-app/prototype',
  plugins: [react()],
  server: { port: 5173, strictPort: true, open: '/prototype/swcc?variant=A' },
  build: { outDir: '../../../prototype-dist', emptyOutDir: true },
});
