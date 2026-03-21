import { loadConfig } from "./config";
import type { TaskRecord } from "./types";

function json(data: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(data, null, 2), {
    headers: {
      "content-type": "application/json; charset=utf-8",
    },
    ...init,
  });
}

function buildHealthcheck(env: Cloudflare.Env) {
  let repo: string | null = null;
  let configError: string | null = null;

  try {
    const config = loadConfig(env);
    repo = config.githubRepo;
  } catch (error) {
    configError =
      error instanceof Error ? error.message : "Unknown configuration error";
  }

  return {
    ok: true,
    service: "cloudflare-code-edge",
    repo,
    configError,
    bindings: {
      ai: Boolean(env.AI),
      db: Boolean(env.DB),
      taskQueue: Boolean(env.TASK_QUEUE),
    },
  };
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
      return json(
        {
          accepted: false,
          phase: "foundation",
          message: "Linear webhook handling will be implemented in Phase 2.",
        },
        { status: 501 },
      );
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
