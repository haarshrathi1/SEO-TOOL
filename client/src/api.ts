import type { KeywordData, KeywordDataV2 } from './types';

// Dynamic API base — same origin in production (served by Express), localhost in dev
const configuredApiBaseUrl = import.meta.env.VITE_API_BASE_URL?.trim().replace(/\/+$/, '');
const API_BASE_URL = configuredApiBaseUrl || (import.meta.env.PROD
    ? window.location.origin
    : 'http://localhost:3001');

export const getApiUrl = (endpoint: string) => `${API_BASE_URL}${endpoint}`;

// Token management
function getToken(): string | null {
    return localStorage.getItem('seo_token');
}
export function setToken(token: string) {
    localStorage.setItem('seo_token', token);
}
export function clearToken() {
    localStorage.removeItem('seo_token');
}

// Headers with auth
function authHeaders(): Record<string, string> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const token = getToken();
    if (token) headers['Authorization'] = `Bearer ${token}`;
    return headers;
}

const handleResponse = async (res: Response) => {
    if (res.status === 401) {
        clearToken();
        throw new Error('Unauthorized');
    }
    if (res.status === 403) throw new Error('Access Denied');
    if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error || json.message || 'Request failed');
    }
    return res.json();
};

export const api = {
    // ─── Auth ────────────────────────────────────────────────────────
    googleLogin: (credential: string) =>
        fetch(getApiUrl('/api/auth/google-login'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ credential }),
        }).then(handleResponse),

    getAuthConfig: () =>
        fetch(getApiUrl('/api/auth/config')).then(handleResponse),

    authMe: () =>
        fetch(getApiUrl('/api/auth/me'), { headers: authHeaders() }).then(handleResponse),

    addViewer: (email: string, access: string[] = ['keywords']) =>
        fetch(getApiUrl('/api/auth/viewers'), {
            method: 'POST',
            headers: authHeaders(),
            body: JSON.stringify({ email, access }),
        }).then(handleResponse),

    getViewers: () =>
        fetch(getApiUrl('/api/auth/viewers'), { headers: authHeaders() }).then(handleResponse),

    removeViewer: (email: string) =>
        fetch(getApiUrl(`/api/auth/viewers/${encodeURIComponent(email)}`), {
            method: 'DELETE',
            headers: authHeaders(),
        }).then(handleResponse),

    // ─── Health & Google OAuth ────────────────────────────────────────
    checkHealth: () => fetch(getApiUrl('/health')).then(handleResponse),
    loginGoogle: () => { window.location.href = getApiUrl('/auth/google/login'); },

    // ─── Projects ────────────────────────────────────────────────────
    getProjects: () => fetch(getApiUrl('/api/projects'), { headers: authHeaders() }).then(handleResponse),

    // ─── Dashboard ───────────────────────────────────────────────────
    analyzeSite: (projectId: string) =>
        fetch(getApiUrl(`/api/analyze?projectId=${projectId}`), { headers: authHeaders(), credentials: 'include' }).then(handleResponse),
    getHistory: () =>
        fetch(getApiUrl('/api/history'), { headers: authHeaders() }).then(handleResponse),

    // ─── Audit ───────────────────────────────────────────────────────
    getAuditHistory: () =>
        fetch(getApiUrl('/api/audit/history'), { headers: authHeaders() }).then(handleResponse),
    runAudit: (projectId: string) =>
        fetch(getApiUrl('/api/audit'), {
            method: 'POST',
            headers: authHeaders(),
            credentials: 'include',
            body: JSON.stringify({ projectId }),
        }).then(handleResponse),

    // ─── Indexing ────────────────────────────────────────────────────
    requestIndexing: (url: string) =>
        fetch(getApiUrl('/api/indexing/publish'), {
            method: 'POST',
            headers: authHeaders(),
            body: JSON.stringify({ url }),
        }).then(handleResponse),

    // ─── Keywords ────────────────────────────────────────────────────
    researchKeywords: (seed: string) =>
        fetch(getApiUrl('/api/keywords/research'), {
            method: 'POST',
            headers: authHeaders(),
            body: JSON.stringify({ seed }),
        }).then(handleResponse) as Promise<KeywordData>,

    researchKeywordsV2: (seed: string) =>
        fetch(getApiUrl('/api/keywords/research-v2'), {
            method: 'POST',
            headers: authHeaders(),
            body: JSON.stringify({ seed }),
        }).then(handleResponse) as Promise<KeywordDataV2>,

    getKeywordHistory: () =>
        fetch(getApiUrl('/api/keywords/history'), { headers: authHeaders() }).then(handleResponse),

    saveKeywordResearch: (data: KeywordData | KeywordDataV2) =>
        fetch(getApiUrl('/api/keywords/save'), {
            method: 'POST',
            headers: authHeaders(),
            body: JSON.stringify(data),
        }).then(handleResponse),

    // ─── AI ──────────────────────────────────────────────────────────
    analyzeContent: (url: string, content?: string) =>
        fetch(getApiUrl('/api/ai/analyze'), {
            method: 'POST',
            headers: authHeaders(),
            body: JSON.stringify({ url, content }),
        }).then(handleResponse),

    analyzePageKeywords: (url: string) =>
        fetch(getApiUrl('/api/keywords/analyze-content'), {
            method: 'POST',
            headers: authHeaders(),
            body: JSON.stringify({ url }),
        }).then(handleResponse),
};

export const requestIndexing = api.requestIndexing;

