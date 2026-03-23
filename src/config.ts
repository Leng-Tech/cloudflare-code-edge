export interface AppConfig {
  githubRepo: string;
  githubToken: string;
  linearApiKey: string;
  linearWebhookSecret: string;
}

export interface WebhookIntakeConfig {
  githubRepo: string;
  linearWebhookSecret: string;
}

function isMissingConfigValue(value: string | undefined): boolean {
  return !value || value.startsWith("replace-with-") || value === "owner/repo";
}

function requireString(value: string | undefined, name: string): string {
  if (isMissingConfigValue(value)) {
    throw new Error(`Missing required configuration: ${name}`);
  }

  return value as string;
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
    githubRepo: requireString(env.GITHUB_REPO, "GITHUB_REPO"),
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
    githubRepo: requireString(env.GITHUB_REPO, "GITHUB_REPO"),
    linearWebhookSecret: requireString(
      env.LINEAR_WEBHOOK_SECRET,
      "LINEAR_WEBHOOK_SECRET",
    ),
  };
}
