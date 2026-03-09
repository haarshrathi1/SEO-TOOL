import { Play, AlertTriangle, CheckCircle } from 'lucide-react';
import type { AuditResult } from '../../types';

interface TableProps {
    results: AuditResult[];
    onRequestIndexing: (url: string) => void;
}

export default function AuditTable({ results, onRequestIndexing }: TableProps) {

    const getStatusBadge = (status: string, coverage: string) => {
        const s = status?.toUpperCase() || 'UNKNOWN';
        if (s === 'PASS') {
            if (coverage === 'Indexed & Serving') {
                return <span className="inline-flex items-center gap-1.5 px-2 py-0.5 text-xs font-black text-black bg-green-300 border-2 border-black shadow-[2px_2px_0px_0px_#000]"><CheckCircle className="w-3 h-3" /> LIVE</span>;
            }
            if (coverage === 'Indexed (Dormant)') {
                return <span className="inline-flex items-center gap-1.5 px-2 py-0.5 text-xs font-black text-black bg-blue-300 border-2 border-black shadow-[2px_2px_0px_0px_#000]"><CheckCircle className="w-3 h-3" /> INDEXED</span>;
            }
            return <span className="inline-flex items-center gap-1.5 px-2 py-0.5 text-xs font-black text-black bg-green-300 border-2 border-black shadow-[2px_2px_0px_0px_#000]"><CheckCircle className="w-3 h-3" /> INDEXED</span>;
        }
        if (s === 'FAIL') return <span className="inline-flex items-center gap-1.5 px-2 py-0.5 text-xs font-black text-white bg-red-600 border-2 border-black shadow-[2px_2px_0px_0px_#000]"><XCircleIcon /> FAILED</span>;
        if (s === 'PARTIAL') return <span className="inline-flex items-center gap-1.5 px-2 py-0.5 text-xs font-black text-black bg-amber-300 border-2 border-black shadow-[2px_2px_0px_0px_#000]"><AlertTriangle className="w-3 h-3" /> WARNING</span>;
        if (s === 'NEUTRAL') return <span className="inline-flex items-center gap-1.5 px-2 py-0.5 text-xs font-black text-black bg-gray-300 border-2 border-black shadow-[2px_2px_0px_0px_#000]"><InfoIcon /> EXCLUDED</span>;
        return <span className="inline-flex items-center gap-1.5 px-2 py-0.5 text-xs font-black text-black bg-slate-200 border-2 border-black shadow-[2px_2px_0px_0px_#000]">{s}</span>;
    };

    // Helper Icons (duplicated to avoid import hell if lucide missing some)
    const XCircleIcon = () => <div className="w-3 h-3 rounded-full bg-red-500 text-white flex items-center justify-center font-bold text-[8px]">×</div>;
    const InfoIcon = () => <div className="w-3 h-3 rounded-full bg-gray-400 text-white flex items-center justify-center font-bold text-[8px]">i</div>;

    return (
        <div className="bg-white border-2 border-black overflow-hidden shadow-[8px_8px_0px_0px_#000]">
            <div className="overflow-x-auto">
                <table className="w-full text-sm text-left">
                    <thead className="bg-slate-100 text-black font-black uppercase tracking-wider text-[11px] border-b-2 border-black">
                        <tr>
                            <th className="px-6 py-4 w-[35%] border-r-2 border-black">Page Detail</th>
                            <th className="px-6 py-4 w-[20%] border-r-2 border-black">Indexing Status</th>
                            <th className="px-6 py-4 w-[25%] border-r-2 border-black">Content Health</th>
                            <th className="px-6 py-4 w-[15%] text-center border-r-2 border-black">Links (In/Out)</th>
                            <th className="px-6 py-4 w-[10%] text-center border-r-2 border-black">PSI</th>
                            <th className="px-6 py-4 w-[10%] text-right">Views</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y-2 divide-black">
                        {results.map((r, i) => (
                            <tr key={i} className="hover:bg-yellow-50 transition-colors group">
                                {/* Page & URL */}
                                <td className="px-6 py-4 border-r-2 border-black">
                                    <div className="flex items-center justify-between gap-4">
                                        <div className="min-w-0">
                                            <a
                                                href={r.url}
                                                target="_blank"
                                                rel="noreferrer"
                                                className="font-bold text-sm text-black hover:text-blue-600 hover:underline decoration-2 underline-offset-2 transition-all block truncate uppercase"
                                                title={r.url}
                                            >
                                                {r.url.replace('https://laserliftsolutions.com', '') || '/'}
                                            </a>
                                            <div className="text-[10px] font-mono text-slate-500 font-bold mt-0.5 truncate max-w-[300px]">{r.url}</div>
                                        </div>
                                        {/* Action Button */}
                                        <div className="opacity-0 group-hover:opacity-100 transition-opacity">
                                            {r.status !== 'PASS' && (
                                                <button
                                                    onClick={() => onRequestIndexing(r.url)}
                                                    className="p-1.5 text-black hover:bg-black hover:text-white rounded-none transition-colors border-2 border-black shadow-[2px_2px_0px_0px_#000] active:translate-x-[1px] active:translate-y-[1px] active:shadow-none"
                                                    title="Request Indexing"
                                                >
                                                    <Play className="w-3.5 h-3.5 fill-current" />
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                </td>

                                {/* Indexing Status */}
                                <td className="px-6 py-4 border-r-2 border-black">
                                    <div className="flex flex-col items-start gap-1.5">
                                        {getStatusBadge(r.status, r.coverageState)}
                                        <span className="text-[10px] text-slate-500 font-bold px-1 uppercase">
                                            {r.coverageState}
                                        </span>
                                    </div>
                                </td>

                                {/* Content Health */}
                                <td className="px-6 py-4 border-r-2 border-black">
                                    <div className="flex flex-col gap-1">
                                        <div className="text-xs font-bold text-black truncate max-w-[200px]" title={r.title}>
                                            {r.title || <span className="text-slate-400 italic">No Title Detected</span>}
                                        </div>

                                        {/* Meta Badges Row */}
                                        <div className="flex items-center gap-2 mt-1">
                                            {(!r.title || !r.description || (r.h1Count !== 1)) ? (
                                                <>
                                                    {!r.description && (
                                                        <span className="inline-flex items-center gap-1 text-[9px] font-black text-black bg-amber-300 px-1.5 py-0.5 border border-black uppercase">
                                                            <AlertTriangle className="w-2.5 h-2.5" /> NO DESC
                                                        </span>
                                                    )}
                                                    {(r.h1Count !== 1) && (
                                                        <span className="inline-flex items-center gap-1 text-[9px] font-black text-white bg-red-600 px-1.5 py-0.5 border border-black uppercase">
                                                            <AlertTriangle className="w-2.5 h-2.5" /> {r.h1Count === 0 ? 'NO H1' : 'MULTI H1'}
                                                        </span>
                                                    )}
                                                </>
                                            ) : (
                                                <span className="inline-flex items-center gap-1 text-[9px] font-black text-black bg-green-300 px-1.5 py-0.5 border border-black uppercase">
                                                    <CheckCircle className="w-2.5 h-2.5" /> OPTIMIZED
                                                </span>
                                            )}
                                            {r.wordCount !== undefined && (
                                                <span className="text-[9px] text-black font-bold ml-auto border-l-2 border-black pl-2 font-mono">
                                                    {r.wordCount}w
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                </td>

                                {/* Link Stats */}
                                <td className="px-6 py-4 text-center border-r-2 border-black">
                                    <div className="flex items-center justify-center gap-2 text-[10px] font-mono font-bold">
                                        <div className="flex flex-col items-center">
                                            <span className="text-slate-400 uppercase text-[8px]">In</span>
                                            <span className={`px-1.5 py-0.5 border border-black ${!r.incomingLinks ? 'bg-red-100 text-red-600' : 'bg-slate-100'}`}>
                                                {r.incomingLinks || 0}
                                            </span>
                                        </div>
                                        <div className="w-[1px] h-6 bg-slate-300"></div>
                                        <div className="flex flex-col items-center">
                                            <span className="text-slate-400 uppercase text-[8px]">Out</span>
                                            <span>{r.internalLinksOut || 0}</span>
                                        </div>
                                        <div className="flex flex-col items-center">
                                            <span className="text-slate-400 uppercase text-[8px]">Ext</span>
                                            <span>{r.externalLinksOut || 0}</span>
                                        </div>
                                    </div>
                                </td>

                                {/* Performance */}
                                <td className="px-6 py-4 text-center border-r-2 border-black">
                                    {r.psi_data ? (
                                        <div className={`inline-flex items-center justify-center w-8 h-8 font-mono text-sm font-black border-2 border-black shadow-[2px_2px_0px_0px_#000] ${(r.psi_data.desktop?.score || 0) >= 90 ? 'bg-green-300 text-black' :
                                            (r.psi_data.desktop?.score || 0) >= 50 ? 'bg-amber-300 text-black' :
                                                'bg-red-500 text-white'
                                            }`}>
                                            {r.psi_data.desktop?.score ?? '-'}
                                        </div>
                                    ) : (
                                        <span className="text-slate-400 text-xs font-bold">-</span>
                                    )}
                                </td>

                                {/* Views */}
                                <td className="px-6 py-4 text-right">
                                    {r.ga4_views ? (
                                        <span className="font-black text-black bg-slate-100 px-2 py-1 border border-black text-xs shadow-[2px_2px_0px_0px_rgba(0,0,0,0.1)]">
                                            {r.ga4_views.toLocaleString()}
                                        </span>
                                    ) : (
                                        <span className="text-slate-400 text-xs font-bold">-</span>
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
