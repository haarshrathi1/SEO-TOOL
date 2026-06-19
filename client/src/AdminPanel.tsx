import { useCallback, useEffect, useMemo, useState } from 'react';
import {
    CheckCircle2,
    Grid3X3,
    Loader2,
    Lock,
    Pencil,
    Shield,
    Trash2,
    UserPlus,
    Users,
} from 'lucide-react';
import { api } from './api';
import Modal from './components/common/Modal';
import { useToast } from './toast';
import type { AuthUser, Project, ViewerRecord, WorkspaceMember } from './types';

type ViewerFormState = {
    email: string;
    access: string[];
    features: string[];
    projectIds: string[];
};

const ACCESS_OPTIONS = [
    { id: 'keywords', label: 'Keyword tool', desc: 'AI keyword research & blog briefs' },
    { id: 'dashboard', label: 'Dashboard', desc: 'GSC/GA4 analytics & history' },
    { id: 'audit', label: 'Audit jobs', desc: 'Site crawl, technical SEO audit' },
] as const;

const EMPTY_VIEWER_FORM: ViewerFormState = {
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
            className={`border-2 border-black px-3 py-2 text-xs font-black uppercase tracking-wide transition-all duration-150 ${checked
                ? 'bg-black text-white shadow-none translate-x-[2px] translate-y-[2px]'
                : 'bg-white text-black shadow-[3px_3px_0px_0px_#000] hover:translate-x-[1px] hover:translate-y-[1px] hover:shadow-[2px_2px_0px_0px_#000]'
                }`}
        >
            {checked && <span className="mr-1">✓</span>}{label}
        </button>
    );
}

function initials(nameOrEmail: string) {
    return nameOrEmail.slice(0, 2).toUpperCase();
}

function roleTone(role: WorkspaceMember['role']) {
    switch (role) {
        case 'owner': return 'bg-yellow-300';
        case 'admin': return 'bg-orange-200';
        case 'member': return 'bg-blue-100';
        default: return 'bg-slate-100';
    }
}

