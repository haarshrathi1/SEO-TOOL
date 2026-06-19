import { useMemo } from 'react';
import { AlertTriangle, CheckCircle, Compass, Link2, Search, Target } from 'lucide-react';
import { buildInternalLinkRecommendationsModel } from '../../internalLinkRecommendations';
import type { AuditResult } from '../../types';
import { getUrlPathLabel } from '../../url';
import { OperatorStatePanel } from '../common/OperatorUi';

interface AuditInternalLinksProps {
    results: AuditResult[];
    onReview: (filterId: string) => void;
}

function toneStyles(tone: 'critical' | 'warning' | 'info' | 'positive') {
    if (tone === 'critical') {
        return {
            panel: 'border-red-200 bg-red-50',
            chip: 'bg-red-600 text-white',
            icon: AlertTriangle,
        };
    }

    if (tone === 'warning') {
        return {
            panel: 'border-amber-200 bg-amber-50',
            chip: 'bg-amber-300 text-black',
            icon: AlertTriangle,
        };
    }

    if (tone === 'positive') {
        return {
            panel: 'border-emerald-200 bg-emerald-50',
            chip: 'bg-emerald-300 text-black',
            icon: CheckCircle,
        };
    }

    return {
        panel: 'border-blue-200 bg-blue-50',
        chip: 'bg-blue-300 text-black',
        icon: Compass,
    };
}

function priorityPanelClass(priority: number) {
    if (priority >= 70) {
        return 'border-red-200 bg-red-50';
    }

    if (priority >= 52) {
        return 'border-amber-200 bg-amber-50';
    }

    return 'border-blue-200 bg-blue-50';
}

