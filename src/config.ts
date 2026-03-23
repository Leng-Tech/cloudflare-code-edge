import type { GitHubRepoTarget } from "./types.js";

export interface AppConfig {
  githubRepo: GitHubRepoTarget;
  githubBaseBranch: string;
  githubToken: string;
  linearApiKey: string;
  linearWebhookSecret: string;
}

export interface WebhookIntakeConfig {
  githubRepo: GitHubRepoTarget;
  linearWebhookSecret: string;
}

export const DEFAULT_GITHUB_BASE_BRANCH = "develop";

function isMissingConfigValue(value: string | undefined): boolean {
  return !value || value.startsWith("replace-with-") || value === "owner/repo";
}

function requireString(value: string | undefined, name: string): string {
  if (isMissingConfigValue(value)) {
    throw new Error(`Missing required configuration: ${name}`);
  }

  return value as string;
}

export function parseGitHubRepo(value: string): GitHubRepoTarget {
  const normalized = value.trim();
  const segments = normalized.split("/");

  if (
    segments.length !== 2 ||
    segments.some((segment) => segment.length === 0) ||
    normalized.endsWith(".git")
  ) {
    throw new Error(
      "Invalid GITHUB_REPO. Expected the format owner/repo with no .git suffix.",
    );
  }

  return {
    owner: segments[0] as string,
    repo: segments[1] as string,
    fullName: normalized,
  };
}

export function getMissingConfigKeys(env: Cloudflare.Env): string[] {
  const requiredConfig = [
    ["GITHUB_REPO", env.GITHUB_REPO],
    ["GITHUB_TOKEN", env.GITHUB_TOKEN],
    ["LINEAR_API_KEY", env.LINEAR_API_KEY],
    ["LINEAR_WEBHOOK_SECRET", env.LINEAR_WEBHOOK_SECRET],
  ] as const;

  return requiredConfig.flatMap(([name, value]) =>
    isMissingConfigValue(value) ? [name] : [],
  );
}

export function loadConfig(env: Cloudflare.Env): AppConfig {
  const missingKeys = getMissingConfigKeys(env);

  if (missingKeys.length > 0) {
    throw new Error(
      `Missing required configuration: ${missingKeys.join(", ")}`,
    );
  }

  return {
    githubRepo: parseGitHubRepo(
      requireString(env.GITHUB_REPO, "GITHUB_REPO"),
    ),
    githubBaseBranch: DEFAULT_GITHUB_BASE_BRANCH,
    githubToken: requireString(env.GITHUB_TOKEN, "GITHUB_TOKEN"),
    linearApiKey: requireString(env.LINEAR_API_KEY, "LINEAR_API_KEY"),
    linearWebhookSecret: requireString(
      env.LINEAR_WEBHOOK_SECRET,
      "LINEAR_WEBHOOK_SECRET",
    ),
  };
}

export function loadWebhookIntakeConfig(
  env: Cloudflare.Env,
): WebhookIntakeConfig {
  return {
    githubRepo: parseGitHubRepo(
      requireString(env.GITHUB_REPO, "GITHUB_REPO"),
    ),
    linearWebhookSecret: requireString(
      env.LINEAR_WEBHOOK_SECRET,
      "LINEAR_WEBHOOK_SECRET",
    ),
  };
}
