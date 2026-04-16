import { useMemo, useState } from 'react';
import { Artifact, PolicyResult } from '../api/client';

interface ArtifactViewerProps {
  artifact: Artifact;
  policyResults?: PolicyResult[];
  onClose: () => void;
}

function outcomeBadge(outcome: PolicyResult['outcome']): { label: string; className: string } {
  switch (outcome) {
    case 'fail':
      return { label: 'FAIL', className: 'bg-red-100 text-red-700 border-red-200' };
    case 'warn':
      return { label: 'WARN', className: 'bg-yellow-100 text-yellow-700 border-yellow-200' };
    case 'pass':
      return { label: 'PASS', className: 'bg-green-100 text-green-700 border-green-200' };
    default:
      return { label: 'SKIP', className: 'bg-zinc-100 text-zinc-500 border-zinc-200' };
  }
}

export function ArtifactViewer({ artifact, policyResults, onClose }: ArtifactViewerProps) {
  const isJSON = artifact.contentType.includes('json');
  const artifactPolicies = useMemo(
    () => (policyResults ?? []).filter((r) => r.artifactId === artifact.id),
    [policyResults, artifact.id],
  );
  const failCount = artifactPolicies.filter((r) => r.outcome === 'fail').length;
  const warnCount = artifactPolicies.filter((r) => r.outcome === 'warn').length;
  const [policyOpen, setPolicyOpen] = useState(failCount > 0 || warnCount > 0);

  const formatContent = () => {
    if (isJSON) {
      try {
        const parsed = JSON.parse(artifact.content);
        return JSON.stringify(parsed, null, 2);
      } catch {
        return artifact.content;
      }
    }
    return artifact.content;
  };

  return (
    <div className='fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50'>
      <div className='bg-white rounded-xl shadow-2xl max-w-4xl w-full max-h-[80vh] flex flex-col'>
        <div className='flex items-center justify-between p-6 border-b border-zinc-200'>
          <div>
            <h2 className='text-xl font-semibold text-zinc-900'>{artifact.name}</h2>
            <p className='text-sm text-zinc-500 mt-1'>
              {artifact.phase} • v{artifact.version}
            </p>
          </div>
          <button onClick={onClose} className='p-2 hover:bg-zinc-100 rounded-lg transition-colors'>
            <svg
              className='w-5 h-5 text-zinc-500'
              fill='none'
              stroke='currentColor'
              viewBox='0 0 24 24'
            >
              <path
                strokeLinecap='round'
                strokeLinejoin='round'
                strokeWidth={2}
                d='M6 18L18 6M6 6l12 12'
              />
            </svg>
          </button>
        </div>

        <div className='flex-1 overflow-auto p-6 space-y-4'>
          {artifactPolicies.length > 0 && (
            <div className='border border-zinc-200 rounded-lg overflow-hidden'>
              <button
                type='button'
                onClick={() => setPolicyOpen((v) => !v)}
                className='w-full flex items-center justify-between px-4 py-2.5 bg-zinc-50 hover:bg-zinc-100 transition-colors text-left'
              >
                <div className='flex items-center gap-2'>
                  <span className='text-sm font-semibold text-zinc-900'>Policy results</span>
                  <span className='text-xs text-zinc-500'>
                    ({artifactPolicies.length} evaluated)
                  </span>
                  {failCount > 0 && (
                    <span className='px-2 py-0.5 rounded-full bg-red-100 text-red-700 text-[10px] font-semibold uppercase tracking-wide'>
                      {failCount} fail{failCount === 1 ? '' : 's'}
                    </span>
                  )}
                  {warnCount > 0 && failCount === 0 && (
                    <span className='px-2 py-0.5 rounded-full bg-yellow-100 text-yellow-700 text-[10px] font-semibold uppercase tracking-wide'>
                      {warnCount} warn{warnCount === 1 ? '' : 's'}
                    </span>
                  )}
                </div>
                <svg
                  className={`w-4 h-4 text-zinc-500 transition-transform ${policyOpen ? 'rotate-90' : ''}`}
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
              {policyOpen && (
                <div className='divide-y divide-zinc-100'>
                  {artifactPolicies.map((r) => {
                    const badge = outcomeBadge(r.outcome);
                    return (
                      <div key={`${r.policyId}-${r.artifactId}`} className='px-4 py-3 text-sm'>
                        <div className='flex items-center gap-2'>
                          <span
                            className={`px-1.5 py-0.5 rounded border text-[10px] font-semibold ${badge.className}`}
                          >
                            {badge.label}
                          </span>
                          <span className='font-medium text-zinc-900'>{r.policyName}</span>
                        </div>
                        {r.violations.length > 0 && (
                          <ul className='mt-1.5 space-y-0.5 text-xs text-red-700 list-disc list-inside'>
                            {r.violations.map((v, i) => (
                              <li key={i}>{v.message}</li>
                            ))}
                          </ul>
                        )}
                        {r.warnings.length > 0 && (
                          <ul className='mt-1.5 space-y-0.5 text-xs text-yellow-700 list-disc list-inside'>
                            {r.warnings.map((w, i) => (
                              <li key={i}>{w.message}</li>
                            ))}
                          </ul>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
          <pre className='text-sm font-mono bg-zinc-50 p-4 rounded-lg overflow-x-auto'>
            {formatContent()}
          </pre>
        </div>
      </div>
    </div>
  );
}
