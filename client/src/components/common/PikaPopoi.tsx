import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronDown, Crown, Send, Sparkles, Trash2, X } from 'lucide-react';
import type { Project } from '../../types';
import { api } from '../../api';

interface ChatMsg {
    role: 'user' | 'assistant';
    content: string;
    timestamp: string;
}

const QUICK_PROMPTS = [
    'What are my top 3 SEO issues?',
    'How are my Core Web Vitals?',
    'Best keyword opportunities?',
    'How is my schema markup?',
];

// ── Markdown renderer ──────────────────────────────────────────────────────────

function renderInline(text: string) {
    const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
    if (parts.length === 1) return <>{text}</>;
    return (
        <>
            {parts.map((part, i) => {
                if (part.startsWith('**') && part.endsWith('**')) {
                    return <strong key={i} className="font-semibold">{part.slice(2, -2)}</strong>;
                }
                if (part.startsWith('`') && part.endsWith('`')) {
                    return <code key={i} className="rounded bg-slate-200 px-1 py-0.5 text-[11px] font-mono text-slate-700">{part.slice(1, -1)}</code>;
                }
                return <span key={i}>{part}</span>;
            })}
        </>
    );
}

function MarkdownContent({ content, isUser }: { content: string; isUser: boolean }) {
    const lines = content.split('\n');
    const nodes: React.ReactNode[] = [];
    let bullets: string[] = [];
    let k = 0;

    const flushBullets = () => {
        if (!bullets.length) return;
        nodes.push(
            <ul key={k++} className="my-1 space-y-1">
                {bullets.map((item, i) => (
                    <li key={i} className="flex items-start gap-2">
                        <span className={`mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full ${isUser ? 'bg-indigo-300' : 'bg-indigo-400'}`} />
                        <span>{renderInline(item)}</span>
                    </li>
                ))}
            </ul>
        );
        bullets = [];
    };

    lines.forEach((line) => {
        const trimmed = line.trim();
        if (/^[-*•]\s+/.test(trimmed)) {
            bullets.push(trimmed.replace(/^[-*•]\s+/, ''));
        } else if (trimmed) {
            flushBullets();
            nodes.push(<p key={k++} className="leading-relaxed">{renderInline(trimmed)}</p>);
        } else {
            flushBullets();
        }
    });
    flushBullets();

    return <div className="space-y-1.5 text-sm">{nodes}</div>;
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function PikaPopoi() {
    const [isOpen, setIsOpen] = useState(false);
    const [messages, setMessages] = useState<ChatMsg[]>([]);
    const [input, setInput] = useState('');
    const [loading, setLoading] = useState(false);
    const [projects, setProjects] = useState<Project[]>([]);
    const [selectedProjectId, setSelectedProjectId] = useState('');
    const [projectsLoading, setProjectsLoading] = useState(false);
    const [error, setError] = useState('');
    const [historyLoading, setHistoryLoading] = useState(false);
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    const projectsLoaded = useRef(false);
    const lastProjectId = useRef('');

    // Load projects once on first open
    useEffect(() => {
        if (!isOpen || projectsLoaded.current) return;
        projectsLoaded.current = true;
        setProjectsLoading(true);
        api.getProjects()
            .then((list) => {
                const active = (Array.isArray(list) ? list : []).filter((p: Project) => p.isActive);
                setProjects(active);
                if (active.length > 0) setSelectedProjectId(active[0].id);
            })
            .catch(() => {})
            .finally(() => setProjectsLoading(false));
    }, [isOpen]);

    // Load history when project changes (not on every open)
    useEffect(() => {
        if (!selectedProjectId || selectedProjectId === lastProjectId.current) return;
        lastProjectId.current = selectedProjectId;
        setHistoryLoading(true);
        setMessages([]);
        setError('');
        api.getChatHistory(selectedProjectId)
            .then((res) => {
                setMessages((res.messages || []).map((m) => ({ ...m, role: m.role as 'user' | 'assistant' })));
            })
            .catch((err) => {
                setMessages([]);
                setError(err instanceof Error ? err.message : 'Failed to load conversation history.');
            })
            .finally(() => setHistoryLoading(false));
    }, [selectedProjectId]);

    // Close on Escape
    useEffect(() => {
        if (!isOpen) return;
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') setIsOpen(false);
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [isOpen]);

    // Scroll to bottom on new messages
    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages, loading]);

    // Focus input when opened
    useEffect(() => {
        if (isOpen) setTimeout(() => inputRef.current?.focus(), 150);
    }, [isOpen]);

    const sendMessage = useCallback(async (text: string) => {
        const trimmed = text.trim();
        if (!trimmed || loading || !selectedProjectId) return;
        setMessages((prev) => [...prev, { role: 'user', content: trimmed, timestamp: new Date().toISOString() }]);
        setInput('');
        setLoading(true);
        setError('');
        try {
            const res = await api.sendChatMessage(selectedProjectId, trimmed);
            setMessages((prev) => [...prev, { role: 'assistant', content: res.message, timestamp: new Date().toISOString() }]);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Something went wrong.');
        } finally {
            setLoading(false);
        }
    }, [loading, selectedProjectId]);

    const handleClear = () => {
        if (!selectedProjectId) return;
        api.clearChatHistory(selectedProjectId).catch(() => {});
        setMessages([]);
    };

    const handleProjectChange = (id: string) => {
        lastProjectId.current = '';
        setSelectedProjectId(id);
        setError('');
    };

    const selectedProject = projects.find((p) => p.id === selectedProjectId);
    const isEmpty = !historyLoading && messages.length === 0 && selectedProjectId;

    return (
        <>
            {/* Floating trigger button */}
            <button
                type="button"
                onClick={() => setIsOpen((v) => !v)}
                aria-label="Open PikaPopoi SEO assistant"
                className="fixed bottom-6 right-6 z-50 flex h-14 w-14 items-center justify-center rounded-full shadow-[0_8px_32px_rgba(79,70,229,0.5)] transition-all duration-200 hover:scale-105 hover:shadow-[0_12px_40px_rgba(79,70,229,0.6)] active:scale-95"
                style={{ background: 'linear-gradient(135deg, #4F46E5 0%, #7C3AED 100%)' }}
            >
                <AnimatePresence mode="wait">
                    {isOpen ? (
                        <motion.div key="x" initial={{ rotate: -90, opacity: 0 }} animate={{ rotate: 0, opacity: 1 }} exit={{ rotate: 90, opacity: 0 }} transition={{ duration: 0.15 }}>
                            <X className="h-6 w-6 text-white" />
                        </motion.div>
                    ) : (
                        <motion.div key="s" initial={{ rotate: 90, opacity: 0 }} animate={{ rotate: 0, opacity: 1 }} exit={{ rotate: -90, opacity: 0 }} transition={{ duration: 0.15 }}>
                            <Sparkles className="h-6 w-6 text-white" />
                        </motion.div>
                    )}
                </AnimatePresence>
            </button>

            {/* Chat panel */}
            <AnimatePresence>
                {isOpen && (
                    <motion.div
                        key="panel"
                        initial={{ opacity: 0, y: 16, scale: 0.97 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: 16, scale: 0.97 }}
                        transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
                        className="fixed bottom-24 right-6 z-50 flex flex-col overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-[0_24px_64px_rgba(0,0,0,0.18)]"
                        style={{ width: 'min(660px, calc(100vw - 32px))', height: 'min(460px, calc(100vh - 220px))' }}
                    >
                        {/* ── Header ── */}
                        <div
                            className="shrink-0 px-4 py-3"
                            style={{ background: 'linear-gradient(135deg, #4F46E5 0%, #7C3AED 100%)' }}
                        >
                            <div className="flex items-center gap-3">
                                {/* Avatar */}
                                <div className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/20 ring-2 ring-white/30">
                                    <Crown className="h-4 w-4 text-white" />
                                    <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-violet-700 bg-emerald-400" />
                                </div>
                                {/* Title */}
                                <div className="min-w-0 flex-1">
                                    <p className="text-sm font-bold leading-tight text-white">PikaPopoi</p>
                                    <p className="text-[10px] font-medium leading-tight text-indigo-200">Technical SEO King</p>
                                </div>
                                {/* Actions */}
                                <div className="flex items-center gap-0.5">
                                    {messages.length > 0 && (
                                        <button
                                            type="button"
                                            onClick={handleClear}
                                            title="Clear conversation"
                                            className="rounded-lg p-1.5 text-white/50 transition-colors hover:bg-white/15 hover:text-white"
                                        >
                                            <Trash2 className="h-3.5 w-3.5" />
                                        </button>
                                    )}
                                    <button
                                        type="button"
                                        onClick={() => setIsOpen(false)}
                                        className="rounded-lg p-1.5 text-white/50 transition-colors hover:bg-white/15 hover:text-white"
                                    >
                                        <X className="h-4 w-4" />
                                    </button>
                                </div>
                            </div>

                            {/* Project selector — inside header */}
                            <div className="mt-2.5">
                                {projectsLoading ? (
                                    <div className="flex items-center gap-2">
                                        <div className="h-3 w-3 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                                        <span className="text-[11px] text-indigo-200">Loading projects…</span>
                                    </div>
                                ) : projects.length === 0 ? (
                                    <p className="text-[11px] text-indigo-200">No active projects found.</p>
                                ) : (
                                    <div className="flex items-center gap-2">
                                        <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wider text-indigo-300">Project</span>
                                        <div className="relative min-w-0 flex-1">
                                            <select
                                                value={selectedProjectId}
                                                onChange={(e) => handleProjectChange(e.target.value)}
                                                className="w-full appearance-none rounded-lg border border-white/20 bg-white/10 py-1 pl-2.5 pr-6 text-xs font-semibold text-white backdrop-blur-sm focus:outline-none focus:ring-1 focus:ring-white/40"
                                            >
                                                {projects.map((p) => (
                                                    <option key={p.id} value={p.id} className="text-slate-800 bg-white">{p.domain}</option>
                                                ))}
                                            </select>
                                            <ChevronDown className="pointer-events-none absolute right-1.5 top-1/2 h-3 w-3 -translate-y-1/2 text-white/60" />
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* ── Messages area ── */}
                        <div className="flex-1 overflow-y-auto" style={{ minHeight: 0 }}>
                            <div className="px-4 py-4 space-y-4">

                                {/* History loading */}
                                {historyLoading && (
                                    <div className="flex items-center justify-center py-12">
                                        <div className="flex flex-col items-center gap-2">
                                            <div className="h-5 w-5 animate-spin rounded-full border-2 border-indigo-500 border-t-transparent" />
                                            <p className="text-[11px] text-slate-400">Loading conversation…</p>
                                        </div>
                                    </div>
                                )}

                                {/* Empty state */}
                                {isEmpty && (
                                    <div className="flex flex-col items-center py-6 text-center">
                                        <div className="mb-3 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-50 to-violet-50 shadow-sm ring-1 ring-indigo-100">
                                            <Crown className="h-8 w-8 text-indigo-500" />
                                        </div>
                                        <p className="text-base font-bold text-slate-800">Ask me anything</p>
                                        <p className="mt-0.5 text-sm font-semibold text-indigo-600">{selectedProject?.domain || 'your site'}</p>
                                        <p className="mt-1.5 text-xs leading-relaxed text-slate-400">
                                            I have your GSC metrics, audit results, Core Web Vitals, and keyword data.
                                        </p>
                                    </div>
                                )}

                                {/* Messages */}
                                {messages.map((msg, i) => (
                                    <div key={i} className={`flex items-start gap-2.5 ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}>
                                        {/* Avatar */}
                                        {msg.role === 'assistant' ? (
                                            <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-violet-600 shadow-sm">
                                                <Sparkles className="h-3.5 w-3.5 text-white" />
                                            </div>
                                        ) : (
                                            <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-200 text-[11px] font-bold text-slate-600">
                                                Me
                                            </div>
                                        )}

                                        {/* Bubble */}
                                        <div className={`max-w-[82%] rounded-2xl px-4 py-3 ${
                                            msg.role === 'user'
                                                ? 'rounded-tr-sm bg-indigo-600 text-white shadow-sm'
                                                : 'rounded-tl-sm bg-slate-100 text-slate-800'
                                        }`}>
                                            <MarkdownContent content={msg.content} isUser={msg.role === 'user'} />
                                        </div>
                                    </div>
                                ))}

                                {/* Typing indicator */}
                                {loading && (
                                    <div className="flex items-start gap-2.5">
                                        <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-violet-600 shadow-sm">
                                            <Sparkles className="h-3.5 w-3.5 text-white" />
                                        </div>
                                        <div className="rounded-2xl rounded-tl-sm bg-slate-100 px-4 py-3.5">
                                            <div className="flex items-center gap-1">
                                                {[0, 150, 300].map((delay) => (
                                                    <span
                                                        key={delay}
                                                        className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400"
                                                        style={{ animationDelay: `${delay}ms` }}
                                                    />
                                                ))}
                                            </div>
                                        </div>
                                    </div>
                                )}

                                {/* Error */}
                                {error && (
                                    <div className="rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs font-medium text-red-700">
                                        {error}
                                    </div>
                                )}

                                <div ref={messagesEndRef} />
                            </div>
                        </div>

                        {/* ── Quick prompts ── */}
                        {isEmpty && (
                            <div className="shrink-0 border-t border-slate-100 px-4 pb-2 pt-3">
                                <p className="mb-2.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400">Quick questions</p>
                                <div className="grid grid-cols-2 gap-2 pb-1">
                                    {QUICK_PROMPTS.map((prompt) => (
                                        <button
                                            key={prompt}
                                            type="button"
                                            onClick={() => void sendMessage(prompt)}
                                            className="rounded-xl border border-indigo-100 bg-indigo-50 px-3 py-2.5 text-left text-xs font-medium leading-tight text-indigo-700 transition-colors hover:border-indigo-200 hover:bg-indigo-100"
                                        >
                                            {prompt}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* ── Input ── */}
                        <form
                            onSubmit={(e) => { e.preventDefault(); void sendMessage(input); }}
                            className="shrink-0 border-t border-slate-100 bg-white px-3 py-3"
                        >
                            <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 transition-colors focus-within:border-indigo-400 focus-within:bg-white focus-within:shadow-sm focus-within:ring-1 focus-within:ring-indigo-400">
                                <input
                                    ref={inputRef}
                                    type="text"
                                    value={input}
                                    onChange={(e) => setInput(e.target.value)}
                                    placeholder={selectedProjectId ? 'Ask about your SEO…' : 'Select a project first'}
                                    disabled={!selectedProjectId || loading}
                                    className="flex-1 bg-transparent text-[13px] text-slate-800 placeholder-slate-400 focus:outline-none disabled:opacity-50"
                                />
                                <button
                                    type="submit"
                                    disabled={!input.trim() || !selectedProjectId || loading}
                                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg transition-all disabled:opacity-30 hover:opacity-90 active:scale-95"
                                    style={{ background: 'linear-gradient(135deg, #4F46E5 0%, #7C3AED 100%)' }}
                                >
                                    <Send className="h-3.5 w-3.5 text-white" />
                                </button>
                            </div>
                            <p className="mt-1.5 text-center text-[10px] text-slate-300">PikaPopoi · Powered by Gemini</p>
                        </form>
                    </motion.div>
                )}
            </AnimatePresence>
        </>
    );
}