export default function AuditInternalLinks({ results, onReview }: AuditInternalLinksProps) {
    const model = useMemo(() => buildInternalLinkRecommendationsModel(results), [results]);

    const metricCards = [
        { ...model.metrics[0], accent: 'bg-blue-300', icon: Target },
        { ...model.metrics[1], accent: 'bg-red-300', icon: AlertTriangle },
        { ...model.metrics[2], accent: 'bg-green-300', icon: Link2 },
        { ...model.metrics[3], accent: 'bg-yellow-300', icon: Search },
    ];

    if (!model.hasData) {
        return (
            <OperatorStatePanel
                icon={Compass}
                title="Fresh crawl needed for link recommendations"
                description="Older snapshots did not retain the internal link graph needed to suggest source pages. Run one fresh audit and this tab will start surfacing target pages, source hubs, and section-level weak spots."
                variant="warm"
                align="center"
                titleAs="h3"
            />
        );
    }

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

            <div className="grid gap-6 xl:grid-cols-[minmax(0,1.35fr)_minmax(20rem,0.9fr)]">
                <div className="space-y-4">
                    <div className="border-2 border-black bg-white p-5 shadow-[6px_6px_0px_0px_#000]">
                        <div className="flex flex-wrap items-start justify-between gap-4">
                            <div>
                                <p className="text-sm font-black uppercase tracking-[0.2em] text-black">Top link opportunities</p>
                                <p className="mt-1 max-w-2xl text-sm font-medium text-slate-600">
                                    Priority targets ranked by internal-link need, page value, and available source pages that do not already link to them.
                                </p>
                            </div>
                            <button
                                type="button"
                                onClick={() => onReview('links-opportunities')}
                                disabled={model.opportunities.length === 0}
                                className={`border-2 border-black px-4 py-2 text-sm font-black uppercase shadow-[4px_4px_0px_0px_#000] transition ${model.opportunities.length > 0 ? 'bg-yellow-300 text-black hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-[2px_2px_0px_0px_#000]' : 'cursor-not-allowed bg-slate-100 text-slate-400'}`}
                            >
                                Review targets
                            </button>
                        </div>
                    </div>

                    {model.opportunities.length > 0 ? (
                        model.opportunities.slice(0, 8).map((opportunity) => (
                            <div
                                key={opportunity.targetUrl}
                                className={`border-2 border-black p-4 shadow-[6px_6px_0px_0px_#000] ${priorityPanelClass(opportunity.priority)}`}
                            >
                                <div className="flex items-start justify-between gap-4">
                                    <div className="min-w-0">
                                        <p className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-500">Target page</p>
                                        <a
                                            href={opportunity.targetUrl}
                                            target="_blank"
                                            rel="noreferrer"
                                            className="mt-1 block truncate text-lg font-black uppercase text-black transition hover:text-blue-600 hover:underline"
                                            title={opportunity.targetUrl}
                                        >
                                            {getUrlPathLabel(opportunity.targetUrl)}
                                        </a>
                                        <p className="mt-1 truncate text-sm font-semibold text-slate-700">
                                            {opportunity.targetTitle || 'Untitled page'}
                                        </p>
                                        <div className="mt-3 flex flex-wrap gap-2">
                                            <span className="border border-black bg-white px-2 py-1 text-[11px] font-black uppercase text-black">
                                                In {opportunity.incomingLinks}
                                            </span>
                                            <span className="border border-black bg-white px-2 py-1 text-[11px] font-black uppercase text-black">
                                                {opportunity.status}
                                            </span>
                                            {opportunity.views > 0 && (
                                                <span className="border border-black bg-white px-2 py-1 text-[11px] font-black uppercase text-black">
                                                    {opportunity.views.toLocaleString()} views
                                                </span>
                                            )}
                                        </div>
                                        <div className="mt-3 flex flex-wrap gap-2">
                                            {opportunity.reasons.map((reason) => (
                                                <span
                                                    key={reason}
                                                    className="border border-black bg-black px-2 py-1 text-[11px] font-black uppercase text-white"
                                                >
                                                    {reason}
                                                </span>
                                            ))}
                                        </div>
                                    </div>

                                    <div className="text-right">
                                        <p className="text-4xl font-black text-black">{opportunity.priority}</p>
                                        <p className="mt-2 text-[11px] font-black uppercase tracking-[0.18em] text-slate-500">Priority</p>
                                    </div>
                                </div>

                                <div className="mt-4 border-2 border-black bg-white p-3">
                                    <div className="flex items-center justify-between gap-3">
                                        <p className="text-xs font-black uppercase tracking-[0.18em] text-black">Suggested source pages</p>
                                        <span className="border border-black bg-slate-100 px-2 py-0.5 text-[11px] font-black text-black">
                                            {opportunity.sources.length}
                                        </span>
                                    </div>

                                    <div className="mt-3 space-y-2">
                                        {opportunity.sources.map((source) => (
                                            <a
                                                key={`${opportunity.targetUrl}-${source.url}`}
                                                href={source.url}
                                                target="_blank"
                                                rel="noreferrer"
                                                className="block border-2 border-black bg-slate-50 p-3 transition hover:bg-white hover:shadow-[4px_4px_0px_0px_#000]"
                                                title={source.url}
                                            >
                                                <div className="flex items-start justify-between gap-3">
                                                    <div className="min-w-0">
                                                        <p className="truncate text-sm font-black text-black">{getUrlPathLabel(source.url)}</p>
                                                        <p className="mt-1 truncate font-mono text-[10px] font-bold text-slate-500">{source.url}</p>
                                                        <div className="mt-2 flex flex-wrap gap-1.5">
                                                            {source.reasons.map((reason) => (
                                                                <span
                                                                    key={reason}
                                                                    className="border border-black bg-white px-1.5 py-0.5 text-[10px] font-black uppercase text-black"
                                                                >
                                                                    {reason}
                                                                </span>
                                                            ))}
                                                        </div>
                                                    </div>
                                                    <div className="flex flex-col items-end gap-2">
                                                        <span className="border border-black bg-yellow-300 px-2 py-1 text-[11px] font-black text-black">
                                                            {source.score}
                                                        </span>
                                                        <span className="text-[10px] font-bold uppercase text-slate-500">
                                                            {(source.views || source.incomingLinks)
                                                                ? `${source.views > 0 ? `${source.views}v` : ''}${source.views > 0 && source.incomingLinks > 0 ? ' / ' : ''}${source.incomingLinks > 0 ? `${source.incomingLinks}in` : ''}`
                                                                : 'support page'}
                                                        </span>
                                                    </div>
                                                </div>
                                            </a>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        ))
                    ) : (
                        <OperatorStatePanel
                            icon={CheckCircle}
                            title="No obvious link targets"
                            description="This snapshot does not show any pages that are both weakly supported and strong enough to justify new internal links right now."
                            variant="inset"
                            align="center"
                            titleAs="h3"
                        />
                    )}
                </div>

                <div className="space-y-6">
                    <div className="space-y-3">
                        {model.cards.map((card) => {
                            const styles = toneStyles(card.tone);
                            const Icon = styles.icon;
                            const actionable = card.count > 0;

                            return (
                                <button
                                    key={card.id}
                                    type="button"
                                    disabled={!actionable}
                                    onClick={() => onReview(card.id)}
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

                    <div className="border-2 border-black bg-white p-5 shadow-[6px_6px_0px_0px_#000]">
                        <div className="flex items-center justify-between gap-3">
                            <div>
                                <p className="text-sm font-black uppercase tracking-[0.2em] text-black">Weak sections</p>
                                <p className="mt-1 text-sm font-medium text-slate-600">Sections producing the most link opportunity targets.</p>
                            </div>
                            <div className="border-2 border-black bg-black p-2 text-white">
                                <Compass className="h-4 w-4" />
                            </div>
                        </div>

                        <div className="mt-4 space-y-3">
                            {model.sectionBreakdown.length > 0 ? (
                                model.sectionBreakdown.map((bucket) => (
                                    <div key={bucket.label} className="flex items-center justify-between gap-3 border-2 border-black bg-slate-50 px-3 py-2">
                                        <span className="text-sm font-bold text-black">{bucket.label}</span>
                                        <span className="border border-black bg-white px-2 py-1 text-sm font-black text-black">{bucket.count}</span>
                                    </div>
                                ))
                            ) : (
                                <div className="border-2 border-black bg-slate-50 p-4 text-sm font-semibold text-slate-600">
                                    No section clusters are weak enough to flag right now.
                                </div>
                            )}
                        </div>
                    </div>

                    <div className="border-2 border-black bg-white p-5 shadow-[6px_6px_0px_0px_#000]">
                        <div className="flex items-center justify-between gap-3">
                            <div>
                                <p className="text-sm font-black uppercase tracking-[0.2em] text-black">Strong source pages</p>
                                <p className="mt-1 text-sm font-medium text-slate-600">Best candidates for passing internal authority deeper into the site.</p>
                            </div>
                            <div className="border-2 border-black bg-yellow-300 p-2">
                                <Link2 className="h-4 w-4 text-black" />
                            </div>
                        </div>

                        <div className="mt-4 space-y-3">
                            {model.sourceHubs.length > 0 ? (
                                model.sourceHubs.map((hub) => (
                                    <a
                                        key={hub.url}
                                        href={hub.url}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="block border-2 border-black bg-slate-50 p-3 transition hover:bg-white hover:shadow-[4px_4px_0px_0px_#000]"
                                        title={hub.url}
                                    >
                                        <div className="flex items-start justify-between gap-3">
                                            <div className="min-w-0">
                                                <p className="truncate text-sm font-black text-black">{getUrlPathLabel(hub.url)}</p>
                                                <p className="mt-1 truncate font-mono text-[10px] font-bold text-slate-500">{hub.url}</p>
                                                <div className="mt-2 flex flex-wrap gap-1.5">
                                                    {hub.reasons.map((reason) => (
                                                        <span key={reason} className="border border-black bg-white px-1.5 py-0.5 text-[10px] font-black uppercase text-black">
                                                            {reason}
                                                        </span>
                                                    ))}
                                                </div>
                                            </div>

                                            <div className="text-right">
                                                <div className="border border-black bg-yellow-300 px-2 py-1 text-[11px] font-black text-black">{hub.score}</div>
                                                <p className="mt-2 text-[10px] font-bold uppercase text-slate-500">
                                                    {hub.incomingLinks} in / {hub.internalLinksOut} out
                                                </p>
                                            </div>
                                        </div>
                                    </a>
                                ))
                            ) : (
                                <div className="border-2 border-black bg-slate-50 p-4 text-sm font-semibold text-slate-600">
                                    No strong source hubs surfaced in this snapshot yet.
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
