CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  issue_id TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'queued',
  title TEXT NOT NULL,
  description TEXT,
  repo_full_name TEXT NOT NULL,
  branch_name TEXT,
  pr_url TEXT,
  specification_gap_reasons TEXT,
  validation_summary TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS task_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payload TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (task_id) REFERENCES tasks(id)
);

CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_task_events_task_id ON task_events(task_id);
