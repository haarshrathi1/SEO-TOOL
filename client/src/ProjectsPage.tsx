import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    AlertCircle,
    ArrowRight,
    Check,
    CheckCircle2,
    FolderPlus,
    Globe,
    Grid3X3,
    Link2,
    Lock,
    Loader2,
    Pencil,
    Play,
    Plus,
    RefreshCw,
    Save,
    Search,
    Shield,
    Trash2,
    UserPlus,
    Users,
    Zap,
} from 'lucide-react';
import { api } from './api';
import Modal from './components/common/Modal';
import { getProjectSetupIssues, isProjectReady } from './projectSetup';
import { useRouter } from './router';
import { useToast } from './toast';
import type { AuthUser, GoogleConnectionStatus, GoogleResourcesResponse, Project, ViewerRecord } from './types';

const ACCESS_OPTIONS = [
    { id: 'keywords', label: 'Keyword tool', desc: 'AI keyword research & blog briefs' },
    { id: 'dashboard', label: 'Dashboard', desc: 'GSC/GA4 analytics & history' },
    { id: 'audit', label: 'Audit jobs', desc: 'Site crawl & technical SEO audit' },
] as const;

type ProjectFormState = {
    id: string;
    name: string;
    domain: string;
    url: string;
    ownerEmail: string;
    googleConnectionEmail: string;
    gscSiteUrl: string;
    ga4PropertyId: string;
    spreadsheetId: string;
    sheetGid: string;
    auditMaxPages: string;
};

type ViewerFormState = {
    email: string;
    access: string[];
    features: string[];
    projectIds: string[];
};

const EMPTY_CONNECTION: GoogleConnectionStatus = {
    connected: false,
    ownerEmail: '',
    googleEmail: '',
    displayName: '',
    picture: '',
    scope: '',
    connectedAt: null,
    updatedAt: null,
};

const EMPTY_VIEWER_FORM: ViewerFormState = {
    email: '',
    access: ['keywords'],
    features: [],
    projectIds: [],
};

function createProjectForm(user: AuthUser, connectionEmail = ''): ProjectFormState {
    return {
        id: '',
        name: '',
        domain: '',
        url: '',
        ownerEmail: user.role === 'admin' ? '' : user.email,
        googleConnectionEmail: connectionEmail || '',
        gscSiteUrl: '',
        ga4PropertyId: '',
        spreadsheetId: '',
        sheetGid: '0',
        auditMaxPages: '200',
    };
}

function toProjectForm(project: Project): ProjectFormState {
    return {
        id: project.id,
        name: project.name,
        domain: project.domain,
        url: project.url,
        ownerEmail: project.ownerEmail || '',
        googleConnectionEmail: project.googleConnectionEmail || '',
        gscSiteUrl: project.gscSiteUrl || project.url,
        ga4PropertyId: project.ga4PropertyId || '',
        spreadsheetId: project.spreadsheetId || '',
        sheetGid: String(project.sheetGid ?? 0),
        auditMaxPages: String(project.auditMaxPages ?? 200),
    };
}

function canManageProject(project: Project, user: AuthUser) {
    return user.role === 'admin' || project.ownerEmail === user.email;
}

