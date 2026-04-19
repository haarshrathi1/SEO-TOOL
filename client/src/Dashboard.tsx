import { useEffect, useMemo, useState } from 'react';
import {
    Activity,
    AlertCircle,
    Download,
    FolderCog,
    Globe,
    History,
    Layout,
    Loader2,
    RefreshCw,
    Zap,
} from 'lucide-react';
import { motion } from 'framer-motion';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import Audit from './Audit';
import { isProjectReady } from './projectSetup';
import type { AnalysisData, Project, HistoryItem, AuditResult, AuthUser } from './types';
import { api } from './api';
import { canAccessAudit, canAccessDashboard, canAccessKeywords } from './appNav';
import { getUrlPathLabel } from './url';
import HealthGauge from './components/dashboard/HealthGauge';
import CrawlStatus from './components/dashboard/CrawlStatus';
import PerformanceSummary from './components/dashboard/PerformanceSummary';
import { downloadCsv } from './csv';
import { useRouter } from './router';
import { useToast } from './toast';
import { OperatorStatePanel } from './components/common/OperatorUi';
import { OperatorComparisonCard, OperatorMetricTile } from './components/common/OperatorStats';

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

function formatSurfaceLoadError(e: unknown, fallback: string) {
    if (e instanceof Error && e.message) {
        if (import.meta.env.DEV && e.message === 'Access Denied') {
            return 'Signed in as viewer. Enable DEV_ADMIN_BYPASS=true in server/.env or sign in with ADMIN_EMAIL.';
        }

        return e.message;
    }

    return fallback;
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

function sortByTimestampDesc<T extends { timestamp: string }>(items: T[]) {
    return [...items].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
}

function formatSnapshotLabel(timestamp?: string | null) {
    if (!timestamp) {
        return 'Snapshot unavailable';
    }

    return new Date(timestamp).toLocaleString();
}

interface AuditHistoryItem {
    id: string;
    timestamp: string;
    projectId: string;
    results: AuditResult[];
}

interface DashboardProps {
    user: AuthUser;
}

export default function Dashboard({ user }: DashboardProps) {
    const { navigate } = useRouter();
    const { push } = useToast();
    const canViewDashboard = canAccessDashboard(user);
    const canViewAudit = canAccessAudit(user);
    const canViewKeywords = canAccessKeywords(user);
    const canRunDashboardActions = canViewDashboard;
    const canRequestIndexing = user.role === 'admin';
    const [projects, setProjects] = useState<Project[]>([]);
    const [selectedProjectId, setSelectedProjectId] = useState<string>('');
    const [viewerGoogleConnected, setViewerGoogleConnected] = useState<boolean>(user.role === 'admin');

    const [data, setData] = useState<AnalysisData | null>(null);
    const [loading, setLoading] = useState(false);
    const [projectsLoading, setProjectsLoading] = useState(true);
    const [projectDataLoading, setProjectDataLoading] = useState(false);
    const [error, setError] = useState('');
    const [projectsError, setProjectsError] = useState('');
    const [projectDataError, setProjectDataError] = useState('');
    const [projectsRetryKey, setProjectsRetryKey] = useState(0);
    const [projectSurfaceRetryKey, setProjectSurfaceRetryKey] = useState(0);
    const [activeTab, setActiveTab] = useState<'dashboard' | 'audit'>(canViewDashboard ? 'dashboard' : 'audit');
    const [history, setHistory] = useState<HistoryItem[]>([]);
    const [historyHasMore, setHistoryHasMore] = useState(false);
    const [historyNextBefore, setHistoryNextBefore] = useState<string | null>(null);
    const [selectedHistoryId, setSelectedHistoryId] = useState<string>('live');
    const [liveHistoryId, setLiveHistoryId] = useState<string>('');
    const [auditHistory, setAuditHistory] = useState<AuditHistoryItem[]>([]);

    useEffect(() => {
        if (activeTab === 'dashboard' && !canViewDashboard && canViewAudit) {
            setActiveTab('audit');
        }
        if (activeTab === 'audit' && !canViewAudit && canViewDashboard) {
            setActiveTab('dashboard');
        }
    }, [activeTab, canViewAudit, canViewDashboard]);

    useEffect(() => {
        let cancelled = false;

        const init = async () => {
            setProjectsLoading(true);
            setProjectsError('');

            try {
                const [nextProjects, nextConnection] = await Promise.all([
                    api.getProjects(),
                    user.role === 'viewer' ? api.getGoogleConnectionStatus().catch(() => ({ connected: false })) : Promise.resolve({ connected: true }),
                ]);
                if (cancelled) {
                    return;
                }

                const googleConnected = Boolean(nextConnection?.connected);
                const nextReadyProjects = nextProjects.filter((project) => isProjectReady(project, {
                    requiresGoogleConnection: user.role === 'viewer',
                    googleConnected,
                }));

                setProjects(nextProjects);
                setViewerGoogleConnected(googleConnected);
                setSelectedProjectId((current) => {
                    if (current && nextReadyProjects.some((project) => project.id === current)) {
                        return current;
                    }
                    return nextReadyProjects[0]?.id || '';
                });
            } catch (e) {
                if (cancelled) {
                    return;
                }

                console.error('Initialization failed', e);
                setProjects([]);
                setViewerGoogleConnected(user.role === 'admin');
                setSelectedProjectId('');
                setHistory([]);
                setHistoryHasMore(false);
                setHistoryNextBefore(null);
                setAuditHistory([]);
                setData(null);
                setSelectedHistoryId('live');
                setLiveHistoryId('');
                setProjectsError(formatSurfaceLoadError(e, 'Failed to load projects.'));
            } finally {
                if (!cancelled) {
                    setProjectsLoading(false);
                }
            }
        };

        void init();

        return () => {
            cancelled = true;
        };
    }, [projectsRetryKey, user.role]);

    useEffect(() => {
        if (!selectedProjectId) {
            setHistory([]);
            setHistoryHasMore(false);
            setHistoryNextBefore(null);
            setAuditHistory([]);
            setData(null);
            setError('');
            setSelectedHistoryId('live');
            setLiveHistoryId('');
            setProjectDataError('');
            setProjectDataLoading(false);
            return;
        }

        let cancelled = false;

        const loadProjectSurface = async () => {
            setProjectDataLoading(true);
            setProjectDataError('');

            try {
                const [historyData, auditData] = await Promise.all([
                    canViewDashboard ? api.getHistory(selectedProjectId, { limit: 25 }) : Promise.resolve(null),
                    canViewAudit ? api.getAuditHistory(selectedProjectId, { limit: 25 }) : Promise.resolve(null),
                ]);

                if (cancelled) {
                    return;
                }

                const nextHistory = sortByTimestampDesc(historyData?.items || []);
                const nextAuditHistory = sortByTimestampDesc(auditData?.items || []);

                setHistory(nextHistory);
                setHistoryHasMore(Boolean(historyData?.hasMore));
                setHistoryNextBefore(historyData?.nextBefore || null);
                setAuditHistory(nextAuditHistory);

                if (canViewDashboard) {
                    const latestHistory = nextHistory[0] || null;
                    setLiveHistoryId(latestHistory?.id || '');
                    if (latestHistory) {
                        setSelectedHistoryId(latestHistory.id);
                        setData(latestHistory.data);
                        setError('');
                    } else {
                        setSelectedHistoryId('live');
                        setData(null);
                    }
                } else {
                    setSelectedHistoryId('live');
                    setData(null);
                }
            } catch (e) {
                if (cancelled) {
                    return;
                }

                console.error('Failed to load project surface', e);
                setHistory([]);
                setHistoryHasMore(false);
                setHistoryNextBefore(null);
                setAuditHistory([]);
                setSelectedHistoryId('live');
                setLiveHistoryId('');
                setProjectDataError(formatSurfaceLoadError(e, 'Failed to load saved project data.'));
                if (canViewDashboard) {
                    setData(null);
                }
            } finally {
                if (!cancelled) {
                    setProjectDataLoading(false);
                }
            }
        };

        void loadProjectSurface();

        return () => {
            cancelled = true;
        };
    }, [selectedProjectId, canViewAudit, canViewDashboard, projectSurfaceRetryKey]);

    const fetchHistory = async (projectId?: string, options: { append?: boolean; before?: string | null } = {}) => {
        if (!canViewDashboard || !projectId) {
            setHistory([]);
            setHistoryHasMore(false);
            setHistoryNextBefore(null);
            setLiveHistoryId('');
            return;
        }

        try {
            const response = await api.getHistory(projectId, { before: options.before, limit: 25 });
            const nextHistory = sortByTimestampDesc(response.items);
            setHistory((current) => {
                if (!options.append) {
                    return nextHistory;
                }

                const seen = new Set(current.map((item) => item.id));
                return [...current, ...nextHistory.filter((item) => !seen.has(item.id))];
            });
            setHistoryHasMore(response.hasMore);
            setHistoryNextBefore(response.nextBefore);
            return nextHistory;
        } catch (e) {
            console.error('Failed to fetch history', e);
            return [];
        }
    };

    const loadMoreDashboardHistory = async () => {
        if (!selectedProjectId || !historyHasMore || !historyNextBefore) {
            return;
        }

        await fetchHistory(selectedProjectId, {
            append: true,
            before: historyNextBefore,
        });
    };

    const runAnalysis = async () => {
        if (!selectedProjectId || !canRunDashboardActions) return;
        setLoading(true);
        setError('');
        try {
            const json = await api.analyzeSite(selectedProjectId);
            setData(json);
            setSelectedHistoryId('live');
            setLiveHistoryId(json.analysisHistoryId || '');
            const nextHistory = await fetchHistory(selectedProjectId);
            if (!json.analysisHistoryId && nextHistory?.length) {
                setLiveHistoryId(nextHistory[0].id);
            }
        } catch (e) {
            setError(formatDashboardError(e));
        } finally {
            setLoading(false);
        }
    };

    const handleHistorySelect = (id: string) => {
        setSelectedHistoryId(id);
        if (id === 'live') {
            setError('');
            if (canRunDashboardActions) {
                setLiveHistoryId('');
                setData(null);
            } else {
                setLiveHistoryId(history[0]?.id || '');
                setData(history[0]?.data || null);
            }
            return;
        }
        const item = history.find((entry) => entry.id === id);
        if (item) {
            setData(item.data);
            setError('');
        }
    };

    const sortedProjectHistory = sortByTimestampDesc(history);
    const selectedHistoryIndex = selectedHistoryId === 'live'
        ? -1
        : sortedProjectHistory.findIndex((item) => item.id === selectedHistoryId);
    const selectedHistory = selectedHistoryIndex >= 0 ? sortedProjectHistory[selectedHistoryIndex] : null;
    const liveHistoryIndex = liveHistoryId
        ? sortedProjectHistory.findIndex((item) => item.id === liveHistoryId)
        : -1;
    const previousSnapshot = selectedHistoryId === 'live'
        ? liveHistoryIndex >= 0
            ? sortedProjectHistory[liveHistoryIndex + 1] || null
            : null
        : selectedHistoryIndex >= 0
            ? sortedProjectHistory[selectedHistoryIndex + 1] || null
            : null;

    const projectAuditHistory = auditHistory;
    const latestAudit = projectAuditHistory[0] || null;
    const readyProjects = useMemo(
        () => projects.filter((project) => isProjectReady(project, {
            requiresGoogleConnection: user.role === 'viewer',
            googleConnected: viewerGoogleConnected,
        })),
        [projects, user.role, viewerGoogleConnected]
    );
    const incompleteProjects = useMemo(
        () => projects.filter((project) => !isProjectReady(project, {
            requiresGoogleConnection: user.role === 'viewer',
            googleConnected: viewerGoogleConnected,
        })),
        [projects, user.role, viewerGoogleConnected]
    );
    const selectedProject = readyProjects.find((project) => project.id === selectedProjectId) || null;
    const showDashboardBootstrapLoading = activeTab === 'dashboard' && projectsLoading;
    const showDashboardProjectsError = activeTab === 'dashboard' && !projectsLoading && Boolean(projectsError);
    const showDashboardNoProject = activeTab === 'dashboard' && !projectsLoading && !projectsError && !selectedProject && incompleteProjects.length === 0;
    const showDashboardSetupRequired = activeTab === 'dashboard' && !projectsLoading && !projectsError && !selectedProject && incompleteProjects.length > 0;
    const showDashboardProjectLoading = activeTab === 'dashboard' && !projectsLoading && projectDataLoading && Boolean(selectedProject) && !data;
    const showDashboardProjectError = activeTab === 'dashboard' && !projectsLoading && !projectDataLoading && Boolean(selectedProject) && Boolean(projectDataError);
    const showDashboardEmpty = activeTab === 'dashboard' && !projectsLoading && !projectDataLoading && !projectsError && !projectDataError && Boolean(selectedProject) && !data;
    const showAuditBootstrapLoading = activeTab === 'audit' && projectsLoading;
    const showAuditProjectsError = activeTab === 'audit' && !projectsLoading && Boolean(projectsError);
    const showAuditNoProject = activeTab === 'audit' && !projectsLoading && !projectsError && !selectedProject && incompleteProjects.length === 0;
    const showAuditSetupRequired = activeTab === 'audit' && !projectsLoading && !projectsError && !selectedProject && incompleteProjects.length > 0;

    const comparisonMetrics = useMemo(
        () => (data && previousSnapshot ? buildComparison(data, previousSnapshot.data) : []),
        [data, previousSnapshot],
    );

    const formatDate = (iso: string) => new Date(iso).toLocaleString();
    const liveOptionLabel = canRunDashboardActions
        ? (data ? 'Live Analysis' : 'New Analysis')
        : 'Latest Snapshot';
    const currentSnapshotLabel = selectedHistoryId === 'live'
        ? (data ? 'Live analysis loaded' : 'Awaiting live analysis')
        : selectedHistory
            ? `Snapshot from ${formatSnapshotLabel(selectedHistory.timestamp)}`
            : 'Saved snapshot';
    const comparisonSnapshotLabel = previousSnapshot
        ? formatSnapshotLabel(previousSnapshot.timestamp)
        : 'No previous snapshot available';
    const inspectedUrls = data?.issues.inspectedUrls;
    const totalSitemapUrls = data?.issues.totalSitemapUrls;
    const hasCoverageData = typeof inspectedUrls === 'number' && typeof totalSitemapUrls === 'number';
    const isFullCoverage = hasCoverageData && inspectedUrls === totalSitemapUrls;
    const coverageLabel = hasCoverageData
        ? isFullCoverage
            ? `Full sitemap coverage (${inspectedUrls}/${totalSitemapUrls})`
            : `Sampled sitemap coverage (${inspectedUrls}/${totalSitemapUrls})`
        : 'Coverage unavailable';
    const dashboardEmptyTitle = canRunDashboardActions ? 'Run a fresh analysis' : 'No saved snapshot yet';
    const dashboardEmptyDescription = canRunDashboardActions
        ? sortedProjectHistory.length > 0
            ? 'Choose a saved report from history or run a fresh analysis to refresh this project.'
            : 'This project does not have a saved dashboard snapshot yet. Run the first analysis to populate it.'
        : 'This project does not have a saved dashboard snapshot yet. Connect Google on the Projects page, then run the first analysis.';

    const handleRequestIndexing = async (url: string) => {
        if (!canRequestIndexing) {
            push({ tone: 'error', title: 'Admin access required', description: 'Only admins can request indexing.' });
            return;
        }

        try {
            await api.requestIndexing(url);
            push({ tone: 'success', title: 'Indexing requested', description: url });
        } catch (issue) {
            push({ tone: 'error', title: 'Indexing request failed', description: issue instanceof Error ? issue.message : 'Unknown error' });
        }
    };

    const surfaceTabs: Array<{ id: 'dashboard' | 'audit' | 'keywords'; label: string; icon: typeof Layout }> = [];
    if (canViewDashboard) {
        surfaceTabs.push({ id: 'dashboard', label: 'Command Center', icon: Layout });
    }
    if (canViewAudit) {
        surfaceTabs.push({ id: 'audit', label: 'Deep Audit', icon: Zap });
    }
    if (canViewKeywords) {
        surfaceTabs.push({ id: 'keywords', label: 'Keywords', icon: Globe });
    }

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
        <div className="operator-shell text-slate-900 font-sans selection:bg-black selection:text-white pb-20">
            {/* Brutalist Header */}
            <header className="sticky top-0 z-50 border-b-2 border-black bg-white">
                {/* Top bar: brand + project selector */}
                <div className="border-b-2 border-black/10">
                    <div className="max-w-7xl mx-auto px-6 py-3 flex items-center justify-between gap-4">
                        {/* Brand mark */}
                        <div className="flex items-center gap-3 min-w-0">
                            <div className="p-2 bg-black border-2 border-black shrink-0">
                                <Activity className="w-5 h-5 text-white" />
                            </div>
                            <div className="min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                    <span className="text-base font-black uppercase tracking-tight text-black truncate">
                                        {data?.project || selectedProject?.name || 'SEO Intel'}
                                    </span>
                                    {selectedHistoryId !== 'live' && (
                                        <span className="border border-black bg-yellow-300 px-2 py-0.5 text-[9px] font-black uppercase shrink-0">
                                            Historical
                                        </span>
                                    )}
                                    {(projectDataLoading || projectsLoading) && (
                                        <Loader2 className="w-3.5 h-3.5 animate-spin text-slate-400 shrink-0" />
                                    )}
                                </div>
                                <p className="text-[10px] font-mono font-bold text-slate-400 uppercase truncate">
                                    {data?.domain || selectedProject?.domain || 'no project selected'}
                                    {data?.week && <span className="ml-2 bg-black text-white px-1">W{data.week}</span>}
                                </p>
                            </div>
                        </div>

                        {/* Project switcher */}
                        {readyProjects.length > 0 && (
                            <div className="relative shrink-0">
                                <select
                                    value={selectedProjectId}
                                    onChange={(e) => {
                                        const nextProjectId = e.target.value;
                                        setSelectedProjectId(nextProjectId);
                                        setError('');
                                        setSelectedHistoryId('live');
                                        setLiveHistoryId('');
                                        setHistory([]);
                                        setAuditHistory([]);
                                        setData(null);
                                    }}
                                    disabled={projectsLoading || projectDataLoading}
                                    className="operator-control appearance-none cursor-pointer py-2 pl-3 pr-9 text-xs font-black uppercase max-w-[14rem]"
                                >
                                    {readyProjects.map(p => (
                                        <option key={p.id} value={p.id}>{p.name}</option>
                                    ))}
                                </select>
                                <Globe className="w-3.5 h-3.5 text-black absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                            </div>
                        )}
                    </div>
                </div>

                {/* Bottom bar: nav tabs */}
                <div className="max-w-7xl mx-auto px-6">
                    <nav className="flex items-center gap-0">
                        {surfaceTabs.map((tab) => (
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
                                    "flex items-center gap-2 px-5 py-3 text-xs font-black uppercase tracking-wide border-r-2 border-black transition-all duration-150",
                                    activeTab === tab.id
                                        ? "bg-black text-white"
                                        : "bg-white text-slate-500 hover:text-black hover:bg-slate-50"
                                )}
                            >
                                <tab.icon className="w-3.5 h-3.5" />
                                {tab.label}
                            </button>
                        ))}
                    </nav>
                </div>
            </header>

            {showAuditBootstrapLoading && (
                <div className="max-w-7xl mx-auto mt-8 px-6">
                    <OperatorStatePanel
                        icon={Loader2}
                        iconClassName="animate-spin"
                        title="Loading projects..."
                        titleAs="p"
                        description="Preparing your audit workspace."
                    />
                </div>
            )}

            {showAuditProjectsError && (
                <div className="max-w-7xl mx-auto mt-8 px-6">
                    <OperatorStatePanel
                        icon={AlertCircle}
                        title="Could not load projects"
                        description={projectsError}
                        variant="warm"
                        action={(
                            <button
                                onClick={() => setProjectsRetryKey((current) => current + 1)}
                                className="operator-button-primary px-4 py-2"
                            >
                                <RefreshCw className="h-4 w-4" /> Retry
                            </button>
                        )}
                    />
                </div>
            )}

            {showAuditNoProject && (
                <div className="max-w-7xl mx-auto mt-8 px-6">
                    <OperatorStatePanel
                        icon={History}
                        title="No projects available"
                        description="Add a project first to start running audit jobs."
                    />
                </div>
            )}

            {showAuditSetupRequired && (
                <div className="max-w-7xl mx-auto mt-8 px-6">
                    <OperatorStatePanel
                        icon={FolderCog}
                        title="Finish project setup first"
                        description={`You have ${incompleteProjects.length} project${incompleteProjects.length === 1 ? '' : 's'} saved, but they still need Google setup before audit can run.`}
                        action={(
                            <button
                                onClick={() => navigate('/projects')}
                                className="operator-button-primary px-4 py-2"
                            >
                                <FolderCog className="h-4 w-4" /> Open Projects
                            </button>
                        )}
                    />
                </div>
            )}

            {activeTab === 'audit' && selectedProjectId && (
                <main className="max-w-7xl mx-auto mt-8 px-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
                    <Audit key={selectedProjectId} projectId={selectedProjectId} canRunAudit={canViewAudit} canRequestIndexing={canRequestIndexing} />
                </main>
            )}

            {activeTab === 'dashboard' && error && (
                <div className="max-w-7xl mx-auto mt-8 px-6">
                    <div className="p-4 bg-red-100 border-2 border-black flex items-center gap-3" style={{ boxShadow: '4px 4px 0 0 #000' }}>
                        <div className="p-1 bg-black text-white shrink-0">
                            <AlertCircle className="w-4 h-4" />
                        </div>
                        <span className="font-black uppercase text-sm text-black">{error}</span>
                    </div>
                </div>
            )}

            {showDashboardBootstrapLoading && (
                <div className="max-w-7xl mx-auto mt-8 px-6">
                    <OperatorStatePanel
                        icon={Loader2}
                        iconClassName="animate-spin"
                        title="Loading projects..."
                        titleAs="p"
                        description="Preparing your dashboard workspace."
                    />
                </div>
            )}

            {showDashboardProjectsError && (
                <div className="max-w-7xl mx-auto mt-8 px-6">
                    <OperatorStatePanel
                        icon={AlertCircle}
                        title="Could not load projects"
                        description={projectsError}
                        variant="warm"
                        action={(
                            <button
                                onClick={() => setProjectsRetryKey((current) => current + 1)}
                                className="operator-button-primary px-4 py-2"
                            >
                                <RefreshCw className="h-4 w-4" /> Retry
                            </button>
                        )}
                    />
                </div>
            )}

            {showDashboardNoProject && (
                <div className="max-w-7xl mx-auto mt-8 px-6">
                    <OperatorStatePanel
                        icon={History}
                        title="No projects available"
                        description="Add a project first to start loading dashboard and audit snapshots."
                    />
                </div>
            )}

            {showDashboardSetupRequired && (
                <div className="max-w-7xl mx-auto mt-8 px-6">
                    <OperatorStatePanel
                        icon={FolderCog}
                        title="Finish project setup first"
                        description={`You have ${incompleteProjects.length} project${incompleteProjects.length === 1 ? '' : 's'} saved, but they still need Google setup before dashboard analysis can run.`}
                        action={(
                            <button
                                onClick={() => navigate('/projects')}
                                className="operator-button-primary px-4 py-2"
                            >
                                <FolderCog className="h-4 w-4" /> Open Projects
                            </button>
                        )}
                    />
                </div>
            )}

            {showDashboardProjectLoading && (
                <div className="max-w-7xl mx-auto mt-8 px-6">
                    <OperatorStatePanel
                        icon={Loader2}
                        iconClassName="animate-spin"
                        title="Loading project snapshots..."
                        titleAs="p"
                        className="p-4"
                    />
                </div>
            )}

            {showDashboardProjectError && (
                <div className="max-w-7xl mx-auto mt-8 px-6">
                    <OperatorStatePanel
                        icon={AlertCircle}
                        title="Saved data could not be loaded"
                        description={projectDataError}
                        variant="warm"
                        action={(
                            <button
                                onClick={() => setProjectSurfaceRetryKey((current) => current + 1)}
                                className="operator-button-primary px-4 py-2"
                            >
                                <RefreshCw className="h-4 w-4" /> Retry
                            </button>
                        )}
                    />
                </div>
            )}

            {/* Action toolbar — shown when dashboard tab is active and not in a terminal error/empty state */}
            {activeTab === 'dashboard' && !showDashboardBootstrapLoading && !showDashboardProjectsError && !showDashboardNoProject && !showDashboardSetupRequired && (
                <div className="border-b-2 border-black bg-white">
                    <div className="max-w-7xl mx-auto px-6 py-3 flex flex-wrap items-center gap-3">
                        {/* Snapshot label */}
                        <div className="flex items-center gap-2 mr-auto min-w-0">
                            <div className={cn('w-2 h-2 border border-black shrink-0', selectedHistoryId === 'live' ? 'bg-emerald-400' : 'bg-yellow-400')} />
                            <span className="text-[11px] font-black uppercase text-slate-500 truncate">
                                {selectedHistoryId === 'live'
                                    ? (data ? 'Live data loaded' : 'Awaiting analysis')
                                    : selectedHistory
                                        ? `Snapshot · ${formatDate(selectedHistory.timestamp)}`
                                        : 'Saved snapshot'}
                            </span>
                        </div>

                        {/* History selector */}
                        {sortedProjectHistory.length > 0 && (
                            <div className="relative">
                                <select
                                    value={selectedHistoryId}
                                    onChange={(e) => handleHistorySelect(e.target.value)}
                                    disabled={projectDataLoading || !selectedProjectId}
                                    className="operator-control appearance-none cursor-pointer py-2 pl-3 pr-9 text-xs font-black uppercase max-w-[13rem] disabled:cursor-wait"
                                >
                                    <option value="live">{liveOptionLabel}</option>
                                    <optgroup label="Previous Reports">
                                        {sortedProjectHistory.map((h) => (
                                            <option key={h.id} value={h.id}>{formatDate(h.timestamp)}</option>
                                        ))}
                                    </optgroup>
                                </select>
                                <History className="w-3.5 h-3.5 text-black absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                            </div>
                        )}

                        {historyHasMore && (
                            <button
                                onClick={() => void loadMoreDashboardHistory()}
                                disabled={projectDataLoading || !selectedProjectId}
                                className="operator-button-secondary px-4 py-2"
                            >
                                <RefreshCw className="w-3.5 h-3.5" />
                                More
                            </button>
                        )}

                        {data && (
                            <button onClick={exportSummary} className="operator-button-secondary px-4 py-2">
                                <Download className="w-3.5 h-3.5" />
                                Export CSV
                            </button>
                        )}

                        <button
                            onClick={runAnalysis}
                            disabled={loading || !selectedProjectId || projectDataLoading}
                            className="operator-button-primary px-6 py-2"
                        >
                            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Activity className="w-3.5 h-3.5" />}
                            {loading ? 'Running...' : 'Update Traffic'}
                        </button>
                    </div>
                </div>
            )}

            {showDashboardEmpty && (
                <main className="max-w-7xl mx-auto p-6 space-y-8 animate-in fade-in slide-in-from-bottom-8 duration-700">
                    <OperatorStatePanel
                        icon={History}
                        title={dashboardEmptyTitle}
                        description={dashboardEmptyDescription}
                        variant="panel"
                        align="center"
                        action={canRunDashboardActions ? (
                            <button
                                onClick={runAnalysis}
                                disabled={loading || !selectedProjectId}
                                className="operator-button-primary px-5 py-3"
                            >
                                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Activity className="h-4 w-4" />}
                                {loading ? 'Starting...' : 'Run analysis'}
                            </button>
                        ) : undefined}
                    />
                </main>
            )}

            {activeTab === 'dashboard' && data && (
                <main className="max-w-7xl mx-auto p-6 space-y-8 animate-in fade-in slide-in-from-bottom-8 duration-700">
                    <div className="grid gap-4 lg:grid-cols-3">
                        <div className="operator-panel p-5">
                            <div className="mb-3 flex items-center gap-2">
                                <div className="border-2 border-black bg-emerald-200 p-2">
                                    <Activity className="h-4 w-4 text-black" />
                                </div>
                                <div>
                                    <p className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-500">Viewing</p>
                                    <p className="text-base font-black uppercase text-black">{selectedHistoryId === 'live' ? 'Current dataset' : 'Historical dataset'}</p>
                                </div>
                            </div>
                            <p className="text-sm font-bold text-slate-700">{currentSnapshotLabel}</p>
                        </div>
                        <div className="operator-panel p-5">
                            <div className="mb-3 flex items-center gap-2">
                                <div className="border-2 border-black bg-amber-200 p-2">
                                    <History className="h-4 w-4 text-black" />
                                </div>
                                <div>
                                    <p className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-500">Comparing Against</p>
                                    <p className="text-base font-black uppercase text-black">{previousSnapshot ? 'Previous snapshot' : 'Baseline missing'}</p>
                                </div>
                            </div>
                            <p className="text-sm font-bold text-slate-700">{comparisonSnapshotLabel}</p>
                        </div>
                        <div className="operator-panel p-5">
                            <div className="mb-3 flex items-center gap-2">
                                <div className={cn(
                                    'border-2 border-black p-2',
                                    isFullCoverage ? 'bg-sky-200' : 'bg-orange-200',
                                )}>
                                    <Globe className="h-4 w-4 text-black" />
                                </div>
                                <div>
                                    <p className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-500">Sitemap Coverage</p>
                                    <p className="text-base font-black uppercase text-black">{isFullCoverage ? 'Full scan context' : 'Sampling context'}</p>
                                </div>
                            </div>
                            <p className="text-sm font-bold text-slate-700">{coverageLabel}</p>
                        </div>
                    </div>

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
                                <OperatorComparisonCard
                                    key={item.label}
                                    label={item.label}
                                    value={item.current}
                                    deltaTone={item.delta === 0 ? 'neutral' : item.delta > 0 ? 'positive' : 'negative'}
                                    deltaLabel={item.delta === 0 ? 'No change vs previous' : `${item.delta > 0 ? '+' : ''}${item.delta.toFixed(2).replace(/\.00$/, '')} vs previous`}
                                />
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
                                <div className="operator-panel flex h-full flex-col items-center justify-center p-8 text-center">
                                    <AlertCircle className="w-12 h-12 text-slate-300 mb-4" />
                                    <h3 className="text-xl font-black uppercase text-slate-400">No Audit Data</h3>
                                    <p className="text-sm text-slate-500 font-bold mt-2">Run a "Deep Audit" to see health score.</p>
                                </div>
                            )}
                        </div>

                        {/* Right: Traffic Metrics Grid */}
                        <div className="operator-panel lg:col-span-8 p-8">
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
                                    <OperatorMetricTile
                                        key={i}
                                        label={m.label}
                                        value={m.value}
                                        sublabel={m.sub}
                                        accentClassName={m.color}
                                    />
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
                        <div className="operator-panel flex flex-col justify-between p-6">
                            <div>
                                <div className="flex items-center gap-2 mb-4 border-b-2 border-black/10 pb-4">
                                    <div className="p-2 bg-[#FF6B6B] border-2 border-black">
                                        <AlertCircle className="w-5 h-5 text-black" />
                                    </div>
                                    <h3 className="text-xl font-black text-black uppercase">GSC Issues</h3>
                                </div>

                                {/* Indexing Errors */}
                                <div className="space-y-4">
                                    <div className="grid gap-3 sm:grid-cols-2">
                                        <div
                                            className={cn(
                                                'group flex items-center justify-between border-2 border-black bg-red-50 p-3 shadow-[4px_4px_0px_0px_#000] transition-transform',
                                                data.issues.failedUrls?.length ? 'hover:translate-x-1 hover:bg-red-100' : '',
                                            )}
                                        >
                                            <div className="flex flex-col">
                                                <span className="text-sm font-bold text-black uppercase">Indexing</span>
                                                <span className="text-xs text-slate-600">Errors</span>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                {data.issues.failedUrls && data.issues.failedUrls.length > 0 && (
                                                    <span className="hidden border border-black bg-white px-1 text-[10px] font-bold group-hover:block">VIEW</span>
                                                )}
                                                <span className="text-2xl font-black text-black">{data.issues.errors}</span>
                                            </div>
                                        </div>

                                        <div className="flex items-center justify-between border-2 border-black bg-orange-50 p-3 shadow-[4px_4px_0px_0px_#000] transition-transform hover:translate-x-1">
                                            <div className="flex flex-col">
                                                <span className="text-sm font-bold text-black uppercase">Warnings</span>
                                                <span className="text-xs text-slate-600">Partial</span>
                                            </div>
                                            <span className="text-2xl font-black text-black">{data.issues.indexingWarnings}</span>
                                        </div>

                                    </div>
                                    {hasCoverageData && (
                                        <div
                                            className={cn(
                                                'border-2 border-black p-3 text-sm font-bold shadow-[4px_4px_0px_0px_#000]',
                                                isFullCoverage ? 'bg-sky-50 text-slate-800' : 'bg-orange-50 text-slate-800',
                                            )}
                                        >
                                            {isFullCoverage
                                                ? `Issue totals reflect all ${totalSitemapUrls} sitemap URLs discovered for this project.`
                                                : `Issue totals are based on ${inspectedUrls} of ${totalSitemapUrls} sitemap URLs, using the current crawl cap.`}
                                        </div>
                                    )}
                                    {data.issues.failedUrls && data.issues.failedUrls.length > 0 && (
                                        <div className="mt-2 overflow-x-auto border-2 border-black bg-black p-2 text-[10px] font-mono text-red-400">
                                            {data.issues.failedUrls.map((err, idx) => (
                                                <div key={idx} className="mb-1 last:mb-0">
                                                    <span className="font-bold text-white">[{err.reason}]</span> {getUrlPathLabel(err.url)}
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                                <div className="mt-4 border-t-2 border-black pt-4 text-center text-xs font-bold uppercase text-slate-500">
                                    {typeof data.issues.inspectedUrls === 'number' && typeof data.issues.totalSitemapUrls === 'number'
                                        ? `Google Search Console Data - Inspected ${data.issues.inspectedUrls}/${data.issues.totalSitemapUrls} Sitemap URLs`
                                        : 'Google Search Console Data'}
                                </div>
                            </div>
                        </div>
                    </div>


                    {/* Top Content Row */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                        {/* Top Performing Pages (GSC) */}
                        <div className="operator-panel flex flex-col p-6">
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
                                                {canRequestIndexing && (
                                                    <button
                                                        onClick={() => void handleRequestIndexing(page.url)}
                                                        className="opacity-0 group-hover:opacity-100 transition-all p-2 bg-black text-white hover:bg-gray-800"
                                                        title="Request Indexing"
                                                    >
                                                        <Zap className="w-4 h-4" />
                                                    </button>
                                                )}
                                            </div>
                                        ))
                                    ) : (
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
                                                    {canRequestIndexing && (
                                                        <button
                                                            onClick={() => void handleRequestIndexing(url)}
                                                            className="opacity-0 group-hover:opacity-100 transition-all p-2 bg-black text-white hover:bg-gray-800"
                                                            title="Request Indexing"
                                                        >
                                                            <Zap className="w-4 h-4" />
                                                        </button>
                                                    )}
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
                        <div className="operator-panel flex flex-col p-6">
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
















