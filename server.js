const http = require('http');
const fs = require('fs/promises');
const path = require('path');

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const STORAGE_FILE = path.join(__dirname, 'decks-db.json');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
};

async function ensureStorageFile() {
  try {
    await fs.access(STORAGE_FILE);
  } catch {
    await fs.writeFile(STORAGE_FILE, '[]\n', 'utf8');
  }
}

async function loadDecks() {
  await ensureStorageFile();
  const raw = await fs.readFile(STORAGE_FILE, 'utf8');
  const parsed = JSON.parse(raw);
  return Array.isArray(parsed) ? parsed : [];
}

async function saveDecks(decks) {
  const content = `${JSON.stringify(decks, null, 2)}\n`;
  await fs.writeFile(STORAGE_FILE, content, 'utf8');
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(payload));
}

function sanitizePathname(pathname) {
  if (pathname === '/') {
    return '/index.html';
  }

  if (pathname.includes('..')) {
    return null;
  }

  return pathname;
}

async function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';

    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 5 * 1024 * 1024) {
        reject(new Error('Body demasiado grande'));
      }
    });

    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

async function handleApi(req, res) {
  if (req.url !== '/api/decks') {
    sendJson(res, 404, { error: 'Ruta API no encontrada' });
    return;
  }

  if (req.method === 'GET') {
    try {
      const decks = await loadDecks();
      sendJson(res, 200, decks);
    } catch (error) {
      sendJson(res, 500, { error: `No se pudieron leer mazos: ${error.message}` });
    }
    return;
  }

  if (req.method === 'PUT') {
    try {
      const body = await readRequestBody(req);
      const parsed = JSON.parse(body || '[]');

      if (!Array.isArray(parsed)) {
        sendJson(res, 400, { error: 'El body debe ser un array de mazos' });
        return;
      }

      await saveDecks(parsed);
      sendJson(res, 200, { ok: true, count: parsed.length });
    } catch (error) {
      sendJson(res, 400, { error: `Body inválido: ${error.message}` });
    }
    return;
  }

  sendJson(res, 405, { error: 'Método no permitido' });
}

async function handleStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = sanitizePathname(decodeURIComponent(url.pathname));

  if (!pathname) {
    sendJson(res, 400, { error: 'Ruta inválida' });
    return;
  }

  const absolutePath = path.join(__dirname, pathname);

  try {
    const stat = await fs.stat(absolutePath);
    if (stat.isDirectory()) {
      sendJson(res, 404, { error: 'Ruta inválida' });
      return;
    }

    const extension = path.extname(absolutePath).toLowerCase();
    const mimeType = MIME_TYPES[extension] || 'application/octet-stream';
    const content = await fs.readFile(absolutePath);

    res.writeHead(200, {
      'Content-Type': mimeType,
      'Cache-Control': 'no-store',
    });
    res.end(content);
  } catch {
    sendJson(res, 404, { error: 'Archivo no encontrado' });
  }
}

const server = http.createServer(async (req, res) => {
  if (req.url.startsWith('/api/')) {
    await handleApi(req, res);
    return;
  }

  await handleStatic(req, res);
});

server.listen(PORT, HOST, () => {
  console.log(`Servidor listo en http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
});
