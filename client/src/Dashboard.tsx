import { useEffect, useMemo, useState } from 'react';
import {
    Activity, AlertCircle,
    Download, Globe, Layout, Zap, History
} from 'lucide-react';
import { motion } from 'framer-motion';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import Audit from './Audit';
import type { AnalysisData, Project, HistoryItem, AuditResult } from './types';
import { api } from './api';
import { getUrlPathLabel } from './url';
import HealthGauge from './components/dashboard/HealthGauge';
import CrawlStatus from './components/dashboard/CrawlStatus';
import PerformanceSummary from './components/dashboard/PerformanceSummary';
import { downloadCsv } from './csv';
import { useRouter } from './router';
import { useToast } from './toast';

function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs));
}

function formatDashboardError(e: unknown) {
    const message = e instanceof Error ? e.message : 'Analysis failed';

    if (import.meta.env.DEV && message === 'Access Denied') {
        return 'Signed in as viewer. Enable DEV_ADMIN_BYPASS=true in server/.env or sign in with ADMIN_EMAIL.';
    }

    return message;
}

function toNumber(value: string | number | undefined) {
    if (typeof value === 'number') return value;
    return Number.parseFloat(String(value || '0').replace(/[^0-9.-]/g, '')) || 0;
}

function buildComparison(current: AnalysisData, previous: AnalysisData) {
    return [
        {
            label: 'Clicks',
            current: current.metrics.clicks,
            previous: previous.metrics.clicks,
            delta: current.metrics.clicks - previous.metrics.clicks,
        },
        {
            label: 'Impressions',
            current: current.metrics.impressions,
            previous: previous.metrics.impressions,
            delta: current.metrics.impressions - previous.metrics.impressions,
        },
        {
            label: 'CTR',
            current: current.metrics.ctr,
            previous: previous.metrics.ctr,
            delta: toNumber(current.metrics.ctr) - toNumber(previous.metrics.ctr),
        },
    ];
}

interface AuditHistoryItem {
    id: string;
    timestamp: string;
    projectId: string;
    results: AuditResult[];
}

