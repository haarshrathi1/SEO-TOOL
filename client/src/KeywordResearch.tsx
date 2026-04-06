import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Search, Loader2, Target, BarChart3, Layers, Sparkles, ExternalLink, Zap, Save, History, ChevronRight, TrendingUp, Brain, Lightbulb, Crosshair, Rocket, ArrowRight, ChevronDown, ChevronUp, HelpCircle, Star, Shield, Eye, BookOpen, Filter, Download, Check, type LucideIcon } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { api } from './api';
import { downloadCsv } from './csv';
import { useToast } from './toast';
import type { AuthUser, KeywordAdsStatus, KeywordDataV2, KeywordHistoryItem, KeywordItem, KeywordJob, KeywordScanResult, StrategicSynthesis } from './types';

interface QuestionKeywordItem {
    question: string;
    intent: string;
    volume: 'High' | 'Medium' | 'Low';
}

const LAYER_STEPS = [
    { id: 1, label: 'Collecting Data', desc: 'Autocomplete, SERP, PAA, related searches...', icon: Search },
    { id: 2, label: 'SERP DNA Analysis', desc: 'Deep analysis of what Google wants...', icon: Brain },
    { id: 3, label: 'Intent Decomposition', desc: 'Multi-dimensional intent mapping...', icon: Crosshair },
    { id: 4, label: 'Keyword Expansion', desc: 'Building keyword universe...', icon: Sparkles },
    { id: 5, label: 'Strategic Synthesis', desc: 'Generating actionable blueprint...', icon: Rocket },
];

const LAYER_BANTER: Record<number, string[]> = {
    0: [
        'Collecting search clues like a detective with too many tabs open.',
        'Autocomplete is speaking. We are pretending this is all very normal.',
        'Gathering SERP crumbs before competitors eat them first.',
        'Mining signals at speed because patience is not an SEO KPI.',
        'Pulling raw data like it owes us rankings.',
    ],
    1: [
        'Decoding SERP DNA to see what Google is emotionally attached to today.',
        'Reading top results and judging them respectfully.',
        'Analyzing ranking patterns so we can stop guessing politely.',
        'Finding what Google rewards while pretending the rules are clear.',
        'Inspecting authority signals before we pick a fight.',
    ],
    2: [
        'Breaking intent into tiny pieces because users are complicated.',
        'Mapping buyer psychology one query mood swing at a time.',
        'Sorting intent chaos into something strategy can survive.',
        'Detecting what people ask vs what they admit they ask.',
        'Untangling search motives with minimal existential crisis.',
    ],
    3: [
        'Expanding keywords until your content calendar starts sweating.',
        'Building long-tail ideas that look small but punch hard.',
        'Finding opportunity terms your competitors forgot to check.',
        'Growing the keyword universe without growing nonsense.',
        'Turning one seed into many ranking possibilities.',
    ],
    4: [
        'Assembling strategy from data, logic, and mild caffeine energy.',
        'Prioritizing quick wins before ambition gets expensive.',
        'Packaging all findings into an actual action plan.',
        'Final synthesis in progress. Wild guesses are not invited.',
        'Converting raw insight into a roadmap your team can use.',
    ],
};

const SAMPLE_SEEDS = [
    'crm software',
    'email marketing automation',
    'project management for agencies',
    'best payroll software',
];

function pickNextMessageIndex(messages: string[], previousIndex: number) {
    if (messages.length <= 1) return 0;
    let nextIndex = previousIndex;
    while (nextIndex === previousIndex) {
        nextIndex = Math.floor(Math.random() * messages.length);
    }
    return nextIndex;
}

function getErrorMessage(error: unknown, fallback: string) {
    return error instanceof Error ? error.message : fallback;
}

function getAdsConfigurationNote(status: KeywordAdsStatus) {
    const providerLabel = status.providerLabel || 'Keyword Ads provider';

    switch (status.configurationReason) {
    case 'missing_developer_token':
        return 'Google Ads API developer token is missing on the server.';
    case 'missing_customer_id':
        return 'Google Ads customer ID is missing on the server.';
    case 'missing_oauth_scope':
        return 'Saved Google Ads auth is missing the Ads scope. Reconnect using /auth/google/login/ads.';
    case 'missing_oauth_credentials':
        return 'Google Ads auth is missing on the server. Connect the Ads account at /auth/google/login/ads.';
    case 'missing_oauth_client':
        return 'Google OAuth client credentials are incomplete for Google Ads.';
    case 'missing_credentials':
        return 'Server credentials are not configured for DataForSEO yet.';
    default:
        return `${providerLabel} is not configured yet.`;
    }
}

function formatLabel(value: string) {
    return value
        .replace(/_/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/\b\w/g, (char) => char.toUpperCase());
}

function getOpportunityTier(score: number) {
    if (score >= 80) return 'Breakout';
    if (score >= 65) return 'Strong';
    if (score >= 45) return 'Workable';
    return 'Defensive';
}

function clampMetricScore(score: number) {
    if (!Number.isFinite(score)) {
        return 0;
    }
    return Math.max(0, Math.min(100, Math.round(score)));
}

function getDifficultyWeight(label: string | undefined) {
    switch (label) {
    case 'Hard':
        return 80;
    case 'Medium':
        return 55;
    case 'Easy':
        return 25;
    default:
        return 50;
    }
}

function getSerpVerdictWeight(verdict: string | undefined) {
    switch (verdict) {
    case 'Near Impossible':
        return 92;
    case 'Tough Battle':
        return 72;
    case 'Moderate Fight':
        return 46;
    case 'Easy Pickings':
        return 18;
    default:
        return null;
    }
}

function getDominantPageTypeWeight(pageType: string | undefined) {
    switch (pageType) {
    case 'navigational':
        return 70;
    case 'transactional':
        return 66;
    case 'listicle':
        return 62;
    case 'informational':
        return 40;
    default:
        return 50;
    }
}

function getHeadlineDifficultyLabel(score: number) {
    if (score >= 85) return 'Near Impossible';
    if (score >= 65) return 'Very Hard';
    if (score >= 45) return 'Hard';
    if (score >= 25) return 'Moderate';
    return 'Easy';
}

function getSearchSignalLabel(score: number) {
    if (score >= 70) return 'High';
    if (score >= 45) return 'Medium';
    return 'Low';
}

function deriveHeadlineDifficulty(data: KeywordDataV2 | null) {
    if (!data) {
        return { score: 0, label: 'N/A' };
    }

    const topKeywords = Array.isArray(data.keywordUniverse?.keywords)
        ? data.keywordUniverse.keywords.slice(0, 12)
        : [];
    const keywordDifficultyValues = topKeywords.map((keyword) => getDifficultyWeight(keyword.difficulty));
    const keywordDifficultyAverage = keywordDifficultyValues.length > 0
        ? keywordDifficultyValues.reduce((sum, value) => sum + value, 0) / keywordDifficultyValues.length
        : null;
    const brandPressure = typeof data.serpSummary?.brandPressureIndex === 'number'
        ? clampMetricScore(data.serpSummary.brandPressureIndex)
        : null;
    const serpVerdict = getSerpVerdictWeight(data.serpDna?.difficultyVerdict);
    const dominantPageTypeWeight = getDominantPageTypeWeight(data.serpSummary?.dominantPageType);
    const fallbackScore = typeof data.strategy?.difficulty?.score === 'number'
        ? clampMetricScore(data.strategy.difficulty.score)
        : 0;

    const weightedInputs = [
        { value: keywordDifficultyAverage, weight: 0.45 },
        { value: brandPressure, weight: 0.25 },
        { value: serpVerdict, weight: 0.2 },
        { value: dominantPageTypeWeight, weight: 0.1 },
    ].filter((entry) => typeof entry.value === 'number');

    const score = weightedInputs.length > 0
        ? clampMetricScore(
            weightedInputs.reduce((sum, entry) => sum + (Number(entry.value) * entry.weight), 0)
            / weightedInputs.reduce((sum, entry) => sum + entry.weight, 0)
        )
        : fallbackScore;

    return {
        score,
        label: getHeadlineDifficultyLabel(score),
    };
}

function deriveHeadlineSerpPersonality(data: KeywordDataV2 | null) {
    if (!data) {
        return 'N/A';
    }

    const seed = data.seed.toLowerCase();
    const dominantPageType = data.serpSummary?.dominantPageType || '';
    const primaryIntent = data.intentData?.primaryIntent?.toLowerCase() || '';
    const serpFeatures = (data.serpRaw?.serpFeatures || []).join(' ').toLowerCase();
    const domains = Array.isArray(data.serpSummary?.domains) ? data.serpSummary.domains : [];
    const hasCommunityDomains = domains.some((domain: string) => /(reddit|quora|forum|community|stackexchange|medium)/i.test(domain));
    const isFreshSerp = data.serpSummary?.freshness === 'Required' || /\b(news|top stories)\b/.test(serpFeatures);
    const isCommercialSeed = /\b(best|top|tool|tools|software|platform|compare|comparison|vs)\b/.test(seed)
        || primaryIntent.includes('commercial')
        || primaryIntent.includes('comparison');
    const isTutorialSeed = /\b(how to|guide|tutorial|checklist|template)\b/.test(seed);

    if (isFreshSerp) {
        return 'News Feed';
    }
    if (hasCommunityDomains) {
        return 'Community Forum';
    }
    if (isCommercialSeed || dominantPageType === 'transactional' || dominantPageType === 'listicle') {
        return 'Commercial Battlefield';
    }
    if (isTutorialSeed) {
        return 'Tutorial Playground';
    }
    if (dominantPageType === 'informational') {
        return 'Knowledge Hub';
    }

    return data.serpDna?.serpPersonality || 'Mixed Bazaar';
}

function isKeywordDataV2(item: KeywordHistoryItem): item is KeywordDataV2 & { id: string; timestamp: string } {
    return 'keywordUniverse' in item && 'strategy' in item && 'metadata' in item;
}

interface KeywordRuntimeLogEntry {
    id: string;
    status: KeywordJob['status'];
    stage: string;
    message: string;
    currentLayer: number;
    completed: number;
    total: number;
    percent: number;
    provider: string;
    elapsedMs: number;
}

const ACTIVE_KEYWORD_STATUSES: KeywordJob['status'][] = ['queued', 'running'];
const MAX_RUNTIME_LOG_ITEMS = 10;

function isActiveKeywordJob(job: KeywordJob | null | undefined) {
    return Boolean(job && ACTIVE_KEYWORD_STATUSES.includes(job.status));
}

function getKeywordAnchorTimestamp(job: KeywordJob) {
    const source = job.startedAt || job.createdAt;
    const timestamp = source ? new Date(source).getTime() : Date.now();
    return Number.isFinite(timestamp) ? timestamp : Date.now();
}

function getKeywordElapsedMs(job: KeywordJob) {
    return Math.max(0, Date.now() - getKeywordAnchorTimestamp(job));
}

