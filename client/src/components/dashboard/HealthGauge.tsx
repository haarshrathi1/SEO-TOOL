import { ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import type { AuditResult } from '../../types';

interface HealthGaugeProps {
    results: AuditResult[];
}

export default function HealthGauge({ results }: HealthGaugeProps) {
    // 1. Calculate Health Score (Penalty System)
    const calculateScore = (res: AuditResult[]) => {
        if (!res.length) return 0;

        let score = 100;
        const total = res.length;

        // A. Critical Errors (Max 40 pts deduction)
        const criticalCount = res.filter(r => r.status === 'FAIL' || r.h1Count === 0).length;
        const criticalPenalty = (criticalCount / total) * 40;
        score -= criticalPenalty;

        // B. Warnings (Max 30 pts deduction)
        const warningCount = res.filter(r =>
            r.status === 'PARTIAL' || !r.description || (r.wordCount || 0) < 300
        ).length;
        const warningPenalty = (warningCount / total) * 30;
        score -= warningPenalty;

        // C. Performance (Max 30 pts deduction)
        const psiSum = res.reduce((acc, r) => acc + (r.psi_data?.desktop?.score || 0.5), 0);
        const avgPsi = psiSum / total;
        const perfPenalty = (1 - avgPsi) * 30;
        score -= perfPenalty;

        return Math.round(Math.max(0, score));
    };

    const healthScore = calculateScore(results);

    // Gauge Data
    const gaugeData = [
        { name: 'Score', value: healthScore },
        { name: 'Remaining', value: 100 - healthScore }
    ];

    // Issue Counts
    const criticalErrors = results.filter(r => r.status === 'FAIL' || r.h1Count === 0).length;
    const warnings = results.filter(r => r.status === 'PARTIAL' || !r.description).length;
    const healthy = results.filter(r => r.status === 'PASS' && r.description && r.h1Count === 1).length;

    return (
        <div className="bg-white p-6 border-2 border-black shadow-[8px_8px_0px_0px_#000] flex flex-col justify-between relative overflow-hidden group hover:-translate-y-1 transition-transform h-full">
            <div className="flex justify-between items-start z-10">
                <h3 className="text-black font-black uppercase tracking-wider text-xs bg-yellow-300 px-1 border border-black">Site Health</h3>
            </div>

            <div className="w-full flex-1 min-h-[160px] flex items-center justify-center relative my-4">
                <div className="w-full h-full absolute inset-0">
                    <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                            <Pie
                                data={gaugeData}
                                cx="50%"
                                cy="70%"
                                startAngle={180}
                                endAngle={0}
                                innerRadius={60}
                                outerRadius={80}
                                paddingAngle={5}
                                dataKey="value"
                                cornerRadius={0}
                                stroke="black"
                                strokeWidth={2}
                            >
                                {gaugeData.map((_, index) => (
                                    <Cell key={`cell-${index}`} fill={index === 0 ? '#000000' : '#e2e8f0'} />
                                ))}
                            </Pie>
                        </PieChart>
                    </ResponsiveContainer>
                </div>
                {/* Center Text */}
                <div className="absolute top-[65%] left-1/2 -translate-x-1/2 -translate-y-1/2 text-center mt-2">
                    <div className="text-5xl font-black text-black leading-none">{healthScore}</div>
                    <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Score</div>
                </div>
            </div>

            <div className="w-full grid grid-cols-3 gap-2 px-2 pt-4 border-t-2 border-black">
                <div className="text-center">
                    <div className="text-[10px] text-slate-500 font-bold uppercase">Errors</div>
                    <div className="text-xl font-black text-red-600 leading-none">{criticalErrors}</div>
                </div>
                <div className="text-center border-l-2 border-r-2 border-slate-100">
                    <div className="text-[10px] text-slate-500 font-bold uppercase">Warnings</div>
                    <div className="text-xl font-black text-amber-600 leading-none">{warnings}</div>
                </div>
                <div className="text-center">
                    <div className="text-[10px] text-slate-500 font-bold uppercase">Good</div>
                    <div className="text-xl font-black text-green-600 leading-none">{healthy}</div>
                </div>
            </div>
        </div>
    );
}
