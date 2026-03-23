import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_GITHUB_BASE_BRANCH,
  loadConfig,
  parseGitHubRepo,
} from "../dist-test/config.js";
import {
  buildGitHubRequestDefaults,
  createGitHubClient,
  GitHubClientError,
} from "../dist-test/github/client.js";
import {
  loadRepoContext,
  rankRepoContextCandidates,
} from "../dist-test/github/context.js";

function createRequestStub(handlers) {
  const calls = [];

  const stub = async (route, parameters = {}) => {
    calls.push({ route, parameters });
    const handler = handlers[calls.length - 1];

    assert.ok(handler, `Unexpected request: ${route}`);
    assert.equal(route, handler.route);

    if (typeof handler.assert === "function") {
      handler.assert(parameters, calls);
    }

    if (handler.error) {
      throw handler.error;
    }

    const response =
      typeof handler.response === "function"
        ? await handler.response(parameters, calls)
        : handler.response;

    return { data: response };
  };

  stub.calls = calls;
  return stub;
}

function createGitHubRepo() {
  return {
    owner: "acme",
    repo: "widgets.api",
    fullName: "acme/widgets.api",
  };
}

function encodeBase64(value) {
  return Buffer.from(value, "utf8").toString("base64");
}

test("loadConfig parses GITHUB_REPO and defaults the base branch to develop", () => {
  const config = loadConfig({
    GITHUB_REPO: "acme/widgets.api",
    GITHUB_TOKEN: "github-token",
    LINEAR_API_KEY: "linear-key",
    LINEAR_WEBHOOK_SECRET: "webhook-secret",
  });

  assert.deepEqual(config.githubRepo, createGitHubRepo());
  assert.equal(config.githubBaseBranch, DEFAULT_GITHUB_BASE_BRANCH);
});

test("parseGitHubRepo rejects .git suffixes", () => {
  assert.throws(
    () => parseGitHubRepo("acme/widgets.git"),
    /Invalid GITHUB_REPO/,
  );
});

