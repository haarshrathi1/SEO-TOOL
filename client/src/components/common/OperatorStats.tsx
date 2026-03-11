import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs));
}

interface OperatorComparisonCardProps {
    label: string;
    value: string | number | null | undefined;
    deltaLabel: string;
    deltaTone: 'neutral' | 'positive' | 'negative';
}

export function OperatorComparisonCard({ label, value, deltaLabel, deltaTone }: OperatorComparisonCardProps) {
    return (
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">{label}</p>
            <p className="mt-2 text-3xl font-black text-slate-900">{value ?? "--"}</p>
            <p className={cn(
                'mt-2 text-sm font-semibold',
                deltaTone === 'neutral' && 'text-slate-400',
                deltaTone === 'positive' && 'text-emerald-600',
                deltaTone === 'negative' && 'text-rose-600',
            )}>
                {deltaLabel}
            </p>
        </div>
    );
}

interface OperatorMetricTileProps {
    label: string;
    value: string | number | null | undefined;
    sublabel: string;
    accentClassName: string;
}

export function OperatorMetricTile({ label, value, sublabel, accentClassName }: OperatorMetricTileProps) {
    return (
        <div className="group flex flex-col gap-2 transition-transform hover:translate-x-1 hover:translate-y-1">
            <div className="flex items-center justify-between">
                <span className="bg-slate-100 px-1 text-xs font-black uppercase tracking-wider text-slate-500">{label}</span>
                <div className={cn('h-3 w-3 border border-black', accentClassName)}></div>
            </div>
            <span className="font-mono text-4xl font-bold tracking-tighter text-black">{value ?? "--"}</span>
            <span className="w-fit border border-black bg-white px-1 text-[10px] font-bold uppercase text-black shadow-[2px_2px_0px_0px_#000]">{sublabel}</span>
        </div>
    );
}
