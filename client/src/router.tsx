/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useEffect, useMemo, useState } from 'react';

interface NavigateOptions {
    replace?: boolean;
}

interface RouterValue {
    path: string;
    navigate: (to: string, options?: NavigateOptions) => void;
}

const RouterContext = createContext<RouterValue | null>(null);

function normalizePath(path: string) {
    if (!path) return '/dashboard';
    if (path === '/') return '/dashboard';
    return path.replace(/\/+$/, '') || '/dashboard';
}

export function RouterProvider({ children }: { children: React.ReactNode }) {
    const [path, setPath] = useState(() => normalizePath(window.location.pathname));

    useEffect(() => {
        const syncPath = () => setPath(normalizePath(window.location.pathname));
        window.addEventListener('popstate', syncPath);
        syncPath();
        return () => window.removeEventListener('popstate', syncPath);
    }, []);

    const value = useMemo<RouterValue>(() => ({
        path,
        navigate: (to, options = {}) => {
            const nextPath = normalizePath(to);
            const method = options.replace ? 'replaceState' : 'pushState';
            window.history[method]({}, '', nextPath);
            setPath(nextPath);
        },
    }), [path]);

    return <RouterContext.Provider value={value}>{children}</RouterContext.Provider>;
}

export function useRouter() {
    const value = useContext(RouterContext);
    if (!value) {
        throw new Error('useRouter must be used inside RouterProvider');
    }
    return value;
}

export function useRouteMatch(expectedPath: string) {
    const { path } = useRouter();
    return normalizePath(expectedPath) === path;
}

