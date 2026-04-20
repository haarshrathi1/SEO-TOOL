import { Suspense, lazy, useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import LoginPage from './components/app/LoginPage';
import LandingPage from './LandingPage';
import UserBar from './components/app/UserBar';
import { canAccessDashboardSurface, canAccessRoute, getDefaultRouteForUser, getNavItemsForUser } from './appNav';
import { api } from './api';
import ProjectsPage from './ProjectsPage';
import { useRouter } from './router';
import type { AuthUser } from './types';

const Dashboard = lazy(() => import('./Dashboard'));
const KeywordResearch = lazy(() => import('./KeywordResearch'));

// Routes that require authentication. Anything else is public / unknown.
const PROTECTED_ROUTES = new Set(['/dashboard', '/keywords', '/projects']);

function FullScreenLoader() {
    return (
        <div className="flex min-h-screen items-center justify-center bg-[#f8fafc]">
            <div className="flex flex-col items-center gap-4">
                <Loader2 className="h-8 w-8 animate-spin text-black" />
                <p className="text-xs font-black uppercase tracking-widest text-slate-400">Loading…</p>
            </div>
        </div>
    );
}

// Only called for authenticated users — never with null.
function resolveRoute(path: string, user: AuthUser): string {
    const fallback = getDefaultRouteForUser(user);
    const normalized = (path === '/' ? fallback : path.replace(/\/+$/, '')) || fallback;
    return canAccessRoute(user, normalized) ? normalized : fallback;
}

const SESSION_KEY = 'climbseo_had_session';

export default function App() {
    const { path, navigate } = useRouter();
    const [user, setUser] = useState<AuthUser | null>(null);
    const [showLogin, setShowLogin] = useState(false);
    const [serverReady, setServerReady] = useState(false);

    // Capture the URL the visitor tried to open before auth resolved so we
    // can redirect them there after a successful login ("redirect after login").
    const intendedPath = useRef<string | null>(
        PROTECTED_ROUTES.has(path) ? path : null
    );

    // Only show a full-screen loader when the user had a previous session —
    // new / logged-out visitors see the landing page immediately.
    const hadSession = localStorage.getItem(SESSION_KEY) === '1';
    const [authLoading, setAuthLoading] = useState(hadSession);

    useEffect(() => {
        // Grace period: show the full-screen loader for at most 2.5 s for
        // returning users (covers warm Render servers that answer in < 500 ms).
        // After that, fall through to the landing page regardless.
        let graceDone = false;
        const grace = hadSession
            ? setTimeout(() => { graceDone = true; setAuthLoading(false); }, 2500)
            : null;

        const checkAuth = async () => {
            try {
                const res = await api.authMe();
                setUser(res.user);
                localStorage.setItem(SESSION_KEY, '1');
            } catch {
                setUser(null);
                localStorage.removeItem(SESSION_KEY);
            } finally {
                if (grace) clearTimeout(grace);
                if (!graceDone) setAuthLoading(false);
                setServerReady(true);
            }
        };

        void checkAuth();
        return () => { if (grace) clearTimeout(grace); };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Route guard — only runs for authenticated users.
    // Unauthenticated users are never redirected here; they always see the
    // landing page (or login) regardless of the URL in the address bar.
    useEffect(() => {
        if (!user) return;
        const next = resolveRoute(path, user);
        if (path !== next) navigate(next, { replace: true });
    }, [navigate, path, user]);

    const handleLogin = (u: AuthUser) => {
        localStorage.setItem(SESSION_KEY, '1');
        setShowLogin(false);
        setUser(u);
        // Redirect to the originally intended protected route if accessible,
        // otherwise fall back to the user's default route.
        const target = intendedPath.current ?? getDefaultRouteForUser(u);
        const safe = canAccessRoute(u, target) ? target : getDefaultRouteForUser(u);
        navigate(safe, { replace: true });
        intendedPath.current = null;
    };

    const handleLogout = async () => {
        try { await api.logout(); } catch { /* best-effort */ }
        localStorage.removeItem(SESSION_KEY);
        setUser(null);
        window.google?.accounts?.id?.disableAutoSelect();
        // Go to root, not /dashboard — the landing page lives at /.
        navigate('/', { replace: true });
    };

    // ── Render ────────────────────────────────────────────────────────────

    // Returning user within the grace period — show minimal loader.
    if (authLoading) return <FullScreenLoader />;

    // Not authenticated — show landing / login.
    // The URL does NOT change here; we let the user stay at whatever path
    // they typed. If they log in, they get redirected via handleLogin above.
    if (!user) {
        if (showLogin) return <LoginPage onLogin={handleLogin} />;
        return <LandingPage onLogin={() => setShowLogin(true)} serverReady={serverReady} />;
    }

    // Authenticated — resolve and render the correct route.
    const route = resolveRoute(path, user);
    const navItems = getNavItemsForUser(user);

    return (
        <div>
            <UserBar
                user={user}
                path={route}
                navItems={navItems}
                onNavigate={navigate}
                onLogout={() => void handleLogout()}
            />
            <Suspense fallback={<FullScreenLoader />}>
                {route === '/keywords' && canAccessRoute(user, '/keywords') && <KeywordResearch user={user} />}
                {route === '/dashboard' && canAccessDashboardSurface(user) && <Dashboard user={user} />}
                {route === '/projects' && <ProjectsPage user={user} />}
            </Suspense>
        </div>
    );
}
