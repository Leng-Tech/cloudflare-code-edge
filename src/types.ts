export interface LinearWebhookPayload {
  action: string;
  type?: string;
  createdAt?: string;
  data: {
    id: string;
    identifier?: string;
    title: string;
    description?: string | null;
    priority?: number | null;
    state?: {
      id: string;
      name: string;
    } | null;
    labels?: {
      nodes: LinearLabel[];
    } | null;
    team?: {
      id: string;
      key: string;
      name: string;
    } | null;
  };
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
