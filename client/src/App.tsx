import { useState, useEffect, useCallback } from 'react';
import Dashboard from './Dashboard';
import KeywordResearch from './KeywordResearch';
import { api, setToken, clearToken } from './api';
import { Loader2, UserPlus, Trash2, Users, LogOut, KeyRound, Brain } from 'lucide-react';

declare global {
  interface Window {
    google: any;
    handleGoogleLogin?: (response: any) => void;
  }
}

interface UserInfo {
  email: string;
  role: 'admin' | 'viewer';
  name?: string;
  picture?: string;
  access?: string[];
}
interface ViewerInfo {
  email: string;
  access: string[];
  createdAt: string;
}

function getCurrentRoute(): 'dashboard' | 'keywords' {
  return window.location.hash === '#/keywords' || window.location.pathname === '/keywords'
    ? 'keywords'
    : 'dashboard';
}

function LoginPage({ onLogin }: { onLogin: (user: UserInfo) => void }) {
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [configLoading, setConfigLoading] = useState(true);

  const handleCredential = useCallback(async (response: any) => {
    setLoading(true);
    setError('');
    try {
      const res = await api.googleLogin(response.credential);
      setToken(res.token);
      onLogin(res.user);
    } catch (err: any) {
      setError(err.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  }, [onLogin]);

  useEffect(() => {
    // Make handler available globally for Google callback
    window.handleGoogleLogin = handleCredential;

    const initGoogle = async () => {
      try {
        const config = await api.getAuthConfig();

        // Load Google Identity Services script
        const script = document.createElement('script');
        script.src = 'https://accounts.google.com/gsi/client';
        script.async = true;
        script.defer = true;
        script.onload = () => {
          window.google.accounts.id.initialize({
            client_id: config.googleClientId,
            callback: handleCredential,
            auto_select: false,
            ux_mode: 'popup',
          });
          window.google.accounts.id.renderButton(
            document.getElementById('google-signin-btn'),
            {
              theme: 'outline',
              size: 'large',
              shape: 'pill',
              width: 360,
              text: 'signin_with',
              logo_alignment: 'left',
            }
          );
          setConfigLoading(false);
        };
        document.head.appendChild(script);
      } catch (e) {
        setError('Failed to load login config');
        setConfigLoading(false);
      }
    };
    initGoogle();

    return () => { delete window.handleGoogleLogin; };
  }, [handleCredential]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-indigo-50/40 flex items-center justify-center p-6">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center mx-auto mb-4 shadow-lg shadow-indigo-200">
            <Brain className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight">SEO Intelligence</h1>
          <p className="text-slate-500 mt-1 text-sm">Sign in with Google to access your tools</p>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 p-8 space-y-5" style={{ boxShadow: '0 10px 25px -5px rgb(0 0 0 / 0.06)' }}>
          {error && (
            <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-600 text-sm font-medium">{error}</div>
          )}

          {(loading || configLoading) && (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="w-6 h-6 text-indigo-500 animate-spin" />
            </div>
          )}

          <div id="google-signin-btn" className="flex justify-center" />

          <p className="text-xs text-slate-400 text-center leading-relaxed">
            Admin access: <strong>harshrathi.hyvikk@gmail.com</strong><br />
            Viewer access: Email must be added by admin
          </p>
        </div>
        <p className="text-center text-xs text-slate-400 mt-6">seotool.harshrathi.com</p>
      </div>
    </div>
  );
}

function ViewerManager() {
  const [viewers, setViewers] = useState<ViewerInfo[]>([]);
  const [newEmail, setNewEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState('');

  const fetchViewers = async () => {
    try { setViewers(await api.getViewers()); } catch { }
  };
  useEffect(() => { fetchViewers(); }, []);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newEmail.trim()) return;
    setLoading(true); setMsg('');
    try {
      await api.addViewer(newEmail);
      setNewEmail('');
      setMsg('Viewer added!');
      fetchViewers();
    } catch (err: any) { setMsg(err.message); }
    finally { setLoading(false); }
  };

  const handleRemove = async (email: string) => {
    if (!confirm(`Remove viewer ${email}?`)) return;
    try { await api.removeViewer(email); fetchViewers(); } catch { }
  };

  return (
    <div className="premium-card p-6 space-y-5">
      <div className="flex items-center gap-2"><Users className="w-5 h-5 text-indigo-600" /><h3 className="font-bold text-slate-900">Manage Viewer Access</h3></div>
      <p className="text-sm text-slate-500">Add Google email addresses. Viewers can sign in with Google and access the Keyword Tool only.</p>
      <form onSubmit={handleAdd} className="flex gap-3 items-end">
        <div className="flex-1">
          <label className="text-xs font-semibold text-slate-500 uppercase">Google Email</label>
          <input type="email" value={newEmail} onChange={e => setNewEmail(e.target.value)} placeholder="viewer@gmail.com" className="premium-input py-2.5 text-sm mt-1" />
        </div>
        <button type="submit" disabled={loading} className="premium-button bg-indigo-600 text-white hover:bg-indigo-700 py-2.5 flex-shrink-0">
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <><UserPlus className="w-4 h-4" /> Add</>}
        </button>
      </form>
      {msg && <p className="text-sm text-indigo-600 font-medium">{msg}</p>}
      {viewers.length > 0 && (
        <div className="space-y-2">
          {viewers.map(v => (
            <div key={v.email} className="flex items-center justify-between p-3 rounded-xl bg-slate-50 border border-slate-100">
              <div>
                <span className="font-medium text-sm text-slate-800">{v.email}</span>
                <span className="ml-2 text-xs text-slate-400 inline-flex items-center gap-1"><KeyRound className="w-3 h-3" /> {v.access?.join(', ')}</span>
              </div>
              <button onClick={() => handleRemove(v.email)} className="text-rose-400 hover:text-rose-600"><Trash2 className="w-4 h-4" /></button>
            </div>
          ))}
        </div>
      )}
      {viewers.length === 0 && <p className="text-sm text-slate-400">No viewer accounts yet</p>}
    </div>
  );
}

