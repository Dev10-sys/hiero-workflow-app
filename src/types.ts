export interface HieroWorkflowConfig {
  version: number;
  pull_requests?: PullRequestConfig;
  labeling?: LabelingConfig;
  contributor_checks?: ContributorChecksConfig;
  stale_management?: StaleManagementConfig;
}

export interface PullRequestConfig {
  title_check?: {
    enabled: boolean;
    pattern: string;
    error_message: string;
  };
  assignee?: {
    required: boolean;
    error_message: string;
  };
}

export interface LabelingConfig {
  path_map?: Record<string, string[]>;
  size_labels?: {
    enabled: boolean;
    thresholds: {
      small: number;
      medium: number;
      large: number;
    };
  };
}

export interface ContributorChecksConfig {
  assignment_restriction?: {
    enabled: boolean;
    labels: Record<string, {
      prerequisite_closed_issues: number;
      prerequisite_label: string;
    }>;
    error_message: string;
  };
}

export interface StaleManagementConfig {
  issues?: StaleConfig;
  pull_requests?: StaleConfig;
}

export interface StaleConfig {
  stale_days: number;
  close_days: number;
  stale_label: string;
  stale_message: string;
}
