import { useState, useRef, useEffect, forwardRef, useMemo } from 'react';
import { Phase, Artifact, PolicyResult } from '../api/client';
import { PolicyResultsPanel } from './PolicyResultsPanel';
import { ArtifactPolicyPill } from './ArtifactPolicyPill';

const TAG_COLORS: Record<string, { bg: string; text: string }> = {
  context: { bg: 'bg-blue-100', text: 'text-blue-700' },
  dockerfile: { bg: 'bg-amber-100', text: 'text-amber-700' },
  manifest: { bg: 'bg-emerald-100', text: 'text-emerald-700' },
  'validation-report': { bg: 'bg-rose-100', text: 'text-rose-700' },
  plan: { bg: 'bg-violet-100', text: 'text-violet-700' },
  log: { bg: 'bg-zinc-100', text: 'text-zinc-600' },
};

function parseValidationReport(content: string): {
  validationScore?: number;
  validationGrade?: string;
  passed?: boolean;
} | null {
  try {
    return JSON.parse(content);
  } catch {
    return null;
  }
}

function getGradeColor(grade?: string): string {
  if (!grade) return 'text-zinc-600';
  if (grade === 'A' || grade === 'B') return 'text-green-600';
  if (grade === 'C') return 'text-yellow-600';
  return 'text-red-600';
}

type ArtifactPolicyOutcome = 'fail' | 'warn' | 'pass' | 'skip' | 'none';

function worstOutcome(results: PolicyResult[]): ArtifactPolicyOutcome {
  if (results.length === 0) return 'none';
  if (results.some((r) => r.outcome === 'fail')) return 'fail';
  if (results.some((r) => r.outcome === 'warn')) return 'warn';
  if (results.some((r) => r.outcome === 'pass')) return 'pass';
  return 'skip';
}

function artifactOutcomeRing(outcome: ArtifactPolicyOutcome): string {
  switch (outcome) {
    case 'fail':
      return 'ring-2 ring-red-400';
    case 'warn':
      return 'ring-2 ring-yellow-400';
    case 'pass':
      return 'ring-1 ring-green-400';
    default:
      return '';
  }
}

const LOG_PREVIEW_LINES = 5;

export type StageState = 'pending' | 'active' | 'complete' | 'failed';

interface PipelineStageCardProps {
  phase: Phase;
  label: string;
  state: StageState;
  startTime?: string;
  endTime?: string;
  logs: string[];
  artifacts: Artifact[];
  policyResults: PolicyResult[];
  onArtifactClick: (id: string) => void;
}

