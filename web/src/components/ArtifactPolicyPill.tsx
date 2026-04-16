import { useState, useRef, useEffect } from 'react';
import type { PolicyResult } from '../api/client';

interface Props {
  results: PolicyResult[];
}

function outcomeIcon(outcome: PolicyResult['outcome']): string {
  if (outcome === 'pass') return '\u2713';
  if (outcome === 'fail') return '\u2717';
  if (outcome === 'warn') return '\u26a0';
  return '\u2014';
}

function outcomeTextColor(outcome: PolicyResult['outcome']): string {
  if (outcome === 'pass') return 'text-green-600';
  if (outcome === 'fail') return 'text-red-600';
  if (outcome === 'warn') return 'text-yellow-600';
  return 'text-zinc-400';
}

export function ArtifactPolicyPill({ results }: Props) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (!wrapperRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const evaluated = results.filter((r) => r.outcome !== 'skip');
  const skipped = results.filter((r) => r.outcome === 'skip');
  const total = evaluated.length;
  if (total === 0 && skipped.length === 0) return null;

  const failed = evaluated.filter((r) => r.outcome === 'fail');
  const warned = evaluated.filter((r) => r.outcome === 'warn');
  const passed = evaluated.filter((r) => r.outcome === 'pass');

  const pillBorder =
    failed.length > 0
      ? 'border-red-200 hover:bg-red-50'
      : warned.length > 0
        ? 'border-yellow-200 hover:bg-yellow-50'
        : total > 0
          ? 'border-green-200 hover:bg-green-50'
          : 'border-zinc-200 hover:bg-zinc-50';

  return (
    <div ref={wrapperRef} className='relative inline-block'>
      <button
        type='button'
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border bg-white text-[10px] font-semibold transition-colors ${pillBorder}`}
        title='Policies that ran on this artifact'
      >
        {passed.length > 0 && (
          <span className='inline-flex items-center gap-0.5 text-green-700'>
            <span>{'\u2713'}</span>
            {passed.length}
          </span>
        )}
        {failed.length > 0 && (
          <span className='inline-flex items-center gap-0.5 text-red-700'>
            <span>{'\u2717'}</span>
            {failed.length}
          </span>
        )}
        {warned.length > 0 && (
          <span className='inline-flex items-center gap-0.5 text-yellow-700'>
            <span>{'\u26a0'}</span>
            {warned.length}
          </span>
        )}
        {skipped.length > 0 && (
          <span className='inline-flex items-center gap-0.5 text-zinc-400'>
            <span>{'\u2298'}</span>
            {skipped.length}
          </span>
        )}
      </button>
      {open && (
        <div
          onClick={(e) => e.stopPropagation()}
          className='absolute z-30 mt-1 right-0 w-72 bg-white border border-zinc-200 rounded-lg shadow-lg p-3 text-xs space-y-2'
        >
          <div className='flex items-center justify-between'>
            <span className='font-semibold text-zinc-900'>Policy results</span>
            <button
              onClick={() => setOpen(false)}
              className='text-zinc-400 hover:text-zinc-600'
              aria-label='Close'
            >
              <svg className='w-3.5 h-3.5' fill='currentColor' viewBox='0 0 20 20'>
                <path
                  fillRule='evenodd'
                  d='M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z'
                  clipRule='evenodd'
                />
              </svg>
            </button>
          </div>
          {total > 0 && (
            <div className='space-y-1'>
              {evaluated.map((r) => (
                <div
                  key={`${r.policyId}-${r.artifactId}`}
                  className='flex items-start gap-2 py-1 border-b border-zinc-50 last:border-0'
                >
                  <span className={`font-mono shrink-0 ${outcomeTextColor(r.outcome)}`}>
                    {outcomeIcon(r.outcome)}
                  </span>
                  <div className='min-w-0 flex-1'>
                    <div className='font-medium text-zinc-800 truncate'>{r.policyName}</div>
                    {r.violations.length > 0 && (
                      <div className='mt-0.5 text-[10px] text-red-600'>
                        {r.violations[0].message}
                        {r.violations.length > 1 && ` +${r.violations.length - 1} more`}
                      </div>
                    )}
                    {r.warnings.length > 0 && r.violations.length === 0 && (
                      <div className='mt-0.5 text-[10px] text-yellow-700'>
                        {r.warnings[0].message}
                        {r.warnings.length > 1 && ` +${r.warnings.length - 1} more`}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
          {skipped.length > 0 && (
            <div className='pt-2 border-t border-zinc-100'>
              <div className='text-[10px] uppercase tracking-wide text-zinc-400 mb-1'>
                Skipped ({skipped.length}) &middot; target mismatch
              </div>
              <div className='flex flex-wrap gap-1'>
                {skipped.map((r) => (
                  <span
                    key={`${r.policyId}-${r.artifactId}`}
                    className='px-1.5 py-0.5 rounded bg-zinc-100 text-zinc-500 text-[10px]'
                  >
                    {r.policyName}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
