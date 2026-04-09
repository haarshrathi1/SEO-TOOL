import { useCallback, useEffect, useMemo, useState } from 'react';
import { FolderCog, Loader2, Pencil, Plus, Save, Shield, Trash2, Users } from 'lucide-react';
import { api } from './api';
import Modal from './components/common/Modal';
import { useToast } from './toast';
import type { Project, ViewerRecord } from './types';

const ACCESS_OPTIONS = [
    { id: 'keywords', label: 'Keyword tool' },
    { id: 'dashboard', label: 'Dashboard' },
    { id: 'audit', label: 'Audit jobs' },
] as const;

interface ProjectFormState {
    id: string;
    name: string;
    domain: string;
    url: string;
    ga4PropertyId: string;
    spreadsheetId: string;
    sheetGid: string;
    auditMaxPages: string;
}

interface ViewerFormState {
    email: string;
    access: string[];
    features: string[];
    projectIds: string[];
}

const emptyProjectForm: ProjectFormState = {
    id: '',
    name: '',
    domain: '',
    url: '',
    ga4PropertyId: '',
    spreadsheetId: '',
    sheetGid: '0',
    auditMaxPages: '200',
};

const emptyViewerForm: ViewerFormState = {
    email: '',
    access: ['keywords'],
    features: [],
    projectIds: [],
};

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

