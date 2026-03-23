import { DEFAULT_GITHUB_BASE_BRANCH } from "../config.js";
import type {
  GitHubFileContent,
  GitHubFileContentOptions,
  GitHubListFilesResult,
  GitHubTreeEntry,
  RepoContextCandidate,
  RepoContextDocument,
  RepoContextQuery,
  RepoContextResult,
} from "../types.js";
import { GitHubClientError } from "./client.js";

export const DEFAULT_REPO_CONTEXT_MAX_CANDIDATES = 12;
export const DEFAULT_REPO_CONTEXT_MAX_BYTES_PER_FILE = 128 * 1024;
export const DEFAULT_REPO_CONTEXT_MAX_TOTAL_BYTES = 512 * 1024;

export interface RepoContextClient {
  listFilesForRef(ref: string): Promise<GitHubListFilesResult>;
  getFileContent(
    path: string,
    ref: string,
    options?: GitHubFileContentOptions,
  ): Promise<GitHubFileContent>;
}

export interface RepoContextLoadOptions {
  ref?: string;
  maxCandidates?: number;
  maxBytesPerFile?: number;
  maxTotalBytes?: number;
}

const ENTRYPOINT_FILE_NAMES = new Set([
  "main.go",
  "handler.go",
  "service.go",
  "server.go",
  "api.go",
  "router.go",
]);

function tokenize(value: string): string[] {
  return Array.from(
    new Set(
      value
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((token) => token.length >= 3),
    ),
  );
}

function isExcludedPath(path: string): boolean {
  const normalized = path.toLowerCase();

  return (
    normalized.startsWith("vendor/") ||
    normalized.includes("/vendor/") ||
    normalized.startsWith("testdata/") ||
    normalized.includes("/testdata/") ||
    normalized.endsWith(".pb.go") ||
    normalized.endsWith(".gen.go") ||
    normalized.endsWith("_generated.go") ||
    normalized.startsWith("dist/") ||
    normalized.includes("/dist/") ||
    normalized.startsWith("build/") ||
    normalized.includes("/build/")
  );
}

function isSupportedContextEntry(entry: GitHubTreeEntry): boolean {
  if (entry.type !== "blob" || isExcludedPath(entry.path)) {
    return false;
  }

  return (
    entry.path === "go.mod" ||
    entry.path === "go.work" ||
    entry.path.endsWith(".go")
  );
}

function scoreEntry(
  entry: GitHubTreeEntry,
  tokens: string[],
): RepoContextCandidate | null {
  if (!isSupportedContextEntry(entry)) {
    return null;
  }

  const reasons: string[] = [];
  let score = 0;
  const lowerPath = entry.path.toLowerCase();
  const segments = tokenize(lowerPath);
  const fileName = lowerPath.split("/").at(-1) ?? lowerPath;

  if (entry.path === "go.mod") {
    score += 120;
    reasons.push("module-manifest");
  } else if (entry.path === "go.work") {
    score += 110;
    reasons.push("workspace-manifest");
  } else if (entry.path.endsWith(".go")) {
    score += 40;
    reasons.push("go-source");
  }

  if (fileName.endsWith("_test.go")) {
    score -= 8;
    reasons.push("test-file");
  }

  if (ENTRYPOINT_FILE_NAMES.has(fileName)) {
    score += 10;
    reasons.push("entrypoint-like");
  }

  const matchedTokens = tokens.filter((token) => segments.includes(token));

  if (matchedTokens.length > 0) {
    score += matchedTokens.length * 12;
    reasons.push(`matched:${matchedTokens.slice(0, 3).join(",")}`);
  }

  if (lowerPath.includes("/internal/")) {
    score += 4;
    reasons.push("internal-package");
  }

  return {
    path: entry.path,
    reason: reasons.join("; "),
    score,
    size: entry.size,
  };
}

export function rankRepoContextCandidates(
  files: GitHubTreeEntry[],
  query: RepoContextQuery,
  maxCandidates = DEFAULT_REPO_CONTEXT_MAX_CANDIDATES,
): RepoContextCandidate[] {
  const tokens = tokenize(`${query.title} ${query.description ?? ""}`);

  return files
    .map((entry) => scoreEntry(entry, tokens))
    .filter((entry): entry is RepoContextCandidate => entry !== null)
    .sort((left, right) => right.score - left.score || left.path.localeCompare(right.path))
    .slice(0, maxCandidates);
}

function shouldSkipContextError(error: unknown): boolean {
  return (
    error instanceof GitHubClientError &&
    (error.code === "file_too_large" ||
      error.code === "binary_content" ||
      error.code === "unsupported_content")
  );
}

export async function loadRepoContext(
  client: RepoContextClient,
  query: RepoContextQuery,
  options: RepoContextLoadOptions = {},
): Promise<RepoContextResult> {
  const ref = options.ref ?? DEFAULT_GITHUB_BASE_BRANCH;
  const maxCandidates =
    options.maxCandidates ?? DEFAULT_REPO_CONTEXT_MAX_CANDIDATES;
  const maxBytesPerFile =
    options.maxBytesPerFile ?? DEFAULT_REPO_CONTEXT_MAX_BYTES_PER_FILE;
  const maxTotalBytes =
    options.maxTotalBytes ?? DEFAULT_REPO_CONTEXT_MAX_TOTAL_BYTES;
  const listing = await client.listFilesForRef(ref);

  if (listing.truncated) {
    throw new GitHubClientError(
      "truncated_tree",
      `Repository tree for ${ref} is truncated and cannot be used as bounded context.`,
    );
  }

  const candidates = rankRepoContextCandidates(
    listing.files,
    query,
    maxCandidates,
  );
  const files: RepoContextDocument[] = [];
  let totalBytes = 0;

  for (const candidate of candidates) {
    const remainingBytes = maxTotalBytes - totalBytes;

    if (remainingBytes <= 0) {
      break;
    }

    try {
      const file = await client.getFileContent(candidate.path, ref, {
        maxBytes: Math.min(maxBytesPerFile, remainingBytes),
      });

      if (file.size > remainingBytes) {
        continue;
      }

      files.push({
        path: file.path,
        content: file.content,
        score: candidate.score,
        size: file.size,
        sha: file.sha,
      });
      totalBytes += file.size;
    } catch (error) {
      if (shouldSkipContextError(error)) {
        continue;
      }

      throw error;
    }
  }

  return {
    ref,
    candidates,
    files,
    totalBytes,
  };
}
