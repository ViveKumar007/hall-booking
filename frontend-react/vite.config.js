import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// The app only calls /api/... on its own origin.
// - npm run dev (http://localhost:5173): Vite forwards /api and the Google sign-in start (/oauth2) to the Spring Boot
//   backend on :8090. Google sends people back to :8090 (the registered redirect URI); the login cookie is valid for
//   both ports, so after signing in, http://localhost:5173 works too.
// - npm run build: the files in dist/ are served by the backend itself on :8090 (or by nginx in Docker).
const backend = process.env.BACKEND_URL || 'http://localhost:8090';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: { '/api': backend, '/oauth2': backend },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
