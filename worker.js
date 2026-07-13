// Cloudflare Workers entry for Build Stack Journal.
// Static frontend is served from ./public via the ASSETS binding; /api/* is
// handled here against a D1 database that stores each JSON section in a
// key/value table. This mirrors server.js, swapping fs/JSON-file I/O for D1.

const DB_KEYS = ['profile', 'posts', 'portfolio', 'friends', 'ads'];
const DEFAULT_PROFILE = {
  name: 'Alex Rivera', handle: 'alex', email: 'alex@buildstack.dev',
  avatarUrl: 'https://i.pravatar.cc/160?img=12',
  bio: 'Backend engineer. I write about systems, databases, and the occasional system design detour.'
};

async function readDb(env) {
  const placeholders = DB_KEYS.map(() => '?').join(',');
  const { results } = await env.DB.prepare(
    `SELECT key, value FROM kv WHERE key IN (${placeholders})`
  ).bind(...DB_KEYS).all();
  const db = { posts: [], portfolio: [], friends: [], ads: [], profile: null };
  for (const row of results) {
    try { db[row.key] = JSON.parse(row.value); } catch { /* ignore corrupt row */ }
  }
  if (!db.profile) db.profile = { ...DEFAULT_PROFILE };
  return db;
}

async function writeSection(env, key, value) {
  await env.DB.prepare(
    `INSERT INTO kv (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).bind(key, JSON.stringify(value)).run();
}

function sendJson(status, payload) {
  return new Response(JSON.stringify(payload, null, 2), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS',
      'access-control-allow-headers': 'content-type'
    }
  });
}
function sendError(status, message) { return sendJson(status, { error: message }); }

async function readBody(request) {
  try { return await request.json(); } catch { return {}; }
}

function enrichPost(post) {
  return { ...post, commentCount: Array.isArray(post.comments) ? post.comments.length : 0 };
}

function listPosts(db, searchParams) {
  const q = (searchParams.get('q') || '').trim().toLowerCase();
  const tag = (searchParams.get('tag') || '').trim().toLowerCase();
  let posts = db.posts || [];
  if (tag) posts = posts.filter(p => p.tags.some(t => t.toLowerCase() === tag));
  if (q) posts = posts.filter(p => {
    const haystack = [p.title, p.excerpt, p.author, ...(p.tags || [])].join(' ').toLowerCase();
    return haystack.includes(q);
  });
  return posts.map(enrichPost);
}

function normalizeMediaList(value) {
  if (Array.isArray(value)) return value.map(i => String(i).trim()).filter(Boolean);
  return String(value || '').split(/\n+/).map(i => i.trim()).filter(Boolean);
}
function isVideoUrl(url) {
  return /\.(mp4|webm|ogg|mov|m4v)(\?|#|$)/i.test(String(url || ''));
}

function createPost(payload, profile) {
  const title = String(payload.title || '').trim();
  const rawBody = String(payload.body || '').trim();
  const body = Array.isArray(payload.body)
    ? payload.body.map(p => String(p).trim()).filter(Boolean)
    : rawBody.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
  const tags = Array.isArray(payload.tags)
    ? payload.tags.map(t => String(t).replace(/^#/, '').trim()).filter(Boolean)
    : String(payload.tags || '').split(',').map(t => t.replace(/^#/, '').trim()).filter(Boolean);
  const images = normalizeMediaList(payload.images);
  const videos = normalizeMediaList(payload.videos);
  const audios = normalizeMediaList(payload.audios);
  const banner = String(payload.banner || '').trim();
  const bodyHtml = String(payload.bodyHtml || '').trim();
  const author = String(payload.author || '').trim() || profile.name;
  const authorHandle = String(payload.authorHandle || '').trim() || profile.handle;
  if (!title && !rawBody && !images.length && !videos.length && !audios.length && !banner && !bodyHtml) return null;
  const fallbackTitle = images.length ? 'Photo post' : videos.length ? 'Video post' : audios.length ? 'Audio post' : 'Untitled post';
  const wordCount = body.join(' ').split(/\s+/).filter(Boolean).length;

  return {
    id: `u${Date.now()}`,
    title: title || fallbackTitle,
    author, authorHandle,
    date: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
    readTime: String(payload.readTime || '').trim() || `${Math.max(1, Math.round(wordCount / 200))} min read`,
    tags,
    banner,
    coverImage: banner && !isVideoUrl(banner) ? banner : null,
    coverVideo: banner && isVideoUrl(banner) ? banner : null,
    images, videos, audios,
    likes: 0, liked: false,
    excerpt: String(payload.excerpt || '').trim() || (body[0] || '').slice(0, 150),
    body: body.length ? body : ['(no content)'],
    bodyHtml,
    comments: []
  };
}

async function handleApi(request, env, url) {
  if (request.method === 'OPTIONS') return sendJson(204, {});

  const db = await readDb(env);
  const parts = url.pathname.split('/').filter(Boolean);

  if (request.method === 'GET' && url.pathname === '/api/health') {
    return sendJson(200, { ok: true, name: 'Build Stack Journal', timestamp: new Date().toISOString() });
  }

  if (request.method === 'GET' && url.pathname === '/api/posts') {
    return sendJson(200, { posts: listPosts(db, url.searchParams) });
  }

  if (request.method === 'POST' && url.pathname === '/api/posts') {
    const payload = await readBody(request);
    const post = createPost(payload, db.profile);
    if (!post) return sendError(400, 'Post title, body, or media is required');
    db.posts.unshift(post);
    await writeSection(env, 'posts', db.posts);
    return sendJson(201, { post: enrichPost(post) });
  }

  if (parts[0] === 'api' && parts[1] === 'posts' && parts[2]) {
    const post = db.posts.find(p => p.id === parts[2]);
    if (!post) return sendError(404, 'Post not found');

    if (request.method === 'DELETE' && parts.length === 3) {
      db.posts = db.posts.filter(p => p.id !== parts[2]);
      await writeSection(env, 'posts', db.posts);
      return sendJson(200, { ok: true, id: parts[2] });
    }
    if (request.method === 'GET' && parts.length === 3) {
      return sendJson(200, { post: enrichPost(post) });
    }
    if (request.method === 'PATCH' && parts[3] === 'like') {
      post.liked = !post.liked;
      post.likes += post.liked ? 1 : -1;
      await writeSection(env, 'posts', db.posts);
      return sendJson(200, { post: enrichPost(post) });
    }
    if (request.method === 'POST' && parts[3] === 'comments') {
      const payload = await readBody(request);
      const text = String(payload.text || '').trim();
      if (!text) return sendError(400, 'Comment text is required');
      const comment = {
        author: payload.author || db.profile.name,
        initials: String(payload.initials || db.profile.name.split(/\s+/).map(p => p[0]).join('').slice(0, 2)).toUpperCase(),
        time: 'just now', text
      };
      post.comments.push(comment);
      await writeSection(env, 'posts', db.posts);
      return sendJson(201, { comment, post: enrichPost(post) });
    }
  }

  if (request.method === 'GET' && url.pathname === '/api/profile') {
    return sendJson(200, { profile: db.profile });
  }
  if (request.method === 'PATCH' && url.pathname === '/api/profile') {
    const payload = await readBody(request);
    db.profile = { ...db.profile, ...payload };
    await writeSection(env, 'profile', db.profile);
    return sendJson(200, { profile: db.profile });
  }
  if (request.method === 'GET' && url.pathname === '/api/portfolio') {
    return sendJson(200, { portfolio: db.portfolio || [] });
  }
  if (request.method === 'GET' && url.pathname === '/api/friends') {
    return sendJson(200, { friends: db.friends || [] });
  }
  if (request.method === 'GET' && url.pathname === '/api/ads') {
    return sendJson(200, { ads: db.ads || [] });
  }

  return sendError(404, 'API route not found');
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      if (url.pathname.startsWith('/api/')) {
        return await handleApi(request, env, url);
      }
      // Everything else → static assets (with SPA fallback to index.html).
      return env.ASSETS.fetch(request);
    } catch (error) {
      const status = error.status || 500;
      return sendError(status, error.message || 'Server error');
    }
  }
};
