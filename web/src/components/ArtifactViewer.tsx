import { Artifact } from '../api/client';

interface ArtifactViewerProps {
  artifact: Artifact;
  onClose: () => void;
}

export function ArtifactViewer({ artifact, onClose }: ArtifactViewerProps) {
  const isJSON = artifact.contentType.includes('json');

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

        <div className='flex-1 overflow-auto p-6'>
          <pre className='text-sm font-mono bg-zinc-50 p-4 rounded-lg overflow-x-auto'>
            {formatContent()}
          </pre>
        </div>
      </div>
    </div>
  );
}
