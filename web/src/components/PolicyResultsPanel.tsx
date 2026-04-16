import { useMemo, useState } from 'react';
import type { PolicyOutcome, PolicyResult, PolicyViolation } from '../api/client';

interface PolicyResultsPanelProps {
  results: PolicyResult[];
}

const OUTCOME_STYLES: Record<
  PolicyOutcome,
  { icon: string; text: string; bg: string; dot: string; label: string }
> = {
  pass: {
    icon: '\u2713',
    text: 'text-green-700',
    bg: 'bg-green-50',
    dot: 'bg-green-500',
    label: 'pass',
  },
  fail: {
    icon: '\u2717',
    text: 'text-red-700',
    bg: 'bg-red-50',
    dot: 'bg-red-500',
    label: 'fail',
  },
  warn: {
    icon: '\u26a0',
    text: 'text-yellow-700',
    bg: 'bg-yellow-50',
    dot: 'bg-yellow-500',
    label: 'warn',
  },
  skip: {
    icon: '\u2298',
    text: 'text-zinc-500',
    bg: 'bg-zinc-50',
    dot: 'bg-zinc-300',
    label: 'skip',
  },
};

function ViolationRow({ v, severity }: { v: PolicyViolation; severity: 'violation' | 'warning' }) {
  const color = severity === 'violation' ? 'text-red-700' : 'text-yellow-700';
  const bg = severity === 'violation' ? 'bg-red-50' : 'bg-yellow-50';

  const copyRule = (e: React.MouseEvent) => {
    e.stopPropagation();
    void navigator.clipboard.writeText(v.rule);
  };

  return (
    <div className={`${bg} rounded px-2 py-1.5 text-xs ${color} flex items-start gap-2`}>
      <button
        onClick={copyRule}
        className='font-mono font-semibold shrink-0 hover:underline'
        title='Copy rule name'
      >
        {v.rule}
      </button>
      <span className='flex-1'>{v.message}</span>
      {v.line !== undefined && <span className='text-zinc-400 shrink-0 font-mono'>L{v.line}</span>}
    </div>
  );
}

