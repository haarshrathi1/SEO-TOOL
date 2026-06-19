import type { ReactNode } from 'react';
import Logo from './components/app/Logo';

interface PublicPageShellProps {
    eyebrow: string;
    title: string;
    description: string;
    actions?: ReactNode;
    children: ReactNode;
}

export default function PublicPageShell({
    eyebrow,
    title,
    description,
    actions,
    children,
}: PublicPageShellProps) {
    return (
        <div className="min-h-screen bg-[#f8fafc] text-slate-900">
            <header data-print-hidden className="border-b-2 border-black bg-white">
                <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-6 py-4">
                    <a href="/" rel="home">
                        <Logo variant="dark" height={34} />
                    </a>
                    <div className="flex flex-wrap items-center gap-2">
                        <a href="/demo" className="border-2 border-black bg-white px-4 py-2 text-xs font-black uppercase tracking-wide hover:bg-slate-50">
                            Demo
                        </a>
                        <a href="/privacy" className="border-2 border-black bg-white px-4 py-2 text-xs font-black uppercase tracking-wide hover:bg-slate-50">
                            Privacy
                        </a>
                        <a href="/terms" className="border-2 border-black bg-white px-4 py-2 text-xs font-black uppercase tracking-wide hover:bg-slate-50">
                            Terms
                        </a>
                        {actions}
                    </div>
                </div>
            </header>

            <main className="mx-auto flex max-w-7xl flex-col gap-8 px-6 py-10">
                <section className="operator-panel overflow-hidden">
                    <div className="border-b-2 border-black bg-yellow-300 px-6 py-3">
                        <p className="text-[11px] font-black uppercase tracking-[0.22em] text-black">{eyebrow}</p>
                    </div>
                    <div className="space-y-4 p-6 md:p-8">
                        <div className="space-y-3">
                            <h1 className="text-4xl font-black uppercase tracking-tight text-black md:text-5xl">{title}</h1>
                            <p className="max-w-3xl text-sm font-medium leading-relaxed text-slate-600 md:text-base">{description}</p>
                        </div>
                        {children}
                    </div>
                </section>
            </main>
        </div>
    );
}
