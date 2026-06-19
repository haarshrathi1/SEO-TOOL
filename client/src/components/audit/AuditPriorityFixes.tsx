import { AlertOctagon, ArrowRight, Gauge, Search, ShieldAlert, TrendingUp } from 'lucide-react';
import { computeSeoScore } from '../../seoScore';
import { getTechnicalIssues } from '../../technicalIssues';
import type { AuditResult, TechnicalAuditIssue } from '../../types';
import { getUrlPathLabel } from '../../url';

interface AuditPriorityFixesProps {
    results: AuditResult[];
    onReview: (filterId: string) => void;
}

const SEVERITY_WEIGHT: Record<TechnicalAuditIssue['severity'], number> = {
    critical: 45,
    high: 30,
    medium: 16,
    low: 7,
    info: 2,
};

function pageValueBoost(result: AuditResult) {
    const views = Number(result.ga4_views || 0);
    if (views >= 1000) return 24;
    if (views >= 250) return 16;
    if (views > 0) return 10;
    if (String(result.status || '').toUpperCase() === 'PASS') return 4;
    return 0;
}

function getMobilePsiScore(result: AuditResult) {
    const mobile = result.psi_data?.mobile?.score;
    if (typeof mobile === 'number') return mobile;
    const desktop = result.psi_data?.desktop?.score;
    return typeof desktop === 'number' ? desktop : null;
}

function buildPriorityRows(results: AuditResult[]) {
    return results
        .map((result) => {
            const issues = getTechnicalIssues(result, results);
            const seo = computeSeoScore(result);
            const severityScore = issues.reduce((sum, issue) => sum + SEVERITY_WEIGHT[issue.severity], 0);
            const indexationBoost = String(result.status || '').toUpperCase() === 'PASS' ? 0 : 22;
            const linkBoost = (result.incomingLinks || 0) === 0 ? 10 : 0;
            const speedScore = getMobilePsiScore(result);
            const speedBoost = speedScore !== null && speedScore < 50 ? 14 : speedScore !== null && speedScore < 75 ? 8 : 0;
            const seoBoost = seo.total < 40 ? 18 : seo.total < 60 ? 10 : 0;
            const priority = Math.min(100, Math.round(severityScore + indexationBoost + linkBoost + speedBoost + seoBoost + pageValueBoost(result)));
            return { result, issues, seo, priority, speedScore };
        })
        .filter((row) => row.issues.length > 0)
        .sort((left, right) => right.priority - left.priority || right.issues.length - left.issues.length)
        .slice(0, 12);
}

function priorityTone(priority: number) {
    if (priority >= 80) return 'bg-red-100';
    if (priority >= 55) return 'bg-amber-100';
    return 'bg-blue-100';
}

