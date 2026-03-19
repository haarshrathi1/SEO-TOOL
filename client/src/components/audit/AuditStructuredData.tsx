import { AlertTriangle, CheckCircle, FileText, Search } from 'lucide-react';
import type { AuditResult } from '../../types';
import { buildStructuredDataAuditModel, type StructuredDataFilterId } from '../../structuredDataAudit';
import { getUrlPathLabel } from '../../url';
import { OperatorStatePanel } from '../common/OperatorUi';

interface AuditStructuredDataProps {
    results: AuditResult[];
    onReview: (filterId: StructuredDataFilterId) => void;
}

function toneStyles(tone: 'critical' | 'warning' | 'positive' | 'info') {
    if (tone === 'critical') {
        return {
            panel: 'border-red-200 bg-red-50',
            chip: 'bg-red-600 text-white',
            label: 'text-red-700',
        };
    }

    if (tone === 'warning') {
        return {
            panel: 'border-amber-200 bg-amber-50',
            chip: 'bg-amber-300 text-black',
            label: 'text-amber-700',
        };
    }

    if (tone === 'positive') {
        return {
            panel: 'border-emerald-200 bg-emerald-50',
            chip: 'bg-emerald-300 text-black',
            label: 'text-emerald-700',
        };
    }

    return {
        panel: 'border-sky-200 bg-sky-50',
        chip: 'bg-sky-300 text-black',
        label: 'text-sky-700',
    };
}

export default function AuditStructuredData({ results, onReview }: AuditStructuredDataProps) {
    const model = buildStructuredDataAuditModel(results);

    if (!model.hasData) {
        return (
            <OperatorStatePanel
                icon={FileText}
                title="Need one fresh schema crawl"
                description="Older snapshots were collected before structured data extraction was added. Run a fresh audit to unlock schema validation, type coverage, and rich-result readiness."
                variant="panel"
                align="center"
                titleAs="h3"
            />
        );
    }

    const metricCards = [
        { ...model.metrics[0], accent: 'bg-black text-white', icon: FileText },
        { ...model.metrics[1], accent: 'bg-green-300 text-black', icon: CheckCircle },
        { ...model.metrics[2], accent: 'bg-red-300 text-black', icon: AlertTriangle },
        { ...model.metrics[3], accent: 'bg-yellow-300 text-black', icon: Search },
        { ...model.metrics[4], accent: 'bg-sky-300 text-black', icon: Search },
    ];

    return (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
                {metricCards.map((card) => (
                    <div key={card.label} className="border-2 border-black bg-white p-5 shadow-[6px_6px_0px_0px_#000]">
                        <div className="flex items-start justify-between gap-3">
                            <div>
                                <p className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-500">{card.label}</p>
                                <p className="mt-3 text-4xl font-black text-black">{card.value}</p>
                                <p className="mt-2 text-sm font-semibold text-slate-600">{card.detail}</p>
                            </div>
                            <div className={`border-2 border-black p-2 ${card.accent}`}>
                                <card.icon className="h-5 w-5" />
                            </div>
                        </div>
                    </div>
                ))}
            </div>

            <div className="grid gap-6 xl:grid-cols-[minmax(0,1.25fr)_minmax(22rem,0.95fr)]">
                <div className="space-y-4">
                    {model.cards
                        .filter((card) => card.count > 0)
                        .map((card) => {
                            const styles = toneStyles(card.tone);

                            return (
                                <button
                                    key={card.id}
                                    type="button"
                                    onClick={() => onReview(card.id)}
                                    className={`w-full border-2 border-black p-4 text-left shadow-[6px_6px_0px_0px_#000] transition-all hover:translate-x-[-2px] hover:translate-y-[-2px] hover:shadow-[8px_8px_0px_0px_#000] ${styles.panel}`}
                                >
                                    <div className="flex items-start justify-between gap-4">
                                        <div className="min-w-0">
                                            <div className="flex items-center gap-3">
                                                <div className={`border-2 border-black px-2 py-1 text-[10px] font-black uppercase tracking-[0.18em] ${styles.chip}`}>
                                                    {card.tone}
                                                </div>
                                                <div>
                                                    <p className="text-lg font-black uppercase text-black">{card.title}</p>
                                                    <p className="text-sm font-semibold text-slate-700">{card.description}</p>
                                                </div>
                                            </div>

                                            {card.sampleUrls.length > 0 && (
                                                <div className="mt-4 flex flex-wrap gap-2">
                                                    {card.sampleUrls.map((url) => (
                                                        <span key={url} className="max-w-full truncate border border-black bg-white px-2 py-1 text-[11px] font-bold text-slate-700">
                                                            {getUrlPathLabel(url)}
                                                        </span>
                                                    ))}
                                                </div>
                                            )}
                                        </div>

                                        <div className="text-right">
                                            <p className="text-4xl font-black text-black">{card.count}</p>
                                            <p className={`mt-2 text-[11px] font-black uppercase tracking-[0.18em] ${styles.label}`}>Review pages</p>
                                        </div>
                                    </div>
                                </button>
                            );
                        })}

                    {model.cards.every((card) => card.count === 0) && (
                        <div className="border-2 border-black bg-slate-50 p-5 text-sm font-semibold text-slate-600 shadow-[4px_4px_0px_0px_rgba(0,0,0,0.08)]">
                            No schema issues or coverage gaps were detected in this snapshot.
                        </div>
                    )}
                </div>

                <div className="space-y-6">
                    <div className="border-2 border-black bg-white p-5 shadow-[6px_6px_0px_0px_#000]">
                        <p className="text-sm font-black uppercase tracking-[0.2em] text-black">Detected schema types</p>
                        <p className="mt-1 text-sm font-medium text-slate-600">The most common structured data types found in this audit.</p>

                        <div className="mt-4 space-y-3">
                            {model.topTypes.length > 0 ? model.topTypes.map((type) => (
                                <div key={type.type} className="flex items-center justify-between gap-3 border-2 border-black bg-slate-50 px-3 py-2">
                                    <span className="text-sm font-bold text-black">{type.type}</span>
                                    <span className="border border-black bg-white px-2 py-1 text-sm font-black text-black">{type.count}</span>
                                </div>
                            )) : (
                                <div className="border-2 border-black bg-slate-50 p-4 text-sm font-semibold text-slate-600">
                                    No schema types detected in this snapshot.
                                </div>
                            )}
                        </div>
                    </div>

                    <div className="border-2 border-black bg-white p-5 shadow-[6px_6px_0px_0px_#000]">
                        <p className="text-sm font-black uppercase tracking-[0.2em] text-black">Common validation issues</p>
                        <p className="mt-1 text-sm font-medium text-slate-600">The most repeated structured data issues across the audited set.</p>

                        <div className="mt-4 space-y-3">
                            {model.commonIssues.length > 0 ? model.commonIssues.map((issue) => (
                                <div key={issue.label} className="flex items-start justify-between gap-3 border-2 border-black bg-slate-50 px-3 py-2">
                                    <span className="text-sm font-bold text-black">{issue.label}</span>
                                    <span className="border border-black bg-white px-2 py-1 text-sm font-black text-black">{issue.count}</span>
                                </div>
                            )) : (
                                <div className="border-2 border-black bg-slate-50 p-4 text-sm font-semibold text-slate-600">
                                    No schema issues detected in this snapshot.
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
