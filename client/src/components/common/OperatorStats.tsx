import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs));
}

type MetricDisplayFormat = 'raw' | 'integer' | 'decimal' | 'percent';

function formatMetricValue(
    value: string | number | boolean | null | undefined,
    format: MetricDisplayFormat = 'raw',
) {
    if (typeof value === 'boolean' || value == null) {
        return '--';
    }

    if (typeof value === 'number') {
        if (!Number.isFinite(value)) {
            return '--';
        }

        switch (format) {
            case 'integer':
                return Math.round(value).toLocaleString();
            case 'decimal':
                return value.toFixed(2).replace(/\.00$/, '');
            case 'percent':
                return `${value.toFixed(2).replace(/\.00$/, '')}%`;
            default:
                return String(value);
        }
    }

    const trimmed = value.trim();
    if (!trimmed) {
        return '--';
    }

    if (format === 'percent' && !trimmed.includes('%')) {
        const parsed = Number.parseFloat(trimmed.replace(/[^0-9.-]/g, ''));
        if (Number.isFinite(parsed)) {
            return `${parsed.toFixed(2).replace(/\.00$/, '')}%`;
        }
    }

    return trimmed;
}

interface OperatorComparisonCardProps {
    label: string;
    value: string | number | boolean | null | undefined;
    deltaLabel: string;
    deltaTone: 'neutral' | 'positive' | 'negative';
}

export function OperatorComparisonCard({ label, value, deltaLabel, deltaTone }: OperatorComparisonCardProps) {
    return (
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">{label}</p>
            <p className="mt-2 text-3xl font-black text-slate-900">{formatMetricValue(value)}</p>
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
    value: string | number | boolean | null | undefined;
    sublabel: string;
    accentClassName: string;
    format?: MetricDisplayFormat;
}

export function OperatorMetricTile({ label, value, sublabel, accentClassName, format = 'raw' }: OperatorMetricTileProps) {
    return (
        <div className="group flex flex-col gap-2 transition-transform hover:translate-x-1 hover:translate-y-1">
            <div className="flex items-center justify-between">
                <span className="bg-slate-100 px-1 text-xs font-black uppercase tracking-wider text-slate-500">{label}</span>
                <div className={cn('h-3 w-3 border border-black', accentClassName)}></div>
            </div>
            <span className="font-mono text-4xl font-bold tracking-tighter text-black">{formatMetricValue(value, format)}</span>
            <span className="w-fit border border-black bg-white px-1 text-[10px] font-bold uppercase text-black shadow-[2px_2px_0px_0px_#000]">{sublabel}</span>
        </div>
    );
}
