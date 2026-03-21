# cloudflare-code-edge

Phase 1 foundation for a TypeScript Cloudflare Worker that ingests Linear issues and eventually opens Go PRs on GitHub.

## Included in Phase 1

- Cloudflare Worker TypeScript skeleton
- `wrangler.toml` with Workers AI, Queue, and D1 bindings
- Environment secret contract for Linear and GitHub
- Initial D1 schema for `tasks` and `task_events`
- Shared TypeScript types for webhooks, tasks, specification gaps, generated changes, and validation summaries

## Local setup

1. Install Node.js 20+ and npm.
2. Install dependencies:

   ```bash
   npm install
   ```

3. Create Cloudflare resources and update `wrangler.toml`:
   - replace `database_id`
   - rename the queue if needed
4. Copy `.dev.vars.example` to `.dev.vars` and fill in real values.
5. Create the D1 database and apply the migration:

   ```bash
   npx wrangler d1 migrations apply cloudflare-code-edge-db
   ```

6. Start local development:

   ```bash
   npm run dev
   ```

## Required secrets

- `LINEAR_WEBHOOK_SECRET`
- `LINEAR_API_KEY`
- `GITHUB_TOKEN`
- `GITHUB_REPO`
