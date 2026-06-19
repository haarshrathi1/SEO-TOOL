import { useEffect, useMemo, useState } from 'react';
import {
    Activity,
    ArrowRight,
    CheckCircle2,
    FileSearch,
    Loader2,
    Search,
    Shield,
    TrendingUp,
} from 'lucide-react';
import { api } from './api';
import { computeSeoScore } from './seoScore';
import { getTechnicalIssues } from './technicalIssues';
import PublicPageShell from './PublicPageShell';
import type { AuditResult, DemoSnapshotResponse } from './types';
import { getUrlPathLabel } from './url';

function splitTopItems(raw: string | { url: string; impressions: number; clicks: number; }[] | undefined, maxItems = 5) {
    if (!raw) {
        return [];
    }

    if (Array.isArray(raw)) {
        return raw.slice(0, maxItems).map((item) => `${item.url} (${item.impressions} imp | ${item.clicks} clicks)`);
    }

    return raw
        .split(' | ')
        .map((item) => item.trim())
        .filter(Boolean)
        .slice(0, maxItems);
}

function summarizeAudit(results: AuditResult[]) {
    const pages = Array.isArray(results) ? results : [];
    const indexedCount = pages.filter((page) => page.status === 'PASS').length;
    const issueCount = pages.filter((page) => getTechnicalIssues(page, pages).length > 0).length;
    const mobileScores = pages
        .map((page) => page.psi_data?.mobile?.score ?? page.psi_data?.desktop?.score)
        .filter((score): score is number => typeof score === 'number' && Number.isFinite(score));

    const averageMobileScore = mobileScores.length > 0
        ? Math.round(mobileScores.reduce((sum, score) => sum + score, 0) / mobileScores.length)
        : null;

    return {
        pages: pages.length,
        indexedCount,
        issueCount,
        averageMobileScore,
    };
}

function buildDemoAuditPriorities(results: AuditResult[]) {
    return results
        .map((result) => {
            const issues = getTechnicalIssues(result, results);
            const seo = computeSeoScore(result);
            const issueWeight = issues.reduce((sum, issue) => sum + (issue.severity === 'critical' ? 5 : issue.severity === 'high' ? 4 : issue.severity === 'medium' ? 2 : 1), 0);
            const valueBoost = Number(result.ga4_views || 0) > 0 ? 3 : 0;
            const priority = issueWeight + valueBoost + (seo.total < 60 ? 2 : 0);
            return { result, issues, seo, priority };
        })
        .filter((row) => row.issues.length > 0)
        .sort((left, right) => right.priority - left.priority)
        .slice(0, 4);
}

