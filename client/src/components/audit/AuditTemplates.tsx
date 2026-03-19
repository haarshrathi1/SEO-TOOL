import { useMemo } from 'react';
import { AlertTriangle, CheckCircle, GitBranch, Search } from 'lucide-react';
import { buildTemplateClusterModel } from '../../templateClusters';
import type { AuditResult } from '../../types';
import { getUrlPathLabel } from '../../url';
import { OperatorStatePanel } from '../common/OperatorUi';

interface AuditTemplatesProps {
    results: AuditResult[];
    onReview: (filterId: string) => void;
}

function toneStyles(tone: 'critical' | 'warning' | 'info') {
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

    return {
        panel: 'border-sky-200 bg-sky-50',
        chip: 'bg-sky-300 text-black',
        icon: Search,
    };
}

function getClusterTone(criticalCount: number, warningCount: number) {
    if (criticalCount > 0) {
        return 'critical' as const;
    }

    if (warningCount > 0) {
        return 'warning' as const;
    }

    return 'info' as const;
}

export default function AuditTemplates({ results, onReview }: AuditTemplatesProps) {
    const model = useMemo(() => buildTemplateClusterModel(results), [results]);

    if (!model.hasClusters) {
        return (
            <OperatorStatePanel
                icon={GitBranch}
                title="Need repeated URL patterns first"
                description="This snapshot does not contain enough multi-page URL families to cluster into templates yet. The panel turns on once the audit has repeated path patterns like /blog/:slug or /category/:slug."
                variant="panel"
                align="center"
                titleAs="h3"
            />
        );
    }

    const metricCards = [
        { ...model.metrics[0], accent: 'bg-red-300', icon: AlertTriangle },
        { ...model.metrics[1], accent: 'bg-blue-300', icon: GitBranch },
        { ...model.metrics[2], accent: 'bg-yellow-300', icon: Search },
        { ...model.metrics[3], accent: 'bg-green-300', icon: CheckCircle },
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

            <div className="grid gap-6 xl:grid-cols-[minmax(0,1.25fr)_minmax(22rem,0.95fr)]">
                <div className="space-y-4">
                    {model.clusters.length > 0 ? (
                        model.clusters.map((cluster) => {
                            const criticalCount = cluster.issueBreakdown.filter((issue) => issue.tone === 'critical').length;
                            const warningCount = cluster.issueBreakdown.filter((issue) => issue.tone === 'warning').length;
                            const tone = getClusterTone(criticalCount, warningCount);
                            const styles = toneStyles(tone);
                            const Icon = styles.icon;

                            return (
                                <button
                                    key={cluster.id}
                                    type="button"
                                    onClick={() => onReview(cluster.id)}
                                    className={`w-full border-2 border-black p-4 text-left shadow-[6px_6px_0px_0px_#000] transition-all hover:translate-x-[-2px] hover:translate-y-[-2px] hover:shadow-[8px_8px_0px_0px_#000] ${styles.panel}`}
                                >
                                    <div className="flex items-start justify-between gap-4">
                                        <div className="min-w-0">
                                            <div className="flex items-center gap-3">
                                                <div className={`border-2 border-black p-2 ${styles.chip}`}>
                                                    <Icon className="h-4 w-4" />
                                                </div>
                                                <div>
                                                    <p className="font-mono text-lg font-black text-black">{cluster.pattern}</p>
                                                    <p className="text-sm font-semibold text-slate-700">
                                                        {cluster.pageCount} pages, {cluster.issuePages} affected, {cluster.indexedRate}% indexed
                                                    </p>
                                                </div>
                                            </div>

                                            <div className="mt-4 flex flex-wrap gap-2">
                                                {cluster.issueBreakdown.map((issue) => (
                                                    <span
                                                        key={`${cluster.id}-${issue.id}`}
                                                        className={`border border-black px-2 py-1 text-[11px] font-black uppercase ${issue.tone === 'critical' ? 'bg-red-600 text-white' : issue.tone === 'warning' ? 'bg-amber-300 text-black' : 'bg-white text-black'}`}
                                                    >
                                                        {issue.count} {issue.label}
                                                    </span>
                                                ))}
                                            </div>

                                            <div className="mt-4 flex flex-wrap gap-2">
                                                {cluster.sampleUrls.map((url) => (
                                                    <span key={url} className="max-w-full truncate border border-black bg-white px-2 py-1 text-[11px] font-bold text-slate-700">
                                                        {getUrlPathLabel(url)}
                                                    </span>
                                                ))}
                                            </div>
                                        </div>

                                        <div className="text-right">
                                            <p className="text-4xl font-black text-black">{cluster.affectedRate}%</p>
                                            <p className="mt-2 text-[11px] font-black uppercase tracking-[0.18em] text-slate-500">Affected</p>
                                            <div className="mt-3 border-2 border-black bg-white px-3 py-2 text-[11px] font-black uppercase text-black">
                                                Review pages
                                            </div>
                                        </div>
                                    </div>
                                </button>
                            );
                        })
                    ) : (
                        <OperatorStatePanel
                            icon={CheckCircle}
                            title="Clustered templates look stable"
                            description="The audit found repeatable URL templates, but none of them are carrying repeated SEO issues right now."
                            variant="inset"
                            align="center"
                            titleAs="h3"
                        />
                    )}
                </div>

                <div className="space-y-6">
                    <div className="border-2 border-black bg-white p-5 shadow-[6px_6px_0px_0px_#000]">
                        <div className="flex items-center justify-between gap-3">
                            <div>
                                <p className="text-sm font-black uppercase tracking-[0.2em] text-black">Common issue patterns</p>
                                <p className="mt-1 text-sm font-medium text-slate-600">Issue categories that repeat across clustered templates.</p>
                            </div>
                            <div className="border-2 border-black bg-black p-2 text-white">
                                <AlertTriangle className="h-4 w-4" />
                            </div>
                        </div>

                        <div className="mt-4 space-y-3">
                            {model.issueLeaders.length > 0 ? (
                                model.issueLeaders.map((issue) => (
                                    <div key={issue.id} className="flex items-center justify-between gap-3 border-2 border-black bg-slate-50 px-3 py-2">
                                        <div>
                                            <p className="text-sm font-bold text-black">{issue.label}</p>
                                            <p className="text-[11px] font-semibold uppercase text-slate-500">{issue.templateCount} templates</p>
                                        </div>
                                        <span className={`border border-black px-2 py-1 text-sm font-black ${issue.tone === 'critical' ? 'bg-red-600 text-white' : issue.tone === 'warning' ? 'bg-amber-300 text-black' : 'bg-white text-black'}`}>
                                            {issue.count}
                                        </span>
                                    </div>
                                ))
                            ) : (
                                <div className="border-2 border-black bg-slate-50 p-4 text-sm font-semibold text-slate-600">
                                    No repeated issue pattern is dominating the clustered templates.
                                </div>
                            )}
                        </div>
                    </div>

                    <div className="border-2 border-black bg-white p-5 shadow-[6px_6px_0px_0px_#000]">
                        <div className="flex items-center justify-between gap-3">
                            <div>
                                <p className="text-sm font-black uppercase tracking-[0.2em] text-black">Healthy templates</p>
                                <p className="mt-1 text-sm font-medium text-slate-600">Repeatable URL families that look clean right now.</p>
                            </div>
                            <div className="border-2 border-black bg-green-300 p-2">
                                <CheckCircle className="h-4 w-4 text-black" />
                            </div>
                        </div>

                        <div className="mt-4 space-y-3">
                            {model.healthyTemplates.length > 0 ? (
                                model.healthyTemplates.map((cluster) => (
                                    <button
                                        key={cluster.id}
                                        type="button"
                                        onClick={() => onReview(cluster.id)}
                                        className="block w-full border-2 border-black bg-slate-50 p-3 text-left transition hover:bg-white hover:shadow-[4px_4px_0px_0px_#000]"
                                    >
                                        <div className="flex items-start justify-between gap-3">
                                            <div className="min-w-0">
                                                <p className="font-mono text-sm font-black text-black">{cluster.pattern}</p>
                                                <p className="mt-1 text-[11px] font-semibold uppercase text-slate-500">{cluster.pageCount} pages, {cluster.indexedRate}% indexed</p>
                                            </div>
                                            <span className="border border-black bg-white px-2 py-1 text-[11px] font-black text-black">View</span>
                                        </div>
                                    </button>
                                ))
                            ) : (
                                <div className="border-2 border-black bg-slate-50 p-4 text-sm font-semibold text-slate-600">
                                    No fully clean template cluster surfaced in this snapshot.
                                </div>
                            )}
                        </div>
                    </div>

                    <div className="border-2 border-black bg-white p-5 shadow-[6px_6px_0px_0px_#000]">
                        <p className="text-sm font-black uppercase tracking-[0.2em] text-black">How clustering works</p>
                        <div className="mt-4 space-y-3 text-sm font-semibold text-slate-700">
                            <div className="border-2 border-black bg-slate-50 p-3">Templates are inferred from repeatable URL patterns, not from DOM hashes, so the panel stays fast and crawl-light.</div>
                            <div className="border-2 border-black bg-slate-50 p-3">Stable segments stay literal and variable positions become placeholders like <span className="font-mono">:slug</span> or <span className="font-mono">:section</span>.</div>
                            <div className="border-2 border-black bg-slate-50 p-3">Use this view to find template-wide bugs first, then jump into the filtered pages table to inspect the exact URLs inside that pattern.</div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