function slugifyProjectId(value: string) {
    return value
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

function Toggle({ checked, label, onClick }: { checked: boolean; label: string; onClick: () => void }) {
    return (
        <button
            type="button"
            onClick={onClick}
            className={`border-2 border-black px-3 py-2 text-xs font-black uppercase tracking-wide transition-all duration-150 ${checked
                    ? 'bg-black text-white shadow-none translate-x-[2px] translate-y-[2px]'
                    : 'bg-white text-black shadow-[3px_3px_0px_0px_#000] hover:translate-x-[1px] hover:translate-y-[1px] hover:shadow-[2px_2px_0px_0px_#000]'
                }`}
        >
            {checked && <span className="mr-1">✓</span>}{label}
        </button>
    );
}

function FieldLabel({ label, hint }: { label: string; hint?: string }) {
    return (
        <div className="mb-1.5">
            <span className="text-[11px] font-black uppercase tracking-[0.15em] text-slate-500">{label}</span>
            {hint && <span className="block text-[10px] text-slate-400 mt-0.5 font-medium">{hint}</span>}
        </div>
    );
}

function Field({
    label,
    hint,
    children,
    fullWidth = false,
}: {
    label: string;
    hint?: string;
    children: React.ReactNode;
    fullWidth?: boolean;
}) {
    return (
        <div className={`space-y-1 ${fullWidth ? 'md:col-span-2' : ''}`}>
            <FieldLabel label={label} hint={hint} />
            {children}
        </div>
    );
}

export default function ProjectsPage({ user }: { user: AuthUser }) {
    const { push } = useToast();
    const { navigate } = useRouter();
    const oauthHandled = useRef(false);

    const [projects, setProjects] = useState<Project[]>([]);
    const [viewers, setViewers] = useState<ViewerRecord[]>([]);
    const [connection, setConnection] = useState<GoogleConnectionStatus>(EMPTY_CONNECTION);
    const [resources, setResources] = useState<GoogleResourcesResponse | null>(null);
    const [loading, setLoading] = useState(true);
    const [googleLoading, setGoogleLoading] = useState(false);
    const [savingProject, setSavingProject] = useState(false);
    const [savingViewer, setSavingViewer] = useState(false);
    const [showProjectModal, setShowProjectModal] = useState(false);
    const [editingProjectId, setEditingProjectId] = useState<string | null>(null);
    const [editingViewerEmail, setEditingViewerEmail] = useState<string | null>(null);
    const [projectPendingDelete, setProjectPendingDelete] = useState<Project | null>(null);
    const [viewerPendingDelete, setViewerPendingDelete] = useState<ViewerRecord | null>(null);
    const [projectForm, setProjectForm] = useState<ProjectFormState>(() => createProjectForm(user));
    const [viewerForm, setViewerForm] = useState<ViewerFormState>(EMPTY_VIEWER_FORM);
    const [adminTab, setAdminTab] = useState<'viewers' | 'matrix'>('viewers');
    const [matrixSaving, setMatrixSaving] = useState<string>('');

    const activeProjects = useMemo(() => projects.filter((project) => project.isActive !== false), [projects]);
    const normalizedDraftProjectId = useMemo(
        () => slugifyProjectId(projectForm.id || projectForm.name),
        [projectForm.id, projectForm.name],
    );
    const duplicateDraftProject = useMemo(
        () => !editingProjectId && normalizedDraftProjectId
            ? activeProjects.find((project) => project.id === normalizedDraftProjectId)
            : null,
        [activeProjects, editingProjectId, normalizedDraftProjectId],
    );

    const fetchData = useCallback(async () => {
        setLoading(true);
        try {
            const tasks: Array<Promise<unknown>> = [
                api.getProjects(user.role === 'admin'),
                api.getGoogleConnectionStatus().catch(() => EMPTY_CONNECTION),
            ];

            if (user.role === 'admin') {
                tasks.push(api.getViewers());
            }

            const [projectData, connectionData, viewerData] = await Promise.all(tasks);
            const nextConnection = connectionData as GoogleConnectionStatus;

            setProjects(projectData as Project[]);
            setConnection(nextConnection);
            setViewers((viewerData as ViewerRecord[]) || []);
            setProjectForm((current) => {
                if (editingProjectId) return current;
                return createProjectForm(user, nextConnection.connected ? (nextConnection.googleEmail || user.email) : '');
            });
        } catch (error) {
            push({ tone: 'error', title: 'Failed to load setup data', description: error instanceof Error ? error.message : 'Unknown error' });
        } finally {
            setLoading(false);
        }
    }, [editingProjectId, push, user]);

    useEffect(() => {
        void fetchData();
    }, [fetchData]);

    useEffect(() => {
        if (oauthHandled.current) return;

        const url = new URL(window.location.href);
        const status = url.searchParams.get('google');
        if (!status) return;

        oauthHandled.current = true;
        push({
            tone: status === 'connected' ? 'success' : 'error',
            title: status === 'connected' ? 'Google connected' : 'Google connection failed',
            description: url.searchParams.get('googleEmail') || url.searchParams.get('message') || undefined,
        });

        url.searchParams.delete('google');
        url.searchParams.delete('googleEmail');
        url.searchParams.delete('message');
        window.history.replaceState({}, '', `${url.pathname}${url.search}`);
        void fetchData();
    }, [fetchData, push]);

    const handleProjectField = (field: keyof ProjectFormState, value: string) => {
        setProjectForm((current) => ({ ...current, [field]: value }));
    };

    const resetProjectForm = () => {
        setEditingProjectId(null);
        setShowProjectModal(false);
        setResources(null);
        setProjectForm(createProjectForm(user, connection.connected ? (connection.googleEmail || user.email) : ''));
    };

    const startEditProject = (project: Project) => {
        setEditingProjectId(project.id);
        setResources(null);
        setProjectForm(toProjectForm(project));
        setShowProjectModal(true);
    };

    // Opens a fresh "New Project" modal while carrying over any GSC/GA4 already
    // selected in the Properties panel (and prefilling Primary URL from the GSC
    // property when it's an https:// site), so the selection is never discarded.
    const openNewProjectModal = () => {
        setEditingProjectId(null);
        setProjectForm((current) => {
            const base = createProjectForm(user, connection.connected ? (connection.googleEmail || user.email) : '');
            const gscSiteUrl = current.gscSiteUrl;
            const ga4PropertyId = current.ga4PropertyId;
            return {
                ...base,
                gscSiteUrl,
                ga4PropertyId,
                url: base.url || (/^https:\/\//i.test(gscSiteUrl) ? gscSiteUrl : ''),
            };
        });
        setShowProjectModal(true);
    };

    const handleConnectGoogle = () => {
        api.connectProjectGoogle(editingProjectId || null);
    };

    const loadResources = async () => {
        if (!connection.connected) {
            push({ tone: 'info', title: 'Connect Google first', description: 'Use the Google account that owns your Search Console and GA4 properties.' });
            return;
        }

        setGoogleLoading(true);
        try {
            const data = await api.getGoogleResources({
                projectId: editingProjectId || null,
                name: projectForm.name,
                domain: projectForm.domain,
                url: projectForm.url,
                gscSiteUrl: projectForm.gscSiteUrl,
                ga4PropertyId: projectForm.ga4PropertyId,
            });
            setResources(data);
            setProjectForm((current) => ({
                ...current,
                googleConnectionEmail: data.connection.googleEmail || current.googleConnectionEmail || user.email,
                gscSiteUrl: current.gscSiteUrl || data.recommendations.gscSiteUrl || '',
                ga4PropertyId: current.ga4PropertyId || data.recommendations.ga4PropertyId || '',
            }));
            push({
                tone: 'success',
                title: 'Google properties loaded',
                description: data.recommendations.gscSiteUrl && data.recommendations.ga4PropertyId
                    ? 'We matched both properties. Review them, then save the project.'
                    : 'We loaded the available properties. Choose the matching property manually before saving.',
            });
        } catch (error) {
            push({ tone: 'error', title: 'Could not load Google properties', description: error instanceof Error ? error.message : 'Unknown error' });
        } finally {
            setGoogleLoading(false);
        }
    };

    const saveProject = async (event: React.FormEvent) => {
        event.preventDefault();
        if (duplicateDraftProject) {
            push({
                tone: 'error',
                title: 'Project ID already exists',
                description: `Edit "${duplicateDraftProject.name}" or use a different Project ID.`,
            });
            return;
        }

        setSavingProject(true);

        try {
            const payload = {
                ...projectForm,
                ownerEmail: user.role === 'admin' ? projectForm.ownerEmail : user.email,
                googleConnectionEmail: projectForm.googleConnectionEmail || (connection.connected ? (connection.googleEmail || user.email) : ''),
                sheetGid: Number(projectForm.sheetGid || 0),
                auditMaxPages: Number(projectForm.auditMaxPages || 200),
            };
            const nextSetupIssues = getProjectSetupIssues({
                googleConnectionEmail: payload.googleConnectionEmail,
                gscSiteUrl: payload.gscSiteUrl,
                ga4PropertyId: payload.ga4PropertyId,
            }, {
                requiresGoogleConnection: user.role === 'viewer',
                googleConnected: connection.connected,
            });

            if (editingProjectId) {
                await api.updateProject(editingProjectId, payload);
            } else {
                await api.createProject(payload);
            }

            push({
                tone: 'success',
                title: editingProjectId ? 'Project updated' : 'Project created',
                description: nextSetupIssues.length === 0
                    ? (user.role === 'admin' ? 'Project settings saved.' : 'Setup is complete. You can move to Dashboard or Audit now.')
                    : `Draft saved. Next: ${nextSetupIssues.join(', ')}.`,
            });

            await fetchData();
            resetProjectForm();
        } catch (error) {
            push({ tone: 'error', title: 'Could not save project', description: error instanceof Error ? error.message : 'Unknown error' });
        } finally {
            setSavingProject(false);
        }
    };

    const deleteProject = async () => {
        if (!projectPendingDelete) return;

        try {
            await api.deleteProject(projectPendingDelete.id);
            push({ tone: 'success', title: 'Project deleted', description: `${projectPendingDelete.name} was removed.` });
            setProjectPendingDelete(null);
            if (editingProjectId === projectPendingDelete.id) {
                resetProjectForm();
            }
            await fetchData();
        } catch (error) {
            push({ tone: 'error', title: 'Could not delete project', description: error instanceof Error ? error.message : 'Unknown error' });
        }
    };

    const resetViewerForm = () => {
        setEditingViewerEmail(null);
        setViewerForm(EMPTY_VIEWER_FORM);
    };

    const startEditViewer = (viewer: ViewerRecord) => {
        setEditingViewerEmail(viewer.email);
        setViewerForm({
            email: viewer.email,
            access: viewer.access,
            features: viewer.features || [],
            projectIds: viewer.projectIds,
        });
    };

    const handleViewerToggle = (field: 'access' | 'projectIds', value: string) => {
        setViewerForm((current) => ({
            ...current,
            [field]: current[field].includes(value)
                ? current[field].filter((entry) => entry !== value)
                : [...current[field], value],
        }));
    };

    const saveViewer = async (event: React.FormEvent) => {
        event.preventDefault();
        setSavingViewer(true);

        try {
            if (editingViewerEmail) {
                await api.updateViewer(editingViewerEmail, viewerForm.access, viewerForm.projectIds, viewerForm.features);
            } else {
                await api.addViewer(viewerForm.email, viewerForm.access, viewerForm.projectIds, viewerForm.features);
            }

            push({ tone: 'success', title: editingViewerEmail ? 'Viewer updated' : 'Viewer invited' });
            resetViewerForm();
            await fetchData();
        } catch (error) {
            push({ tone: 'error', title: 'Could not save viewer', description: error instanceof Error ? error.message : 'Unknown error' });
        } finally {
            setSavingViewer(false);
        }
    };

    const handleMatrixToggle = async (viewer: ViewerRecord, projectId: string) => {
        const key = `${viewer.email}::${projectId}`;
        setMatrixSaving(key);
        const nextProjectIds = viewer.projectIds.includes(projectId)
            ? viewer.projectIds.filter((id) => id !== projectId)
            : [...viewer.projectIds, projectId];
        try {
            await api.updateViewer(viewer.email, viewer.access, nextProjectIds, viewer.features || []);
            setViewers((current) =>
                current.map((v) => v.email === viewer.email ? { ...v, projectIds: nextProjectIds } : v)
            );
        } catch (error) {
            push({ tone: 'error', title: 'Could not update access', description: error instanceof Error ? error.message : 'Unknown error' });
        } finally {
            setMatrixSaving('');
        }
    };

    const deleteViewer = async () => {
        if (!viewerPendingDelete) return;

        try {
            await api.removeViewer(viewerPendingDelete.email);
            push({ tone: 'success', title: 'Viewer removed' });
            setViewerPendingDelete(null);
            await fetchData();
        } catch (error) {
            push({ tone: 'error', title: 'Could not remove viewer', description: error instanceof Error ? error.message : 'Unknown error' });
        }
    };

    const projectSetupOptions = {
        requiresGoogleConnection: user.role === 'viewer',
        googleConnected: connection.connected,
    };
    const draftProjectSetupIssues = getProjectSetupIssues({
        googleConnectionEmail: projectForm.googleConnectionEmail,
        gscSiteUrl: projectForm.gscSiteUrl,
        ga4PropertyId: projectForm.ga4PropertyId,
    }, projectSetupOptions);
    const readyProjectCount = activeProjects.filter((project) => isProjectReady(project, projectSetupOptions)).length;

    const propertiesReady = Boolean(projectForm.gscSiteUrl && projectForm.ga4PropertyId) ||
        activeProjects.some((p) => p.gscSiteUrl && p.ga4PropertyId);

    const onboardingSteps = [
        { num: '01', title: 'Connect Google', done: connection.connected, color: 'bg-blue-200' },
        { num: '02', title: 'Load Properties', done: propertiesReady, color: 'bg-purple-200' },
        { num: '03', title: 'Save Project', done: activeProjects.length > 0, color: 'bg-amber-200' },
        { num: '04', title: 'Go Live', done: readyProjectCount > 0, color: 'bg-emerald-200' },
    ];

    const showWelcomeGuide = !loading && readyProjectCount === 0;

    return (
        <div className="operator-shell text-slate-900 font-sans selection:bg-black selection:text-white pb-20">

            {/* ── Header ── */}
            <header className="sticky top-0 z-50 border-b-2 border-black bg-white/95 backdrop-blur-md">
                <div className="max-w-7xl mx-auto px-6 py-3.5 flex items-center justify-between gap-4 flex-wrap">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-black border-2 border-black">
                            <Globe className="w-5 h-5 text-white" />
                        </div>
                        <div className="flex items-center gap-2.5">
                            <h1 className="text-lg font-black uppercase tracking-tight text-black">
                                {user.role === 'admin' ? 'Projects' : 'Your Workspace'}
                            </h1>
                            <span className={`border border-black px-2 py-0.5 text-[10px] font-black uppercase ${user.role === 'admin' ? 'bg-orange-200' : 'bg-blue-100'}`}>
                                {user.role === 'admin' ? 'Admin' : 'Client'}
                            </span>
                        </div>
                        <div className="hidden md:flex items-center gap-2 ml-1">
                            <span className="border border-black bg-emerald-100 px-2.5 py-1 text-[11px] font-black uppercase text-emerald-900">
                                {readyProjectCount} Ready
                            </span>
                            <span className="border border-black bg-blue-100 px-2.5 py-1 text-[11px] font-black uppercase text-blue-900">
                                {activeProjects.length} Active
                            </span>
                        </div>
                    </div>
                    <div className="flex items-center gap-3">
                        {readyProjectCount > 0 && (
                            <button onClick={() => navigate('/dashboard')} className="operator-button-primary px-4 py-2">
                                <Play className="w-3.5 h-3.5" /> Dashboard
                            </button>
                        )}
                        {loading && (
                            <div className="flex items-center gap-1.5 text-xs font-black uppercase text-slate-400">
                                <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading
                            </div>
                        )}
                    </div>
                </div>
            </header>

            <div className="max-w-7xl mx-auto px-6 pt-8 space-y-8">

                {/* ── Viewer Welcome Banner ── */}
                {!loading && user.role !== 'admin' && readyProjectCount === 0 && (
                    <div className="border-2 border-black bg-slate-50" style={{ boxShadow: '4px 4px 0 0 #000' }}>
                        <div className="border-b-2 border-black bg-black px-5 py-3.5 flex items-center justify-between gap-3">
                            <div className="flex items-center gap-2.5">
                                <Zap className="w-4 h-4 text-yellow-300" />
                                <span className="text-sm font-black uppercase tracking-widest text-white">Welcome to Your SEO Workspace</span>
                            </div>
                            <span className="border border-yellow-300 text-yellow-300 px-2 py-0.5 text-[10px] font-black uppercase">New Account</span>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 divide-y-2 md:divide-y-0 md:divide-x-2 divide-black">
                            <div className="p-5">
                                <div className="flex items-center gap-2.5 mb-3">
                                    <div className="w-8 h-8 border-2 border-black bg-blue-200 flex items-center justify-center shrink-0">
                                        <Globe className="w-4 h-4 text-black" />
                                    </div>
                                    <h3 className="font-black text-black uppercase text-sm">Connect & Setup Your Project</h3>
                                </div>
                                <ol className="space-y-2 mb-4">
                                    {[
                                        'Connect the Google account that owns your Search Console & GA4.',
                                        'Load your properties — we auto-detect GSC site & GA4 property ID.',
                                        'Save the project, then open Dashboard or Audit.',
                                    ].map((step, i) => (
                                        <li key={i} className="flex items-start gap-2 text-xs font-medium text-slate-700">
                                            <span className="shrink-0 w-4 h-4 bg-black text-white text-[9px] font-black flex items-center justify-center mt-0.5">{i + 1}</span>
                                            {step}
                                        </li>
                                    ))}
                                </ol>
                                <button
                                    type="button"
                                    onClick={handleConnectGoogle}
                                    className="operator-button-primary px-4 py-2.5"
                                >
                                    <Link2 className="w-3.5 h-3.5" /> Connect Google
                                </button>
                            </div>
                            <div className="p-5 bg-emerald-50/60">
                                <div className="flex items-center gap-2.5 mb-3">
                                    <div className="w-8 h-8 border-2 border-black bg-emerald-200 flex items-center justify-center shrink-0">
                                        <Search className="w-4 h-4 text-black" />
                                    </div>
                                    <h3 className="font-black text-black uppercase text-sm">Keyword Research Ready Now</h3>
                                </div>
                                <p className="text-xs font-medium text-slate-600 mb-3">No project setup needed. Start deep keyword analysis immediately.</p>
                                <div className="flex gap-2 mb-4">
                                    <div className="border-2 border-black bg-white px-4 py-2 text-center">
                                        <p className="text-[9px] font-black uppercase text-slate-500">Daily</p>
                                        <p className="text-lg font-black text-black">3</p>
                                    </div>
                                    <div className="border-2 border-black bg-white px-4 py-2 text-center">
                                        <p className="text-[9px] font-black uppercase text-slate-500">Weekly</p>
                                        <p className="text-lg font-black text-black">10</p>
                                    </div>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => navigate('/keywords')}
                                    className="operator-button-secondary w-full px-4 py-2.5 justify-center"
                                >
                                    <Search className="w-3.5 h-3.5" /> Start Keyword Research
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                {/* ── Admin Onboarding Stepper ── */}
                {showWelcomeGuide && user.role === 'admin' && (
                    <div className="border-2 border-black bg-white" style={{ boxShadow: '4px 4px 0 0 #000' }}>
                        <div className="border-b-2 border-black bg-black px-5 py-3.5 flex items-center justify-between gap-3">
                            <div className="flex items-center gap-2.5">
                                <Zap className="w-4 h-4 text-yellow-300" />
                                <span className="text-sm font-black uppercase tracking-widest text-white">Getting Started</span>
                            </div>
                            <span className="border border-yellow-300 text-yellow-300 px-2 py-0.5 text-[10px] font-black uppercase">
                                {onboardingSteps.filter((s) => s.done).length}/{onboardingSteps.length} complete
                            </span>
                        </div>
                        <div className="px-5 py-4 space-y-3">
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                                {onboardingSteps.map((step, i) => {
                                    const doneCount = onboardingSteps.filter((s) => s.done).length;
                                    const isNext = !step.done && i === doneCount;
                                    return (
                                        <div
                                            key={step.num}
                                            className={`flex items-center gap-2.5 border-2 border-black px-3 py-2.5 ${step.done ? 'bg-emerald-100' : isNext ? 'bg-yellow-50' : 'bg-white'}`}
                                        >
                                            <div className={`w-6 h-6 border-2 border-black flex items-center justify-center shrink-0 text-[10px] font-black ${step.done ? 'bg-black text-white' : step.color}`}>
                                                {step.done ? <Check className="w-3 h-3" /> : step.num}
                                            </div>
                                            <span className="text-[11px] font-black uppercase text-black leading-tight flex-1">{step.title}</span>
                                            {isNext && (
                                                <span className="border border-black bg-yellow-300 px-1 py-0.5 text-[9px] font-black uppercase shrink-0">Next</span>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                            <div className="flex items-center gap-2 bg-slate-50 border-2 border-black/10 px-4 py-2.5">
                                <ArrowRight className="w-4 h-4 text-black shrink-0" />
                                <p className="text-xs font-bold text-slate-600">
                                    {!connection.connected
                                        ? 'Start by connecting your Google account in the panel below.'
                                        : !propertiesReady
                                            ? 'Google connected! Click "Load Properties" to auto-detect your GSC & GA4.'
                                            : 'Properties loaded! Click "+ New Project" to create your first project.'}
                                </p>
                            </div>
                        </div>
                    </div>
                )}

                {/* ── Main Content Grid ── */}
                <div className={`grid gap-8 ${user.role === 'admin' ? 'xl:grid-cols-[1.15fr_0.85fr]' : ''}`}>

                    {/* ── LEFT: Google Connection + Projects List ── */}
                    <section className="space-y-6">

                        {/* Google Connection */}
                        <div className="border-2 border-black bg-white" style={{ boxShadow: '6px 6px 0 0 #000' }}>
                            <div className="flex items-center gap-3 border-b-2 border-black px-5 py-3.5 bg-slate-50">
                                <div className="p-2 bg-black border-2 border-black">
                                    <Link2 className="h-4 w-4 text-white" />
                                </div>
                                <div>
                                    <h2 className="text-sm font-black uppercase tracking-wide text-black">Google Connection</h2>
                                    <p className="text-[10px] font-bold text-slate-500">Required for Search Console and GA4 data.</p>
                                </div>
                            </div>

                            <div className="p-5 space-y-4">
                                {/* Status + Action buttons */}
                                <div className={`border-2 border-black ${connection.connected ? 'bg-emerald-50' : 'bg-amber-50'}`}>
                                    <div className="flex items-center gap-3 px-4 py-3 border-b border-black/10">
                                        <div className={`w-2.5 h-2.5 border-2 border-black shrink-0 ${connection.connected ? 'bg-emerald-400' : 'bg-red-400'}`} />
                                        <div className="flex-1 min-w-0">
                                            <p className="text-xs font-black uppercase text-black">
                                                {connection.connected ? 'Connected' : 'Not Connected'}
                                            </p>
                                            {connection.connected && (
                                                <p className="text-[11px] font-mono font-bold text-slate-600 truncate">
                                                    {connection.googleEmail || connection.ownerEmail}
                                                </p>
                                            )}
                                            {!connection.connected && (
                                                <p className="text-[11px] font-bold text-slate-500">Connect the account that owns your Search Console & GA4.</p>
                                            )}
                                        </div>
                                        {connection.updatedAt && (
                                            <span className="text-[9px] font-bold text-slate-400 uppercase shrink-0 hidden sm:block">
                                                {new Date(connection.updatedAt).toLocaleDateString()}
                                            </span>
                                        )}
                                    </div>
                                    <div className="flex">
                                        {connection.connected && (
                                            <button
                                                type="button"
                                                onClick={() => void loadResources()}
                                                disabled={googleLoading}
                                                className="operator-button-secondary flex-1 px-4 py-3 border-r-2 border-black justify-center"
                                            >
                                                {googleLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                                                {googleLoading ? 'Loading…' : 'Load Properties'}
                                            </button>
                                        )}
                                        <button
                                            type="button"
                                            onClick={handleConnectGoogle}
                                            className={`operator-button-primary flex-1 px-4 py-3 justify-center`}
                                        >
                                            <Link2 className="h-3.5 w-3.5" />
                                            {connection.connected ? 'Reconnect' : 'Connect Google'}
                                        </button>
                                    </div>
                                </div>

                                {/* Property selectors — appear after loading */}
                                {resources && (
                                    <div className="border-t-2 border-black/10 pt-4 space-y-3">
                                        <p className="text-[10px] font-black uppercase tracking-wide text-slate-500">Properties loaded — select below, then open a project to save them.</p>
                                        <div className="grid gap-4 md:grid-cols-2">
                                            <Field label="Search Console Property">
                                                <select
                                                    value={projectForm.gscSiteUrl}
                                                    onChange={(e) => handleProjectField('gscSiteUrl', e.target.value)}
                                                    className="operator-control w-full py-3 pl-3 pr-10 text-sm font-bold appearance-none cursor-pointer"
                                                >
                                                    <option value="">Choose Search Console property</option>
                                                    {resources.sites.map((site) => (
                                                        <option key={site.siteUrl} value={site.siteUrl}>{site.label}</option>
                                                    ))}
                                                </select>
                                            </Field>
                                            <Field label="GA4 Property">
                                                <select
                                                    value={projectForm.ga4PropertyId}
                                                    onChange={(e) => handleProjectField('ga4PropertyId', e.target.value)}
                                                    className="operator-control w-full py-3 pl-3 pr-10 text-sm font-bold appearance-none cursor-pointer"
                                                >
                                                    <option value="">Choose GA4 property</option>
                                                    {resources.properties.map((property) => (
                                                        <option key={property.propertyId} value={property.propertyId}>{property.label}</option>
                                                    ))}
                                                </select>
                                            </Field>
                                        </div>
                                        <div className="flex flex-col gap-1.5 pt-1">
                                            <button
                                                type="button"
                                                onClick={openNewProjectModal}
                                                disabled={!(projectForm.gscSiteUrl && projectForm.ga4PropertyId)}
                                                className="operator-button-primary px-4 py-3 justify-center disabled:opacity-40 disabled:cursor-not-allowed"
                                            >
                                                <Plus className="h-3.5 w-3.5" /> Create Project with these properties
                                                <ArrowRight className="h-3.5 w-3.5" />
                                            </button>
                                            {!(projectForm.gscSiteUrl && projectForm.ga4PropertyId) && (
                                                <p className="text-[10px] font-bold text-slate-400 uppercase">
                                                    Choose both a Search Console property and a GA4 property to continue.
                                                </p>
                                            )}
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* ── Projects List ── */}
                        <div className="border-2 border-black bg-white" style={{ boxShadow: '6px 6px 0 0 #000' }}>
                            <div className="flex items-center justify-between gap-4 border-b-2 border-black px-5 py-3.5 bg-slate-50">
                                <div className="flex items-center gap-3">
                                    <div className="p-2 bg-black border-2 border-black">
                                        <Globe className="h-4 w-4 text-white" />
                                    </div>
                                    <div>
                                        <h2 className="text-sm font-black uppercase tracking-wide text-black">
                                            {user.role === 'admin' ? 'All Projects' : 'Your Projects'}
                                        </h2>
                                        <p className="text-[10px] font-bold text-slate-400 uppercase">
                                            {activeProjects.length} active · {readyProjectCount} ready
                                        </p>
                                    </div>
                                </div>
                                <button
                                    type="button"
                                    onClick={openNewProjectModal}
                                    className="operator-button-primary px-4 py-2"
                                >
                                    <Plus className="h-3.5 w-3.5" /> New Project
                                </button>
                            </div>

                            <div className="p-5 space-y-2.5">
                                {activeProjects.map((project) => {
                                    const ready = isProjectReady(project, projectSetupOptions);
                                    const setupIssues = getProjectSetupIssues(project, projectSetupOptions);
                                    const canManage = canManageProject(project, user);

                                    return (
                                        <div
                                            key={project.id}
                                            className={`border-2 border-black p-4 transition-all ${ready ? 'bg-white hover:bg-emerald-50/30' : 'bg-amber-50/40 hover:bg-amber-50/70'}`}
                                        >
                                            <div className="flex items-start justify-between gap-3">
                                                <div className="flex-1 min-w-0">
                                                    {/* Row 1: name + status */}
                                                    <div className="flex items-center gap-2 mb-1.5">
                                                        <span className="text-sm font-black uppercase text-black">{project.name}</span>
                                                        <span className={`ml-auto shrink-0 flex items-center gap-1.5 border border-black px-2 py-0.5 text-[10px] font-black uppercase ${ready ? 'bg-emerald-200' : 'bg-amber-200'}`}>
                                                            <span className={`w-1.5 h-1.5 rounded-full ${ready ? 'bg-emerald-600' : 'bg-amber-600'}`} />
                                                            {ready ? 'Ready' : 'Needs Setup'}
                                                        </span>
                                                    </div>
                                                    {/* Row 2: url + gsc/ga4 badges */}
                                                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                                                        <span className="text-[11px] font-mono text-slate-500 truncate max-w-[240px]">{project.url}</span>
                                                        <span className={`text-[10px] font-black uppercase ${project.gscSiteUrl ? 'text-emerald-700' : 'text-red-500'}`}>
                                                            GSC {project.gscSiteUrl ? '✓' : '✗'}
                                                        </span>
                                                        <span className={`text-[10px] font-black uppercase ${project.ga4PropertyId ? 'text-emerald-700' : 'text-red-500'}`}>
                                                            GA4 {project.ga4PropertyId ? '✓' : '✗'}
                                                        </span>
                                                        {user.role === 'admin' && project.ownerEmail && (
                                                            <span className="text-[10px] font-bold text-slate-400">{project.ownerEmail}</span>
                                                        )}
                                                    </div>
                                                    {!ready && setupIssues.length > 0 && (
                                                        <div className="mt-1.5 flex items-center gap-1.5">
                                                            <AlertCircle className="w-3 h-3 text-amber-600 shrink-0" />
                                                            <p className="text-[10px] font-black uppercase text-amber-700">Next: {setupIssues.join(' · ')}</p>
                                                        </div>
                                                    )}
                                                </div>

                                                {canManage && (
                                                    <div className="flex gap-1.5 shrink-0">
                                                        <button
                                                            type="button"
                                                            onClick={() => startEditProject(project)}
                                                            className="operator-button-secondary px-3 py-2"
                                                        >
                                                            <Pencil className="h-3.5 w-3.5" />
                                                            {ready ? 'Edit' : 'Setup'}
                                                        </button>
                                                        <button
                                                            type="button"
                                                            onClick={() => setProjectPendingDelete(project)}
                                                            className="border-2 border-black bg-red-50 text-black px-3 py-2 hover:bg-red-200 transition-all inline-flex items-center"
                                                            title="Delete project"
                                                        >
                                                            <Trash2 className="h-3.5 w-3.5" />
                                                        </button>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    );
                                })}

                                {!loading && activeProjects.length === 0 && (
                                    <div className="border-2 border-dashed border-slate-300 p-10 text-center">
                                        <FolderPlus className="w-10 h-10 text-slate-300 mx-auto mb-3" />
                                        <p className="text-sm font-black uppercase text-slate-400 mb-1">No projects yet</p>
                                        <p className="text-xs font-bold text-slate-400 mb-5">
                                            Connect Google, load properties, then create your first project.
                                        </p>
                                        <button
                                            type="button"
                                            onClick={openNewProjectModal}
                                            className="operator-button-primary px-5 py-2.5"
                                        >
                                            <Plus className="h-4 w-4" /> Create First Project
                                        </button>
                                    </div>
                                )}

                                {loading && (
                                    <div className="flex items-center justify-center py-8 gap-2 text-slate-400">
                                        <Loader2 className="w-5 h-5 animate-spin" />
                                        <span className="text-sm font-black uppercase">Loading projects…</span>
                                    </div>
                                )}
                            </div>
                        </div>
                    </section>

                    {/* ── RIGHT: Admin Control Panel ── */}
                    {user.role === 'admin' && (
                        <section className="space-y-6">

                            {/* Stats pills */}
                            <div className="flex flex-wrap gap-2 border-2 border-black p-3 bg-white" style={{ boxShadow: '4px 4px 0 0 #000' }}>
                                {[
                                    { label: 'Projects', value: activeProjects.length, color: 'bg-blue-100' },
                                    { label: 'Ready', value: readyProjectCount, color: 'bg-emerald-100' },
                                    { label: 'Viewers', value: viewers.length, color: 'bg-purple-100' },
                                    { label: 'Incomplete', value: activeProjects.length - readyProjectCount, color: 'bg-amber-100' },
                                ].map((stat) => (
                                    <div key={stat.label} className={`${stat.color} border border-black px-4 py-2 flex items-center gap-3 flex-1`}>
                                        <p className="text-[10px] font-black uppercase tracking-widest text-black/60">{stat.label}</p>
                                        <p className="text-2xl font-black text-black">{stat.value}</p>
                                    </div>
                                ))}
                            </div>

                            {/* Tabbed panel */}
                            <div className="border-2 border-black bg-white" style={{ boxShadow: '6px 6px 0 0 #000' }}>
                                {/* Tab bar */}
                                <div className="flex border-b-2 border-black">
                                    {[
                                        { id: 'viewers' as const, label: 'Viewer Accounts', icon: Users },
                                        { id: 'matrix' as const, label: 'Access Matrix', icon: Grid3X3 },
                                    ].map((tab) => (
                                        <button
                                            key={tab.id}
                                            onClick={() => setAdminTab(tab.id)}
                                            className={`flex-1 flex items-center justify-center gap-2 px-4 py-3.5 text-xs font-black uppercase tracking-wide border-r-2 border-black last:border-r-0 transition-all ${adminTab === tab.id
                                                    ? 'bg-black text-white'
                                                    : 'bg-white text-black hover:bg-slate-50'
                                                }`}
                                        >
                                            <tab.icon className="h-4 w-4" />
                                            {tab.label}
                                        </button>
                                    ))}
                                </div>

                                {/* ── Viewer Accounts Tab ── */}
                                {adminTab === 'viewers' && (
                                    <div className="p-5 space-y-5">
                                        {/* Add/Edit viewer form */}
                                        <form onSubmit={saveViewer} className="border-2 border-black p-5 space-y-4 bg-slate-50">
                                            <div className="flex items-start justify-between gap-2 border-b-2 border-black/10 pb-3">
                                                <div className="flex items-center gap-2">
                                                    <div className="p-1.5 bg-black border-2 border-black">
                                                        {editingViewerEmail
                                                            ? <Pencil className="w-3.5 h-3.5 text-white" />
                                                            : <UserPlus className="w-3.5 h-3.5 text-white" />
                                                        }
                                                    </div>
                                                    <div>
                                                        <span className="text-xs font-black uppercase text-black">
                                                            {editingViewerEmail ? 'Editing Viewer' : 'Invite Viewer'}
                                                        </span>
                                                        {editingViewerEmail && (
                                                            <p className="text-[10px] font-bold text-slate-500 mt-0.5">{editingViewerEmail}</p>
                                                        )}
                                                    </div>
                                                </div>
                                                {editingViewerEmail && (
                                                    <span className="border border-black bg-blue-100 px-2 py-0.5 text-[10px] font-black uppercase">Editing</span>
                                                )}
                                            </div>

                                            <Field label="Google Email">
                                                <div className="relative">
                                                    <input
                                                        value={viewerForm.email}
                                                        onChange={(e) => setViewerForm((current) => ({ ...current, email: e.target.value }))}
                                                        className={`operator-control w-full py-3 px-4 text-sm font-bold ${editingViewerEmail ? 'pr-10' : ''}`}
                                                        placeholder="viewer@gmail.com"
                                                        disabled={Boolean(editingViewerEmail)}
                                                    />
                                                    {editingViewerEmail && (
                                                        <Lock className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                                                    )}
                                                </div>
                                                {editingViewerEmail && (
                                                    <p className="text-[10px] text-slate-400 font-bold mt-1">Email can't be changed — delete and re-invite to update it.</p>
                                                )}
                                            </Field>

                                            <div className="space-y-2">
                                                <FieldLabel label="Product Access" />
                                                <div className="space-y-2">
                                                    {ACCESS_OPTIONS.map((option) => (
                                                        <div key={option.id} className="flex items-center gap-3">
                                                            <Toggle
                                                                checked={viewerForm.access.includes(option.id)}
                                                                label={option.label}
                                                                onClick={() => handleViewerToggle('access', option.id)}
                                                            />
                                                            <span className="text-[10px] text-slate-500 font-bold">{option.desc}</span>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>

                                            <div className="space-y-2">
                                                <FieldLabel label="Project Access" hint="Leave empty to grant access to all projects." />
                                                <div className="flex flex-wrap gap-2">
                                                    {activeProjects.length === 0 ? (
                                                        <span className="text-xs font-bold text-slate-400 uppercase">No projects yet</span>
                                                    ) : activeProjects.map((project) => (
                                                        <Toggle
                                                            key={project.id}
                                                            checked={viewerForm.projectIds.includes(project.id)}
                                                            label={project.name}
                                                            onClick={() => handleViewerToggle('projectIds', project.id)}
                                                        />
                                                    ))}
                                                </div>
                                            </div>

                                            <div className="flex flex-wrap items-center gap-2 pt-2 border-t-2 border-black/10">
                                                <button type="submit" disabled={savingViewer} className="operator-button-primary px-5 py-2.5">
                                                    {savingViewer ? <Loader2 className="h-4 w-4 animate-spin" /> : <Shield className="h-4 w-4" />}
                                                    {editingViewerEmail ? 'Save Changes' : 'Invite Viewer'}
                                                </button>
                                                <button type="button" onClick={resetViewerForm} className="operator-button-secondary px-4 py-2.5">
                                                    {editingViewerEmail ? 'Cancel' : 'Clear'}
                                                </button>
                                            </div>
                                        </form>

                                        {/* Viewer cards */}
                                        <div className="space-y-2.5">
                                            <span className="text-[11px] font-black uppercase tracking-wide text-slate-500">
                                                {viewers.length} Viewer{viewers.length !== 1 ? 's' : ''}
                                            </span>

                                            {viewers.map((viewer) => {
                                                const isEditingViewer = editingViewerEmail === viewer.email;
                                                const avatarInitials = (viewer.name || viewer.email).slice(0, 2).toUpperCase();
                                                const assignedProjects = activeProjects.filter((p) => viewer.projectIds.includes(p.id));
                                                const joinDate = viewer.registeredAt ? new Date(viewer.registeredAt).toLocaleDateString() : null;
                                                const loginDate = viewer.lastLoginAt ? new Date(viewer.lastLoginAt).toLocaleDateString() : null;

                                                return (
                                                    <div
                                                        key={viewer.email}
                                                        className={`border-2 border-black p-4 transition-colors ${isEditingViewer ? 'bg-blue-50' : 'bg-white hover:bg-slate-50'}`}
                                                    >
                                                        <div className="flex items-start gap-3">
                                                            <div
                                                                className="border-2 border-black flex-shrink-0 w-9 h-9 flex items-center justify-center font-black text-xs bg-slate-100 overflow-hidden"
                                                                title={[joinDate && `Joined ${joinDate}`, loginDate && `Last login ${loginDate}`].filter(Boolean).join(' · ')}
                                                            >
                                                                {viewer.picture
                                                                    ? <img src={viewer.picture} className="w-full h-full object-cover" alt="" />
                                                                    : avatarInitials
                                                                }
                                                            </div>

                                                            <div className="flex-1 min-w-0">
                                                                <div className="flex flex-wrap items-center gap-1.5 mb-1.5">
                                                                    <p className="text-sm font-black text-black truncate">{viewer.email}</p>
                                                                    {viewer.registrationSource === 'self-serve' && (
                                                                        <span className="border border-black bg-blue-100 px-1.5 py-0.5 text-[9px] font-black uppercase">Self-serve</span>
                                                                    )}
                                                                    {viewer.status === 'pending' && (
                                                                        <span className="border border-black bg-yellow-300 px-1.5 py-0.5 text-[9px] font-black uppercase">Pending</span>
                                                                    )}
                                                                </div>
                                                                <div className="flex flex-wrap gap-1.5 mb-1.5">
                                                                    {viewer.access.length === 0
                                                                        ? <span className="border border-black bg-red-100 px-2 py-0.5 text-[9px] font-black uppercase">No access</span>
                                                                        : viewer.access.map((a) => (
                                                                            <span key={a} className="border border-black bg-blue-100 px-2 py-0.5 text-[9px] font-black uppercase">{a}</span>
                                                                        ))
                                                                    }
                                                                </div>
                                                                <p className="text-[10px] font-bold uppercase">
                                                                    {assignedProjects.length === 0
                                                                        ? <span className="text-amber-600">No projects assigned</span>
                                                                        : <span className="text-emerald-700">{assignedProjects.map((p) => p.name).join(' · ')}</span>
                                                                    }
                                                                </p>
                                                            </div>

                                                            <div className="flex gap-1.5 shrink-0">
                                                                <button
                                                                    type="button"
                                                                    onClick={() => isEditingViewer ? resetViewerForm() : startEditViewer(viewer)}
                                                                    className="operator-button-secondary px-2.5 py-2"
                                                                    title={isEditingViewer ? 'Cancel editing' : 'Edit viewer'}
                                                                >
                                                                    <Pencil className="h-3.5 w-3.5" />
                                                                </button>
                                                                <button
                                                                    type="button"
                                                                    onClick={() => setViewerPendingDelete(viewer)}
                                                                    className="border-2 border-black bg-red-50 text-black px-2.5 py-2 hover:bg-red-200 transition-all inline-flex items-center"
                                                                    title="Remove viewer"
                                                                >
                                                                    <Trash2 className="h-3.5 w-3.5" />
                                                                </button>
                                                            </div>
                                                        </div>
                                                    </div>
                                                );
                                            })}

                                            {!loading && viewers.length === 0 && (
                                                <div className="border-2 border-dashed border-slate-300 p-8 text-center">
                                                    <Users className="w-10 h-10 text-slate-300 mx-auto mb-2" />
                                                    <p className="text-xs font-black uppercase text-slate-400">No viewer accounts yet</p>
                                                    <p className="text-[10px] font-bold text-slate-400 mt-1">Use the form above to invite a client or team member.</p>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                )}

                                {/* ── Access Matrix Tab ── */}
                                {adminTab === 'matrix' && (
                                    <div className="p-5 space-y-4">
                                        <div>
                                            <p className="text-xs font-black uppercase tracking-wide text-black mb-1">Project × Viewer Access Matrix</p>
                                            <p className="text-[10px] font-bold text-slate-500">Click a cell to grant or revoke access instantly.</p>
                                        </div>

                                        {viewers.length === 0 || activeProjects.length === 0 ? (
                                            <div className="border-2 border-dashed border-slate-300 p-8 text-center">
                                                <Grid3X3 className="w-10 h-10 text-slate-300 mx-auto mb-2" />
                                                <p className="text-xs font-black uppercase text-slate-400">
                                                    {viewers.length === 0 ? 'Invite viewers first' : 'Add projects first'}
                                                </p>
                                                <p className="text-[10px] font-bold text-slate-400 mt-1">
                                                    The matrix appears once you have both projects and viewers.
                                                </p>
                                            </div>
                                        ) : (
                                            <div className="overflow-x-auto border-2 border-black">
                                                <table className="w-full text-xs border-collapse">
                                                    <thead>
                                                        <tr>
                                                            <th className="border-r-2 border-b-2 border-black bg-black text-white px-3 py-3 text-left font-black uppercase whitespace-nowrap">
                                                                Project
                                                            </th>
                                                            {viewers.map((viewer) => (
                                                                <th
                                                                    key={viewer.email}
                                                                    className="border-r-2 border-b-2 border-black bg-black text-white px-3 py-3 font-black uppercase last:border-r-0"
                                                                    title={viewer.email}
                                                                >
                                                                    <div className="flex flex-col items-center gap-1">
                                                                        <div className="w-6 h-6 bg-white border border-white/30 flex items-center justify-center text-black text-[10px] font-black">
                                                                            {(viewer.name || viewer.email).slice(0, 2).toUpperCase()}
                                                                        </div>
                                                                        <span className="text-[9px] max-w-[5rem] truncate block font-mono">
                                                                            {viewer.email.split('@')[0]}
                                                                        </span>
                                                                    </div>
                                                                </th>
                                                            ))}
                                                        </tr>
                                                    </thead>
                                                    <tbody>
                                                        {activeProjects.map((project, rowIdx) => (
                                                            <tr key={project.id} className={rowIdx % 2 === 0 ? 'bg-white' : 'bg-slate-50'}>
                                                                <td className="border-r-2 border-b-2 border-black px-3 py-3 font-black uppercase whitespace-nowrap last-of-type:border-b-0">
                                                                    <div className="flex items-center gap-2">
                                                                        <div className={`w-1.5 h-1.5 border border-black ${isProjectReady(project, projectSetupOptions) ? 'bg-emerald-400' : 'bg-amber-400'}`} />
                                                                        <span className="text-black">{project.name}</span>
                                                                    </div>
                                                                </td>
                                                                {viewers.map((viewer) => {
                                                                    const hasAccess = viewer.projectIds.includes(project.id);
                                                                    const cellKey = `${viewer.email}::${project.id}`;
                                                                    const saving = matrixSaving === cellKey;
                                                                    return (
                                                                        <td
                                                                            key={viewer.email}
                                                                            className="border-r-2 border-b-2 border-black px-3 py-3 text-center last:border-r-0"
                                                                        >
                                                                            <button
                                                                                type="button"
                                                                                disabled={saving}
                                                                                onClick={() => void handleMatrixToggle(viewer, project.id)}
                                                                                title={hasAccess ? `Revoke ${viewer.email} from ${project.name}` : `Grant ${viewer.email} access to ${project.name}`}
                                                                                className={`w-8 h-8 border-2 border-black flex items-center justify-center mx-auto cursor-pointer transition-all ${saving
                                                                                        ? 'bg-slate-200 cursor-wait'
                                                                                        : hasAccess
                                                                                            ? 'bg-emerald-300 hover:bg-red-200'
                                                                                            : 'bg-white hover:bg-emerald-100'
                                                                                    }`}
                                                                            >
                                                                                {saving
                                                                                    ? <Loader2 className="w-3.5 h-3.5 animate-spin text-slate-600" />
                                                                                    : hasAccess
                                                                                        ? <CheckCircle2 className="w-4 h-4 text-black" />
                                                                                        : <span className="text-slate-300 text-lg leading-none">–</span>
                                                                                }
                                                                            </button>
                                                                        </td>
                                                                    );
                                                                })}
                                                            </tr>
                                                        ))}
                                                    </tbody>
                                                </table>
                                            </div>
                                        )}

                                        <div className="flex items-center gap-4 pt-1">
                                            <div className="flex items-center gap-2">
                                                <div className="w-5 h-5 border-2 border-black bg-emerald-300 flex items-center justify-center">
                                                    <CheckCircle2 className="w-3 h-3 text-black" />
                                                </div>
                                                <span className="text-[10px] font-black uppercase text-slate-500">Has access</span>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <div className="w-5 h-5 border-2 border-black bg-white flex items-center justify-center">
                                                    <span className="text-slate-300 text-sm leading-none">–</span>
                                                </div>
                                                <span className="text-[10px] font-black uppercase text-slate-500">No access</span>
                                            </div>
                                            <div className="ml-auto text-[10px] font-bold text-slate-400 uppercase">
                                                Click any cell to toggle
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </section>
                    )}
                </div>
            </div>

            {/* ── Project Form Modal ── */}
            {showProjectModal && (
                <Modal
                    title={editingProjectId ? 'Edit Project' : 'New Project'}
                    onClose={resetProjectForm}
                    size="lg"
                >
                    <form onSubmit={saveProject} className="space-y-5">
                        {editingProjectId && (
                            <div className="flex items-center gap-2 px-3 py-2.5 bg-blue-50 border-2 border-blue-200">
                                <Pencil className="w-3.5 h-3.5 text-blue-600 shrink-0" />
                                <p className="text-xs font-black uppercase text-blue-700">Editing: {editingProjectId}</p>
                            </div>
                        )}

                        <div className="grid gap-4 md:grid-cols-2">
                            <Field label="Project Name">
                                <input
                                    value={projectForm.name}
                                    onChange={(e) => handleProjectField('name', e.target.value)}
                                    className="operator-control w-full py-3 px-4 text-sm font-bold"
                                    placeholder="Example Inc"
                                />
                            </Field>
                            <Field label="Project ID" hint="Cannot change after creation.">
                                <input
                                    value={projectForm.id}
                                    onChange={(e) => handleProjectField('id', e.target.value)}
                                    className="operator-control w-full py-3 px-4 text-sm font-bold font-mono"
                                    placeholder="example-inc"
                                    disabled={Boolean(editingProjectId)}
                                />
                            </Field>
                            <Field label="Primary URL">
                                <input
                                    value={projectForm.url}
                                    onChange={(e) => handleProjectField('url', e.target.value)}
                                    className="operator-control w-full py-3 px-4 text-sm font-bold"
                                    placeholder="https://example.com/"
                                />
                            </Field>
                            <Field label="Domain" hint="Optional — auto-derived from URL if blank.">
                                <input
                                    value={projectForm.domain}
                                    onChange={(e) => handleProjectField('domain', e.target.value)}
                                    className="operator-control w-full py-3 px-4 text-sm font-bold"
                                    placeholder="example.com"
                                />
                            </Field>
                            {user.role === 'admin' && (
                                <Field label="Owner Email">
                                    <input
                                        value={projectForm.ownerEmail}
                                        onChange={(e) => handleProjectField('ownerEmail', e.target.value)}
                                        className="operator-control w-full py-3 px-4 text-sm font-bold"
                                        placeholder="client@gmail.com"
                                    />
                                </Field>
                            )}
                            <Field label="Google Connection Email" hint="The Google account connected above.">
                                <input
                                    value={projectForm.googleConnectionEmail}
                                    onChange={(e) => handleProjectField('googleConnectionEmail', e.target.value)}
                                    className="operator-control w-full py-3 px-4 text-sm font-bold"
                                    placeholder="google-account@gmail.com"
                                />
                            </Field>
                            <Field label="Search Console Property" hint="URL-prefix or sc-domain format.">
                                <input
                                    value={projectForm.gscSiteUrl}
                                    onChange={(e) => handleProjectField('gscSiteUrl', e.target.value)}
                                    className="operator-control w-full py-3 px-4 text-sm font-bold"
                                    placeholder="https://example.com/"
                                />
                            </Field>
                            <Field label="GA4 Property ID">
                                <input
                                    value={projectForm.ga4PropertyId}
                                    onChange={(e) => handleProjectField('ga4PropertyId', e.target.value)}
                                    className="operator-control w-full py-3 px-4 text-sm font-bold"
                                    placeholder="123456789"
                                />
                            </Field>
                            <Field label="Audit Max Pages">
                                <input
                                    value={projectForm.auditMaxPages}
                                    onChange={(e) => handleProjectField('auditMaxPages', e.target.value)}
                                    className="operator-control w-full py-3 px-4 text-sm font-bold"
                                    type="number"
                                    min="1"
                                    max="2000"
                                />
                            </Field>
                            <Field label="Spreadsheet ID" hint="Optional — for Google Sheets exports.">
                                <input
                                    value={projectForm.spreadsheetId}
                                    onChange={(e) => handleProjectField('spreadsheetId', e.target.value)}
                                    className="operator-control w-full py-3 px-4 text-sm font-bold"
                                    placeholder="Google Sheet ID"
                                />
                            </Field>
                            <Field label="Sheet GID">
                                <input
                                    value={projectForm.sheetGid}
                                    onChange={(e) => handleProjectField('sheetGid', e.target.value)}
                                    className="operator-control w-full py-3 px-4 text-sm font-bold"
                                    type="number"
                                />
                            </Field>
                        </div>

                        {/* Status bar */}
                        <div className={`border-2 border-black p-3 ${duplicateDraftProject ? 'bg-red-50' : draftProjectSetupIssues.length === 0 ? 'bg-emerald-50' : 'bg-amber-50'}`}>
                            <div className="flex items-start gap-2">
                                <div className={`w-1.5 h-1.5 mt-1.5 border border-black shrink-0 ${duplicateDraftProject ? 'bg-red-500' : draftProjectSetupIssues.length === 0 ? 'bg-emerald-400' : 'bg-amber-400'}`} />
                                <p className="text-xs font-bold text-black">
                                    {duplicateDraftProject
                                        ? `Project ID "${normalizedDraftProjectId}" already exists. Choose a different ID.`
                                        : draftProjectSetupIssues.length === 0
                                        ? 'Project is fully configured and ready for analytics.'
                                        : `Will save as draft. Still needed: ${draftProjectSetupIssues.join(' · ')}.`}
                                </p>
                            </div>
                        </div>

                        <div className="flex flex-wrap items-center gap-3 pt-1 border-t-2 border-black/10">
                            <button
                                type="submit"
                                disabled={savingProject || Boolean(duplicateDraftProject)}
                                className="operator-button-primary px-6 py-2.5"
                            >
                                {savingProject ? <Loader2 className="h-4 w-4 animate-spin" /> : editingProjectId ? <Save className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
                                {editingProjectId
                                    ? (draftProjectSetupIssues.length === 0 ? 'Save Project' : 'Save Draft')
                                    : (draftProjectSetupIssues.length === 0 ? 'Publish Project' : 'Save Draft')}
                            </button>
                            <button
                                type="button"
                                onClick={resetProjectForm}
                                className="operator-button-secondary px-5 py-2.5"
                            >
                                Cancel
                            </button>
                        </div>
                    </form>
                </Modal>
            )}

            {/* ── Delete Modals ── */}
            {projectPendingDelete && (
                <Modal title="Delete project" onClose={() => setProjectPendingDelete(null)}>
                    <div className="space-y-5">
                        <div className="border-2 border-black bg-red-50 p-4">
                            <p className="text-sm font-bold text-black">
                                Delete <strong className="font-black">{projectPendingDelete.name}</strong>?
                            </p>
                            <p className="text-xs font-bold text-slate-600 mt-1">
                                This permanently removes the project and all its history and jobs. This cannot be undone.
                            </p>
                        </div>
                        <div className="flex justify-end gap-3">
                            <button onClick={() => setProjectPendingDelete(null)} className="operator-button-secondary px-5 py-2.5">
                                Cancel
                            </button>
                            <button
                                onClick={() => void deleteProject()}
                                className="border-2 border-black bg-red-500 text-white px-5 py-2.5 text-xs font-black uppercase hover:bg-red-600 transition-all inline-flex items-center gap-2"
                                style={{ boxShadow: '4px 4px 0 0 #000' }}
                            >
                                <Trash2 className="w-4 h-4" /> Delete Project
                            </button>
                        </div>
                    </div>
                </Modal>
            )}

            {viewerPendingDelete && (
                <Modal title="Remove viewer" onClose={() => setViewerPendingDelete(null)}>
                    <div className="space-y-5">
                        <div className="border-2 border-black bg-red-50 p-4">
                            <p className="text-sm font-bold text-black">
                                Remove access for <strong className="font-black">{viewerPendingDelete.email}</strong>?
                            </p>
                            <p className="text-xs font-bold text-slate-600 mt-1">They will no longer be able to sign in to this workspace.</p>
                        </div>
                        <div className="flex justify-end gap-3">
                            <button onClick={() => setViewerPendingDelete(null)} className="operator-button-secondary px-5 py-2.5">
                                Cancel
                            </button>
                            <button
                                onClick={() => void deleteViewer()}
                                className="border-2 border-black bg-red-500 text-white px-5 py-2.5 text-xs font-black uppercase hover:bg-red-600 transition-all inline-flex items-center gap-2"
                                style={{ boxShadow: '4px 4px 0 0 #000' }}
                            >
                                <Trash2 className="w-4 h-4" /> Remove Viewer
                            </button>
                        </div>
                    </div>
                </Modal>
            )}
        </div>
    );
}
