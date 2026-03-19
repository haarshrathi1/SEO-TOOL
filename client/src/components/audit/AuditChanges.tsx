import { ArrowRight, AlertTriangle, CheckCircle, FileText, History, Search } from 'lucide-react';
import { OperatorStatePanel } from '../common/OperatorUi';
import type { AuditResult } from '../../types';
import { buildAuditChangeModel, type AuditChangeFilterId } from '../../changeDetection';
import { getUrlPathLabel } from '../../url';

interface AuditChangesProps {
    results: AuditResult[];
    previousResults: AuditResult[] | null;
    currentLabel: string;
    baselineLabel: string | null;
    onReview: (filterId: AuditChangeFilterId) => void;
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

export default function AuditChanges({ results, previousResults, currentLabel, baselineLabel, onReview }: AuditChangesProps) {
    if (!previousResults || previousResults.length === 0 || !baselineLabel) {
        return (
            <OperatorStatePanel
                icon={History}
                title="Need one older snapshot"
                description="Run at least two audits for this project to unlock regression tracking, recoveries, and page-by-page change detection."
                variant="panel"
                align="center"
                titleAs="h3"
            />
        );
    }

    const model = buildAuditChangeModel(results, previousResults);

    const metricCards = [
        { label: 'Changed URLs', value: model.summary.changedUrls, detail: 'Any meaningful SEO change detected', accent: 'bg-black text-white', icon: History },
        { label: 'Regressions', value: model.summary.regressions, detail: 'Pages that got worse', accent: 'bg-red-300 text-black', icon: AlertTriangle },
        { label: 'Fixes', value: model.summary.fixes, detail: 'Pages that recovered', accent: 'bg-green-300 text-black', icon: CheckCircle },
        { label: 'Content shifts', value: model.summary.contentChanges, detail: 'Tag or structure changes', accent: 'bg-sky-300 text-black', icon: FileText },
        { label: 'New URLs', value: model.summary.newUrls, detail: 'Newly appearing pages in the audit', accent: 'bg-yellow-300 text-black', icon: Search },
    ];

    return (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="overflow-hidden border-2 border-black bg-[linear-gradient(135deg,_rgba(241,245,249,0.96)_0%,_rgba(253,224,71,0.18)_100%)] shadow-[6px_6px_0px_0px_#000]">
                <div className="grid gap-4 p-5 lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] lg:items-center">
                    <div>
                        <p className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-500">Current snapshot</p>
                        <p className="mt-2 text-2xl font-black uppercase text-black">{currentLabel}</p>
                    </div>
                    <div className="flex items-center justify-center">
                        <div className="border-2 border-black bg-white p-3">
                            <ArrowRight className="h-5 w-5 text-black" />
                        </div>
                    </div>
                    <div className="text-left lg:text-right">
                        <p className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-500">Baseline snapshot</p>
                        <p className="mt-2 text-2xl font-black uppercase text-black">{baselineLabel}</p>
                    </div>
                </div>
            </div>

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
                <div className="space-y-6">
                    {model.sections.map((section) => {
                        const visibleCards = section.cards.filter((card) => card.count > 0);

                        return (
                            <section key={section.id} className="space-y-4">
                                <div>
                                    <p className="text-sm font-black uppercase tracking-[0.2em] text-black">{section.title}</p>
                                    <p className="mt-1 text-sm font-semibold text-slate-600">{section.description}</p>
                                </div>

                                {visibleCards.length > 0 ? (
                                    <div className="space-y-4">
                                        {visibleCards.map((card) => {
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
                                    </div>
                                ) : (
                                    <div className="border-2 border-black bg-slate-50 p-5 text-sm font-semibold text-slate-600 shadow-[4px_4px_0px_0px_rgba(0,0,0,0.08)]">
                                        {section.id === 'regressions'
                                            ? 'No regressions detected against the previous snapshot.'
                                            : section.id === 'fixes'
                                                ? 'No recoveries detected yet in this comparison.'
                                                : 'No content or template changes detected in this comparison.'}
                                    </div>
                                )}
                            </section>
                        );
                    })}
                </div>

                <div className="space-y-6">
                    <div className="border-2 border-black bg-white p-5 shadow-[6px_6px_0px_0px_#000]">
                        <div className="flex items-center justify-between gap-3">
                            <div>
                                <p className="text-sm font-black uppercase tracking-[0.2em] text-black">Audit scope shift</p>
                                <p className="mt-1 text-sm font-medium text-slate-600">New and removed URLs between these two snapshots.</p>
                            </div>
                            <div className="border-2 border-black bg-black p-2 text-white">
                                <History className="h-4 w-4" />
                            </div>
                        </div>

                        <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-1">
                            <div className="border-2 border-black bg-yellow-50 p-4">
                                <div className="flex items-center justify-between gap-3">
                                    <p className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-500">New URLs</p>
                                    <span className="border border-black bg-white px-2 py-1 text-sm font-black text-black">{model.summary.newUrls}</span>
                                </div>
                                <div className="mt-3 space-y-2">
                                    {model.newUrlSamples.length > 0 ? model.newUrlSamples.map((url) => (
                                        <div key={url} className="truncate border border-black bg-white px-2 py-1 text-[11px] font-bold text-slate-700">
                                            {getUrlPathLabel(url)}
                                        </div>
                                    )) : (
                                        <div className="border border-black bg-white px-2 py-2 text-[11px] font-semibold text-slate-500">No new URLs in this comparison.</div>
                                    )}
                                </div>
                            </div>

                            <div className="border-2 border-black bg-slate-50 p-4">
                                <div className="flex items-center justify-between gap-3">
                                    <p className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-500">Removed URLs</p>
                                    <span className="border border-black bg-white px-2 py-1 text-sm font-black text-black">{model.summary.removedUrls}</span>
                                </div>
                                <div className="mt-3 space-y-2">
                                    {model.removedUrlSamples.length > 0 ? model.removedUrlSamples.map((url) => (
                                        <div key={url} className="truncate border border-black bg-white px-2 py-1 text-[11px] font-bold text-slate-700">
                                            {getUrlPathLabel(url)}
                                        </div>
                                    )) : (
                                        <div className="border border-black bg-white px-2 py-2 text-[11px] font-semibold text-slate-500">No removed URLs in this comparison.</div>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="border-2 border-black bg-white p-5 shadow-[6px_6px_0px_0px_#000]">
                        <p className="text-sm font-black uppercase tracking-[0.2em] text-black">How to use this</p>
                        <div className="mt-4 space-y-3 text-sm font-semibold text-slate-700">
                            <div className="border-2 border-black bg-slate-50 p-3">Start with regressions first. They represent net SEO risk added since the previous crawl.</div>
                            <div className="border-2 border-black bg-slate-50 p-3">Use recoveries to confirm fixes actually held after deployment or content changes.</div>
                            <div className="border-2 border-black bg-slate-50 p-3">Treat content shifts as a change log for titles, descriptions, H1s, canonicals, and newly appearing URLs.</div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
