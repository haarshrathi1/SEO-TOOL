import { useMemo } from 'react';
import { AlertTriangle, CheckCircle, Globe, Info, Search, XCircle } from 'lucide-react';
import type { AuditResult } from '../../types';
import { buildIndexationGapModel } from '../../indexationGap';
import { getUrlPathLabel } from '../../url';

interface AuditIndexationProps {
    results: AuditResult[];
    onReview: (filterId: string) => void;
}

function toneStyles(tone: 'critical' | 'warning' | 'info' | 'positive') {
    if (tone === 'critical') {
        return {
            panel: 'border-red-200 bg-red-50',
            chip: 'bg-red-600 text-white',
            icon: XCircle,
        };
    }

    if (tone === 'warning') {
        return {
            panel: 'border-amber-200 bg-amber-50',
            chip: 'bg-amber-300 text-black',
            icon: AlertTriangle,
        };
    }

    if (tone === 'info') {
        return {
            panel: 'border-blue-200 bg-blue-50',
            chip: 'bg-blue-300 text-black',
            icon: Info,
        };
    }

    return {
        panel: 'border-emerald-200 bg-emerald-50',
        chip: 'bg-emerald-300 text-black',
        icon: CheckCircle,
    };
}

export default function AuditIndexation({ results, onReview }: AuditIndexationProps) {
    const model = useMemo(() => buildIndexationGapModel(results), [results]);

    const metricCards = [
        {
            label: 'Sitemap URLs',
            value: model.summary.sitemapUrls,
            detail: 'Current audit set',
            accent: 'bg-cyan-300',
            icon: Globe,
        },
        {
            label: 'Indexed URLs',
            value: model.summary.indexedUrls,
            detail: 'Serving or stored by Google',
            accent: 'bg-green-300',
            icon: CheckCircle,
        },
        {
            label: 'Linked URLs',
            value: model.summary.internallyLinkedUrls,
            detail: 'Have at least one incoming internal link',
            accent: 'bg-yellow-300',
            icon: Search,
        },
        {
            label: 'Internal-only URLs',
            value: model.summary.internalOnlyUrls,
            detail: model.hasInternalDiscovery ? 'Found in internal links but absent from the audited URL set' : 'Available after the next fresh audit',
            accent: 'bg-pink-300',
            icon: AlertTriangle,
        },
    ];

    return (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                {metricCards.map((card) => (
                    <div key={card.label} className="border-2 border-black bg-white p-5 shadow-[6px_6px_0px_0px_#000]">
                        <div className="flex items-start justify-between gap-3">
                            <div>
                                <p className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-500">{card.label}</p>
                                <p className="mt-3 text-4xl font-black text-black">{card.value}</p>
                                <p className="mt-2 text-sm font-semibold text-slate-600">{card.detail}</p>
                            </div>
                            <div className={`border-2 border-black p-2 ${card.accent}`}>
                                <card.icon className="h-5 w-5 text-black" />
                            </div>
                        </div>
                    </div>
                ))}
            </div>

            {!model.hasInternalDiscovery && (
                <div className="border-2 border-black bg-[#fff7d6] p-4 shadow-[6px_6px_0px_0px_#000]">
                    <p className="text-sm font-black uppercase text-black">Internal-only discovery needs one fresh crawl</p>
                    <p className="mt-1 text-sm font-medium text-slate-700">
                        Older snapshots did not retain internal link targets. Run a new audit once and this panel will start surfacing URLs that are linked internally but missing from the audited sitemap-backed set.
                    </p>
                </div>
            )}

            <div className="grid gap-6 xl:grid-cols-[minmax(0,1.3fr)_minmax(20rem,0.9fr)]">
                <div className="space-y-4">
                    {model.cards.map((card) => {
                        const styles = toneStyles(card.tone);
                        const Icon = styles.icon;
                        const actionable = Boolean(card.reviewFilterId) && card.count > 0;

                        return (
                            <button
                                key={card.id}
                                type="button"
                                disabled={!actionable}
                                onClick={() => {
                                    if (card.reviewFilterId) {
                                        onReview(card.reviewFilterId);
                                    }
                                }}
                                className={`w-full border-2 border-black p-4 text-left shadow-[6px_6px_0px_0px_#000] transition-all ${styles.panel} ${actionable ? 'hover:translate-x-[-2px] hover:translate-y-[-2px] hover:shadow-[8px_8px_0px_0px_#000]' : 'cursor-default'}`}
                            >
                                <div className="flex items-start justify-between gap-4">
                                    <div className="min-w-0">
                                        <div className="flex items-center gap-3">
                                            <div className={`border-2 border-black p-2 ${styles.chip}`}>
                                                <Icon className="h-4 w-4" />
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
                                        <p className="mt-2 text-[11px] font-black uppercase tracking-[0.18em] text-slate-500">
                                            {actionable ? 'Review pages' : 'Clean'}
                                        </p>
                                    </div>
                                </div>
                            </button>
                        );
                    })}
                </div>

                <div className="space-y-6">
                    <div className="border-2 border-black bg-white p-5 shadow-[6px_6px_0px_0px_#000]">
                        <div className="flex items-center justify-between gap-3">
                            <div>
                                <p className="text-sm font-black uppercase tracking-[0.2em] text-black">Coverage states</p>
                                <p className="mt-1 text-sm font-medium text-slate-600">How the audited URL set breaks down right now.</p>
                            </div>
                            <div className="border-2 border-black bg-black p-2 text-white">
                                <Search className="h-4 w-4" />
                            </div>
                        </div>

                        <div className="mt-4 space-y-3">
                            {model.coverage.slice(0, 6).map((bucket) => (
                                <div key={bucket.label} className="flex items-center justify-between gap-3 border-2 border-black bg-slate-50 px-3 py-2">
                                    <span className="text-sm font-bold text-black">{bucket.label}</span>
                                    <span className="border border-black bg-white px-2 py-1 text-sm font-black text-black">{bucket.count}</span>
                                </div>
                            ))}
                        </div>
                    </div>

                    <div className="border-2 border-black bg-white p-5 shadow-[6px_6px_0px_0px_#000]">
                        <p className="text-sm font-black uppercase tracking-[0.2em] text-black">Internal-only URL samples</p>
                        <p className="mt-1 text-sm font-medium text-slate-600">
                            URLs found in internal links but absent from the audited sitemap-backed URL set.
                        </p>

                        <div className="mt-4 space-y-3">
                            {model.internalOnlySamples.length > 0 ? (
                                model.internalOnlySamples.map((url) => (
                                    <a
                                        key={url}
                                        href={url}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="block truncate border-2 border-black bg-slate-50 px-3 py-2 text-sm font-bold text-black transition hover:bg-white hover:shadow-[4px_4px_0px_0px_#000]"
                                        title={url}
                                    >
                                        {getUrlPathLabel(url)}
                                    </a>
                                ))
                            ) : (
                                <div className="border-2 border-black bg-slate-50 p-4 text-sm font-semibold text-slate-600">
                                    {model.hasInternalDiscovery
                                        ? 'No internal-only URLs found in this snapshot.'
                                        : 'Run a fresh audit to populate this list.'}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
