import { BrowserRouter, Routes, Route, Link } from 'react-router-dom';
import { createContext, useContext, useEffect, useState } from 'react';
import { api, User } from './api/client';
import { Dashboard } from './pages/Dashboard';
import { NewSession } from './pages/NewSession';
import { SessionDetail } from './pages/SessionDetail';
import { GitHubLogin } from './components/GitHubLogin';

const DemoModeContext = createContext(false);
export const useDemoMode = () => useContext(DemoModeContext);

function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [demoMode, setDemoMode] = useState(false);

  useEffect(() => {
    const init = async () => {
      try {
        const config = await api.getConfig();
        setDemoMode(config.demoMode);
      } catch {}
      try {
        const userData = await api.getMe();
        setUser(userData);
      } catch {}
      setLoading(false);
    };
    init();
  }, []);

  const handleLogout = async () => {
    await api.logout();
    setUser(null);
  };

  if (loading) {
    return (
      <div className='flex items-center justify-center min-h-screen'>
        <div className='w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin' />
      </div>
    );
  }

  return (
    <DemoModeContext.Provider value={demoMode}>
      <BrowserRouter>
        <div className='min-h-screen bg-zinc-50'>
          {demoMode && (
            <div className='bg-amber-500 text-amber-950 text-center py-2 px-4 text-sm font-medium'>
              Demo Mode — GitHub OAuth not configured. Using example apps and local uploads only.
            </div>
          )}
          <nav className='bg-white border-b border-zinc-200'>
            <div className='max-w-6xl mx-auto px-6 py-4'>
              <div className='flex items-center justify-between'>
                <Link
                  to='/'
                  className='text-2xl font-bold text-zinc-900 hover:text-zinc-700 transition-colors'
                >
                  Containerization Assist
                </Link>
                <div className='flex items-center gap-4'>
                  {user ? (
                    <>
                      <div className='flex items-center gap-3'>
                        <img
                          src={user.avatarUrl}
                          alt={user.username}
                          className='w-8 h-8 rounded-full'
                        />
                        <span className='text-sm font-medium text-zinc-700'>{user.username}</span>
                      </div>
                      <button
                        onClick={handleLogout}
                        className='px-4 py-2 text-sm text-zinc-600 hover:text-zinc-900 transition-colors'
                      >
                        Logout
                      </button>
                    </>
                  ) : (
                    !demoMode && <GitHubLogin />
                  )}
                </div>
              </div>
            </div>
          </nav>

          <Routes>
            <Route path='/' element={<Dashboard />} />
            <Route path='/new' element={<NewSession />} />
            <Route path='/sessions/:id' element={<SessionDetail />} />
          </Routes>
        </div>
      </BrowserRouter>
    </DemoModeContext.Provider>
  );
}

export default App;
