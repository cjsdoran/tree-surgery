import { createReadStream, existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The dev server serves any file under the project root, and server.fs.deny does not cover
// root files. Refuse the folders that must stay server-side. Production publishes dist/ only.
// Schemas are not secret and the browser may import them, so they stay served.
const PRIVATE_PATHS = /^\/(prompts|reference|tests|scripts|pilot|netlify|calibration|docs)\/|^\/\.env/i;

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

// pdf.js needs its standard fonts, CMaps and wasm decoders to render a tree page (spec §6.3).
// They are served from /pdfjs/ in dev and copied into dist/pdfjs/ at build; the browser loads
// them only when it renders a PDF.
const PDFJS_DIR = 'node_modules/pdfjs-dist';
const PDFJS_FOLDERS = ['standard_fonts', 'cmaps', 'wasm'];

function pdfjsAssets() {
  return {
    name: 'ts-pdfjs-assets',
    configureServer(server) {
      server.middlewares.use('/pdfjs', (req, res, next) => {
        const rel = decodeURIComponent((req.url || '').split('?')[0]).replace(/^\/+/, '');
        const [folder] = rel.split('/');
        const file = join(PDFJS_DIR, rel);
        if (!PDFJS_FOLDERS.includes(folder) || rel.includes('..') || !existsSync(file) || !statSync(file).isFile()) return next();
        createReadStream(file).pipe(res);
      });
    },
    generateBundle() {
      for (const folder of PDFJS_FOLDERS) {
        for (const name of readdirSync(join(PDFJS_DIR, folder))) {
          if (/^LICENSE/.test(name)) continue;
          this.emitFile({ type: 'asset', fileName: `pdfjs/${folder}/${name}`, source: readFileSync(join(PDFJS_DIR, folder, name)) });
        }
      }
    },
  };
}

// The template link shows only once Chris adds the file (IT-2, assumption 6).
const TEMPLATE = 'Tree-Surgery-template.pptx';

export default defineConfig({
  plugins: [keepPrivateFilesOffDevServer(), pdfjsAssets(), react()],
  define: {
    __TREE_TEMPLATE__: JSON.stringify(existsSync(join('public', TEMPLATE)) ? `/${TEMPLATE}` : null),
  },
  build: {
    sourcemap: false,
  },
  test: {
    include: ['tests/unit/**/*.test.{js,jsx,mjs}'],
    environment: 'node',
  },
});