export default function AdminPanel({ user }: { user: AuthUser }) {
    const { push } = useToast();
    const [projects, setProjects] = useState<Project[]>([]);
    const [viewers, setViewers] = useState<ViewerRecord[]>([]);
    const [members, setMembers] = useState<WorkspaceMember[]>([]);
    const [loading, setLoading] = useState(true);
    const [savingViewer, setSavingViewer] = useState(false);
    const [editingViewerEmail, setEditingViewerEmail] = useState<string | null>(null);
    const [viewerPendingDelete, setViewerPendingDelete] = useState<ViewerRecord | null>(null);
    const [viewerForm, setViewerForm] = useState<ViewerFormState>(EMPTY_VIEWER_FORM);
    const [matrixSaving, setMatrixSaving] = useState('');

    const activeProjects = useMemo(
        () => projects.filter((project) => project.isActive !== false),
        [projects],
    );

    const fetchData = useCallback(async () => {
        setLoading(true);
        try {
            const [projectData, viewerData, memberData] = await Promise.all([
                api.getProjects(true),
                api.getViewers(),
                api.getWorkspaceMembers(),
            ]);

            setProjects(projectData);
            setViewers(viewerData);
            setMembers(memberData.items || []);
        } catch (error) {
            push({
                tone: 'error',
                title: 'Failed to load admin panel',
                description: error instanceof Error ? error.message : 'Unknown error',
            });
        } finally {
            setLoading(false);
        }
    }, [push]);

    useEffect(() => {
        void fetchData();
    }, [fetchData]);

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

            push({
                tone: 'success',
                title: editingViewerEmail ? 'User updated' : 'User invited',
                description: editingViewerEmail ? 'Access changes were saved.' : 'The new user can now sign in to this workspace.',
            });
            resetViewerForm();
            await fetchData();
        } catch (error) {
            push({
                tone: 'error',
                title: 'Could not save user',
                description: error instanceof Error ? error.message : 'Unknown error',
            });
        } finally {
            setSavingViewer(false);
        }
    };

    const deleteViewer = async () => {
        if (!viewerPendingDelete) return;

        try {
            await api.removeViewer(viewerPendingDelete.email);
            push({ tone: 'success', title: 'User removed' });
            setViewerPendingDelete(null);
            await fetchData();
        } catch (error) {
            push({
                tone: 'error',
                title: 'Could not remove user',
                description: error instanceof Error ? error.message : 'Unknown error',
            });
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
            setViewers((current) => current.map((entry) => (
                entry.email === viewer.email ? { ...entry, projectIds: nextProjectIds } : entry
            )));
        } catch (error) {
            push({
                tone: 'error',
                title: 'Could not update project access',
                description: error instanceof Error ? error.message : 'Unknown error',
            });
        } finally {
            setMatrixSaving('');
        }
    };

    const managedViewerEmails = useMemo(
        () => new Set(viewers.map((v) => v.email)),
        [viewers],
    );

    const ownerAdminMembers = useMemo(
        () => members.filter((m) => m.role === 'owner' || m.role === 'admin'),
        [members],
    );

    const managedViewerMembers = useMemo(
        () => members.filter((m) => managedViewerEmails.has(m.email)),
        [members, managedViewerEmails],
    );

    return (
        <div className="operator-shell text-slate-900 font-sans selection:bg-black selection:text-white pb-20">
            <div className="max-w-7xl mx-auto px-6 pt-8 space-y-8">
                <section className="border-2 border-black bg-white" style={{ boxShadow: '8px 8px 0 0 #000' }}>
                    {/* ── Header ── */}
                    <div className="border-b-2 border-black bg-black px-6 py-4 text-white">
                        <div className="flex items-center justify-between gap-4 flex-wrap">
                            <div className="flex items-center gap-3">
                                <Shield className="w-5 h-5" />
                                <div>
                                    <p className="text-lg font-black uppercase tracking-tight">Admin Panel</p>
                                    <p className="text-[10px] font-black uppercase tracking-[0.2em] text-white/70">
                                        {user.workspaceName || user.email} · Workspace Admin
                                    </p>
                                </div>
                            </div>
                            <div className="flex gap-2 text-[11px] font-black uppercase">
                                <span className="border border-white/30 bg-white/10 px-3 py-1 text-white">{members.length} Members</span>
                                <span className="border border-white/30 bg-white/10 px-3 py-1 text-white">{activeProjects.length} Projects</span>
                            </div>
                        </div>
                    </div>

                    <div className="grid gap-6 p-6 xl:grid-cols-[1.1fr_0.9fr]">

                        {/* ── LEFT: User Access Form + Members List ── */}
                        <div className="space-y-6">

                            {/* User Access Form */}
                            <div className="border-2 border-black bg-slate-50 p-5">
                                <div className="flex items-start justify-between gap-2 border-b-2 border-black/10 pb-3 mb-4">
                                    <div className="flex items-center gap-2.5">
                                        <div className="p-1.5 bg-black border-2 border-black">
                                            {editingViewerEmail
                                                ? <Pencil className="w-3.5 h-3.5 text-white" />
                                                : <UserPlus className="w-3.5 h-3.5 text-white" />
                                            }
                                        </div>
                                        <div>
                                            <p className="text-sm font-black uppercase">
                                                {editingViewerEmail ? 'Editing User' : 'Invite New User'}
                                            </p>
                                            {editingViewerEmail && (
                                                <p className="text-[10px] font-bold text-slate-500 mt-0.5">{editingViewerEmail}</p>
                                            )}
                                        </div>
                                    </div>
                                    {editingViewerEmail && (
                                        <span className="border border-black bg-blue-100 px-2 py-0.5 text-[10px] font-black uppercase shrink-0">Editing</span>
                                    )}
                                </div>

                                <form onSubmit={(event) => void saveViewer(event)} className="space-y-4">
                                    <div>
                                        <label className="mb-1.5 block text-[11px] font-black uppercase tracking-[0.15em] text-slate-500">Google Email</label>
                                        <div className="relative">
                                            <input
                                                value={viewerForm.email}
                                                onChange={(event) => setViewerForm((current) => ({ ...current, email: event.target.value }))}
                                                disabled={Boolean(editingViewerEmail)}
                                                placeholder="viewer@gmail.com"
                                                className={`w-full border-2 border-black bg-white px-4 py-3 text-sm font-bold outline-none ${editingViewerEmail ? 'pr-10 text-slate-500' : ''}`}
                                            />
                                            {editingViewerEmail && (
                                                <Lock className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                                            )}
                                        </div>
                                        {editingViewerEmail && (
                                            <p className="text-[10px] text-slate-400 font-bold mt-1">Email can't be changed — delete and re-invite to update it.</p>
                                        )}
                                    </div>

                                    <div className="space-y-2">
                                        <p className="text-[11px] font-black uppercase tracking-[0.15em] text-slate-500">Product Access</p>
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
                                        <div className="mb-1.5">
                                            <p className="text-[11px] font-black uppercase tracking-[0.15em] text-slate-500">Project Access</p>
                                            <p className="text-[10px] text-slate-400 font-bold mt-0.5">Leave empty to grant access to all current projects.</p>
                                        </div>
                                        {activeProjects.length === 0 ? (
                                            <div className="border-2 border-amber-200 bg-amber-50 px-3 py-2">
                                                <p className="text-xs font-bold text-amber-700">No projects yet — create projects in the Projects page first.</p>
                                            </div>
                                        ) : (
                                            <div className="flex flex-wrap gap-2">
                                                {activeProjects.map((project) => (
                                                    <Toggle
                                                        key={project.id}
                                                        checked={viewerForm.projectIds.includes(project.id)}
                                                        label={project.name}
                                                        onClick={() => handleViewerToggle('projectIds', project.id)}
                                                    />
                                                ))}
                                            </div>
                                        )}
                                    </div>

                                    <div className="flex flex-wrap gap-3 pt-2 border-t-2 border-black/10">
                                        <button
                                            type="submit"
                                            disabled={savingViewer}
                                            className="operator-button-primary px-5 py-2.5"
                                        >
                                            {savingViewer ? <Loader2 className="w-4 h-4 animate-spin" /> : <Shield className="w-4 h-4" />}
                                            {editingViewerEmail ? 'Save Changes' : 'Invite User'}
                                        </button>
                                        <button
                                            type="button"
                                            onClick={resetViewerForm}
                                            className="operator-button-secondary px-5 py-2.5"
                                        >
                                            {editingViewerEmail ? 'Cancel' : 'Clear'}
                                        </button>
                                    </div>
                                </form>
                            </div>

                            {/* Workspace Members List */}
                            <div className="border-2 border-black bg-white">
                                <div className="border-b-2 border-black px-5 py-4 flex items-center justify-between gap-3">
                                    <div className="flex items-center gap-3">
                                        <Users className="w-5 h-5" />
                                        <div>
                                            <p className="text-sm font-black uppercase">Workspace Members</p>
                                            <p className="text-[10px] font-bold uppercase text-slate-500">Owners, admins, and managed viewers.</p>
                                        </div>
                                    </div>
                                    <span className="border border-black bg-white px-3 py-1 text-[11px] font-black uppercase">{members.length} Total</span>
                                </div>

                                {loading && (
                                    <div className="p-6 text-xs font-black uppercase text-slate-400 flex items-center gap-2">
                                        <Loader2 className="w-4 h-4 animate-spin" /> Loading members
                                    </div>
                                )}

                                {!loading && (
                                    <div>
                                        {/* Owners & Admins group */}
                                        {ownerAdminMembers.length > 0 && (
                                            <div>
                                                <div className="px-5 pt-4 pb-2">
                                                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Workspace Owners &amp; Admins</p>
                                                </div>
                                                <div className="divide-y divide-slate-100">
                                                    {ownerAdminMembers.map((member) => (
                                                        <MemberRow
                                                            key={member.email}
                                                            member={member}
                                                            assignedProjects={activeProjects.filter((p) =>
                                                                (member.projectIds || []).includes(p.id)
                                                            )}
                                                            isManagedViewer={false}
                                                            isEditing={false}
                                                            onEdit={() => {}}
                                                            onDelete={() => {}}
                                                        />
                                                    ))}
                                                </div>
                                            </div>
                                        )}

                                        {/* Managed Viewers group */}
                                        {managedViewerMembers.length > 0 && (
                                            <div className={ownerAdminMembers.length > 0 ? 'border-t-2 border-black/10' : ''}>
                                                <div className="px-5 pt-4 pb-2">
                                                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Managed Viewers</p>
                                                </div>
                                                <div className="divide-y divide-slate-100">
                                                    {managedViewerMembers.map((member) => {
                                                        const viewer = viewers.find((v) => v.email === member.email) || null;
                                                        const isEditing = editingViewerEmail === member.email;
                                                        return (
                                                            <MemberRow
                                                                key={member.email}
                                                                member={member}
                                                                assignedProjects={activeProjects.filter((p) =>
                                                                    (viewer?.projectIds || []).includes(p.id)
                                                                )}
                                                                isManagedViewer={true}
                                                                isEditing={isEditing}
                                                                onEdit={() => {
                                                                    if (!viewer) return;
                                                                    isEditing ? resetViewerForm() : startEditViewer(viewer);
                                                                }}
                                                                onDelete={() => {
                                                                    if (!viewer) return;
                                                                    setViewerPendingDelete(viewer);
                                                                }}
                                                            />
                                                        );
                                                    })}
                                                </div>
                                            </div>
                                        )}

                                        {/* Viewers not yet in members (invited but not logged in) */}
                                        {viewers.filter((v) => !members.some((m) => m.email === v.email)).map((viewer) => {
                                            const isEditing = editingViewerEmail === viewer.email;
                                            return (
                                                <div key={viewer.email} className="border-t divide-y divide-slate-100">
                                                    <div className="p-4 flex items-center justify-between gap-4">
                                                        <div className="flex items-center gap-3 min-w-0 flex-1">
                                                            <div className="w-9 h-9 border-2 border-black bg-slate-100 flex items-center justify-center text-xs font-black shrink-0">
                                                                {viewer.email.slice(0, 2).toUpperCase()}
                                                            </div>
                                                            <div className="min-w-0">
                                                                <div className="flex items-center gap-2 flex-wrap mb-1">
                                                                    <p className="text-sm font-black uppercase text-black truncate">{viewer.email}</p>
                                                                    <span className="border border-black bg-yellow-200 px-2 py-0.5 text-[9px] font-black uppercase">Pending</span>
                                                                </div>
                                                                <div className="flex gap-1.5 flex-wrap">
                                                                    {viewer.access.map((a) => (
                                                                        <span key={a} className="border border-black bg-blue-100 px-2 py-0.5 text-[9px] font-black uppercase">{a}</span>
                                                                    ))}
                                                                </div>
                                                            </div>
                                                        </div>
                                                        <div className="flex gap-2 shrink-0">
                                                            <button
                                                                type="button"
                                                                onClick={() => isEditing ? resetViewerForm() : startEditViewer(viewer)}
                                                                className="operator-button-secondary px-2.5 py-2"
                                                            >
                                                                <Pencil className="w-4 h-4" />
                                                            </button>
                                                            <button
                                                                type="button"
                                                                onClick={() => setViewerPendingDelete(viewer)}
                                                                className="border-2 border-black bg-red-100 px-2.5 py-2 hover:bg-red-200"
                                                            >
                                                                <Trash2 className="w-4 h-4" />
                                                            </button>
                                                        </div>
                                                    </div>
                                                </div>
                                            );
                                        })}

                                        {members.length === 0 && viewers.length === 0 && (
                                            <div className="p-8 text-center">
                                                <Users className="w-10 h-10 text-slate-300 mx-auto mb-2" />
                                                <p className="text-xs font-black uppercase text-slate-400">No members yet</p>
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* ── RIGHT: Access Matrix ── */}
                        <div>
                            <div className="border-2 border-black bg-white">
                                <div className="border-b-2 border-black px-5 py-4 flex items-center gap-3">
                                    <Grid3X3 className="w-5 h-5" />
                                    <div>
                                        <p className="text-sm font-black uppercase">Project Access Matrix</p>
                                        <p className="text-[10px] font-bold uppercase text-slate-500">Manage access by clicking cells below.</p>
                                    </div>
                                </div>

                                <div className="p-5">
                                    {viewers.length === 0 || activeProjects.length === 0 ? (
                                        <div className="border-2 border-dashed border-slate-300 p-8 text-center">
                                            <Grid3X3 className="w-10 h-10 text-slate-300 mx-auto mb-2" />
                                            <p className="text-xs font-black uppercase text-slate-400">
                                                {viewers.length === 0 ? 'Invite users first' : 'Create projects first'}
                                            </p>
                                            <p className="text-[10px] font-bold text-slate-400 mt-1">
                                                The matrix appears once you have both projects and users.
                                            </p>
                                        </div>
                                    ) : (
                                        <>
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
                                                                            {initials(viewer.name || viewer.email)}
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
                                                                <td className="border-r-2 border-b-2 border-black px-3 py-3 font-black uppercase whitespace-nowrap">
                                                                    {project.name}
                                                                </td>
                                                                {viewers.map((viewer) => {
                                                                    const hasAccess = viewer.projectIds.includes(project.id);
                                                                    const cellKey = `${viewer.email}::${project.id}`;
                                                                    const saving = matrixSaving === cellKey;

                                                                    return (
                                                                        <td key={viewer.email} className="border-r-2 border-b-2 border-black px-3 py-3 text-center last:border-r-0">
                                                                            <button
                                                                                type="button"
                                                                                disabled={saving}
                                                                                onClick={() => void handleMatrixToggle(viewer, project.id)}
                                                                                aria-label={hasAccess
                                                                                    ? `Revoke ${viewer.email} from ${project.name}`
                                                                                    : `Grant ${viewer.email} access to ${project.name}`
                                                                                }
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

                                            <div className="flex items-center gap-4 pt-3">
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
                                                <div className="ml-auto text-[10px] font-bold text-slate-400 uppercase">Click to toggle</div>
                                            </div>
                                        </>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>
                </section>
            </div>

            {viewerPendingDelete && (
                <Modal title="Remove user" onClose={() => setViewerPendingDelete(null)}>
                    <div className="space-y-5">
                        <div className="border-2 border-black bg-red-50 p-4">
                            <p className="text-sm font-bold text-black">
                                Remove access for <strong className="font-black">{viewerPendingDelete.email}</strong>?
                            </p>
                            <p className="text-xs font-bold text-slate-600 mt-1">They will no longer be able to sign in to this workspace.</p>
                        </div>
                        <div className="flex justify-end gap-3">
                            <button
                                onClick={() => setViewerPendingDelete(null)}
                                className="operator-button-secondary px-5 py-2.5"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={() => void deleteViewer()}
                                className="border-2 border-black bg-red-500 text-white px-5 py-2.5 text-xs font-black uppercase hover:bg-red-600 transition-all inline-flex items-center gap-2"
                                style={{ boxShadow: '4px 4px 0 0 #000' }}
                            >
                                <Trash2 className="w-4 h-4" /> Remove User
                            </button>
                        </div>
                    </div>
                </Modal>
            )}
        </div>
    );
}

function MemberRow({
    member,
    assignedProjects,
    isManagedViewer,
    isEditing,
    onEdit,
    onDelete,
}: {
    member: WorkspaceMember;
    assignedProjects: Project[];
    isManagedViewer: boolean;
    isEditing: boolean;
    onEdit: () => void;
    onDelete: () => void;
}) {
    return (
        <div className={`p-4 flex items-start justify-between gap-4 ${isEditing ? 'bg-blue-50' : ''}`}>
            <div className="min-w-0 flex-1">
                <div className="flex items-center gap-3 mb-2">
                    {member.picture ? (
                        <img
                            src={member.picture}
                            alt=""
                            className="w-9 h-9 border-2 border-black object-cover shrink-0"
                        />
                    ) : (
                        <div
                            className="w-9 h-9 border-2 border-black bg-black text-white flex items-center justify-center text-xs font-black shrink-0"
                        >
                            {(member.name || member.email).slice(0, 2).toUpperCase()}
                        </div>
                    )}
                    <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                            <p className="text-sm font-black uppercase text-black truncate">{member.name || member.email}</p>
                            <span className={`border border-black px-2 py-0.5 text-[9px] font-black uppercase ${roleTone(member.role)}`}>{member.role}</span>
                        </div>
                        <p className="text-[11px] font-bold text-slate-500 truncate">{member.email}</p>
                    </div>
                </div>

                {(member.access || []).length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mb-1.5">
                        {(member.access || []).map((access) => (
                            <span key={access} className="border border-black bg-blue-100 px-2 py-0.5 text-[9px] font-black uppercase">{access}</span>
                        ))}
                    </div>
                )}

                {assignedProjects.length > 0 && (
                    <p className="text-[10px] font-bold uppercase text-emerald-700">
                        {assignedProjects.map((p) => p.name).join(' · ')}
                    </p>
                )}
            </div>

            {isManagedViewer && (
                <div className="flex gap-2 shrink-0">
                    <button
                        type="button"
                        onClick={onEdit}
                        className="operator-button-secondary px-2.5 py-2"
                        title={isEditing ? 'Cancel' : 'Edit user'}
                    >
                        <Pencil className="w-4 h-4" />
                    </button>
                    <button
                        type="button"
                        onClick={onDelete}
                        className="border-2 border-black bg-red-100 px-2.5 py-2 hover:bg-red-200"
                        title="Remove user"
                    >
                        <Trash2 className="w-4 h-4" />
                    </button>
                </div>
            )}
        </div>
    );
}
