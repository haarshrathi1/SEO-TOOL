import { Play, AlertTriangle, CheckCircle } from 'lucide-react';
import type { AuditResult } from '../../types';

interface TableProps {
    results: AuditResult[];
    onRequestIndexing: (url: string) => void;
}

function getDisplayPath(result: AuditResult) {
    try {
        const finalUrl = result.finalUrl || result.url;
        const parsed = new URL(finalUrl);
        return parsed.pathname + parsed.search;
    } catch {
        return result.url;
    }
}

function getStatusBadge(status: string, coverage: string, isNoindex?: boolean) {
    const normalized = status?.toUpperCase() || 'UNKNOWN';
    if (isNoindex) {
        return <span className="inline-flex items-center gap-1.5 px-2 py-0.5 text-xs font-black text-white bg-fuchsia-600 border-2 border-black shadow-[2px_2px_0px_0px_#000]">NOINDEX</span>;
    }
    if (normalized === 'PASS') {
        if (coverage === 'Indexed & Serving') {
            return <span className="inline-flex items-center gap-1.5 px-2 py-0.5 text-xs font-black text-black bg-green-300 border-2 border-black shadow-[2px_2px_0px_0px_#000]"><CheckCircle className="w-3 h-3" /> LIVE</span>;
        }
        if (coverage === 'Indexed (Dormant)') {
            return <span className="inline-flex items-center gap-1.5 px-2 py-0.5 text-xs font-black text-black bg-blue-300 border-2 border-black shadow-[2px_2px_0px_0px_#000]"><CheckCircle className="w-3 h-3" /> INDEXED</span>;
        }
        return <span className="inline-flex items-center gap-1.5 px-2 py-0.5 text-xs font-black text-black bg-green-300 border-2 border-black shadow-[2px_2px_0px_0px_#000]"><CheckCircle className="w-3 h-3" /> INDEXED</span>;
    }
    if (normalized === 'FAIL' || normalized === 'ERROR') {
        return <span className="inline-flex items-center gap-1.5 px-2 py-0.5 text-xs font-black text-white bg-red-600 border-2 border-black shadow-[2px_2px_0px_0px_#000]"><XCircleIcon /> FAILED</span>;
    }
    if (normalized === 'PARTIAL') {
        return <span className="inline-flex items-center gap-1.5 px-2 py-0.5 text-xs font-black text-black bg-amber-300 border-2 border-black shadow-[2px_2px_0px_0px_#000]"><AlertTriangle className="w-3 h-3" /> WARNING</span>;
    }
    if (normalized === 'NEUTRAL') {
        return <span className="inline-flex items-center gap-1.5 px-2 py-0.5 text-xs font-black text-black bg-gray-300 border-2 border-black shadow-[2px_2px_0px_0px_#000]"><InfoIcon /> EXCLUDED</span>;
    }
    return <span className="inline-flex items-center gap-1.5 px-2 py-0.5 text-xs font-black text-black bg-slate-200 border-2 border-black shadow-[2px_2px_0px_0px_#000]">{normalized}</span>;
}

const XCircleIcon = () => <div className="w-3 h-3 rounded-full bg-red-500 text-white flex items-center justify-center font-bold text-[8px]">x</div>;
const InfoIcon = () => <div className="w-3 h-3 rounded-full bg-gray-400 text-white flex items-center justify-center font-bold text-[8px]">i</div>;

