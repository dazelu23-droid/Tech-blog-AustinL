const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const DB_FILE = path.join(ROOT, 'data', 'db.json');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

function readDb() {
  return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
}

function writeDb(db) {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET,POST,PATCH,OPTIONS',
    'access-control-allow-headers': 'content-type'
  });
  res.end(body);
}

function sendError(res, status, message) {
  sendJson(res, status, { error: message });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 1_000_000) {
        req.destroy();
        const error = new Error('Request body too large'); error.status = 400; reject(error);
      }
    });
    req.on('end', () => {
      if (!body.trim()) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch {
        const error = new Error('Invalid JSON body'); error.status = 400; reject(error);
      }
    });
    req.on('error', reject);
  });
}

function publicFilePath(urlPath) {
  const requested = urlPath === '/' ? '/index.html' : decodeURIComponent(urlPath);
  const fullPath = path.normalize(path.join(PUBLIC_DIR, requested));
  if (!fullPath.startsWith(PUBLIC_DIR)) return null;
  return fullPath;
}

function serveStatic(req, res, url) {
  const filePath = publicFilePath(url.pathname);
  if (!filePath || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    const fallback = path.join(PUBLIC_DIR, 'index.html');
    if (fs.existsSync(fallback)) {
      res.writeHead(200, { 'content-type': MIME_TYPES['.html'] });
      fs.createReadStream(fallback).pipe(res);
      return;
    }
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Not found');
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  res.writeHead(200, { 'content-type': MIME_TYPES[ext] || 'application/octet-stream' });
  fs.createReadStream(filePath).pipe(res);
}

function enrichPost(post) {
  return {
    ...post,
    commentCount: Array.isArray(post.comments) ? post.comments.length : 0
  };
}

function listPosts(db, searchParams) {
  const q = (searchParams.get('q') || '').trim().toLowerCase();
  const tag = (searchParams.get('tag') || '').trim().toLowerCase();
  let posts = db.posts || [];

  if (tag) {
    posts = posts.filter(post => post.tags.some(t => t.toLowerCase() === tag));
  }

  if (q) {
    posts = posts.filter(post => {
      const haystack = [post.title, post.excerpt, post.author, ...(post.tags || [])].join(' ').toLowerCase();
      return haystack.includes(q);
    });
  }

  return posts.map(enrichPost);
}

function createPost(payload, profile) {
  const title = String(payload.title || '').trim();
  const rawBody = String(payload.body || '').trim();
  if (!title && !rawBody) return null;

  const body = Array.isArray(payload.body)
    ? payload.body.map(p => String(p).trim()).filter(Boolean)
    : rawBody.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
  const tags = Array.isArray(payload.tags)
    ? payload.tags.map(t => String(t).replace(/^#/, '').trim()).filter(Boolean)
    : String(payload.tags || '').split(',').map(t => t.replace(/^#/, '').trim()).filter(Boolean);
  const wordCount = body.join(' ').split(/\s+/).filter(Boolean).length;

  return {
    id: `u${Date.now()}`,
    title: title || 'Untitled',
    author: profile.name,
    authorHandle: profile.handle,
    date: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
    readTime: `${Math.max(1, Math.round(wordCount / 200))} min read`,
    tags,
    likes: 0,
    liked: false,
    excerpt: (body[0] || '').slice(0, 150),
    body: body.length ? body : ['(no content)'],
    comments: []
  };
}

async function handleApi(req, res, url) {
  if (req.method === 'OPTIONS') {
    sendJson(res, 204, {});
    return;
  }

  const db = readDb();
  const parts = url.pathname.split('/').filter(Boolean);

  if (req.method === 'GET' && url.pathname === '/api/health') {
    sendJson(res, 200, { ok: true, name: 'Build Stack Journal', timestamp: new Date().toISOString() });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/posts') {
    sendJson(res, 200, { posts: listPosts(db, url.searchParams) });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/posts') {
    const payload = await readBody(req);
    const post = createPost(payload, db.profile);
    if (!post) return sendError(res, 400, 'Post title or body is required');
    db.posts.unshift(post);
    writeDb(db);
    sendJson(res, 201, { post: enrichPost(post) });
    return;
  }

  if (parts[0] === 'api' && parts[1] === 'posts' && parts[2]) {
    const post = db.posts.find(item => item.id === parts[2]);
    if (!post) return sendError(res, 404, 'Post not found');

    if (req.method === 'GET' && parts.length === 3) {
      sendJson(res, 200, { post: enrichPost(post) });
      return;
    }

    if (req.method === 'PATCH' && parts[3] === 'like') {
      post.liked = !post.liked;
      post.likes += post.liked ? 1 : -1;
      writeDb(db);
      sendJson(res, 200, { post: enrichPost(post) });
      return;
    }

    if (req.method === 'POST' && parts[3] === 'comments') {
      const payload = await readBody(req);
      const text = String(payload.text || '').trim();
      if (!text) return sendError(res, 400, 'Comment text is required');
      const comment = {
        author: payload.author || db.profile.name,
        initials: String(payload.initials || db.profile.name.split(/\s+/).map(p => p[0]).join('').slice(0, 2)).toUpperCase(),
        time: 'just now',
        text
      };
      post.comments.push(comment);
      writeDb(db);
      sendJson(res, 201, { comment, post: enrichPost(post) });
      return;
    }
  }

  if (req.method === 'GET' && url.pathname === '/api/profile') {
    sendJson(res, 200, { profile: db.profile });
    return;
  }

  if (req.method === 'PATCH' && url.pathname === '/api/profile') {
    const payload = await readBody(req);
    db.profile = { ...db.profile, ...payload };
    writeDb(db);
    sendJson(res, 200, { profile: db.profile });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/portfolio') {
    sendJson(res, 200, { portfolio: db.portfolio || [] });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/friends') {
    sendJson(res, 200, { friends: db.friends || [] });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/ads') {
    sendJson(res, 200, { ads: db.ads || [] });
    return;
  }

  sendError(res, 404, 'API route not found');
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  try {
    if (url.pathname.startsWith('/api/')) {
      await handleApi(req, res, url);
      return;
    }

    serveStatic(req, res, url);
  } catch (error) {
    const status = error.status || 500;
    sendError(res, status, error.message || 'Server error');
  }
});

server.listen(PORT, () => {
  console.log(`Build Stack Journal running at http://localhost:${PORT}`);
});