test("buildGitHubRequestDefaults centralizes auth and API headers", () => {
  assert.deepEqual(buildGitHubRequestDefaults("secret-token"), {
    headers: {
      accept: "application/vnd.github+json",
      authorization: "Bearer secret-token",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
});

test("listFilesForRef uses the recursive tree API", async () => {
  const request = createRequestStub([
    {
      route: "GET /repos/{owner}/{repo}/git/trees/{tree_sha}",
      response: {
        sha: "tree-sha",
        truncated: false,
        tree: [
          {
            path: "go.mod",
            sha: "sha-1",
            size: 40,
            type: "blob",
          },
          {
            path: "internal/payments/handler.go",
            sha: "sha-2",
            size: 120,
            type: "blob",
          },
        ],
      },
    },
  ]);
  const client = createGitHubClient({
    repo: createGitHubRepo(),
    token: "github-token",
    request,
  });

  const result = await client.listFilesForRef("develop");

  assert.deepEqual(result.files.map((file) => file.path), [
    "go.mod",
    "internal/payments/handler.go",
  ]);
  assert.deepEqual(request.calls[0].parameters, {
    owner: "acme",
    repo: "widgets.api",
    tree_sha: "develop",
    recursive: "1",
  });
});

test("getFileContent decodes base64 text content", async () => {
  const request = createRequestStub([
    {
      route: "GET /repos/{owner}/{repo}/contents/{path}",
      response: {
        type: "file",
        path: "internal/payments/handler.go",
        sha: "file-sha",
        size: 30,
        encoding: "base64",
        content: encodeBase64("package payments\n"),
      },
    },
  ]);
  const client = createGitHubClient({
    repo: createGitHubRepo(),
    token: "github-token",
    request,
  });

  const result = await client.getFileContent(
    "internal/payments/handler.go",
    "develop",
  );

  assert.equal(result.content, "package payments\n");
  assert.equal(result.encoding, "utf-8");
});

test("createBranch reads the develop head by default", async () => {
  const request = createRequestStub([
    {
      route: "GET /repos/{owner}/{repo}/git/ref/{ref}",
      response: {
        ref: "refs/heads/develop",
        object: { sha: "base-sha" },
      },
    },
    {
      route: "POST /repos/{owner}/{repo}/git/refs",
      assert(parameters) {
        assert.deepEqual(parameters, {
          owner: "acme",
          repo: "widgets.api",
          ref: "refs/heads/issue-123",
          sha: "base-sha",
        });
      },
      response: {
        ref: "refs/heads/issue-123",
        object: { sha: "base-sha" },
      },
    },
  ]);
  const client = createGitHubClient({
    repo: createGitHubRepo(),
    token: "github-token",
    request,
  });

  const branch = await client.createBranch("issue-123");

  assert.equal(branch.baseRef, "develop");
  assert.equal(request.calls[0].parameters.ref, "heads/develop");
});

test("commitFileChanges creates a git tree, commit, and branch update", async () => {
  const request = createRequestStub([
    {
      route: "GET /repos/{owner}/{repo}/git/ref/{ref}",
      response: {
        ref: "refs/heads/issue-123",
        object: { sha: "parent-commit-sha" },
      },
    },
    {
      route: "GET /repos/{owner}/{repo}/git/commits/{commit_sha}",
      response: {
        sha: "parent-commit-sha",
        url: "https://api.github.com/commits/parent-commit-sha",
        tree: { sha: "base-tree-sha" },
      },
    },
    {
      route: "POST /repos/{owner}/{repo}/git/trees",
      assert(parameters) {
        assert.deepEqual(parameters.tree, [
          {
            path: "internal/payments/handler.go",
            mode: "100644",
            type: "blob",
            content: "package payments\n",
          },
          {
            path: "internal/payments/legacy.go",
            mode: "100644",
            type: "blob",
            sha: null,
          },
        ]);
      },
      response: {
        sha: "new-tree-sha",
        url: "https://api.github.com/trees/new-tree-sha",
      },
    },
    {
      route: "POST /repos/{owner}/{repo}/git/commits",
      response: {
        sha: "new-commit-sha",
        url: "https://api.github.com/commits/new-commit-sha",
      },
    },
    {
      route: "PATCH /repos/{owner}/{repo}/git/refs/{ref}",
      assert(parameters) {
        assert.equal(parameters.ref, "heads/issue-123");
        assert.equal(parameters.sha, "new-commit-sha");
        assert.equal(parameters.force, false);
      },
      response: {
        ref: "refs/heads/issue-123",
        object: { sha: "new-commit-sha" },
      },
    },
  ]);
  const client = createGitHubClient({
    repo: createGitHubRepo(),
    token: "github-token",
    request,
  });

  const result = await client.commitFileChanges("issue-123", "Update payments", [
    {
      path: "internal/payments/handler.go",
      operation: "update",
      content: "package payments\n",
    },
    {
      path: "internal/payments/legacy.go",
      operation: "delete",
    },
  ]);

  assert.equal(result.branch, "issue-123");
  assert.equal(result.commitSha, "new-commit-sha");
});

test("openPullRequest defaults the base branch to develop", async () => {
  const request = createRequestStub([
    {
      route: "POST /repos/{owner}/{repo}/pulls",
      assert(parameters) {
        assert.equal(parameters.base, "develop");
        assert.equal(parameters.head, "issue-123");
      },
      response: {
        number: 42,
        url: "https://api.github.com/pulls/42",
        html_url: "https://github.com/acme/widgets.api/pull/42",
        head: { ref: "issue-123" },
        base: { ref: "develop" },
      },
    },
  ]);
  const client = createGitHubClient({
    repo: createGitHubRepo(),
    token: "github-token",
    request,
  });

  const pullRequest = await client.openPullRequest({
    title: "Payments fix",
    head: "issue-123",
  });

  assert.equal(pullRequest.baseRef, "develop");
  assert.equal(pullRequest.htmlUrl, "https://github.com/acme/widgets.api/pull/42");
});

test("GitHub request errors are mapped to typed client errors", async () => {
  const request = createRequestStub([
    {
      route: "GET /repos/{owner}/{repo}/git/trees/{tree_sha}",
      error: Object.assign(new Error("Missing ref"), { status: 404 }),
    },
  ]);
  const client = createGitHubClient({
    repo: createGitHubRepo(),
    token: "github-token",
    request,
  });

  await assert.rejects(
    () => client.listFilesForRef("missing-branch"),
    (error) =>
      error instanceof GitHubClientError &&
      error.code === "not_found" &&
      error.status === 404,
  );
});

test("rankRepoContextCandidates prioritizes go manifests and relevant Go files", () => {
  const candidates = rankRepoContextCandidates(
    [
      { path: "vendor/github.com/example/lib.go", sha: "1", type: "blob" },
      { path: "go.mod", sha: "2", type: "blob" },
      { path: "internal/payments/handler.go", sha: "3", type: "blob" },
      { path: "internal/payments/handler_test.go", sha: "4", type: "blob" },
      { path: "docs/architecture.md", sha: "5", type: "blob" },
    ],
    {
      title: "Add payments handler",
      description: "Update payment flows",
    },
  );

  assert.deepEqual(candidates.map((candidate) => candidate.path), [
    "go.mod",
    "internal/payments/handler.go",
    "internal/payments/handler_test.go",
  ]);
});

test("loadRepoContext stops when the recursive tree response is truncated", async () => {
  await assert.rejects(
    () =>
      loadRepoContext(
        {
          async listFilesForRef(ref) {
            return {
              ref,
              sha: "tree-sha",
              truncated: true,
              files: [],
            };
          },
          async getFileContent() {
            throw new Error("should not be called");
          },
        },
        { title: "Add payments handler" },
      ),
    (error) =>
      error instanceof GitHubClientError && error.code === "truncated_tree",
  );
});

test("loadRepoContext enforces bounded file loading and skips oversized files", async () => {
  const getFileCalls = [];
  const result = await loadRepoContext(
    {
      async listFilesForRef(ref) {
        return {
          ref,
          sha: "tree-sha",
          truncated: false,
          files: [
            { path: "go.mod", sha: "1", size: 20, type: "blob" },
            {
              path: "internal/payments/handler.go",
              sha: "2",
              size: 60,
              type: "blob",
            },
            {
              path: "internal/payments/service.go",
              sha: "3",
              size: 60,
              type: "blob",
            },
          ],
        };
      },
      async getFileContent(path, ref, options) {
        getFileCalls.push({ path, ref, options });

        if (path === "internal/payments/service.go") {
          throw new GitHubClientError(
            "file_too_large",
            "service.go exceeds the limit",
          );
        }

        return {
          path,
          ref,
          sha: `${path}-sha`,
          size: path === "go.mod" ? 20 : 60,
          content: `content for ${path}`,
          encoding: "utf-8",
        };
      },
    },
    {
      title: "Add payments handler",
      description: "Touch the payments service",
    },
    {
      maxCandidates: 3,
      maxBytesPerFile: 64,
      maxTotalBytes: 96,
    },
  );

  assert.equal(result.totalBytes, 80);
  assert.deepEqual(result.files.map((file) => file.path), [
    "go.mod",
    "internal/payments/handler.go",
  ]);
  assert.deepEqual(getFileCalls, [
    {
      path: "go.mod",
      ref: "develop",
      options: { maxBytes: 64 },
    },
    {
      path: "internal/payments/handler.go",
      ref: "develop",
      options: { maxBytes: 64 },
    },
    {
      path: "internal/payments/service.go",
      ref: "develop",
      options: { maxBytes: 16 },
    },
  ]);
});
