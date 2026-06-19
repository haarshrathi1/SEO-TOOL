import type {
    AnalysisData,
    AuditJob,
    AuditResult,
    DemoSnapshotResponse,
    AuthConfigResponse,
    GoogleConnectionStatus,
    AuthSessionResponse,
    GoogleResourcesResponse,
    GoogleLoginResponse,
    HistoryItem,
    KeywordAdsStatus,
    KeywordHistoryItem,
    KeywordJob,
    KeywordScanResult,
    PaginatedResult,
    Project,
    PSIData,
    ViewerRecord,
    WorkspaceMember,
} from './types';

const configuredApiBaseUrl = import.meta.env.VITE_API_BASE_URL?.trim().replace(/\/+$/, '');
const API_BASE_URL = configuredApiBaseUrl || (import.meta.env.PROD
    ? ''
    : 'http://localhost:3001');

export const getApiUrl = (endpoint: string) => `${API_BASE_URL}${endpoint}`;

let csrfTokenCache = '';

function maybeStoreCsrfToken(payload: unknown) {
    if (payload && typeof payload === 'object' && 'csrfToken' in payload) {
        const nextToken = (payload as { csrfToken?: unknown }).csrfToken;
        if (typeof nextToken === 'string' && nextToken.trim()) {
            csrfTokenCache = nextToken;
        }
    }
}

async function handleResponse<T>(res: Response): Promise<T> {
    if (res.status === 401) {
        csrfTokenCache = '';
        const json = await res.json().catch(() => ({} as Record<string, string>));
        throw new Error(json.error || json.message || 'Unauthorized');
    }

    if (res.status === 403) {
        const json = await res.json().catch(() => ({} as Record<string, string>));
        throw new Error(json.error || 'Access Denied');
    }

    if (!res.ok) {
        const json = await res.json().catch(() => ({} as Record<string, string>));
        throw new Error(json.error || json.message || 'Request failed');
    }

    const payload = await res.json() as T;
    maybeStoreCsrfToken(payload);
    return payload;
}

function isMutatingRequest(method?: string) {
    const normalized = String(method || 'GET').toUpperCase();
    return normalized !== 'GET' && normalized !== 'HEAD' && normalized !== 'OPTIONS';
}

async function getCsrfToken() {
    if (csrfTokenCache) {
        return csrfTokenCache;
    }

    const res = await fetch(getApiUrl('/api/auth/csrf'), {
        credentials: 'include',
    });

    if (!res.ok) {
        return '';
    }

    const payload = await res.json().catch(() => ({ csrfToken: '' }));
    maybeStoreCsrfToken(payload);
    return csrfTokenCache;
}

async function request<T>(endpoint: string, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers);
    if (init.body && !headers.has('Content-Type')) {
        headers.set('Content-Type', 'application/json');
    }

    if (isMutatingRequest(init.method)) {
        const csrfToken = await getCsrfToken();
        if (csrfToken) {
            headers.set('x-csrf-token', csrfToken);
        }
    }

    const res = await fetch(getApiUrl(endpoint), {
        ...init,
        headers,
        credentials: 'include',
    });

    return handleResponse<T>(res);
}

function createQuery(params: Record<string, string | boolean | number | null | undefined>) {
    const search = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
        if (value === undefined || value === null || value === '') {
            return;
        }
        search.set(key, String(value));
    });
    const query = search.toString();
    return query ? `?${query}` : '';
}

