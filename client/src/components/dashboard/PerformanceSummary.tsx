import { AreaChart, Area, ResponsiveContainer } from 'recharts';
import type { AuditResult } from '../../types';

interface PerformanceSummaryProps {
    results: AuditResult[];
    history?: { timestamp: string; results: AuditResult[] }[];
}

export default function PerformanceSummary({ results, history = [] }: PerformanceSummaryProps) {
    // Helper to calculate score (copied to reuse logic for trend)
    const calculateScore = (res: AuditResult[]) => {
        if (!res.length) return 0;
        let score = 100;
        const total = res.length;
        const criticalCount = res.filter(r => r.status === 'FAIL' || r.h1Count === 0).length;
        score -= (criticalCount / total) * 40;
        const warningCount = res.filter(r => r.status === 'PARTIAL' || !r.description || (r.wordCount || 0) < 300).length;
        score -= (warningCount / total) * 30;
        const psiSum = res.reduce((acc, r) => acc + (r.psi_data?.desktop?.score || 0.5), 0);
        const avgPsi = psiSum / total;
        score -= (1 - avgPsi) * 30;
        return Math.round(Math.max(0, score));
    };

    // Calculate Trend Data
    const trendData = history
        .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
        .map(h => ({
            v: calculateScore(h.results),
            date: new Date(h.timestamp).toLocaleDateString()
        }));

    if (trendData.length === 0) {
        const currentScore = calculateScore(results);
        trendData.push({ v: currentScore, date: 'Now' });
        trendData.unshift({ v: currentScore, date: 'Start' });
    }

    // Find representational page (LCP/CLS source)
    const repPage = results.find(r => r.url.endsWith(results[0]?.url.split('/')[2] + '/')) ||
        results.find(r => r.psi_data?.desktop?.lcp) ||
        results[0];

    const lcp = repPage?.psi_data?.desktop?.lcp;
    const cls = repPage?.psi_data?.desktop?.cls;
    // Average Desktop PSI
    const avgScore = Math.round(results.reduce((acc, r) => acc + (r.psi_data?.desktop?.score || 0), 0) / (results.filter(r => r.psi_data).length || 1));


    return (
        <div className="bg-black p-6 border-2 border-black shadow-[8px_8px_0px_0px_#000] text-white flex flex-col justify-between relative overflow-hidden h-full">
            <div className="relative z-10">
                <div className="flex items-center gap-2 mb-2">
                    <span className="text-[10px] font-black uppercase tracking-wider text-yellow-400 border border-yellow-400 px-1 py-0.5">Desktop Performance</span>
                </div>
                <h3 className="text-4xl font-black uppercase tracking-tighter">Stable</h3>
                <p className="text-slate-400 font-bold text-xs mt-1">Avg Score: <span className="text-white">{avgScore} / 100</span></p>
            </div>

            {/* Decorative Chart BG */}
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
