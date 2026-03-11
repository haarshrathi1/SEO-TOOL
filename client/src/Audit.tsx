import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertOctagon, Calendar, Download, Filter, History, LayoutDashboard, Loader2, Play, Search, Sparkles, TableProperties } from 'lucide-react';
import type { AuditJob, AuditResult } from './types';
import { api, requestIndexing } from './api';
import AuditAI from './components/audit/AuditAI';
import AuditIssues from './components/audit/AuditIssues';
import AuditOverview from './components/audit/AuditOverview';
import AuditTable from './components/audit/AuditTable';
import { downloadCsv } from './csv';
import { useToast } from './toast';

interface AuditHistoryItem {
    id: string;
    timestamp: string;
    projectId: string;
    results: AuditResult[];
}

interface AuditProps {
    projectId: string;
}

type Tab = 'overview' | 'issues' | 'pages' | 'ai';

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

export default function Audit({ projectId }: AuditProps) {
    const { push } = useToast();
    const [results, setResults] = useState<AuditResult[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [activeTab, setActiveTab] = useState<Tab>('overview');
    const [filterId, setFilterId] = useState('');
    const [history, setHistory] = useState<AuditHistoryItem[]>([]);
    const [jobs, setJobs] = useState<AuditJob[]>([]);
    const [selectedHistoryId, setSelectedHistoryId] = useState('live');
    const [currentJob, setCurrentJob] = useState<AuditJob | null>(null);
    const pollRef = useRef<number | null>(null);

    const clearPoll = () => {
        if (pollRef.current) {
            window.clearInterval(pollRef.current);
            pollRef.current = null;
        }
    };

    const fetchHistory = async () => {
        try {
            setHistory(await api.getAuditHistory());
        } catch (issue) {
            console.error('Failed to fetch audit history', issue);
        }
    };

    const fetchJobs = async () => {
        try {
            setJobs(await api.getAuditJobs(projectId));
        } catch (issue) {
            console.error('Failed to fetch audit jobs', issue);
        }
    };

    useEffect(() => {
        let cancelled = false;

        const load = async () => {
            try {
                const [historyData, jobData] = await Promise.all([api.getAuditHistory(), api.getAuditJobs(projectId)]);
                if (cancelled) return;
                setHistory(historyData);
                setJobs(jobData);
                setResults([]);
                setError('');
                setFilterId('');
                setActiveTab('overview');
                setSelectedHistoryId('live');
                setCurrentJob(null);
            } catch (issue) {
                if (!cancelled) {
                    console.error('Failed to initialize audit view', issue);
                }
            }
        };

        void load();
        return () => {
            cancelled = true;
            clearPoll();
        };
    }, [projectId]);

    const pollJob = (jobId: string) => {
        clearPoll();
        pollRef.current = window.setInterval(() => {
            void (async () => {
                try {
                    const job = await api.getAuditJob(jobId);
                    setCurrentJob(job);
                    if (job.status === 'completed') {
                        const completed = await api.getAuditJobResult(jobId);
                        setResults(completed.result || []);
                        setCurrentJob(completed);
                        setSelectedHistoryId('live');
                        setLoading(false);
                        clearPoll();
                        await Promise.all([fetchHistory(), fetchJobs()]);
                        push({ tone: 'success', title: 'Audit complete', description: `${completed.result?.length || 0} pages analyzed.` });
                    } else if (job.status === 'failed') {
                        setLoading(false);
                        setError(job.error || 'Audit failed');
                        clearPoll();
                        await fetchJobs();
                        push({ tone: 'error', title: 'Audit failed', description: job.error || 'The audit job ended with an error.' });
                    }
                } catch (issue) {
                    clearPoll();
                    setLoading(false);
                    setError(issue instanceof Error ? issue.message : 'Failed to track audit job');
                }
            })();
        }, 2500);
    };

    const runAudit = async () => {
        if (!projectId) return;
        setLoading(true);
        setError('');
        setResults([]);
        setSelectedHistoryId('live');
        setCurrentJob(null);

        try {
            const job = await api.createAuditJob(projectId);
            setCurrentJob(job);
            push({ tone: 'info', title: 'Audit queued', description: 'The crawl is now running in the background.' });
            await fetchJobs();
            pollJob(job.id);
        } catch (issue) {
            setLoading(false);
            setError(issue instanceof Error ? issue.message : 'Failed to start audit');
        }
    };

    const handleHistorySelect = (id: string) => {
        setSelectedHistoryId(id);
        if (id === 'live') {
            setFilterId('');
            if (currentJob?.status === 'completed' && currentJob.result) {
                setResults(currentJob.result);
            } else {
                setResults([]);
            }
            return;
        }

        const item = history.find((entry) => entry.id === id);
        if (item) {
            setResults(item.results);
            setError('');
            setFilterId('');
        }
    };

    const handleRequestIndexing = async (url: string) => {
        try {
            await requestIndexing(url);
            push({ tone: 'success', title: 'Indexing requested', description: url });
        } catch (issue) {
            push({ tone: 'error', title: 'Indexing request failed', description: issue instanceof Error ? issue.message : 'Unknown error' });
        }
    };

    const filteredResults = useMemo(() => {
        if (!filterId) return results;
        switch (filterId) {
            case 'not-indexed':
                return results.filter((result) => result.status !== 'PASS');
            case 'no-h1':
                return results.filter((result) => result.h1Count === 0);
            case 'multi-h1':
                return results.filter((result) => (result.h1Count || 0) > 1);
            case 'missing-desc':
                return results.filter((result) => !result.description);
            case 'low-word-count':
                return results.filter((result) => (result.wordCount || 0) < 300);
            case 'orphans':
                return results.filter((result) => (result.incomingLinks || 0) === 0);
            case 'slow-performance':
                return results.filter((result) => (result.psi_data?.desktop?.score || 0) < 50);
            default:
                return results;
        }
    }, [filterId, results]);

    const projectHistory = useMemo(() => history.filter((entry) => entry.projectId === projectId), [history, projectId]);
    const sortedProjectHistory = useMemo(
        () => [...projectHistory].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()),
        [projectHistory],
    );
    const selectedHistory = sortedProjectHistory.find((entry) => entry.id === selectedHistoryId) || null;
    const comparisonBaseline = selectedHistoryId === 'live'
        ? sortedProjectHistory[0] || null
        : sortedProjectHistory.find((entry) => entry.id !== selectedHistoryId) || null;
    const comparison = results.length > 0 && comparisonBaseline ? compareAuditResults(results, comparisonBaseline.results) : [];
    const formatDate = (iso: string) => new Date(iso).toLocaleString();

    const exportResults = () => {
        downloadCsv(
            `audit-${projectId}-${new Date().toISOString().slice(0, 10)}.csv`,
            ['URL', 'Status', 'Coverage', 'Title', 'Description', 'H1 Count', 'Word Count', 'Desktop PSI', 'Incoming Links'],
            results.map((result) => [
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
            <div className="flex flex-col gap-6 border-2 border-black bg-white p-6 shadow-[8px_8px_0px_0px_#000] md:flex-row md:items-center md:justify-between">
                <div className="flex items-center gap-5">
                    <div className="border-2 border-black bg-[#FF6B6B] p-3 text-black shadow-[4px_4px_0px_0px_rgba(0,0,0,0.1)]">
                        <Search className="h-8 w-8" />
                    </div>
                    <div>
                        <h2 className="text-4xl font-black uppercase italic tracking-tighter text-black">SEO Commander</h2>
                        <div className="mt-1 flex items-center gap-2">
                            <span className="h-2 w-2 animate-pulse rounded-full border border-black bg-green-500"></span>
                            <p className="text-xs font-bold uppercase tracking-widest text-slate-500">Async audit pipeline ready</p>
                        </div>
                    </div>
                </div>

                <div className="flex flex-wrap items-center gap-3">
                    {sortedProjectHistory.length > 0 && (
                        <div className="relative group min-w-[14rem]">
                            <select
                                value={selectedHistoryId}
                                onChange={(event) => handleHistorySelect(event.target.value)}
                                className="w-full appearance-none cursor-pointer border-2 border-black bg-white py-3 pl-4 pr-10 text-sm font-bold uppercase text-black shadow-[4px_4px_0px_0px_#000] transition-all hover:bg-slate-50 focus:translate-x-[2px] focus:translate-y-[2px] focus:outline-none focus:shadow-none"
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

                    {results.length > 0 && (
                        <button onClick={exportResults} className="flex items-center gap-2 border-2 border-black bg-white px-5 py-3 font-black uppercase tracking-wide text-black shadow-[4px_4px_0px_0px_#000] transition-all hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-none">
                            <Download className="h-4 w-4" /> Export CSV
                        </button>
                    )}

                    <button
                        onClick={() => void runAudit()}
                        disabled={loading}
                        className="flex items-center justify-center gap-2 border-2 border-transparent bg-black px-8 py-3.5 text-sm font-black uppercase tracking-wide text-white transition-all hover:border-black hover:bg-white hover:text-black hover:shadow-[4px_4px_0px_0px_#000] disabled:pointer-events-none disabled:opacity-50"
                    >
                        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                        {loading ? 'Running…' : 'Start Audit'}
                    </button>
                </div>
            </div>

            {currentJob && currentJob.status !== 'completed' && (
                <div className="rounded-2xl border border-indigo-200 bg-indigo-50 p-5 shadow-sm">
                    <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                        <div>
                            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-indigo-500">Background job</p>
                            <h3 className="mt-1 text-xl font-black text-slate-900">{currentJob.progress.stage}</h3>
                            <p className="mt-1 text-sm text-slate-600">{currentJob.progress.message}</p>
                            {currentJob.progress.currentUrl && <p className="mt-1 truncate text-xs text-slate-400">{currentJob.progress.currentUrl}</p>}
                        </div>
                        <div className="min-w-[12rem]">
                            <div className="mb-2 flex items-center justify-between text-xs font-semibold uppercase tracking-wide text-indigo-600">
                                <span>{currentJob.progress.completed}/{currentJob.progress.total || '?'}</span>
                                <span>{currentJob.progress.percent}%</span>
                            </div>
                            <div className="h-3 rounded-full bg-indigo-100">
                                <div className="h-3 rounded-full bg-indigo-500 transition-all duration-500" style={{ width: `${currentJob.progress.percent}%` }} />
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

            {comparison.length > 0 && (
                <div className="grid gap-4 md:grid-cols-3">
                    {comparison.map((item) => (
                        <div key={item.label} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">{item.label}</p>
                            <p className="mt-2 text-3xl font-black text-slate-900">{item.current}</p>
                            <p className={`mt-2 text-sm font-semibold ${item.delta === 0 ? 'text-slate-400' : item.delta > 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                                {item.delta === 0 ? 'No change' : `${item.delta > 0 ? '+' : ''}${item.delta} vs previous snapshot`}
                            </p>
                        </div>
                    ))}
                </div>
            )}

            {results.length > 0 && (
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
                        <div className="flex w-fit items-center gap-3 border-2 border-black bg-white p-3 text-sm text-black shadow-[4px_4px_0px_0px_#000]">
                            <Calendar className="h-4 w-4 text-black" />
                            <div>Historical Snapshot: <span className="border border-black bg-yellow-300 px-1 font-black">{formatDate(selectedHistory.timestamp)}</span></div>
                        </div>
                    )}

                    <div className="min-h-[400px]">
                        {activeTab === 'overview' && <AuditOverview results={results} history={sortedProjectHistory} />}
                        {activeTab === 'issues' && <AuditIssues results={results} onReview={(id) => { setFilterId(id); setActiveTab('pages'); }} />}
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
                                <AuditTable results={filteredResults} onRequestIndexing={handleRequestIndexing} />
                            </div>
                        )}
                        {activeTab === 'ai' && <AuditAI results={results} />}
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
                                            const completed = await api.getAuditJobResult(job.id);
                                            setCurrentJob(completed);
                                            setResults(completed.result || []);
                                            setSelectedHistoryId('live');
                                            setError('');
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