export function PolicyResultsPanel({ results }: PolicyResultsPanelProps) {
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set());
  const [failuresOnly, setFailuresOnly] = useState(false);
  const [skippedExpanded, setSkippedExpanded] = useState(false);

  const summary = useMemo(() => {
    let pass = 0;
    let fail = 0;
    let warn = 0;
    let skip = 0;
    for (const r of results) {
      if (r.outcome === 'pass') pass++;
      else if (r.outcome === 'fail') fail++;
      else if (r.outcome === 'warn') warn++;
      else skip++;
    }
    return { pass, fail, warn, skip };
  }, [results]);

  const byArtifact = useMemo(() => {
    const map = new Map<string, { artifactName: string; results: PolicyResult[] }>();
    for (const r of results) {
      if (r.outcome === 'skip') continue;
      if (failuresOnly && r.outcome !== 'fail' && r.outcome !== 'warn') continue;
      let entry = map.get(r.artifactId);
      if (!entry) {
        entry = { artifactName: r.artifactName, results: [] };
        map.set(r.artifactId, entry);
      }
      entry.results.push(r);
    }
    return Array.from(map.entries());
  }, [results, failuresOnly]);

  const skipped = results.filter((r) => r.outcome === 'skip');

  if (results.length === 0) return null;

  const toggle = (key: string) => {
    setExpandedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  return (
    <div>
      <div className='flex items-center justify-between mb-2'>
        <div className='flex items-center gap-2'>
          <h4 className='text-xs font-semibold text-zinc-500 uppercase tracking-wide'>
            Policy Results
          </h4>
          <div className='flex items-center gap-2 text-xs'>
            {summary.fail > 0 && (
              <span className='text-red-600 font-medium'>{summary.fail} fail</span>
            )}
            {summary.warn > 0 && (
              <span className='text-yellow-600 font-medium'>{summary.warn} warn</span>
            )}
            {summary.pass > 0 && (
              <span className='text-green-600 font-medium'>{summary.pass} pass</span>
            )}
            {summary.skip > 0 && <span className='text-zinc-400'>{summary.skip} skip</span>}
          </div>
        </div>
        {(summary.fail > 0 || summary.warn > 0) && (
          <label className='flex items-center gap-1.5 text-xs text-zinc-500 cursor-pointer'>
            <input
              type='checkbox'
              checked={failuresOnly}
              onChange={(e) => setFailuresOnly(e.target.checked)}
              className='w-3 h-3'
            />
            Failures only
          </label>
        )}
      </div>

      <div className='border border-zinc-200 rounded-lg overflow-hidden'>
        {byArtifact.map(([artifactId, { artifactName, results: artifactResults }]) => (
          <div key={artifactId} className='border-b border-zinc-100 last:border-b-0'>
            <div className='px-3 py-1.5 bg-zinc-50 text-[11px] font-mono text-zinc-600 flex items-center justify-between'>
              <span className='truncate'>{artifactName}</span>
              <span className='text-zinc-400 shrink-0 ml-2'>
                {artifactResults.length} polic{artifactResults.length === 1 ? 'y' : 'ies'}
              </span>
            </div>
            <div className='divide-y divide-zinc-100'>
              {artifactResults.map((result) => {
                const style = OUTCOME_STYLES[result.outcome];
                const hasDetails = result.violations.length > 0 || result.warnings.length > 0;
                const key = `${result.policyId}-${result.artifactId}`;
                const isExpanded = expandedKeys.has(key);

                return (
                  <div key={key}>
                    <button
                      onClick={() => hasDetails && toggle(key)}
                      className={`w-full flex items-center gap-3 px-3 py-2 text-left text-sm ${hasDetails ? 'cursor-pointer hover:bg-zinc-50' : 'cursor-default'}`}
                    >
                      <span
                        className={`inline-flex items-center justify-center w-5 h-5 rounded ${style.bg} ${style.text} text-xs font-bold shrink-0`}
                        title={style.label}
                      >
                        {style.icon}
                      </span>
                      <span className='font-medium text-zinc-900 flex-1 truncate'>
                        {result.policyName}
                      </span>
                      {hasDetails && (
                        <span className='text-[10px] text-zinc-400 font-medium'>
                          {result.violations.length > 0 && `${result.violations.length}v`}
                          {result.violations.length > 0 && result.warnings.length > 0 && ' '}
                          {result.warnings.length > 0 && `${result.warnings.length}w`}
                        </span>
                      )}
                      {hasDetails && (
                        <svg
                          className={`w-3.5 h-3.5 text-zinc-400 transition-transform shrink-0 ${isExpanded ? 'rotate-90' : ''}`}
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
                    </button>
                    {isExpanded && hasDetails && (
                      <div className='px-3 pb-3 pl-9 space-y-1'>
                        {result.violations.map((v, i) => (
                          <ViolationRow key={`v-${i}`} v={v} severity='violation' />
                        ))}
                        {result.warnings.map((w, i) => (
                          <ViolationRow key={`w-${i}`} v={w} severity='warning' />
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}

        {byArtifact.length === 0 && failuresOnly && (
          <div className='px-3 py-6 text-center text-xs text-zinc-400'>
            No failures or warnings to show
          </div>
        )}

        {skipped.length > 0 && (
          <div className='border-t border-zinc-100 bg-zinc-50/50'>
            <button
              onClick={() => setSkippedExpanded(!skippedExpanded)}
              className='w-full flex items-center gap-2 px-3 py-2 text-xs text-zinc-500 hover:bg-zinc-100 transition-colors'
            >
              <svg
                className={`w-3 h-3 transition-transform ${skippedExpanded ? 'rotate-90' : ''}`}
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
              <span>{skipped.length} skipped (target mismatch)</span>
            </button>
            {skippedExpanded && (
              <div className='px-3 pb-2 pl-8 space-y-0.5'>
                {skipped.map((r, i) => (
                  <div key={i} className='text-[11px] text-zinc-500 flex gap-2'>
                    <span className='font-medium truncate'>{r.policyName}</span>
                    <span className='text-zinc-400 font-mono truncate'>{r.artifactName}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
