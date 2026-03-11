import { useCallback, useEffect, useState } from 'react';
import { Brain, Loader2 } from 'lucide-react';
import { api } from '../../api';
import type { AuthUser } from '../../types';

interface GoogleCredentialResponse {
    credential: string;
}

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
        text: 'signin_with';
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
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const [configLoading, setConfigLoading] = useState(true);

    const handleCredential = useCallback(async (response: GoogleCredentialResponse) => {
        if (!response.credential) {
            setError('Google did not return a valid credential.');
            return;
        }

        setLoading(true);
        setError('');
        try {
            const res = await api.googleLogin(response.credential);
            onLogin(res.user);
        } catch (issue) {
            setError(getErrorMessage(issue, 'Login failed'));
        } finally {
            setLoading(false);
        }
    }, [onLogin]);

    useEffect(() => {
        const renderGoogleButton = (clientId: string) => {
            const googleId = window.google?.accounts?.id;
            const buttonElement = document.getElementById('google-signin-btn');

            if (!googleId || !(buttonElement instanceof HTMLElement)) {
                setError('Failed to initialize Google Sign-In.');
                setConfigLoading(false);
                return;
            }

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
                text: 'signin_with',
                logo_alignment: 'left',
            });
            setConfigLoading(false);
        };

        const initGoogle = async () => {
            try {
                const config = await api.getAuthConfig();
                if (!config.googleClientId) {
                    throw new Error('Google client ID is missing from the server config.');
                }

                if (window.google?.accounts?.id) {
                    renderGoogleButton(config.googleClientId);
                    return;
                }

                const script = document.createElement('script');
                script.src = 'https://accounts.google.com/gsi/client';
                script.async = true;
                script.defer = true;
                script.onload = () => renderGoogleButton(config.googleClientId);
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

        void initGoogle();
    }, [handleCredential]);

    return (
        <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-50 via-white to-indigo-50/40 p-6">
            <div className="w-full max-w-md">
                <div className="mb-8 text-center">
                    <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-600 shadow-lg shadow-indigo-200">
                        <Brain className="h-8 w-8 text-white" />
                    </div>
                    <h1 className="text-3xl font-extrabold tracking-tight text-slate-900">SEO Intelligence</h1>
                    <p className="mt-1 text-sm text-slate-500">Sign in with Google to access your tools</p>
                </div>

                <div className="space-y-5 rounded-2xl border border-slate-200 bg-white p-8" style={{ boxShadow: '0 10px 25px -5px rgb(0 0 0 / 0.06)' }}>
                    {error && (
                        <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm font-medium text-rose-600">{error}</div>
                    )}

                    {(loading || configLoading) && (
                        <div className="flex justify-center py-4">
                            <Loader2 className="h-6 w-6 animate-spin text-indigo-500" />
                        </div>
                    )}

                    <div id="google-signin-btn" className="flex justify-center" />

                    <p className="text-center text-xs leading-relaxed text-slate-400">
                        Admin access comes from the Mongo admin list.<br />
                        Viewer access is managed by an admin inside the app.
                    </p>
                </div>
                <p className="mt-6 text-center text-xs text-slate-400">seotool.harshrathi.com</p>
            </div>
        </div>
    );
}
