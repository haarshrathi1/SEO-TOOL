/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Info, X } from 'lucide-react';

export type ToastTone = 'success' | 'error' | 'info';

interface ToastRecord {
    id: string;
    title: string;
    description?: string;
    tone: ToastTone;
}

interface ToastContextValue {
    push: (toast: Omit<ToastRecord, 'id'>) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

function getToneStyles(tone: ToastTone) {
    switch (tone) {
        case 'success':
            return {
                icon: CheckCircle2,
                wrapper: 'border-emerald-200 bg-emerald-50 text-emerald-900',
                iconColor: 'text-emerald-600',
            };
        case 'error':
            return {
                icon: AlertTriangle,
                wrapper: 'border-rose-200 bg-rose-50 text-rose-900',
                iconColor: 'text-rose-600',
            };
        default:
            return {
                icon: Info,
                wrapper: 'border-slate-200 bg-white text-slate-900',
                iconColor: 'text-indigo-600',
            };
    }
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
    const [toasts, setToasts] = useState<ToastRecord[]>([]);

    const remove = useCallback((id: string) => {
        setToasts((current) => current.filter((toast) => toast.id !== id));
    }, []);

    const push = useCallback((toast: Omit<ToastRecord, 'id'>) => {
        const id = crypto.randomUUID();
        setToasts((current) => [...current, { id, ...toast }]);
        window.setTimeout(() => remove(id), 4200);
    }, [remove]);

    const value = useMemo(() => ({ push }), [push]);

    return (
        <ToastContext.Provider value={value}>
            {children}
            <div className="fixed right-4 top-4 z-[120] flex w-full max-w-sm flex-col gap-3">
                {toasts.map((toast) => {
                    const tone = getToneStyles(toast.tone);
                    const Icon = tone.icon;
                    return (
                        <div key={toast.id} className={`rounded-2xl border px-4 py-3 shadow-lg backdrop-blur-sm ${tone.wrapper}`}>
                            <div className="flex items-start gap-3">
                                <Icon className={`mt-0.5 h-5 w-5 flex-shrink-0 ${tone.iconColor}`} />
                                <div className="min-w-0 flex-1">
                                    <p className="text-sm font-semibold">{toast.title}</p>
                                    {toast.description && <p className="mt-1 text-sm opacity-80">{toast.description}</p>}
                                </div>
                                <button onClick={() => remove(toast.id)} className="rounded-full p-1 text-slate-400 transition hover:bg-black/5 hover:text-slate-700">
                                    <X className="h-4 w-4" />
                                </button>
                            </div>
                        </div>
                    );
                })}
            </div>
        </ToastContext.Provider>
    );
}

export function useToast() {
    const value = useContext(ToastContext);
    if (!value) {
        throw new Error('useToast must be used inside ToastProvider');
    }
    return value;
}