function formatElapsedTime(elapsedMs: number) {
    const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function getKeywordRuntimeSignature(job: KeywordJob) {
    return [
        job.status,
        job.progress.stage,
        job.progress.label,
        job.progress.message,
        job.progress.currentLayer,
        job.progress.completed,
        job.progress.percent,
        job.progress.provider || '',
    ].join('::');
}

function getLatestActiveKeywordJob(jobs: KeywordJob[]) {
    return [...jobs]
        .filter((job) => isActiveKeywordJob(job))
        .sort((left, right) => getKeywordAnchorTimestamp(right) - getKeywordAnchorTimestamp(left))[0] || null;
}

function getJobLayerIndex(job: KeywordJob | null) {
    if (!job) {
        return 0;
    }

    return Math.max(0, Math.min(LAYER_STEPS.length - 1, (job.progress.currentLayer || 1) - 1));
}

const intentColors: Record<string, string> = {
    informational: 'bg-blue-100 text-blue-700', commercial: 'bg-amber-100 text-amber-700',
    transactional: 'bg-emerald-100 text-emerald-700', navigational: 'bg-violet-100 text-violet-700',
    comparison: 'bg-rose-100 text-rose-700',
};
const volColors: Record<string, string> = { High: 'text-emerald-600', Medium: 'text-amber-600', Low: 'text-slate-500' };
const diffColors: Record<string, string> = { Easy: 'bg-emerald-100 text-emerald-700', Medium: 'bg-amber-100 text-amber-700', Hard: 'bg-rose-100 text-rose-700' };
const prioColors: Record<string, string> = { P0: 'bg-rose-500 text-white', P1: 'bg-amber-500 text-white', P2: 'bg-blue-500 text-white', P3: 'bg-slate-400 text-white' };

function normalizeUiChoice(value: unknown, choices: readonly string[], fallback: string) {
    if (typeof value !== 'string') {
        return fallback;
    }

    const normalized = value.trim();
    if (!normalized) {
        return fallback;
    }

    const match = choices.find((choice) => choice.toLowerCase() === normalized.toLowerCase());
    return match || fallback;
}

function normalizeUiKeyword(value: unknown): KeywordItem | null {
    if (!value || typeof value !== 'object') {
        return null;
    }

    const candidate = value as Partial<KeywordItem>;
    const term = typeof candidate.term === 'string' ? candidate.term.trim() : '';
    if (!term) {
        return null;
    }

    const score = Number(candidate.opportunityScore);
    return {
        term,
        intent: normalizeUiChoice(candidate.intent, ['Informational', 'Commercial', 'Transactional', 'Navigational', 'Comparison'], 'Informational'),
        volume: normalizeUiChoice(candidate.volume, ['High', 'Medium', 'Low'], 'Low') as KeywordItem['volume'],
        difficulty: normalizeUiChoice(candidate.difficulty, ['Easy', 'Medium', 'Hard'], 'Medium') as KeywordItem['difficulty'],
        opportunityScore: Number.isFinite(score) ? Math.max(0, Math.min(100, Math.round(score))) : 0,
        source: typeof candidate.source === 'string' && candidate.source.trim() ? candidate.source.trim() : 'serp_implied',
        buyerStage: normalizeUiChoice(candidate.buyerStage, ['Awareness', 'Consideration', 'Decision', 'Retention'], 'Awareness'),
        adsMetrics: candidate.adsMetrics ?? null,
    };
}

function normalizeUiQuestionKeyword(value: unknown): QuestionKeywordItem | null {
    if (!value) {
        return null;
    }

    if (typeof value === 'string') {
        const question = value.trim();
        if (!question) {
            return null;
        }
        return { question, intent: 'Informational', volume: 'Low' };
    }

    if (typeof value !== 'object') {
        return null;
    }

    const candidate = value as Partial<QuestionKeywordItem>;
    const question = typeof candidate.question === 'string' ? candidate.question.trim() : '';
    if (!question) {
        return null;
    }

    return {
        question,
        intent: normalizeUiChoice(candidate.intent, ['Informational', 'Commercial', 'Transactional', 'Navigational', 'Comparison'], 'Informational'),
        volume: normalizeUiChoice(candidate.volume, ['High', 'Medium', 'Low'], 'Low') as QuestionKeywordItem['volume'],
    };
}

function ScoreRing({ score, size = 80, color = '#4F46E5' }: { score: number; size?: number; color?: string }) {
    const r = (size - 8) / 2, c = 2 * Math.PI * r, offset = c - (score / 100) * c;
    return (
        <svg width={size} height={size} className="transform -rotate-90">
            <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#E2E8F0" strokeWidth="6" />
            <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth="6"
                strokeDasharray={c} strokeDashoffset={offset} strokeLinecap="round" className="transition-all duration-1000" />
            <text x={size / 2} y={size / 2 + 1} textAnchor="middle" dominantBaseline="middle" className="fill-slate-900 text-xl font-bold" transform={`rotate(90 ${size / 2} ${size / 2})`}>{score}</text>
        </svg>
    );
}

function SpectrumBar({ data, colors }: { data: Record<string, number>; colors: string[] }) {
    const total = Object.values(data).reduce((a, b) => a + b, 0) || 1;
    return (
        <div className="space-y-2">
            <div className="flex h-3 rounded-full overflow-hidden bg-slate-100">
                {Object.entries(data).map(([k, v], i) => (
                    <div key={k} className={`${colors[i % colors.length]} transition-all duration-700`} style={{ width: `${(v / total) * 100}%` }} title={`${k}: ${v}`} />
                ))}
            </div>
            <div className="flex flex-wrap gap-3">
                {Object.entries(data).map(([k, v], i) => (
                    <span key={k} className="flex items-center gap-1.5 text-xs text-slate-600">
                        <span className={`w-2.5 h-2.5 rounded-full ${colors[i % colors.length]}`} />
                        <span className="capitalize font-medium">{k}</span>
                        <span className="text-slate-400">{v}%</span>
                    </span>
                ))}
            </div>
        </div>
    );
}

function Section({ icon: Icon, title, badge, children, defaultOpen = true }: { icon: LucideIcon; title: string; badge?: string; children: React.ReactNode; defaultOpen?: boolean }) {
    const [open, setOpen] = useState(defaultOpen);
    return (
        <div className="premium-card overflow-hidden">
            <button onClick={() => setOpen(!open)} className="w-full flex items-center justify-between p-5 hover:bg-slate-50/50 transition-colors">
                <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-xl bg-indigo-50 flex items-center justify-center"><Icon className="w-4.5 h-4.5 text-indigo-600" /></div>
                    <h3 className="font-bold text-slate-900 text-lg">{title}</h3>
                    {badge && <span className="premium-badge bg-indigo-50 text-indigo-600">{badge}</span>}
                </div>
                {open ? <ChevronUp className="w-5 h-5 text-slate-400" /> : <ChevronDown className="w-5 h-5 text-slate-400" />}
            </button>
            <AnimatePresence>{open && <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2 }}><div className="px-5 pb-5">{children}</div></motion.div>}</AnimatePresence>
        </div>
    );
}

