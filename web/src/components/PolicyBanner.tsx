import { useMemo } from 'react';
import type { Policy, PolicyResult } from '../api/client';
import { PolicyBadge } from './PolicyBadge';

interface PolicyBannerProps {
  policies: Policy[];
  results: PolicyResult[];
}

export function PolicyBanner({ policies, results }: PolicyBannerProps) {
  const enabled = policies.filter((p) => p.enabled);
  const disabled = policies.filter((p) => !p.enabled);

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
    return { pass, fail, warn, skip, total: results.length };
  }, [results]);

  if (policies.length === 0) return null;

  return (
    <div className='bg-white rounded-xl p-5 shadow-sm mb-8'>
      <div className='flex items-center justify-between mb-3'>
        <div className='flex items-center gap-2'>
          <h2 className='text-sm font-semibold text-zinc-900 uppercase tracking-wide'>Policies</h2>
          <span className='text-xs text-zinc-500'>
            {enabled.length} enabled
            {disabled.length > 0 && ` · ${disabled.length} disabled`}
          </span>
        </div>
        {summary.total > 0 && (
          <div className='flex items-center gap-3 text-xs font-medium'>
            {summary.fail > 0 && (
              <span className='inline-flex items-center gap-1 text-red-600'>
                <span className='w-1.5 h-1.5 rounded-full bg-red-600' />
                {summary.fail} failed
              </span>
            )}
            {summary.warn > 0 && (
              <span className='inline-flex items-center gap-1 text-yellow-600'>
                <span className='w-1.5 h-1.5 rounded-full bg-yellow-500' />
                {summary.warn} warning{summary.warn === 1 ? '' : 's'}
              </span>
            )}
            {summary.pass > 0 && (
              <span className='inline-flex items-center gap-1 text-green-600'>
                <span className='w-1.5 h-1.5 rounded-full bg-green-600' />
                {summary.pass} passed
              </span>
            )}
            {summary.skip > 0 && (
              <span className='text-zinc-400' title='Skipped (target mismatch)'>
                {summary.skip} skipped
              </span>
            )}
          </div>
        )}
      </div>
      <div className='flex flex-wrap gap-2'>
        {policies.map((policy) => (
          <PolicyBadge key={policy.id} policy={policy} />
        ))}
      </div>
    </div>
  );
}
