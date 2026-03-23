import type { QueuedTaskPersistenceInput } from "../types.js";

export async function persistQueuedTask(
  db: D1Database,
  input: QueuedTaskPersistenceInput,
): Promise<void> {
  await db.batch([
    db
      .prepare(
        `INSERT INTO tasks (
          id,
          issue_id,
          status,
          title,
          description,
          repo_full_name,
          created_at,
          updated_at
        )
        VALUES (?, ?, 'queued', ?, ?, ?, ?, ?)
        ON CONFLICT(issue_id) DO UPDATE SET
          title = excluded.title,
          description = excluded.description,
          repo_full_name = excluded.repo_full_name,
          status = 'queued',
          updated_at = excluded.updated_at`,
      )
      .bind(
        input.taskId,
        input.issueId,
        input.title,
        input.description ?? null,
        input.repoFullName,
        input.createdAt,
        input.createdAt,
      ),
    db
      .prepare(
        `INSERT INTO task_events (
          task_id,
          event_type,
          payload,
          created_at
        )
        VALUES (?, ?, ?, ?)`,
      )
      .bind(
        input.taskId,
        input.eventType,
        input.eventPayload,
        input.createdAt,
      ),
  ]);
}
