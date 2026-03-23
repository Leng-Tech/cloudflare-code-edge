# Headless AI Agent for Linear - Implementation Plan

Note: the current v1 path no longer uses R2 for repository reads. Repository context now comes directly from GitHub via `@octokit/request`, and R2 is out of the critical path.

A Cloudflare Edge-deployed AI agent that receives Linear webhooks, analyzes tasks, plans implementation against the codebase, and autonomously creates GitHub PRs when requirements are clear.

---

## Architecture Overview

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Linear    │────▶│   Worker    │────▶│   Queues    │
│  Webhooks   │     │ (receiver)  │     │  (buffer)   │
└─────────────┘     └─────────────┘     └──────┬──────┘
                                                │
                    ┌──────────────────────────▼──────────────────────────┐
                    │              Workers (Consumer)                       │
                    │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  │
                    │  │  Workflow   │  │  Workers AI │  │    R2       │  │
                    │  │ Orchestrator│  │  (analysis) │  │ (codebase)  │  │
                    │  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘  │
                    │         │                  │                │         │
                    │         └──────────────────┴────────────────┘         │
                    │                    AI Agent                            │
                    └──────────────────────────┬───────────────────────────┘
                                               │
                    ┌──────────────────────────▼───────────────────────────┐
                    │                    GitHub API                        │
                    │            (branch, commit, PR creation)             │
                    └─────────────────────────────────────────────────────┘
```

---

## Specification Gap Detection Criteria

Tasks are flagged as having specification gaps if any of the following are true:

| # | Criterion | Description |
|---|-----------|-------------|
| 1 | `MISSING_INPUTS` | Required inputs, parameters, or user data requirements are not specified |
| 2 | `UNDEFINED_SCHEMA` | Data models, database schemas, or API request/response structures are not defined |
| 3 | `CONFLICTING_REQ` | Contradictory requirements or ambiguous statements in the task |
| 4 | `UNCLEAR_DEPS` | External APIs, services, or dependencies are not clearly specified |
| 5 | `ARCH_ASSUMPTIONS` | Implementation requires significant architectural decisions not guided by existing patterns |
| 6 | `UNSPECIFIED_CONSTRAINTS` | Performance, security, or scaling requirements are missing |

**If any criterion is true** → Ask clarifying questions on Linear, log decision, end workflow.
**If all criteria are false** → Proceed with autonomous implementation.

---

## Tech Stack

| Component | Technology |
|-----------|------------|
| Runtime | Cloudflare Workers |
| AI | Workers AI (built-in models) |
| Agent Framework | Agents SDK |
| Code Execution | Codemode (DynamicWorkerExecutor) |
| Task Queue | Cloudflare Queues |
| Codebase Storage | R2 Object Storage |
| Persistence | D1 SQLite |
| VCS | GitHub |

---

## Implementation Phases

### Phase 1: Project Setup

- [ ] Create Workers project: `npm create cloudflare@latest linear-agent`
- [ ] Install dependencies:
  ```bash
  npm install agents workers-ai-provider @cloudflare/workers-types
  ```
- [ ] Configure bindings in `wrangler.toml`:
  - Workers AI (`AI`)
  - Queues (`QUEUES`)
  - R2 (`CODEBASE_BUCKET`)
  - D1 (`DB`)
- [ ] Create R2 bucket for codebase storage
- [ ] Create D1 database for task tracking

### Phase 2: GitHub API Client

- [ ] Create `src/github/client.ts`
- [ ] Implement:
  - `createBranch(owner, repo, branch, sha)`
  - `commitFiles(owner, repo, branch, files, message)`
  - `createPullRequest(owner, repo, title, body, head, base)`
  - `getFile(owner, repo, path, ref)`

### Phase 3: Webhook Receiver

- [ ] Create `POST /webhook/linear` endpoint
- [ ] Validate Linear webhook signature (HMAC-SHA256)
- [ ] Filter for `action = "IssueDataPayloadTypeCreated"` only
- [ ] Extract: `id`, `title`, `description`, `priority`, `assignee`
- [ ] Publish to Queues: `{ taskId, title, description, timestamp }`

### Phase 4: Queue Consumer

- [ ] Create queue consumer handler
- [ ] Wire to Webhook Worker
- [ ] Handle retry logic for failed messages

### Phase 5: R2 Codebase Operations

- [ ] Create `src/storage/r2.ts`
- [ ] Implement:
  - `syncCodebase(owner, repo, ref)` - Clone and upload repo to R2
  - `searchFiles(pattern, fileTypes)` - Grep-style search
  - `getFile(path)` - Retrieve file content
  - `listFiles(prefix)` - List files under path

### Phase 6: D1 Schema & Operations

- [ ] Create migration `migrations/001_initial.sql`:

```sql
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT DEFAULT 'pending',
  has_specification_gaps INTEGER DEFAULT 0,
  specification_gap_reasons TEXT,
  plan TEXT,
  pr_url TEXT,
  created_at INTEGER DEFAULT (unixepoch()),
  updated_at INTEGER DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS task_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  details TEXT,
  timestamp INTEGER DEFAULT (unixepoch()),
  FOREIGN KEY (task_id) REFERENCES tasks(id)
);

CREATE INDEX idx_tasks_status ON tasks(status);
CREATE INDEX idx_task_events_task_id ON task_events(task_id);
```

- [ ] Create `src/storage/d1.ts`
- [ ] Implement:
  - `createTask(task)`
  - `updateTaskStatus(id, status, extras)`
  - `logEvent(taskId, eventType, details)`
  - `getTask(id)`

### Phase 7: Specification Gap Detection

- [ ] Create `src/agent/specification-gaps.ts`
- [ ] Implement evaluation function:

```typescript
interface SpecificationGapResult {
  hasSpecificationGaps: boolean;
  reasons: string[];
}