export const api = {
    googleLogin: (credential: string) => request<GoogleLoginResponse>('/api/auth/google-login', {
        method: 'POST',
        body: JSON.stringify({ credential }),
    }),

    googleRegister: (credential: string) => request<GoogleLoginResponse>('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify({ credential }),
    }),

    getAuthConfig: () => request<AuthConfigResponse>('/api/auth/config'),

    getDemoSnapshot: () => request<DemoSnapshotResponse>('/api/demo/summary'),

    authMe: () => request<AuthSessionResponse>('/api/auth/session'),

    logout: () => request<{ message: string }>('/api/auth/logout', { method: 'POST' }),

    addViewer: (email: string, access: string[] = ['keywords'], projectIds: string[] = [], features: string[] = []) => request<{ message: string; viewer: ViewerRecord }>('/api/auth/viewers', {
        method: 'POST',
        body: JSON.stringify({ email, access, projectIds, features }),
    }),

    updateViewer: (email: string, access: string[], projectIds: string[], features: string[] = []) => request<{ message: string; viewer: ViewerRecord }>(`/api/auth/viewers/${encodeURIComponent(email)}`, {
        method: 'PUT',
        body: JSON.stringify({ access, projectIds, features }),
    }),

    getViewers: () => request<ViewerRecord[]>('/api/auth/viewers'),

    getWorkspaceMembers: () => request<{ items: WorkspaceMember[] }>('/api/workspaces/current/members'),

    removeViewer: (email: string) => request<{ message: string }>(`/api/auth/viewers/${encodeURIComponent(email)}`, {
        method: 'DELETE',
    }),

    getGoogleConnectionStatus: () => request<GoogleConnectionStatus>('/api/google/connection'),

    getGoogleResources: (options: {
        projectId?: string | null;
        name?: string | null;
        domain?: string | null;
        url?: string | null;
        gscSiteUrl?: string | null;
        ga4PropertyId?: string | null;
    } = {}) => request<GoogleResourcesResponse>(`/api/google/resources${createQuery({
        projectId: options.projectId || undefined,
        name: options.name || undefined,
        domain: options.domain || undefined,
        url: options.url || undefined,
        gscSiteUrl: options.gscSiteUrl || undefined,
        ga4PropertyId: options.ga4PropertyId || undefined,
    })}`),

    connectProjectGoogle: (projectId?: string | null, redirectPath = '/projects') => {
        const query = createQuery({
            projectId: projectId || undefined,
            redirectPath,
        });
        window.location.href = getApiUrl(`/api/google/connect${query}`);
    },

    getProjects: (includeInactive = false) => request<Project[]>(`/api/projects${createQuery({ includeInactive: includeInactive ? 'true' : undefined })}`),

    createProject: (project: Partial<Project>) => request<Project>('/api/projects', {
        method: 'POST',
        body: JSON.stringify(project),
    }),

    updateProject: (projectId: string, project: Partial<Project>) => request<Project>(`/api/projects/${encodeURIComponent(projectId)}`, {
        method: 'PUT',
        body: JSON.stringify(project),
    }),

    archiveProject: (projectId: string) => request<Project>(`/api/projects/${encodeURIComponent(projectId)}${createQuery({ mode: 'archive' })}`, {
        method: 'DELETE',
    }),

    deleteProject: (projectId: string) => request<Project>(`/api/projects/${encodeURIComponent(projectId)}`, {
        method: 'DELETE',
    }),

    analyzeSite: (projectId: string) => request<AnalysisData>(`/api/analyze${createQuery({ projectId })}`),

    getHistory: (projectId?: string, options: { before?: string | null; limit?: number } = {}) => request<PaginatedResult<HistoryItem>>(`/api/history${createQuery({
        projectId,
        before: options.before,
        limit: options.limit,
    })}`),

    getAuditHistory: (projectId?: string, options: { before?: string | null; limit?: number } = {}) => request<PaginatedResult<{ id: string; timestamp: string; projectId: string; results: AuditResult[] }>>(`/api/audit/history${createQuery({
        projectId,
        before: options.before,
        limit: options.limit,
    })}`),

    createAuditJob: (projectId: string) => request<AuditJob>('/api/audit/jobs', {
        method: 'POST',
        body: JSON.stringify({ projectId }),
    }),

    getAuditJobs: (projectId?: string) => request<AuditJob[]>(`/api/audit/jobs${createQuery({ projectId })}`),

    getAuditJob: (jobId: string) => request<AuditJob>(`/api/audit/jobs/${encodeURIComponent(jobId)}`),

    getAuditJobResult: (jobId: string) => request<AuditJob>(`/api/audit/jobs/${encodeURIComponent(jobId)}/result`),

    cancelAuditJob: (jobId: string) => request<AuditJob>(`/api/audit/jobs/${encodeURIComponent(jobId)}`, { method: 'DELETE' }),

    createGscDeepAuditJob: (projectId: string) => request<AuditJob>('/api/audit/gsc-deep', {
        method: 'POST',
        body: JSON.stringify({ projectId }),
    }),

    requestIndexing: (url: string, projectId?: string) => request<{ url: string; notifyTime?: string }>('/api/indexing/publish', {
        method: 'POST',
        body: JSON.stringify({ url, projectId }),
    }),

    checkSpeed: (url: string, projectId: string) => request<{ url: string; psi_score?: number; psi_data?: PSIData }>('/api/audit/speed', {
        method: 'POST',
        body: JSON.stringify({ url, projectId }),
    }),

    getKeywordAdsStatus: () => request<KeywordAdsStatus>('/api/keywords/ads-access', {
        cache: 'no-store',
        headers: {
            'Cache-Control': 'no-cache',
        },
    }),

    createKeywordJob: (seed: string, projectId?: string | null) => request<KeywordJob>('/api/keywords/jobs', {
        method: 'POST',
        body: JSON.stringify({ seed, projectId: projectId ?? null }),
    }),

    getKeywordJobs: (projectId?: string | null) => request<KeywordJob[]>(`/api/keywords/jobs${createQuery({ projectId: projectId || undefined })}`),

    getKeywordJob: (jobId: string, projectId?: string | null) => request<KeywordJob>(`/api/keywords/jobs/${encodeURIComponent(jobId)}${createQuery({ projectId: projectId || undefined })}`),

    getKeywordJobResult: (jobId: string, projectId?: string | null) => request<KeywordJob>(`/api/keywords/jobs/${encodeURIComponent(jobId)}/result${createQuery({ projectId: projectId || undefined })}`),

    getKeywordHistory: (projectId?: string | null, options: { before?: string | null; limit?: number } = {}) => request<PaginatedResult<KeywordHistoryItem>>(`/api/keywords/history${createQuery({
        projectId: projectId || undefined,
        before: options.before,
        limit: options.limit,
    })}`),

    analyzeContent: (url: string, content?: string) => request<Record<string, unknown>>('/api/ai/analyze', {
        method: 'POST',
        body: JSON.stringify({ url, content }),
    }),

    analyzePageKeywords: (url: string) => request<KeywordScanResult>('/api/keywords/analyze-content', {
        method: 'POST',
        body: JSON.stringify({ url }),
    }),

    sendChatMessage: (projectId: string, message: string) => request<{ message: string }>('/api/chat/message', {
        method: 'POST',
        body: JSON.stringify({ projectId, message }),
    }),

    getChatHistory: (projectId: string) => request<{ messages: { role: string; content: string; timestamp: string }[] }>(`/api/chat/history?projectId=${encodeURIComponent(projectId)}`),

    clearChatHistory: (projectId: string) => request<{ message: string }>(`/api/chat/history?projectId=${encodeURIComponent(projectId)}`, {
        method: 'DELETE',
    }),
};

export const requestIndexing = api.requestIndexing;