export default function ProjectsPage() {
    const { push } = useToast();
    const [projects, setProjects] = useState<Project[]>([]);
    const [viewers, setViewers] = useState<ViewerRecord[]>([]);
    const [loading, setLoading] = useState(true);
    const [savingProject, setSavingProject] = useState(false);
    const [savingViewer, setSavingViewer] = useState(false);
    const [editingProjectId, setEditingProjectId] = useState<string | null>(null);
    const [editingViewerEmail, setEditingViewerEmail] = useState<string | null>(null);
    const [projectForm, setProjectForm] = useState<ProjectFormState>(emptyProjectForm);
    const [viewerForm, setViewerForm] = useState<ViewerFormState>(emptyViewerForm);
    const [projectPendingArchive, setProjectPendingArchive] = useState<Project | null>(null);
    const [viewerPendingDelete, setViewerPendingDelete] = useState<ViewerRecord | null>(null);

    const activeProjects = useMemo(() => projects.filter((project) => project.isActive !== false), [projects]);

    const fetchData = useCallback(async () => {
        setLoading(true);
        try {
            const [projectData, viewerData] = await Promise.all([
                api.getProjects(true),
                api.getViewers(),
            ]);
            setProjects(projectData);
            setViewers(viewerData);
        } catch (error) {
            push({ tone: 'error', title: 'Failed to load admin data', description: error instanceof Error ? error.message : 'Unknown error' });
        } finally {
            setLoading(false);
        }
    }, [push]);

    useEffect(() => {
        void fetchData();
    }, [fetchData]);

    const handleProjectField = (field: keyof ProjectFormState, value: string) => {
        setProjectForm((current) => ({ ...current, [field]: value }));
    };

    const handleViewerToggle = (field: 'access' | 'features' | 'projectIds', value: string) => {
        setViewerForm((current) => {
            const nextValues = current[field].includes(value)
                ? current[field].filter((entry) => entry !== value)
                : [...current[field], value];
            return { ...current, [field]: nextValues };
        });
    };

    const resetProjectForm = () => {
        setEditingProjectId(null);
        setProjectForm(emptyProjectForm);
    };

    const resetViewerForm = () => {
        setEditingViewerEmail(null);
        setViewerForm(emptyViewerForm);
    };

    const startEditProject = (project: Project) => {
        setEditingProjectId(project.id);
        setProjectForm({
            id: project.id,
            name: project.name,
            domain: project.domain,
            url: project.url,
            ga4PropertyId: project.ga4PropertyId || '',
            spreadsheetId: project.spreadsheetId || '',
            sheetGid: String(project.sheetGid ?? 0),
            auditMaxPages: String(project.auditMaxPages ?? 200),
        });
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

    const submitProject = async (event: React.FormEvent) => {
        event.preventDefault();
        setSavingProject(true);
        try {
            const payload = {
                id: projectForm.id,
                name: projectForm.name,
                domain: projectForm.domain,
                url: projectForm.url,
                ga4PropertyId: projectForm.ga4PropertyId,
                spreadsheetId: projectForm.spreadsheetId,
                sheetGid: Number(projectForm.sheetGid || 0),
                auditMaxPages: Number(projectForm.auditMaxPages || 200),
            };

            if (editingProjectId) {
                await api.updateProject(editingProjectId, payload);
                push({ tone: 'success', title: 'Project updated' });
            } else {
                await api.createProject(payload);
                push({ tone: 'success', title: 'Project created' });
            }

            resetProjectForm();
            await fetchData();
        } catch (error) {
            push({ tone: 'error', title: 'Could not save project', description: error instanceof Error ? error.message : 'Unknown error' });
        } finally {
            setSavingProject(false);
        }
    };

    const submitViewer = async (event: React.FormEvent) => {
        event.preventDefault();
        setSavingViewer(true);
        try {
            if (editingViewerEmail) {
                await api.updateViewer(editingViewerEmail, viewerForm.access, viewerForm.projectIds, viewerForm.features);
                push({ tone: 'success', title: 'Viewer updated' });
            } else {
                await api.addViewer(viewerForm.email, viewerForm.access, viewerForm.projectIds, viewerForm.features);
                push({ tone: 'success', title: 'Viewer added' });
            }

            resetViewerForm();
            await fetchData();
        } catch (error) {
            push({ tone: 'error', title: 'Could not save viewer', description: error instanceof Error ? error.message : 'Unknown error' });
        } finally {
            setSavingViewer(false);
        }
    };

    const archiveProject = async () => {
        if (!projectPendingArchive) return;
        try {
            await api.archiveProject(projectPendingArchive.id);
            push({ tone: 'success', title: 'Project archived' });
            setProjectPendingArchive(null);
            await fetchData();
        } catch (error) {
            push({ tone: 'error', title: 'Could not archive project', description: error instanceof Error ? error.message : 'Unknown error' });
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

    return (
        <div className="min-h-screen bg-slate-50 pb-16 text-slate-900">
            <div className="mx-auto max-w-7xl space-y-8 px-6 pt-24">
                <div className="rounded-3xl border border-slate-200 bg-white p-8 shadow-sm">
                    <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
                        <div>
                            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-indigo-500">Admin workspace</p>
                            <h1 className="mt-2 text-4xl font-black tracking-tight text-slate-900">Projects and Access</h1>
                            <p className="mt-3 max-w-2xl text-sm text-slate-500">Create new projects, control crawl limits and integrations, and assign viewer access to the exact projects they should see.</p>
                        </div>
                        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700">
                            {activeProjects.length} active projects · {viewers.length} viewer accounts
                        </div>
                    </div>
                </div>

                <div className="grid gap-8 xl:grid-cols-[1.1fr_0.9fr]">
                    <section className="space-y-5 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                        <div className="flex items-center justify-between gap-4">
                            <div className="flex items-center gap-3">
                                <div className="rounded-2xl bg-indigo-50 p-3 text-indigo-600"><FolderCog className="h-5 w-5" /></div>
                                <div>
                                    <h2 className="text-lg font-bold text-slate-900">Project setup</h2>
                                    <p className="text-sm text-slate-500">Mongo-backed project definitions replace the old hard-coded list.</p>
                                </div>
                            </div>
                            {loading && <Loader2 className="h-4 w-4 animate-spin text-slate-400" />}
                        </div>

                        <form onSubmit={submitProject} className="grid gap-4 md:grid-cols-2">
                            <label className="space-y-2 text-sm font-medium text-slate-700">
                                <span>Project name</span>
                                <input value={projectForm.name} onChange={(event) => handleProjectField('name', event.target.value)} className="premium-input py-3" placeholder="Laserlift Solutions" />
                            </label>
                            <label className="space-y-2 text-sm font-medium text-slate-700">
                                <span>Project ID</span>
                                <input value={projectForm.id} onChange={(event) => handleProjectField('id', event.target.value)} className="premium-input py-3" placeholder="laserlift" disabled={Boolean(editingProjectId)} />
                            </label>
                            <label className="space-y-2 text-sm font-medium text-slate-700">
                                <span>Primary URL</span>
                                <input value={projectForm.url} onChange={(event) => handleProjectField('url', event.target.value)} className="premium-input py-3" placeholder="https://example.com/" />
                            </label>
                            <label className="space-y-2 text-sm font-medium text-slate-700">
                                <span>Domain</span>
                                <input value={projectForm.domain} onChange={(event) => handleProjectField('domain', event.target.value)} className="premium-input py-3" placeholder="example.com" />
                            </label>
                            <label className="space-y-2 text-sm font-medium text-slate-700">
                                <span>GA4 property ID</span>
                                <input value={projectForm.ga4PropertyId} onChange={(event) => handleProjectField('ga4PropertyId', event.target.value)} className="premium-input py-3" placeholder="123456789" />
                            </label>
                            <label className="space-y-2 text-sm font-medium text-slate-700">
                                <span>Crawl max pages</span>
                                <input value={projectForm.auditMaxPages} onChange={(event) => handleProjectField('auditMaxPages', event.target.value)} className="premium-input py-3" type="number" min="1" max="500" />
                            </label>
                            <label className="space-y-2 text-sm font-medium text-slate-700">
                                <span>Spreadsheet ID</span>
                                <input value={projectForm.spreadsheetId} onChange={(event) => handleProjectField('spreadsheetId', event.target.value)} className="premium-input py-3" placeholder="Google Sheet ID" />
                            </label>
                            <label className="space-y-2 text-sm font-medium text-slate-700">
                                <span>Sheet GID</span>
                                <input value={projectForm.sheetGid} onChange={(event) => handleProjectField('sheetGid', event.target.value)} className="premium-input py-3" type="number" />
                            </label>
                            <div className="md:col-span-2 flex items-center gap-3">
                                <button type="submit" disabled={savingProject} className="premium-button bg-indigo-600 text-white hover:bg-indigo-700">
                                    {savingProject ? <Loader2 className="h-4 w-4 animate-spin" /> : editingProjectId ? <Save className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
                                    {editingProjectId ? 'Update project' : 'Create project'}
                                </button>
                                {(editingProjectId || projectForm.name || projectForm.url) && (
                                    <button type="button" onClick={resetProjectForm} className="premium-button border border-slate-200 bg-white text-slate-700 hover:bg-slate-50">
                                        Clear
                                    </button>
                                )}
                            </div>
                        </form>

                        <div className="space-y-3">
                            {projects.map((project) => (
                                <div key={project.id} className={`rounded-2xl border p-4 ${project.isActive === false ? 'border-slate-200 bg-slate-50 text-slate-400' : 'border-slate-200 bg-slate-50 text-slate-900'}`}>
                                    <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                                        <div>
                                            <div className="flex flex-wrap items-center gap-2">
                                                <span className="text-base font-bold">{project.name}</span>
                                                <span className="rounded-full bg-white px-2 py-1 text-xs font-semibold text-slate-500">{project.id}</span>
                                                {project.isActive === false && <span className="rounded-full bg-slate-200 px-2 py-1 text-xs font-semibold">Archived</span>}
                                            </div>
                                            <p className="mt-1 text-sm text-slate-500">{project.url}</p>
                                            <p className="mt-2 text-xs text-slate-500">GA4: {project.ga4PropertyId || 'Not set'} · Max crawl: {project.auditMaxPages || 200} pages</p>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <button type="button" onClick={() => startEditProject(project)} className="premium-button border border-slate-200 bg-white text-slate-700 hover:bg-slate-100">
                                                <Pencil className="h-4 w-4" /> Edit
                                            </button>
                                            {project.isActive !== false && (
                                                <button type="button" onClick={() => setProjectPendingArchive(project)} className="premium-button border border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100">
                                                    <Trash2 className="h-4 w-4" /> Archive
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </section>

                    <section className="space-y-5 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                        <div className="flex items-center gap-3">
                            <div className="rounded-2xl bg-emerald-50 p-3 text-emerald-600"><Users className="h-5 w-5" /></div>
                            <div>
                                <h2 className="text-lg font-bold text-slate-900">Viewer access</h2>
                                    <p className="text-sm text-slate-500">Assign product surfaces and project scopes. Keyword users automatically receive Google Ads enrichment when the provider is configured and quota is available.</p>
                            </div>
                        </div>

                        <form onSubmit={submitViewer} className="space-y-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                            <label className="space-y-2 text-sm font-medium text-slate-700">
                                <span>Google email</span>
                                <input value={viewerForm.email} onChange={(event) => setViewerForm((current) => ({ ...current, email: event.target.value }))} className="premium-input py-3" placeholder="viewer@gmail.com" disabled={Boolean(editingViewerEmail)} />
                            </label>

                            <div className="space-y-2">
                                <p className="text-sm font-medium text-slate-700">Product access</p>
                                <div className="flex flex-wrap gap-2">
                                    {ACCESS_OPTIONS.map((option) => (
                                        <Toggle
                                            key={option.id}
                                            checked={viewerForm.access.includes(option.id)}
                                            label={option.label}
                                            onClick={() => handleViewerToggle('access', option.id)}
                                        />
                                    ))}
                                </div>
                            </div>

                            <div className="space-y-2">
                                <p className="text-sm font-medium text-slate-700">Project scope</p>
                                <div className="flex flex-wrap gap-2">
                                    {activeProjects.map((project) => (
                                        <Toggle
                                            key={project.id}
                                            checked={viewerForm.projectIds.includes(project.id)}
                                            label={project.name}
                                            onClick={() => handleViewerToggle('projectIds', project.id)}
                                        />
                                    ))}
                                    {activeProjects.length === 0 && <p className="text-sm text-slate-400">Create a project before assigning viewer scope.</p>}
                                </div>
                            </div>

                            <div className="rounded-2xl border border-amber-100 bg-amber-50 px-4 py-3 text-xs leading-relaxed text-amber-900">
                                Any viewer with keyword access gets Google Ads enrichment automatically when the provider is configured. Non-admin users share the same quota policy: 2 fresh requests per day and 5 per week. Cached seeds do not consume quota.
                            </div>

                            <div className="flex items-center gap-3">
                                <button type="submit" disabled={savingViewer} className="premium-button bg-emerald-600 text-white hover:bg-emerald-700">
                                    {savingViewer ? <Loader2 className="h-4 w-4 animate-spin" /> : <Shield className="h-4 w-4" />}
                                    {editingViewerEmail ? 'Update viewer' : 'Add viewer'}
                                </button>
                                {(editingViewerEmail || viewerForm.email) && (
                                    <button type="button" onClick={resetViewerForm} className="premium-button border border-slate-200 bg-white text-slate-700 hover:bg-slate-50">
                                        Clear
                                    </button>
                                )}
                            </div>
                        </form>

                        <div className="space-y-3">
                            {viewers.map((viewer) => (
                                <div key={viewer.email} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                                    <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                                        <div>
                                            <p className="font-semibold text-slate-900">{viewer.email}</p>
                                            <p className="mt-1 text-sm text-slate-500">Access: {viewer.access.join(', ') || 'No access'}</p>
                                            <p className="mt-1 text-sm text-slate-500">Ads quota: {viewer.access.includes('keywords') ? '2/day · 5/week' : 'Not applicable'}</p>
                                            <p className="mt-1 text-sm text-slate-500">Projects: {viewer.projectIds.length ? viewer.projectIds.join(', ') : 'No projects assigned'}</p>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <button type="button" onClick={() => startEditViewer(viewer)} className="premium-button border border-slate-200 bg-white text-slate-700 hover:bg-slate-100">
                                                <Pencil className="h-4 w-4" /> Edit
                                            </button>
                                            <button type="button" onClick={() => setViewerPendingDelete(viewer)} className="premium-button border border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100">
                                                <Trash2 className="h-4 w-4" /> Remove
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
                </div>
            </div>

            {projectPendingArchive && (
                <Modal title="Archive project" onClose={() => setProjectPendingArchive(null)}>
                    <div className="space-y-4">
                        <p className="text-sm text-slate-600">Archive <strong>{projectPendingArchive.name}</strong>? Existing history stays intact, but the project will disappear from active lists.</p>
                        <div className="flex justify-end gap-3">
                            <button onClick={() => setProjectPendingArchive(null)} className="premium-button border border-slate-200 bg-white text-slate-700 hover:bg-slate-50">Cancel</button>
                            <button onClick={() => void archiveProject()} className="premium-button bg-rose-600 text-white hover:bg-rose-700">Archive project</button>
                        </div>
                    </div>
                </Modal>
            )}

            {viewerPendingDelete && (
                <Modal title="Remove viewer" onClose={() => setViewerPendingDelete(null)}>
                    <div className="space-y-4">
                        <p className="text-sm text-slate-600">Remove access for <strong>{viewerPendingDelete.email}</strong>? The session will be revoked on the next request.</p>
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