function evaluateSpecificationGaps(
  task: { title: string; description: string },
  codebaseContext: FileContext[]
): SpecificationGapResult;
```

- [ ] Apply all 6 criteria checks
- [ ] Return specific reasons for each flagged criterion

### Phase 8: Agent Tools Definition

- [ ] Create `src/agent/tools.ts`
- [ ] Define tools:

| Tool | Description |
|------|-------------|
| `queryCodebase` | Search codebase files in R2 |
| `getFile` | Read specific file content |
| `checkSpecificationGaps` | Evaluate whether the task has unclear requirements |
| `generateGoCode` | Generate Go code for implementation |
| `createBranch` | Create Git branch |
| `commitFiles` | Commit files to branch |
| `createPullRequest` | Create GitHub PR |
| `addLinearComment` | Comment on Linear issue |

### Phase 9: Main Agent Class

- [ ] Create `src/agent/index.ts`
- [ ] Extend `Agent` from Agents SDK
- [ ] Implement:
  - `onQueueMessage()` - Handle queue events
  - Tool handlers
  - State management

### Phase 10: Code Generation

- [ ] Create `src/agent/code-gen.ts`
- [ ] Implement Go code generation prompts
- [ ] Handle multi-file generation
- [ ] Validate generated code syntax

### Phase 11: Workflow Orchestration

- [ ] Create `src/workflow/task-processor.ts`
- [ ] Define Workflow steps:

```
Step 1: Parse & Structure Task
Step 2: Query Codebase (R2)
Step 3: Check Specification Gap Criteria
Step 4a: If Specification Gaps Exist → Post comment, end
Step 4b: If Clear → Generate Plan
Step 5: Generate Code
Step 6: Create Branch & Commit
Step 7: Create PR
Step 8: Update Linear status
Step 9: Log to D1
```

### Phase 12: Testing & Deployment

- [ ] Write unit tests for specification gap detection
- [ ] Write integration tests for GitHub client
- [ ] Test webhook with ngrok/dev tunnel
- [ ] Deploy to Cloudflare
- [ ] Configure Linear webhook URL

---

## Environment Variables (Secrets)

| Variable | Purpose |
|----------|---------|
| `LINEAR_WEBHOOK_SECRET` | Validate incoming webhooks |
| `GITHUB_TOKEN` | GitHub API authentication |
| `GITHUB_REPO` | Format: `owner/repo` |
| `LINEAR_API_KEY` | For posting comments |
| `R2_BUCKET_NAME` | Codebase storage bucket |

Set via:
```bash
npx wrangler secret put LINEAR_WEBHOOK_SECRET
npx wrangler secret put GITHUB_TOKEN
npx wrangler secret put LINEAR_API_KEY
```

---

## File Structure

```
linear-agent/
├── src/
│   ├── index.ts                 # Worker entry (webhook + queue consumer)
│   ├── agent/
│   │   ├── index.ts              # Main agent class
│   │   ├── tools.ts              # Tool definitions
│   │   ├── specification-gaps.ts # Specification gap detection logic
│   │   └── code-gen.ts          # Code generation prompt templates
│   ├── workflow/
│   │   └── task-processor.ts     # Workflow plugin definition
│   ├── github/
│   │   └── client.ts             # GitHub API wrapper
│   ├── linear/
│   │   ├── client.ts             # Linear API client
│   │   └── webhook.ts            # Webhook validation
│   ├── storage/
│   │   ├── r2.ts                 # R2 codebase operations
│   │   └── d1.ts                 # D1 task persistence
│   └── types.ts                  # TypeScript interfaces
├── migrations/
│   └── 001_initial.sql           # D1 schema
├── wrangler.toml
├── package.json
└── tsconfig.json
```

---

## Webhook Payload (Linear Issue Created)

```typescript
interface LinearWebhookPayload {
  action: "IssueDataPayloadTypeCreated";
  data: {
    id: string;
    title: string;
    description?: string;
    priority?: number;
    assigneeId?: string;
    state?: {
      id: string;
      name: string;
    };
    projectId?: string;
    createdAt: string;
  };
  organization: {
    id: string;
    slug: string;
  };
}
```

---

## PR Structure

- **Branch name**: `{linear_task_id}-implementation`
  - Example: `LINEAR-123-implementation`
  - This automatically links the Linear issue to the PR
- **PR body**: Standard template with task description
- **Labels**: `ai-generated` (optional)

---

## Execution Order

| Phase | Priority | Notes |
|-------|----------|-------|
| 1. Project Setup | 1 | Foundation |
| 2. GitHub API Client | 1 | Needed for testing |
| 3. Webhook Receiver | 2 | Test with curl first |
| 4. Queue Consumer | 2 | Wire to webhook |
| 5. R2 Storage | 3 | Can manual-upload initially |
| 6. D1 Schema | 2 | Observability |
| 7. Specification Gap Detection | 2 | Core logic |
| 8. Agent Tools | 3 | Tool definitions |
| 9. Code Generation | 3 | Most complex |
| 10. Workflow Orchestration | 3 | Integration |
| 11. PR Creation | 3 | Final step |
| 12. Testing | 4 | Before production |

---

## Next Steps

1. [ ] Confirm project setup command
2. [ ] Run Phase 1 to scaffold project
3. [ ] Proceed with GitHub client implementation
