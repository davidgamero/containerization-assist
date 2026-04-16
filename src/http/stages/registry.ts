// Single source of truth for pipeline stage metadata. Imported by both
// backend workflow and frontend UI, so must contain no Node-only imports.

export const SESSION_PHASE = {
  PENDING: 'pending',
  CLONING: 'cloning',
  ANALYZING: 'analyzing',
  GENERATING_DOCKERFILE: 'generating_dockerfile',
  BUILDING: 'building',
  SCANNING: 'scanning',
  GENERATING_MANIFESTS: 'generating_manifests',
  COMPLETE: 'complete',
  FAILED: 'failed',
} as const;
export type SessionPhase = (typeof SESSION_PHASE)[keyof typeof SESSION_PHASE];

export type ArtifactTag =
  | 'context'
  | 'dockerfile'
  | 'manifest'
  | 'validation-report'
  | 'plan'
  | 'log';

export type PolicyTarget = 'dockerfile' | 'manifest' | 'package' | 'any';

export type StageState = 'pending' | 'active' | 'complete' | 'failed';

export interface StageDefinition {
  key: SessionPhase;
  order: number;
  label: string;
  shortLabel: string;
  description: string;
  producesArtifacts: ArtifactTag[];
  policyTargets: PolicyTarget[];
  isTerminal?: boolean;
  llmDriven?: boolean;
}

export const STAGES: StageDefinition[] = [
  {
    key: SESSION_PHASE.PENDING,
    order: 0,
    label: 'Pending',
    shortLabel: 'Pending',
    description: 'Waiting to start',
    producesArtifacts: [],
    policyTargets: [],
  },
  {
    key: SESSION_PHASE.CLONING,
    order: 1,
    label: 'Cloning',
    shortLabel: 'Clone',
    description: 'Fetching source code from the repository',
    producesArtifacts: [],
    policyTargets: [],
  },
  {
    key: SESSION_PHASE.ANALYZING,
    order: 2,
    label: 'Analyzing',
    shortLabel: 'Analyze',
    description: 'Detecting language, framework, and dependencies',
    producesArtifacts: ['context'],
    policyTargets: ['package', 'any'],
  },
  {
    key: SESSION_PHASE.GENERATING_DOCKERFILE,
    order: 3,
    label: 'Generating Dockerfile',
    shortLabel: 'Dockerfile',
    description: 'Producing a production-ready Dockerfile',
    producesArtifacts: ['plan', 'dockerfile', 'validation-report'],
    policyTargets: ['dockerfile', 'any'],
    llmDriven: true,
  },
  {
    key: SESSION_PHASE.BUILDING,
    order: 4,
    label: 'Building',
    shortLabel: 'Build',
    description: 'Preparing the build context and image',
    producesArtifacts: ['context'],
    policyTargets: [],
  },
  {
    key: SESSION_PHASE.SCANNING,
    order: 5,
    label: 'Scanning',
    shortLabel: 'Scan',
    description: 'Scanning the image for vulnerabilities',
    producesArtifacts: ['validation-report'],
    policyTargets: [],
  },
  {
    key: SESSION_PHASE.GENERATING_MANIFESTS,
    order: 6,
    label: 'Generating Manifests',
    shortLabel: 'Manifests',
    description: 'Producing Kubernetes deployment manifests',
    producesArtifacts: ['plan', 'manifest', 'validation-report'],
    policyTargets: ['manifest', 'any'],
    llmDriven: true,
  },
  {
    key: SESSION_PHASE.COMPLETE,
    order: 7,
    label: 'Complete',
    shortLabel: 'Complete',
    description: 'Pipeline finished successfully',
    producesArtifacts: [],
    policyTargets: [],
    isTerminal: true,
  },
  {
    key: SESSION_PHASE.FAILED,
    order: 7,
    label: 'Failed',
    shortLabel: 'Failed',
    description: 'Pipeline failed',
    producesArtifacts: [],
    policyTargets: [],
    isTerminal: true,
  },
];

const _BY_KEY = Object.fromEntries(STAGES.map((s) => [s.key, s])) as Record<
  SessionPhase,
  StageDefinition
>;

export const STAGES_BY_KEY: Readonly<Record<SessionPhase, StageDefinition>> = _BY_KEY;

export const ORDERED_STAGES: StageDefinition[] = STAGES.filter(
  (s) => !s.isTerminal && s.key !== SESSION_PHASE.PENDING,
).sort((a, b) => a.order - b.order);

export const EXECUTABLE_STAGES: StageDefinition[] = ORDERED_STAGES.filter(
  (s) => s.key !== SESSION_PHASE.CLONING,
);

export function getStageState(
  stageOrder: number,
  currentPhase: SessionPhase,
  isFailed: boolean,
): StageState {
  const current = STAGES_BY_KEY[currentPhase];
  if (!current) return 'pending';
  if (isFailed) {
    if (stageOrder < current.order) return 'complete';
    if (stageOrder === current.order) return 'failed';
    return 'pending';
  }
  if (stageOrder < current.order) return 'complete';
  if (stageOrder === current.order) return 'active';
  return 'pending';
}

export function isTerminalPhase(phase: SessionPhase): boolean {
  return phase === SESSION_PHASE.COMPLETE || phase === SESSION_PHASE.FAILED;
}