export default function KeywordResearch({ user }: { user: AuthUser }) {
    const { push } = useToast();
    const [seed, setSeed] = useState('');
    const [data, setData] = useState<KeywordDataV2 | null>(null);
    const [history, setHistory] = useState<KeywordHistoryItem[]>([]);
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [showHistory, setShowHistory] = useState(false);
    const [currentLayer, setCurrentLayer] = useState(0);
    const [activeJob, setActiveJob] = useState<KeywordJob | null>(null);
    const [runtimeLog, setRuntimeLog] = useState<KeywordRuntimeLogEntry[]>([]);
    const [elapsedMs, setElapsedMs] = useState(0);
    const [scanResult, setScanResult] = useState<KeywordScanResult | null>(null);
    const [scanningUrl, setScanningUrl] = useState<string | null>(null);
    const [kwFilter, setKwFilter] = useState('all');
    const [kwSort, setKwSort] = useState<'opportunityScore' | 'term'>('opportunityScore');
    const [activeBanter, setActiveBanter] = useState('');
    const [useAdsData, setUseAdsData] = useState(false);
    const [adsStatus, setAdsStatus] = useState<KeywordAdsStatus | null>(null);
    const pollRef = useRef<number | null>(null);
    const banterIndexRef = useRef<Record<number, number>>({});
    const runtimeJobIdRef = useRef('');
    const runtimeSignatureRef = useRef('');
    const runtimeLogCountRef = useRef(0);

    useEffect(() => {
        if (!loading || currentLayer < 0 || currentLayer >= LAYER_STEPS.length) {
            setActiveBanter('');
            return;
        }

        const messages = LAYER_BANTER[currentLayer] || [];
        if (!messages.length) {
            setActiveBanter('');
            return;
        }

        const showNextMessage = () => {
            const previousIndex = banterIndexRef.current[currentLayer] ?? -1;
            const nextIndex = pickNextMessageIndex(messages, previousIndex);
            banterIndexRef.current[currentLayer] = nextIndex;
            setActiveBanter(messages[nextIndex]);
        };

        showNextMessage();
        const banterTimer = window.setInterval(showNextMessage, 2800);
        return () => window.clearInterval(banterTimer);
    }, [loading, currentLayer]);

    useEffect(() => {
        if (!activeJob || !isActiveKeywordJob(activeJob)) {
            return;
        }

        setElapsedMs(getKeywordElapsedMs(activeJob));
        const timer = window.setInterval(() => {
            setElapsedMs(getKeywordElapsedMs(activeJob));
        }, 1000);

        return () => window.clearInterval(timer);
    }, [activeJob]);

    const clearPoll = useCallback(() => {
        if (pollRef.current) {
            window.clearInterval(pollRef.current);
            pollRef.current = null;
        }
    }, []);

    const clearRuntimeState = useCallback(() => {
        runtimeJobIdRef.current = '';
        runtimeSignatureRef.current = '';
        runtimeLogCountRef.current = 0;
        setActiveJob(null);
        setRuntimeLog([]);
        setElapsedMs(0);
    }, []);

    const trackActiveJob = useCallback((job: KeywordJob, options: { resetLog?: boolean } = {}) => {
        const shouldResetLog = options.resetLog === true || runtimeJobIdRef.current !== job.id;

        if (shouldResetLog) {
            runtimeJobIdRef.current = job.id;
            runtimeSignatureRef.current = '';
            runtimeLogCountRef.current = 0;
        }

        setActiveJob(job);
        setCurrentLayer(getJobLayerIndex(job));
        setElapsedMs(getKeywordElapsedMs(job));
        setLoading(isActiveKeywordJob(job));

        const nextSignature = getKeywordRuntimeSignature(job);
        if (runtimeSignatureRef.current === nextSignature) {
            if (shouldResetLog) {
                setRuntimeLog([]);
            }
            return;
        }

        runtimeSignatureRef.current = nextSignature;
        const entry: KeywordRuntimeLogEntry = {
            id: `${job.id}-${runtimeLogCountRef.current}`,
            status: job.status,
            stage: job.progress.label || job.progress.stage,
            message: job.progress.message,
            currentLayer: job.progress.currentLayer,
            completed: job.progress.completed,
            total: job.progress.total,
            percent: job.progress.percent,
            provider: job.progress.provider || '',
            elapsedMs: getKeywordElapsedMs(job),
        };
        runtimeLogCountRef.current += 1;

        setRuntimeLog((current) => {
            const nextEntries = shouldResetLog ? [] : current;
            return [...nextEntries, entry].slice(-MAX_RUNTIME_LOG_ITEMS);
        });
    }, []);

    const fetchHistory = useCallback(async () => {
        try {
            setHistory(await api.getKeywordHistory());
        } catch (error) {
            console.error('Failed to load keyword history:', error);
        }
    }, []);

    const loadAdsStatus = useCallback(async () => {
        try {
            setAdsStatus(await api.getKeywordAdsStatus());
        } catch (error) {
            console.error('Failed to load keyword ads status:', error);
            setAdsStatus(null);
        }
    }, []);

    const syncKeywordJob = useCallback(async (jobId: string) => {
        try {
            const job = await api.getKeywordJob(jobId);
            trackActiveJob(job);

            if (job.status === 'completed') {
                clearPoll();
                const completedJob = await api.getKeywordJobResult(jobId);
                trackActiveJob(completedJob);
                if (completedJob.result) {
                    setData(completedJob.result);
                    setSeed(completedJob.result.seed);
                }
                setLoading(false);
                void loadAdsStatus();
                return;
            }

            if (job.status === 'failed') {
                clearPoll();
                setLoading(false);
                push({ tone: 'error', title: 'Keyword research failed', description: job.error || job.progress.message || 'The background job stopped unexpectedly.' });
            }
        } catch (error) {
            clearPoll();
            setLoading(false);
            push({ tone: 'error', title: 'Job sync failed', description: getErrorMessage(error, 'Unable to read keyword job progress.') });
        }
    }, [clearPoll, loadAdsStatus, push, trackActiveJob]);

    const beginPolling = useCallback((jobId: string) => {
        clearPoll();
        void syncKeywordJob(jobId);
        pollRef.current = window.setInterval(() => {
            void syncKeywordJob(jobId);
        }, 2500);
    }, [clearPoll, syncKeywordJob]);

    useEffect(() => {
        void fetchHistory();
        void loadAdsStatus();
        void (async () => {
            try {
                const jobs = await api.getKeywordJobs();
                const nextActiveJob = getLatestActiveKeywordJob(jobs);
                if (!nextActiveJob) {
                    return;
                }

                trackActiveJob(nextActiveJob, { resetLog: true });
                setLoading(true);
                beginPolling(nextActiveJob.id);
            } catch (error) {
                console.error('Failed to resume keyword jobs:', error);
            }
        })();

        return () => {
            clearPoll();
        };
    }, [beginPolling, clearPoll, fetchHistory, loadAdsStatus, trackActiveJob]);

    const handleSave = async () => {
        if (!data) return;

        setSaving(true);
        try {
            await api.saveKeywordResearch(data);
            await fetchHistory();
            push({ tone: 'success', title: 'Research saved', description: 'The current analysis was added to your history.' });
        } catch (error) {
            push({ tone: 'error', title: 'Failed to save research', description: getErrorMessage(error, 'Unknown error') });
        } finally {
            setSaving(false);
        }
    };

    const loadFromHistory = (item: KeywordHistoryItem) => {
        if (!isKeywordDataV2(item)) {
            push({ tone: 'info', title: 'Legacy research', description: 'This saved research uses the legacy format and cannot be opened in the new interface.' });
            return;
        }

        clearPoll();
        clearRuntimeState();
        setLoading(false);
        setData(item);
        setSeed(item.seed);
        setShowHistory(false);
    };

    const handleScan = async (url: string) => {
        setScanningUrl(url);
        try {
            setScanResult(await api.analyzePageKeywords(url));
        } catch (error) {
            push({ tone: 'error', title: 'Scan failed', description: getErrorMessage(error, 'Unknown error') });
        } finally {
            setScanningUrl(null);
        }
    };

    const handleSearch = async (e: React.FormEvent) => {
        e.preventDefault();
        const nextSeed = seed.trim();
        if (!nextSeed) return;

        clearPoll();
        clearRuntimeState();
        setLoading(true);
        setData(null);
        setCurrentLayer(0);
        try {
            const job = await api.createKeywordJob(nextSeed, null, { useAdsData });
            trackActiveJob(job, { resetLog: true });
            beginPolling(job.id);
        } catch (error) {
            setLoading(false);
            push({ tone: 'error', title: 'Analysis failed', description: getErrorMessage(error, 'Please try again.') });
        }
    };

    const keywordUniverseItems = useMemo(
        () => (Array.isArray(data?.keywordUniverse?.keywords)
            ? data.keywordUniverse.keywords
                .map((entry) => normalizeUiKeyword(entry))
                .filter((entry): entry is KeywordItem => Boolean(entry))
            : []),
        [data?.keywordUniverse?.keywords],
    );

    const intentFilters = useMemo(() => {
        const intents = new Set<string>(['all']);
        keywordUniverseItems.forEach((keyword) => {
            const normalized = keyword.intent.toLowerCase();
            if (normalized) {
                intents.add(normalized);
            }
        });
        return Array.from(intents);
    }, [keywordUniverseItems]);

    useEffect(() => {
        if (kwFilter !== 'all' && !intentFilters.includes(kwFilter)) {
            setKwFilter('all');
        }
    }, [intentFilters, kwFilter]);

    const filteredKeywords = keywordUniverseItems.filter((k) => kwFilter === 'all' || k.intent.toLowerCase() === kwFilter);
    const sortedKeywords = [...filteredKeywords].sort((a, b) => kwSort === 'opportunityScore' ? (b.opportunityScore - a.opportunityScore) : a.term.localeCompare(b.term));
    const topOpportunityKeywords = sortedKeywords.slice(0, 3);
    const questionKeywords: QuestionKeywordItem[] = Array.isArray(data?.keywordUniverse?.questionKeywords)
        ? data.keywordUniverse.questionKeywords
            .map((entry) => normalizeUiQuestionKeyword(entry))
            .filter((entry): entry is QuestionKeywordItem => Boolean(entry))
        : [];
    const relatedSearches = data?.serpRaw?.relatedSearches || [];
    const serpFeatures = data?.serpRaw?.serpFeatures || [];
    const easyKeywordCount = filteredKeywords.filter((keyword) => keyword.difficulty === 'Easy').length;
    const scoreLeaderCount = filteredKeywords.filter((keyword) => keyword.opportunityScore >= 70).length;
    const buyerStageCount = new Set(filteredKeywords.map((keyword) => keyword.buyerStage).filter(Boolean)).size;
    const highestScoringKeyword = sortedKeywords[0] || null;
    const intentMix = filteredKeywords.reduce<Record<string, number>>((acc, keyword) => {
        const key = keyword.intent?.toLowerCase() || 'unknown';
        acc[key] = (acc[key] || 0) + 1;
        return acc;
    }, {});
    const dominantIntent = Object.entries(intentMix).sort(([, a], [, b]) => b - a)[0] || null;
    const runtimeEntries = [...runtimeLog].reverse();
    const activeLayerConfig = LAYER_STEPS[currentLayer] || LAYER_STEPS[0];
    const ActiveLayerIcon = activeLayerConfig?.icon || Layers;
    const providerLabel = activeJob?.progress.provider || data?.metadata?.provider || 'Vertex AI primary';
    const keywordAdsMeta = data?.metadata?.keywordAds || null;
    const headlineDifficulty = useMemo(() => deriveHeadlineDifficulty(data), [data]);
    const headlineSerpPersonality = useMemo(() => deriveHeadlineSerpPersonality(data), [data]);
    const searchSignalScore = clampMetricScore(data?.serpSummary?.volumeScore ?? 0);
    const searchSignalLabel = getSearchSignalLabel(searchSignalScore);
    const canSeeAdsToggle = user.role === 'admin' || Boolean(user.features?.includes('keyword_ads')) || Boolean(adsStatus?.featureEnabled);
    const adsToggleDisabled = !adsStatus?.configured || !adsStatus?.featureEnabled;
    const adsProviderLabel = adsStatus?.providerLabel || keywordAdsMeta?.providerLabel || 'Google Ads';
    const adsToggleNote = !adsStatus
        ? 'Checking Google Ads enrichment access...'
        : !adsStatus.configured
            ? getAdsConfigurationNote(adsStatus)
            : adsStatus.unlimited
                ? `Admin mode: unlimited ${adsProviderLabel} enrichments.`
                : adsStatus.allowed
                    ? `${adsStatus.remainingThisWeek ?? 0} fresh ${adsProviderLabel} lookups left this week.`
                    : `Fresh ${adsProviderLabel} lookups are exhausted this week. Cached seeds can still enrich results.`;

    const exportKeywordCsv = () => {
        if (!data) return;
        downloadCsv(
            `keywords-${seed.trim().replace(/\s+/g, '-').toLowerCase() || 'research'}-${new Date().toISOString().slice(0, 10)}.csv`,
            ['Keyword', 'Intent', 'Volume', 'Difficulty', 'Opportunity Score', 'Buyer Stage', 'Source', 'Ads Search Volume', 'Ads Competition', 'Ads Competition Index', 'Ads CPC', 'Ads Low Bid', 'Ads High Bid'],
            sortedKeywords.map((keyword) => [
                keyword.term,
                keyword.intent,
                keyword.volume,
                keyword.difficulty,
                keyword.opportunityScore,
                keyword.buyerStage,
                keyword.source,
                keyword.adsMetrics?.searchVolume ?? '',
                keyword.adsMetrics?.competition ?? '',
                keyword.adsMetrics?.competitionIndex ?? '',
                keyword.adsMetrics?.cpc ?? '',
                keyword.adsMetrics?.lowTopOfPageBid ?? '',
                keyword.adsMetrics?.highTopOfPageBid ?? '',
            ]),
        );
        push({ tone: 'success', title: 'Keyword export ready', description: 'CSV download started.' });
    };

    const viabilityAudiences: Array<{ key: keyof StrategicSynthesis['viability']; label: string }> = [
        { key: 'soloCreator', label: 'Solo Creator' },
        { key: 'smallBusiness', label: 'Small Business' },
        { key: 'brand', label: 'Brand' },
    ];

    return (
        <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-indigo-50/30 relative">
            {/* History Toggle */}
            <button onClick={() => setShowHistory(!showHistory)} className="fixed left-4 top-24 z-50 w-10 h-10 rounded-xl bg-white border border-slate-200 shadow-md flex items-center justify-center hover:bg-indigo-50 hover:border-indigo-200 transition-all">
                <History className="w-4 h-4 text-slate-600" />
            </button>

            {/* History Sidebar */}
            <AnimatePresence>
                {showHistory && (<>
                    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 bg-black/20 backdrop-blur-sm z-40" onClick={() => setShowHistory(false)} />
                    <motion.div initial={{ x: -320 }} animate={{ x: 0 }} exit={{ x: -320 }} transition={{ type: 'spring', damping: 25 }}
                        className="fixed top-0 left-0 h-full w-80 bg-white/95 backdrop-blur-xl z-50 border-r border-slate-200 shadow-2xl overflow-y-auto">
                        <div className="p-5 border-b border-slate-100">
                            <div className="flex items-center justify-between">
                                <h2 className="font-bold text-lg text-slate-900">Research History</h2>
                                <button onClick={() => setShowHistory(false)} className="text-slate-400 hover:text-slate-600 text-sm font-medium">Close</button>
                            </div>
                        </div>
                        <div className="p-3 space-y-2">
                            {history.map(item => (
                                <button
                                    key={item.id}
                                    type="button"
                                    onClick={() => loadFromHistory(item)}
                                    className="w-full p-3.5 rounded-xl hover:bg-indigo-50 cursor-pointer transition-all border border-transparent hover:border-indigo-100 group text-left focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
                                >
                                    <div className="flex justify-between items-center">
                                        <span className="font-semibold text-slate-800 group-hover:text-indigo-700">{item.seed}</span>
                                        <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-indigo-500" />
                                    </div>
                                    <span className="text-xs text-slate-400 mt-1 block">{new Date(item.timestamp).toLocaleDateString()}</span>
                                </button>
                            ))}
                            {history.length === 0 && <p className="text-sm text-slate-400 text-center py-8">No saved research yet</p>}
                        </div>
                    </motion.div>
                </>)}
            </AnimatePresence>

            <div className="max-w-7xl mx-auto px-6 py-12 space-y-8">
                {/* Hero */}
                <div className="premium-card relative overflow-hidden">
                    <div className="absolute -top-16 left-8 h-36 w-36 rounded-full bg-indigo-200/40 blur-3xl" />
                    <div className="absolute right-0 top-0 h-48 w-48 rounded-full bg-sky-200/30 blur-3xl" />
                    <div className="relative grid gap-6 p-6 md:p-8 lg:grid-cols-[1.35fr_0.85fr] lg:items-start">
                        <div className="space-y-5">
                            <span className="premium-badge bg-indigo-50 text-indigo-700 border border-indigo-100">
                                5-layer keyword research workflow
                            </span>
                            <div className="space-y-3">
                                <h1 className="text-4xl md:text-5xl font-extrabold text-slate-900 tracking-tight">
                                    Keyword <span className="bg-gradient-to-r from-indigo-600 to-violet-600 bg-clip-text text-transparent">Intelligence</span>
                                </h1>
                                <p className="max-w-2xl text-base md:text-lg text-slate-600 leading-relaxed">
                                    Turn one seed term into a usable SEO brief: SERP patterns, intent mix, content gaps, quick wins, and a keyword universe you can actually prioritize.
                                </p>
                            </div>
                            <form onSubmit={handleSearch} className="flex flex-col gap-3 md:flex-row">
                                <div className="flex-1 relative">
                                    <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                                    <input
                                        type="text"
                                        value={seed}
                                        onChange={e => setSeed(e.target.value)}
                                        placeholder="Enter a topic or keyword (e.g., CRM software)..."
                                        className="premium-input pl-12 pr-4"
                                    />
                                </div>
                                <div className="flex flex-wrap gap-3">
                                    <button type="submit" disabled={loading} className="premium-button bg-indigo-600 text-white hover:bg-indigo-700 shadow-lg shadow-indigo-200 disabled:opacity-60">
                                        {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <><ArrowRight className="w-5 h-5" /> Analyze</>}
                                    </button>
                                    {data && (
                                        <>
                                            <button onClick={handleSave} disabled={saving} type="button" className="premium-button bg-emerald-600 text-white hover:bg-emerald-700 shadow-lg shadow-emerald-200">
                                                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                                            </button>
                                            <button onClick={exportKeywordCsv} type="button" className="premium-button border border-slate-200 bg-white text-slate-700 hover:bg-slate-50">
                                                <Download className="w-4 h-4" /> Export
                                            </button>
                                        </>
                                    )}
                                </div>
                            </form>
                            {canSeeAdsToggle && (
                                <div className="rounded-2xl border border-amber-200 bg-amber-50/80 px-4 py-3">
                                    <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                                        <div>
                                            <p className="text-sm font-semibold text-amber-900">Google Ads enrichment</p>
                                            <p className="mt-1 text-xs leading-relaxed text-amber-800">{adsToggleNote}</p>
                                        </div>
                                        <button
                                            type="button"
                                            onClick={() => {
                                                if (!adsToggleDisabled) {
                                                    setUseAdsData((current) => !current);
                                                }
                                            }}
                                            disabled={adsToggleDisabled}
                                            className={`inline-flex items-center gap-2 rounded-full border px-3 py-2 text-sm font-semibold transition ${
                                                useAdsData
                                                    ? 'border-amber-500 bg-amber-500 text-white'
                                                    : 'border-amber-300 bg-white text-amber-900'
                                            } ${adsToggleDisabled ? 'cursor-not-allowed opacity-60' : ''}`}
                                        >
                                            <span className={`h-2.5 w-2.5 rounded-full ${useAdsData ? 'bg-white' : 'bg-amber-500'}`} />
                                            {useAdsData ? 'Enabled for this run' : 'Use Google Ads data'}
                                        </button>
                                    </div>
                                </div>
                            )}
                            <div className="space-y-3">
                                <div className="flex flex-wrap gap-2">
                                    {SAMPLE_SEEDS.map((sample) => (
                                        <button
                                            key={sample}
                                            type="button"
                                            onClick={() => setSeed(sample)}
                                            className="premium-badge border border-slate-200 bg-white/80 text-slate-600 hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-700 transition-colors"
                                        >
                                            {sample}
                                        </button>
                                    ))}
                                </div>
                                <div className="flex flex-wrap gap-2 text-xs text-slate-500">
                                    <span className="premium-badge bg-slate-100 text-slate-600">SERP DNA</span>
                                    <span className="premium-badge bg-slate-100 text-slate-600">Intent decomposition</span>
                                    <span className="premium-badge bg-slate-100 text-slate-600">Quick wins</span>
                                    <span className="premium-badge bg-slate-100 text-slate-600">CSV export</span>
                                </div>
                            </div>
                        </div>

                        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-1">
                            <div className="rounded-2xl border border-white/70 bg-white/80 p-4 shadow-sm backdrop-blur-sm">
                                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Primary Intent</p>
                                <p className="mt-2 text-lg font-bold text-slate-900">
                                    {data?.intentData?.primaryIntent ? formatLabel(data.intentData.primaryIntent) : 'Map the dominant search intent'}
                                </p>
                                <p className="mt-1 text-sm text-slate-500">
                                    <span className="line-clamp-4">{data?.intentData?.intentInsight || 'Separate what searchers want, what Google rewards, and where your content can win.'}</span>
                                </p>
                            </div>
                            <div className="rounded-2xl border border-white/70 bg-white/80 p-4 shadow-sm backdrop-blur-sm">
                                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Opportunity Signal</p>
                                <p className="mt-2 text-lg font-bold text-slate-900">
                                    {highestScoringKeyword ? `${getOpportunityTier(highestScoringKeyword.opportunityScore)} lane` : 'Spot the best attack angle'}
                                </p>
                                <p className="mt-1 text-sm text-slate-500">
                                    {highestScoringKeyword ? `${highestScoringKeyword.term} leads with a score of ${highestScoringKeyword.opportunityScore}.` : 'Rank opportunities by difficulty, volume, and buying stage before you commit.'}
                                </p>
                            </div>
                            <div className="rounded-2xl border border-white/70 bg-white/80 p-4 shadow-sm backdrop-blur-sm">
                                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Research Memory</p>
                                <p className="mt-2 text-lg font-bold text-slate-900">{history.length} saved runs</p>
                                <p className="mt-1 text-sm text-slate-500">
                                    Re-open old research, compare angles, and keep the strongest keyword plays close.
                                </p>
                            </div>
                        </div>
                    </div>
                </div>

                {!data && !loading && (
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                        <div className="premium-card p-5">
                            <div className="w-10 h-10 rounded-2xl bg-indigo-50 text-indigo-600 flex items-center justify-center mb-4">
                                <Brain className="w-5 h-5" />
                            </div>
                            <h2 className="text-lg font-bold text-slate-900">Read the SERP before writing</h2>
                            <p className="mt-2 text-sm leading-relaxed text-slate-600">
                                Surface the formats, trust signals, and gaps already shaping page-one results for the keyword.
                            </p>
                        </div>
                        <div className="premium-card p-5">
                            <div className="w-10 h-10 rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center mb-4">
                                <Crosshair className="w-5 h-5" />
                            </div>
                            <h2 className="text-lg font-bold text-slate-900">Separate intent from noise</h2>
                            <p className="mt-2 text-sm leading-relaxed text-slate-600">
                                Understand whether the query is education-heavy, comparison-heavy, or ready to convert before planning content.
                            </p>
                        </div>
                        <div className="premium-card p-5">
                            <div className="w-10 h-10 rounded-2xl bg-amber-50 text-amber-600 flex items-center justify-center mb-4">
                                <Rocket className="w-5 h-5" />
                            </div>
                            <h2 className="text-lg font-bold text-slate-900">Leave with an execution plan</h2>
                            <p className="mt-2 text-sm leading-relaxed text-slate-600">
                                Move from raw keyword ideas to clusters, quick wins, and a content blueprint you can ship.
                            </p>
                        </div>
                    </div>
                )}
                {/* Loading */}
                <AnimatePresence>
                    {loading && (
                        <motion.div
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0 }}
                            className="premium-card overflow-hidden border border-indigo-100/80 bg-[radial-gradient(circle_at_top_left,_rgba(99,102,241,0.12),_transparent_38%),linear-gradient(135deg,_rgba(255,255,255,0.98),_rgba(238,242,255,0.94))]"
                        >
                            <div className="grid gap-6 p-6 md:p-8 lg:grid-cols-[1.1fr_0.9fr]">
                                <div className="space-y-6">
                                    <div className="flex flex-wrap items-center gap-2">
                                        <span className="premium-badge border border-indigo-100 bg-indigo-50 text-indigo-700">
                                            Live backend sync
                                        </span>
                                        <span className="premium-badge border border-slate-200 bg-white/90 text-slate-600">
                                            {providerLabel}
                                        </span>
                                    </div>

                                    <div className="grid gap-5 xl:grid-cols-[0.78fr_1.22fr] xl:items-center">
                                        <div className="relative flex min-h-[220px] items-center justify-center overflow-hidden rounded-[2rem] border border-indigo-100 bg-white/75">
                                            <motion.div
                                                className="absolute h-40 w-40 rounded-full bg-indigo-200/50 blur-3xl"
                                                animate={{ scale: [1, 1.14, 1], opacity: [0.45, 0.9, 0.45] }}
                                                transition={{ duration: 3.2, repeat: Infinity, ease: 'easeInOut' }}
                                            />
                                            <motion.div
                                                className="absolute h-32 w-32 rounded-full border border-indigo-200/70"
                                                animate={{ rotate: 360 }}
                                                transition={{ duration: 14, repeat: Infinity, ease: 'linear' }}
                                            />
                                            <motion.div
                                                className="absolute h-20 w-20 rounded-full border border-sky-200/70"
                                                animate={{ rotate: -360 }}
                                                transition={{ duration: 10, repeat: Infinity, ease: 'linear' }}
                                            />
                                            <div className="relative flex h-20 w-20 items-center justify-center rounded-[1.6rem] bg-slate-900 text-white shadow-2xl shadow-indigo-200/70">
                                                {activeJob ? <ActiveLayerIcon className="h-8 w-8" /> : <Loader2 className="h-8 w-8 animate-spin" />}
                                            </div>
                                        </div>

                                        <div className="space-y-5">
                                            <div>
                                                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-indigo-500">Runtime Console</p>
                                                <h2 className="mt-2 text-3xl font-extrabold tracking-tight text-slate-900">
                                                    {activeJob?.progress.label || 'Launching keyword research'}
                                                </h2>
                                                <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-600">
                                                    {activeJob?.progress.message || 'Creating the background job and preparing the first research layer.'}
                                                </p>
                                            </div>

                                            <div className="grid gap-3 sm:grid-cols-3">
                                                <div className="rounded-2xl border border-slate-200 bg-white/90 p-4">
                                                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Elapsed</p>
                                                    <p className="mt-2 text-2xl font-bold text-slate-900">{formatElapsedTime(elapsedMs)}</p>
                                                    <p className="mt-1 text-xs text-slate-500">Timer follows the active backend run.</p>
                                                </div>
                                                <div className="rounded-2xl border border-slate-200 bg-white/90 p-4">
                                                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Progress</p>
                                                    <p className="mt-2 text-2xl font-bold text-slate-900">{activeJob?.progress.percent ?? 0}%</p>
                                                    <p className="mt-1 text-xs text-slate-500">{activeJob?.progress.completed ?? 0}/{activeJob?.progress.total ?? LAYER_STEPS.length} layers recorded</p>
                                                </div>
                                                <div className="rounded-2xl border border-slate-200 bg-white/90 p-4">
                                                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Active Engine</p>
                                                    <p className="mt-2 text-base font-bold text-slate-900">{providerLabel}</p>
                                                    <p className="mt-1 text-xs text-slate-500">Vertex-first with retry and failover support.</p>
                                                </div>
                                            </div>

                                            <div className="space-y-3">
                                                <div className="flex items-center justify-between gap-3 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                                                    <span>Run progress</span>
                                                    <span>{activeJob?.progress.percent ?? 0}%</span>
                                                </div>
                                                <div className="h-4 rounded-full border border-indigo-100 bg-white/90 p-1">
                                                    <motion.div
                                                        className="h-full rounded-full bg-[linear-gradient(90deg,_#4f46e5_0%,_#2563eb_55%,_#22c55e_100%)]"
                                                        animate={{ width: `${activeJob?.progress.percent ?? 0}%` }}
                                                        transition={{ duration: 0.45, ease: 'easeOut' }}
                                                    />
                                                </div>
                                                <p className="text-xs text-slate-500">The screen polls the backend every 2.5 seconds and adds a log entry only when the job meaningfully changes state.</p>
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                <div className="rounded-[2rem] border border-slate-200 bg-white/92 p-5 shadow-lg shadow-slate-200/40 max-h-[560px] min-h-[320px] flex flex-col">
                                    <div className="flex items-center justify-between gap-3">
                                        <div>
                                            <p className="text-sm font-bold uppercase tracking-[0.2em] text-slate-900">Recent Activity</p>
                                            <p className="mt-1 text-xs text-slate-500">Session log from the live keyword job</p>
                                        </div>
                                        <span className="premium-badge border border-slate-200 bg-slate-50 text-slate-500">
                                            {runtimeEntries.length} events
                                        </span>
                                    </div>

                                    <div className="mt-4 flex-1 min-h-0 overflow-y-auto pr-1">
                                        <div className="space-y-3">
                                            {runtimeEntries.length > 0 ? runtimeEntries.map((entry) => (
                                                <div key={entry.id} className="rounded-2xl border border-slate-200 bg-slate-50/85 p-3">
                                                    <div className="flex items-center justify-between gap-3">
                                                        <p className="text-sm font-bold text-slate-900">{entry.stage}</p>
                                                        <span className="font-mono text-xs font-bold text-slate-500">{formatElapsedTime(entry.elapsedMs)}</span>
                                                    </div>
                                                    <p className="mt-1 text-sm text-slate-600">{entry.message}</p>
                                                    <div className="mt-2 flex items-center justify-between gap-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">
                                                        <span>{entry.completed}/{entry.total || '?'}</span>
                                                        <span>{entry.percent}%</span>
                                                    </div>
                                                    {entry.provider && <p className="mt-2 text-[11px] font-semibold text-indigo-600">{entry.provider}</p>}
                                                </div>
                                            )) : (
                                                <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/70 p-4 text-sm text-slate-500">
                                                    Waiting for the first backend milestone...
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <div className="border-t border-indigo-100/80 bg-white/70 p-6">
                                <div className="grid gap-3 lg:grid-cols-5">
                                    {LAYER_STEPS.map((step, i) => {
                                        const Icon = step.icon;
                                        const active = i === currentLayer;
                                        const done = Boolean(activeJob && i < currentLayer);
                                        const pending = !active && !done;

                                                return (
                                            <div
                                                key={step.id}
                                                className={`rounded-2xl border p-4 transition-all duration-500 ${active
                                                    ? 'border-indigo-200 bg-indigo-50/90 shadow-lg shadow-indigo-100/70'
                                                    : done
                                                        ? 'border-emerald-200 bg-emerald-50/80'
                                                        : 'border-slate-200 bg-white/85'
                                                    }`}
                                            >
                                                <div className="flex items-center justify-between gap-3">
                                                    <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${done ? 'bg-emerald-100' : active ? 'bg-indigo-100' : 'bg-slate-100'}`}>
                                                        {done ? <Check className="h-5 w-5 text-emerald-600" /> : <Icon className={`h-5 w-5 ${active ? 'text-indigo-600' : 'text-slate-400'}`} />}
                                                    </div>
                                                    {active && <Loader2 className="h-4 w-4 animate-spin text-indigo-500" />}
                                                    {pending && <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Queued</span>}
                                                </div>
                                                <p className={`mt-4 text-sm font-bold ${active ? 'text-indigo-700' : done ? 'text-emerald-700' : 'text-slate-700'}`}>
                                                    Layer {step.id}: {step.label}
                                                </p>
                                                <p className="mt-1 text-xs leading-relaxed text-slate-500">{step.desc}</p>
                                                {active && (
                                                    <motion.div
                                                        key={`banter-${step.id}-${activeBanter}`}
                                                        initial={{ opacity: 0, y: 4 }}
                                                        animate={{ opacity: 1, y: 0 }}
                                                        transition={{ duration: 0.2 }}
                                                        className="mt-3 min-h-[52px]"
                                                    >
                                                        <div
                                                            aria-live="polite"
                                                            className="inline-flex items-center rounded-xl border border-indigo-200/90 bg-gradient-to-r from-indigo-50 to-sky-50 px-3 py-2 text-xs italic leading-relaxed text-indigo-700 shadow-sm"
                                                        >
                                                            {activeBanter}
                                                        </div>
                                                    </motion.div>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        </motion.div>
                    )}
                </AnimatePresence>

                {/* Results */}
                {data && (
                    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
                        {/* Top Metrics */}
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                            <div className="premium-card p-5 flex items-center gap-4">
                                <ScoreRing score={headlineDifficulty.score} color={headlineDifficulty.score > 65 ? '#E11D48' : headlineDifficulty.score > 35 ? '#D97706' : '#059669'} />
                                <div>
                                    <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">Ranking Difficulty</p>
                                    <p className="font-bold text-slate-900">{headlineDifficulty.label}</p>
                                </div>
                            </div>
                            <div className="premium-card p-5 flex items-center gap-4">
                                <ScoreRing score={searchSignalScore} color="#4F46E5" />
                                <div>
                                    <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">Search Signal</p>
                                    <p className="font-bold text-slate-900">{searchSignalScore}/100</p>
                                    <p className="text-xs text-slate-400">{searchSignalLabel} proxy demand</p>
                                </div>
                            </div>
                            <div className="premium-card p-5">
                                <p className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-2">SERP Personality</p>
                                <p className="font-bold text-indigo-600 text-lg">{headlineSerpPersonality}</p>
                            </div>
                            <div className="premium-card p-5">
                                <p className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-2">Keywords Found</p>
                                <p className="font-bold text-slate-900 text-3xl">{data.keywordUniverse?.totalKeywords || 0}</p>
                                <p className="text-xs text-slate-400 mt-1">{data.strategy?.quickWins?.length || 0} quick wins identified</p>
                            </div>
                        </div>

                        {keywordAdsMeta?.requested && (
                            <div className={`rounded-2xl border p-4 ${keywordAdsMeta.enriched ? 'border-emerald-200 bg-emerald-50/80' : 'border-amber-200 bg-amber-50/80'}`}>
                                <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                                    <div>
                                        <p className={`text-sm font-semibold ${keywordAdsMeta.enriched ? 'text-emerald-800' : 'text-amber-900'}`}>Google Ads enrichment</p>
                                        <p className={`mt-1 text-xs leading-relaxed ${keywordAdsMeta.enriched ? 'text-emerald-700' : 'text-amber-800'}`}>
                                            {keywordAdsMeta.enriched
                                                ? `Applied using ${keywordAdsMeta.cacheHit ? 'cached' : 'live'} ${keywordAdsMeta.providerLabel} data. ${keywordAdsMeta.enrichedKeywordCount} keywords carry Ads metrics.`
                                                : `Not applied for this run (${keywordAdsMeta.skippedReason || 'unknown reason'}).`}
                                        </p>
                                    </div>
                                    <div className="flex flex-wrap gap-2 text-xs">
                                        <span className="premium-badge bg-white text-slate-700 border border-slate-200">{keywordAdsMeta.providerLabel}</span>
                                        <span className="premium-badge bg-white text-slate-700 border border-slate-200">Location {keywordAdsMeta.locationCode}</span>
                                        <span className="premium-badge bg-white text-slate-700 border border-slate-200">Language {keywordAdsMeta.languageCode}</span>
                                        <span className="premium-badge bg-white text-slate-700 border border-slate-200">{keywordAdsMeta.cacheHit ? 'Cache hit' : 'Single live call'}</span>
                                        {keywordAdsMeta.taskCost > 0 && <span className="premium-badge bg-white text-slate-700 border border-slate-200">${keywordAdsMeta.taskCost.toFixed(3)}</span>}
                                    </div>
                                </div>
                            </div>
                        )}

                        <Section icon={Target} title="Strategic Snapshot" badge={highestScoringKeyword ? getOpportunityTier(highestScoringKeyword.opportunityScore) : 'Overview'}>
                            <div className="space-y-4">
                                <div className="grid gap-4 lg:grid-cols-[1.4fr_0.9fr]">
                                    <div className="rounded-2xl border border-indigo-100 bg-gradient-to-br from-indigo-50 via-white to-sky-50 p-5">
                                        <div className="flex flex-wrap gap-2">
                                            <span className="premium-badge bg-indigo-100 text-indigo-700">
                                                {formatLabel(data.intentData?.primaryIntent || 'Unknown intent')}
                                            </span>
                                            <span className="premium-badge bg-emerald-100 text-emerald-700">
                                                {data.strategy?.contentBlueprint?.confidence || 'Unknown'} confidence
                                            </span>
                                            {highestScoringKeyword && (
                                                <span className="premium-badge bg-amber-100 text-amber-800">
                                                    Lead term: {highestScoringKeyword.term}
                                                </span>
                                            )}
                                        </div>
                                        <div className="mt-4">
                                            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-indigo-500">Best angle to attack</p>
                                            <p className="mt-2 line-clamp-3 text-xl font-bold leading-tight text-slate-900">{data.strategy?.contentBlueprint?.uniqueAngle}</p>
                                            <p className="mt-3 line-clamp-3 text-sm leading-relaxed text-slate-600">{data.intentData?.intentInsight}</p>
                                        </div>
                                        <div className="mt-5 grid gap-3 sm:grid-cols-3">
                                            <div className="rounded-xl border border-white/80 bg-white/80 p-4">
                                                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">Biggest Gap</p>
                                                <p className="mt-2 line-clamp-4 text-sm font-semibold leading-relaxed text-slate-800">{data.strategy?.contentGap}</p>
                                            </div>
                                            <div className="rounded-xl border border-white/80 bg-white/80 p-4">
                                                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">Primary Format</p>
                                                <p className="mt-2 text-sm font-semibold leading-relaxed text-slate-800">{data.strategy?.contentBlueprint?.primaryFormat}</p>
                                            </div>
                                            <div className="rounded-xl border border-white/80 bg-white/80 p-4">
                                                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">Time To Impact</p>
                                                <p className="mt-2 text-sm font-semibold leading-relaxed text-slate-800">{data.strategy?.contentBlueprint?.timeToImpact}</p>
                                            </div>
                                        </div>
                                    </div>

                                    <div className="space-y-4">
                                        <div className="rounded-2xl border border-rose-100 bg-rose-50/70 p-4">
                                            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-rose-500">Competition Reality</p>
                                            <p className="mt-2 line-clamp-4 text-sm font-semibold leading-relaxed text-rose-900">{data.strategy?.difficulty?.reason}</p>
                                        </div>
                                        <div className="rounded-2xl border border-violet-100 bg-violet-50/70 p-4">
                                            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-violet-500">Alternative Lane</p>
                                            <p className="mt-2 text-sm font-semibold text-slate-900">{data.strategy?.alternativeStrategy?.angle}</p>
                                            <p className="mt-2 line-clamp-4 text-sm leading-relaxed text-slate-600">{data.strategy?.alternativeStrategy?.reason}</p>
                                            {data.strategy?.alternativeStrategy?.keywords?.length > 0 && (
                                                <div className="mt-3 flex flex-wrap gap-2">
                                                    {data.strategy.alternativeStrategy.keywords.map((keyword, index) => (
                                                        <span key={`${keyword}-${index}`} className="premium-badge bg-white text-violet-700 border border-violet-100">
                                                            {keyword}
                                                        </span>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </div>

                                {topOpportunityKeywords.length > 0 && (
                                    <div className="grid gap-3 md:grid-cols-3">
                                        {topOpportunityKeywords.map((keyword, index) => (
                                            <div key={`${keyword.term}-${index}`} className="rounded-2xl border border-slate-200 bg-white p-4">
                                                <div className="flex items-center justify-between gap-3">
                                                    <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Top Play {index + 1}</span>
                                                    <span className="premium-badge bg-indigo-100 text-indigo-700">
                                                        {keyword.opportunityScore}
                                                    </span>
                                                </div>
                                                <p className="mt-3 text-base font-bold text-slate-900">{keyword.term}</p>
                                                <div className="mt-3 flex flex-wrap gap-2">
                                                    <span className={`premium-badge ${intentColors[keyword.intent?.toLowerCase()] || 'bg-slate-100 text-slate-600'}`}>{keyword.intent}</span>
                                                    <span className={`premium-badge ${diffColors[keyword.difficulty] || 'bg-slate-100 text-slate-600'}`}>{keyword.difficulty}</span>
                                                    <span className="premium-badge bg-slate-100 text-slate-600">{keyword.buyerStage}</span>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </Section>

                        {/* SERP DNA */}
                        {data.serpDna && (
                            <Section icon={Brain} title="SERP DNA Intelligence" badge="Layer 2">
                                <div className="space-y-4">
                                    <div className="p-4 rounded-xl bg-gradient-to-r from-indigo-50 to-violet-50 border border-indigo-100">
                                        <p className="text-xs font-semibold text-indigo-600 uppercase mb-1">What Google Wants</p>
                                        <p className="line-clamp-4 text-slate-700 font-medium leading-relaxed">{data.serpDna.googleWants}</p>
                                    </div>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        <div className="space-y-3">
                                            <p className="text-xs font-semibold text-slate-500 uppercase">E-E-A-T Signals</p>
                                            {Object.entries(data.serpDna.eatSignals || {}).map(([k, v]) => (
                                                <div key={k} className="flex items-start gap-2">
                                                    <span className="w-6 h-6 rounded-lg bg-indigo-50 flex items-center justify-center flex-shrink-0 mt-0.5">
                                                        {k === 'experience' ? <Eye className="w-3 h-3 text-indigo-500" /> : k === 'expertise' ? <BookOpen className="w-3 h-3 text-indigo-500" /> : k === 'authority' ? <Shield className="w-3 h-3 text-indigo-500" /> : <Star className="w-3 h-3 text-indigo-500" />}
                                                    </span>
                                                    <div><p className="text-xs font-semibold text-slate-600 capitalize">{k}</p><p className="text-xs text-slate-500">{v}</p></div>
                                                </div>
                                            ))}
                                        </div>
                                        <div className="space-y-3">
                                            <p className="text-xs font-semibold text-slate-500 uppercase">Content Gaps</p>
                                            {(data.serpDna.contentGaps || []).map((gap, i) => (
                                                <div key={i} className="flex items-start gap-2 p-2.5 rounded-lg bg-amber-50 border border-amber-100">
                                                    <Lightbulb className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" /><p className="line-clamp-2 text-sm text-amber-800">{gap}</p>
                                                </div>
                                            ))}
                                            <div className="p-2.5 rounded-lg bg-emerald-50 border border-emerald-100">
                                                <p className="text-xs font-semibold text-emerald-600 mb-0.5">Best Opportunity Angle</p>
                                                <p className="line-clamp-3 text-sm text-emerald-700">{data.serpDna.opportunityAngle}</p>
                                            </div>
                                        </div>
                                    </div>
                                    <div className="flex flex-wrap gap-2">
                                        {(data.serpDna.contentFormatDominance || []).map((f, i) => <span key={i} className="premium-badge bg-slate-100 text-slate-600">{f}</span>)}
                                        <span className="premium-badge bg-indigo-100 text-indigo-600">Ranker: {data.serpDna.rankerProfile}</span>
                                        <span className={`premium-badge ${data.serpDna.difficultyVerdict?.includes('Easy') ? 'bg-emerald-100 text-emerald-700' : data.serpDna.difficultyVerdict?.includes('Impossible') ? 'bg-rose-100 text-rose-700' : 'bg-amber-100 text-amber-700'}`}>
                                            {data.serpDna.difficultyVerdict}
                                        </span>
                                    </div>
                                </div>
                            </Section>
                        )}

                        {/* Intent Spectrum */}
                        {data.intentData && (
                            <Section icon={Crosshair} title="Intent Decomposition" badge="Layer 3">
                                <div className="space-y-5">
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                                        <div><p className="text-xs font-semibold text-slate-500 uppercase mb-3">Search Intent Spectrum</p>
                                            <SpectrumBar data={data.intentData.intentSpectrum} colors={['bg-blue-400', 'bg-emerald-400', 'bg-violet-400', 'bg-amber-400', 'bg-rose-400', 'bg-indigo-400']} /></div>
                                        <div><p className="text-xs font-semibold text-slate-500 uppercase mb-3">Buyer Journey Stage</p>
                                            <SpectrumBar data={data.intentData.buyerJourney} colors={['bg-sky-400', 'bg-indigo-400', 'bg-violet-400', 'bg-fuchsia-400']} /></div>
                                    </div>
                                    <div className="p-4 rounded-xl bg-indigo-50/50 border border-indigo-100">
                                        <p className="line-clamp-4 text-sm font-medium text-indigo-800">{data.intentData.intentInsight}</p>
                                    </div>
                                    {data.intentData.microIntents?.length > 0 && (
                                        <div><p className="text-xs font-semibold text-slate-500 uppercase mb-2">Micro-Intents</p>
                                            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                                                {data.intentData.microIntents.map((mi, i) => (
                                                    <div key={i} className="flex items-center gap-2 p-2.5 rounded-lg bg-white border border-slate-100">
                                                        <span className={`premium-badge ${mi.strength === 'High' ? 'bg-emerald-100 text-emerald-700' : mi.strength === 'Medium' ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-600'}`}>{mi.strength}</span>
                                                        <span className="text-sm font-medium text-slate-700">{mi.intent}</span>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </Section>
                        )}

                        {/* Keyword Universe */}
                        {data.keywordUniverse && (
                            <Section icon={Sparkles} title="Keyword Universe" badge={`${data.keywordUniverse.totalKeywords} keywords`}>
                                <div className="space-y-4">
                                    <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
                                        <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-4">
                                            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">Opportunity Leaders</p>
                                            <p className="mt-2 text-2xl font-bold text-slate-900">{scoreLeaderCount}</p>
                                            <p className="mt-1 text-xs text-slate-500">
                                                {highestScoringKeyword ? `${highestScoringKeyword.term} is currently the strongest bet.` : 'No keyword signals yet.'}
                                            </p>
                                        </div>
                                        <div className="rounded-xl border border-emerald-100 bg-emerald-50/80 p-4">
                                            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-emerald-600">Easy To Win</p>
                                            <p className="mt-2 text-2xl font-bold text-emerald-800">{easyKeywordCount}</p>
                                            <p className="mt-1 text-xs text-emerald-700">Lower-friction terms that can help you build traction faster.</p>
                                        </div>
                                        <div className="rounded-xl border border-amber-100 bg-amber-50/80 p-4">
                                            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-amber-600">Question-Led Topics</p>
                                            <p className="mt-2 text-2xl font-bold text-amber-800">{questionKeywords.length}</p>
                                            <p className="mt-1 text-xs text-amber-700">Great for FAQ blocks, comparison pages, and mid-funnel trust builders.</p>
                                        </div>
                                        <div className="rounded-xl border border-violet-100 bg-violet-50/80 p-4">
                                            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-violet-600">Journey Coverage</p>
                                            <p className="mt-2 text-2xl font-bold text-violet-800">{buyerStageCount}</p>
                                            <p className="mt-1 text-xs text-violet-700">
                                                {dominantIntent ? `${formatLabel(dominantIntent[0])} intent dominates this set.` : 'Buyer stages will appear once keywords load.'}
                                            </p>
                                        </div>
                                    </div>
                                    <div className="flex flex-wrap items-center gap-2">
                                        <Filter className="w-4 h-4 text-slate-400" />
                                        {intentFilters.map((filterValue) => (
                                            <button key={filterValue} onClick={() => setKwFilter(filterValue)} className={`premium-badge cursor-pointer transition-colors ${kwFilter === filterValue ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
                                                {filterValue === 'all' ? 'All' : formatLabel(filterValue)}
                                            </button>
                                        ))}
                                        <div className="ml-auto flex gap-2">
                                            <button onClick={() => setKwSort('opportunityScore')} className={`text-xs font-medium ${kwSort === 'opportunityScore' ? 'text-indigo-600' : 'text-slate-400'}`}>By Score</button>
                                            <button onClick={() => setKwSort('term')} className={`text-xs font-medium ${kwSort === 'term' ? 'text-indigo-600' : 'text-slate-400'}`}>A-Z</button>
                                        </div>
                                    </div>
                                    <div className="rounded-xl border border-slate-200 overflow-hidden">
                                        <div className="hidden md:block">
                                            <div className="grid grid-cols-12 gap-2 px-4 py-2.5 bg-slate-50 text-xs font-semibold text-slate-500 uppercase tracking-wider border-b border-slate-200">
                                                <div className="col-span-4">Keyword</div><div className="col-span-2">Intent</div><div className="col-span-1">Vol</div><div className="col-span-2">Difficulty</div><div className="col-span-1">Score</div><div className="col-span-2">Stage</div>
                                            </div>
                                            <div className="max-h-[400px] overflow-y-auto divide-y divide-slate-100">
                                                {sortedKeywords.length > 0 ? sortedKeywords.map((k, i) => (
                                                    <div key={i} className="grid grid-cols-12 gap-2 px-4 py-3 items-center hover:bg-indigo-50/30 transition-colors text-sm">
                                                        <div className="col-span-4">
                                                            <p className="font-medium text-slate-800 font-mono text-xs">{k.term}</p>
                                                            <p className="mt-1 text-[11px] text-slate-400">{formatLabel(k.source || 'Unknown source')}</p>
                                                            {k.adsMetrics && (
                                                                <p className="mt-1 text-[11px] text-emerald-600">
                                                                    Vol {k.adsMetrics.searchVolume ?? 'n/a'} · CPC {k.adsMetrics.cpc ?? 'n/a'}
                                                                </p>
                                                            )}
                                                        </div>
                                                        <div className="col-span-2"><span className={`premium-badge text-[10px] ${intentColors[k.intent?.toLowerCase()] || 'bg-slate-100 text-slate-600'}`}>{k.intent}</span></div>
                                                        <div className={`col-span-1 font-semibold text-xs ${volColors[k.volume] || ''}`}>{k.volume}</div>
                                                        <div className="col-span-2"><span className={`premium-badge text-[10px] ${diffColors[k.difficulty] || ''}`}>{k.difficulty}</span></div>
                                                        <div className="col-span-1"><span className="font-bold text-indigo-600">{k.opportunityScore}</span></div>
                                                        <div className="col-span-2 text-xs text-slate-500">{k.buyerStage}</div>
                                                    </div>
                                                )) : (
                                                    <div className="px-4 py-10 text-center text-sm text-slate-500">
                                                        No keywords match the current filter.
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                        <div className="divide-y divide-slate-100 md:hidden">
                                            {sortedKeywords.length > 0 ? sortedKeywords.map((keyword, index) => (
                                                <div key={`${keyword.term}-${index}`} className="p-4 space-y-3">
                                                    <div className="flex items-start justify-between gap-3">
                                                        <div>
                                                            <p className="font-mono text-xs font-semibold text-slate-800">{keyword.term}</p>
                                                            <p className="mt-1 text-[11px] text-slate-400">{formatLabel(keyword.source || 'Unknown source')}</p>
                                                            {keyword.adsMetrics && (
                                                                <p className="mt-1 text-[11px] text-emerald-600">
                                                                    Vol {keyword.adsMetrics.searchVolume ?? 'n/a'} · CPC {keyword.adsMetrics.cpc ?? 'n/a'}
                                                                </p>
                                                            )}
                                                        </div>
                                                        <span className="premium-badge bg-indigo-100 text-indigo-700">{keyword.opportunityScore}</span>
                                                    </div>
                                                    <div className="flex flex-wrap gap-2">
                                                        <span className={`premium-badge ${intentColors[keyword.intent?.toLowerCase()] || 'bg-slate-100 text-slate-600'}`}>{keyword.intent}</span>
                                                        <span className={`premium-badge ${diffColors[keyword.difficulty] || 'bg-slate-100 text-slate-600'}`}>{keyword.difficulty}</span>
                                                        <span className="premium-badge bg-slate-100 text-slate-600">{keyword.volume}</span>
                                                    </div>
                                                    <div className="text-xs text-slate-500">Buyer stage: {keyword.buyerStage}</div>
                                                </div>
                                            )) : (
                                                <div className="px-4 py-10 text-center text-sm text-slate-500">
                                                    No keywords match the current filter.
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                    {questionKeywords.length > 0 && (
                                        <div>
                                            <div className="flex items-center justify-between gap-3 mb-2">
                                                <p className="text-xs font-semibold text-slate-500 uppercase">Question Keywords</p>
                                                <p className="text-xs text-slate-400">Useful for FAQ blocks, section headers, and comparison pages.</p>
                                            </div>
                                            <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
                                                {questionKeywords.slice(0, 6).map((keyword, index) => (
                                                    <div key={`${keyword.question}-${index}`} className="rounded-xl border border-amber-100 bg-amber-50/70 p-3">
                                                        <p className="text-sm font-semibold text-amber-900">{keyword.question}</p>
                                                        <div className="mt-2 flex items-center gap-2 text-xs">
                                                            <span className={`premium-badge ${intentColors[keyword.intent?.toLowerCase()] || 'bg-white text-amber-700'}`}>{keyword.intent}</span>
                                                            <span className={`font-semibold ${volColors[keyword.volume] || 'text-amber-700'}`}>{keyword.volume}</span>
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                    {/* LSI Terms */}
                                    {data.keywordUniverse.lsiTerms?.length > 0 && (
                                        <div><p className="text-xs font-semibold text-slate-500 uppercase mb-2">Semantic / LSI Terms</p>
                                            <div className="flex flex-wrap gap-2">{data.keywordUniverse.lsiTerms.map((t, i) => <span key={i} className="premium-badge bg-violet-50 text-violet-600">{t}</span>)}</div>
                                        </div>
                                    )}
                                    {/* Long-Tail Gems */}
                                    {data.keywordUniverse.longTailGems?.length > 0 && (
                                        <div><p className="text-xs font-semibold text-slate-500 uppercase mb-2">Long-Tail Gems</p>
                                            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">{data.keywordUniverse.longTailGems.map((g, i) => (
                                                <div key={i} className="p-3 rounded-xl bg-gradient-to-r from-amber-50 to-orange-50 border border-amber-100">
                                                    <p className="font-semibold text-sm text-amber-800">{g.term}</p>
                                                    <p className="text-xs text-amber-600 mt-0.5">{g.reason}</p>
                                                    <span className="premium-badge bg-amber-200 text-amber-800 mt-1">Score: {g.opportunityScore}</span>
                                                </div>
                                            ))}</div>
                                        </div>
                                    )}
                                </div>
                            </Section>
                        )}
                        {/* Strategic Clusters */}
                        {data.strategy?.clusters && (
                            <Section icon={Layers} title="Strategic Clusters" badge={`${data.strategy.clusters.length} clusters`}>
                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                    {data.strategy.clusters.map((cluster, i) => (
                                        <div key={i} className="rounded-xl border border-slate-200 p-4 hover:border-indigo-200 hover:shadow-md transition-all">
                                            <div className="flex items-center justify-between mb-3">
                                                <h4 className="font-bold text-slate-800">{cluster.name}</h4>
                                                <span className={`premium-badge text-[10px] ${prioColors[cluster.priority] || 'bg-slate-200'}`}>{cluster.priority}</span>
                                            </div>
                                            <div className="flex items-center gap-2 mb-3">
                                                <span className="text-xs text-slate-500">{cluster.intent}</span>
                                                <span className="text-xs text-slate-300">&middot;</span>
                                                <span className="text-xs text-slate-500">{cluster.contentFormat}</span>
                                            </div>
                                            <div className="flex flex-wrap gap-1.5">
                                                {cluster.keywords?.map((k, j) => (
                                                    <span key={j} className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-slate-50 border border-slate-100 text-xs font-medium text-slate-700">
                                                        {k.term}
                                                        <span className="text-indigo-500 font-bold">{k.opportunityScore}</span>
                                                    </span>
                                                ))}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </Section>
                        )}

                        {/* Quick Wins */}
                        {data.strategy?.quickWins?.length > 0 && (
                            <Section icon={Zap} title="Quick Wins" badge={`${data.strategy.quickWins.length} opportunities`}>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                    {data.strategy.quickWins.map((qw, i) => (
                                        <div key={i} className="p-4 rounded-xl bg-gradient-to-r from-emerald-50 to-teal-50 border border-emerald-100">
                                            <p className="font-bold text-emerald-800">{qw.keyword}</p>
                                            <p className="text-sm text-emerald-600 mt-1">{qw.reason}</p>
                                            <div className="flex items-center gap-3 mt-2">
                                                <span className="premium-badge bg-emerald-200 text-emerald-800">{qw.timeToRank}</span>
                                                <span className="text-xs text-emerald-500">Action: {qw.action}</span>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </Section>
                        )}

                        {/* Content Blueprint */}
                        {data.strategy?.contentBlueprint && (
                            <Section icon={Rocket} title="Content Blueprint" badge={`${data.strategy.contentBlueprint.confidence} Confidence`}>
                                <div className="space-y-4">
                                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                        <div className="p-4 rounded-xl bg-indigo-50 border border-indigo-100">
                                            <p className="text-xs font-semibold text-indigo-500 uppercase">Format</p>
                                            <p className="font-bold text-indigo-800 mt-1">{data.strategy.contentBlueprint.primaryFormat}</p>
                                        </div>
                                        <div className="p-4 rounded-xl bg-violet-50 border border-violet-100">
                                            <p className="text-xs font-semibold text-violet-500 uppercase">Word Count</p>
                                            <p className="font-bold text-violet-800 mt-1">{data.strategy.contentBlueprint.wordCountTarget}</p>
                                        </div>
                                        <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-100">
                                            <p className="text-xs font-semibold text-emerald-500 uppercase">Time to Impact</p>
                                            <p className="font-bold text-emerald-800 mt-1">{data.strategy.contentBlueprint.timeToImpact}</p>
                                        </div>
                                    </div>
                                    <div className="p-4 rounded-xl bg-gradient-to-r from-indigo-50 to-violet-50 border border-indigo-100">
                                        <p className="text-xs font-semibold text-indigo-500 uppercase mb-1">Unique Angle</p>
                                        <p className="line-clamp-3 text-slate-700 font-medium">{data.strategy.contentBlueprint.uniqueAngle}</p>
                                    </div>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        <div><p className="text-xs font-semibold text-emerald-600 uppercase mb-2">Must Include</p>
                                            <div className="space-y-1.5">{(data.strategy.contentBlueprint.mustInclude || []).map((m, i) => <div key={i} className="flex items-start gap-2 text-sm text-slate-700"><span className="text-emerald-500 mt-0.5">-</span>{m}</div>)}</div>
                                        </div>
                                        <div><p className="text-xs font-semibold text-rose-600 uppercase mb-2">Avoid</p>
                                            <div className="space-y-1.5">{(data.strategy.contentBlueprint.avoid || []).map((a, i) => <div key={i} className="flex items-start gap-2 text-sm text-slate-700"><span className="text-rose-500 mt-0.5">-</span>{a}</div>)}</div>
                                        </div>
                                    </div>
                                </div>
                            </Section>
                        )}

                        {/* Viability */}
                        {data.strategy?.viability && (
                            <Section icon={Target} title="Viability Matrix" defaultOpen={false}>
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                    {viabilityAudiences.map(({ key, label }) => {
                                        const v = data.strategy.viability[key];
                                        return (
                                            <div key={key} className="p-4 rounded-xl border border-slate-200">
                                                <p className="text-xs font-semibold text-slate-500 uppercase">{label}</p>
                                                <p className={`text-xl font-bold mt-1 ${v?.verdict === 'High' ? 'text-emerald-600' : v?.verdict === 'Low' ? 'text-rose-500' : 'text-amber-500'}`}>{v?.verdict}</p>
                                                <p className="mt-2 line-clamp-4 text-xs text-slate-500">{v?.reason}</p>
                                            </div>
                                        );
                                    })}
                                </div>
                            </Section>
                        )}

                        {/* Execution Priority */}
                        {data.strategy?.executionPriority?.length > 0 && (
                            <Section icon={TrendingUp} title="Execution Roadmap" defaultOpen={false}>
                                <div className="space-y-2">
                                    {data.strategy.executionPriority.map((step, i) => (
                                        <div key={i} className="flex items-center gap-3 p-3 rounded-xl bg-slate-50 border border-slate-100">
                                            <span className="w-7 h-7 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center text-xs font-bold flex-shrink-0">{i + 1}</span>
                                            <span className="text-sm font-medium text-slate-700">{step}</span>
                                        </div>
                                    ))}
                                </div>
                            </Section>
                        )}

                        {/* People Also Ask */}
                        {data.serpRaw?.paaQuestions?.length > 0 && (
                            <Section icon={HelpCircle} title="People Also Ask" badge={`${data.serpRaw.paaQuestions.length}`} defaultOpen={false}>
                                <div className="space-y-2">
                                    {data.serpRaw.paaQuestions.map((q, i) => (
                                        <div key={i} className="p-3 rounded-xl bg-slate-50 border border-slate-100">
                                            <p className="font-medium text-sm text-slate-800">{q.question}</p>
                                            {q.snippet && <p className="text-xs text-slate-500 mt-1 line-clamp-2">{q.snippet}</p>}
                                        </div>
                                    ))}
                                </div>
                            </Section>
                        )}

                        {(relatedSearches.length > 0 || serpFeatures.length > 0 || data.serpRaw?.knowledgeGraph) && (
                            <Section icon={Search} title="Demand Signals" badge="SERP pulse" defaultOpen={false}>
                                <div className="grid gap-4 md:grid-cols-2">
                                    <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
                                        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Related Searches</p>
                                        <div className="mt-3 flex flex-wrap gap-2">
                                            {relatedSearches.length > 0 ? relatedSearches.slice(0, 10).map((term, index) => (
                                                <span key={`${term}-${index}`} className="premium-badge bg-white text-slate-700 border border-slate-200">
                                                    {term}
                                                </span>
                                            )) : (
                                                <p className="text-sm text-slate-500">No related searches were returned for this query.</p>
                                            )}
                                        </div>
                                    </div>
                                    <div className="space-y-4">
                                        <div className="rounded-2xl border border-slate-200 bg-white p-4">
                                            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">SERP Features</p>
                                            <div className="mt-3 flex flex-wrap gap-2">
                                                {serpFeatures.length > 0 ? serpFeatures.map((feature, index) => (
                                                    <span key={`${feature}-${index}`} className="premium-badge bg-indigo-50 text-indigo-700 border border-indigo-100">
                                                        {formatLabel(feature)}
                                                    </span>
                                                )) : (
                                                    <p className="text-sm text-slate-500">This SERP is relatively plain compared to richer result pages.</p>
                                                )}
                                            </div>
                                            <p className="mt-3 text-xs text-slate-400">Approx. results: {data.serpRaw?.totalResults?.toLocaleString?.() || 'N/A'}</p>
                                        </div>
                                        {data.serpRaw?.knowledgeGraph && (
                                            <div className="rounded-2xl border border-emerald-100 bg-emerald-50/70 p-4">
                                                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-600">Knowledge Graph</p>
                                                <p className="mt-2 text-sm font-semibold text-emerald-900">{data.serpRaw.knowledgeGraph.title}</p>
                                                <p className="mt-1 text-xs uppercase tracking-[0.14em] text-emerald-500">{data.serpRaw.knowledgeGraph.type}</p>
                                                <p className="mt-2 line-clamp-4 text-sm leading-relaxed text-emerald-800">{data.serpRaw.knowledgeGraph.description}</p>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </Section>
                        )}

                        {/* SERP Results */}
                        <Section icon={BarChart3} title="Top Search Results" badge={`${data.serp?.length || 0}`} defaultOpen={false}>
                            <div className="space-y-3">
                                {data.serp?.map((item, i) => (
                                    <div key={i} className="p-4 rounded-xl border border-slate-200 hover:border-indigo-200 hover:bg-indigo-50/20 transition-all group">
                                        <div className="flex items-start gap-4">
                                            <span className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center text-sm font-bold text-slate-400 flex-shrink-0 group-hover:bg-indigo-100 group-hover:text-indigo-600">{i + 1}</span>
                                            <div className="flex-1 min-w-0">
                                                <a href={item.url} target="_blank" rel="noreferrer" className="font-semibold text-slate-800 hover:text-indigo-600 flex items-center gap-1.5 text-sm">
                                                    {item.title}<ExternalLink className="w-3 h-3 opacity-0 group-hover:opacity-100 flex-shrink-0" />
                                                </a>
                                                <p className="text-xs text-emerald-600 font-mono truncate mt-0.5">{item.url}</p>
                                                <p className="text-sm text-slate-500 mt-1.5 leading-relaxed line-clamp-2">{item.snippet}</p>
                                                <button onClick={() => handleScan(item.url)} disabled={scanningUrl === item.url}
                                                    className="mt-2 premium-badge bg-slate-100 text-slate-600 hover:bg-indigo-100 hover:text-indigo-600 cursor-pointer transition-colors gap-1">
                                                    {scanningUrl === item.url ? <Loader2 className="w-3 h-3 animate-spin" /> : <Zap className="w-3 h-3" />}
                                                    {scanningUrl === item.url ? 'Scanning...' : 'Scan Keywords'}
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </Section>
                    </motion.div>
                )}

                {/* Metadata */}
                {data?.metadata && (
                    <div className="text-center text-xs text-slate-400 pb-8">
                        Analyzed with {data.metadata.provider || 'AI provider'} &middot; {data.metadata.model} &middot; {data.metadata.layers} reasoning layers &middot; {new Date(data.metadata.timestamp).toLocaleString()}
                    </div>
                )}
            </div>

            {/* Scan Modal */}
            <AnimatePresence>
                {scanResult && (
                    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm p-4">
                        <motion.div initial={{ scale: 0.95, y: 20 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.95, opacity: 0 }}
                            className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col border border-slate-200">
                            <div className="flex items-center justify-between p-5 border-b border-slate-100">
                                <div className="flex items-center gap-2">
                                    <Target className="w-5 h-5 text-indigo-600" />
                                    <h2 className="font-bold text-lg text-slate-900">Keyword X-Ray</h2>
                                </div>
                                <button onClick={() => setScanResult(null)} className="text-slate-400 hover:text-slate-600 font-medium text-sm">Close</button>
                            </div>
                            <div className="p-5 overflow-y-auto">
                                <div className="mb-4 p-3 rounded-xl bg-slate-50 border border-slate-100">
                                    <p className="text-xs font-medium text-slate-500">TARGET</p>
                                    <p className="text-sm font-mono text-slate-700 truncate">{scanResult.url}</p>
                                    <p className="text-xs text-slate-400 mt-1">Words: {scanResult.totalWords}</p>
                                </div>
                                <div className="rounded-xl border border-slate-200 overflow-hidden">
                                    <div className="grid grid-cols-12 gap-2 px-4 py-2.5 bg-slate-50 text-xs font-semibold text-slate-500 uppercase border-b border-slate-200">
                                        <div className="col-span-6">Keyword</div><div className="col-span-3 text-right">Count</div><div className="col-span-3 text-right">Density</div>
                                    </div>
                                    <div className="divide-y divide-slate-100">
                                        {scanResult.topKeywords.map((keyword, i) => (
                                            <div key={i} className="grid grid-cols-12 gap-2 px-4 py-2.5 text-sm hover:bg-indigo-50/30 transition-colors">
                                                <div className="col-span-6 font-mono text-indigo-600 font-medium text-xs">{keyword.keyword}</div>
                                                <div className="col-span-3 text-right text-slate-600">{keyword.count}</div>
                                                <div className="col-span-3 text-right"><span className="premium-badge bg-indigo-50 text-indigo-600">{keyword.density}</span></div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}












