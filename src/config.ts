export interface AppConfig {
  githubRepo: string;
  githubToken: string;
  linearApiKey: string;
  linearWebhookSecret: string;
}

function requireString(value: string | undefined, name: string): string {
  if (!value || value.startsWith("replace-with-") || value === "owner/repo") {
    throw new Error(`Missing required configuration: ${name}`);
  }

  return value;
}

export function loadConfig(env: Cloudflare.Env): AppConfig {
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
