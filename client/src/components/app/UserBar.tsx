import { LogOut } from 'lucide-react';
import Logo from './Logo';
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
    const initials = (user.name || user.email).slice(0, 2).toUpperCase();

    return (
        <div className="sticky top-0 z-[70] border-b-2 border-black bg-white">
            <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-6 py-3">
                {/* Brand */}
                <div className="flex items-center">
                    <Logo variant="dark" height={30} />
                </div>

                {/* Nav */}
                <nav className="flex items-center border-2 border-black divide-x-2 divide-black">
                    {navItems.map((item) => {
                        const active = path === item.path;
                        const Icon = item.icon;
                        return (
                            <button
                                key={item.path}
                                onClick={() => onNavigate(item.path)}
                                className={`inline-flex items-center gap-2 px-4 py-2 text-xs font-black uppercase tracking-wide transition-colors duration-150 ${
                                    active
                                        ? 'bg-black text-white'
                                        : 'bg-white text-black hover:bg-slate-50'
                                }`}
                            >
                                <Icon className="h-3.5 w-3.5" />
                                <span className="hidden md:inline">{item.label}</span>
                            </button>
                        );
                    })}
                </nav>

                {/* User chip */}
                <div className="flex items-center gap-2">
                    <div className="flex items-center gap-2 border-2 border-black bg-white px-3 py-2">
                        {user.picture ? (
                            <img
                                src={user.picture}
                                className="h-6 w-6 border border-black object-cover"
                                alt=""
                            />
                        ) : (
                            <div className="flex h-6 w-6 items-center justify-center bg-black text-[10px] font-black text-white">
                                {initials}
                            </div>
                        )}
                        <span className="hidden max-w-[10rem] truncate text-xs font-black text-black sm:block">
                            {user.name || user.email}
                        </span>
                        <span className={`border border-black px-1.5 py-0.5 text-[9px] font-black uppercase ${user.role === 'admin' ? 'bg-yellow-300 text-black' : 'bg-slate-100 text-black'}`}>
                            {user.role}
                        </span>
                    </div>
                    <button
                        onClick={onLogout}
                        title="Sign out"
                        className="border-2 border-black bg-white p-2 text-black transition-all hover:bg-red-100 hover:border-red-600 active:translate-x-[1px] active:translate-y-[1px]"
                    >
                        <LogOut className="h-4 w-4" />
                    </button>
                </div>
            </div>
        </div>
    );
}
