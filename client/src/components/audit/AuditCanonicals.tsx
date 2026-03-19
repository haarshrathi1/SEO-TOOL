import { AlertTriangle, CheckCircle, GitBranch, Globe, Link2, Route, XCircle } from 'lucide-react';
import type { AuditResult } from '../../types';
import { buildCanonicalAuditModel, type CanonicalFlag } from '../../canonicalAudit';
import { getUrlPathLabel } from '../../url';

interface AuditCanonicalsProps {
    results: AuditResult[];
    onReview: (filterId: CanonicalFlag) => void;
}

function toneStyles(tone: 'critical' | 'warning' | 'info') {
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

    return {
        panel: 'border-sky-200 bg-sky-50',
        chip: 'bg-sky-300 text-black',
        icon: Route,
    };
}

export default function AuditCanonicals({ results, onReview }: AuditCanonicalsProps) {
    const model = buildCanonicalAuditModel(results);
    const cards = [...model.cards].sort((left, right) => right.count - left.count || left.label.localeCompare(right.label));

    const metricCards = [
        { ...model.metrics[0], accent: 'bg-green-300', icon: CheckCircle },
        { ...model.metrics[1], accent: 'bg-yellow-300', icon: Route },
        { ...model.metrics[2], accent: 'bg-orange-300', icon: Link2 },
        { ...model.metrics[3], accent: 'bg-red-300', icon: GitBranch },
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

            {!model.hasCanonicalData && (
                <div className="border-2 border-black bg-[#fff7d6] p-4 shadow-[6px_6px_0px_0px_#000]">
                    <p className="text-sm font-black uppercase text-black">Canonical diagnostics need one fresh audit</p>
                    <p className="mt-1 text-sm font-medium text-slate-700">
                        Older snapshots were collected before canonical and redirect signals were stored. Run one fresh audit and this panel will populate fully.
                    </p>
                </div>
            )}

            <div className="grid gap-6 xl:grid-cols-[minmax(0,1.25fr)_minmax(22rem,0.95fr)]">
                <div className="space-y-4">
                    {cards.map((card) => {
                        const styles = toneStyles(card.tone);
                        const Icon = styles.icon;
                        const actionable = card.count > 0;

                        return (
                            <button
                                key={card.flag}
                                type="button"
                                disabled={!actionable}
                                onClick={() => onReview(card.flag)}
                                className={`w-full border-2 border-black p-4 text-left shadow-[6px_6px_0px_0px_#000] transition-all ${styles.panel} ${actionable ? 'hover:translate-x-[-2px] hover:translate-y-[-2px] hover:shadow-[8px_8px_0px_0px_#000]' : 'cursor-default'}`}
                            >
                                <div className="flex items-start justify-between gap-4">
                                    <div className="min-w-0">
                                        <div className="flex items-center gap-3">
                                            <div className={`border-2 border-black p-2 ${styles.chip}`}>
                                                <Icon className="h-4 w-4" />
                                            </div>
                                            <div>
                                                <p className="text-lg font-black uppercase text-black">{card.label}</p>
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
                                <p className="text-sm font-black uppercase tracking-[0.2em] text-black">What this panel is checking</p>
                                <p className="mt-1 text-sm font-medium text-slate-600">Canonical integrity and redirect hygiene for the URLs in this audit snapshot.</p>
                            </div>
                            <div className="border-2 border-black bg-black p-2 text-white">
                                <Globe className="h-4 w-4" />
                            </div>
                        </div>

                        <div className="mt-4 space-y-3 text-sm font-semibold text-slate-700">
                            <div className="border-2 border-black bg-slate-50 p-3">Single self-canonicals that resolve directly are treated as healthy.</div>
                            <div className="border-2 border-black bg-slate-50 p-3">Redirecting sitemap URLs are flagged because they waste crawl paths and muddy canonical signals.</div>
                            <div className="border-2 border-black bg-slate-50 p-3">Canonicals that point off-host, loop, or land on redirect sources are treated as critical.</div>
                        </div>
                    </div>

                    <div className="border-2 border-black bg-white p-5 shadow-[6px_6px_0px_0px_#000]">
                        <p className="text-sm font-black uppercase tracking-[0.2em] text-black">Healthy baseline</p>
                        <p className="mt-1 text-sm font-medium text-slate-600">Pages with one clean self-canonical and no redirect noise.</p>
                        <div className="mt-4 border-2 border-black bg-green-50 p-5">
                            <div className="flex items-center justify-between gap-4">
                                <div>
                                    <p className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-500">Healthy self canonicals</p>
                                    <p className="mt-2 text-5xl font-black text-black">{model.healthySelfCanonicalCount}</p>
                                </div>
                                <div className="border-2 border-black bg-green-300 p-3">
                                    <CheckCircle className="h-6 w-6 text-black" />
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