export default function Dashboard() {
    const { navigate } = useRouter();
    const { push } = useToast();
    const [projects, setProjects] = useState<Project[]>([]);
    const [selectedProjectId, setSelectedProjectId] = useState<string>('');

    const [data, setData] = useState<AnalysisData | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [activeTab, setActiveTab] = useState<'dashboard' | 'audit'>('dashboard');
    const [history, setHistory] = useState<HistoryItem[]>([]);
    const [selectedHistoryId, setSelectedHistoryId] = useState<string>('live');
    const [auditHistory, setAuditHistory] = useState<AuditHistoryItem[]>([]);

    // Fetch Projects & History on Mount
    useEffect(() => {
        const init = async () => {
            try {
                // Fetch Projects
                const projects = await api.getProjects();
                setProjects(projects);
                if (projects.length > 0) {
                    setSelectedProjectId(projects[0].id);
                }

                // Fetch GSC History
                const historyData = await api.getHistory();
                setHistory(historyData);

                // Fetch Audit History (For latest health data)
                const auditData = await api.getAuditHistory();
                setAuditHistory(auditData);

            } catch (e) {
                console.error('Initialization failed', e);
            }
        };
        init();
    }, []);

    const fetchHistory = async () => {
        try {
            const nextHistory = await api.getHistory();
            setHistory(nextHistory);
        } catch (e) {
            console.error('Failed to fetch history', e);
        }
    };

    const runAnalysis = async () => {
        if (!selectedProjectId) return;
        setLoading(true);
        setError('');
        try {
            const json = await api.analyzeSite(selectedProjectId);
            setData(json);
            setSelectedHistoryId('live');
            void fetchHistory();
        } catch (e) {
            setError(formatDashboardError(e));
        } finally {
            setLoading(false);
        }
    };

    const handleHistorySelect = (id: string) => {
        setSelectedHistoryId(id);
        if (id === 'live') {
            return;
        }
        const item = history.find(h => h.id === id);
        if (item) {
            setData(item.data);
            setError('');
        }
    };

    const projectHistory = useMemo(
        () => history.filter((item) => item.projectId === selectedProjectId || (!item.projectId && selectedProjectId === 'laserlift')),
        [history, selectedProjectId],
    );
    const sortedProjectHistory = useMemo(
        () => [...projectHistory].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()),
        [projectHistory],
    );
    const selectedHistory = sortedProjectHistory.find((item) => item.id === selectedHistoryId) || null;
    const previousSnapshot = selectedHistoryId === 'live'
        ? sortedProjectHistory[0] || null
        : sortedProjectHistory.find((item) => item.id !== selectedHistoryId) || null;

    const projectAuditHistory = useMemo(
        () => auditHistory.filter((item) => item.projectId === selectedProjectId),
        [auditHistory, selectedProjectId],
    );
    const latestAudit = useMemo(
        () => [...projectAuditHistory].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())[0] || null,
        [projectAuditHistory],
    );

    const comparisonMetrics = useMemo(
        () => (data && previousSnapshot ? buildComparison(data, previousSnapshot.data) : []),
        [data, previousSnapshot],
    );

    const formatDate = (iso: string) => new Date(iso).toLocaleString();

    const handleRequestIndexing = async (url: string) => {
        try {
            await api.requestIndexing(url);
            push({ tone: 'success', title: 'Indexing requested', description: url });
        } catch (issue) {
            push({ tone: 'error', title: 'Indexing request failed', description: issue instanceof Error ? issue.message : 'Unknown error' });
        }
    };

    const exportSummary = () => {
        if (!data) return;
        const rows = Object.entries(data.report || {}).map(([key, value]) => [key, String(value ?? '')]);
        downloadCsv(
            `dashboard-${selectedProjectId}-${new Date().toISOString().slice(0, 10)}.csv`,
            ['Metric', 'Value'],
            rows,
        );
        push({ tone: 'success', title: 'Dashboard exported', description: 'CSV download started.' });
    };

    return (
        <div className="min-h-screen bg-[#e0e7ff] text-slate-900 font-sans selection:bg-black selection:text-white pb-20">
            {/* Brutalist Header */}
            <header className="sticky top-0 z-50 bg-white border-b-2 border-black">
                <div className="max-w-7xl mx-auto px-6 py-4 flex flex-col md:flex-row items-center justify-between gap-4">
                    <div className="w-full md:w-auto flex items-center gap-6">
                        {/* Logo / Title Area */}
                        <div className="flex flex-col">
                            <div className="flex items-center gap-3">
                                <div className="p-2 bg-black rounded-none border-2 border-black shadow-[2px_2px_0px_0px_rgba(0,0,0,0.5)]">
                                    <Activity className="w-6 h-6 text-white" />
                                </div>
                                <h1 className="text-2xl font-black tracking-tight text-black flex items-center gap-2 uppercase">
                                    {data?.project || 'SEO Intel'}
                                    {selectedHistoryId !== 'live' && (
                                        <span className="text-[10px] uppercase tracking-wider bg-yellow-300 text-black px-2 py-0.5 border border-black font-bold">Historical</span>
                                    )}
                                </h1>
                            </div>
                            <p className="text-xs font-bold text-slate-500 mt-1 pl-[52px] font-mono uppercase">
                                {data?.domain || (projects.find(p => p.id === selectedProjectId)?.domain || 'Select a project')}
                                {data?.week && <span className="ml-2 bg-black text-white px-1">WEEK {data.week}</span>}
                            </p>
                        </div>

                        {/* Divider */}
                        <div className="hidden md:block h-10 w-0.5 bg-black" />

                        {/* Navigation Tabs */}
                        <nav className="flex items-center gap-2">
                            {[
                                { id: 'dashboard', label: 'Command Center', icon: Layout },
                                { id: 'audit', label: 'Deep Audit', icon: Zap },
                                { id: 'keywords', label: 'Keywords', icon: Globe }
                            ].map((tab) => (
                                <button
                                    key={tab.id}
                                    onClick={() => {
                                        if (tab.id === 'keywords') {
                                            navigate('/keywords');
                                            return;
                                        }
                                        setActiveTab(tab.id as 'dashboard' | 'audit');
                                    }}
                                    className={cn(
                                        "px-4 py-2 text-sm font-bold border-2 border-black transition-all duration-150 flex items-center gap-2 uppercase",
                                        activeTab === tab.id
                                            ? "bg-black text-white shadow-[4px_4px_0px_0px_#888]"
                                            : "bg-white text-black hover:translate-x-[1px] hover:translate-y-[1px] hover:shadow-[2px_2px_0px_0px_#000]"
                                    )}
                                >
                                    <tab.icon className="w-4 h-4" />
                                    {tab.label}
                                </button>
                            ))}
                        </nav>
                    </div>

                    <div className="flex items-center gap-3 w-full md:w-auto">
                        {/* Project Selector */}
                        {projects.length > 0 && (
                            <div className="relative group">
                                <select
                                    value={selectedProjectId}
                                    onChange={(e) => {
                                        setSelectedProjectId(e.target.value);
                                        setData(null);
                                        setSelectedHistoryId('live');
                                    }}
                                    className="appearance-none bg-white hover:bg-slate-50 border-2 border-black text-black text-sm font-bold py-2 pl-4 pr-10 shadow-[4px_4px_0px_0px_#000] focus:outline-none focus:translate-x-[2px] focus:translate-y-[2px] focus:shadow-none transition-all cursor-pointer uppercase"
                                >
                                    {projects.map(p => (
                                        <option key={p.id} value={p.id}>{p.name}</option>
                                    ))}
                                </select>
                                <Globe className="w-4 h-4 text-black absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                            </div>
                        )}
                    </div>
                </div>
            </header>

            {activeTab === 'audit' && (
                <main className="max-w-7xl mx-auto mt-8 px-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
                    <Audit key={selectedProjectId} projectId={selectedProjectId} />
                </main>
            )}

            {activeTab === 'dashboard' && error && (
                <div className="max-w-7xl mx-auto mt-8 px-6">
                    <div className="p-4 bg-red-50/80 backdrop-blur-sm text-red-600 rounded-2xl border border-red-100 flex items-center gap-3 shadow-sm">
                        <AlertCircle className="w-5 h-5 flex-shrink-0 animate-bounce" />
                        <span className="font-medium">{error}</span>
                    </div>
                </div>
            )}

            {/* SEO COMMANDER BANNER */}
            {activeTab === 'dashboard' && (
                <div className="max-w-7xl mx-auto mt-8 px-6">
                    <div className="bg-white border-2 border-black shadow-[8px_8px_0px_0px_#000] flex flex-col md:flex-row items-stretch">
                        <div className="p-6 bg-[#FF6B6B] border-b-2 md:border-b-0 md:border-r-2 border-black flex items-center justify-center min-w-[100px]">
                            <Activity className="w-10 h-10 text-black" />
                        </div>
                        <div className="p-6 flex-1 flex flex-col md:flex-row items-center justify-between gap-6">
                            <div className="text-center md:text-left">
                                <h2 className="text-4xl font-black text-black uppercase tracking-tighter leading-none mb-2">
                                    SEO COMMANDER
                                </h2>
                                <span className="inline-block bg-yellow-300 text-black text-xs font-bold px-3 py-1 border border-black uppercase tracking-wider shadow-[2px_2px_0px_0px_#000]">
                                    Unified Intelligence & Audit System
                                </span>
                            </div>

                            <div className="flex items-center gap-4 w-full md:w-auto">
                                <div className="relative flex-1 md:w-64">
                                    <div className="relative flex items-center border-2 border-black bg-white h-12 px-4 shadow-[4px_4px_0px_0px_#000] focus-within:translate-x-[2px] focus-within:translate-y-[2px] focus-within:shadow-none transition-all group">
                                        <Zap className="w-4 h-4 text-orange-500 mr-2 pointer-events-none z-10" />
                                        <select
                                            value={selectedHistoryId}
                                            onChange={(e) => handleHistorySelect(e.target.value)}
                                            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-20"
                                        >
                                            <option value="live">New Analysis</option>
                                            <optgroup label="Previous Reports">
                                                {projectHistory.map((h) => (
                                                    <option key={h.id} value={h.id}>
                                                        {formatDate(h.timestamp)}
                                                    </option>
                                                ))}
                                            </optgroup>
                                        </select>
                                        <span className="font-bold text-sm uppercase truncate pr-6 pointer-events-none z-10 select-none">
                                            {selectedHistoryId === 'live'
                                                ? 'New Analysis'
                                                : selectedHistory
                                                    ? formatDate(selectedHistory.timestamp)
                                                    : 'Select Report'
                                            }
                                        </span>
                                        <div className="ml-auto pointer-events-none z-10">
                                            <History className="w-4 h-4 text-slate-400" />
                                        </div>
                                    </div>
                                </div>
                                {data && (
                                    <button
                                        onClick={exportSummary}
                                        className="h-12 border-2 border-black bg-white px-5 text-sm font-black uppercase tracking-wider text-black shadow-[4px_4px_0px_0px_#000] transition-all hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-none flex items-center gap-2 whitespace-nowrap"
                                    >
                                        <Download className="w-4 h-4" />
                                        Export CSV
                                    </button>
                                )}
                                <button
                                    onClick={runAnalysis}
                                    disabled={loading}
                                    className="h-12 px-8 bg-black text-white text-sm font-black uppercase tracking-wider border-2 border-black shadow-[4px_4px_0px_0px_#888] hover:bg-slate-800 active:translate-x-[2px] active:translate-y-[2px] active:shadow-none transition-all disabled:opacity-50 disabled:pointer-events-none flex items-center gap-2 whitespace-nowrap"
                                >
                                    {loading ? (
                                        <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                                    ) : (
                                        <Activity className="w-4 h-4" />
                                    )}
                                    {loading ? 'Running...' : 'UPDATE TRAFFIC'}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {activeTab === 'dashboard' && data && (
                <main className="max-w-7xl mx-auto p-6 space-y-8 animate-in fade-in slide-in-from-bottom-8 duration-700">

                    {/* Alerts User Banner */}
                    {data.health.alerts && data.health.alerts.length > 0 && (
                        <motion.div
                            initial={{ opacity: 0, y: -10 }}
                            animate={{ opacity: 1, y: 0 }}
                            className="bg-yellow-100 border-2 border-black p-4 flex items-start gap-4 shadow-[4px_4px_0px_0px_#000]"
                        >
                            <div className="p-1 bg-black text-white shrink-0">
                                <AlertCircle className="w-5 h-5" />
                            </div>
                            <div>
                                <h3 className="text-lg font-black text-black uppercase mb-1">Optimization Required</h3>
                                <div className="flex flex-wrap gap-2 pt-1">
                                    {data.health.alerts.map((alert, i) => (
                                        <span key={i} className="text-sm bg-white border border-black text-black px-2 py-1 font-bold">
                                            !!! {alert}
                                        </span>
                                    ))}
                                </div>
                            </div>
                        </motion.div>
                    )}

                    {comparisonMetrics.length > 0 && (
                        <div className="grid gap-4 md:grid-cols-3">
                            {comparisonMetrics.map((item) => (
                                <div key={item.label} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">{item.label}</p>
                                    <p className="mt-2 text-3xl font-black text-slate-900">{item.current}</p>
                                    <p className={`mt-2 text-sm font-semibold ${item.delta === 0 ? 'text-slate-400' : item.delta > 0 ? 'text-emerald-600' : 'text-rose-600'}`}> 
                                        {item.delta === 0 ? 'No change vs previous' : `${item.delta > 0 ? '+' : ''}${item.delta.toFixed(2).replace(/\.00$/, '')} vs previous`}
                                    </p>
                                </div>
                            ))}
                        </div>
                    )}


                    {/* Hero Section: GSC Metrics & Technical Health */}
                    <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
                        {/* Left: Health Gauge (Swapped from Audit) */}
                        <div className="lg:col-span-4 h-full">
                            {latestAudit ? (
                                <HealthGauge results={latestAudit.results} />
                            ) : (
                                <div className="h-full bg-white border-2 border-black p-8 shadow-[8px_8px_0px_0px_#000] flex flex-col items-center justify-center text-center">
                                    <AlertCircle className="w-12 h-12 text-slate-300 mb-4" />
                                    <h3 className="text-xl font-black uppercase text-slate-400">No Audit Data</h3>
                                    <p className="text-sm text-slate-500 font-bold mt-2">Run a "Deep Audit" to see health score.</p>
                                </div>
                            )}
                        </div>

                        {/* Right: Traffic Metrics Grid */}
                        <div className="lg:col-span-8 bg-white border-2 border-black p-8 shadow-[8px_8px_0px_0px_#000]">
                            <div className="grid grid-cols-2 lg:grid-cols-4 gap-x-8 gap-y-12">
                                {[
                                    { label: 'Total Clicks', value: data.metrics.clicks, sub: 'Organic', color: 'bg-blue-200' },
                                    { label: 'Impressions', value: data.metrics.impressions, sub: 'Visibility', color: 'bg-indigo-200' },
                                    { label: 'Avg CTR', value: data.metrics.ctr, sub: 'Click Rate', color: 'bg-teal-200' },
                                    { label: 'Avg Position', value: data.metrics.avgPosition, sub: 'Ranking', color: 'bg-purple-200' },
                                    { label: 'Avg Session', value: data.metrics.avgSessionDuration, sub: 'Time', color: 'bg-amber-200' },
                                    { label: 'Engagement', value: data.metrics.engagementRate, sub: 'Active', color: 'bg-rose-200' },
                                    { label: 'Visibility', value: data.metrics.visibility, sub: 'Index', color: 'bg-sky-200' }
                                ].map((m, i) => (
                                    <div key={i} className="flex flex-col gap-2 group hover:translate-x-1 hover:translate-y-1 transition-transform">
                                        <div className="flex items-center justify-between">
                                            <span className="text-xs font-black uppercase text-slate-500 tracking-wider bg-slate-100 px-1">{m.label}</span>
                                            <div className={`w-3 h-3 border border-black ${m.color}`}></div>
                                        </div>
                                        <span className="text-4xl font-mono font-bold text-black tracking-tighter">{m.value}</span>
                                        <span className="text-[10px] font-bold uppercase text-black border border-black w-fit px-1 bg-white shadow-[2px_2px_0px_0px_#000]">{m.sub}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>


                    {/* Speed & Technical Sections (Merged) */}
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                        {/* 1. Crawl Status */}
                        <div className="h-full">
                            {latestAudit ? (
                                <CrawlStatus results={latestAudit.results} />
                            ) : (
                                <div className="h-full bg-slate-100 border-2 border-black p-8 flex items-center justify-center font-bold text-slate-400 uppercase">
                                    Crawl Data Missing
                                </div>
                            )}
                        </div>

                        {/* 2. Performance Trend (From Audit) */}
                        <div className="h-full">
                            {latestAudit ? (
                                <PerformanceSummary results={latestAudit.results} history={projectAuditHistory.map(h => ({ timestamp: h.timestamp, results: h.results }))} />
                            ) : (
                                <div className="h-full bg-black border-2 border-black p-8 flex items-center justify-center font-bold text-slate-600 uppercase">
                                    Perf Data Missing
                                </div>
                            )}
                        </div>

                        {/* 3. Issues List (GSC) - Adjusted to fit 3rd column */}
                        <div className="bg-white border-2 border-black p-6 shadow-[8px_8px_0px_0px_#000] flex flex-col justify-between">
                            <div>
                                <div className="flex items-center gap-2 mb-4 border-b-2 border-black/10 pb-4">
                                    <div className="p-2 bg-[#FF6B6B] border-2 border-black">
                                        <AlertCircle className="w-5 h-5 text-black" />
                                    </div>
                                    <h3 className="text-xl font-black text-black uppercase">GSC Issues</h3>
                                </div>

                                {/* Indexing Errors */}
                                <div className="space-y-4">
                                    {/* Indexing Errors */}
                                    <div className="space-y-4">
                                        <div
                                            className={cn(
                                                "flex items-center justify-between p-3 bg-red-50 border-2 border-black shadow-[4px_4px_0px_0px_#000] transition-transform",
                                                data.issues.failedUrls?.length ? "hover:translate-x-1 hover:bg-red-100" : ""
                                            )}
                                        >
                                            <div className="flex flex-col">
                                                <span className="text-sm font-bold text-black uppercase">Indexing</span>
                                                <span className="text-xs text-slate-600">Errors</span>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                {data.issues.failedUrls && data.issues.failedUrls.length > 0 && (
                                                    <span className="text-[10px] font-bold bg-white px-1 border border-black hidden group-hover:block">VIEW</span>
                                                )}
                                                <span className="text-2xl font-black text-black">{data.issues.errors}</span>
                                            </div>
                                        </div>

                                        {/* Warnings */}
                                        <div className="flex items-center justify-between p-3 bg-orange-50 border-2 border-black shadow-[4px_4px_0px_0px_#000] hover:translate-x-1 transition-transform">
                                            <div className="flex flex-col">
                                                <span className="text-sm font-bold text-black uppercase">Warnings</span>
                                                <span className="text-xs text-slate-600">Partial</span>
                                            </div>
                                            <span className="text-2xl font-black text-black">{data.issues.indexingWarnings}</span>
                                        </div>

                                        {/* Detailed List (Collapsible / If Few) */}
                                        {data.issues.failedUrls && data.issues.failedUrls.length > 0 && (
                                            <div className="mt-2 text-[10px] font-mono bg-black text-red-400 p-2 border-2 border-black overflow-x-auto">
                                                {data.issues.failedUrls.map((err, idx) => (
                                                    <div key={idx} className="mb-1 last:mb-0">
                                                        <span className="text-white font-bold">[{err.reason}]</span> {getUrlPathLabel(err.url)}
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                </div>
                                <div className="mt-4 pt-4 border-t-2 border-black text-center text-xs font-bold uppercase text-slate-500">
                                    Google Search Console Data
                                </div>
                            </div>
                        </div>
                    </div>


                    {/* Top Content Row */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                        {/* Top Performing Pages (GSC) */}
                        <div className="bg-white border-2 border-black p-6 shadow-[8px_8px_0px_0px_#000] flex flex-col">
                            <div className="flex items-center gap-2 mb-6 border-b-2 border-black/10 pb-4">
                                <div className="p-2 bg-blue-300 border-2 border-black">
                                    <Globe className="w-5 h-5 text-black" />
                                </div>
                                <h3 className="text-xl font-black text-black uppercase">Top Traffic Pages</h3>
                            </div>

                            <div className="flex-1 overflow-y-auto space-y-4 pr-2 custom-scrollbar">

                                {data.pages.top ? (
                                    Array.isArray(data.pages.top) ? (
                                        data.pages.top.map((page, i) => (
                                            <div key={i} className="group p-4 bg-gray-50 border-2 border-black hover:bg-white hover:shadow-[4px_4px_0px_0px_#000] transition-all flex items-center justify-between">
                                                <div className="flex-1 min-w-0 pr-4">
                                                    <a href={page.url} target="_blank" rel="noreferrer" className="block text-sm font-bold text-black truncate hover:underline font-mono">
                                                        {(() => { try { return new URL(page.url).pathname; } catch { return '/'; } })()}
                                                    </a>
                                                    <span className="text-[10px] text-black font-bold uppercase bg-yellow-200 px-1.5 py-0.5 border border-black mt-2 inline-block shadow-[2px_2px_0px_0px_#000]">
                                                        {page.impressions} imp | {page.clicks} clicks
                                                    </span>
                                                </div>
                                                <button
                                                    onClick={() => void handleRequestIndexing(page.url)}
                                                    className="opacity-0 group-hover:opacity-100 transition-all p-2 bg-black text-white hover:bg-gray-800" title="Request Indexing"
                                                >
                                                    <Zap className="w-4 h-4" />
                                                </button>
                                            </div>
                                        ))
                                    ) : (
                                        // Legacy String Support
                                        data.pages.top.split(/ \| (?=http)/).map((page, i) => {
                                            const match = page.match(/^(https?:\/\/[^\s]+)\s\((.*)\)$/);
                                            const url = match ? match[1] : page.split(' ')[0];
                                            const metrics = match ? match[2] : '';
                                            return (
                                                <div key={i} className="group p-4 bg-gray-50 border-2 border-black hover:bg-white hover:shadow-[4px_4px_0px_0px_#000] transition-all flex items-center justify-between">
                                                    <div className="flex-1 min-w-0 pr-4">
                                                        <a href={url} target="_blank" rel="noreferrer" className="block text-sm font-bold text-black truncate hover:underline font-mono">
                                                            {(() => { try { return new URL(url).pathname; } catch { return '/'; } })()}
                                                        </a>
                                                        <span className="text-[10px] text-black font-bold uppercase bg-yellow-200 px-1.5 py-0.5 border border-black mt-2 inline-block shadow-[2px_2px_0px_0px_#000]">{metrics}</span>
                                                    </div>
                                                    <button
                                                        onClick={() => void handleRequestIndexing(url)}
                                                        className="opacity-0 group-hover:opacity-100 transition-all p-2 bg-black text-white hover:bg-gray-800" title="Request Indexing"
                                                    >
                                                        <Zap className="w-4 h-4" />
                                                    </button>
                                                </div>
                                            );
                                        })
                                    )
                                ) : (
                                    <div className="text-center text-slate-400 py-10 font-bold uppercase">No pages found</div>
                                )}

                            </div>
                        </div>

                        {/* Keyword Tracker (Now Active) */}
                        <div className="bg-white border-2 border-black p-6 shadow-[8px_8px_0px_0px_#000] flex flex-col">
                            <div className="flex items-center gap-2 mb-6 border-b-2 border-black/10 pb-4">
                                <div className="p-2 bg-purple-300 border-2 border-black">
                                    <Globe className="w-5 h-5 text-black" />
                                </div>
                                <h3 className="text-xl font-black text-black uppercase">Start Keywords</h3>
                            </div>

                            <div className="flex-1 overflow-y-auto space-y-4 pr-2 custom-scrollbar">
                                {data.keywords?.top ? (
                                    Array.isArray(data.keywords.top) ? (
                                        data.keywords.top.map((kw, i) => (
                                            <div key={i} className="group p-4 bg-gray-50 border-2 border-black hover:bg-white hover:shadow-[4px_4px_0px_0px_#000] transition-all flex items-center justify-between">
                                                <div className="flex-1 min-w-0 pr-4">
                                                    <span className="block text-sm font-bold text-black truncate font-mono uppercase">
                                                        {kw.keyword}
                                                    </span>
                                                    <span className="text-[10px] text-black font-bold uppercase bg-purple-200 px-1.5 py-0.5 border border-black mt-2 inline-block shadow-[2px_2px_0px_0px_#000]">
                                                        {kw.impressions} imp | {kw.clicks} clicks
                                                    </span>
                                                </div>
                                            </div>
                                        ))
                                    ) : (
                                        // Legacy Support
                                        <div className="text-sm font-mono p-4 bg-slate-100 border-2 border-black">
                                            {data.keywords.top}
                                        </div>
                                    )
                                ) : (
                                    <div className="text-center text-slate-400 py-10 font-bold uppercase">No data found</div>
                                )}
                            </div>
                        </div>
                    </div>


                </main>
            )}
        </div>
    );
}









