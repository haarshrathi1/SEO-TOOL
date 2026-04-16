import { FolderCog, LayoutDashboard, Search, Zap } from 'lucide-react';
import type { AuthUser } from './types';

export interface NavItem {
    path: string;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
}

export const defaultAdminNav: NavItem[] = [
    { path: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { path: '/keywords', label: 'Keywords', icon: Search },
    { path: '/projects', label: 'Projects', icon: FolderCog },
];

function hasAccess(user: AuthUser, accessName: 'keywords' | 'dashboard' | 'audit') {
    return user.role === 'admin' || Boolean(user.access?.includes(accessName));
}

export function canAccessKeywords(user: AuthUser) {
    return hasAccess(user, 'keywords');
}

export function canAccessDashboard(user: AuthUser) {
    return hasAccess(user, 'dashboard');
}

export function canAccessAudit(user: AuthUser) {
    return hasAccess(user, 'audit');
}

export function canAccessDashboardSurface(user: AuthUser) {
    return canAccessDashboard(user) || canAccessAudit(user);
}

export function canAccessRoute(user: AuthUser, path: string) {
    const normalized = path.replace(/\/+$/, '') || '/dashboard';

    if (normalized === '/dashboard') {
        return canAccessDashboardSurface(user);
    }

    if (normalized === '/keywords') {
        return canAccessKeywords(user);
    }

    if (normalized === '/projects') {
        return true;
    }

    return false;
}

export function getDefaultRouteForUser(user: AuthUser) {
    if (user.role === 'admin') {
        return '/dashboard';
    }

    if (!Array.isArray(user.projectIds) || user.projectIds.length === 0) {
        return '/projects';
    }

    if (canAccessDashboardSurface(user)) {
        return '/dashboard';
    }

    if (canAccessKeywords(user)) {
        return '/keywords';
    }

    return '/keywords';
}

export function getNavItemsForUser(user: AuthUser): NavItem[] {
    if (user.role === 'admin') {
        return defaultAdminNav;
    }

    const items: NavItem[] = [];

    if (canAccessDashboardSurface(user)) {
        items.push({
            path: '/dashboard',
            label: canAccessDashboard(user) ? 'Dashboard' : 'Audit',
            icon: canAccessDashboard(user) ? LayoutDashboard : Zap,
        });
    }

    if (canAccessKeywords(user)) {
        items.push({ path: '/keywords', label: 'Keywords', icon: Search });
    }

    items.push({ path: '/projects', label: 'Projects', icon: FolderCog });

    return items;
}
