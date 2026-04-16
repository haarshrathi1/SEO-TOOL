import type {
    AIAnalysisResult,
    AnalysisData,
    AuditJob,
    AuditResult,
    AuthConfigResponse,
    GoogleConnectionStatus,
    AuthSessionResponse,
    GoogleResourcesResponse,
    GoogleLoginResponse,
    HistoryItem,
    KeywordData,
    KeywordDataV2,
    KeywordAdsStatus,
    KeywordHistoryItem,
    KeywordJob,
    KeywordScanResult,
    PaginatedResult,
    Project,
    ViewerRecord,
} from './types';

const configuredApiBaseUrl = import.meta.env.VITE_API_BASE_URL?.trim().replace(/\/+$/, '');
const productionApiBaseUrl = 'https://seo-tool-tcqn.onrender.com';
const API_BASE_URL = configuredApiBaseUrl || (import.meta.env.PROD
    ? productionApiBaseUrl
    : 'http://localhost:3001');

export const getApiUrl = (endpoint: string) => `${API_BASE_URL}${endpoint}`;

async function handleResponse<T>(res: Response): Promise<T> {
    if (res.status === 401) {
        throw new Error('Unauthorized');
    }

    if (res.status === 403) {
        const json = await res.json().catch(() => ({} as Record<string, string>));
        throw new Error(json.error || 'Access Denied');
    }

    if (!res.ok) {
        const json = await res.json().catch(() => ({} as Record<string, string>));
        throw new Error(json.error || json.message || 'Request failed');
    }

    return res.json() as Promise<T>;
}

async function request<T>(endpoint: string, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers);
    if (init.body && !headers.has('Content-Type')) {
        headers.set('Content-Type', 'application/json');
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

    authMe: () => request<AuthSessionResponse>('/api/auth/me'),

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

    removeViewer: (email: string) => request<{ message: string }>(`/api/auth/viewers/${encodeURIComponent(email)}`, {
        method: 'DELETE',
    }),

    checkHealth: () => request<{ status: string; authenticated: boolean }>('/health'),

    getGoogleConnectionStatus: () => request<GoogleConnectionStatus>('/api/google/connection'),

    getGoogleResources: (projectId?: string | null) => request<GoogleResourcesResponse>(`/api/google/resources${createQuery({
        projectId: projectId || undefined,
    })}`),

    loginGoogle: () => {
        window.location.href = getApiUrl('/auth/google/login');
    },

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

    requestIndexing: (url: string) => request<AIAnalysisResult>('/api/indexing/publish', {
        method: 'POST',
        body: JSON.stringify({ url }),
    }),

    researchKeywords: (seed: string) => request<KeywordData>('/api/keywords/research', {
        method: 'POST',
        body: JSON.stringify({ seed }),
    }),

    researchKeywordsV2: (seed: string) => request<KeywordDataV2>('/api/keywords/research-v2', {
        method: 'POST',
        body: JSON.stringify({ seed }),
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
};

export const requestIndexing = api.requestIndexing;
