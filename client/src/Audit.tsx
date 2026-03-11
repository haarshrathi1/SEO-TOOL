import { useEffect, useMemo, useRef, useState } from 'react';
import { Activity, AlertOctagon, Calendar, Clock3, Download, Filter, History, LayoutDashboard, Loader2, Play, RefreshCw, Search, Sparkles, TableProperties } from 'lucide-react';
import type { AuditJob, AuditResult } from './types';
import { api, requestIndexing } from './api';
import AuditAI from './components/audit/AuditAI';
import AuditIssues from './components/audit/AuditIssues';
import AuditOverview from './components/audit/AuditOverview';
import AuditTable from './components/audit/AuditTable';
import { downloadCsv } from './csv';
import { useToast } from './toast';
import { OperatorPageHero, OperatorStatePanel } from './components/common/OperatorUi';
import { OperatorComparisonCard } from './components/common/OperatorStats';

interface AuditHistoryItem {
    id: string;
    timestamp: string;
    projectId: string;
    results: AuditResult[];
}

interface AuditProps {
    projectId: string;
    canRunAudit?: boolean;
    canRequestIndexing?: boolean;
}

interface RuntimeLogEntry {
    id: string;
    status: AuditJob['status'];
    stage: string;
    message: string;
    currentUrl: string;
    completed: number;
    total: number;
    percent: number;
    elapsedMs: number;
}

type Tab = 'overview' | 'issues' | 'pages' | 'ai';

const ACTIVE_AUDIT_STATUSES: AuditJob['status'][] = ['queued', 'running'];
const MAX_RUNTIME_LOG_ITEMS = 8;

function countIndexed(results: AuditResult[]) {
    return results.filter((result) => result.status === 'PASS').length;
}

function countIssues(results: AuditResult[]) {
    return results.filter((result) => result.status !== 'PASS' || result.h1Count === 0 || !result.description).length;
}

function avgDesktopPsi(results: AuditResult[]) {
    const withPsi = results.filter((result) => typeof result.psi_data?.desktop?.score === 'number');
    if (!withPsi.length) return 0;
    return Math.round(withPsi.reduce((sum, result) => sum + (result.psi_data?.desktop?.score || 0), 0) / withPsi.length);
}

function compareAuditResults(current: AuditResult[], previous: AuditResult[]) {
    return [
        {
            label: 'Indexed pages',
            current: countIndexed(current),
            previous: countIndexed(previous),
        },
        {
            label: 'Issue pages',
            current: countIssues(current),
            previous: countIssues(previous),
        },
        {
            label: 'Avg desktop PSI',
            current: avgDesktopPsi(current),
            previous: avgDesktopPsi(previous),
        },
    ].map((item) => ({
        ...item,
        delta: Number(item.current) - Number(item.previous),
    }));
}

function formatAuditLoadError(issue: unknown) {
    if (issue instanceof Error && issue.message) {
        return issue.message;
    }

    return 'Failed to load audit data.';
}

function isActiveAuditJob(job: AuditJob | null | undefined) {
    return Boolean(job && ACTIVE_AUDIT_STATUSES.includes(job.status));
}

function getAuditAnchorTimestamp(job: AuditJob) {
    const source = job.startedAt || job.createdAt;
    const timestamp = source ? new Date(source).getTime() : Date.now();
    return Number.isFinite(timestamp) ? timestamp : Date.now();
}

function getAuditElapsedMs(job: AuditJob) {
    return Math.max(0, Date.now() - getAuditAnchorTimestamp(job));
}

function formatElapsedTime(elapsedMs: number) {
    const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function getRuntimeSignature(job: AuditJob) {
    return [
        job.status,
        job.progress.stage,
        job.progress.message,
        job.progress.currentUrl || '',
        job.progress.completed,
        job.progress.percent,
    ].join('::');
}

function getLatestActiveJob(jobs: AuditJob[]) {
    return [...jobs]
        .filter((job) => isActiveAuditJob(job))
        .sort((left, right) => getAuditAnchorTimestamp(right) - getAuditAnchorTimestamp(left))[0] || null;
}

function mergeJobIntoList(currentJobs: AuditJob[], nextJob: AuditJob) {
    return [nextJob, ...currentJobs.filter((job) => job.id !== nextJob.id)]
        .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())
        .slice(0, 20);
}

