import { Area, AreaChart, ResponsiveContainer } from 'recharts';
import type { AuditResult } from '../../types';

interface PerformanceSummaryProps {
    results: AuditResult[];
    history?: { timestamp: string; results: AuditResult[] }[];
}

function getNormalizedDesktopPsi(result: AuditResult): number {
    const score = result.psi_data?.desktop?.score;
    if (typeof score === 'number') {
        return Math.max(0, Math.min(1, score / 100));
    }
    return 0.5;
}

function calculateScore(auditResults: AuditResult[]) {
    if (!auditResults.length) return 0;

    let score = 100;
    const total = auditResults.length;
    const criticalCount = auditResults.filter((result) => result.status !== 'PASS' || result.h1Count === 0).length;
    score -= (criticalCount / total) * 40;

    const warningCount = auditResults.filter((result) => result.status === 'PARTIAL' || !result.description || (result.wordCount || 0) < 300).length;
    score -= (warningCount / total) * 30;

    const avgPsi = auditResults.reduce((acc, result) => acc + getNormalizedDesktopPsi(result), 0) / total;
    score -= (1 - avgPsi) * 30;

    return Math.round(Math.max(0, Math.min(100, score)));
}

export default function PerformanceSummary({ results, history = [] }: PerformanceSummaryProps) {
    const trendData = [...history]
        .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
        .map((entry) => ({
            v: calculateScore(entry.results),
            date: new Date(entry.timestamp).toLocaleDateString(),
        }));

    if (trendData.length === 0) {
        const currentScore = calculateScore(results);
        trendData.push({ v: currentScore, date: 'Now' });
        trendData.unshift({ v: currentScore, date: 'Start' });
    }

    const representativePage = results.find((result) => result.psi_data?.desktop?.lcp || result.psi_data?.desktop?.cls) || results[0];
    const lcp = representativePage?.psi_data?.desktop?.lcp;
    const cls = representativePage?.psi_data?.desktop?.cls;
    const pagesWithPsi = results.filter((result) => typeof result.psi_data?.desktop?.score === 'number');
    const avgScore = Math.round(pagesWithPsi.reduce((acc, result) => acc + (result.psi_data?.desktop?.score || 0), 0) / (pagesWithPsi.length || 1));

    return (
        <div className="bg-black p-6 border-2 border-black shadow-[8px_8px_0px_0px_#000] text-white flex flex-col justify-between relative overflow-hidden h-full">
            <div className="relative z-10">
                <div className="flex items-center gap-2 mb-2">
                    <span className="text-[10px] font-black uppercase tracking-wider text-yellow-400 border border-yellow-400 px-1 py-0.5">Desktop Performance</span>
                </div>
                <h3 className="text-4xl font-black uppercase tracking-tighter">Stable</h3>
                <p className="text-slate-400 font-bold text-xs mt-1">Avg Score: <span className="text-white">{avgScore} / 100</span></p>
            </div>

            <div className="absolute inset-0 opacity-20 pointer-events-none">
                <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={trendData}>
                        <Area type="monotone" dataKey="v" stroke="#fff" fill="#888" strokeWidth={3} />
                    </AreaChart>
                </ResponsiveContainer>
            </div>

            <div className="relative z-10 mt-auto grid grid-cols-2 gap-3 pt-6">
                <div className="p-2 bg-zinc-900 border border-zinc-700">
                    <div className="text-[10px] text-zinc-400 uppercase font-bold">LCP</div>
                    <div className="text-lg font-black text-white">
                        {lcp || 'N/A'}
                    </div>
                </div>
                <div className="p-2 bg-zinc-900 border border-zinc-700">
                    <div className="text-[10px] text-zinc-400 uppercase font-bold">CLS</div>
                    <div className="text-lg font-black text-white">{cls || 'N/A'}</div>
                </div>
            </div>
        </div>
    );
}
