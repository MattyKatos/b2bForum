# b2b Forum (KISS/DRY)

Simple forum stack:
- Node.js + Express + EJS
- MySQL (Docker)
- Discord OAuth (Passport)
- Light/Dark theme
- Basic sanitization with `sanitize-html`

## Quickstart

1. Create your `.env` from example and fill Discord credentials:

```bash
cp .env.example .env
# edit .env
```

2. Start via Docker:

```bash
docker compose up --build
```

App: http://localhost:3000
DB:  localhost:3306

3. Develop locally (optional):

```bash
npm install
npm run dev
```

> Ensure MySQL is running and env DB_* values match.

## Schema
See `sql/schema.sql`.

## Notes on security
- CSRF protection is enabled except on OAuth callback routes.
- Sessions are stored in MySQL.
- Inputs rendered on pages are sanitized server-side. Use parameterized queries.

## Next steps
- Topic pages and posting UI
- Followers/following views
- Permissions by `user_level` and `user_topic_level`