export default function Audit({ projectId, canRunAudit = true, canRequestIndexing = false }: AuditProps) {
    const { push } = useToast();
    const [liveResults, setLiveResults] = useState<AuditResult[]>([]);
    const [displayResults, setDisplayResults] = useState<AuditResult[]>([]);
    const [startingAudit, setStartingAudit] = useState(false);
    const [error, setError] = useState('');
    const [activeTab, setActiveTab] = useState<Tab>('overview');
    const [filterId, setFilterId] = useState('');
    const [history, setHistory] = useState<AuditHistoryItem[]>([]);
    const [jobs, setJobs] = useState<AuditJob[]>([]);
    const [selectedHistoryId, setSelectedHistoryId] = useState('live');
    const [activeJob, setActiveJob] = useState<AuditJob | null>(null);
    const [runtimeLog, setRuntimeLog] = useState<RuntimeLogEntry[]>([]);
    const [elapsedMs, setElapsedMs] = useState(0);
    const [initialLoading, setInitialLoading] = useState(true);
    const [loadError, setLoadError] = useState('');
    const [loadRetryKey, setLoadRetryKey] = useState(0);
    const pollRef = useRef<number | null>(null);
    const timerRef = useRef<number | null>(null);
    const runtimeJobIdRef = useRef('');
    const runtimeSignatureRef = useRef('');
    const runtimeLogCountRef = useRef(0);

    const clearPoll = () => {
        if (pollRef.current) {
            window.clearInterval(pollRef.current);
            pollRef.current = null;
        }
    };

    const clearTimer = () => {
        if (timerRef.current) {
            window.clearInterval(timerRef.current);
            timerRef.current = null;
        }
    };

    const clearRuntimeState = () => {
        clearTimer();
        runtimeJobIdRef.current = '';
        runtimeSignatureRef.current = '';
        runtimeLogCountRef.current = 0;
        setActiveJob(null);
        setRuntimeLog([]);
        setElapsedMs(0);
    };
    const trackActiveJob = (job: AuditJob, options: { resetLog?: boolean } = {}) => {
        const shouldResetLog = options.resetLog === true || runtimeJobIdRef.current !== job.id;

        if (shouldResetLog) {
            runtimeJobIdRef.current = job.id;
            runtimeSignatureRef.current = '';
            runtimeLogCountRef.current = 0;
        }

        setActiveJob(job);
        setElapsedMs(getAuditElapsedMs(job));
        setJobs((current) => mergeJobIntoList(current, job));

        const nextSignature = getRuntimeSignature(job);
        if (runtimeSignatureRef.current === nextSignature) {
            if (shouldResetLog) {
                setRuntimeLog([]);
            }
            return;
        }

        runtimeSignatureRef.current = nextSignature;
        const entry: RuntimeLogEntry = {
            id: `${job.id}-${runtimeLogCountRef.current}`,
            status: job.status,
            stage: job.progress.stage,
            message: job.progress.message,
            currentUrl: job.progress.currentUrl || '',
            completed: job.progress.completed,
            total: job.progress.total,
            percent: job.progress.percent,
            elapsedMs: getAuditElapsedMs(job),
        };
        runtimeLogCountRef.current += 1;

        setRuntimeLog((current) => {
            const nextEntries = shouldResetLog ? [] : current;
            return [...nextEntries, entry].slice(-MAX_RUNTIME_LOG_ITEMS);
        });
    };

    const stopTrackingActiveJob = () => {
        clearPoll();
        clearRuntimeState();
    };

    const fetchHistory = async () => {
        try {
            const historyData = await api.getAuditHistory(projectId);
            setHistory(historyData);
            return historyData;
        } catch (issue) {
            console.error('Failed to fetch audit history', issue);
            return null;
        }
    };

    const fetchJobs = async () => {
        try {
            const jobData = await api.getAuditJobs(projectId);
            setJobs(jobData);
            return jobData;
        } catch (issue) {
            console.error('Failed to fetch audit jobs', issue);
            return null;
        }
    };

    const pollJob = (jobId: string) => {
        clearPoll();

        const syncJob = async () => {
            try {
                const job = await api.getAuditJob(jobId);

                if (isActiveAuditJob(job)) {
                    setStartingAudit(false);
                    trackActiveJob(job);
                    return;
                }

                if (job.status === 'completed') {
                    const completed = await api.getAuditJobResult(jobId);
                    const nextResults = completed.result || [];

                    setStartingAudit(false);
                    setError('');
                    setLiveResults(nextResults);
                    setDisplayResults(nextResults);
                    setSelectedHistoryId('live');
                    setFilterId('');
                    stopTrackingActiveJob();
                    await Promise.all([fetchHistory(), fetchJobs()]);
                    push({ tone: 'success', title: 'Audit complete', description: `${nextResults.length} pages analyzed.` });
                    return;
                }

                if (job.status === 'failed') {
                    setStartingAudit(false);
                    setError(job.error || 'Audit failed');
                    stopTrackingActiveJob();
                    await fetchJobs();
                    push({ tone: 'error', title: 'Audit failed', description: job.error || 'The audit job ended with an error.' });
                }
            } catch (issue) {
                stopTrackingActiveJob();
                setStartingAudit(false);
                setError(issue instanceof Error ? issue.message : 'Failed to track audit job');
            }
        };

        void syncJob();
        pollRef.current = window.setInterval(() => {
            void syncJob();
        }, 2500);
    };

    useEffect(() => {
        clearTimer();

        const nextActiveJob = activeJob;
        if (!nextActiveJob || !isActiveAuditJob(nextActiveJob)) {
            return;
        }

        const syncElapsedTime = () => {
            setElapsedMs(getAuditElapsedMs(nextActiveJob));
        };

        syncElapsedTime();
        timerRef.current = window.setInterval(syncElapsedTime, 1000);

        return () => {
            clearTimer();
        };
    }, [activeJob?.id, activeJob?.createdAt, activeJob?.startedAt, activeJob?.status]);

    useEffect(() => {
        let cancelled = false;

        const load = async () => {
            clearPoll();
            clearRuntimeState();
            setInitialLoading(true);
            setLoadError('');
            setError('');
            setStartingAudit(false);
            setLiveResults([]);
            setDisplayResults([]);
            setHistory([]);
            setJobs([]);
            setFilterId('');
            setActiveTab('overview');
            setSelectedHistoryId('live');

            try {
                const [historyData, jobData] = await Promise.all([api.getAuditHistory(projectId), api.getAuditJobs(projectId)]);
                if (cancelled) return;

                const sortedHistory = historyData
                    .filter((entry) => entry.projectId === projectId)
                    .sort((left, right) => new Date(right.timestamp).getTime() - new Date(left.timestamp).getTime());
                const latestHistory = sortedHistory[0] || null;
                const latestActiveJob = getLatestActiveJob(jobData);
                const nextResults = latestHistory?.results || [];

                setHistory(historyData);
                setJobs(jobData);
                setLiveResults(nextResults);
                setDisplayResults(nextResults);
                setError('');
                setFilterId('');
                setActiveTab('overview');
                setSelectedHistoryId('live');

                if (latestActiveJob) {
                    trackActiveJob(latestActiveJob, { resetLog: true });
                    pollJob(latestActiveJob.id);
                }
            } catch (issue) {
                if (!cancelled) {
                    console.error('Failed to initialize audit view', issue);
                    setLiveResults([]);
                    setDisplayResults([]);
                    setHistory([]);
                    setJobs([]);
                    setSelectedHistoryId('live');
                    clearRuntimeState();
                    setLoadError(formatAuditLoadError(issue));
                }
            } finally {
                if (!cancelled) {
                    setInitialLoading(false);
                }
            }
        };

        void load();

        return () => {
            cancelled = true;
            clearPoll();
            clearTimer();
        };
    }, [projectId, loadRetryKey]);
    const runAudit = async () => {
        if (!projectId || !canRunAudit) return;

        setStartingAudit(true);
        setError('');
        setSelectedHistoryId('live');
        setDisplayResults(liveResults);
        setFilterId('');

        try {
            const job = await api.createAuditJob(projectId);
            trackActiveJob(job, { resetLog: true });
            push({ tone: 'info', title: 'Audit queued', description: 'The crawl is now running in the background.' });
            await fetchJobs();
            pollJob(job.id);
        } catch (issue) {
            setStartingAudit(false);
            clearRuntimeState();
            setError(issue instanceof Error ? issue.message : 'Failed to start audit');
        }
    };

    const sortedProjectHistory = history
        .filter((entry) => entry.projectId === projectId)
        .sort((left, right) => new Date(right.timestamp).getTime() - new Date(left.timestamp).getTime());
    const selectedHistoryIndex = selectedHistoryId === 'live'
        ? -1
        : sortedProjectHistory.findIndex((entry) => entry.id === selectedHistoryId);
    const selectedHistory = selectedHistoryIndex >= 0 ? sortedProjectHistory[selectedHistoryIndex] : null;
    const comparisonBaseline = selectedHistoryId === 'live'
        ? sortedProjectHistory[1] || null
        : selectedHistoryIndex >= 0
            ? sortedProjectHistory[selectedHistoryIndex + 1] || null
            : null;
    const comparison = displayResults.length > 0 && comparisonBaseline ? compareAuditResults(displayResults, comparisonBaseline.results) : [];
    const formatDate = (iso: string) => new Date(iso).toLocaleString();
    const hasActiveJob = isActiveAuditJob(activeJob);
    const runtimeEntries = [...runtimeLog].reverse();
    const showInitialLoadingState = initialLoading && displayResults.length === 0;
    const showLoadErrorState = !initialLoading && Boolean(loadError) && displayResults.length === 0;
    const showEmptyState = !initialLoading && !loadError && !startingAudit && !hasActiveJob && displayResults.length === 0;
    const auditEmptyTitle = sortedProjectHistory.length > 0 ? 'No pages in this snapshot' : 'No audit snapshot yet';
    const auditEmptyDescription = sortedProjectHistory.length > 0
        ? 'This audit snapshot completed without any page results. Try another run if you expected URLs here.'
        : canRunAudit
            ? 'Run the first deep audit for this project to populate crawl health, issue counts, and page details.'
            : 'No completed audit snapshots are available for this project yet.';

    const handleHistorySelect = (id: string) => {
        setSelectedHistoryId(id);
        setFilterId('');
        setError('');

        if (id === 'live') {
            setDisplayResults(liveResults);
            return;
        }

        const item = history.find((entry) => entry.id === id);
        if (item) {
            setDisplayResults(item.results);
        }
    };

    const handleRequestIndexing = async (url: string) => {
        if (!canRequestIndexing) {
            push({ tone: 'error', title: 'Admin access required', description: 'Only admins can request indexing.' });
            return;
        }

        try {
            await requestIndexing(url);
            push({ tone: 'success', title: 'Indexing requested', description: url });
        } catch (issue) {
            push({ tone: 'error', title: 'Indexing request failed', description: issue instanceof Error ? issue.message : 'Unknown error' });
        }
    };

    const filteredResults = useMemo(() => {
        if (!filterId) return displayResults;
        switch (filterId) {
            case 'not-indexed':
                return displayResults.filter((result) => result.status !== 'PASS');
            case 'no-h1':
                return displayResults.filter((result) => result.h1Count === 0);
            case 'multi-h1':
                return displayResults.filter((result) => (result.h1Count || 0) > 1);
            case 'missing-desc':
                return displayResults.filter((result) => !result.description);
            case 'low-word-count':
                return displayResults.filter((result) => (result.wordCount || 0) < 300);
            case 'orphans':
                return displayResults.filter((result) => (result.incomingLinks || 0) === 0);
            case 'slow-performance':
                return displayResults.filter((result) => (result.psi_data?.desktop?.score || 0) < 50);
            default:
                return displayResults;
        }
    }, [displayResults, filterId]);

    const exportResults = () => {
        downloadCsv(
            `audit-${projectId}-${new Date().toISOString().slice(0, 10)}.csv`,
            ['URL', 'Status', 'Coverage', 'Title', 'Description', 'H1 Count', 'Word Count', 'Desktop PSI', 'Incoming Links'],
            displayResults.map((result) => [
                result.url,
                result.status,
                result.coverageState,
                result.title || '',
                result.description || '',
                result.h1Count || 0,
                result.wordCount || 0,
                result.psi_data?.desktop?.score || '',
                result.incomingLinks || 0,
            ]),
        );
        push({ tone: 'success', title: 'Audit exported', description: 'CSV download started.' });
    };

    return (
        <div className="space-y-8 pb-20 animate-in slide-in-from-bottom-6 duration-700 fade-in">
            <OperatorPageHero
                icon={Search}
                title="SEO Commander"
                titleClassName="italic"
                supportingContent={(
                    <div className="mt-1 flex items-center justify-center gap-2 md:justify-start">
                        <span className="h-2 w-2 animate-pulse rounded-full border border-black bg-green-500"></span>
                        <p className="text-xs font-bold uppercase tracking-widest text-slate-500">Async audit pipeline ready</p>
                    </div>
                )}
                actions={(
                    <>
                        {sortedProjectHistory.length > 0 && (
                            <div className="relative group min-w-[14rem]">
                                <select
                                    value={selectedHistoryId}
                                    onChange={(event) => handleHistorySelect(event.target.value)}
                                    disabled={initialLoading}
                                    className="operator-control w-full appearance-none cursor-pointer py-3 pl-4 pr-10 text-sm font-bold uppercase text-black"
                                >
                                    <option value="live">Live / latest run</option>
                                    <optgroup label="Previous Audits">
                                        {sortedProjectHistory.map((entry) => (
                                            <option key={entry.id} value={entry.id}>{formatDate(entry.timestamp)}</option>
                                        ))}
                                    </optgroup>
                                </select>
                                <History className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-black" />
                            </div>
                        )}

                        {canRunAudit && displayResults.length > 0 && (
                            <button onClick={exportResults} className="operator-button-secondary px-5 py-3">
                                <Download className="h-4 w-4" /> Export CSV
                            </button>
                        )}

                        {canRunAudit && (
                            <button
                                onClick={() => void runAudit()}
                                disabled={startingAudit || hasActiveJob}
                                className="operator-button-primary px-8 py-3.5"
                            >
                                {(startingAudit || hasActiveJob) ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                                {startingAudit ? 'Starting...' : hasActiveJob ? 'Running...' : 'Start Audit'}
                            </button>
                        )}
                    </>
                )}
            />
            {hasActiveJob && activeJob && (
                <div className="overflow-hidden rounded-[2rem] border-2 border-black bg-[#fffdf3] shadow-[8px_8px_0px_0px_#000]">
                    <div className="grid gap-6 border-b-2 border-black bg-[linear-gradient(135deg,_rgba(254,249,195,0.95)_0%,_rgba(219,234,254,0.9)_100%)] p-6 lg:grid-cols-[minmax(0,1.35fr)_minmax(18rem,0.9fr)]">
                        <div>
                            <div className="flex flex-wrap items-center gap-3">
                                <span className="inline-flex items-center gap-2 border-2 border-black bg-white px-3 py-1 text-[11px] font-black uppercase tracking-[0.22em] text-black">
                                    <Activity className="h-3.5 w-3.5 animate-pulse" />
                                    Deep audit live
                                </span>
                                <span className="inline-flex items-center rounded-full border border-indigo-200 bg-indigo-100 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.2em] text-indigo-700">
                                    {activeJob.status}
                                </span>
                            </div>
                            <h3 className="mt-4 text-3xl font-black uppercase tracking-tight text-slate-900">{activeJob.progress.stage}</h3>
                            <p className="mt-2 max-w-2xl text-sm font-medium text-slate-700">{activeJob.progress.message}</p>
                            {activeJob.progress.currentUrl && (
                                <div className="mt-4 rounded-2xl border border-black/15 bg-white/80 p-4">
                                    <p className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-500">Current URL</p>
                                    <p className="mt-2 break-all font-mono text-xs text-slate-700">{activeJob.progress.currentUrl}</p>
                                </div>
                            )}
                        </div>

                        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-1">
                            <div className="rounded-2xl border-2 border-black bg-white p-4">
                                <p className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-500">Elapsed</p>
                                <div className="mt-3 flex items-center gap-2 text-2xl font-black text-slate-900">
                                    <Clock3 className="h-5 w-5 text-slate-500" />
                                    <span>{formatElapsedTime(elapsedMs)}</span>
                                </div>
                            </div>

                            <div className="rounded-2xl border-2 border-black bg-white p-4">
                                <p className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-500">Progress</p>
                                <p className="mt-3 text-2xl font-black text-slate-900">{activeJob.progress.percent}%</p>
                                <p className="mt-1 text-xs font-semibold uppercase tracking-wide text-slate-500">{activeJob.progress.stage}</p>
                            </div>

                            <div className="rounded-2xl border-2 border-black bg-white p-4">
                                <p className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-500">Pages</p>
                                <p className="mt-3 text-2xl font-black text-slate-900">
                                    {activeJob.progress.completed}
                                    <span className="text-base text-slate-500">/{activeJob.progress.total || '?'}</span>
                                </p>
                                <p className="mt-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Processed so far</p>
                            </div>
                        </div>
                    </div>

                    <div className="grid gap-6 p-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(18rem,0.85fr)]">
                        <div className="space-y-4">
                            <div className="flex items-center justify-between gap-4 text-xs font-black uppercase tracking-[0.2em] text-slate-500">
                                <span>Run progress</span>
                                <span>{activeJob.progress.completed}/{activeJob.progress.total || '?'}</span>
                            </div>
                            <div className="h-5 rounded-full border-2 border-black bg-white p-1">
                                <div
                                    className="h-full rounded-full bg-[linear-gradient(90deg,_#111827_0%,_#2563eb_70%,_#34d399_100%)] transition-all duration-500"
                                    style={{ width: `${activeJob.progress.percent}%` }}
                                />
                            </div>
                            <p className="text-xs font-semibold text-slate-500">The audit polls every 2.5 seconds and adds a new event only when the crawler meaningfully changes state.</p>
                        </div>

                        <div className="rounded-3xl border-2 border-black bg-white p-5">
                            <div className="flex items-center justify-between gap-3">
                                <div>
                                    <p className="text-sm font-black uppercase tracking-[0.2em] text-slate-900">Recent activity</p>
                                    <p className="mt-1 text-xs font-semibold text-slate-500">Session-only log for the active run</p>
                                </div>
                                <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.2em] text-slate-500">
                                    {runtimeEntries.length} events
                                </span>
                            </div>

                            <div className="mt-4 space-y-3">
                                {runtimeEntries.map((entry) => (
                                    <div key={entry.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                                        <div className="flex items-center justify-between gap-3">
                                            <p className="text-sm font-bold text-slate-900">{entry.stage}</p>
                                            <span className="font-mono text-xs font-bold text-slate-500">{formatElapsedTime(entry.elapsedMs)}</span>
                                        </div>
                                        <p className="mt-1 text-sm text-slate-600">{entry.message}</p>
                                        <div className="mt-2 flex items-center justify-between gap-3 text-[11px] font-bold uppercase tracking-wide text-slate-400">
                                            <span>{entry.completed}/{entry.total || '?'}</span>
                                            <span>{entry.percent}%</span>
                                        </div>
                                        {entry.currentUrl && <p className="mt-2 break-all font-mono text-[11px] text-slate-500">{entry.currentUrl}</p>}
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {error && (
                <div className="flex items-center gap-3 rounded-2xl border border-red-100 bg-red-50/80 p-4 text-red-600 shadow-sm">
                    <LayoutDashboard className="h-5 w-5 flex-shrink-0 animate-bounce" />
                    <span className="font-medium">{error}</span>
                </div>
            )}

            {showInitialLoadingState && (
                <OperatorStatePanel
                    icon={Loader2}
                    iconClassName="animate-spin"
                    title="Loading audit history..."
                    titleAs="p"
                    description="Preparing the latest crawl data for this project."
                />
            )}

            {showLoadErrorState && (
                <OperatorStatePanel
                    icon={AlertOctagon}
                    title="Could not load audit data"
                    description={loadError}
                    variant="warm"
                    titleAs="h3"
                    action={(
                        <button
                            onClick={() => setLoadRetryKey((current) => current + 1)}
                            className="operator-button-primary px-4 py-2"
                        >
                            <RefreshCw className="h-4 w-4" /> Retry
                        </button>
                    )}
                />
            )}

            {showEmptyState && (
                <OperatorStatePanel
                    icon={History}
                    title={auditEmptyTitle}
                    description={auditEmptyDescription}
                    variant="panel"
                    align="center"
                    titleAs="h3"
                    action={canRunAudit ? (
                        <button
                            onClick={() => void runAudit()}
                            disabled={startingAudit || hasActiveJob}
                            className="operator-button-primary px-5 py-3"
                        >
                            {(startingAudit || hasActiveJob) ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                            {startingAudit ? 'Starting...' : hasActiveJob ? 'Running...' : 'Start audit'}
                        </button>
                    ) : undefined}
                />
            )}
            {comparison.length > 0 && (
                <div className="grid gap-4 md:grid-cols-3">
                    {comparison.map((item) => (
                        <OperatorComparisonCard
                            key={item.label}
                            label={item.label}
                            value={item.current}
                            deltaTone={item.delta === 0 ? 'neutral' : item.delta > 0 ? 'positive' : 'negative'}
                            deltaLabel={item.delta === 0 ? 'No change' : `${item.delta > 0 ? '+' : ''}${item.delta} vs previous snapshot`}
                        />
                    ))}
                </div>
            )}

            {displayResults.length > 0 && (
                <div className="space-y-6">
                    <div className="flex flex-wrap items-center gap-4">
                        {[
                            { id: 'overview', label: 'Overview', icon: LayoutDashboard },
                            { id: 'issues', label: 'Issues', icon: AlertOctagon },
                            { id: 'pages', label: 'All Pages', icon: TableProperties },
                            { id: 'ai', label: 'AI Insight', icon: Sparkles, special: true },
                        ].map((tab) => (
                            <button
                                key={tab.id}
                                onClick={() => setActiveTab(tab.id as Tab)}
                                className={`flex items-center gap-2 border-2 border-black px-6 py-3 text-sm font-black uppercase tracking-wider transition-all ${activeTab === tab.id ? 'translate-x-[4px] translate-y-[4px] bg-black text-white shadow-none' : 'bg-white text-black shadow-[4px_4px_0px_0px_#000] hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-[2px_2px_0px_0px_#000]'} ${tab.special && activeTab !== tab.id ? 'text-blue-600' : ''}`}
                            >
                                <tab.icon className={`h-4 w-4 ${tab.special && activeTab !== tab.id ? 'animate-pulse text-blue-600' : ''}`} />
                                {tab.label}
                            </button>
                        ))}
                    </div>

                    {selectedHistory && (
                        <div className="operator-panel-inset flex w-fit items-center gap-3 p-3 text-sm text-black">
                            <Calendar className="h-4 w-4 text-black" />
                            <div>Historical Snapshot: <span className="border border-black bg-yellow-300 px-1 font-black">{formatDate(selectedHistory.timestamp)}</span></div>
                        </div>
                    )}

                    <div className="min-h-[400px]">
                        {activeTab === 'overview' && <AuditOverview results={displayResults} history={sortedProjectHistory} />}
                        {activeTab === 'issues' && <AuditIssues results={displayResults} onReview={(id) => { setFilterId(id); setActiveTab('pages'); }} />}
                        {activeTab === 'pages' && (
                            <div className="space-y-4">
                                {filterId && (
                                    <div className="flex items-center justify-between rounded-xl border border-indigo-100 bg-indigo-50 p-3">
                                        <div className="flex items-center gap-2 text-sm font-bold text-indigo-700">
                                            <Filter className="h-4 w-4" />
                                            Filtering by: <span className="uppercase">{filterId.replace('-', ' ')}</span>
                                            <span className="rounded border border-indigo-200 bg-white px-2 py-0.5 text-xs">{filteredResults.length}</span>
                                        </div>
                                        <button onClick={() => setFilterId('')} className="text-xs font-bold text-indigo-600 hover:text-indigo-800 hover:underline">
                                            Clear Filter
                                        </button>
                                    </div>
                                )}
                                <AuditTable results={filteredResults} onRequestIndexing={canRequestIndexing ? handleRequestIndexing : null} />
                            </div>
                        )}
                        {activeTab === 'ai' && <AuditAI results={displayResults} />}
                    </div>
                </div>
            )}

            {jobs.length > 0 && (
                <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                    <h3 className="text-lg font-bold text-slate-900">Recent audit jobs</h3>
                    <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                        {jobs.map((job) => (
                            <button
                                key={job.id}
                                onClick={() => {
                                    if (job.status === 'completed') {
                                        void (async () => {
                                            try {
                                                const completed = await api.getAuditJobResult(job.id);
                                                const nextResults = completed.result || [];
                                                setDisplayResults(nextResults);
                                                setSelectedHistoryId(completed.auditHistoryId || 'live');
                                                setFilterId('');
                                                setError('');
                                            } catch (issue) {
                                                setError(issue instanceof Error ? issue.message : 'Failed to load audit job result');
                                            }
                                        })();
                                    }
                                }}
                                className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-left transition hover:border-slate-300 hover:bg-white"
                            >
                                <div className="flex items-center justify-between gap-3">
                                    <span className="text-sm font-semibold text-slate-900">{formatDate(job.createdAt)}</span>
                                    <span className={`rounded-full px-2 py-1 text-xs font-semibold uppercase ${job.status === 'completed' ? 'bg-emerald-100 text-emerald-700' : job.status === 'failed' ? 'bg-rose-100 text-rose-700' : 'bg-indigo-100 text-indigo-700'}`}>{job.status}</span>
                                </div>
                                <p className="mt-2 text-sm text-slate-500">{job.progress.message}</p>
                            </button>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}
