import { useEffect, useMemo, useState } from 'react';
import type { Artifact, Phase, PolicyResult, SessionEvent, Session } from '../api/client';

export interface PhaseTiming {
  start?: string;
  end?: string;
}

export interface StageOrchestratorInput {
  session: Session | null;
  events: SessionEvent[];
  logs: string[];
  livePolicyResults: PolicyResult[];
  artifacts: Artifact[];
}

export interface StageOrchestratorState {
  currentPhase: Phase;
  phaseLogs: Record<string, string[]>;
  phaseTimings: Record<string, PhaseTiming>;
  artifactsByPhase: Record<string, Artifact[]>;
  allPolicyResults: PolicyResult[];
}

export function useStageOrchestrator(input: StageOrchestratorInput): StageOrchestratorState {
  const { session, events, logs, livePolicyResults, artifacts } = input;

  const [phaseLogs, setPhaseLogs] = useState<Record<string, string[]>>({});
  const [phaseTimings, setPhaseTimings] = useState<Record<string, PhaseTiming>>({});
  const [currentLogPhase, setCurrentLogPhase] = useState<Phase>('pending');

  useEffect(() => {
    if (!session) return;
    setCurrentLogPhase(session.phase);
    if (session.logs?.length) {
      setPhaseLogs((prev) => (prev[session.phase] ? prev : { [session.phase]: session.logs }));
    }
  }, [session]);

  useEffect(() => {
    for (const event of events) {
      if (event.type === 'phase_change' && event.phase) {
        setPhaseTimings((prev) => {
          const updated = { ...prev };
          if (prev[currentLogPhase] && !prev[currentLogPhase].end) {
            updated[currentLogPhase] = { ...prev[currentLogPhase], end: event.timestamp };
          }
          if (!updated[event.phase!]?.start) {
            updated[event.phase!] = { ...(prev[event.phase!] ?? {}), start: event.timestamp };
          }
          return updated;
        });
        setCurrentLogPhase(event.phase);
      }
    }
  }, [events, currentLogPhase]);

  useEffect(() => {
    if (logs.length === 0) return;
    setPhaseLogs((prev) => {
      const existing = prev[currentLogPhase] ?? [];
      const additions = logs.filter((l) => !existing.includes(l));
      if (additions.length === 0) return prev;
      return { ...prev, [currentLogPhase]: [...existing, ...additions] };
    });
  }, [logs, currentLogPhase]);

  const artifactsByPhase = useMemo(() => {
    return artifacts.reduce<Record<string, Artifact[]>>((acc, artifact) => {
      const phase = artifact.phase;
      if (!acc[phase]) acc[phase] = [];
      acc[phase].push(artifact);
      return acc;
    }, {});
  }, [artifacts]);

  const allPolicyResults = useMemo(() => {
    const stored = session?.policies?.results ?? [];
    const seen = new Set(stored.map((r) => `${r.policyId}-${r.artifactId}`));
    const merged = [...stored];
    for (const r of livePolicyResults) {
      const key = `${r.policyId}-${r.artifactId}`;
      if (!seen.has(key)) {
        seen.add(key);
        merged.push(r);
      }
    }
    return merged;
  }, [session?.policies?.results, livePolicyResults]);

  return {
    currentPhase: session?.phase ?? 'pending',
    phaseLogs,
    phaseTimings,
    artifactsByPhase,
    allPolicyResults,
  };
}
