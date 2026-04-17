import { useEffect, useRef, useState } from 'react';
import {
  ORDERED_STAGES,
  getStageState,
  type Phase,
  type PolicyResult,
  type StageDefinition,
  type StageState,
} from '../api/client';
import type { PhaseTiming } from '../hooks/useStageOrchestrator';

interface Props {
  currentPhase: Phase;
  phaseTimings: Record<string, PhaseTiming>;
  policyResults: PolicyResult[];
  onStageClick: (phase: Phase) => void;
}

function formatDuration(start?: string, end?: string): string {
  if (!start) return '';
  const startMs = new Date(start).getTime();
  const endMs = end ? new Date(end).getTime() : Date.now();
  const sec = Math.max(0, Math.floor((endMs - startMs) / 1000));
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}m ${s.toString().padStart(2, '0')}s`;
}

function pillClasses(state: StageState): string {
  switch (state) {
    case 'complete':
      return 'bg-green-50 text-green-700 border-green-200';
    case 'active':
      return 'bg-blue-50 text-blue-700 border-blue-300 ring-2 ring-blue-200';
    case 'failed':
      return 'bg-red-50 text-red-700 border-red-200';
    default:
      return 'bg-zinc-50 text-zinc-400 border-zinc-200';
  }
}

function StageIcon({ state }: { state: StageState }) {
  if (state === 'complete') {
    return (
      <svg className='w-3 h-3' fill='none' stroke='currentColor' viewBox='0 0 24 24'>
        <path strokeLinecap='round' strokeLinejoin='round' strokeWidth={3} d='M5 13l4 4L19 7' />
      </svg>
    );
  }
  if (state === 'active') {
    return (
      <div className='w-2.5 h-2.5 border-2 border-current border-t-transparent rounded-full animate-spin' />
    );
  }
  if (state === 'failed') {
    return (
      <svg className='w-3 h-3' fill='none' stroke='currentColor' viewBox='0 0 24 24'>
        <path
          strokeLinecap='round'
          strokeLinejoin='round'
          strokeWidth={3}
          d='M6 18L18 6M6 6l12 12'
        />
      </svg>
    );
  }
  return <div className='w-1.5 h-1.5 rounded-full bg-current opacity-50' />;
}

function StagePill({
  stage,
  state,
  timing,
  policySummary,
  onClick,
  isActive,
}: {
  stage: StageDefinition;
  state: StageState;
  timing: PhaseTiming | undefined;
  policySummary: { fail: number; warn: number };
  onClick: () => void;
  isActive: boolean;
}) {
  const duration = state === 'pending' ? '' : formatDuration(timing?.start, timing?.end);

  return (
    <button
      onClick={onClick}
      title={stage.description}
      className={`group flex items-center gap-1.5 px-3 py-1.5 rounded-lg border transition-all hover:brightness-95 shrink-0 ${pillClasses(
        state,
      )}`}
    >
      <StageIcon state={state} />
      <span className={`text-xs font-semibold ${isActive ? 'animate-pulse' : ''}`}>
        {stage.shortLabel}
      </span>
      {policySummary.fail > 0 && (
        <span className='w-1.5 h-1.5 rounded-full bg-red-500' title='Policy fails' />
      )}
      {policySummary.fail === 0 && policySummary.warn > 0 && (
        <span className='w-1.5 h-1.5 rounded-full bg-yellow-500' title='Policy warns' />
      )}
      {duration && <span className='text-[10px] font-mono opacity-70'>{duration}</span>}
    </button>
  );
}

export function StageProgressionHeader({
  currentPhase,
  phaseTimings,
  policyResults,
  onStageClick,
}: Props) {
  const [tick, setTick] = useState(0);
  const isFailed = currentPhase === 'failed';
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const active = ORDERED_STAGES.find(
      (s) => getStageState(s.order, currentPhase, isFailed) === 'active',
    );
    if (!active) return;
    const id = window.setInterval(() => setTick((n) => n + 1), 1000);
    return () => window.clearInterval(id);
  }, [currentPhase, isFailed]);

  void tick;

  useEffect(() => {
    const activeIdx = ORDERED_STAGES.findIndex(
      (s) => getStageState(s.order, currentPhase, isFailed) === 'active',
    );
    if (activeIdx < 0 || !containerRef.current) return;
    const pillEl = containerRef.current.children[activeIdx] as HTMLElement | undefined;
    pillEl?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
  }, [currentPhase, isFailed]);

  return (
    <div className='sticky top-0 z-20 bg-zinc-50/95 backdrop-blur border-b border-zinc-200 -mx-6 px-6 py-3'>
      <div ref={containerRef} className='flex items-center gap-2 overflow-x-auto scrollbar-thin'>
        {ORDERED_STAGES.map((stage, idx) => {
          const state = getStageState(stage.order, currentPhase, isFailed);
          const stagePolicies = policyResults.filter((r) => r.phase === stage.key);
          const policySummary = {
            fail: stagePolicies.filter((r) => r.outcome === 'fail').length,
            warn: stagePolicies.filter((r) => r.outcome === 'warn').length,
          };

          return (
            <div key={stage.key} className='flex items-center gap-2 shrink-0'>
              <StagePill
                stage={stage}
                state={state}
                timing={phaseTimings[stage.key]}
                policySummary={policySummary}
                onClick={() => onStageClick(stage.key)}
                isActive={state === 'active'}
              />
              {idx < ORDERED_STAGES.length - 1 && (
                <svg
                  className='w-3 h-3 text-zinc-300 shrink-0'
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
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
