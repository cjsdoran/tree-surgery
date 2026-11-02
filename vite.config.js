import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The dev server serves any file under the project root, and server.fs.deny does not cover
// root files. Refuse the folders that must stay server-side. Production publishes dist/ only.
const PRIVATE_PATHS = /^\/(prompts|reference|tests|scripts|pilot|netlify|calibration|schemas|docs)\/|^\/\.env/i;

// Vite also serves files by absolute path under /@fs/, so reduce those to a root-relative path
// before checking. Case-insensitive, as Windows paths are.
export function rootRelative(url, root) {
  let path = decodeURIComponent((url || '').split('?')[0]).replace(/\\/g, '/');
  const fsRoot = `/@fs/${root.replace(/\\/g, '/').replace(/^\/+/, '')}`.toLowerCase();
  if (path.toLowerCase().startsWith(fsRoot)) path = path.slice(fsRoot.length) || '/';
  return path;
}

function keepPrivateFilesOffDevServer() {
  return {
    name: 'ts-keep-private-files-off-dev-server',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = rootRelative(req.url, server.config.root);
        if (PRIVATE_PATHS.test(path)) {
          res.statusCode = 404;
          res.end('Not found');
          return;
        }
        next();
      });
    },
  };
}

export default defineConfig({
  plugins: [keepPrivateFilesOffDevServer(), react()],
  build: {
    sourcemap: false,
  },
  test: {
    include: ['tests/unit/**/*.test.{js,jsx,mjs}'],
    environment: 'node',
  },
});
