export interface LinearIssuePayload {
  id: string;
  identifier?: string;
  title: string;
  description?: string | null;
  priority?: number | null;
  state?: {
    id: string;
    name: string;
  } | null;
  labels?:
    | {
        nodes?: unknown;
      }
    | unknown[]
    | null;
  team?: {
    id: string;
    key: string;
    name: string;
  } | null;
}

export interface LinearWebhookPayload {
  action: string;
  type?: string;
  createdAt?: string;
  webhookTimestamp?: number;
  data: LinearIssuePayload;
  organization?: {
    id: string;
    name?: string;
    slug?: string;
  };
}

export interface LinearLabel {
  id: string;
  name: string;
  color?: string;
}

export interface GitHubRepoTarget {
  owner: string;
  repo: string;
  fullName: string;
}

export interface QueuedTaskPersistenceInput {
  taskId: string;
  issueId: string;
  title: string;
  description?: string | null;
  repoFullName: string;
  createdAt: number;
  eventType: string;
  eventPayload: string;
}

export type TaskStatus =
  | "queued"
  | "analyzing"
  | "blocked"
  | "generating"
  | "validating"
  | "ready_for_pr"
  | "completed"
  | "failed";

export interface TaskRecord {
  id: string;
  issue_id: string;
  status: TaskStatus;
  title: string;
  description?: string | null;
  repo_full_name: string;
  branch_name?: string | null;
  pr_url?: string | null;
  specification_gap_reasons?: string | null;
  validation_summary?: string | null;
  created_at: number;
  updated_at: number;
}

export type SpecificationGapKind =
  | "missing_package_placement"
  | "missing_schema_or_api_contract"
  | "unclear_env_or_config_dependency"
  | "unclear_integration_point"
  | "conflicting_requirements"
  | "missing_operational_constraints";

export interface SpecificationGap {
  kind: SpecificationGapKind;
  question: string;
  evidence: string[];
  blocking: boolean;
}

export interface SpecificationGapResult {
  hasSpecificationGaps: boolean;
  gaps: SpecificationGap[];
  summary: string;
}

export interface GeneratedFileChange {
  path: string;
  operation: "create" | "update" | "delete";
  content: string;
}

export interface GeneratedChangeSet {
  summary: string;
  files: GeneratedFileChange[];
  validationTargets: string[];
}

export interface ValidationCheck {
  name: string;
  status: "passed" | "failed" | "skipped";
  details?: string;
}

export interface ValidationSummary {
  status: "passed" | "failed" | "limited";
  checks: ValidationCheck[];
  notes?: string;
}

export interface GitHubTreeEntry {
  path: string;
  mode?: string;
  sha: string;
  size?: number;
  type: "blob" | "tree" | "commit";
  url?: string;
}

export interface GitHubListFilesResult {
  ref: string;
  sha: string;
  truncated: boolean;
  files: GitHubTreeEntry[];
}

export interface GitHubFileContent {
  path: string;
  ref: string;
  sha: string;
  size: number;
  content: string;
  encoding: "utf-8";
}

export interface GitHubFileContentOptions {
  maxBytes?: number;
}

export interface GitHubBranchResult {
  name: string;
  ref: string;
  sha: string;
  baseRef: string;
}

export interface GitHubCommitFileChange {
  path: string;
  operation: "create" | "update" | "delete";
  content?: string;
  mode?: string;
}

export interface GitHubCommitResult {
  branch: string;
  commitSha: string;
  treeSha: string;
  url: string;
}

export interface GitHubPullRequestInput {
  title: string;
  body?: string;
  head: string;
  base?: string;
}

export interface GitHubPullRequestResult {
  number: number;
  url: string;
  htmlUrl: string;
  headRef: string;
  baseRef: string;
}

export interface RepoContextQuery {
  title: string;
  description?: string | null;
}

export interface RepoContextCandidate {
  path: string;
  reason: string;
  score: number;
  size?: number;
}

export interface RepoContextDocument {
  path: string;
  content: string;
  score: number;
  size: number;
  sha: string;
}

export interface RepoContextResult {
  ref: string;
  candidates: RepoContextCandidate[];
  files: RepoContextDocument[];
  totalBytes: number;
}
