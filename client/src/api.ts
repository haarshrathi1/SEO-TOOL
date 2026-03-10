import type {
    AIAnalysisResult,
    AnalysisData,
    AuditResult,
    AuthConfigResponse,
    AuthSessionResponse,
    GoogleLoginResponse,
    HistoryItem,
    KeywordData,
    KeywordDataV2,
    KeywordHistoryItem,
    KeywordScanResult,
    Project,
    ViewerRecord,
} from './types';

const configuredApiBaseUrl = import.meta.env.VITE_API_BASE_URL?.trim().replace(/\/+$/, '');
const API_BASE_URL = configuredApiBaseUrl || (import.meta.env.PROD
    ? window.location.origin
    : 'http://localhost:3001');

export const getApiUrl = (endpoint: string) => `${API_BASE_URL}${endpoint}`;

function getToken(): string | null {
    return localStorage.getItem('seo_token');
}

export function setToken(token: string) {
    localStorage.setItem('seo_token', token);
}

export function clearToken() {
    localStorage.removeItem('seo_token');
}

function authHeaders(): Record<string, string> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const token = getToken();
    if (token) {
        headers.Authorization = `Bearer ${token}`;
    }
    return headers;
}

async function handleResponse<T>(res: Response): Promise<T> {
    if (res.status === 401) {
        clearToken();
        throw new Error('Unauthorized');
    }

    if (res.status === 403) {
        throw new Error('Access Denied');
    }

    if (!res.ok) {
        const json = await res.json().catch(() => ({} as Record<string, string>));
        throw new Error(json.error || json.message || 'Request failed');
    }

    return res.json() as Promise<T>;
}

export const api = {
    googleLogin: (credential: string) =>
        fetch(getApiUrl('/api/auth/google-login'), {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ credential }),
        }).then((res) => handleResponse<GoogleLoginResponse>(res)),

    getAuthConfig: () =>
        fetch(getApiUrl('/api/auth/config'), { credentials: 'include' }).then((res) => handleResponse<AuthConfigResponse>(res)),

    authMe: () =>
        fetch(getApiUrl('/api/auth/me'), {
            headers: authHeaders(),
            credentials: 'include',
        }).then((res) => handleResponse<AuthSessionResponse>(res)),

    logout: () =>
        fetch(getApiUrl('/api/auth/logout'), {
            method: 'POST',
            headers: authHeaders(),
            credentials: 'include',
        }).then((res) => handleResponse<{ message: string }>(res)),

    addViewer: (email: string, access: string[] = ['keywords']) =>
        fetch(getApiUrl('/api/auth/viewers'), {
            method: 'POST',
            headers: authHeaders(),
            credentials: 'include',
            body: JSON.stringify({ email, access }),
        }).then((res) => handleResponse<{ message: string; viewer: ViewerRecord }>(res)),

    getViewers: () =>
        fetch(getApiUrl('/api/auth/viewers'), {
            headers: authHeaders(),
            credentials: 'include',
        }).then((res) => handleResponse<ViewerRecord[]>(res)),

    removeViewer: (email: string) =>
        fetch(getApiUrl(`/api/auth/viewers/${encodeURIComponent(email)}`), {
            method: 'DELETE',
            headers: authHeaders(),
            credentials: 'include',
        }).then((res) => handleResponse<{ message: string }>(res)),

    checkHealth: () =>
        fetch(getApiUrl('/health'), { credentials: 'include' }).then((res) => handleResponse<{ status: string; authenticated: boolean }>(res)),

    loginGoogle: () => {
        window.location.href = getApiUrl('/auth/google/login');
    },

    getProjects: () =>
        fetch(getApiUrl('/api/projects'), {
            headers: authHeaders(),
            credentials: 'include',
        }).then((res) => handleResponse<Project[]>(res)),

    analyzeSite: (projectId: string) =>
        fetch(getApiUrl(`/api/analyze?projectId=${projectId}`), {
            headers: authHeaders(),
            credentials: 'include',
        }).then((res) => handleResponse<AnalysisData>(res)),

    getHistory: () =>
        fetch(getApiUrl('/api/history'), {
            headers: authHeaders(),
            credentials: 'include',
        }).then((res) => handleResponse<HistoryItem[]>(res)),

    getAuditHistory: () =>
        fetch(getApiUrl('/api/audit/history'), {
            headers: authHeaders(),
            credentials: 'include',
        }).then((res) => handleResponse<{ id: string; timestamp: string; projectId: string; results: AuditResult[] }[]>(res)),

    runAudit: (projectId: string) =>
        fetch(getApiUrl('/api/audit'), {
            method: 'POST',
            headers: authHeaders(),
            credentials: 'include',
            body: JSON.stringify({ projectId }),
        }).then((res) => handleResponse<AuditResult[]>(res)),

    requestIndexing: (url: string) =>
        fetch(getApiUrl('/api/indexing/publish'), {
            method: 'POST',
            headers: authHeaders(),
            credentials: 'include',
            body: JSON.stringify({ url }),
        }).then((res) => handleResponse<AIAnalysisResult>(res)),

    researchKeywords: (seed: string) =>
        fetch(getApiUrl('/api/keywords/research'), {
            method: 'POST',
            headers: authHeaders(),
            credentials: 'include',
            body: JSON.stringify({ seed }),
        }).then((res) => handleResponse<KeywordData>(res)),

    researchKeywordsV2: (seed: string) =>
        fetch(getApiUrl('/api/keywords/research-v2'), {
            method: 'POST',
            headers: authHeaders(),
            credentials: 'include',
            body: JSON.stringify({ seed }),
        }).then((res) => handleResponse<KeywordDataV2>(res)),

    getKeywordHistory: () =>
        fetch(getApiUrl('/api/keywords/history'), {
            headers: authHeaders(),
            credentials: 'include',
        }).then((res) => handleResponse<KeywordHistoryItem[]>(res)),

    saveKeywordResearch: (data: KeywordData | KeywordDataV2) =>
        fetch(getApiUrl('/api/keywords/save'), {
            method: 'POST',
            headers: authHeaders(),
            credentials: 'include',
            body: JSON.stringify(data),
        }).then((res) => handleResponse<KeywordHistoryItem>(res)),

    analyzeContent: (url: string, content?: string) =>
        fetch(getApiUrl('/api/ai/analyze'), {
            method: 'POST',
            headers: authHeaders(),
            credentials: 'include',
            body: JSON.stringify({ url, content }),
        }).then((res) => handleResponse<Record<string, unknown>>(res)),

    analyzePageKeywords: (url: string) =>
        fetch(getApiUrl('/api/keywords/analyze-content'), {
            method: 'POST',
            headers: authHeaders(),
            credentials: 'include',
            body: JSON.stringify({ url }),
        }).then((res) => handleResponse<KeywordScanResult>(res)),
};

export const requestIndexing = api.requestIndexing;
