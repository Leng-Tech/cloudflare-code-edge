import { request as octokitRequest } from "@octokit/request";

import { DEFAULT_GITHUB_BASE_BRANCH } from "../config.js";
import type {
  GitHubBranchResult,
  GitHubCommitFileChange,
  GitHubCommitResult,
  GitHubFileContent,
  GitHubFileContentOptions,
  GitHubListFilesResult,
  GitHubPullRequestInput,
  GitHubPullRequestResult,
  GitHubRepoTarget,
  GitHubTreeEntry,
} from "../types.js";

const GITHUB_ACCEPT_HEADER = "application/vnd.github+json";
const GITHUB_API_VERSION = "2022-11-28";

export type GitHubClientErrorCode =
  | "not_found"
  | "conflict"
  | "validation_failed"
  | "github_request_failed"
  | "unsupported_content"
  | "file_too_large"
  | "binary_content"
  | "invalid_change_set"
  | "truncated_tree";

export class GitHubClientError extends Error {
  readonly code: GitHubClientErrorCode;
  readonly status?: number;
  readonly details?: unknown;

  constructor(
    code: GitHubClientErrorCode,
    message: string,
    options: { status?: number; details?: unknown } = {},
  ) {
    super(message);
    this.name = "GitHubClientError";
    this.code = code;
    this.status = options.status;
    this.details = options.details;
  }
}

interface GitHubRequestResponse<T> {
  data: T;
}

export type GitHubRequestFn = <T = unknown>(
  route: string,
  parameters?: Record<string, unknown>,
) => Promise<GitHubRequestResponse<T>>;

export interface GitHubClient {
  listFilesForRef(ref: string): Promise<GitHubListFilesResult>;
  getFileContent(
    path: string,
    ref: string,
    options?: GitHubFileContentOptions,
  ): Promise<GitHubFileContent>;
  createBranch(branchName: string, fromRef?: string): Promise<GitHubBranchResult>;
  commitFileChanges(
    branchName: string,
    message: string,
    changes: GitHubCommitFileChange[],
  ): Promise<GitHubCommitResult>;
  openPullRequest(input: GitHubPullRequestInput): Promise<GitHubPullRequestResult>;
}

export interface CreateGitHubClientOptions {
  repo: GitHubRepoTarget;
  token: string;
  baseBranch?: string;
  request?: GitHubRequestFn;
}

interface GitTreeResponse {
  sha: string;
  truncated?: boolean;
  tree?: GitHubTreeEntry[];
}

interface GitRefResponse {
  ref: string;
  object?: {
    sha?: string;
    url?: string;
  };
}

interface GitCommitResponse {
  sha: string;
  url: string;
  tree?: {
    sha?: string;
  };
}

interface GitCreateTreeResponse {
  sha: string;
  url: string;
}

interface GitHubContentsResponse {
  type?: string;
  path?: string;
  sha?: string;
  size?: number;
  encoding?: string;
  content?: string;
}

interface PullRequestResponse {
  number: number;
  url: string;
  html_url: string;
  head?: {
    ref?: string;
  };
  base?: {
    ref?: string;
  };
}

export function buildGitHubRequestDefaults(token: string): {
  headers: Record<string, string>;
} {
  return {
    headers: {
      accept: GITHUB_ACCEPT_HEADER,
      authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": GITHUB_API_VERSION,
    },
  };
}

function createDefaultRequest(token: string): GitHubRequestFn {
  return octokitRequest.defaults(buildGitHubRequestDefaults(token)) as GitHubRequestFn;
}

function getErrorStatus(error: unknown): number | undefined {
  if (
    error &&
    typeof error === "object" &&
    "status" in error &&
    typeof error.status === "number"
  ) {
    return error.status;
  }

  return undefined;
}

function toGitHubClientError(
  error: unknown,
  fallbackMessage: string,
): GitHubClientError {
  if (error instanceof GitHubClientError) {
    return error;
  }

  const status = getErrorStatus(error);
  const message =
    error instanceof Error && error.message.length > 0
      ? error.message
      : fallbackMessage;

  if (status === 404) {
    return new GitHubClientError("not_found", message, { status, details: error });
  }

  if (status === 409) {
    return new GitHubClientError("conflict", message, { status, details: error });
  }

  if (status === 422) {
    return new GitHubClientError("validation_failed", message, {
      status,
      details: error,
    });
  }

  return new GitHubClientError("github_request_failed", message, {
    status,
    details: error,
  });
}

