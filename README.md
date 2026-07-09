# Build Stack Journal

Root-level project for the engineering blog.

## Run

```powershell
node server.js
```

Open `http://localhost:3000`.

## API

- `GET /api/health`
- `GET /api/posts?q=&tag=`
- `GET /api/posts/:id`
- `POST /api/posts`
- `PATCH /api/posts/:id/like`
- `POST /api/posts/:id/comments`
- `GET /api/profile`
- `PATCH /api/profile`
- `GET /api/portfolio`
- `GET /api/friends`
- `GET /api/ads`

Data is stored in `data/db.json`.