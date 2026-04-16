import { Phase } from '../api/client';

interface PhaseTimelineProps {
  currentPhase: Phase;
}

const phases: { key: Phase; label: string }[] = [
  { key: 'pending', label: 'Pending' },
  { key: 'cloning', label: 'Cloning' },
  { key: 'analyzing', label: 'Analyzing' },
  { key: 'generating_dockerfile', label: 'Generating Dockerfile' },
  { key: 'building', label: 'Building' },
  { key: 'scanning', label: 'Scanning' },
  { key: 'generating_manifests', label: 'Generating Manifests' },
  { key: 'complete', label: 'Complete' },
];

export function PhaseTimeline({ currentPhase }: PhaseTimelineProps) {
  const currentIndex = phases.findIndex((p) => p.key === currentPhase);
  const isFailed = currentPhase === 'failed';

  const getPhaseState = (index: number): 'pending' | 'active' | 'complete' | 'failed' => {
    if (isFailed && index === currentIndex) return 'failed';
    if (index < currentIndex) return 'complete';
    if (index === currentIndex) return 'active';
    return 'pending';
  };

  return (
    <div className='relative'>
      {phases.map((phase, index) => {
        const state = getPhaseState(index);
        const isLast = index === phases.length - 1;

        return (
          <div key={phase.key} className='relative flex gap-4'>
            {!isLast && (
              <div
                className={`absolute left-5 top-11 w-0.5 h-12 ${
                  state === 'complete' ? 'bg-green-500' : 'bg-zinc-200'
                }`}
              />
            )}

            <div className='flex items-start gap-4 pb-8'>
              <div
                className={`
                  relative z-10 w-10 h-10 rounded-full flex items-center justify-center
                  transition-all duration-300
                  ${
                    state === 'complete'
                      ? 'bg-green-500 text-white'
                      : state === 'active'
                        ? 'bg-blue-500 text-white'
                        : state === 'failed'
                          ? 'bg-red-500 text-white'
                          : 'bg-zinc-200 text-zinc-400'
                  }
                `}
              >
                {state === 'complete' && (
                  <svg className='w-6 h-6' fill='none' stroke='currentColor' viewBox='0 0 24 24'>
                    <path
                      strokeLinecap='round'
                      strokeLinejoin='round'
                      strokeWidth={2}
                      d='M5 13l4 4L19 7'
                    />
                  </svg>
                )}
                {state === 'active' && (
                  <div className='w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin' />
                )}
                {state === 'failed' && (
                  <svg className='w-6 h-6' fill='none' stroke='currentColor' viewBox='0 0 24 24'>
                    <path
                      strokeLinecap='round'
                      strokeLinejoin='round'
                      strokeWidth={2}
                      d='M6 18L18 6M6 6l12 12'
                    />
                  </svg>
                )}
                {state === 'pending' && <div className='w-3 h-3 rounded-full bg-current' />}
              </div>

              <div className='flex-1 pt-1'>
                <h3
                  className={`text-sm font-medium ${
                    state === 'complete' || state === 'active'
                      ? 'text-zinc-900'
                      : state === 'failed'
                        ? 'text-red-600'
                        : 'text-zinc-400'
                  }`}
                >
                  {phase.label}
                </h3>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
