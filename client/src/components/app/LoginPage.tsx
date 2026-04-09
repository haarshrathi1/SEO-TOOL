import { useCallback, useEffect, useState } from 'react';
import { Brain, Loader2 } from 'lucide-react';
import { api } from '../../api';
import type { AuthUser } from '../../types';

interface GoogleCredentialResponse {
    credential: string;
}

type AuthMode = 'login' | 'register';

interface GoogleIdentityClient {
    initialize(config: {
        client_id: string;
        callback: (response: GoogleCredentialResponse) => void;
        auto_select: boolean;
        ux_mode: 'popup';
    }): void;
    renderButton(element: HTMLElement, options: {
        theme: 'outline';
        size: 'large';
        shape: 'pill';
        width: number;
        text: 'signin_with' | 'signup_with';
        logo_alignment: 'left';
    }): void;
    disableAutoSelect(): void;
}

declare global {
    interface Window {
        google?: {
            accounts?: {
                id?: GoogleIdentityClient;
            };
        };
    }
}

function getErrorMessage(error: unknown, fallback: string): string {
    return error instanceof Error ? error.message : fallback;
}

export default function LoginPage({ onLogin }: { onLogin: (user: AuthUser) => void }) {
    const [authMode, setAuthMode] = useState<AuthMode>('login');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const [configLoading, setConfigLoading] = useState(true);
    const [googleClientId, setGoogleClientId] = useState('');

    const handleCredential = useCallback(async (response: GoogleCredentialResponse) => {
        if (!response.credential) {
            setError('Google did not return a valid credential.');
            return;
        }

        setLoading(true);
        setError('');
        try {
            const res = authMode === 'register'
                ? await api.googleRegister(response.credential)
                : await api.googleLogin(response.credential);
            onLogin(res.user);
        } catch (issue) {
            setError(getErrorMessage(issue, authMode === 'register' ? 'Registration failed' : 'Login failed'));
        } finally {
            setLoading(false);
        }
    }, [authMode, onLogin]);

    useEffect(() => {
        const renderGoogleButton = (clientId: string) => {
            const googleId = window.google?.accounts?.id;
            const buttonElement = document.getElementById('google-auth-btn');

            if (!googleId || !(buttonElement instanceof HTMLElement)) {
                setError('Failed to initialize Google Sign-In.');
                setConfigLoading(false);
                return;
            }

            buttonElement.innerHTML = '';
            googleId.initialize({
                client_id: clientId,
                callback: handleCredential,
                auto_select: false,
                ux_mode: 'popup',
            });
            googleId.renderButton(buttonElement, {
                theme: 'outline',
                size: 'large',
                shape: 'pill',
                width: 360,
                text: authMode === 'register' ? 'signup_with' : 'signin_with',
                logo_alignment: 'left',
            });
            setConfigLoading(false);
        };

        const initGoogle = async () => {
            try {
                let nextClientId = googleClientId;
                if (!nextClientId) {
                    const config = await api.getAuthConfig();
                    if (!config.googleClientId) {
                        throw new Error('Google client ID is missing from the server config.');
                    }
                    nextClientId = config.googleClientId;
                    setGoogleClientId(nextClientId);
                }

                if (window.google?.accounts?.id) {
                    renderGoogleButton(nextClientId);
                    return;
                }

                const existingScript = document.querySelector('script[src="https://accounts.google.com/gsi/client"]');
                if (existingScript) {
                    existingScript.addEventListener('load', () => renderGoogleButton(nextClientId), { once: true });
                    return;
                }

                const script = document.createElement('script');
                script.src = 'https://accounts.google.com/gsi/client';
                script.async = true;
                script.defer = true;
                script.onload = () => renderGoogleButton(nextClientId);
                script.onerror = () => {
                    setError('Failed to load Google Sign-In.');
                    setConfigLoading(false);
                };
                document.head.appendChild(script);
            } catch (issue) {
                setError(getErrorMessage(issue, 'Failed to load login config'));
                setConfigLoading(false);
            }
        };

        setConfigLoading(true);
        void initGoogle();
    }, [authMode, googleClientId, handleCredential]);

    return (
        <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-50 via-white to-indigo-50/40 p-6">
            <div className="w-full max-w-md">
                <div className="mb-8 text-center">
                    <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-600 shadow-lg shadow-indigo-200">
                        <Brain className="h-8 w-8 text-white" />
                    </div>
                    <h1 className="text-3xl font-extrabold tracking-tight text-slate-900">SEO Intelligence</h1>
                    <p className="mt-1 text-sm text-slate-500">Choose how you want to use Google access in the app</p>
                </div>

                <div className="space-y-5 rounded-2xl border border-slate-200 bg-white p-8" style={{ boxShadow: '0 10px 25px -5px rgb(0 0 0 / 0.06)' }}>
                    {error && (
                        <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm font-medium text-rose-600">{error}</div>
                    )}

                    <div className="grid gap-3 sm:grid-cols-2">
                        <button
                            type="button"
                            onClick={() => setAuthMode('login')}
                            className={`rounded-2xl border px-4 py-4 text-left transition ${authMode === 'login' ? 'border-indigo-500 bg-indigo-50 text-indigo-900' : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300'}`}
                        >
                            <p className="text-sm font-semibold">Sign in</p>
                            <p className="mt-1 text-xs leading-relaxed text-slate-500">Use your existing access level, whether that is admin, viewer, or keyword-only.</p>
                        </button>
                        <button
                            type="button"
                            onClick={() => setAuthMode('register')}
                            className={`rounded-2xl border px-4 py-4 text-left transition ${authMode === 'register' ? 'border-emerald-500 bg-emerald-50 text-emerald-900' : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300'}`}
                        >
                            <p className="text-sm font-semibold">Register for keyword research</p>
                            <p className="mt-1 text-xs leading-relaxed text-slate-500">Create a self-serve keyword workspace. Dashboard, audit, and project access still stay admin-assigned.</p>
                        </button>
                    </div>

                    {(loading || configLoading) && (
                        <div className="flex justify-center py-4">
                            <Loader2 className="h-6 w-6 animate-spin text-indigo-500" />
                        </div>
                    )}

                    <div id="google-auth-btn" className="flex justify-center" />

                    <div className="rounded-2xl border border-slate-100 bg-slate-50 p-4 text-xs leading-relaxed text-slate-500">
                        {authMode === 'register'
                            ? 'Registration creates a keyword-only viewer account with Google Ads enrichment applied automatically, subject to daily and weekly usage limits.'
                            : 'Sign in uses the access already stored for your Google email. Admin and viewer permissions are still managed on the server.'}
                    </div>
                </div>
                <p className="mt-6 text-center text-xs text-slate-400">seotool.harshrathi.com</p>
            </div>
        </div>
    );
}
