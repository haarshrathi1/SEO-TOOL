import { useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle, Info, Play, XCircle } from 'lucide-react';
import { getCanonicalBadges } from '../../canonicalAudit';
import { getInternalLinkBadges } from '../../internalLinkRecommendations';
import { getStructuredDataBadges } from '../../structuredDataAudit';
import { computeSeoScore, getSeoScoreBadgeClass, getSeoScoreBarClass } from '../../seoScore';
import type { SeoScoreBreakdown } from '../../seoScore';
import type { AuditResult } from '../../types';
import { getUrlPathLabel } from '../../url';

interface TableProps {
    results: AuditResult[];
    onRequestIndexing?: ((url: string) => void) | null;
}

const SCORE_CATEGORIES: Array<{ key: keyof Omit<SeoScoreBreakdown, 'total' | 'label'>; label: string }> = [
    { key: 'title', label: 'Title' },
    { key: 'description', label: 'Description' },
    { key: 'h1', label: 'H1 Tag' },
    { key: 'content', label: 'Content Depth' },
    { key: 'canonical', label: 'Canonicals' },
    { key: 'speed', label: 'Page Speed' },
    { key: 'indexation', label: 'Indexation' },
];

function ScoreBreakdownPanel({ breakdown }: { breakdown: SeoScoreBreakdown }) {
    return (
        <div className="absolute left-1/2 top-full z-50 mt-1 w-60 -translate-x-1/2 border-2 border-black bg-white shadow-[4px_4px_0_0_#000]">
            <div className={`flex items-center justify-between border-b-2 border-black px-3 py-2 ${getSeoScoreBadgeClass(breakdown.total)}`}>
                <span className="text-[10px] font-black uppercase tracking-widest">SEO Score</span>
                <span className="text-lg font-black">{breakdown.total}<span className="text-xs">/100</span></span>
            </div>
            <div className="divide-y divide-black/10 px-3 py-2">
                {SCORE_CATEGORIES.map(({ key, label }) => {
                    const cat = breakdown[key];
                    const pct = Math.round((cat.score / cat.max) * 100);
                    return (
                        <div key={key} className="py-1.5">
                            <div className="mb-1 flex items-center justify-between">
                                <span className="text-[10px] font-black uppercase tracking-wide text-slate-500">{label}</span>
                                <span className="font-mono text-[10px] font-black text-black">{cat.score}/{cat.max}</span>
                            </div>
                            <div className="h-1.5 w-full border border-black/20 bg-slate-100">
                                <div
                                    className={`h-full transition-all ${getSeoScoreBarClass(pct)}`}
                                    style={{ width: `${pct}%` }}
                                />
                            </div>
                            <p className="mt-0.5 text-[9px] font-medium text-slate-500">{cat.reason}</p>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

export default function AuditTable({ results, onRequestIndexing = null }: TableProps) {
    const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

    const scores = useMemo(() => results.map(computeSeoScore), [results]);

    const indexedCount = results.filter((r) => r.status === 'PASS').length;
    const reviewCount = results.filter((r) => r.status !== 'PASS').length;
    const viewsTrackedCount = results.filter((r) => typeof r.ga4_views === 'number').length;
    const totalTrackedViews = results.reduce((sum, r) => sum + (typeof r.ga4_views === 'number' ? r.ga4_views : 0), 0);
    const avgSeoScore = scores.length > 0
        ? Math.round(scores.reduce((sum, s) => sum + s.total, 0) / scores.length)
        : 0;

    const getStatusBadge = (status: string, coverage: string) => {
        const s = status?.toUpperCase() || 'UNKNOWN';
        if (s === 'PASS') {
            const cls = coverage === 'Indexed (Dormant)'
                ? 'bg-blue-300'
                : 'bg-green-300';
            return (
                <span className={`inline-flex items-center gap-1.5 border-2 border-black ${cls} px-2 py-0.5 text-xs font-black text-black shadow-[2px_2px_0px_0px_#000]`}>
                    <CheckCircle className="h-3 w-3" />
                    {coverage === 'Indexed (Dormant)' ? 'INDEXED' : 'LIVE'}
                </span>
            );
        }
        if (s === 'FAIL') return <span className="inline-flex items-center gap-1.5 border-2 border-black bg-red-600 px-2 py-0.5 text-xs font-black text-white shadow-[2px_2px_0px_0px_#000]"><XCircle className="h-3 w-3" /> FAILED</span>;
        if (s === 'PARTIAL') return <span className="inline-flex items-center gap-1.5 border-2 border-black bg-amber-300 px-2 py-0.5 text-xs font-black text-black shadow-[2px_2px_0px_0px_#000]"><AlertTriangle className="h-3 w-3" /> WARNING</span>;
        if (s === 'NEUTRAL') return <span className="inline-flex items-center gap-1.5 border-2 border-black bg-gray-300 px-2 py-0.5 text-xs font-black text-black shadow-[2px_2px_0px_0px_#000]"><Info className="h-3 w-3" /> EXCLUDED</span>;
        return <span className="inline-flex items-center gap-1.5 border-2 border-black bg-slate-200 px-2 py-0.5 text-xs font-black text-black shadow-[2px_2px_0px_0px_#000]">{s}</span>;
    };

    const getBadgeCls = (tone: 'critical' | 'warning' | 'info' | 'positive') => {
        if (tone === 'critical') return 'bg-red-600 text-white';
        if (tone === 'warning') return 'bg-amber-300 text-black';
        if (tone === 'info') return 'bg-sky-300 text-black';
        return 'bg-green-300 text-black';
    };

    return (
        <div className="overflow-hidden border-2 border-black bg-white shadow-[8px_8px_0px_0px_#000]">
            {/* Summary strip */}
            <div className="grid gap-2 border-b-2 border-black bg-slate-100 p-3 md:grid-cols-5">
                <div className="border border-black bg-white px-3 py-2 shadow-[2px_2px_0px_0px_rgba(0,0,0,0.1)]">
                    <div className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">Pages Loaded</div>
                    <div className="mt-1 text-2xl font-black text-black">{results.length}</div>
                </div>
                <div className="border border-black bg-green-50 px-3 py-2 shadow-[2px_2px_0px_0px_rgba(0,0,0,0.1)]">
                    <div className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">Indexed Pages</div>
                    <div className="mt-1 text-2xl font-black text-black">{indexedCount}</div>
                </div>
                <div className="border border-black bg-red-50 px-3 py-2 shadow-[2px_2px_0px_0px_rgba(0,0,0,0.1)]">
                    <div className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">Review Queue</div>
                    <div className="mt-1 text-2xl font-black text-black">{reviewCount}</div>
                </div>
                <div className={`border border-black px-3 py-2 shadow-[2px_2px_0px_0px_rgba(0,0,0,0.1)] ${avgSeoScore >= 80 ? 'bg-emerald-50' : avgSeoScore >= 60 ? 'bg-yellow-50' : avgSeoScore >= 40 ? 'bg-amber-50' : 'bg-red-50'}`}>
                    <div className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">Avg SEO Score</div>
                    <div className={`mt-1 text-2xl font-black ${avgSeoScore >= 80 ? 'text-emerald-700' : avgSeoScore >= 60 ? 'text-yellow-700' : avgSeoScore >= 40 ? 'text-amber-700' : 'text-red-700'}`}>
                        {avgSeoScore}<span className="text-sm text-slate-400">/100</span>
                    </div>
                    <div className="mt-1 h-1.5 w-full border border-black/10 bg-white">
                        <div className={`h-full ${getSeoScoreBarClass(avgSeoScore)}`} style={{ width: `${avgSeoScore}%` }} />
                    </div>
                </div>
                <div className="border border-black bg-sky-50 px-3 py-2 shadow-[2px_2px_0px_0px_rgba(0,0,0,0.1)]">
                    <div className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">Tracked Views</div>
                    <div className="mt-1 text-2xl font-black text-black">{totalTrackedViews.toLocaleString()}</div>
                    <div className="text-[10px] font-bold uppercase text-slate-500">{viewsTrackedCount}/{results.length} with GA4</div>
                </div>
            </div>

            {/* Table */}
            <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                    <thead className="sticky top-0 z-10 border-b-2 border-black bg-slate-100 text-[11px] font-black uppercase tracking-wider text-black">
                        <tr>
                            <th className="w-[30%] border-r-2 border-black px-6 py-4">Page Detail</th>
                            <th className="w-[15%] border-r-2 border-black px-6 py-4">Indexing Status</th>
                            <th className="w-[20%] border-r-2 border-black px-6 py-4">Content Health</th>
                            <th className="w-[10%] border-r-2 border-black px-4 py-4 text-center">SEO Score</th>
                            <th className="w-[10%] border-r-2 border-black px-4 py-4 text-center">Links</th>
                            <th className="w-[8%] border-r-2 border-black px-4 py-4 text-center">PSI</th>
                            <th className="w-[7%] px-4 py-4 text-right">Views</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y-2 divide-black">
                        {results.map((result, index) => {
                            const score = scores[index];
                            const badgeCls = getSeoScoreBadgeClass(score.total);

                            return (
                                <tr key={`${result.url}-${index}`} className="group transition-colors hover:bg-yellow-50">
                                    {/* Page Detail */}
                                    <td className="border-r-2 border-black px-6 py-4">
                                        <div className="flex items-center justify-between gap-4">
                                            <div className="min-w-0">
                                                <a
                                                    href={result.url}
                                                    target="_blank"
                                                    rel="noreferrer"
                                                    className="block truncate text-sm font-bold uppercase text-black transition-all decoration-2 underline-offset-2 hover:text-blue-600 hover:underline"
                                                    title={result.url}
                                                >
                                                    {getUrlPathLabel(result.url)}
                                                </a>
                                                <div className="mt-0.5 max-w-[280px] truncate font-mono text-[10px] font-bold text-slate-500">{result.url}</div>
                                                {result.redirected && result.finalUrl && result.finalUrl !== result.url && (
                                                    <div className="mt-1 max-w-[280px] truncate font-mono text-[10px] font-bold text-amber-700">
                                                        ↪ {getUrlPathLabel(result.finalUrl)}
                                                    </div>
                                                )}
                                                {result.canonicalUrl && (
                                                    <div className="mt-1 max-w-[280px] truncate font-mono text-[10px] font-bold text-sky-700">
                                                        canonical → {getUrlPathLabel(result.canonicalUrl)}
                                                    </div>
                                                )}
                                            </div>
                                            {onRequestIndexing && result.status !== 'PASS' && (
                                                <div className="opacity-0 transition-opacity group-hover:opacity-100">
                                                    <button
                                                        onClick={() => onRequestIndexing(result.url)}
                                                        className="rounded-none border-2 border-black p-1.5 text-black shadow-[2px_2px_0px_0px_#000] transition-colors hover:bg-black hover:text-white active:translate-x-[1px] active:translate-y-[1px] active:shadow-none"
                                                        title="Request Indexing"
                                                    >
                                                        <Play className="h-3.5 w-3.5 fill-current" />
                                                    </button>
                                                </div>
                                            )}
                                        </div>
                                    </td>

                                    {/* Indexing Status */}
                                    <td className="border-r-2 border-black px-6 py-4">
                                        <div className="flex flex-col items-start gap-1.5">
                                            {getStatusBadge(result.status, result.coverageState)}
                                            <span className="px-1 text-[10px] font-bold uppercase text-slate-500">{result.coverageState}</span>
                                        </div>
                                    </td>

                                    {/* Content Health */}
                                    <td className="border-r-2 border-black px-6 py-4">
                                        <div className="flex flex-col gap-1">
                                            <div className="max-w-[180px] truncate text-xs font-bold text-black" title={result.title}>
                                                {result.title || <span className="italic text-slate-400">No Title</span>}
                                            </div>
                                            <div className="mt-1 flex flex-wrap items-center gap-1.5">
                                                {!result.description && !result.contentBlocked && (
                                                    <span className="inline-flex items-center gap-1 border border-black bg-amber-300 px-1.5 py-0.5 text-[9px] font-black uppercase text-black">
                                                        <AlertTriangle className="h-2.5 w-2.5" /> NO DESC
                                                    </span>
                                                )}
                                                {result.h1Count !== 1 && !result.contentBlocked && (
                                                    <span className="inline-flex items-center gap-1 border border-black bg-red-600 px-1.5 py-0.5 text-[9px] font-black uppercase text-white">
                                                        <AlertTriangle className="h-2.5 w-2.5" />
                                                        {result.h1Count === 0 ? 'NO H1' : 'MULTI H1'}
                                                    </span>
                                                )}
                                                {result.title && result.description && result.h1Count === 1 && (
                                                    <span className="inline-flex items-center gap-1 border border-black bg-green-300 px-1.5 py-0.5 text-[9px] font-black uppercase text-black">
                                                        <CheckCircle className="h-2.5 w-2.5" /> OPTIMIZED
                                                    </span>
                                                )}
                                                {result.wordCount !== undefined && (
                                                    <span className="ml-auto border-l-2 border-black pl-2 font-mono text-[9px] font-bold text-black">
                                                        {result.wordCount}w
                                                    </span>
                                                )}
                                            </div>
                                            <div className="mt-1 flex flex-wrap gap-1">
                                                {getCanonicalBadges(result).slice(0, 2).map((b) => (
                                                    <span key={b.label} className={`inline-flex items-center gap-1 border border-black px-1.5 py-0.5 text-[9px] font-black uppercase ${getBadgeCls(b.tone)}`}>{b.label}</span>
                                                ))}
                                                {getStructuredDataBadges(result).slice(0, 1).map((b) => (
                                                    <span key={b.label} className={`inline-flex items-center gap-1 border border-black px-1.5 py-0.5 text-[9px] font-black uppercase ${getBadgeCls(b.tone)}`}>{b.label}</span>
                                                ))}
                                                {getInternalLinkBadges(result).slice(0, 1).map((b) => (
                                                    <span key={b.label} className={`inline-flex items-center gap-1 border border-black px-1.5 py-0.5 text-[9px] font-black uppercase ${getBadgeCls(b.tone)}`}>{b.label}</span>
                                                ))}
                                            </div>
                                        </div>
                                    </td>

                                    {/* SEO Score */}
                                    <td className="border-r-2 border-black px-4 py-4 text-center">
                                        <div
                                            className="relative inline-block"
                                            onMouseEnter={() => setHoveredIndex(index)}
                                            onMouseLeave={() => setHoveredIndex(null)}
                                        >
                                            <div className={`inline-flex h-11 w-11 cursor-default flex-col items-center justify-center border-2 border-black font-black shadow-[2px_2px_0px_0px_#000] ${badgeCls}`}>
                                                <span className="text-base leading-none">{score.total}</span>
                                                <span className="text-[8px] font-black uppercase leading-none opacity-70">{score.label}</span>
                                            </div>
                                            {hoveredIndex === index && (
                                                <ScoreBreakdownPanel breakdown={score} />
                                            )}
                                        </div>
                                    </td>

                                    {/* Links */}
                                    <td className="border-r-2 border-black px-4 py-4 text-center">
                                        <div className="flex items-center justify-center gap-2 font-mono text-[10px] font-bold">
                                            <div className="flex flex-col items-center">
                                                <span className="text-[8px] uppercase text-slate-400">In</span>
                                                <span className={`border border-black px-1.5 py-0.5 ${!result.incomingLinks ? 'bg-red-100 text-red-600' : (result.incomingLinks || 0) <= 2 ? 'bg-amber-100 text-amber-700' : 'bg-slate-100'}`}>
                                                    {result.incomingLinks || 0}
                                                </span>
                                            </div>
                                            <div className="h-6 w-px bg-slate-300" />
                                            <div className="flex flex-col items-center">
                                                <span className="text-[8px] uppercase text-slate-400">Out</span>
                                                <span>{result.internalLinksOut || 0}</span>
                                            </div>
                                        </div>
                                    </td>

                                    {/* PSI */}
                                    <td className="border-r-2 border-black px-4 py-4 text-center">
                                        {result.psi_data ? (
                                            <div className={`inline-flex h-8 w-8 items-center justify-center border-2 border-black font-mono text-sm font-black shadow-[2px_2px_0px_0px_#000] ${(result.psi_data.desktop?.score || 0) >= 90 ? 'bg-green-300 text-black' : (result.psi_data.desktop?.score || 0) >= 50 ? 'bg-amber-300 text-black' : 'bg-red-500 text-white'}`}>
                                                {result.psi_data.desktop?.score ?? '-'}
                                            </div>
                                        ) : (
                                            <span className="text-xs font-bold text-slate-400">—</span>
                                        )}
                                    </td>

                                    {/* Views */}
                                    <td className="px-4 py-4 text-right">
                                        {result.ga4_views != null ? (
                                            <span className={`border border-black px-2 py-1 text-xs font-black shadow-[2px_2px_0px_0px_rgba(0,0,0,0.1)] ${result.ga4_views >= 1000 ? 'bg-sky-200 text-black' : result.ga4_views > 0 ? 'bg-amber-100 text-black' : 'bg-slate-100 text-slate-700'}`}>
                                                {result.ga4_views.toLocaleString()}
                                            </span>
                                        ) : (
                                            <span className="text-xs font-bold text-slate-400">—</span>
                                        )}
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
