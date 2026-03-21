declare namespace Cloudflare {
  interface Env {
    AI: Ai;
    DB: D1Database;
    TASK_QUEUE: Queue<TaskQueueMessage>;
    LINEAR_WEBHOOK_SECRET: string;
    LINEAR_API_KEY: string;
    GITHUB_TOKEN: string;
    GITHUB_REPO: string;
  }
}

interface TaskQueueMessage {
  taskId: string;
  issueId: string;
  queuedAt: string;
}
