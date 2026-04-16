import { useEffect, useState, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { api, Session, Artifact } from '../api/client';
import { useSSE } from '../hooks/useSSE';
import { PhaseTimeline } from '../components/PhaseTimeline';
import { ArtifactViewer } from '../components/ArtifactViewer';

function sourceLabel(source: Session['source']): string {
  if (source.type === 'example') return source.exampleName;
  if (source.type === 'github') return source.repoUrl;
  return source.filename;
}

const TAG_COLORS: Record<string, { bg: string; text: string }> = {
  context: { bg: 'bg-blue-100', text: 'text-blue-700' },
  dockerfile: { bg: 'bg-amber-100', text: 'text-amber-700' },
  manifest: { bg: 'bg-emerald-100', text: 'text-emerald-700' },
  'validation-report': { bg: 'bg-rose-100', text: 'text-rose-700' },
  plan: { bg: 'bg-violet-100', text: 'text-violet-700' },
  log: { bg: 'bg-zinc-100', text: 'text-zinc-600' },
};

function getTagColors(tag?: string): { bg: string; text: string } | null {
  if (!tag) return null;
  return TAG_COLORS[tag] || null;
}

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

export function SessionDetail() {
  const { id } = useParams<{ id: string }>();
  const [session, setSession] = useState<Session | null>(null);
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [selectedArtifact, setSelectedArtifact] = useState<Artifact | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [allLogs, setAllLogs] = useState<string[]>([]);
  const logsEndRef = useRef<HTMLDivElement>(null);

  const sseUrl = id ? api.getEventSourceUrl(id) : null;
  const { events, logs } = useSSE(sseUrl);

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [allLogs]);

  // Hydrate from API fetch
  useEffect(() => {
    if (!id) return;

    const fetchSession = async () => {
      try {
        const data = await api.getSession(id);
        setSession(data);
        // Hydrate artifacts and logs from the fetched session
        if (data.artifacts?.length) setArtifacts(data.artifacts);
        if (data.logs?.length) setAllLogs(data.logs);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load session');
      } finally {
        setLoading(false);
      }
    };

    fetchSession();
  }, [id]);

  useEffect(() => {
    events.forEach((event) => {
      if (event.type === 'phase_change' && event.phase) {
        setSession((prev) => (prev ? { ...prev, phase: event.phase! } : null));
      }
      if (event.type === 'artifact' && event.artifactId && id) {
        api
          .getSession(id)
          .then((data) => {
            setArtifacts(data.artifacts);
          })
          .catch(() => {});
      }
    });
  }, [events, id]);

  // Merge SSE logs (avoid duplicates by appending only new ones)
  useEffect(() => {
    if (logs.length > 0) {
      setAllLogs((prev) => {
        const newLogs = logs.filter((l) => !prev.includes(l));
        return newLogs.length > 0 ? [...prev, ...newLogs] : prev;
      });
    }
  }, [logs]);

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
        </div>
      </div>
    );
  }

  return (
    <div className='min-h-screen bg-zinc-50'>
      <div className='max-w-6xl mx-auto px-6 py-12'>
        <div className='mb-8'>
          <h1 className='text-4xl font-bold text-zinc-900 mb-2'>Session Details</h1>
          <p className='text-zinc-600 font-mono text-sm'>{sourceLabel(session.source)}</p>
        </div>

        <div className='grid grid-cols-1 lg:grid-cols-3 gap-8'>
          <div className='lg:col-span-1'>
            <div className='bg-white rounded-xl p-6 shadow-sm sticky top-6'>
              <h2 className='text-xl font-semibold text-zinc-900 mb-6'>Pipeline</h2>
              <PhaseTimeline currentPhase={session.phase} />
            </div>
          </div>

          <div className='lg:col-span-2 space-y-6'>
            <div className='bg-white rounded-xl p-6 shadow-sm'>
              <h2 className='text-xl font-semibold text-zinc-900 mb-4'>Session Info</h2>
              <div className='space-y-3'>
                <div className='flex justify-between'>
                  <span className='text-zinc-600'>ID</span>
                  <span className='font-mono text-sm text-zinc-900'>{session.id}</span>
                </div>
                <div className='flex justify-between'>
                  <span className='text-zinc-600'>Source</span>
                  <span className='text-zinc-900'>{session.source.type}</span>
                </div>
                <div className='flex justify-between'>
                  <span className='text-zinc-600'>Phase</span>
                  <span className='text-zinc-900'>{session.phase}</span>
                </div>
                <div className='flex justify-between'>
                  <span className='text-zinc-600'>Created</span>
                  <span className='text-zinc-900'>
                    {new Date(session.createdAt).toLocaleString()}
                  </span>
                </div>
                {session.policies &&
                  (session.policies.policySkills.length > 0 ||
                    session.policies.validationSkills.length > 0) && (
                    <div className='pt-3 border-t border-zinc-200'>
                      <span className='text-zinc-600 block mb-2'>Policies</span>
                      <div className='space-y-2'>
                        {session.policies.policySkills.length > 0 && (
                          <div className='flex flex-wrap gap-2'>
                            {session.policies.policySkills.map((skill) => (
                              <span
                                key={skill.id}
                                className='px-2.5 py-1 bg-violet-100 text-violet-700 rounded-full text-xs font-medium'
                              >
                                {skill.name}
                              </span>
                            ))}
                          </div>
                        )}
                        {session.policies.validationSkills.length > 0 && (
                          <div className='flex flex-wrap gap-2'>
                            {session.policies.validationSkills.map((skill) => (
                              <span
                                key={skill.id}
                                className='px-2.5 py-1 bg-emerald-100 text-emerald-700 rounded-full text-xs font-medium'
                              >
                                {skill.name}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
              </div>
            </div>

            {allLogs.length > 0 && (
              <div className='bg-white rounded-xl p-6 shadow-sm'>
                <h2 className='text-xl font-semibold text-zinc-900 mb-4'>Build Logs</h2>
                <div className='bg-zinc-900 rounded-lg p-4 max-h-80 overflow-y-auto'>
                  <div className='font-mono text-sm text-green-400 space-y-1'>
                    {allLogs.map((log, index) => (
                      <div key={index}>{log}</div>
                    ))}
                    <div ref={logsEndRef} />
                  </div>
                </div>
              </div>
            )}

            {artifacts.length > 0 && (
              <div className='bg-white rounded-xl p-6 shadow-sm'>
                <h2 className='text-xl font-semibold text-zinc-900 mb-4'>Artifacts</h2>
                <div className='space-y-4'>
                  {(() => {
                    const groupedByPhase = artifacts.reduce(
                      (acc, artifact) => {
                        const phase = artifact.phase;
                        if (!acc[phase]) acc[phase] = [];
                        acc[phase].push(artifact);
                        return acc;
                      },
                      {} as Record<string, Artifact[]>,
                    );

                    return Object.entries(groupedByPhase).map(([phase, phaseArtifacts]) => (
                      <div key={phase}>
                        <h3 className='text-xs font-semibold text-zinc-500 uppercase tracking-wide mb-2'>
                          {phase}
                        </h3>
                        <div className='space-y-2'>
                          {phaseArtifacts.map((artifact) => {
                            const tagColors = getTagColors(artifact.tag);
                            const validationData =
                              artifact.tag === 'validation-report'
                                ? parseValidationReport(artifact.content)
                                : null;

                            return (
                              <button
                                key={artifact.id}
                                onClick={() => handleArtifactClick(artifact.id)}
                                className='w-full text-left p-4 border border-zinc-200 rounded-lg hover:bg-zinc-50 transition-colors'
                              >
                                <div className='flex items-start justify-between'>
                                  <div className='flex-1'>
                                    <div className='flex items-center gap-2'>
                                      <p className='font-medium text-zinc-900'>{artifact.name}</p>
                                      {tagColors && (
                                        <span
                                          className={`px-2 py-0.5 rounded-full text-xs font-medium ${tagColors.bg} ${tagColors.text}`}
                                        >
                                          {artifact.tag}
                                        </span>
                                      )}
                                    </div>
                                    <p className='text-sm text-zinc-500 mt-1'>
                                      v{artifact.version}
                                    </p>

                                    {validationData && (
                                      <div className='mt-2 flex items-center gap-3'>
                                        {validationData.validationScore !== undefined &&
                                          validationData.validationGrade && (
                                            <span
                                              className={`text-sm font-semibold ${getGradeColor(validationData.validationGrade)}`}
                                            >
                                              Grade: {validationData.validationGrade} (
                                              {validationData.validationScore}/100)
                                            </span>
                                          )}
                                        {validationData.passed !== undefined && (
                                          <span className='text-sm'>
                                            {validationData.passed ? (
                                              <span className='text-green-600 flex items-center gap-1'>
                                                <svg
                                                  className='w-4 h-4'
                                                  fill='currentColor'
                                                  viewBox='0 0 20 20'
                                                >
                                                  <path
                                                    fillRule='evenodd'
                                                    d='M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z'
                                                    clipRule='evenodd'
                                                  />
                                                </svg>
                                                Passed
                                              </span>
                                            ) : (
                                              <span className='text-red-600 flex items-center gap-1'>
                                                <svg
                                                  className='w-4 h-4'
                                                  fill='currentColor'
                                                  viewBox='0 0 20 20'
                                                >
                                                  <path
                                                    fillRule='evenodd'
                                                    d='M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z'
                                                    clipRule='evenodd'
                                                  />
                                                </svg>
                                                Failed
                                              </span>
                                            )}
                                          </span>
                                        )}
                                      </div>
                                    )}
                                  </div>
                                  <svg
                                    className='w-5 h-5 text-zinc-400 mt-1 shrink-0'
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
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    ));
                  })()}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {selectedArtifact && (
        <ArtifactViewer artifact={selectedArtifact} onClose={() => setSelectedArtifact(null)} />
      )}
    </div>
  );
}
