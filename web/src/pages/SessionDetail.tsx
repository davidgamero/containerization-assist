import { useEffect, useRef, useState, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  api,
  ORDERED_STAGES,
  STAGES_BY_KEY,
  getStageState,
  isTerminalPhase,
  type Session,
  type Artifact,
  type Phase,
  type PolicyResult,
} from '../api/client';
import { useSSE } from '../hooks/useSSE';
import { useStageOrchestrator } from '../hooks/useStageOrchestrator';
import { PipelineStageCard } from '../components/PipelineStageCard';
import { ArtifactViewer } from '../components/ArtifactViewer';
import { PolicyBanner } from '../components/PolicyBanner';
import { StageProgressionHeader } from '../components/StageProgressionHeader';

function sourceLabel(source: Session['source']): string {
  if (source.type === 'example') return source.exampleName;
  if (source.type === 'github') return source.repoUrl;
  return source.filename;
}

const USER_SCROLL_SILENCE_MS = 3000;

export function SessionDetail() {
  const { id } = useParams<{ id: string }>();
  const [session, setSession] = useState<Session | null>(null);
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [selectedArtifact, setSelectedArtifact] = useState<Artifact | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [needsSSE, setNeedsSSE] = useState(false);
  const [livePolicyResults, setLivePolicyResults] = useState<PolicyResult[]>([]);

  const stageRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const lastUserScrollRef = useRef<number>(0);
  const previousPhaseRef = useRef<Phase | null>(null);

  const sseUrl = needsSSE && id ? api.getEventSourceUrl(id) : null;
  const { events, logs, policyResults: sseResults } = useSSE(sseUrl);

  useEffect(() => {
    if (sseResults.length === 0) return;
    setLivePolicyResults((prev) => {
      const seen = new Set(prev.map((r) => `${r.policyId}-${r.artifactId}`));
      const additions = sseResults.filter((r) => {
        const key = `${r.policyId}-${r.artifactId}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      return additions.length === 0 ? prev : [...prev, ...additions];
    });
  }, [sseResults]);

  useEffect(() => {
    if (!id) return;
    const fetchSession = async () => {
      try {
        const data = await api.getSession(id);
        setSession(data);
        if (data.artifacts?.length) setArtifacts(data.artifacts);
        setNeedsSSE(!isTerminalPhase(data.phase));
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load session');
      } finally {
        setLoading(false);
      }
    };
    fetchSession();
  }, [id]);

  useEffect(() => {
    for (const event of events) {
      if (event.type === 'phase_change' && event.phase) {
        setSession((prev) => (prev ? { ...prev, phase: event.phase! } : null));
      }
      if (event.type === 'artifact' && id) {
        api
          .getSession(id)
          .then((data) => setArtifacts(data.artifacts))
          .catch(() => {});
      }
    }
  }, [events, id]);

  const { currentPhase, phaseLogs, phaseTimings, artifactsByPhase, allPolicyResults } =
    useStageOrchestrator({
      session,
      events,
      logs,
      livePolicyResults,
      artifacts,
    });

  useEffect(() => {
    const onScroll = () => {
      lastUserScrollRef.current = Date.now();
    };
    window.addEventListener('wheel', onScroll, { passive: true });
    window.addEventListener('touchmove', onScroll, { passive: true });
    return () => {
      window.removeEventListener('wheel', onScroll);
      window.removeEventListener('touchmove', onScroll);
    };
  }, []);

  useEffect(() => {
    if (previousPhaseRef.current === currentPhase) return;
    previousPhaseRef.current = currentPhase;

    const sinceUserScroll = Date.now() - lastUserScrollRef.current;
    if (sinceUserScroll < USER_SCROLL_SILENCE_MS) return;

    const stage = STAGES_BY_KEY[currentPhase];
    if (!stage || stage.isTerminal) return;
    const el = stageRefs.current[currentPhase];
    if (!el) return;
    const offset = el.getBoundingClientRect().top + window.scrollY - 96;
    window.scrollTo({ top: offset, behavior: 'smooth' });
  }, [currentPhase]);

  const handleStageClick = useCallback((phase: Phase) => {
    const el = stageRefs.current[phase];
    if (!el) return;
    const offset = el.getBoundingClientRect().top + window.scrollY - 96;
    window.scrollTo({ top: offset, behavior: 'smooth' });
    el.classList.add('ring-2', 'ring-blue-300');
    window.setTimeout(() => el.classList.remove('ring-2', 'ring-blue-300'), 900);
  }, []);

  const handleArtifactClick = async (artifactId: string) => {
    if (!id) return;
    try {
      const artifact = await api.getArtifact(id, artifactId);
      setSelectedArtifact(artifact);
    } catch (err) {
      console.error('Failed to load artifact:', err);
    }
  };

  if (loading) {
    return (
      <div className='flex items-center justify-center min-h-screen'>
        <div className='w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin' />
      </div>
    );
  }

  if (error || !session) {
    return (
      <div className='flex items-center justify-center min-h-screen'>
        <div className='text-center'>
          <p className='text-red-600 text-lg'>{error || 'Session not found'}</p>
          <Link
            to='/'
            className='inline-block mt-4 text-sm text-blue-600 hover:text-blue-700 hover:underline'
          >
            &larr; Go home
          </Link>
        </div>
      </div>
    );
  }

  const isFailed = session.phase === 'failed';

  return (
    <div className='min-h-screen bg-zinc-50'>
      <div className='max-w-4xl mx-auto px-6 py-12'>
        <div className='mb-8'>
          <h1 className='text-4xl font-bold text-zinc-900 mb-2'>Session Details</h1>
          <p className='text-zinc-600 font-mono text-sm'>{sourceLabel(session.source)}</p>
        </div>

        <div className='bg-white rounded-xl p-5 shadow-sm mb-8'>
          <div className='flex flex-wrap gap-x-8 gap-y-2 text-sm'>
            <div>
              <span className='text-zinc-500'>ID</span>{' '}
              <span className='font-mono text-zinc-900'>{session.id}</span>
            </div>
            <div>
              <span className='text-zinc-500'>Source</span>{' '}
              <span className='text-zinc-900'>{session.source.type}</span>
            </div>
            <div>
              <span className='text-zinc-500'>Phase</span>{' '}
              <span className='text-zinc-900'>{session.phase}</span>
            </div>
            <div>
              <span className='text-zinc-500'>Created</span>{' '}
              <span className='text-zinc-900'>{new Date(session.createdAt).toLocaleString()}</span>
            </div>
          </div>
        </div>

        {session.policies && (
          <PolicyBanner policies={session.policies.policies} results={allPolicyResults} />
        )}

        <StageProgressionHeader
          currentPhase={currentPhase}
          phaseTimings={phaseTimings}
          policyResults={allPolicyResults}
          onStageClick={handleStageClick}
        />

        <div className='space-y-4 mt-6'>
          {ORDERED_STAGES.map((stage) => {
            const state = getStageState(stage.order, currentPhase, isFailed);
            const timing = phaseTimings[stage.key] ?? {};
            return (
              <PipelineStageCard
                key={stage.key}
                ref={(el) => {
                  stageRefs.current[stage.key] = el;
                }}
                phase={stage.key}
                label={stage.label}
                state={state}
                startTime={timing.start}
                endTime={timing.end}
                logs={phaseLogs[stage.key] ?? []}
                artifacts={artifactsByPhase[stage.key] ?? []}
                onArtifactClick={handleArtifactClick}
                policyResults={allPolicyResults.filter((r) => r.phase === stage.key)}
              />
            );
          })}
        </div>
      </div>

      {selectedArtifact && (
        <ArtifactViewer
          artifact={selectedArtifact}
          policyResults={allPolicyResults}
          onClose={() => setSelectedArtifact(null)}
        />
      )}
    </div>
  );
}