function formatTime(iso?: string): string {
  if (!iso) return '\u2014';
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function StateIcon({ state }: { state: StageState }) {
  if (state === 'complete') {
    return (
      <svg className='w-5 h-5 text-green-600' fill='none' stroke='currentColor' viewBox='0 0 24 24'>
        <path strokeLinecap='round' strokeLinejoin='round' strokeWidth={2} d='M5 13l4 4L19 7' />
      </svg>
    );
  }
  if (state === 'active') {
    return (
      <div className='w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin' />
    );
  }
  if (state === 'failed') {
    return (
      <svg className='w-5 h-5 text-red-600' fill='none' stroke='currentColor' viewBox='0 0 24 24'>
        <path
          strokeLinecap='round'
          strokeLinejoin='round'
          strokeWidth={2}
          d='M6 18L18 6M6 6l12 12'
        />
      </svg>
    );
  }
  return <div className='w-2.5 h-2.5 rounded-full bg-zinc-300' />;
}

function stateBorderColor(state: StageState): string {
  switch (state) {
    case 'complete':
      return 'border-green-200';
    case 'active':
      return 'border-blue-300';
    case 'failed':
      return 'border-red-200';
    default:
      return 'border-zinc-200';
  }
}

function stateHeaderBg(state: StageState): string {
  switch (state) {
    case 'complete':
      return 'bg-green-50';
    case 'active':
      return 'bg-blue-50';
    case 'failed':
      return 'bg-red-50';
    default:
      return 'bg-zinc-50';
  }
}

function stateLabel(state: StageState): string {
  switch (state) {
    case 'complete':
      return 'complete';
    case 'active':
      return 'active';
    case 'failed':
      return 'failed';
    default:
      return 'pending';
  }
}

function stateLabelColor(state: StageState): string {
  switch (state) {
    case 'complete':
      return 'text-green-600';
    case 'active':
      return 'text-blue-600';
    case 'failed':
      return 'text-red-600';
    default:
      return 'text-zinc-400';
  }
}

export const PipelineStageCard = forwardRef<HTMLDivElement, PipelineStageCardProps>(
  function PipelineStageCard(
    { label, state, startTime, endTime, logs, artifacts, policyResults, onArtifactClick },
    ref,
  ) {
    const [logsExpanded, setLogsExpanded] = useState(false);
    const logsContainerRef = useRef<HTMLDivElement>(null);
    const stickToBottomRef = useRef(true);
    const isPending = state === 'pending';
    const hasLogs = logs.length > 0;
    const needsTruncation = logs.length > LOG_PREVIEW_LINES;
    const visibleLogs = logsExpanded ? logs : logs.slice(0, LOG_PREVIEW_LINES);

    const policySummary = {
      fail: policyResults.filter((r) => r.outcome === 'fail').length,
      warn: policyResults.filter((r) => r.outcome === 'warn').length,
    };

    const resultsByArtifact = useMemo(() => {
      const map = new Map<string, PolicyResult[]>();
      for (const r of policyResults) {
        const list = map.get(r.artifactId) ?? [];
        list.push(r);
        map.set(r.artifactId, list);
      }
      return map;
    }, [policyResults]);

    const handleLogsScroll = () => {
      const el = logsContainerRef.current;
      if (!el) return;
      const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
      stickToBottomRef.current = distanceFromBottom < 24;
    };

    useEffect(() => {
      if (state !== 'active') return;
      if (!stickToBottomRef.current) return;
      const el = logsContainerRef.current;
      if (!el) return;
      el.scrollTop = el.scrollHeight;
    }, [logs.length, state]);

    return (
      <div
        ref={ref}
        className={`rounded-xl border shadow-sm overflow-hidden ${stateBorderColor(state)} ${isPending ? 'opacity-60' : ''}`}
      >
        <div className={`flex items-center justify-between px-5 py-3 ${stateHeaderBg(state)}`}>
          <div className='flex items-center gap-3'>
            <StateIcon state={state} />
            <h3
              className={`text-sm font-semibold ${isPending ? 'text-zinc-400' : 'text-zinc-900'}`}
            >
              {label}
            </h3>
            {policySummary.fail > 0 && (
              <span
                className='inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-100 text-red-700 text-[10px] font-semibold uppercase tracking-wide'
                title='Policy failures in this stage'
              >
                <span className='w-1.5 h-1.5 rounded-full bg-red-600' />
                {policySummary.fail} policy fail{policySummary.fail === 1 ? '' : 's'}
              </span>
            )}
            {policySummary.warn > 0 && policySummary.fail === 0 && (
              <span
                className='inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-yellow-100 text-yellow-700 text-[10px] font-semibold uppercase tracking-wide'
                title='Policy warnings in this stage'
              >
                <span className='w-1.5 h-1.5 rounded-full bg-yellow-500' />
                {policySummary.warn} warn{policySummary.warn === 1 ? '' : 's'}
              </span>
            )}
          </div>
          <span className={`text-xs font-medium ${stateLabelColor(state)}`}>
            {stateLabel(state)}
          </span>
        </div>

        {!isPending && (
          <div className='bg-white px-5 py-4 space-y-4'>
            <div className='flex gap-6 text-xs text-zinc-500'>
              <span>
                Started: <span className='font-mono text-zinc-700'>{formatTime(startTime)}</span>
              </span>
              <span>
                Ended: <span className='font-mono text-zinc-700'>{formatTime(endTime)}</span>
              </span>
            </div>

            {hasLogs && (
              <div>
                <h4 className='text-xs font-semibold text-zinc-500 uppercase tracking-wide mb-2'>
                  Logs
                </h4>
                <div
                  ref={logsContainerRef}
                  onScroll={handleLogsScroll}
                  className='bg-zinc-900 rounded-lg p-3 max-h-80 overflow-y-auto'
                >
                  <div className='font-mono text-xs text-green-400 space-y-0.5'>
                    {visibleLogs.map((line, i) => (
                      <div key={i}>{line}</div>
                    ))}
                  </div>
                  {needsTruncation && (
                    <button
                      onClick={() => setLogsExpanded(!logsExpanded)}
                      className='mt-2 text-xs text-blue-400 hover:text-blue-300 transition-colors'
                    >
                      {logsExpanded ? '\u25b2 Collapse' : `\u25bc Show all (${logs.length} lines)`}
                    </button>
                  )}
                </div>
              </div>
            )}

            {artifacts.length > 0 && (
              <div>
                <h4 className='text-xs font-semibold text-zinc-500 uppercase tracking-wide mb-2'>
                  Artifacts
                </h4>
                <div className='flex flex-wrap gap-2'>
                  {artifacts.map((artifact) => {
                    const tagColors = TAG_COLORS[artifact.tag ?? ''];
                    const validationData =
                      artifact.tag === 'validation-report'
                        ? parseValidationReport(artifact.content)
                        : null;
                    const artifactResults = resultsByArtifact.get(artifact.id) ?? [];
                    const outcome = worstOutcome(artifactResults);
                    const topFail = artifactResults.find((r) => r.outcome === 'fail');
                    const failCount = artifactResults.filter((r) => r.outcome === 'fail').length;
                    const topWarn = !topFail && artifactResults.find((r) => r.outcome === 'warn');
                    const warnCount = artifactResults.filter((r) => r.outcome === 'warn').length;

                    return (
                      <div
                        key={artifact.id}
                        className={`flex flex-col gap-1 ${artifactOutcomeRing(outcome)} rounded-lg`}
                      >
                        <div
                          className={`inline-flex items-center gap-1.5 pl-3 pr-1.5 py-1 rounded-lg border text-sm font-medium ${
                            tagColors
                              ? `${tagColors.bg} ${tagColors.text} border-transparent`
                              : 'bg-zinc-50 text-zinc-700 border-zinc-200'
                          }`}
                        >
                          <button
                            onClick={() => onArtifactClick(artifact.id)}
                            className='inline-flex items-center gap-1.5 hover:opacity-80 transition-opacity'
                          >
                            <span>{artifact.name}</span>
                            <span className='text-[10px] opacity-70'>v{artifact.version}</span>
                            {validationData && validationData.validationGrade && (
                              <span
                                className={`ml-1 text-xs font-semibold ${getGradeColor(validationData.validationGrade)}`}
                              >
                                {validationData.validationGrade}
                              </span>
                            )}
                            {validationData && validationData.passed !== undefined && (
                              <span
                                className={`ml-0.5 text-xs ${validationData.passed ? 'text-green-600' : 'text-red-600'}`}
                              >
                                {validationData.passed ? '\u2713' : '\u2717'}
                              </span>
                            )}
                            <svg
                              className='w-3.5 h-3.5 opacity-40 shrink-0'
                              fill='none'
                              stroke='currentColor'
                              viewBox='0 0 24 24'
                            >
                              <path
                                strokeLinecap='round'
                                strokeLinejoin='round'
                                strokeWidth={2}
                                d='M9 5l7 7-7 7'
                              />
                            </svg>
                          </button>
                          {artifactResults.length > 0 && (
                            <ArtifactPolicyPill results={artifactResults} />
                          )}
                        </div>
                        {topFail && (
                          <div
                            className='text-[10px] text-red-700 font-medium px-2 truncate max-w-[260px]'
                            title={topFail.policyName}
                          >
                            {'\u26d4 '}
                            {topFail.policyName}
                            {failCount > 1 && (
                              <span className='text-red-500 font-normal'> +{failCount - 1}</span>
                            )}
                          </div>
                        )}
                        {topWarn && (
                          <div
                            className='text-[10px] text-yellow-700 font-medium px-2 truncate max-w-[260px]'
                            title={topWarn.policyName}
                          >
                            {'\u26a0 '}
                            {topWarn.policyName}
                            {warnCount > 1 && (
                              <span className='text-yellow-600 font-normal'> +{warnCount - 1}</span>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {policyResults.length > 0 && <PolicyResultsPanel results={policyResults} />}
          </div>
        )}
      </div>
    );
  },
);
