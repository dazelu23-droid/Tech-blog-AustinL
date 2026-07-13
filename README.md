# Build Stack Journal

An engineering blog — write posts with rich text, images, video, and audio; organize by
engineering discipline; and persist everything to a real database. Runs locally on Node,
and deploys to Cloudflare Workers + D1 for a public, free-tier-hosted site.

🌐 **Live site:** <https://build-stack-journal.dazelu.workers.dev/>

---

## Features

- **Rich post composer** — title, tags, formatting toolbar (bold/italic/headings/quotes/lists/links/colors), and separate media fields for images, video, and audio.
- **Dedicated blog banner** — each post has its own banner slot (image *or* video), independent of the media embedded in the body. Auto-detects video by URL and renders it as a looping banner.
- **Persistent posts** — published posts are saved server-side (D1 in production, `data/db.json` locally) and reload on every visit. They stay until you take them down.
- **Take down (delete)** — the author of a post can remove it from the detail view, with a confirm prompt.
- **3-column home feed** — the blog index is a responsive card grid (widened container) instead of a single column.
- **Search & tags** — full-text search plus tag and discipline filters. Clicking **home** resets the search bar and any active tag filter.
- **Engagement** — like posts and leave comments.
- **Profile, portfolio, friends, ads** — supporting sections rendered from the data store.
- **Client-side auth** — register and sign in; accounts are stored in the browser's `localStorage`. No server-side passwords.
- **Theming** — dark theme with a toggle.

---

## Tech stack

| Layer | Local dev | Production |
|---|---|---|
| Frontend | Vanilla JS SPA, custom templating engine (`public/support.js`) | Same static assets, served by the Worker |
| Backend | `server.js` — dependency-free Node `http` server | `worker.js` — Cloudflare Worker |
| Storage | `data/db.json` (JSON file) | Cloudflare D1 (SQLite), `kv` table |
| Host | `localhost:3000` | `*.workers.dev` (free tier) |

The frontend is identical in both environments — it talks to the same `/api/*` routes via relative URLs.

---

## Project structure

```
public/
  index.html        # main app (templates + component logic)
  print.html        # print-styled variant
  support.js        # DCLogic templating/runtime
server.js           # local Node backend (http + fs + db.json)
worker.js           # Cloudflare Worker entry (assets + /api/* + D1)
wrangler.jsonc      # Worker config: name, assets, D1 binding
schema.sql          # D1 schema (idempotent CREATE TABLE)
seed.sql            # D1 seed (generated from data/db.json)
data/db.json        # local data store + source for seeding
package.json        # scripts: start, dev, deploy, db:seed
```

---

## Local development

Requirements: Node.js.

```bash
npm install      # only needed for the deploy tooling; the server itself has no deps
npm start        # or: node server.js
```

Open <http://localhost:3000>. Posts you publish are written to `data/db.json`.

---

## Production deployment (Cloudflare Workers + D1)

The site runs as a single Worker named `build-stack-journal`. Static files in `public/`
are served via the Workers Static Assets binding, and `/api/*` requests are handled by
`worker.js` against a D1 database (`blog-db`) that stores each data section as one JSON
row in a `kv` table — preserving the exact shape the Node server uses.

### One-time setup (already done for this project)

```bash
npx wrangler login                      # browser OAuth
npx wrangler d1 create blog-db          # prints a database_id (already in wrangler.jsonc)
npx wrangler d1 execute blog-db --remote --file=schema.sql -y
npx wrangler d1 execute blog-db --remote --file=seed.sql   -y
npx wrangler deploy
```

### Day-to-day

```bash
npm run deploy     # wrangler deploy — bundles and goes live in seconds
npm run db:seed    # re-apply seed.sql to D1 (idempotent upserts)
npx wrangler tail build-stack-journal   # stream live logs while testing
```

> Deploying to your own Cloudflare account? Run `npx wrangler login`, then either reuse
> this project's D1 (the `database_id` in `wrangler.jsonc`) or create your own with
> `wrangler d1 create` and update the id. The `database_id` is not secret, but it is
> account-specific.

---

## API

All routes are prefixed `/api` and return JSON.

| Method | Route | Description |
|---|---|---|
| `GET` | `/api/health` | Liveness check |
| `GET` | `/api/posts` | List posts; supports `?q=` (search) and `?tag=` |
| `POST` | `/api/posts` | Create a post (`title`, `body`, `bodyHtml`, `banner`, `images`, `videos`, `audios`, `tags`, `author`, `authorHandle`) |
| `GET` | `/api/posts/:id` | Fetch one post |
| `DELETE` | `/api/posts/:id` | Remove a post |
| `PATCH` | `/api/posts/:id/like` | Toggle like |
| `POST` | `/api/posts/:id/comments` | Add a comment (`text`, optional `author`/`initials`) |
| `GET` | `/api/profile` | Get the site profile |
| `PATCH` | `/api/profile` | Update the profile |
| `GET` | `/api/portfolio` | List portfolio projects |
| `GET` | `/api/friends` | List friends |
| `GET` | `/api/ads` | List ads |

### Example

```bash
# Create a post on the live site
curl -X POST https://build-stack-journal.dazelu.workers.dev/api/posts \
  -H "content-type: application/json" \
  -d '{"title":"Hello world","body":"First post from the API.","tags":"test","author":"Alex Rivera","authorHandle":"alex"}'
```

---

## Data model

A post looks like:

```jsonc
{
  "id": "u1689000000000",          // u + timestamp for user-created posts
  "title": "…", "author": "…", "authorHandle": "…",
  "date": "Jul 13, 2026", "readTime": "3 min read",
  "tags": ["…"],
  "banner": "https://…/banner.jpg", // dedicated banner (image or video URL)
  "coverImage": "…",                // derived from banner (image) or null
  "coverVideo": null,               // derived from banner (video) or null
  "images": [], "videos": [], "audios": [],   // body media
  "body": ["paragraph", "…"], "bodyHtml": "…",
  "excerpt": "…", "likes": 0, "liked": false,
  "comments": [{ "author": "…", "initials": "…", "time": "…", "text": "…" }]
}
```

The `profile`, `portfolio`, `friends`, and `ads` sections are stored alongside `posts`.

---

## Notes & limits

- **Two data stores.** Local dev uses `data/db.json`; production uses D1. They do not sync — content published on the live site lives in D1, not in `db.json`.
- **Auth is client-side.** Accounts live in the browser's `localStorage` (per-browser, not shared with the server or other browsers). Register an account to sign in.
- **Free-tier quotas** are account-wide: ~100k requests/day and ~5M D1 reads/day. Fine for a personal or course blog.
- **One name = one Worker.** Deploying with the name `build-stack-journal` replaces that Worker. Pick a fresh name in `wrangler.jsonc` for a separate deployment.

---

## License

MIT
