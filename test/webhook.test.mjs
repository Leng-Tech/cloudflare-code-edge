import test from "node:test";
import assert from "node:assert/strict";

import worker from "../dist-test/index.js";
import { persistQueuedTask } from "../dist-test/storage/d1.js";

class FakeQueue {
  constructor() {
    this.messages = [];
  }

  async send(message) {
    this.messages.push(message);
  }
}

class FakeDB {
  constructor() {
    this.batchCalls = [];
    this.queryResults = [];
  }

  prepare(sql) {
    const normalizedSql = sql.replace(/\s+/g, " ").trim();
    const database = this;

    return {
      async all() {
        return { results: database.queryResults };
      },
      bind(...args) {
        return {
          args,
          sql: normalizedSql,
          async run() {
            return { success: true };
          },
        };
      },
    };
  }

  async batch(statements) {
    this.batchCalls.push(
      statements.map((statement) => ({
        args: statement.args,
        sql: statement.sql,
      })),
    );

    return statements.map(() => ({ success: true }));
  }
}

async function signPayload(secret, payload) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    {
      name: "HMAC",
      hash: "SHA-256",
    },
    false,
    ["sign"],
  );

  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(payload),
  );

  return Buffer.from(signature).toString("hex");
}

async function createSignedRequest(payload, secret) {
  const body = JSON.stringify(payload);
  const signature = await signPayload(secret, body);

  return new Request("https://example.com/webhook/linear", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "linear-signature": signature,
    },
    body,
  });
}

function createEnv() {
  return {
    AI: {},
    DB: new FakeDB(),
    TASK_QUEUE: new FakeQueue(),
    GITHUB_REPO: "acme/widgets",
    GITHUB_TOKEN: "github-token",
    LINEAR_API_KEY: "linear-api-key",
    LINEAR_WEBHOOK_SECRET: "linear-webhook-secret",
  };
}

function createPayload(overrides = {}) {
  return {
    action: "Issue",
    webhookTimestamp: Date.now(),
    data: {
      id: "issue-123",
      identifier: "ENG-123",
      title: "Implement webhook intake",
      description: "Accept only ai-ready issues.",
      labels: {
        nodes: [
          {
            id: "label-1",
            name: "ai-ready",
          },
        ],
      },
    },
    organization: {
      id: "org-1",
      slug: "acme",
    },
    ...overrides,
  };
}

test("rejects invalid webhook signatures", async () => {
  const env = createEnv();
  const payload = createPayload();

  const response = await worker.fetch(
    new Request("https://example.com/webhook/linear", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "linear-signature": "00",
      },
      body: JSON.stringify(payload),
    }),
    env,
  );

  assert.equal(response.status, 401);
  assert.deepEqual(env.DB.batchCalls, []);
  assert.deepEqual(env.TASK_QUEUE.messages, []);
});

test("health reports all missing config keys at once", async () => {
  const env = {
    ...createEnv(),
    GITHUB_REPO: "owner/repo",
    GITHUB_TOKEN: "replace-with-github-token",
    LINEAR_API_KEY: "",
  };

  const response = await worker.fetch(
    new Request("https://example.com/health"),
    env,
  );
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(
    body.configError,
    "Missing required configuration: GITHUB_REPO, GITHUB_TOKEN, LINEAR_API_KEY",
  );
  assert.deepEqual(body.missingConfigKeys, [
    "GITHUB_REPO",
    "GITHUB_TOKEN",
    "LINEAR_API_KEY",
  ]);
});

test("lists recent tasks from D1", async () => {
  const env = createEnv();
  env.DB.queryResults = [
    {
      id: "task-1",
      issue_id: "issue-1",
      status: "queued",
      title: "Example task",
      repo_full_name: "acme/widgets",
      created_at: 1_710_000_000,
      updated_at: 1_710_000_100,
    },
  ];

  const response = await worker.fetch(
    new Request("https://example.com/tasks"),
    env,
  );
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(body.tasks, env.DB.queryResults);
});

test("ignores valid issues that do not have the ai-ready label", async () => {
  const env = createEnv();
  const payload = createPayload({
    data: {
      ...createPayload().data,
      labels: {
        nodes: [
          {
            id: "label-2",
            name: "backend",
          },
        ],
      },
    },
  });

  const response = await worker.fetch(
    await createSignedRequest(payload, env.LINEAR_WEBHOOK_SECRET),
    env,
  );
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.accepted, false);
  assert.equal(body.reason, "missing_ai_ready_label");
  assert.deepEqual(env.DB.batchCalls, []);
  assert.deepEqual(env.TASK_QUEUE.messages, []);
});

test("queues and persists ai-ready issues", async () => {
  const env = createEnv();
  const originalNow = Date.now;
  Date.now = () => 1_710_000_000_000;

  try {
    const payload = createPayload({
      webhookTimestamp: 1_710_000_000_000,
      data: {
        ...createPayload().data,
        labels: {
          nodes: [
            {
              id: "label-3",
              name: "AI-Ready",
            },
          ],
        },
      },
    });
    const response = await worker.fetch(
      await createSignedRequest(payload, env.LINEAR_WEBHOOK_SECRET),
      env,
    );
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.accepted, true);
    assert.equal(body.taskId, "issue-123");
    assert.deepEqual(env.TASK_QUEUE.messages, [
      {
        taskId: "issue-123",
        issueId: "issue-123",
        queuedAt: "2024-03-09T16:00:00.000Z",
      },
    ]);
    assert.equal(env.DB.batchCalls.length, 1);
    assert.equal(env.DB.batchCalls[0].length, 2);
    assert.match(env.DB.batchCalls[0][0].sql, /INSERT INTO tasks/i);
    assert.deepEqual(env.DB.batchCalls[0][0].args, [
      "issue-123",
      "issue-123",
      "Implement webhook intake",
      "Accept only ai-ready issues.",
      "acme/widgets",
      1_710_000_000,
      1_710_000_000,
    ]);
    assert.match(env.DB.batchCalls[0][1].sql, /INSERT INTO task_events/i);

    const eventPayload = JSON.parse(env.DB.batchCalls[0][1].args[2]);
    assert.equal(eventPayload.issueIdentifier, "ENG-123");
    assert.deepEqual(eventPayload.labels, ["AI-Ready"]);
  } finally {
    Date.now = originalNow;
  }
});

test("persists a queued task and initial event in one D1 batch", async () => {
  const db = new FakeDB();

  await persistQueuedTask(db, {
    taskId: "issue-999",
    issueId: "issue-999",
    title: "Queue me",
    description: null,
    repoFullName: "acme/widgets",
    createdAt: 123,
    eventType: "task.queued",
    eventPayload: JSON.stringify({ queuedAt: "2026-03-22T00:00:00.000Z" }),
  });

  assert.equal(db.batchCalls.length, 1);
  assert.equal(db.batchCalls[0].length, 2);
  assert.match(db.batchCalls[0][0].sql, /ON CONFLICT\(issue_id\) DO UPDATE/i);
  assert.deepEqual(db.batchCalls[0][1].args, [
    "issue-999",
    "task.queued",
    '{"queuedAt":"2026-03-22T00:00:00.000Z"}',
    123,
  ]);
});