export default function AuditPriorityFixes({ results, onReview }: AuditPriorityFixesProps) {
    const rows = buildPriorityRows(results);
    const criticalPages = rows.filter((row) => row.priority >= 80).length;
    const trafficPages = rows.filter((row) => Number(row.result.ga4_views || 0) > 0).length;
    const avgPriority = rows.length
        ? Math.round(rows.reduce((sum, row) => sum + row.priority, 0) / rows.length)
        : 0;

    if (rows.length === 0) {
        return (
            <div className="border-2 border-black bg-green-50 p-8 text-center shadow-[6px_6px_0px_0px_#000]">
                <ShieldAlert className="mx-auto h-8 w-8 text-black" />
                <h3 className="mt-4 text-2xl font-black uppercase text-black">No priority fixes</h3>
                <p className="mx-auto mt-2 max-w-2xl text-sm font-bold text-slate-600">
                    This snapshot has no technical issue pages in the current audit model.
                </p>
            </div>
        );
    }

    return (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="grid gap-3 md:grid-cols-3">
                <div className="border-2 border-black bg-red-100 p-4 shadow-[4px_4px_0px_0px_#000]">
                    <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">
                        <AlertOctagon className="h-3.5 w-3.5" /> Critical queue
                    </div>
                    <p className="mt-2 text-3xl font-black text-black">{criticalPages}</p>
                    <p className="mt-1 text-xs font-bold text-slate-600">Pages scoring 80+ priority.</p>
                </div>
                <div className="border-2 border-black bg-yellow-100 p-4 shadow-[4px_4px_0px_0px_#000]">
                    <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">
                        <TrendingUp className="h-3.5 w-3.5" /> Value overlap
                    </div>
                    <p className="mt-2 text-3xl font-black text-black">{trafficPages}</p>
                    <p className="mt-1 text-xs font-bold text-slate-600">Priority pages with GA4 traffic.</p>
                </div>
                <div className="border-2 border-black bg-blue-100 p-4 shadow-[4px_4px_0px_0px_#000]">
                    <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">
                        <Gauge className="h-3.5 w-3.5" /> Avg priority
                    </div>
                    <p className="mt-2 text-3xl font-black text-black">{avgPriority}</p>
                    <p className="mt-1 text-xs font-bold text-slate-600">Weighted by severity, traffic, links, speed, and indexation.</p>
                </div>
            </div>

            <div className="space-y-4">
                {rows.map(({ result, issues, seo, priority, speedScore }) => {
                    const primaryIssue = issues[0];
                    return (
                        <div key={result.url} className={`border-2 border-black p-4 shadow-[6px_6px_0px_0px_#000] ${priorityTone(priority)}`}>
                            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                                <div className="min-w-0 flex-1">
                                    <div className="flex flex-wrap items-center gap-2">
                                        <span className="border-2 border-black bg-black px-2 py-1 text-xs font-black uppercase text-white">Priority {priority}</span>
                                        <span className="border border-black bg-white px-2 py-1 text-[11px] font-black uppercase text-black">SEO {seo.total}</span>
                                        {speedScore !== null && <span className="border border-black bg-white px-2 py-1 text-[11px] font-black uppercase text-black">Mobile PSI {speedScore}</span>}
                                        {typeof result.ga4_views === 'number' && <span className="border border-black bg-white px-2 py-1 text-[11px] font-black uppercase text-black">{result.ga4_views.toLocaleString()} views</span>}
                                    </div>
                                    <a href={result.url} target="_blank" rel="noreferrer" className="mt-3 block truncate text-lg font-black uppercase text-black hover:text-blue-700 hover:underline" title={result.url}>
                                        {getUrlPathLabel(result.url)}
                                    </a>
                                    <p className="mt-1 truncate font-mono text-xs font-bold text-slate-600">{result.url}</p>
                                    <div className="mt-3 flex flex-wrap gap-2">
                                        {issues.slice(0, 5).map((issue) => (
                                            <button
                                                key={`${result.url}-${issue.id}`}
                                                type="button"
                                                onClick={() => onReview(issue.id)}
                                                className="border border-black bg-white px-2 py-1 text-[11px] font-black uppercase text-black hover:bg-black hover:text-white"
                                            >
                                                {issue.title}
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                <button
                                    type="button"
                                    onClick={() => onReview(primaryIssue.id)}
                                    className="flex shrink-0 items-center justify-center gap-2 border-2 border-black bg-white px-4 py-2 text-sm font-black uppercase text-black shadow-[3px_3px_0px_0px_#000] hover:bg-black hover:text-white"
                                >
                                    Review pages <ArrowRight className="h-4 w-4" />
                                </button>
                            </div>
                        </div>
                    );
                })}
            </div>

            <div className="border-2 border-black bg-white p-4 shadow-[4px_4px_0px_0px_#000]">
                <div className="flex items-start gap-3">
                    <Search className="mt-0.5 h-5 w-5 text-black" />
                    <p className="text-sm font-bold text-slate-700">
                        Priority combines issue severity, indexing state, traffic, internal-link weakness, mobile PageSpeed, and page-level SEO score so the audit opens with what to fix first.
                    </p>
                </div>
            </div>
        </div>
    );
}
