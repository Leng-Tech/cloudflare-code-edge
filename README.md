# cloudflare-code-edge

Phase 3 foundation for a TypeScript Cloudflare Worker that ingests Linear issues and uses GitHub as the v1 source of truth for reading and writing Go repositories.

## Included so far

- Cloudflare Worker TypeScript skeleton
- `wrangler.toml` with Workers AI, Queue, and D1 bindings
- Cloudflare Worker secret contract for Linear and GitHub credentials
- Initial D1 schema for `tasks` and `task_events`
- Shared TypeScript types for webhooks, tasks, specification gaps, generated changes, and validation summaries
- `POST /webhook/linear` with HMAC-SHA256 signature validation
- `ai-ready` label gating for accepted Linear issues
- D1 task and task-event persistence for queued work
- Queue publishing for accepted work items
- GitHub repo parsing with `develop` as the default base branch
- `@octokit/request`-backed GitHub primitives for tree listing, file reads, branch creation, commits, and PR opening
- Bounded repo-context discovery for relevant Go files without requiring a full repository sync

## Local setup

1. Install Node.js 20+ and npm.
2. Install dependencies:

   ```bash
   npm install
   ```

3. Create Cloudflare resources and update `wrangler.toml`:
   - replace `database_id`
   - rename the queue if needed
4. Set Cloudflare-managed secrets for each deployed environment:

   ```bash
   npx wrangler secret put LINEAR_WEBHOOK_SECRET --env staging
   npx wrangler secret put LINEAR_API_KEY --env staging
   npx wrangler secret put GITHUB_TOKEN --env staging

   npx wrangler secret put LINEAR_WEBHOOK_SECRET --env production
   npx wrangler secret put LINEAR_API_KEY --env production
   npx wrangler secret put GITHUB_TOKEN --env production
   ```

5. Set the non-secret GitHub repo target in `wrangler.toml`:
   - `[env.staging.vars].GITHUB_REPO`
   - `[env.production.vars].GITHUB_REPO`
   - keep the D1, Queue, and AI bindings declared inside each named environment as well as the top level, because named Wrangler environments do not inherit those bindings
6. For local development, use `.dev.vars` files only:
   - copy `.dev.vars.example` to `.dev.vars` for default local runs
   - copy `.dev.vars.staging.example` to `.dev.vars.staging` for `wrangler dev --env staging`
   - copy `.dev.vars.production.example` to `.dev.vars.production` for `wrangler dev --env production`
   - keep each file self-contained with all four keys:
     - `LINEAR_WEBHOOK_SECRET`
     - `LINEAR_API_KEY`
     - `GITHUB_TOKEN`
     - `GITHUB_REPO`
   - do not rely on `.env`; this repo standardizes on `.dev.vars`
7. Create the D1 database and apply the migration:

   ```bash
   npx wrangler d1 migrations apply cloudflare-code-edge-db --env staging
   npx wrangler d1 migrations apply cloudflare-code-edge-db --env production
   ```

   For local development, apply migrations against the local database for the environment you are running:

   ```bash
   npx wrangler d1 migrations apply cloudflare-code-edge-db --local
   npx wrangler d1 migrations apply cloudflare-code-edge-db --env staging --local
   npx wrangler d1 migrations apply cloudflare-code-edge-db --env production --local
   ```

8. Start local development:

   ```bash
   npm run dev
   ```

   Or run a specific environment:

   ```bash
   npx wrangler dev --env staging
   npx wrangler dev --env production
   ```

9. Deploy with an explicit environment:

   ```bash
   npx wrangler deploy --env staging
   npx wrangler deploy --env production
   ```

10. Run checks and tests:

   ```bash
   npm run check
   npm test
   ```

## Configuration Model

Cloudflare Worker secrets:

- `LINEAR_WEBHOOK_SECRET`
- `LINEAR_API_KEY`
- `GITHUB_TOKEN`

Environment-specific non-secret vars:

- `GITHUB_REPO`

Notes:

- Do not store secrets in `wrangler.toml`.
- Do not use `.env` for this repo's local workflow.
- If both `.dev.vars` and `.env` exist, Wrangler ignores `.env` during local development.
- Named Wrangler environments do not inherit bindings like D1, Queues, AI, or `vars`, so each named environment must declare them explicitly.
- R2 is not part of the v1 critical path. Repository context is read directly from GitHub.
