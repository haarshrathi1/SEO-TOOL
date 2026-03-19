import { AlertTriangle, CheckCircle, Info, Play, XCircle } from 'lucide-react';
import { getCanonicalBadges } from '../../canonicalAudit';
import { getInternalLinkBadges } from '../../internalLinkRecommendations';
import { getStructuredDataBadges } from '../../structuredDataAudit';
import type { AuditResult } from '../../types';
import { getUrlPathLabel } from '../../url';

interface TableProps {
    results: AuditResult[];
    onRequestIndexing?: ((url: string) => void) | null;
}

export default function AuditTable({ results, onRequestIndexing = null }: TableProps) {
    const getStatusBadge = (status: string, coverage: string) => {
        const normalizedStatus = status?.toUpperCase() || 'UNKNOWN';
        if (normalizedStatus === 'PASS') {
            if (coverage === 'Indexed & Serving') {
                return <span className="inline-flex items-center gap-1.5 border-2 border-black bg-green-300 px-2 py-0.5 text-xs font-black text-black shadow-[2px_2px_0px_0px_#000]"><CheckCircle className="h-3 w-3" /> LIVE</span>;
            }
            if (coverage === 'Indexed (Dormant)') {
                return <span className="inline-flex items-center gap-1.5 border-2 border-black bg-blue-300 px-2 py-0.5 text-xs font-black text-black shadow-[2px_2px_0px_0px_#000]"><CheckCircle className="h-3 w-3" /> INDEXED</span>;
            }
            return <span className="inline-flex items-center gap-1.5 border-2 border-black bg-green-300 px-2 py-0.5 text-xs font-black text-black shadow-[2px_2px_0px_0px_#000]"><CheckCircle className="h-3 w-3" /> INDEXED</span>;
        }
        if (normalizedStatus === 'FAIL') {
            return <span className="inline-flex items-center gap-1.5 border-2 border-black bg-red-600 px-2 py-0.5 text-xs font-black text-white shadow-[2px_2px_0px_0px_#000]"><XCircle className="h-3 w-3" /> FAILED</span>;
        }
        if (normalizedStatus === 'PARTIAL') {
            return <span className="inline-flex items-center gap-1.5 border-2 border-black bg-amber-300 px-2 py-0.5 text-xs font-black text-black shadow-[2px_2px_0px_0px_#000]"><AlertTriangle className="h-3 w-3" /> WARNING</span>;
        }
        if (normalizedStatus === 'NEUTRAL') {
            return <span className="inline-flex items-center gap-1.5 border-2 border-black bg-gray-300 px-2 py-0.5 text-xs font-black text-black shadow-[2px_2px_0px_0px_#000]"><Info className="h-3 w-3" /> EXCLUDED</span>;
        }
        return <span className="inline-flex items-center gap-1.5 border-2 border-black bg-slate-200 px-2 py-0.5 text-xs font-black text-black shadow-[2px_2px_0px_0px_#000]">{normalizedStatus}</span>;
    };

    const getCanonicalBadgeClassName = (tone: 'critical' | 'warning' | 'info' | 'positive') => {
        if (tone === 'critical') return 'bg-red-600 text-white';
        if (tone === 'warning') return 'bg-amber-300 text-black';
        if (tone === 'info') return 'bg-sky-300 text-black';
        return 'bg-green-300 text-black';
    };

    return (
        <div className="overflow-hidden border-2 border-black bg-white shadow-[8px_8px_0px_0px_#000]">
            <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                    <thead className="border-b-2 border-black bg-slate-100 text-[11px] font-black uppercase tracking-wider text-black">
                        <tr>
                            <th className="w-[35%] border-r-2 border-black px-6 py-4">Page Detail</th>
                            <th className="w-[20%] border-r-2 border-black px-6 py-4">Indexing Status</th>
                            <th className="w-[25%] border-r-2 border-black px-6 py-4">Content Health</th>
                            <th className="w-[15%] border-r-2 border-black px-6 py-4 text-center">Links (In/Out)</th>
                            <th className="w-[10%] border-r-2 border-black px-6 py-4 text-center">PSI</th>
                            <th className="w-[10%] px-6 py-4 text-right">Views</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y-2 divide-black">
                        {results.map((result, index) => (
                            <tr key={`${result.url}-${index}`} className="group transition-colors hover:bg-yellow-50">
                                <td className="border-r-2 border-black px-6 py-4">
                                    <div className="flex items-center justify-between gap-4">
                                        <div className="min-w-0">
                                            <a
                                                href={result.url}
                                                target="_blank"
                                                rel="noreferrer"
                                                className="block truncate text-sm font-bold uppercase text-black transition-all hover:text-blue-600 hover:underline decoration-2 underline-offset-2"
                                                title={result.url}
                                            >
                                                {getUrlPathLabel(result.url)}
                                            </a>
                                            <div className="mt-0.5 max-w-[300px] truncate font-mono text-[10px] font-bold text-slate-500">{result.url}</div>
                                            {result.redirected && result.finalUrl && result.finalUrl !== result.url && (
                                                <div className="mt-1 max-w-[300px] truncate font-mono text-[10px] font-bold text-amber-700">
                                                    Redirects to {getUrlPathLabel(result.finalUrl)}
                                                </div>
                                            )}
                                            {result.canonicalUrl && (
                                                <div className="mt-1 max-w-[300px] truncate font-mono text-[10px] font-bold text-sky-700">
                                                    Canonical {getUrlPathLabel(result.canonicalUrl)}
                                                </div>
                                            )}
                                        </div>
                                        {onRequestIndexing && (
                                            <div className="opacity-0 transition-opacity group-hover:opacity-100">
                                                {result.status !== 'PASS' && (
                                                    <button
                                                        onClick={() => onRequestIndexing(result.url)}
                                                        className="rounded-none border-2 border-black p-1.5 text-black shadow-[2px_2px_0px_0px_#000] transition-colors active:translate-x-[1px] active:translate-y-[1px] active:shadow-none hover:bg-black hover:text-white"
                                                        title="Request Indexing"
                                                    >
                                                        <Play className="h-3.5 w-3.5 fill-current" />
                                                    </button>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                </td>

                                <td className="border-r-2 border-black px-6 py-4">
                                    <div className="flex flex-col items-start gap-1.5">
                                        {getStatusBadge(result.status, result.coverageState)}
                                        <span className="px-1 text-[10px] font-bold uppercase text-slate-500">
                                            {result.coverageState}
                                        </span>
                                    </div>
                                </td>

                                <td className="border-r-2 border-black px-6 py-4">
                                    <div className="flex flex-col gap-1">
                                        <div className="max-w-[200px] truncate text-xs font-bold text-black" title={result.title}>
                                            {result.title || <span className="italic text-slate-400">No Title Detected</span>}
                                        </div>

                                        <div className="mt-1 flex items-center gap-2">
                                            {(!result.title || !result.description || result.h1Count !== 1) ? (
                                                <>
                                                    {!result.description && (
                                                        <span className="inline-flex items-center gap-1 border border-black bg-amber-300 px-1.5 py-0.5 text-[9px] font-black uppercase text-black">
                                                            <AlertTriangle className="h-2.5 w-2.5" /> NO DESC
                                                        </span>
                                                    )}
                                                    {result.h1Count !== 1 && (
                                                        <span className="inline-flex items-center gap-1 border border-black bg-red-600 px-1.5 py-0.5 text-[9px] font-black uppercase text-white">
                                                            <AlertTriangle className="h-2.5 w-2.5" /> {result.h1Count === 0 ? 'NO H1' : 'MULTI H1'}
                                                        </span>
                                                    )}
                                                </>
                                            ) : (
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

                                        <div className="mt-2 flex flex-wrap gap-1.5">
                                            {getCanonicalBadges(result).slice(0, 2).map((badge) => (
                                                <span
                                                    key={badge.label}
                                                    className={`inline-flex items-center gap-1 border border-black px-1.5 py-0.5 text-[9px] font-black uppercase ${getCanonicalBadgeClassName(badge.tone)}`}
                                                >
                                                    {badge.label}
                                                </span>
                                            ))}
                                            {getStructuredDataBadges(result).slice(0, 1).map((badge) => (
                                                <span
                                                    key={badge.label}
                                                    className={`inline-flex items-center gap-1 border border-black px-1.5 py-0.5 text-[9px] font-black uppercase ${getCanonicalBadgeClassName(badge.tone)}`}
                                                >
                                                    {badge.label}
                                                </span>
                                            ))}
                                            {getInternalLinkBadges(result).slice(0, 1).map((badge) => (
                                                <span
                                                    key={badge.label}
                                                    className={`inline-flex items-center gap-1 border border-black px-1.5 py-0.5 text-[9px] font-black uppercase ${getCanonicalBadgeClassName(badge.tone)}`}
                                                >
                                                    {badge.label}
                                                </span>
                                            ))}
                                        </div>
                                    </div>
                                </td>

                                <td className="border-r-2 border-black px-6 py-4 text-center">
                                    <div className="flex items-center justify-center gap-2 font-mono text-[10px] font-bold">
                                        <div className="flex flex-col items-center">
                                            <span className="text-[8px] uppercase text-slate-400">In</span>
                                            <span className={`border border-black px-1.5 py-0.5 ${!result.incomingLinks ? 'bg-red-100 text-red-600' : (result.incomingLinks || 0) <= 2 ? 'bg-amber-100 text-amber-700' : 'bg-slate-100'}`}>
                                                {result.incomingLinks || 0}
                                            </span>
                                        </div>
                                        <div className="h-6 w-[1px] bg-slate-300"></div>
                                        <div className="flex flex-col items-center">
                                            <span className="text-[8px] uppercase text-slate-400">Out</span>
                                            <span>{result.internalLinksOut || 0}</span>
                                        </div>
                                        <div className="flex flex-col items-center">
                                            <span className="text-[8px] uppercase text-slate-400">Ext</span>
                                            <span>{result.externalLinksOut || 0}</span>
                                        </div>
                                    </div>
                                </td>

                                <td className="border-r-2 border-black px-6 py-4 text-center">
                                    {result.psi_data ? (
                                        <div className={`inline-flex h-8 w-8 items-center justify-center border-2 border-black font-mono text-sm font-black shadow-[2px_2px_0px_0px_#000] ${(result.psi_data.desktop?.score || 0) >= 90 ? 'bg-green-300 text-black'
                                            : (result.psi_data.desktop?.score || 0) >= 50 ? 'bg-amber-300 text-black'
                                                : 'bg-red-500 text-white'
                                            }`}>
                                            {result.psi_data.desktop?.score ?? '-'}
                                        </div>
                                    ) : (
                                        <span className="text-xs font-bold text-slate-400">-</span>
                                    )}
                                </td>

                                <td className="px-6 py-4 text-right">
                                    {result.ga4_views ? (
                                        <span className="border border-black bg-slate-100 px-2 py-1 text-xs font-black text-black shadow-[2px_2px_0px_0px_rgba(0,0,0,0.1)]">
                                            {result.ga4_views.toLocaleString()}
                                        </span>
                                    ) : (
                                        <span className="text-xs font-bold text-slate-400">-</span>
                                    )}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