function AdminNav({ user, onLogout, onShowViewers, route }: { user: UserInfo; onLogout: () => void; onShowViewers: () => void; route: 'dashboard' | 'keywords' }) {
  return (
    <div className="fixed top-4 right-4 z-50 flex items-center gap-2">
      {route === 'keywords'
        ? <a href="/#/" className="text-xs font-medium text-indigo-600 bg-indigo-50 px-3 py-1.5 rounded-full border border-indigo-100 hover:bg-indigo-100 transition-colors">Dashboard</a>
        : <a href="/#/keywords" className="text-xs font-medium text-indigo-600 bg-indigo-50 px-3 py-1.5 rounded-full border border-indigo-100 hover:bg-indigo-100 transition-colors">Keyword Tool</a>
      }
      <button onClick={onShowViewers} className="text-xs font-medium text-emerald-600 bg-emerald-50 px-3 py-1.5 rounded-full border border-emerald-100 hover:bg-emerald-100 transition-colors flex items-center gap-1">
        <Users className="w-3.5 h-3.5" /> Manage Viewers
      </button>
      {user.picture && <img src={user.picture} className="w-7 h-7 rounded-full border border-slate-200" alt="" />}
      <span className="text-xs text-slate-500 bg-white/80 backdrop-blur-sm px-3 py-1.5 rounded-full border border-slate-200">{user.name || user.email}</span>
      <button onClick={onLogout} className="w-8 h-8 rounded-full bg-white border border-slate-200 flex items-center justify-center hover:bg-rose-50 hover:border-rose-200 transition-all shadow-sm">
        <LogOut className="w-3.5 h-3.5 text-slate-500" />
      </button>
    </div>
  );
}

function ViewerModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/30 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-xl max-h-[80vh] overflow-y-auto border border-slate-200" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-5 border-b border-slate-100">
          <h2 className="font-bold text-lg text-slate-900 flex items-center gap-2"><Users className="w-5 h-5 text-indigo-600" /> Manage Viewers</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 font-medium text-sm">Close</button>
        </div>
        <div className="p-5">
          <ViewerManager />
        </div>
      </div>
    </div>
  );
}

function App() {
  const [user, setUser] = useState<UserInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [showViewers, setShowViewers] = useState(false);
  const [route, setRoute] = useState<'dashboard' | 'keywords'>(getCurrentRoute);

  useEffect(() => {
    const syncRoute = () => setRoute(getCurrentRoute());
    window.addEventListener('hashchange', syncRoute);
    window.addEventListener('popstate', syncRoute);

    const checkAuth = async () => {
      try {
        const res = await api.authMe();
        setUser(res.user);
      } catch {
        setUser(null);
      } finally {
        setLoading(false);
      }
    };

    syncRoute();
    checkAuth();

    return () => {
      window.removeEventListener('hashchange', syncRoute);
      window.removeEventListener('popstate', syncRoute);
    };
  }, []);

  const handleLogout = async () => {
    clearToken();
    try { await api.logout(); } catch { }
    setUser(null);
    if (window.google?.accounts?.id) {
      window.google.accounts.id.disableAutoSelect();
    }
  };

  if (loading) return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-indigo-50/40 flex items-center justify-center">
      <Loader2 className="w-8 h-8 text-indigo-500 animate-spin" />
    </div>
  );

  if (!user) return <LoginPage onLogin={setUser} />;

  // Viewer can ONLY access keyword tool
  if (user.role === 'viewer') {
    return (
      <div>
        <div className="fixed top-4 right-4 z-50 flex items-center gap-2">
          {user.picture && <img src={user.picture} className="w-7 h-7 rounded-full border border-slate-200" alt="" />}
          <span className="text-xs text-slate-500 bg-white/80 backdrop-blur-sm px-3 py-1.5 rounded-full border border-slate-200">{user.name || user.email}</span>
          <button onClick={handleLogout} className="w-8 h-8 rounded-full bg-white border border-slate-200 flex items-center justify-center hover:bg-rose-50 hover:border-rose-200 transition-all shadow-sm">
            <LogOut className="w-3.5 h-3.5 text-slate-500" />
          </button>
        </div>
        <KeywordResearch />
      </div>
    );
  }

  // Admin views
  return (
    <div>
      <AdminNav user={user} onLogout={handleLogout} onShowViewers={() => setShowViewers(true)} route={route} />
      {showViewers && <ViewerModal onClose={() => setShowViewers(false)} />}
      {route === 'keywords' ? <KeywordResearch /> : <Dashboard />}
    </div>
  );
}

export default App;





