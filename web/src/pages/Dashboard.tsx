import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, SessionListItem } from '../api/client';

function sourceLabel(source: SessionListItem['source']): string {
  if (source.type === 'example') return source.exampleName;
  if (source.type === 'github') return source.repoUrl;
  return source.filename;
}

export function Dashboard() {
  const [sessions, setSessions] = useState<SessionListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchSessions = async () => {
      try {
        const data = await api.getSessions();
        setSessions(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load sessions');
      } finally {
        setLoading(false);
      }
    };

    fetchSessions();
  }, []);

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleString();
  };

  const getPhaseColor = (phase: string) => {
    if (phase === 'complete') return 'text-green-600 bg-green-50';
    if (phase === 'failed') return 'text-red-600 bg-red-50';
    return 'text-blue-600 bg-blue-50';
  };

  if (loading) {
    return (
      <div className='flex items-center justify-center min-h-screen'>
        <div className='w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin' />
      </div>
    );
  }

  if (error) {
    return (
      <div className='flex items-center justify-center min-h-screen'>
        <div className='text-center'>
          <p className='text-red-600 text-lg'>{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className='min-h-screen bg-zinc-50'>
      <div className='max-w-6xl mx-auto px-6 py-12'>
        <div className='flex items-center justify-between mb-8'>
          <h1 className='text-4xl font-bold text-zinc-900'>Sessions</h1>
          <Link
            to='/new'
            className='px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium'
          >
            New Session
          </Link>
        </div>

        {sessions.length === 0 ? (
          <div className='bg-white rounded-xl p-12 text-center'>
            <p className='text-zinc-500 text-lg mb-6'>No sessions yet. Create your first one!</p>
            <Link
              to='/new'
              className='inline-block px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium'
            >
              Create Session
            </Link>
          </div>
        ) : (
          <div className='grid gap-4'>
            {sessions.map((session) => (
              <Link
                key={session.id}
                to={`/sessions/${session.id}`}
                className='bg-white rounded-xl p-6 hover:shadow-lg transition-shadow border border-zinc-200'
              >
                <div className='flex items-start justify-between'>
                  <div className='flex-1'>
                    <div className='flex items-center gap-3 mb-2'>
                      <span
                        className={`px-3 py-1 rounded-full text-xs font-medium ${getPhaseColor(
                          session.phase,
                        )}`}
                      >
                        {session.phase}
                      </span>
                      <span className='px-3 py-1 rounded-full text-xs font-medium bg-zinc-100 text-zinc-600'>
                        {session.source.type}
                      </span>
                    </div>
                    <p className='text-sm text-zinc-600 mb-1 font-mono'>
                      {sourceLabel(session.source)}
                    </p>
                    <p className='text-xs text-zinc-400'>Created {formatDate(session.createdAt)}</p>
                  </div>
                  <svg
                    className='w-5 h-5 text-zinc-400'
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
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