export default function DemoPage({
    onLogin,
    onCreateWorkspace,
}: {
    onLogin: () => void;
    onCreateWorkspace: () => void;
}) {
    const [snapshot, setSnapshot] = useState<DemoSnapshotResponse | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    useEffect(() => {
        let cancelled = false;

        const loadDemo = async () => {
            setLoading(true);
            setError('');

            try {
                const result = await api.getDemoSnapshot();
                if (!cancelled) {
                    setSnapshot(result);
                }
            } catch (issue) {
                if (!cancelled) {
                    setError(issue instanceof Error ? issue.message : 'Could not load demo data.');
                }
            } finally {
                if (!cancelled) {
                    setLoading(false);
                }
            }
        };

        void loadDemo();

        return () => {
            cancelled = true;
        };
    }, []);

    const auditSummary = useMemo(
        () => summarizeAudit(snapshot?.audit?.results || []),
        [snapshot],
    );
    const topPages = useMemo(
        () => splitTopItems(snapshot?.analysis?.data.pages?.top),
        [snapshot],
    );
    const topKeywords = useMemo(
        () => snapshot?.keyword?.keywordUniverse?.keywords?.slice(0, 6) || [],
        [snapshot],
    );
    const auditPriorities = useMemo(
        () => buildDemoAuditPriorities(snapshot?.audit?.results || []),
        [snapshot],
    );

    return (
        <PublicPageShell
            eyebrow="Public Demo"
            title="Inspect the workflow before you connect anything"
            description="This demo uses bundled sample data from the app so buyers can see the dashboard, audit, and keyword research experience before connecting Google Search Console or GA4."
            actions={(
                <>
                    <button onClick={onLogin} className="border-2 border-black bg-white px-4 py-2 text-xs font-black uppercase tracking-wide hover:bg-slate-50">
                        Sign In
                    </button>
                    <button onClick={onCreateWorkspace} className="border-2 border-black bg-black px-4 py-2 text-xs font-black uppercase tracking-wide text-white hover:bg-yellow-300 hover:text-black">
                        Create Workspace
                    </button>
                </>
            )}
        >
            {loading && (
                <div className="operator-panel-inset flex items-center gap-3 p-5">
                    <Loader2 className="h-5 w-5 animate-spin text-black" />
                    <p className="text-sm font-black uppercase text-black">Loading demo snapshot...</p>
                </div>
            )}

            {!loading && error && (
                <div className="operator-panel-warm p-5">
                    <p className="text-sm font-black uppercase text-black">Could not load demo data</p>
                    <p className="mt-2 text-sm font-medium text-slate-700">{error}</p>
                </div>
            )}

            {!loading && !error && snapshot && (
                <div className="space-y-8">
                    <div className="grid gap-4 lg:grid-cols-3">
                        <div className="operator-panel-inset p-5">
                            <div className="flex items-center gap-3">
                                <div className="border-2 border-black bg-blue-200 p-2">
                                    <TrendingUp className="h-4 w-4 text-black" />
                                </div>
                                <div>
                                    <p className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-500">Dashboard Snapshot</p>
                                    <p className="text-lg font-black uppercase text-black">{snapshot.analysis?.data.project || 'Unavailable'}</p>
                                </div>
                            </div>
                            <div className="mt-4 grid grid-cols-2 gap-3">
                                <div className="border-2 border-black bg-white p-3">
                                    <p className="text-[10px] font-black uppercase text-slate-500">Clicks</p>
                                    <p className="text-2xl font-black text-black">{snapshot.analysis?.data.metrics.clicks ?? 0}</p>
                                </div>
                                <div className="border-2 border-black bg-white p-3">
                                    <p className="text-[10px] font-black uppercase text-slate-500">Impressions</p>
                                    <p className="text-2xl font-black text-black">{snapshot.analysis?.data.metrics.impressions ?? 0}</p>
                                </div>
                            </div>
                        </div>

                        <div className="operator-panel-inset p-5">
                            <div className="flex items-center gap-3">
                                <div className="border-2 border-black bg-yellow-300 p-2">
                                    <FileSearch className="h-4 w-4 text-black" />
                                </div>
                                <div>
                                    <p className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-500">Audit Preview</p>
                                    <p className="text-lg font-black uppercase text-black">{auditSummary.pages} pages sampled</p>
                                </div>
                            </div>
                            <div className="mt-4 grid grid-cols-3 gap-3">
                                <div className="border-2 border-black bg-white p-3">
                                    <p className="text-[10px] font-black uppercase text-slate-500">Indexed</p>
                                    <p className="text-xl font-black text-black">{auditSummary.indexedCount}</p>
                                </div>
                                <div className="border-2 border-black bg-white p-3">
                                    <p className="text-[10px] font-black uppercase text-slate-500">Issues</p>
                                    <p className="text-xl font-black text-black">{auditSummary.issueCount}</p>
                                </div>
                                <div className="border-2 border-black bg-white p-3">
                                    <p className="text-[10px] font-black uppercase text-slate-500">Mobile PSI</p>
                                    <p className="text-xl font-black text-black">{auditSummary.averageMobileScore ?? 'N/A'}</p>
                                </div>
                            </div>
                        </div>

                        <div className="operator-panel-inset p-5">
                            <div className="flex items-center gap-3">
                                <div className="border-2 border-black bg-emerald-200 p-2">
                                    <Search className="h-4 w-4 text-black" />
                                </div>
                                <div>
                                    <p className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-500">Keyword Run</p>
                                    <p className="text-lg font-black uppercase text-black">{snapshot.keyword?.seed || 'Unavailable'}</p>
                                </div>
                            </div>
                            <p className="mt-4 text-sm font-medium leading-relaxed text-slate-700">
                                Review SERP DNA, intent decomposition, quick wins, and exportable keyword tables before you set up a project.
                            </p>
                        </div>
                    </div>

                    <div className="grid gap-4 lg:grid-cols-[1.05fr_0.95fr]">
                        <div className="operator-panel-inset p-5">
                            <div className="flex items-center gap-3 border-b-2 border-black pb-4">
                                <Activity className="h-5 w-5 text-black" />
                                <div>
                                    <p className="text-sm font-black uppercase text-black">Top traffic pages</p>
                                    <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-500">
                                        Snapshot from {new Date(snapshot.generatedAt).toLocaleString()}
                                    </p>
                                </div>
                            </div>
                            <div className="mt-4 space-y-3">
                                {topPages.map((item) => (
                                    <div key={item} className="border-2 border-black bg-white p-3">
                                        <p className="text-sm font-bold text-slate-700">{item}</p>
                                    </div>
                                ))}
                            </div>
                        </div>

                        <div className="operator-panel-inset p-5">
                            <div className="flex items-center gap-3 border-b-2 border-black pb-4">
                                <Shield className="h-5 w-5 text-black" />
                                <div>
                                    <p className="text-sm font-black uppercase text-black">What you can verify right now</p>
                                    <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-500">No Google setup required</p>
                                </div>
                            </div>
                            <div className="mt-4 space-y-3">
                                {[
                                    'Dashboard snapshots can export to CSV, and configured projects can also push updates to Google Sheets.',
                                    'Deep audits keep crawl history, issue tracking, and change detection inside the workspace.',
                                    'Keyword research works immediately with sample seeds and saved research history.',
                                ].map((item) => (
                                    <div key={item} className="flex items-start gap-3 border-2 border-black bg-white p-3">
                                        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-black" />
                                        <p className="text-sm font-medium leading-relaxed text-slate-700">{item}</p>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>

                    {auditPriorities.length > 0 && (
                        <div className="operator-panel-inset p-5">
                            <div className="flex items-center justify-between gap-4 border-b-2 border-black pb-4">
                                <div>
                                    <p className="text-sm font-black uppercase text-black">Sample audit priorities</p>
                                    <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-500">What the deep audit would ask you to fix first</p>
                                </div>
                                <FileSearch className="h-5 w-5 text-black" />
                            </div>
                            <div className="mt-4 grid gap-3 md:grid-cols-2">
                                {auditPriorities.map(({ result, issues, seo, priority }) => (
                                    <div key={result.url} className="border-2 border-black bg-white p-4">
                                        <div className="flex items-center justify-between gap-3">
                                            <span className="border border-black bg-yellow-300 px-2 py-0.5 text-[10px] font-black uppercase text-black">Priority {priority}</span>
                                            <span className="border border-black bg-slate-50 px-2 py-0.5 text-[10px] font-black uppercase text-black">SEO {seo.total}</span>
                                        </div>
                                        <p className="mt-3 truncate text-sm font-black uppercase text-black" title={result.url}>{getUrlPathLabel(result.url)}</p>
                                        <div className="mt-3 flex flex-wrap gap-2">
                                            {issues.slice(0, 2).map((issue) => (
                                                <span key={`${result.url}-${issue.id}`} className="border border-black bg-slate-50 px-2 py-1 text-[10px] font-black uppercase text-slate-700">
                                                    {issue.title}
                                                </span>
                                            ))}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {topKeywords.length > 0 && (
                        <div className="operator-panel-inset p-5">
                            <div className="flex items-center justify-between gap-4 border-b-2 border-black pb-4">
                                <div>
                                    <p className="text-sm font-black uppercase text-black">Sample keyword opportunities</p>
                                    <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-500">From the saved demo research run</p>
                                </div>
                                <button onClick={onCreateWorkspace} className="operator-button-primary px-5 py-2.5">
                                    Create Workspace <ArrowRight className="h-4 w-4" />
                                </button>
                            </div>
                            <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                                {topKeywords.map((keyword) => (
                                    <div key={keyword.term} className="border-2 border-black bg-white p-4">
                                        <p className="text-sm font-black uppercase text-black">{keyword.term}</p>
                                        <div className="mt-3 flex flex-wrap gap-2 text-[10px] font-black uppercase">
                                            <span className="border border-black bg-yellow-300 px-2 py-0.5">{keyword.intent}</span>
                                            <span className="border border-black bg-white px-2 py-0.5">{keyword.volume}</span>
                                            <span className="border border-black bg-white px-2 py-0.5">Score {keyword.opportunityScore}</span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            )}
        </PublicPageShell>
    );
}