export default function AuditTable({ results, onRequestIndexing }: TableProps) {
    return (
        <div className="bg-white border-2 border-black overflow-hidden shadow-[8px_8px_0px_0px_#000]">
            <div className="overflow-x-auto">
                <table className="w-full text-sm text-left">
                    <thead className="bg-slate-100 text-black font-black uppercase tracking-wider text-[11px] border-b-2 border-black">
                        <tr>
                            <th className="px-6 py-4 w-[32%] border-r-2 border-black">Page Detail</th>
                            <th className="px-6 py-4 w-[18%] border-r-2 border-black">Indexing Status</th>
                            <th className="px-6 py-4 w-[28%] border-r-2 border-black">Content Health</th>
                            <th className="px-6 py-4 w-[12%] text-center border-r-2 border-black">Links</th>
                            <th className="px-6 py-4 w-[10%] text-center border-r-2 border-black">PSI</th>
                            <th className="px-6 py-4 w-[12%] text-right">Tech</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y-2 divide-black">
                        {results.map((result, index) => (
                            <tr key={index} className="hover:bg-yellow-50 transition-colors group align-top">
                                <td className="px-6 py-4 border-r-2 border-black">
                                    <div className="flex items-start justify-between gap-4">
                                        <div className="min-w-0">
                                            <a
                                                href={result.finalUrl || result.url}
                                                target="_blank"
                                                rel="noreferrer"
                                                className="font-bold text-sm text-black hover:text-blue-600 hover:underline decoration-2 underline-offset-2 transition-all block truncate uppercase"
                                                title={result.finalUrl || result.url}
                                            >
                                                {getDisplayPath(result) || '/'}
                                            </a>
                                            <div className="text-[10px] font-mono text-slate-500 font-bold mt-0.5 truncate max-w-[320px]">{result.finalUrl || result.url}</div>
                                            {(result.httpStatus || 0) > 0 && (
                                                <div className="mt-2 flex items-center gap-2 text-[10px] font-black uppercase">
                                                    <span className={`px-1.5 py-0.5 border border-black ${(result.httpStatus || 0) >= 400 ? 'bg-red-100 text-red-700' : 'bg-slate-100 text-black'}`}>
                                                        HTTP {result.httpStatus}
                                                    </span>
                                                    {result.redirected && <span className="px-1.5 py-0.5 border border-black bg-amber-100 text-amber-700">Redirected</span>}
                                                </div>
                                            )}
                                        </div>
                                        <div className="opacity-0 group-hover:opacity-100 transition-opacity">
                                            {result.status !== 'PASS' && (
                                                <button
                                                    onClick={() => onRequestIndexing(result.finalUrl || result.url)}
                                                    className="p-1.5 text-black hover:bg-black hover:text-white rounded-none transition-colors border-2 border-black shadow-[2px_2px_0px_0px_#000] active:translate-x-[1px] active:translate-y-[1px] active:shadow-none"
                                                    title="Request Indexing"
                                                >
                                                    <Play className="w-3.5 h-3.5 fill-current" />
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                </td>

                                <td className="px-6 py-4 border-r-2 border-black">
                                    <div className="flex flex-col items-start gap-1.5">
                                        {getStatusBadge(result.status, result.coverageState, result.isNoindex)}
                                        <span className="text-[10px] text-slate-500 font-bold px-1 uppercase">{result.coverageState}</span>
                                        {result.robotStatus && result.robotStatus !== '-' && (
                                            <span className="text-[10px] text-slate-500 font-bold px-1 uppercase">Robots: {result.robotStatus}</span>
                                        )}
                                    </div>
                                </td>

                                <td className="px-6 py-4 border-r-2 border-black">
                                    <div className="flex flex-col gap-2">
                                        <div className="text-xs font-bold text-black truncate max-w-[240px]" title={result.title}>
                                            {result.title || <span className="text-slate-400 italic">No Title Detected</span>}
                                        </div>

                                        <div className="flex flex-wrap items-center gap-2 mt-1">
                                            {!result.description && (
                                                <span className="inline-flex items-center gap-1 text-[9px] font-black text-black bg-amber-300 px-1.5 py-0.5 border border-black uppercase">
                                                    <AlertTriangle className="w-2.5 h-2.5" /> NO DESC
                                                </span>
                                            )}
                                            {result.h1Count !== 1 && (
                                                <span className="inline-flex items-center gap-1 text-[9px] font-black text-white bg-red-600 px-1.5 py-0.5 border border-black uppercase">
                                                    <AlertTriangle className="w-2.5 h-2.5" /> {result.h1Count === 0 ? 'NO H1' : 'MULTI H1'}
                                                </span>
                                            )}
                                            {!result.canonicalUrl && (
                                                <span className="text-[9px] font-black text-black bg-sky-200 px-1.5 py-0.5 border border-black uppercase">NO CANONICAL</span>
                                            )}
                                            {result.canonicalIssue && (
                                                <span className="text-[9px] font-black text-black bg-orange-200 px-1.5 py-0.5 border border-black uppercase">CANONICAL MISMATCH</span>
                                            )}
                                            {result.duplicateTitle && (
                                                <span className="text-[9px] font-black text-black bg-violet-200 px-1.5 py-0.5 border border-black uppercase">DUP TITLE</span>
                                            )}
                                            {(result.missingAltCount || 0) > 0 && (
                                                <span className="text-[9px] font-black text-black bg-yellow-200 px-1.5 py-0.5 border border-black uppercase">ALT {result.missingAltCount}</span>
                                            )}
                                            {!result.schemaCount && (
                                                <span className="text-[9px] font-black text-black bg-slate-200 px-1.5 py-0.5 border border-black uppercase">NO SCHEMA</span>
                                            )}
                                            {result.wordCount !== undefined && (
                                                <span className="text-[9px] text-black font-bold ml-auto border-l-2 border-black pl-2 font-mono">{result.wordCount}w</span>
                                            )}
                                        </div>
                                    </div>
                                </td>

                                <td className="px-6 py-4 text-center border-r-2 border-black">
                                    <div className="flex items-center justify-center gap-2 text-[10px] font-mono font-bold">
                                        <div className="flex flex-col items-center">
                                            <span className="text-slate-400 uppercase text-[8px]">In</span>
                                            <span className={`px-1.5 py-0.5 border border-black ${result.isOrphan ? 'bg-red-100 text-red-600' : 'bg-slate-100'}`}>
                                                {result.incomingLinks || 0}
                                            </span>
                                        </div>
                                        <div className="w-[1px] h-6 bg-slate-300"></div>
                                        <div className="flex flex-col items-center">
                                            <span className="text-slate-400 uppercase text-[8px]">Out</span>
                                            <span>{result.internalLinksOut || 0}</span>
                                        </div>
                                        <div className="flex flex-col items-center">
                                            <span className="text-slate-400 uppercase text-[8px]">Depth</span>
                                            <span>{result.crawlDepth ?? '-'}</span>
                                        </div>
                                    </div>
                                </td>

                                <td className="px-6 py-4 text-center border-r-2 border-black">
                                    {result.psi_data ? (
                                        <div className={`inline-flex items-center justify-center w-8 h-8 font-mono text-sm font-black border-2 border-black shadow-[2px_2px_0px_0px_#000] ${(result.psi_data.desktop?.score || 0) >= 90 ? 'bg-green-300 text-black' : (result.psi_data.desktop?.score || 0) >= 50 ? 'bg-amber-300 text-black' : 'bg-red-500 text-white'}`}>
                                            {result.psi_data.desktop?.score ?? '-'}
                                        </div>
                                    ) : (
                                        <span className="text-slate-400 text-xs font-bold">-</span>
                                    )}
                                </td>

                                <td className="px-6 py-4 text-right">
                                    <div className="flex flex-col items-end gap-1 text-[10px] font-bold uppercase">
                                        <span className="px-2 py-1 border border-black bg-slate-100">Lang {result.lang || 'Missing'}</span>
                                        <span className="px-2 py-1 border border-black bg-slate-100">Schema {result.schemaCount || 0}</span>
                                        <span className="px-2 py-1 border border-black bg-slate-100">OG {result.hasOgTags ? 'Yes' : 'No'}</span>
                                    </div>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
