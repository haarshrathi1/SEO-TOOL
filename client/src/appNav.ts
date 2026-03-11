import { FolderCog, LayoutDashboard, Search } from 'lucide-react';

export const defaultAdminNav = [
    { path: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { path: '/keywords', label: 'Keywords', icon: Search },
    { path: '/projects', label: 'Projects', icon: FolderCog },
];

export const viewerNav = [
    { path: '/keywords', label: 'Keywords', icon: Search },
];
