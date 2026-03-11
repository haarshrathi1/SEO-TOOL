import { Suspense, lazy, useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import LoginPage from './components/app/LoginPage';
import UserBar from './components/app/UserBar';
import { defaultAdminNav, viewerNav } from './appNav';
import { api } from './api';
import ProjectsPage from './ProjectsPage';
import { useRouter } from './router';
import type { AuthUser } from './types';

const Dashboard = lazy(() => import('./Dashboard'));
const KeywordResearch = lazy(() => import('./KeywordResearch'));

function FullScreenLoader() {
    return (
        <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-50 via-white to-indigo-50/40">
            <Loader2 className="h-8 w-8 animate-spin text-indigo-500" />
        </div>
    );
}

function normalizeAppRoute(path: string, role: AuthUser['role'] | null) {
    const normalized = path === '/' ? '/dashboard' : path.replace(/\/+$/, '') || '/dashboard';
    if (role === 'viewer') {
        return '/keywords';
    }

    if (['/dashboard', '/keywords', '/projects'].includes(normalized)) {
        return normalized;
    }

    return '/dashboard';
}

export default function App() {
    const { path, navigate } = useRouter();
    const [user, setUser] = useState<AuthUser | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
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

        void checkAuth();
    }, []);

    useEffect(() => {
        const nextRoute = normalizeAppRoute(path, user?.role || null);
        if (path !== nextRoute) {
            navigate(nextRoute, { replace: true });
        }
    }, [navigate, path, user?.role]);

    const handleLogout = async () => {
        try {
            await api.logout();
        } catch (error) {
            console.error('Logout failed:', error);
        }
        setUser(null);
        window.google?.accounts?.id?.disableAutoSelect();
        navigate('/dashboard', { replace: true });
    };

    if (loading) {
        return <FullScreenLoader />;
    }

    if (!user) {
        return <LoginPage onLogin={setUser} />;
    }

    const route = normalizeAppRoute(path, user.role);
    const navItems = user.role === 'admin' ? defaultAdminNav : viewerNav;

    return (
        <div>
            <UserBar user={user} path={route} navItems={navItems} onNavigate={navigate} onLogout={() => void handleLogout()} />
            <Suspense fallback={<FullScreenLoader />}>
                {route === '/keywords' && <KeywordResearch />}
                {route === '/dashboard' && user.role === 'admin' && <Dashboard />}
                {route === '/projects' && user.role === 'admin' && <ProjectsPage />}
            </Suspense>
        </div>
    );
}

