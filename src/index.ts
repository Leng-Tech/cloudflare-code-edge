import {
  getMissingConfigKeys,
  loadConfig,
  loadWebhookIntakeConfig,
} from "./config.js";
import {
  getLinearLabels,
  isAiReadyIssue,
  isLinearIssuePayload,
  LINEAR_SIGNATURE_HEADER,
  verifyLinearWebhookSignature,
} from "./linear/webhook.js";
import { persistQueuedTask } from "./storage/d1.js";
import type { TaskRecord } from "./types.js";

function json(data: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(data, null, 2), {
    headers: {
      "content-type": "application/json; charset=utf-8",
    },
    ...init,
  });
}

function buildHealthcheck(env: Cloudflare.Env) {
  const missingConfigKeys = getMissingConfigKeys(env);
  let repo: string | null = null;
  let baseBranch: string | null = null;
  let configError: string | null = null;

  try {
    const config = loadConfig(env);
    repo = config.githubRepo.fullName;
    baseBranch = config.githubBaseBranch;
  } catch (error) {
    configError =
      error instanceof Error ? error.message : "Unknown configuration error";
  }

  return {
    ok: true,
    service: "cloudflare-code-edge",
    repo,
    baseBranch,
    configError,
    missingConfigKeys,
    bindings: {
      ai: Boolean(env.AI),
      db: Boolean(env.DB),
      taskQueue: Boolean(env.TASK_QUEUE),
    },
  };
}

function badRequest(message: string, status = 400): Response {
  return json({ error: message }, { status });
}

async function listTasks(env: Cloudflare.Env): Promise<TaskRecord[]> {
  const statement = env.DB.prepare(
    `SELECT id, issue_id, status, title, repo_full_name, created_at, updated_at
     FROM tasks
     ORDER BY created_at DESC
     LIMIT 20`,
  );

  const result = await statement.all<TaskRecord>();
  return result.results ?? [];
}

async function handleLinearWebhook(
  request: Request,
  env: Cloudflare.Env,
): Promise<Response> {
  const { githubRepo, linearWebhookSecret } = loadWebhookIntakeConfig(env);
  const rawBody = await request.text();

  let parsedBody: unknown;

  try {
    parsedBody = JSON.parse(rawBody);
  } catch {
    return badRequest("Invalid JSON payload.");
  }

  const payload = isLinearIssuePayload(parsedBody) ? parsedBody : null;
  const isValidSignature = await verifyLinearWebhookSignature(
    rawBody,
    request.headers.get(LINEAR_SIGNATURE_HEADER),
    linearWebhookSecret,
    {
      webhookTimestamp: payload?.webhookTimestamp,
    },
  );

  if (!isValidSignature) {
    return badRequest("Invalid or expired Linear webhook signature.", 401);
  }

  if (!payload) {
    return json({
      accepted: false,
      ignored: true,
      reason: "unsupported_payload",
    });
  }

  if (!isAiReadyIssue(payload)) {
    return json({
      accepted: false,
      ignored: true,
      reason: "missing_ai_ready_label",
      issueId: payload.data.id,
      labels: getLinearLabels(payload).map((label) => label.name),
    });
  }

  const nowMs = Date.now();
  const createdAt = Math.floor(nowMs / 1000);
  const queuedAt = new Date(nowMs).toISOString();
  const taskId = payload.data.id;
  const queueMessage: TaskQueueMessage = {
    taskId,
    issueId: payload.data.id,
    queuedAt,
  };

  await persistQueuedTask(env.DB, {
    taskId,
    issueId: payload.data.id,
    title: payload.data.title,
    description: payload.data.description ?? null,
    repoFullName: githubRepo.fullName,
    createdAt,
    eventType: "task.queued",
    eventPayload: JSON.stringify({
      action: payload.action,
      labels: getLinearLabels(payload).map((label) => label.name),
      queuedAt,
      organizationId: payload.organization?.id ?? null,
      issueIdentifier: payload.data.identifier ?? null,
    }),
  });

  await env.TASK_QUEUE.send(queueMessage);

  return json({
    accepted: true,
    queued: true,
    taskId,
    issueId: payload.data.id,
    issueIdentifier: payload.data.identifier ?? null,
    queueMessage,
  });
}

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/health") {
      return json(buildHealthcheck(env));
    }

    if (request.method === "GET" && url.pathname === "/tasks") {
      const tasks = await listTasks(env);
      return json({ tasks });
    }

    if (request.method === "POST" && url.pathname === "/webhook/linear") {
      return handleLinearWebhook(request, env);
    }

    return json(
      {
        error: "Not found",
        path: url.pathname,
      },
      { status: 404 },
    );
  },

  async queue(): Promise<void> {
    // Queue processing starts in Phase 2 once webhook intake is wired up.
  },
} satisfies ExportedHandler<Cloudflare.Env, TaskQueueMessage>;
