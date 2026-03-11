import { LogOut, LayoutDashboard } from 'lucide-react';
import type { AuthUser } from '../../types';

interface NavItem {
    path: string;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
}

export default function UserBar({
    user,
    path,
    navItems,
    onNavigate,
    onLogout,
}: {
    user: AuthUser;
    path: string;
    navItems: NavItem[];
    onNavigate: (path: string) => void;
    onLogout: () => void;
}) {
    return (
        <div className="sticky top-0 z-[70] border-b border-slate-200/80 bg-white/85 backdrop-blur-xl">
            <div className="mx-auto flex max-w-7xl flex-col gap-3 px-6 py-4 md:flex-row md:items-center md:justify-between">
                <div className="flex items-center gap-3">
                    <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-slate-900 text-white shadow-sm">
                        <LayoutDashboard className="h-5 w-5" />
                    </div>
                    <div>
                        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">SEO Intelligence</p>
                        <h1 className="text-lg font-black tracking-tight text-slate-900">Operator Workspace</h1>
                    </div>
                </div>

                <div className="flex flex-col gap-3 md:flex-row md:items-center">
                    <nav className="flex flex-wrap items-center gap-2">
                        {navItems.map((item) => {
                            const active = path === item.path;
                            const Icon = item.icon;
                            return (
                                <button
                                    key={item.path}
                                    onClick={() => onNavigate(item.path)}
                                    className={`inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-semibold transition ${active ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50'}`}
                                >
                                    <Icon className="h-4 w-4" />
                                    {item.label}
                                </button>
                            );
                        })}
                    </nav>

                    <div className="flex items-center gap-2 self-end rounded-full border border-slate-200 bg-white px-2 py-1 shadow-sm md:self-auto">
                        {user.picture ? (
                            <img src={user.picture} className="h-8 w-8 rounded-full border border-slate-200" alt="" />
                        ) : (
                            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-indigo-50 text-xs font-bold uppercase text-indigo-600">
                                {(user.name || user.email).slice(0, 2)}
                            </div>
                        )}
                        <div className="max-w-[12rem] pr-2">
                            <p className="truncate text-sm font-semibold text-slate-800">{user.name || user.email}</p>
                            <p className="truncate text-xs text-slate-400">{user.role === 'admin' ? 'Admin' : 'Viewer'}</p>
                        </div>
                        <button onClick={onLogout} className="rounded-full p-2 text-slate-400 transition hover:bg-rose-50 hover:text-rose-600">
                            <LogOut className="h-4 w-4" />
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}

