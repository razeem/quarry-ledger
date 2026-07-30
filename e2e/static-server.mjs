// Minimal static file server for e2e: serves the production build in `dist/`
// with SPA fallback to index.html. Used instead of `ng serve` so tests run
// against real, pre-built static chunks — no dev-server dependency optimization
// or reloads (which make lazily-loaded downloads flaky).
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../dist', import.meta.url));
const port = Number(process.env['PORT'] ?? 4300);

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

async function send(res, filePath, status = 200) {
  const body = await readFile(filePath);
  res.writeHead(status, {
    'content-type': CONTENT_TYPES[extname(filePath)] ?? 'application/octet-stream',
  });
  res.end(body);
}

const server = createServer(async (req, res) => {
  try {
    const urlPath = decodeURIComponent((req.url ?? '/').split('?')[0]);
    let filePath = join(root, normalize(urlPath));
    if (!filePath.startsWith(root)) {
      res.writeHead(403).end();
      return;
    }
    try {
      const stats = await stat(filePath);
      if (stats.isDirectory()) {
        filePath = join(filePath, 'index.html');
      }
      await send(res, filePath);
    } catch {
      // Unknown path → SPA fallback so client-side routes resolve.
      await send(res, join(root, 'index.html'));
    }
  } catch (err) {
    res.writeHead(500).end(String(err));
  }
});

server.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`e2e static server on http://localhost:${port}`);
});
