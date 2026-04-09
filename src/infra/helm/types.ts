/**
 * Severity: block = malformed/non-renderable, warn = likely-to-break, suggest = style/best-practice
 */
export type HelmIssueSeverity = 'block' | 'warn' | 'suggest';

export type HelmIssuePhase = 'static' | 'cli';

/**
 * plan = the generated ManifestPlan output, chart = an existing chart on disk
 */
export type HelmIssueTarget = 'plan' | 'chart';

export interface HelmValidationIssue {
  ruleId: string;
  message: string;
  severity: HelmIssueSeverity;
  phase: HelmIssuePhase;
  target: HelmIssueTarget;
  file?: string;
  description?: string;
}

export interface ToolInfo {
  available: boolean;
  version?: string;
}

export interface HelmValidationResult {
  passed: boolean;
  issues: HelmValidationIssue[];
  summary: string;
  phasesRun: {
    static: boolean;
    helmCli: boolean;
    kubectlDryRun: boolean;
  };
  tooling: {
    helm: ToolInfo;
    kubectl: ToolInfo;
  };
  targetsValidated: {
    plan: boolean;
    chartOnDisk: boolean;
  };
}

// Helm 3.0.0 introduced apiVersion: v2 chart format
export const MIN_HELM_VERSION = '3.0.0';

// kubectl 1.18+ supports --dry-run=client
export const MIN_KUBECTL_VERSION = '1.18.0';

export const HELM_TIMEOUTS = {
  versionCheck: 5_000,
  lint: 30_000,
  template: 30_000,
  kubectlDryRun: 15_000,
} as const;