function normalizeBranchRef(ref: string): string {
  const normalized = ref.trim();

  if (normalized.startsWith("refs/heads/")) {
    return normalized.slice("refs/".length);
  }

  if (normalized.startsWith("heads/")) {
    return normalized;
  }

  return `heads/${normalized}`;
}

function normalizeBranchName(ref: string): string {
  return normalizeBranchRef(ref).slice("heads/".length);
}

function decodeBase64Utf8(value: string): string {
  const normalized = value.replace(/\n/g, "");
  const binary = atob(normalized);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));

  return new TextDecoder().decode(bytes);
}

function assertTreeEntries(entries: GitHubTreeEntry[] | undefined): GitHubTreeEntry[] {
  if (!Array.isArray(entries)) {
    return [];
  }

  return entries.filter(
    (entry): entry is GitHubTreeEntry =>
      Boolean(
        entry &&
          typeof entry.path === "string" &&
          typeof entry.sha === "string" &&
          (entry.type === "blob" || entry.type === "tree" || entry.type === "commit"),
      ),
  );
}

export function createGitHubClient(
  options: CreateGitHubClientOptions,
): GitHubClient {
  const request = options.request ?? createDefaultRequest(options.token);
  const baseBranch = options.baseBranch ?? DEFAULT_GITHUB_BASE_BRANCH;
  const { owner, repo } = options.repo;

  async function callGitHub<T>(
    route: string,
    parameters: Record<string, unknown>,
    fallbackMessage: string,
  ): Promise<T> {
    try {
      const response = await request<T>(route, {
        owner,
        repo,
        ...parameters,
      });

      return response.data;
    } catch (error) {
      throw toGitHubClientError(error, fallbackMessage);
    }
  }

  return {
    async listFilesForRef(ref: string): Promise<GitHubListFilesResult> {
      const resolvedRef = ref.trim();
      const tree = await callGitHub<GitTreeResponse>(
        "GET /repos/{owner}/{repo}/git/trees/{tree_sha}",
        {
          tree_sha: resolvedRef,
          recursive: "1",
        },
        `Failed to list repository files for ref ${resolvedRef}.`,
      );

      return {
        ref: resolvedRef,
        sha: tree.sha,
        truncated: tree.truncated === true,
        files: assertTreeEntries(tree.tree),
      };
    },

    async getFileContent(
      path: string,
      ref: string,
      options: GitHubFileContentOptions = {},
    ): Promise<GitHubFileContent> {
      const file = await callGitHub<GitHubContentsResponse | GitHubContentsResponse[]>(
        "GET /repos/{owner}/{repo}/contents/{path}",
        {
          path,
          ref,
        },
        `Failed to fetch repository file ${path} at ${ref}.`,
      );

      if (Array.isArray(file) || file.type !== "file") {
        throw new GitHubClientError(
          "unsupported_content",
          `GitHub returned non-file content for ${path}.`,
        );
      }

      if (typeof file.size === "number" && typeof options.maxBytes === "number") {
        if (file.size > options.maxBytes) {
          throw new GitHubClientError(
            "file_too_large",
            `${path} is ${file.size} bytes, which exceeds the ${options.maxBytes}-byte limit.`,
          );
        }
      }

      if (file.encoding !== "base64" || typeof file.content !== "string") {
        throw new GitHubClientError(
          "unsupported_content",
          `GitHub returned unsupported encoding for ${path}.`,
        );
      }

      const content = decodeBase64Utf8(file.content);

      if (content.includes("\u0000")) {
        throw new GitHubClientError(
          "binary_content",
          `${path} appears to be a binary file and cannot be used as text context.`,
        );
      }

      const size =
        typeof file.size === "number"
          ? file.size
          : new TextEncoder().encode(content).length;

      return {
        path: file.path ?? path,
        ref,
        sha: file.sha ?? "",
        size,
        content,
        encoding: "utf-8",
      };
    },

    async createBranch(
      branchName: string,
      fromRef = baseBranch,
    ): Promise<GitHubBranchResult> {
      const sourceRef = normalizeBranchRef(fromRef);
      const newBranchName = normalizeBranchName(branchName);
      const source = await callGitHub<GitRefResponse>(
        "GET /repos/{owner}/{repo}/git/ref/{ref}",
        {
          ref: sourceRef,
        },
        `Failed to read source ref ${sourceRef}.`,
      );

      const sourceSha = source.object?.sha;

      if (!sourceSha) {
        throw new GitHubClientError(
          "github_request_failed",
          `GitHub did not return a commit SHA for ${sourceRef}.`,
        );
      }

      const created = await callGitHub<GitRefResponse>(
        "POST /repos/{owner}/{repo}/git/refs",
        {
          ref: `refs/heads/${newBranchName}`,
          sha: sourceSha,
        },
        `Failed to create branch ${newBranchName}.`,
      );

      return {
        name: newBranchName,
        ref: created.ref,
        sha: created.object?.sha ?? sourceSha,
        baseRef: normalizeBranchName(fromRef),
      };
    },

    async commitFileChanges(
      branchName: string,
      message: string,
      changes: GitHubCommitFileChange[],
    ): Promise<GitHubCommitResult> {
      if (changes.length === 0) {
        throw new GitHubClientError(
          "invalid_change_set",
          "commitFileChanges requires at least one file change.",
        );
      }

      const headRef = normalizeBranchRef(branchName);
      const head = await callGitHub<GitRefResponse>(
        "GET /repos/{owner}/{repo}/git/ref/{ref}",
        {
          ref: headRef,
        },
        `Failed to read branch ${headRef}.`,
      );

      const parentCommitSha = head.object?.sha;

      if (!parentCommitSha) {
        throw new GitHubClientError(
          "github_request_failed",
          `GitHub did not return a head commit SHA for ${headRef}.`,
        );
      }

      const parentCommit = await callGitHub<GitCommitResponse>(
        "GET /repos/{owner}/{repo}/git/commits/{commit_sha}",
        {
          commit_sha: parentCommitSha,
        },
        `Failed to load commit ${parentCommitSha}.`,
      );

      const baseTreeSha = parentCommit.tree?.sha;

      if (!baseTreeSha) {
        throw new GitHubClientError(
          "github_request_failed",
          `GitHub did not return a base tree SHA for commit ${parentCommitSha}.`,
        );
      }

      const tree = await callGitHub<GitCreateTreeResponse>(
        "POST /repos/{owner}/{repo}/git/trees",
        {
          base_tree: baseTreeSha,
          tree: changes.map((change) => {
            if (change.operation === "delete") {
              return {
                path: change.path,
                mode: change.mode ?? "100644",
                type: "blob",
                sha: null,
              };
            }

            if (typeof change.content !== "string") {
              throw new GitHubClientError(
                "invalid_change_set",
                `Missing replacement content for ${change.path}.`,
              );
            }

            return {
              path: change.path,
              mode: change.mode ?? "100644",
              type: "blob",
              content: change.content,
            };
          }),
        },
        `Failed to build a git tree for ${branchName}.`,
      );

      const commit = await callGitHub<GitCommitResponse>(
        "POST /repos/{owner}/{repo}/git/commits",
        {
          message,
          tree: tree.sha,
          parents: [parentCommitSha],
        },
        `Failed to create a commit on ${branchName}.`,
      );

      await callGitHub<GitRefResponse>(
        "PATCH /repos/{owner}/{repo}/git/refs/{ref}",
        {
          ref: headRef,
          sha: commit.sha,
          force: false,
        },
        `Failed to update branch ${branchName} to ${commit.sha}.`,
      );

      return {
        branch: normalizeBranchName(branchName),
        commitSha: commit.sha,
        treeSha: tree.sha,
        url: commit.url,
      };
    },

    async openPullRequest(
      input: GitHubPullRequestInput,
    ): Promise<GitHubPullRequestResult> {
      const pullRequest = await callGitHub<PullRequestResponse>(
        "POST /repos/{owner}/{repo}/pulls",
        {
          title: input.title,
          body: input.body ?? "",
          head: input.head,
          base: input.base ?? baseBranch,
        },
        `Failed to open a pull request from ${input.head}.`,
      );

      return {
        number: pullRequest.number,
        url: pullRequest.url,
        htmlUrl: pullRequest.html_url,
        headRef: pullRequest.head?.ref ?? input.head,
        baseRef: pullRequest.base?.ref ?? input.base ?? baseBranch,
      };
    },
  };
}
