import { Pie, PieChart, ResponsiveContainer, Cell } from 'recharts';
import type { AuditResult } from '../../types';

interface HealthGaugeProps {
    results: AuditResult[];
}

function getNormalizedDesktopPsi(result: AuditResult): number {
    const score = result.psi_data?.desktop?.score;
    if (typeof score === 'number') {
        return Math.max(0, Math.min(1, score / 100));
    }
    return 0.5;
}

export default function HealthGauge({ results }: HealthGaugeProps) {
    const calculateScore = (auditResults: AuditResult[]) => {
        if (!auditResults.length) return 0;

        let score = 100;
        const total = auditResults.length;

        const criticalCount = auditResults.filter((result) => result.status !== 'PASS' || result.h1Count === 0).length;
        score -= (criticalCount / total) * 40;

        const warningCount = auditResults.filter((result) =>
            result.status === 'PARTIAL' || !result.description || (result.wordCount || 0) < 300,
        ).length;
        score -= (warningCount / total) * 30;

        const avgPsi = auditResults.reduce((acc, result) => acc + getNormalizedDesktopPsi(result), 0) / total;
        score -= (1 - avgPsi) * 30;

        return Math.round(Math.max(0, Math.min(100, score)));
    };

    const healthScore = calculateScore(results);
    const gaugeData = [
        { name: 'Score', value: healthScore },
        { name: 'Remaining', value: 100 - healthScore },
    ];

    const criticalErrors = results.filter((result) => result.status !== 'PASS' || result.h1Count === 0).length;
    const warnings = results.filter((result) => result.status === 'PARTIAL' || !result.description).length;
    const healthy = results.filter((result) => result.status === 'PASS' && result.description && result.h1Count === 1).length;

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
