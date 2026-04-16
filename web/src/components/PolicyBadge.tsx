import { useState } from 'react';
import type { Policy } from '../api/client';

function extractRegoStringSet(rego: string, ruleName: string): string[] | null {
  const re = new RegExp(`${ruleName}\\s*:=\\s*\\{([^}]*)\\}`);
  const match = rego.match(re);
  if (!match) return null;
  const items = [...match[1].matchAll(/"([^"\\]*(?:\\.[^"\\]*)*)"/g)].map((m) => m[1]);
  return items.length > 0 ? items : null;
}

function extractAllowlistImages(policy: Policy): string[] | null {
  if (policy.id !== 'image-allowlist') return null;
  const fromConfig = policy.config?.allowed_images;
  if (Array.isArray(fromConfig) && fromConfig.every((v) => typeof v === 'string')) {
    return fromConfig as string[];
  }
  if (policy.rego) return extractRegoStringSet(policy.rego, 'allowed_images');
  return null;
}

const TYPE_STYLES: Record<string, { icon: string; label: string; title: string }> = {
  rego: { icon: '\u2699', label: 'rego', title: 'Rego policy (OPA-evaluated)' },
  skill: { icon: '\u2728', label: 'skill', title: 'LLM-guided policy directive' },
  builtin: { icon: '\u26A1', label: 'builtin', title: 'Built-in policy (runs in-process)' },
};

const TARGET_STYLES: Record<string, string> = {
  dockerfile: 'bg-amber-50 text-amber-700',
  manifest: 'bg-emerald-50 text-emerald-700',
  package: 'bg-blue-50 text-blue-700',
  any: 'bg-zinc-50 text-zinc-600',
};

const TARGET_TITLES: Record<string, string> = {
  dockerfile: 'Applies to Dockerfiles',
  manifest: 'Applies to Kubernetes manifests',
  package: 'Applies to package manifests (npm, maven, etc.)',
  any: 'Applies to any artifact',
};

interface PolicyBadgeProps {
  policy: Policy;
}

export function PolicyBadge({ policy }: PolicyBadgeProps) {
  const [expanded, setExpanded] = useState(false);
  const typeInfo = TYPE_STYLES[policy.type] ?? TYPE_STYLES.skill;
  const targetStyle = TARGET_STYLES[policy.target] ?? TARGET_STYLES.any;
  const targetTitle = TARGET_TITLES[policy.target] ?? '';
  const isGlobal = policy.scope === 'global';
  const isDisabled = !policy.enabled;
  const allowlistImages = extractAllowlistImages(policy);
  const hasDetails = Boolean(
    policy.description || policy.rego || policy.directive || allowlistImages,
  );

  const allowlistPreview =
    allowlistImages && allowlistImages.length > 0
      ? allowlistImages.slice(0, 2).join(', ') +
        (allowlistImages.length > 2 ? ` +${allowlistImages.length - 2} more` : '')
      : null;

  return (
    <div className='relative'>
      <button
        type='button'
        onClick={() => hasDetails && setExpanded(!expanded)}
        className={`inline-flex flex-col items-start gap-0.5 px-3 py-1.5 bg-white border rounded-lg text-xs transition-colors ${
          isDisabled ? 'border-zinc-200 opacity-50' : 'border-zinc-200 hover:border-zinc-300'
        } ${hasDetails ? 'cursor-pointer' : 'cursor-default'}`}
        title={hasDetails ? 'Click for details' : undefined}
      >
        <div className='inline-flex items-center gap-1.5'>
          {isGlobal && (
            <svg
              className='w-3 h-3 text-zinc-400 shrink-0'
              fill='currentColor'
              viewBox='0 0 20 20'
              aria-label='Inherited from global policies'
            >
              <title>Inherited from global policies (cannot be removed)</title>
              <path
                fillRule='evenodd'
                d='M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z'
                clipRule='evenodd'
              />
            </svg>
          )}
          <span
            className={`font-medium max-w-[180px] truncate ${isDisabled ? 'text-zinc-500 line-through' : 'text-zinc-900'}`}
          >
            {policy.name}
          </span>
          <span className='text-zinc-400' title={typeInfo.title}>
            {typeInfo.icon}
          </span>
          <span
            className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${targetStyle}`}
            title={targetTitle}
          >
            {policy.target}
          </span>
          {isDisabled && (
            <span className='text-[10px] font-medium text-zinc-400 uppercase tracking-wide'>
              off
            </span>
          )}
        </div>
        {allowlistPreview && (
          <span
            className='text-[10px] font-mono text-zinc-500 max-w-[260px] truncate'
            title={allowlistImages?.join(', ')}
          >
            {allowlistPreview}
          </span>
        )}
      </button>
      {expanded && hasDetails && (
        <div className='absolute z-30 mt-1 left-0 w-80 bg-white border border-zinc-200 rounded-lg shadow-lg p-3 text-xs space-y-2'>
          <div className='flex items-center justify-between'>
            <span className='font-semibold text-zinc-900'>{policy.name}</span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                setExpanded(false);
              }}
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
          {policy.description && <p className='text-zinc-600'>{policy.description}</p>}
          {allowlistImages && (
            <div>
              <div className='text-[10px] font-semibold uppercase tracking-wide text-zinc-400 mb-1'>
                Allowed Images ({allowlistImages.length})
              </div>
              <div className='flex flex-wrap gap-1'>
                {allowlistImages.map((img) => (
                  <span
                    key={img}
                    className='px-1.5 py-0.5 bg-zinc-100 text-zinc-700 rounded font-mono text-[10px]'
                  >
                    {img}
                  </span>
                ))}
              </div>
            </div>
          )}
          {policy.directive && (
            <div>
              <div className='text-[10px] font-semibold uppercase tracking-wide text-zinc-400 mb-1'>
                Directive
              </div>
              <pre className='bg-zinc-50 rounded p-2 text-[11px] font-mono text-zinc-700 whitespace-pre-wrap'>
                {policy.directive}
              </pre>
            </div>
          )}
          {policy.rego && (
            <div>
              <div className='text-[10px] font-semibold uppercase tracking-wide text-zinc-400 mb-1'>
                Rego
              </div>
              <pre className='bg-zinc-50 rounded p-2 text-[11px] font-mono text-zinc-700 overflow-x-auto max-h-48'>
                {policy.rego}
              </pre>
            </div>
          )}
          <div className='flex gap-3 text-[10px] text-zinc-400 pt-1 border-t border-zinc-100'>
            <span>Type: {policy.type}</span>
            <span>Scope: {policy.scope}</span>
            <span>Target: {policy.target}</span>
          </div>
        </div>
      )}
    </div>
  );
}
