import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    AlertCircle,
    CheckCircle2,
    FolderCog,
    Link2,
    Loader2,
    Pencil,
    Plus,
    RefreshCw,
    Save,
    Shield,
    Trash2,
    Users,
} from 'lucide-react';
import { api } from './api';
import Modal from './components/common/Modal';
import { useRouter } from './router';
import { useToast } from './toast';
import type { AuthUser, GoogleConnectionStatus, GoogleResourcesResponse, Project, ViewerRecord } from './types';

const ACCESS_OPTIONS = [
    { id: 'keywords', label: 'Keyword tool' },
    { id: 'dashboard', label: 'Dashboard' },
    { id: 'audit', label: 'Audit jobs' },
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
        googleConnectionEmail: connectionEmail || user.email,
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

function isProjectReady(project: Project) {
    return Boolean(project.googleConnectionEmail && project.gscSiteUrl && project.ga4PropertyId);
}

function canManageProject(project: Project, user: AuthUser) {
    return user.role === 'admin' || project.ownerEmail === user.email;
}

function formatDate(value: string | null | undefined) {
    if (!value) return 'Not available';
    return new Date(value).toLocaleString();
}

function Toggle({ checked, label, onClick }: { checked: boolean; label: string; onClick: () => void }) {
    return (
        <button
            type="button"
            onClick={onClick}
            className={`rounded-xl border px-3 py-2 text-sm font-medium transition ${checked ? 'border-indigo-500 bg-indigo-50 text-indigo-700' : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'}`}
        >
            {label}
        </button>
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
        <label className={`space-y-2 text-sm font-medium text-slate-700 ${fullWidth ? 'md:col-span-2' : ''}`}>
            <span>{label}</span>
            {children}
            {hint && <span className="block text-xs leading-relaxed text-slate-400">{hint}</span>}
        </label>
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
    const [editingProjectId, setEditingProjectId] = useState<string | null>(null);
    const [editingViewerEmail, setEditingViewerEmail] = useState<string | null>(null);
    const [projectPendingDelete, setProjectPendingDelete] = useState<Project | null>(null);
    const [viewerPendingDelete, setViewerPendingDelete] = useState<ViewerRecord | null>(null);
    const [projectForm, setProjectForm] = useState<ProjectFormState>(() => createProjectForm(user));
    const [viewerForm, setViewerForm] = useState<ViewerFormState>(EMPTY_VIEWER_FORM);

    const activeProjects = useMemo(() => projects.filter((project) => project.isActive !== false), [projects]);
    const readyProjectCount = useMemo(() => activeProjects.filter(isProjectReady).length, [activeProjects]);

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
                return createProjectForm(user, nextConnection.googleEmail || user.email);
            });
        } catch (error) {
            push({ tone: 'error', title: 'Failed to load setup data', description: error instanceof Error ? error.message : 'Unknown error' });
        } finally {
            setLoading(false);
        }
    }, [editingProjectId, push, user, user.role]);

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
        setResources(null);
        setProjectForm(createProjectForm(user, connection.googleEmail || user.email));
    };

    const startEditProject = (project: Project) => {
        setEditingProjectId(project.id);
        setResources(null);
        setProjectForm(toProjectForm(project));
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
            const data = await api.getGoogleResources(editingProjectId || null);
            setResources(data);
            setProjectForm((current) => ({
                ...current,
                googleConnectionEmail: data.connection.googleEmail || current.googleConnectionEmail || user.email,
                gscSiteUrl: current.gscSiteUrl || data.recommendations.gscSiteUrl || '',
                ga4PropertyId: current.ga4PropertyId || data.recommendations.ga4PropertyId || '',
            }));
            push({ tone: 'success', title: 'Google properties loaded', description: 'Pick the recommended Search Console and GA4 properties, then save the project.' });
        } catch (error) {
            push({ tone: 'error', title: 'Could not load Google properties', description: error instanceof Error ? error.message : 'Unknown error' });
        } finally {
            setGoogleLoading(false);
        }
    };

    const saveProject = async (event: React.FormEvent) => {
        event.preventDefault();
        setSavingProject(true);

        try {
            const payload = {
                ...projectForm,
                ownerEmail: user.role === 'admin' ? projectForm.ownerEmail : user.email,
                googleConnectionEmail: projectForm.googleConnectionEmail || connection.googleEmail || user.email,
                sheetGid: Number(projectForm.sheetGid || 0),
                auditMaxPages: Number(projectForm.auditMaxPages || 200),
            };

            if (editingProjectId) {
                await api.updateProject(editingProjectId, payload);
            } else {
                await api.createProject(payload);
            }

            push({
                tone: 'success',
                title: editingProjectId ? 'Project updated' : 'Project created',
                description: user.role === 'admin' ? 'Project settings saved.' : 'Setup saved. You can move to Dashboard when you are ready.',
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

            push({ tone: 'success', title: editingViewerEmail ? 'Viewer updated' : 'Viewer added' });
            resetViewerForm();
            await fetchData();
        } catch (error) {
            push({ tone: 'error', title: 'Could not save viewer', description: error instanceof Error ? error.message : 'Unknown error' });
        } finally {
            setSavingViewer(false);
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

    const projectStepState = {
        google: connection.connected,
        properties: Boolean(resources || projectForm.gscSiteUrl || projectForm.ga4PropertyId),
        details: Boolean(projectForm.name && projectForm.url),
    };

    return (
        <div className="min-h-screen bg-slate-50 pb-16 text-slate-900">
            <div className="mx-auto max-w-7xl space-y-8 px-6 pt-24">
                <div className="rounded-3xl border border-slate-200 bg-white p-8 shadow-sm">
                    <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
                        <div>
                            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-indigo-500">{user.role === 'admin' ? 'Admin workspace' : 'Client workspace'}</p>
                            <h1 className="mt-2 text-4xl font-black tracking-tight text-slate-900">{user.role === 'admin' ? 'Projects and Access' : 'Project Setup'}</h1>
                            <p className="mt-3 max-w-3xl text-sm text-slate-500">Connect Google, load the correct properties, save the project, and then run dashboard analysis or a deep audit without manual help.</p>
                        </div>
                        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700">
                            {readyProjectCount} ready projects - {activeProjects.length} active
                        </div>
                    </div>
                </div>

                <div className={`grid gap-8 ${user.role === 'admin' ? 'xl:grid-cols-[1.12fr_0.88fr]' : ''}`}>
                    <section className="space-y-6 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                        <div className="flex items-center gap-3">
                            <div className="rounded-2xl bg-indigo-50 p-3 text-indigo-600"><FolderCog className="h-5 w-5" /></div>
                            <div>
                                <h2 className="text-lg font-bold text-slate-900">{user.role === 'admin' ? 'Project workflow' : 'Self-serve workflow'}</h2>
                                <p className="text-sm text-slate-500">A cleaner setup sequence for real users opening their own projects.</p>
                            </div>
                        </div>

                        <div className="grid gap-3 md:grid-cols-3">
                            {[
                                { title: '1. Connect Google', done: projectStepState.google },
                                { title: '2. Load properties', done: projectStepState.properties },
                                { title: '3. Save project', done: projectStepState.details },
                            ].map((step) => (
                                <div key={step.title} className={`rounded-2xl border p-4 ${step.done ? 'border-emerald-200 bg-emerald-50' : 'border-slate-200 bg-slate-50'}`}>
                                    <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                                        {step.done ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : <AlertCircle className="h-4 w-4 text-slate-400" />}
                                        {step.title}
                                    </div>
                                </div>
                            ))}
                        </div>

                        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
                            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                                <div>
                                    <p className="text-sm font-semibold text-slate-900">{connection.connected ? `Connected as ${connection.googleEmail || connection.ownerEmail}` : 'Google not connected yet'}</p>
                                    <p className="mt-1 text-sm text-slate-500">Use the same Google account that already has access to your Search Console and GA4 properties.</p>
                                    <p className="mt-2 text-xs text-slate-400">Last updated: {formatDate(connection.updatedAt)}</p>
                                </div>
                                <div className="flex flex-wrap gap-2">
                                    {connection.connected && (
                                        <button type="button" onClick={() => void loadResources()} disabled={googleLoading} className="premium-button border border-slate-200 bg-white text-slate-700 hover:bg-slate-100">
                                            {googleLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                                            Load properties
                                        </button>
                                    )}
                                    <button type="button" onClick={handleConnectGoogle} className="premium-button bg-slate-900 text-white hover:bg-slate-800">
                                        <Link2 className="h-4 w-4" />
                                        {connection.connected ? 'Reconnect Google' : 'Connect Google'}
                                    </button>
                                </div>
                            </div>

                            {resources && (
                                <div className="mt-5 grid gap-4 md:grid-cols-2">
                                    <Field label="Recommended Search Console property">
                                        <select value={projectForm.gscSiteUrl} onChange={(event) => handleProjectField('gscSiteUrl', event.target.value)} className="premium-input py-3">
                                            <option value="">Choose Search Console property</option>
                                            {resources.sites.map((site) => <option key={site.siteUrl} value={site.siteUrl}>{site.label}</option>)}
                                        </select>
                                    </Field>
                                    <Field label="Recommended GA4 property">
                                        <select value={projectForm.ga4PropertyId} onChange={(event) => handleProjectField('ga4PropertyId', event.target.value)} className="premium-input py-3">
                                            <option value="">Choose GA4 property</option>
                                            {resources.properties.map((property) => <option key={property.propertyId} value={property.propertyId}>{property.label}</option>)}
                                        </select>
                                    </Field>
                                </div>
                            )}
                        </div>

                        <form onSubmit={saveProject} className="grid gap-4 md:grid-cols-2">
                            <Field label="Project name">
                                <input value={projectForm.name} onChange={(event) => handleProjectField('name', event.target.value)} className="premium-input py-3" placeholder="Example Inc" />
                            </Field>
                            <Field label="Project ID" hint="Used internally in saved history and jobs.">
                                <input value={projectForm.id} onChange={(event) => handleProjectField('id', event.target.value)} className="premium-input py-3" placeholder="example-inc" disabled={Boolean(editingProjectId)} />
                            </Field>
                            <Field label="Primary URL">
                                <input value={projectForm.url} onChange={(event) => handleProjectField('url', event.target.value)} className="premium-input py-3" placeholder="https://example.com/" />
                            </Field>
                            <Field label="Domain" hint="Optional if you want to override the domain derived from the URL.">
                                <input value={projectForm.domain} onChange={(event) => handleProjectField('domain', event.target.value)} className="premium-input py-3" placeholder="example.com" />
                            </Field>
                            {user.role === 'admin' && (
                                <Field label="Owner email">
                                    <input value={projectForm.ownerEmail} onChange={(event) => handleProjectField('ownerEmail', event.target.value)} className="premium-input py-3" placeholder="client@gmail.com" />
                                </Field>
                            )}
                            <Field label="Google connection email" hint="Usually the Google account you just connected.">
                                <input value={projectForm.googleConnectionEmail} onChange={(event) => handleProjectField('googleConnectionEmail', event.target.value)} className="premium-input py-3" placeholder="google-account@gmail.com" />
                            </Field>
                            <Field label="Search Console property" hint="Supports URL-prefix or sc-domain properties.">
                                <input value={projectForm.gscSiteUrl} onChange={(event) => handleProjectField('gscSiteUrl', event.target.value)} className="premium-input py-3" placeholder="https://example.com/ or sc-domain:example.com" />
                            </Field>
                            <Field label="GA4 property ID">
                                <input value={projectForm.ga4PropertyId} onChange={(event) => handleProjectField('ga4PropertyId', event.target.value)} className="premium-input py-3" placeholder="123456789" />
                            </Field>
                            <Field label="Audit max pages">
                                <input value={projectForm.auditMaxPages} onChange={(event) => handleProjectField('auditMaxPages', event.target.value)} className="premium-input py-3" type="number" min="1" max="500" />
                            </Field>
                            <Field label="Spreadsheet ID" hint="Optional - only needed if you want dashboard exports pushed to Google Sheets.">
                                <input value={projectForm.spreadsheetId} onChange={(event) => handleProjectField('spreadsheetId', event.target.value)} className="premium-input py-3" placeholder="Google Sheet ID" />
                            </Field>
                            <Field label="Sheet GID">
                                <input value={projectForm.sheetGid} onChange={(event) => handleProjectField('sheetGid', event.target.value)} className="premium-input py-3" type="number" />
                            </Field>

                            <div className="md:col-span-2 flex flex-wrap items-center gap-3">
                                <button type="submit" disabled={savingProject} className="premium-button bg-indigo-600 text-white hover:bg-indigo-700">
                                    {savingProject ? <Loader2 className="h-4 w-4 animate-spin" /> : editingProjectId ? <Save className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
                                    {editingProjectId ? 'Save project changes' : 'Create project'}
                                </button>
                                <button type="button" onClick={resetProjectForm} className="premium-button border border-slate-200 bg-white text-slate-700 hover:bg-slate-50">
                                    Clear form
                                </button>
                                {readyProjectCount > 0 && (
                                    <button type="button" onClick={() => navigate('/dashboard')} className="premium-button border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100">
                                        <CheckCircle2 className="h-4 w-4" />
                                        Go to dashboard
                                    </button>
                                )}
                            </div>
                        </form>

                        <div className="space-y-3">
                            <div className="flex items-center justify-between gap-3">
                                <h3 className="text-base font-bold text-slate-900">{user.role === 'admin' ? 'Projects' : 'Your projects'}</h3>
                                <span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">{activeProjects.length} active</span>
                            </div>

                            {activeProjects.map((project) => {
                                const ready = isProjectReady(project);
                                const canManage = canManageProject(project, user);

                                return (
                                    <div key={project.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                                        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                                            <div>
                                                <div className="flex flex-wrap items-center gap-2">
                                                    <span className="text-base font-bold text-slate-900">{project.name}</span>
                                                    <span className="rounded-full bg-white px-2 py-1 text-xs font-semibold text-slate-500">{project.id}</span>
                                                    <span className={`rounded-full px-2 py-1 text-xs font-semibold ${ready ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-800'}`}>
                                                        {ready ? 'Ready' : 'Needs setup'}
                                                    </span>
                                                </div>
                                                <p className="mt-1 text-sm text-slate-500">{project.url}</p>
                                                <p className="mt-2 text-xs text-slate-500">Owner: {project.ownerEmail || 'shared'} - GSC: {project.gscSiteUrl || 'Not set'} - GA4: {project.ga4PropertyId || 'Not set'}</p>
                                            </div>

                                            {canManage && (
                                                <div className="flex flex-wrap gap-2">
                                                    <button type="button" onClick={() => startEditProject(project)} className="premium-button border border-slate-200 bg-white text-slate-700 hover:bg-slate-100">
                                                        <Pencil className="h-4 w-4" />
                                                        {ready ? 'Edit' : 'Continue setup'}
                                                    </button>
                                                    <button type="button" onClick={() => setProjectPendingDelete(project)} className="premium-button border border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100">
                                                        <Trash2 className="h-4 w-4" />
                                                        Delete
                                                    </button>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                );
                            })}

                            {!loading && activeProjects.length === 0 && (
                                <div className="rounded-2xl border border-dashed border-slate-200 p-6 text-center text-sm text-slate-400">No projects yet. Connect Google, load your properties, and create the first one here.</div>
                            )}
                        </div>
                    </section>

                    {user.role === 'admin' && (
                        <section className="space-y-5 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                            <div className="flex items-center gap-3">
                                <div className="rounded-2xl bg-emerald-50 p-3 text-emerald-600"><Users className="h-5 w-5" /></div>
                                <div>
                                    <h2 className="text-lg font-bold text-slate-900">Viewer access</h2>
                                    <p className="text-sm text-slate-500">Keep invite-only access for teammates or clients who should not self-manage projects.</p>
                                </div>
                            </div>

                            <form onSubmit={saveViewer} className="space-y-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                                <Field label="Google email" fullWidth>
                                    <input value={viewerForm.email} onChange={(event) => setViewerForm((current) => ({ ...current, email: event.target.value }))} className="premium-input py-3" placeholder="viewer@gmail.com" disabled={Boolean(editingViewerEmail)} />
                                </Field>

                                <div className="space-y-2">
                                    <p className="text-sm font-medium text-slate-700">Product access</p>
                                    <div className="flex flex-wrap gap-2">
                                        {ACCESS_OPTIONS.map((option) => (
                                            <Toggle key={option.id} checked={viewerForm.access.includes(option.id)} label={option.label} onClick={() => handleViewerToggle('access', option.id)} />
                                        ))}
                                    </div>
                                </div>

                                <div className="space-y-2">
                                    <p className="text-sm font-medium text-slate-700">Project scope</p>
                                    <div className="flex flex-wrap gap-2">
                                        {activeProjects.map((project) => (
                                            <Toggle key={project.id} checked={viewerForm.projectIds.includes(project.id)} label={project.name} onClick={() => handleViewerToggle('projectIds', project.id)} />
                                        ))}
                                    </div>
                                </div>

                                <div className="flex flex-wrap items-center gap-3">
                                    <button type="submit" disabled={savingViewer} className="premium-button bg-emerald-600 text-white hover:bg-emerald-700">
                                        {savingViewer ? <Loader2 className="h-4 w-4 animate-spin" /> : <Shield className="h-4 w-4" />}
                                        {editingViewerEmail ? 'Save viewer' : 'Add viewer'}
                                    </button>
                                    <button type="button" onClick={resetViewerForm} className="premium-button border border-slate-200 bg-white text-slate-700 hover:bg-slate-50">
                                        Clear
                                    </button>
                                </div>
                            </form>

                            <div className="space-y-3">
                                {viewers.map((viewer) => (
                                    <div key={viewer.email} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                                        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                                            <div>
                                                <p className="font-semibold text-slate-900">{viewer.email}</p>
                                                <p className="mt-1 text-sm text-slate-500">Access: {viewer.access.join(', ') || 'No access'}</p>
                                                <p className="mt-1 text-sm text-slate-500">Projects: {viewer.projectIds.length ? viewer.projectIds.join(', ') : 'No projects assigned'}</p>
                                            </div>
                                            <div className="flex gap-2">
                                                <button type="button" onClick={() => startEditViewer(viewer)} className="premium-button border border-slate-200 bg-white text-slate-700 hover:bg-slate-100">
                                                    <Pencil className="h-4 w-4" />
                                                    Edit
                                                </button>
                                                <button type="button" onClick={() => setViewerPendingDelete(viewer)} className="premium-button border border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100">
                                                    <Trash2 className="h-4 w-4" />
                                                    Remove
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                ))}

                                {!loading && viewers.length === 0 && (
                                    <div className="rounded-2xl border border-dashed border-slate-200 p-6 text-center text-sm text-slate-400">No viewer accounts yet.</div>
                                )}
                            </div>
                        </section>
                    )}
                </div>
            </div>

            {projectPendingDelete && (
                <Modal title="Delete project" onClose={() => setProjectPendingDelete(null)}>
                    <div className="space-y-4">
                        <p className="text-sm text-slate-600">Delete <strong>{projectPendingDelete.name}</strong>? This permanently removes the project and clears its project-specific history and jobs.</p>
                        <div className="flex justify-end gap-3">
                            <button onClick={() => setProjectPendingDelete(null)} className="premium-button border border-slate-200 bg-white text-slate-700 hover:bg-slate-50">Cancel</button>
                            <button onClick={() => void deleteProject()} className="premium-button bg-rose-600 text-white hover:bg-rose-700">Delete project</button>
                        </div>
                    </div>
                </Modal>
            )}

            {viewerPendingDelete && (
                <Modal title="Remove viewer" onClose={() => setViewerPendingDelete(null)}>
                    <div className="space-y-4">
                        <p className="text-sm text-slate-600">Remove access for <strong>{viewerPendingDelete.email}</strong>?</p>
                        <div className="flex justify-end gap-3">
                            <button onClick={() => setViewerPendingDelete(null)} className="premium-button border border-slate-200 bg-white text-slate-700 hover:bg-slate-50">Cancel</button>
                            <button onClick={() => void deleteViewer()} className="premium-button bg-rose-600 text-white hover:bg-rose-700">Remove viewer</button>
                        </div>
                    </div>
                </Modal>
            )}
        </div>
    );
}
