# Cloudflare Linear-to-Go PR Agent Plan

## Summary

Build a TypeScript Cloudflare Workers service that watches Linear issues, activates only for issues labeled `ai-ready`, analyzes a target Go repository through GitHub, detects specification gaps in the requirements, and either asks clarifying questions on Linear or generates Go changes, validates them with `gofmt` plus targeted checks, and opens a PR from `{task_id}` into `develop`.

---

## Phase 1: Foundation and Project Skeleton

### Goal

Establish the Cloudflare Worker project, bindings, configuration, and persistence model needed for the workflow.

### Deliverables

- Scaffold the Worker project in TypeScript.
- Configure bindings for:
  - Workers AI
  - Cloudflare Queues
  - D1
- Configure environment secrets for:
  - `LINEAR_WEBHOOK_SECRET`
  - `LINEAR_API_KEY`
  - `GITHUB_TOKEN`
  - `GITHUB_REPO`
- Add D1 schema for `tasks` and `task_events`.
- Define core TypeScript types for:
  - Linear webhook payloads
  - task state
  - specification-gap results
  - generated change sets
  - validation summaries

### Milestone

`M1`: A deployable Worker skeleton exists with config, secrets contract, and D1 schema ready for use.

---

## Phase 2: Webhook Intake and Task Gating

### Goal

Receive Linear webhooks safely and create tasks only for issues explicitly approved for autonomous work.

### Deliverables

- Implement `POST /webhook/linear`.
- Validate webhook signatures with HMAC-SHA256.
- Parse issue payload and label state.
- Accept only issues carrying the `ai-ready` label.
- Ignore non-matching issues without error.
- Publish accepted work items to Cloudflare Queues.
- Record initial task and event rows in D1.

### Milestone

`M2`: A valid `ai-ready` Linear issue produces a queued task and a persisted task record; unlabeled issues are ignored.

---

## Phase 3: GitHub-Backed Repository Context

### Goal

Use GitHub as the source of truth for reading and writing the target Go repository.

### Deliverables

- Implement GitHub client functions for:
  - listing files for a ref
  - fetching file contents
  - creating branches
  - committing file changes
  - opening pull requests
- Build repo-context utilities that:
  - identify likely relevant Go packages/files,
  - fetch bounded file context on demand,
  - avoid requiring full repository sync.
- Remove R2 from the v1 critical path.
- Default base branch to `develop`.

### Milestone

`M3`: The agent can inspect relevant Go files from GitHub and has the primitives needed to branch, commit, and open PRs.

---

## Phase 4: Specification Gap Detection and Linear Feedback

### Goal

Prevent unsafe autonomous code generation when the issue or codebase context is ambiguous.

### Deliverables

- Implement the six specification-gap checks against:
  - the Linear issue content,
  - the discovered Go codebase context.
- Treat these as blockers when unresolved:
  - missing package placement,
  - missing schema/API contract,
  - unclear env/config dependencies,
  - unclear integration point,
  - conflicting requirements,
  - missing operational constraints that materially affect the implementation.
- Generate a concise Linear comment with targeted clarification questions when blocked.
- Stop the workflow before branch creation if any blocker is found.
- Log the result to D1.

### Milestone

`M4`: Clear issues proceed; ambiguous issues produce actionable Linear questions and terminate safely.

---

## Phase 5: Go Change Generation and Validation

### Goal

Generate implementable Go repo changes in a structured format and apply bounded validation.

### Deliverables

- Define `generateGoPatch(task, repoContext)` to return:
  - files to create/update,
  - replacement contents,
  - PR summary,
  - impacted package hints for validation.
- Format all changed `.go` files with `gofmt`.
- Run targeted validation in this order:
  - package-level tests for changed packages if available,
  - otherwise package-level build checks,
  - otherwise skip and mark validation as limited.
- Capture validation results in D1 and PR metadata.
- Do not require full-repo validation in v1.

### Milestone

`M5`: The agent can produce formatted Go changes plus a clear validation summary suitable for a PR.

---

## Phase 6: Branching, PR Creation, and Workflow Orchestration

### Goal

Connect the end-to-end path from queued task to GitHub PR and final Linear notification.

### Deliverables

- Implement queue consumer orchestration:
  - load task,
  - gather repo context,
  - run specification-gap detection,
  - generate change set,
  - validate,
  - create branch `{task_id}`,
  - commit changes,
  - open PR against `develop`,
  - comment back to Linear with the PR link.
- Ensure PR body includes:
  - Linear issue reference,
  - summary of changes,
  - validation result,
  - AI-generated notice.
- Log major workflow transitions in `task_events`.

### Milestone

`M6`: A clear `ai-ready` issue can flow from Linear webhook to an open GitHub PR and final Linear comment.

---

## Phase 7: Test Coverage and Release Readiness

### Goal

Prove the workflow is safe enough to use on real issues.

### Deliverables

- Add tests for:
  - webhook signature validation,
  - `ai-ready` label gating,
  - D1 task/event persistence,
  - specification-gap detection outcomes,
  - GitHub branch/commit/PR behavior,
  - validation decision logic,
  - end-to-end blocked vs PR-created paths.
- Confirm failure handling and retry behavior for queue processing.
- Add observability for task status and workflow failures.

### Milestone

`M7`: The v1 workflow is test-backed, observable, and ready for initial deployment.

---

## Public Interfaces and Defaults

- Trigger label: `ai-ready`
- PR base branch: `develop`
- Work branch naming: `{task_id}`
- Linear comment policy:
  - comment on blockers,
  - comment with final PR link,
  - no progress spam in v1.
- Repository source of truth: GitHub only in v1
- Target repositories: Go codebases
- Orchestrator runtime: TypeScript on Cloudflare Workers

---

## Acceptance Scenarios

- A valid labeled issue is queued, analyzed, and turned into a PR against `develop`.
- A valid unlabeled issue is ignored.
- An invalid-signature webhook is rejected.
- An ambiguous issue yields clarification questions and no branch/PR.
- A change touching Go files is formatted with `gofmt`.
- Validation status is attached to the task record and PR description.
- If targeted validation cannot be safely determined, the PR still opens and explicitly states validation was limited.

---

## Assumptions

- The target repository is hosted on GitHub and accessible via token-authenticated API calls.
- The label state needed to detect `ai-ready` is available from the Linear webhook or retrievable through Linear API lookup if necessary.
- `develop` exists in the target repository.
- The first version optimizes for safe autonomy over maximum throughput.
