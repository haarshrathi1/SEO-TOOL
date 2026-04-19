import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Search, Loader2, Target, BarChart3, Layers, Sparkles, ExternalLink, Zap, History, ChevronRight, TrendingUp, Brain, Lightbulb, Crosshair, Rocket, ArrowRight, ChevronDown, ChevronUp, HelpCircle, Star, Shield, Eye, BookOpen, Filter, Download, Check, type LucideIcon } from 'lucide-react';
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
    default:
        return `${providerLabel} is not configured yet.`;
    }
}

type KeywordAdsRunMeta = NonNullable<KeywordDataV2['metadata']['keywordAds']>;

function mergeAdsStatusWithRunMeta(current: KeywordAdsStatus | null, meta: KeywordAdsRunMeta, user: AuthUser): KeywordAdsStatus {
    const reason = !meta.configured
        ? 'not_configured'
        : !meta.featureEnabled
            ? 'feature_not_enabled'
            : meta.unlimited
                ? 'admin_unlimited'
                : meta.skippedReason || 'ok';

    const remainingToday = typeof meta.remainingToday === 'number' ? meta.remainingToday : null;
    const remainingThisWeek = typeof meta.remainingThisWeek === 'number' ? meta.remainingThisWeek : null;

    return {
        provider: meta.provider,
        providerLabel: meta.providerLabel,
        configured: meta.configured,
        configurationReason: meta.configurationReason || 'ok',
        featureEnabled: meta.featureEnabled,
        isAdmin: user.role === 'admin',
        allowed: meta.unlimited || (remainingToday !== null && remainingThisWeek !== null
            ? remainingToday > 0 && remainingThisWeek > 0
            : meta.allowed),
        unlimited: meta.unlimited,
        dailyLimit: meta.dailyLimit,
        usedToday: meta.usedToday,
        remainingToday,
        weeklyLimit: meta.weeklyLimit,
        usedThisWeek: meta.usedThisWeek,
        remainingThisWeek,
        locationCode: meta.locationCode,
        languageCode: meta.languageCode,
        searchPartners: meta.searchPartners,
        dayKey: current?.dayKey || '',
        weekKey: current?.weekKey || '',
        reason,
    };
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
const HISTORY_PAGE_SIZE = 25;

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

const _intentColors: Record<string, string> = {
    informational: 'bg-blue-100 text-blue-700', commercial: 'bg-amber-100 text-amber-700',
    transactional: 'bg-emerald-100 text-emerald-700', navigational: 'bg-violet-100 text-violet-700',
    comparison: 'bg-rose-100 text-rose-700',
};
const volColors: Record<string, string> = { High: 'text-emerald-600', Medium: 'text-amber-600', Low: 'text-slate-500' };
const _diffColors: Record<string, string> = { Easy: 'bg-emerald-100 text-emerald-700', Medium: 'bg-amber-100 text-amber-700', Hard: 'bg-rose-100 text-rose-700' };
const _prioColors: Record<string, string> = { P0: 'bg-rose-500 text-white', P1: 'bg-amber-500 text-white', P2: 'bg-blue-500 text-white', P3: 'bg-slate-400 text-white' };

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
        <div className="operator-panel overflow-hidden">
            <button onClick={() => setOpen(!open)} className="w-full flex items-center justify-between p-5 hover:bg-slate-50 transition-colors border-b-2 border-black/10">
                <div className="flex items-center gap-3">
                    <div className="p-2 bg-black border-2 border-black">
                        <Icon className="w-4 h-4 text-white" />
                    </div>
                    <h3 className="font-black text-black text-base uppercase tracking-wide">{title}</h3>
                    {badge && <span className="border border-black px-2 py-0.5 text-[10px] font-black uppercase bg-yellow-300">{badge}</span>}
                </div>
                {open ? <ChevronUp className="w-5 h-5 text-slate-600" /> : <ChevronDown className="w-5 h-5 text-slate-600" />}
            </button>
            <AnimatePresence>{open && <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2 }}><div className="px-5 pb-5 pt-4">{children}</div></motion.div>}</AnimatePresence>
        </div>
    );
}

export default function KeywordResearch({ user }: { user: AuthUser }) {
    const { push } = useToast();
    const [seed, setSeed] = useState('');
    const [data, setData] = useState<KeywordDataV2 | null>(null);
    const [history, setHistory] = useState<KeywordHistoryItem[]>([]);
    const [historyHasMore, setHistoryHasMore] = useState(false);
    const [historyNextBefore, setHistoryNextBefore] = useState<string | null>(null);
    const [historyLoadingMore, setHistoryLoadingMore] = useState(false);
    const [loading, setLoading] = useState(false);
    const [showHistory, setShowHistory] = useState(false);
    const [selectedHistoryId, setSelectedHistoryId] = useState<string | null>(null);
    const [currentLayer, setCurrentLayer] = useState(0);
    const [activeJob, setActiveJob] = useState<KeywordJob | null>(null);
    const [runtimeLog, setRuntimeLog] = useState<KeywordRuntimeLogEntry[]>([]);
    const [elapsedMs, setElapsedMs] = useState(0);
    const [scanResult, setScanResult] = useState<KeywordScanResult | null>(null);
    const [scanningUrl, setScanningUrl] = useState<string | null>(null);
    const [kwFilter, setKwFilter] = useState('all');
    const [kwSort, setKwSort] = useState<'opportunityScore' | 'term'>('opportunityScore');
    const [activeBanter, setActiveBanter] = useState('');
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

    const fetchHistory = useCallback(async (options: { append?: boolean; before?: string | null } = {}) => {
        try {
            const response = await api.getKeywordHistory(null, {
                before: options.before,
                limit: HISTORY_PAGE_SIZE,
            });
            setHistory((current) => {
                if (!options.append) {
                    return response.items;
                }

                const seen = new Set(current.map((item) => item.id));
                return [...current, ...response.items.filter((item) => !seen.has(item.id))];
            });
            setHistoryHasMore(response.hasMore);
            setHistoryNextBefore(response.nextBefore);
            return response;
        } catch (error) {
            console.error('Failed to load keyword history:', error);
            if (!options.append) {
                setHistory([]);
                setHistoryHasMore(false);
                setHistoryNextBefore(null);
            }
            return null;
        }
    }, []);

    const loadMoreHistory = useCallback(async () => {
        if (!historyHasMore || !historyNextBefore || historyLoadingMore) {
            return;
        }

        setHistoryLoadingMore(true);
        try {
            await fetchHistory({ append: true, before: historyNextBefore });
        } finally {
            setHistoryLoadingMore(false);
        }
    }, [fetchHistory, historyHasMore, historyLoadingMore, historyNextBefore]);

    const loadAdsStatus = useCallback(async () => {
        try {
            setAdsStatus(await api.getKeywordAdsStatus());
        } catch (error) {
            console.error('Failed to load keyword ads status:', error);
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
                    const result = completedJob.result;
                    const resultKeywordAds = result.metadata?.keywordAds;
                    setData(result);
                    setSeed(result.seed);
                    if (resultKeywordAds) {
                        setAdsStatus((current) => mergeAdsStatusWithRunMeta(current, resultKeywordAds, user));
                    }
                }
                if (completedJob.keywordHistoryId) {
                    setSelectedHistoryId(completedJob.keywordHistoryId);
                }
                setLoading(false);
                await fetchHistory();
                await loadAdsStatus();
                if (completedJob.historySaveError) {
                    push({
                        tone: 'info',
                        title: 'Research completed without history save',
                        description: completedJob.historySaveError,
                    });
                }
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
    }, [clearPoll, fetchHistory, loadAdsStatus, push, trackActiveJob, user]);

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
        setSelectedHistoryId(item.id);
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
        setSelectedHistoryId(null);
        setCurrentLayer(0);
        try {
            const job = await api.createKeywordJob(nextSeed, null);
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
    const adsProviderLabel = adsStatus?.providerLabel || keywordAdsMeta?.providerLabel || 'Google Ads';
    const adsInfoNote = !adsStatus
        ? user.role === 'admin'
            ? 'Checking Google Ads enrichment access for the admin workspace...'
            : 'Checking Google Ads enrichment access...'
        : !adsStatus.configured
            ? getAdsConfigurationNote(adsStatus)
            : adsStatus.unlimited
                ? `Admin mode: unlimited ${adsProviderLabel} enrichments.`
                : adsStatus.allowed
                    ? `${adsStatus.remainingToday ?? 0} fresh ${adsProviderLabel} lookups left today and ${adsStatus.remainingThisWeek ?? 0} left this week.`
                    : adsStatus.reason === 'daily_limit_reached'
                        ? `Fresh ${adsProviderLabel} lookups hit the daily cap (${adsStatus.dailyLimit ?? 0}/day). Cached seeds can still enrich results.`
                        : `Fresh ${adsProviderLabel} lookups hit the weekly cap (${adsStatus.weeklyLimit ?? 0}/week). Cached seeds can still enrich results.`;

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
        <div className="operator-shell text-slate-900 font-sans selection:bg-black selection:text-white pb-20">
            {/* Brutalist Header */}
            <header className="sticky top-0 z-50 border-b-2 border-black bg-white/90 backdrop-blur-md">
                <div className="max-w-7xl mx-auto px-6 py-4 flex flex-col md:flex-row items-center justify-between gap-4">
                    <div className="flex items-center gap-4">
                        <div className="p-2 bg-black border-2 border-black shadow-[2px_2px_0px_0px_rgba(0,0,0,0.5)]">
                            <Search className="w-6 h-6 text-white" />
                        </div>
                        <div>
                            <h1 className="text-2xl font-black tracking-tight text-black uppercase flex items-center gap-2">
                                Keyword Intelligence
                                {data && <span className="text-[10px] uppercase tracking-wider bg-yellow-300 text-black px-2 py-0.5 border border-black font-bold">{data.seed}</span>}
                            </h1>
                            <p className="text-xs font-bold text-slate-500 font-mono uppercase">5-layer research workflow</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-3">
                        {data && (
                            <button onClick={exportKeywordCsv} className="operator-button-secondary px-4 py-2">
                                <Download className="w-4 h-4" /> Export CSV
                            </button>
                        )}
                        <button onClick={() => setShowHistory(!showHistory)} className="operator-button-secondary px-4 py-2">
                            <History className="w-4 h-4" /> History{history.length > 0 ? ` (${history.length})` : ''}
                        </button>
                    </div>
                </div>
            </header>

            {/* History Sidebar */}
            <AnimatePresence>
                {showHistory && (<>
                    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 bg-black/20 z-40" onClick={() => setShowHistory(false)} />
                    <motion.div initial={{ x: -320 }} animate={{ x: 0 }} exit={{ x: -320 }} transition={{ type: 'spring', damping: 25 }}
                        className="fixed top-0 left-0 h-full w-80 bg-white z-50 border-r-2 border-black overflow-y-auto"
                        style={{ boxShadow: '8px 0 0 0 #000' }}
                    >
                        <div className="p-5 border-b-2 border-black bg-black">
                            <div className="flex items-center justify-between">
                                <h2 className="font-black text-lg text-white uppercase">Research History</h2>
                                <button onClick={() => setShowHistory(false)} className="border border-white px-2 py-0.5 text-sm font-black uppercase text-white hover:bg-white hover:text-black transition-colors">Close</button>
                            </div>
                        </div>
                        <div className="p-3 space-y-2">
                            {history.map(item => (
                                <button
                                    key={item.id}
                                    type="button"
                                    onClick={() => loadFromHistory(item)}
                                    className={`w-full p-3.5 cursor-pointer transition-all border-2 group text-left focus:outline-none ${
                                        selectedHistoryId === item.id
                                            ? 'border-black bg-yellow-300 shadow-[4px_4px_0px_0px_#000]'
                                            : 'border-black bg-white hover:bg-slate-50 hover:shadow-[4px_4px_0px_0px_#000]'
                                    }`}
                                >
                                    <div className="flex justify-between items-center">
                                        <span className="font-black text-black uppercase text-sm">{item.seed}</span>
                                        <ChevronRight className="w-4 h-4 text-black" />
                                    </div>
                                    <span className="text-xs text-slate-600 mt-1 block font-mono">{new Date(item.timestamp).toLocaleDateString()}</span>
                                </button>
                            ))}
                            {history.length === 0 && <p className="text-sm text-slate-500 text-center py-8 font-black uppercase">No saved research yet</p>}
                            {historyHasMore && (
                                <button
                                    type="button"
                                    onClick={() => void loadMoreHistory()}
                                    disabled={historyLoadingMore}
                                    className="mt-2 w-full operator-button-secondary py-3 text-sm disabled:opacity-60"
                                >
                                    {historyLoadingMore ? 'Loading more...' : 'Load more history'}
                                </button>
                            )}
                        </div>
                    </motion.div>
                </>)}
            </AnimatePresence>

            <div className="max-w-7xl mx-auto px-6 py-8 space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
                {/* Search Hero */}
                <div className="operator-panel p-6 md:p-8">
                    <div className="grid gap-6 lg:grid-cols-[1.35fr_0.85fr] lg:items-start">
                        <div className="space-y-5">
                            <div>
                                <span className="border-2 border-black px-3 py-1 text-xs font-black uppercase tracking-wider bg-yellow-300 shadow-[2px_2px_0px_0px_#000]">
                                    5-layer keyword research workflow
                                </span>
                            </div>
                            <div className="space-y-2">
                                <h2 className="text-3xl md:text-4xl font-black text-black tracking-tight uppercase">
                                    Keyword Research
                                </h2>
                                <p className="max-w-2xl text-sm text-slate-600 font-medium leading-relaxed">
                                    Turn one seed term into a usable SEO brief: SERP patterns, intent mix, content gaps, quick wins, and a keyword universe you can actually prioritize.
                                </p>
                            </div>
                            <form onSubmit={handleSearch} className="flex flex-col gap-3 md:flex-row">
                                <div className="flex-1 relative">
                                    <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400 pointer-events-none" />
                                    <input
                                        type="text"
                                        value={seed}
                                        onChange={e => setSeed(e.target.value)}
                                        placeholder="Enter a topic or keyword (e.g., CRM software)..."
                                        className="operator-control w-full pl-12 pr-4 py-4 text-sm font-bold"
                                    />
                                </div>
                                <div className="flex flex-wrap gap-3">
                                    <button type="submit" disabled={loading} className="operator-button-primary px-8 py-4 disabled:opacity-60">
                                        {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <ArrowRight className="w-5 h-5" />}
                                        {loading ? 'Analyzing...' : 'Analyze'}
                                    </button>
                                    {data && (
                                        <button onClick={exportKeywordCsv} type="button" className="operator-button-secondary px-6 py-4">
                                            <Download className="w-4 h-4" /> Export
                                        </button>
                                    )}
                                </div>
                            </form>
                            <div className="border-2 border-black p-4 bg-amber-50 shadow-[4px_4px_0px_0px_#000]">
                                <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                                    <div>
                                        <p className="text-sm font-black text-black uppercase">Google Ads Enrichment</p>
                                        <p className="mt-1 text-xs leading-relaxed text-slate-700 font-medium">{adsInfoNote}</p>
                                        {adsStatus && !adsStatus.unlimited && (
                                            <div className="mt-2 flex flex-wrap gap-2 text-[11px] font-black text-black">
                                                <span className="border border-black bg-white px-2 py-0.5 uppercase">Today: {adsStatus.usedToday}/{adsStatus.dailyLimit}</span>
                                                <span className="border border-black bg-white px-2 py-0.5 uppercase">Week: {adsStatus.usedThisWeek}/{adsStatus.weeklyLimit}</span>
                                            </div>
                                        )}
                                    </div>
                                    <span className="inline-flex items-center gap-2 border-2 border-black bg-white px-3 py-2 text-sm font-black uppercase shadow-[2px_2px_0px_0px_#000]">
                                        <span className="h-2.5 w-2.5 bg-amber-500" />
                                        Auto per run
                                    </span>
                                </div>
                            </div>
                            <div className="space-y-3">
                                <div className="flex flex-wrap gap-2">
                                    {SAMPLE_SEEDS.map((sample) => (
                                        <button
                                            key={sample}
                                            type="button"
                                            onClick={() => setSeed(sample)}
                                            className="border-2 border-black px-3 py-1 text-xs font-black uppercase bg-white hover:bg-yellow-300 hover:shadow-[2px_2px_0px_0px_#000] transition-all"
                                        >
                                            {sample}
                                        </button>
                                    ))}
                                </div>
                                <div className="flex flex-wrap gap-2 text-xs">
                                    {['SERP DNA', 'Intent decomposition', 'Quick wins', 'CSV export'].map((tag) => (
                                        <span key={tag} className="border border-black px-2 py-0.5 font-bold uppercase text-slate-600">{tag}</span>
                                    ))}
                                </div>
                            </div>
                        </div>

                        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-1">
                            {[
                                {
                                    label: 'Primary Intent',
                                    value: data?.intentData?.primaryIntent ? formatLabel(data.intentData.primaryIntent) : 'Map dominant search intent',
                                    sub: data?.intentData?.intentInsight || 'Separate what searchers want, what Google rewards, and where your content can win.',
                                    accent: 'bg-blue-200',
                                },
                                {
                                    label: 'Opportunity Signal',
                                    value: highestScoringKeyword ? `${getOpportunityTier(highestScoringKeyword.opportunityScore)} lane` : 'Spot the best attack angle',
                                    sub: highestScoringKeyword ? `${highestScoringKeyword.term} leads with a score of ${highestScoringKeyword.opportunityScore}.` : 'Rank opportunities by difficulty, volume, and buying stage.',
                                    accent: 'bg-amber-200',
                                },
                                {
                                    label: 'Research Memory',
                                    value: `${history.length} saved runs`,
                                    sub: 'Re-open old research, compare angles, and keep the strongest keyword plays close.',
                                    accent: 'bg-purple-200',
                                },
                            ].map((stat) => (
                                <div key={stat.label} className="border-2 border-black bg-white p-4 shadow-[4px_4px_0px_0px_#000]">
                                    <div className="flex items-center gap-2 mb-2">
                                        <div className={`border-2 border-black ${stat.accent} p-1.5`}>
                                            <Target className="w-3.5 h-3.5 text-black" />
                                        </div>
                                        <p className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-500">{stat.label}</p>
                                    </div>
                                    <p className="text-base font-black text-black uppercase leading-tight">{stat.value}</p>
                                    <p className="mt-1 text-xs text-slate-600 font-medium line-clamp-3">{stat.sub}</p>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>

                {!data && !loading && (
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                        {[
                            { icon: Brain, title: 'Read the SERP before writing', desc: 'Surface the formats, trust signals, and gaps already shaping page-one results for the keyword.', accent: 'bg-blue-200' },
                            { icon: Crosshair, title: 'Separate intent from noise', desc: 'Understand whether the query is education-heavy, comparison-heavy, or ready to convert before planning content.', accent: 'bg-emerald-200' },
                            { icon: Rocket, title: 'Leave with an execution plan', desc: 'Move from raw keyword ideas to clusters, quick wins, and a content blueprint you can ship.', accent: 'bg-amber-200' },
                        ].map((card) => (
                            <div key={card.title} className="operator-panel p-5">
                                <div className={`border-2 border-black ${card.accent} p-2 w-fit mb-4`}>
                                    <card.icon className="w-5 h-5 text-black" />
                                </div>
                                <h2 className="text-base font-black text-black uppercase">{card.title}</h2>
                                <p className="mt-2 text-sm leading-relaxed text-slate-600">{card.desc}</p>
                            </div>
                        ))}
                    </div>
                )}
                {/* Loading */}
                <AnimatePresence>
                    {loading && (
                        <motion.div
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0 }}
                            className="operator-panel overflow-hidden"
                        >
                            <div className="grid gap-6 p-6 md:p-8 lg:grid-cols-[1.1fr_0.9fr]">
                                <div className="space-y-6">
                                    <div className="flex flex-wrap items-center gap-2">
                                        <span className="border-2 border-black px-3 py-1 text-xs font-black uppercase bg-yellow-300 shadow-[2px_2px_0px_0px_#000]">Live backend sync</span>
                                        <span className="border border-black px-2 py-0.5 text-xs font-black uppercase">{providerLabel}</span>
                                    </div>

                                    <div className="grid gap-5 xl:grid-cols-[0.78fr_1.22fr] xl:items-center">
                                        <div className="relative flex min-h-[200px] items-center justify-center border-2 border-black bg-slate-50">
                                            <motion.div
                                                className="absolute h-40 w-40 rounded-full bg-black/10 blur-3xl"
                                                animate={{ scale: [1, 1.14, 1], opacity: [0.3, 0.6, 0.3] }}
                                                transition={{ duration: 3.2, repeat: Infinity, ease: 'easeInOut' }}
                                            />
                                            <div className="relative flex h-20 w-20 items-center justify-center bg-black text-white border-2 border-black shadow-[4px_4px_0px_0px_#555]">
                                                {activeJob ? <ActiveLayerIcon className="h-8 w-8" /> : <Loader2 className="h-8 w-8 animate-spin" />}
                                            </div>
                                        </div>

                                        <div className="space-y-5">
                                            <div>
                                                <p className="text-[11px] font-black uppercase tracking-[0.24em] text-slate-500">Runtime Console</p>
                                                <h2 className="mt-2 text-2xl font-black tracking-tight text-black uppercase">
                                                    {activeJob?.progress.label || 'Launching keyword research'}
                                                </h2>
                                                <p className="mt-2 text-sm leading-relaxed text-slate-600">
                                                    {activeJob?.progress.message || 'Creating the background job and preparing the first research layer.'}
                                                </p>
                                            </div>

                                            <div className="grid gap-3 sm:grid-cols-3">
                                                <div className="border-2 border-black bg-white p-4 shadow-[4px_4px_0px_0px_#000]">
                                                    <p className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-500">Elapsed</p>
                                                    <p className="mt-2 text-2xl font-black text-black">{formatElapsedTime(elapsedMs)}</p>
                                                    <p className="mt-1 text-xs text-slate-500 font-medium">Timer follows the active backend run.</p>
                                                </div>
                                                <div className="border-2 border-black bg-white p-4 shadow-[4px_4px_0px_0px_#000]">
                                                    <p className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-500">Progress</p>
                                                    <p className="mt-2 text-2xl font-black text-black">{activeJob?.progress.percent ?? 0}%</p>
                                                    <p className="mt-1 text-xs text-slate-500 font-medium">{activeJob?.progress.completed ?? 0}/{activeJob?.progress.total ?? LAYER_STEPS.length} layers</p>
                                                </div>
                                                <div className="border-2 border-black bg-white p-4 shadow-[4px_4px_0px_0px_#000]">
                                                    <p className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-500">Engine</p>
                                                    <p className="mt-2 text-sm font-black text-black uppercase">{providerLabel}</p>
                                                    <p className="mt-1 text-xs text-slate-500 font-medium">Vertex-first with failover.</p>
                                                </div>
                                            </div>

                                            <div className="space-y-2">
                                                <div className="flex items-center justify-between text-[11px] font-black uppercase text-slate-600">
                                                    <span>Run Progress</span>
                                                    <span>{activeJob?.progress.percent ?? 0}%</span>
                                                </div>
                                                <div className="h-4 border-2 border-black bg-white">
                                                    <motion.div
                                                        className="h-full bg-black"
                                                        animate={{ width: `${activeJob?.progress.percent ?? 0}%` }}
                                                        transition={{ duration: 0.45, ease: 'easeOut' }}
                                                    />
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                <div className="border-2 border-black bg-white p-5 max-h-[520px] min-h-[280px] flex flex-col shadow-[4px_4px_0px_0px_#000]">
                                    <div className="flex items-center justify-between gap-3 border-b-2 border-black pb-3 mb-4">
                                        <div>
                                            <p className="text-sm font-black uppercase tracking-[0.2em] text-black">Activity Log</p>
                                            <p className="text-xs text-slate-500 font-medium">Session log from live job</p>
                                        </div>
                                        <span className="border border-black px-2 py-0.5 text-[10px] font-black uppercase">{runtimeEntries.length} events</span>
                                    </div>

                                    <div className="flex-1 min-h-0 overflow-y-auto space-y-2">
                                        {runtimeEntries.length > 0 ? runtimeEntries.map((entry) => (
                                            <div key={entry.id} className="border border-black p-3 bg-slate-50">
                                                <div className="flex items-center justify-between gap-3">
                                                    <p className="text-sm font-black text-black uppercase">{entry.stage}</p>
                                                    <span className="font-mono text-xs font-bold text-slate-500">{formatElapsedTime(entry.elapsedMs)}</span>
                                                </div>
                                                <p className="mt-1 text-sm text-slate-600">{entry.message}</p>
                                                <div className="mt-2 flex items-center justify-between text-[11px] font-black uppercase text-slate-400">
                                                    <span>{entry.completed}/{entry.total || '?'}</span>
                                                    <span>{entry.percent}%</span>
                                                </div>
                                                {entry.provider && <p className="mt-1 text-[11px] font-black text-black uppercase">{entry.provider}</p>}
                                            </div>
                                        )) : (
                                            <div className="border border-dashed border-black p-4 text-sm text-slate-500 font-medium">
                                                Waiting for the first backend milestone...
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>

                            <div className="border-t-2 border-black bg-slate-50 p-6">
                                <div className="grid gap-3 lg:grid-cols-5">
                                    {LAYER_STEPS.map((step, i) => {
                                        const Icon = step.icon;
                                        const active = i === currentLayer;
                                        const done = Boolean(activeJob && i < currentLayer);
                                        const pending = !active && !done;
                                        return (
                                            <div
                                                key={step.id}
                                                className={`border-2 border-black p-4 transition-all duration-500 ${
                                                    active ? 'bg-yellow-300 shadow-[4px_4px_0px_0px_#000]'
                                                    : done ? 'bg-emerald-200'
                                                    : 'bg-white'
                                                }`}
                                            >
                                                <div className="flex items-center justify-between gap-3">
                                                    <div className={`flex h-9 w-9 items-center justify-center border-2 border-black ${done ? 'bg-emerald-500' : active ? 'bg-black' : 'bg-slate-100'}`}>
                                                        {done ? <Check className="h-4 w-4 text-white" /> : <Icon className={`h-4 w-4 ${active ? 'text-white' : 'text-slate-600'}`} />}
                                                    </div>
                                                    {active && <Loader2 className="h-4 w-4 animate-spin text-black" />}
                                                    {pending && <span className="text-[10px] font-black uppercase text-slate-400">Queued</span>}
                                                </div>
                                                <p className={`mt-3 text-xs font-black uppercase ${active ? 'text-black' : done ? 'text-emerald-900' : 'text-slate-600'}`}>
                                                    L{step.id}: {step.label}
                                                </p>
                                                <p className="mt-1 text-[11px] leading-relaxed text-slate-500">{step.desc}</p>
                                                {active && (
                                                    <motion.div
                                                        key={`banter-${step.id}-${activeBanter}`}
                                                        initial={{ opacity: 0, y: 4 }}
                                                        animate={{ opacity: 1, y: 0 }}
                                                        transition={{ duration: 0.2 }}
                                                        className="mt-3"
                                                    >
                                                        <div aria-live="polite" className="border border-black bg-white px-3 py-2 text-xs italic leading-relaxed text-slate-700">
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
                            <div className="operator-panel p-5 flex items-center gap-4">
                                <ScoreRing score={headlineDifficulty.score} color={headlineDifficulty.score > 65 ? '#E11D48' : headlineDifficulty.score > 35 ? '#D97706' : '#059669'} />
                                <div>
                                    <p className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-500">Ranking Difficulty</p>
                                    <p className="font-black text-black uppercase">{headlineDifficulty.label}</p>
                                </div>
                            </div>
                            <div className="operator-panel p-5 flex items-center gap-4">
                                <ScoreRing score={searchSignalScore} color="#4F46E5" />
                                <div>
                                    <p className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-500">Search Signal</p>
                                    <p className="font-black text-black uppercase">{searchSignalScore}/100</p>
                                    <p className="text-xs text-slate-500 font-bold">{searchSignalLabel} demand</p>
                                </div>
                            </div>
                            <div className="operator-panel p-5">
                                <p className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-500 mb-2">SERP Personality</p>
                                <p className="font-black text-black text-lg uppercase">{headlineSerpPersonality}</p>
                            </div>
                            <div className="operator-panel p-5">
                                <p className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-500 mb-2">Keywords Found</p>
                                <p className="font-black text-black text-3xl">{data.keywordUniverse?.totalKeywords || 0}</p>
                                <p className="text-xs text-slate-500 font-bold mt-1">{data.strategy?.quickWins?.length || 0} quick wins</p>
                            </div>
                        </div>

                        {keywordAdsMeta?.requested && (
                            <div className={`border-2 border-black p-4 shadow-[4px_4px_0px_0px_#000] ${keywordAdsMeta.enriched ? 'bg-emerald-100' : 'bg-amber-100'}`}>
                                <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                                    <div>
                                        <p className={`text-sm font-black uppercase ${keywordAdsMeta.enriched ? 'text-emerald-900' : 'text-amber-900'}`}>Google Ads Enrichment</p>
                                        <p className={`mt-1 text-xs leading-relaxed font-medium ${keywordAdsMeta.enriched ? 'text-emerald-800' : 'text-amber-800'}`}>
                                            {keywordAdsMeta.enriched
                                                ? `Applied using ${keywordAdsMeta.cacheHit ? 'cached' : 'live'} ${keywordAdsMeta.providerLabel} data. ${keywordAdsMeta.enrichedKeywordCount} keywords carry Ads metrics.`
                                                : `Not applied for this run (${keywordAdsMeta.skippedReason || 'unknown reason'}).`}
                                        </p>
                                    </div>
                                    <div className="flex flex-wrap gap-2 text-[11px]">
                                        <span className="border border-black bg-white px-2 py-0.5 font-black uppercase">{keywordAdsMeta.providerLabel}</span>
                                        <span className="border border-black bg-white px-2 py-0.5 font-black uppercase">Location {keywordAdsMeta.locationCode}</span>
                                        <span className="border border-black bg-white px-2 py-0.5 font-black uppercase">Language {keywordAdsMeta.languageCode}</span>
                                        <span className="border border-black bg-white px-2 py-0.5 font-black uppercase">{keywordAdsMeta.cacheHit ? 'Cache hit' : 'Live call'}</span>
                                        {typeof keywordAdsMeta.usedToday === 'number' && keywordAdsMeta.dailyLimit !== null && (
                                            <span className="border border-black bg-white px-2 py-0.5 font-black uppercase">Today {keywordAdsMeta.usedToday}/{keywordAdsMeta.dailyLimit}</span>
                                        )}
                                        {typeof keywordAdsMeta.usedThisWeek === 'number' && keywordAdsMeta.weeklyLimit !== null && (
                                            <span className="border border-black bg-white px-2 py-0.5 font-black uppercase">Week {keywordAdsMeta.usedThisWeek}/{keywordAdsMeta.weeklyLimit}</span>
                                        )}
                                        {keywordAdsMeta.taskCost > 0 && <span className="border border-black bg-white px-2 py-0.5 font-black uppercase">${keywordAdsMeta.taskCost.toFixed(3)}</span>}
                                    </div>
                                </div>
                            </div>
                        )}

                        <Section icon={Target} title="Strategic Snapshot" badge={highestScoringKeyword ? getOpportunityTier(highestScoringKeyword.opportunityScore) : 'Overview'}>
                            <div className="space-y-4">
                                <div className="grid gap-4 lg:grid-cols-[1.4fr_0.9fr]">
                                    <div className="border-2 border-black p-5 bg-yellow-50 shadow-[4px_4px_0px_0px_#000]">
                                        <div className="flex flex-wrap gap-2 mb-4">
                                            <span className="border border-black px-2 py-0.5 text-[11px] font-black uppercase bg-blue-200">{formatLabel(data.intentData?.primaryIntent || 'Unknown intent')}</span>
                                            <span className="border border-black px-2 py-0.5 text-[11px] font-black uppercase bg-emerald-200">{data.strategy?.contentBlueprint?.confidence || 'Unknown'} confidence</span>
                                            {highestScoringKeyword && <span className="border border-black px-2 py-0.5 text-[11px] font-black uppercase bg-amber-200">Lead: {highestScoringKeyword.term}</span>}
                                        </div>
                                        <p className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-500">Best angle to attack</p>
                                        <p className="mt-2 text-xl font-black text-black uppercase leading-tight">{data.strategy?.contentBlueprint?.uniqueAngle}</p>
                                        <p className="mt-2 text-sm leading-relaxed text-slate-700">{data.intentData?.intentInsight}</p>
                                        <div className="mt-4 grid gap-3 sm:grid-cols-3">
                                            {[
                                                { label: 'Biggest Gap', value: data.strategy?.contentGap },
                                                { label: 'Primary Format', value: data.strategy?.contentBlueprint?.primaryFormat },
                                                { label: 'Time To Impact', value: data.strategy?.contentBlueprint?.timeToImpact },
                                            ].map((item) => (
                                                <div key={item.label} className="border-2 border-black p-3 bg-white">
                                                    <p className="text-[11px] font-black uppercase tracking-[0.14em] text-slate-500">{item.label}</p>
                                                    <p className="mt-1 text-sm font-bold text-black">{item.value}</p>
                                                </div>
                                            ))}
                                        </div>
                                    </div>

                                    <div className="space-y-4">
                                        <div className="border-2 border-black p-4 bg-red-50 shadow-[4px_4px_0px_0px_#000]">
                                            <p className="text-[11px] font-black uppercase tracking-[0.18em] text-red-700">Competition Reality</p>
                                            <p className="mt-2 text-sm font-bold leading-relaxed text-black">{data.strategy?.difficulty?.reason}</p>
                                        </div>
                                        <div className="border-2 border-black p-4 bg-purple-50 shadow-[4px_4px_0px_0px_#000]">
                                            <p className="text-[11px] font-black uppercase tracking-[0.18em] text-purple-700">Alternative Lane</p>
                                            <p className="mt-2 text-sm font-black text-black uppercase">{data.strategy?.alternativeStrategy?.angle}</p>
                                            <p className="mt-2 text-sm leading-relaxed text-slate-700">{data.strategy?.alternativeStrategy?.reason}</p>
                                            {data.strategy?.alternativeStrategy?.keywords?.length > 0 && (
                                                <div className="mt-3 flex flex-wrap gap-2">
                                                    {data.strategy.alternativeStrategy.keywords.map((keyword, index) => (
                                                        <span key={`${keyword}-${index}`} className="border border-black px-2 py-0.5 text-[11px] font-black uppercase bg-white">
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
                                            <div key={`${keyword.term}-${index}`} className="border-2 border-black p-4 bg-white shadow-[4px_4px_0px_0px_#000]">
                                                <div className="flex items-center justify-between gap-3 mb-3">
                                                    <span className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-500">Top Play {index + 1}</span>
                                                    <span className="border border-black px-2 py-0.5 text-xs font-black bg-yellow-300">{keyword.opportunityScore}</span>
                                                </div>
                                                <p className="text-base font-black text-black uppercase">{keyword.term}</p>
                                                <div className="mt-3 flex flex-wrap gap-2">
                                                    <span className="border border-black px-2 py-0.5 text-[10px] font-black uppercase">{keyword.intent}</span>
                                                    <span className={`border border-black px-2 py-0.5 text-[10px] font-black uppercase ${keyword.difficulty === 'Easy' ? 'bg-emerald-200' : keyword.difficulty === 'Hard' ? 'bg-red-200' : 'bg-amber-200'}`}>{keyword.difficulty}</span>
                                                    <span className="border border-black px-2 py-0.5 text-[10px] font-black uppercase">{keyword.buyerStage}</span>
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
                                    <div className="border-2 border-black p-4 bg-blue-50">
                                        <p className="text-[11px] font-black uppercase text-blue-800 mb-1">What Google Wants</p>
                                        <p className="text-slate-800 font-medium leading-relaxed">{data.serpDna.googleWants}</p>
                                    </div>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        <div className="space-y-3">
                                            <p className="text-[11px] font-black uppercase text-slate-500">E-E-A-T Signals</p>
                                            {Object.entries(data.serpDna.eatSignals || {}).map(([k, v]) => (
                                                <div key={k} className="flex items-start gap-2 border border-black p-2 bg-white">
                                                    <div className="border border-black bg-black p-1 flex-shrink-0">
                                                        {k === 'experience' ? <Eye className="w-3 h-3 text-white" /> : k === 'expertise' ? <BookOpen className="w-3 h-3 text-white" /> : k === 'authority' ? <Shield className="w-3 h-3 text-white" /> : <Star className="w-3 h-3 text-white" />}
                                                    </div>
                                                    <div><p className="text-xs font-black uppercase text-black">{k}</p><p className="text-xs text-slate-600">{v}</p></div>
                                                </div>
                                            ))}
                                        </div>
                                        <div className="space-y-3">
                                            <p className="text-[11px] font-black uppercase text-slate-500">Content Gaps</p>
                                            {(data.serpDna.contentGaps || []).map((gap, i) => (
                                                <div key={i} className="flex items-start gap-2 p-2.5 border-2 border-black bg-amber-100">
                                                    <Lightbulb className="w-4 h-4 text-black flex-shrink-0 mt-0.5" /><p className="text-sm text-black font-medium">{gap}</p>
                                                </div>
                                            ))}
                                            <div className="p-2.5 border-2 border-black bg-emerald-100">
                                                <p className="text-[11px] font-black uppercase text-emerald-800 mb-0.5">Best Opportunity Angle</p>
                                                <p className="text-sm text-black font-medium">{data.serpDna.opportunityAngle}</p>
                                            </div>
                                        </div>
                                    </div>
                                    <div className="flex flex-wrap gap-2">
                                        {(data.serpDna.contentFormatDominance || []).map((f, i) => <span key={i} className="border border-black px-2 py-0.5 text-[11px] font-black uppercase">{f}</span>)}
                                        <span className="border border-black px-2 py-0.5 text-[11px] font-black uppercase bg-blue-200">Ranker: {data.serpDna.rankerProfile}</span>
                                        <span className={`border border-black px-2 py-0.5 text-[11px] font-black uppercase ${data.serpDna.difficultyVerdict?.includes('Easy') ? 'bg-emerald-200' : data.serpDna.difficultyVerdict?.includes('Impossible') ? 'bg-red-200' : 'bg-amber-200'}`}>
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
                                        <div><p className="text-[11px] font-black uppercase text-slate-500 mb-3">Search Intent Spectrum</p>
                                            <SpectrumBar data={data.intentData.intentSpectrum} colors={['bg-blue-400', 'bg-emerald-400', 'bg-violet-400', 'bg-amber-400', 'bg-rose-400', 'bg-indigo-400']} /></div>
                                        <div><p className="text-[11px] font-black uppercase text-slate-500 mb-3">Buyer Journey Stage</p>
                                            <SpectrumBar data={data.intentData.buyerJourney} colors={['bg-sky-400', 'bg-indigo-400', 'bg-violet-400', 'bg-fuchsia-400']} /></div>
                                    </div>
                                    <div className="border-2 border-black p-4 bg-blue-50">
                                        <p className="text-sm font-medium text-black">{data.intentData.intentInsight}</p>
                                    </div>
                                    {data.intentData.microIntents?.length > 0 && (
                                        <div><p className="text-[11px] font-black uppercase text-slate-500 mb-2">Micro-Intents</p>
                                            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                                                {data.intentData.microIntents.map((mi, i) => (
                                                    <div key={i} className="flex items-center gap-2 p-2.5 border-2 border-black bg-white">
                                                        <span className={`border border-black px-2 py-0.5 text-[10px] font-black uppercase ${mi.strength === 'High' ? 'bg-emerald-200' : mi.strength === 'Medium' ? 'bg-amber-200' : 'bg-slate-100'}`}>{mi.strength}</span>
                                                        <span className="text-sm font-bold text-black">{mi.intent}</span>
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
                                        {[
                                            { label: 'Opportunity Leaders', value: scoreLeaderCount, sub: highestScoringKeyword ? `${highestScoringKeyword.term} is the strongest bet.` : 'No signals yet.', accent: 'bg-white' },
                                            { label: 'Easy To Win', value: easyKeywordCount, sub: 'Lower-friction terms that can help you build traction faster.', accent: 'bg-emerald-200' },
                                            { label: 'Question-Led Topics', value: questionKeywords.length, sub: 'Great for FAQ blocks, comparison pages, and mid-funnel trust builders.', accent: 'bg-amber-200' },
                                            { label: 'Journey Coverage', value: buyerStageCount, sub: dominantIntent ? `${formatLabel(dominantIntent[0])} intent dominates this set.` : 'Buyer stages will appear once keywords load.', accent: 'bg-purple-200' },
                                        ].map((tile) => (
                                            <div key={tile.label} className={`border-2 border-black p-4 shadow-[4px_4px_0px_0px_#000] ${tile.accent}`}>
                                                <p className="text-[11px] font-black uppercase tracking-[0.14em] text-slate-600">{tile.label}</p>
                                                <p className="mt-2 text-2xl font-black text-black">{tile.value}</p>
                                                <p className="mt-1 text-xs text-slate-600 font-medium">{tile.sub}</p>
                                            </div>
                                        ))}
                                    </div>
                                    <div className="flex flex-wrap items-center gap-2">
                                        <Filter className="w-4 h-4 text-slate-600" />
                                        {intentFilters.map((filterValue) => (
                                            <button key={filterValue} onClick={() => setKwFilter(filterValue)}
                                                className={`border-2 border-black px-3 py-1 text-[11px] font-black uppercase transition-all ${kwFilter === filterValue ? 'bg-black text-white' : 'bg-white text-black hover:bg-yellow-300'}`}>
                                                {filterValue === 'all' ? 'All' : formatLabel(filterValue)}
                                            </button>
                                        ))}
                                        <div className="ml-auto flex gap-3">
                                            <button onClick={() => setKwSort('opportunityScore')} className={`text-[11px] font-black uppercase ${kwSort === 'opportunityScore' ? 'text-black border-b-2 border-black' : 'text-slate-400'}`}>By Score</button>
                                            <button onClick={() => setKwSort('term')} className={`text-[11px] font-black uppercase ${kwSort === 'term' ? 'text-black border-b-2 border-black' : 'text-slate-400'}`}>A-Z</button>
                                        </div>
                                    </div>
                                    <div className="border-2 border-black overflow-hidden">
                                        <div className="hidden md:block">
                                            <div className="grid grid-cols-12 gap-2 px-4 py-3 bg-black text-white text-[11px] font-black uppercase tracking-wider">
                                                <div className="col-span-4">Keyword</div><div className="col-span-2">Intent</div><div className="col-span-1">Vol</div><div className="col-span-2">Difficulty</div><div className="col-span-1">Score</div><div className="col-span-2">Stage</div>
                                            </div>
                                            <div className="max-h-[400px] overflow-y-auto divide-y-2 divide-black">
                                                {sortedKeywords.length > 0 ? sortedKeywords.map((k, i) => (
                                                    <div key={i} className="grid grid-cols-12 gap-2 px-4 py-3 items-center hover:bg-yellow-50 transition-colors text-sm">
                                                        <div className="col-span-4">
                                                            <p className="font-mono text-xs font-bold text-black">{k.term}</p>
                                                            <p className="mt-1 text-[11px] text-slate-500">{formatLabel(k.source || 'Unknown source')}</p>
                                                            {k.adsMetrics && (
                                                                <p className="mt-1 text-[11px] text-emerald-700 font-bold">
                                                                    Vol {k.adsMetrics.searchVolume ?? 'n/a'} · CPC {k.adsMetrics.cpc ?? 'n/a'}
                                                                </p>
                                                            )}
                                                        </div>
                                                        <div className="col-span-2"><span className="border border-black px-2 py-0.5 text-[10px] font-black uppercase">{k.intent}</span></div>
                                                        <div className={`col-span-1 font-black text-xs uppercase ${volColors[k.volume] || ''}`}>{k.volume}</div>
                                                        <div className="col-span-2"><span className={`border border-black px-2 py-0.5 text-[10px] font-black uppercase ${k.difficulty === 'Easy' ? 'bg-emerald-200' : k.difficulty === 'Hard' ? 'bg-red-200' : 'bg-amber-200'}`}>{k.difficulty}</span></div>
                                                        <div className="col-span-1"><span className="border border-black px-2 py-0.5 text-[10px] font-black bg-yellow-200">{k.opportunityScore}</span></div>
                                                        <div className="col-span-2 text-xs text-slate-600 font-bold uppercase">{k.buyerStage}</div>
                                                    </div>
                                                )) : (
                                                    <div className="px-4 py-10 text-center text-sm text-slate-500 font-black uppercase">No keywords match the current filter.</div>
                                                )}
                                            </div>
                                        </div>
                                        <div className="divide-y-2 divide-black md:hidden">
                                            {sortedKeywords.length > 0 ? sortedKeywords.map((keyword, index) => (
                                                <div key={`${keyword.term}-${index}`} className="p-4 space-y-3">
                                                    <div className="flex items-start justify-between gap-3">
                                                        <div>
                                                            <p className="font-mono text-xs font-black text-black uppercase">{keyword.term}</p>
                                                            <p className="mt-1 text-[11px] text-slate-500">{formatLabel(keyword.source || 'Unknown source')}</p>
                                                            {keyword.adsMetrics && (
                                                                <p className="mt-1 text-[11px] text-emerald-700 font-bold">
                                                                    Vol {keyword.adsMetrics.searchVolume ?? 'n/a'} · CPC {keyword.adsMetrics.cpc ?? 'n/a'}
                                                                </p>
                                                            )}
                                                        </div>
                                                        <span className="border border-black px-2 py-0.5 text-xs font-black bg-yellow-200">{keyword.opportunityScore}</span>
                                                    </div>
                                                    <div className="flex flex-wrap gap-2">
                                                        <span className="border border-black px-2 py-0.5 text-[10px] font-black uppercase">{keyword.intent}</span>
                                                        <span className={`border border-black px-2 py-0.5 text-[10px] font-black uppercase ${keyword.difficulty === 'Easy' ? 'bg-emerald-200' : keyword.difficulty === 'Hard' ? 'bg-red-200' : 'bg-amber-200'}`}>{keyword.difficulty}</span>
                                                        <span className="border border-black px-2 py-0.5 text-[10px] font-black uppercase">{keyword.volume}</span>
                                                    </div>
                                                    <div className="text-xs text-slate-600 font-black uppercase">Stage: {keyword.buyerStage}</div>
                                                </div>
                                            )) : (
                                                <div className="px-4 py-10 text-center text-sm text-slate-500 font-black uppercase">No keywords match the current filter.</div>
                                            )}
                                        </div>
                                    </div>
                                    {questionKeywords.length > 0 && (
                                        <div>
                                            <div className="flex items-center justify-between gap-3 mb-3">
                                                <p className="text-[11px] font-black uppercase text-slate-600">Question Keywords</p>
                                                <p className="text-xs text-slate-500 font-medium">Useful for FAQ blocks, section headers, and comparison pages.</p>
                                            </div>
                                            <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
                                                {questionKeywords.slice(0, 6).map((keyword, index) => (
                                                    <div key={`${keyword.question}-${index}`} className="border-2 border-black p-3 bg-amber-100">
                                                        <p className="text-sm font-black text-black">{keyword.question}</p>
                                                        <div className="mt-2 flex items-center gap-2">
                                                            <span className="border border-black px-2 py-0.5 text-[10px] font-black uppercase bg-white">{keyword.intent}</span>
                                                            <span className={`font-black uppercase text-xs ${volColors[keyword.volume] || 'text-black'}`}>{keyword.volume}</span>
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                    {data.keywordUniverse.lsiTerms?.length > 0 && (
                                        <div><p className="text-[11px] font-black uppercase text-slate-600 mb-2">Semantic / LSI Terms</p>
                                            <div className="flex flex-wrap gap-2">{data.keywordUniverse.lsiTerms.map((t, i) => <span key={i} className="border border-black px-2 py-0.5 text-[11px] font-black uppercase bg-purple-100">{t}</span>)}</div>
                                        </div>
                                    )}
                                    {data.keywordUniverse.longTailGems?.length > 0 && (
                                        <div><p className="text-[11px] font-black uppercase text-slate-600 mb-2">Long-Tail Gems</p>
                                            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">{data.keywordUniverse.longTailGems.map((g, i) => (
                                                <div key={i} className="border-2 border-black p-3 bg-amber-100 shadow-[4px_4px_0px_0px_#000]">
                                                    <p className="font-black text-sm text-black uppercase">{g.term}</p>
                                                    <p className="text-xs text-slate-700 mt-0.5 font-medium">{g.reason}</p>
                                                    <span className="border border-black px-2 py-0.5 text-[10px] font-black uppercase bg-amber-300 mt-2 inline-block">Score: {g.opportunityScore}</span>
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
                                        <div key={i} className="border-2 border-black p-4 bg-white hover:shadow-[4px_4px_0px_0px_#000] transition-all">
                                            <div className="flex items-center justify-between mb-3">
                                                <h4 className="font-black text-black uppercase">{cluster.name}</h4>
                                                <span className={`border border-black px-2 py-0.5 text-[10px] font-black uppercase ${cluster.priority === 'P0' ? 'bg-red-400 text-white' : cluster.priority === 'P1' ? 'bg-amber-400 text-white' : cluster.priority === 'P2' ? 'bg-blue-400 text-white' : 'bg-slate-300 text-white'}`}>{cluster.priority}</span>
                                            </div>
                                            <div className="flex items-center gap-2 mb-3">
                                                <span className="text-xs text-slate-600 font-black uppercase">{cluster.intent}</span>
                                                <span className="text-slate-300">·</span>
                                                <span className="text-xs text-slate-600 font-black uppercase">{cluster.contentFormat}</span>
                                            </div>
                                            <div className="flex flex-wrap gap-1.5">
                                                {cluster.keywords?.map((k, j) => (
                                                    <span key={j} className="border border-black px-2 py-1 text-xs font-bold text-black bg-slate-50">
                                                        {k.term} <span className="font-black">{k.opportunityScore}</span>
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
                                        <div key={i} className="border-2 border-black p-4 bg-emerald-100 shadow-[4px_4px_0px_0px_#000]">
                                            <p className="font-black text-black uppercase">{qw.keyword}</p>
                                            <p className="text-sm text-slate-700 mt-1 font-medium">{qw.reason}</p>
                                            <div className="flex items-center gap-3 mt-2">
                                                <span className="border border-black px-2 py-0.5 text-[10px] font-black uppercase bg-emerald-300">{qw.timeToRank}</span>
                                                <span className="text-xs text-slate-700 font-black uppercase">Action: {qw.action}</span>
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
                                        {[
                                            { label: 'Format', value: data.strategy.contentBlueprint.primaryFormat, accent: 'bg-blue-200' },
                                            { label: 'Word Count', value: data.strategy.contentBlueprint.wordCountTarget, accent: 'bg-purple-200' },
                                            { label: 'Time to Impact', value: data.strategy.contentBlueprint.timeToImpact, accent: 'bg-emerald-200' },
                                        ].map((item) => (
                                            <div key={item.label} className={`border-2 border-black p-4 shadow-[4px_4px_0px_0px_#000] ${item.accent}`}>
                                                <p className="text-[11px] font-black uppercase text-slate-600">{item.label}</p>
                                                <p className="font-black text-black uppercase mt-1">{item.value}</p>
                                            </div>
                                        ))}
                                    </div>
                                    <div className="border-2 border-black p-4 bg-yellow-50 shadow-[4px_4px_0px_0px_#000]">
                                        <p className="text-[11px] font-black uppercase text-slate-600 mb-1">Unique Angle</p>
                                        <p className="text-slate-800 font-medium">{data.strategy.contentBlueprint.uniqueAngle}</p>
                                    </div>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        <div><p className="text-[11px] font-black uppercase text-emerald-800 mb-2">Must Include</p>
                                            <div className="space-y-1.5">{(data.strategy.contentBlueprint.mustInclude || []).map((m, i) => <div key={i} className="flex items-start gap-2 text-sm text-black border-l-4 border-emerald-500 pl-3 py-1 font-medium">{m}</div>)}</div>
                                        </div>
                                        <div><p className="text-[11px] font-black uppercase text-red-700 mb-2">Avoid</p>
                                            <div className="space-y-1.5">{(data.strategy.contentBlueprint.avoid || []).map((a, i) => <div key={i} className="flex items-start gap-2 text-sm text-black border-l-4 border-red-500 pl-3 py-1 font-medium">{a}</div>)}</div>
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
                                            <div key={key} className="border-2 border-black p-4 bg-white shadow-[4px_4px_0px_0px_#000]">
                                                <p className="text-[11px] font-black uppercase text-slate-500">{label}</p>
                                                <p className={`text-xl font-black mt-1 uppercase ${v?.verdict === 'High' ? 'text-emerald-700' : v?.verdict === 'Low' ? 'text-red-600' : 'text-amber-600'}`}>{v?.verdict}</p>
                                                <p className="mt-2 text-xs text-slate-600 font-medium">{v?.reason}</p>
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
                                        <div key={i} className="flex items-center gap-3 border-2 border-black p-3 bg-white hover:bg-yellow-50 transition-colors">
                                            <span className="w-7 h-7 border-2 border-black bg-black text-white flex items-center justify-center text-xs font-black flex-shrink-0">{i + 1}</span>
                                            <span className="text-sm font-bold text-black">{step}</span>
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
                                        <div key={i} className="border-2 border-black p-3 bg-white hover:bg-yellow-50 transition-colors">
                                            <p className="font-black text-sm text-black uppercase">{q.question}</p>
                                            {q.snippet && <p className="text-xs text-slate-600 mt-1 font-medium">{q.snippet}</p>}
                                        </div>
                                    ))}
                                </div>
                            </Section>
                        )}

                        {(relatedSearches.length > 0 || serpFeatures.length > 0 || data.serpRaw?.knowledgeGraph) && (
                            <Section icon={Search} title="Demand Signals" badge="SERP pulse" defaultOpen={false}>
                                <div className="grid gap-4 md:grid-cols-2">
                                    <div className="border-2 border-black p-4 bg-slate-50">
                                        <p className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-600 mb-3">Related Searches</p>
                                        <div className="flex flex-wrap gap-2">
                                            {relatedSearches.length > 0 ? relatedSearches.slice(0, 10).map((term, index) => (
                                                <span key={`${term}-${index}`} className="border border-black px-2 py-0.5 text-[11px] font-bold bg-white">{term}</span>
                                            )) : (
                                                <p className="text-sm text-slate-500 font-medium">No related searches were returned for this query.</p>
                                            )}
                                        </div>
                                    </div>
                                    <div className="space-y-4">
                                        <div className="border-2 border-black p-4 bg-white">
                                            <p className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-600 mb-3">SERP Features</p>
                                            <div className="flex flex-wrap gap-2">
                                                {serpFeatures.length > 0 ? serpFeatures.map((feature, index) => (
                                                    <span key={`${feature}-${index}`} className="border border-black px-2 py-0.5 text-[11px] font-black uppercase bg-blue-100">{formatLabel(feature)}</span>
                                                )) : (
                                                    <p className="text-sm text-slate-500 font-medium">This SERP is relatively plain compared to richer result pages.</p>
                                                )}
                                            </div>
                                            <p className="mt-3 text-xs text-slate-500 font-mono">Approx. results: {data.serpRaw?.totalResults?.toLocaleString?.() || 'N/A'}</p>
                                        </div>
                                        {data.serpRaw?.knowledgeGraph && (
                                            <div className="border-2 border-black p-4 bg-emerald-100 shadow-[4px_4px_0px_0px_#000]">
                                                <p className="text-[11px] font-black uppercase tracking-[0.18em] text-emerald-800">Knowledge Graph</p>
                                                <p className="mt-2 text-sm font-black text-black uppercase">{data.serpRaw.knowledgeGraph.title}</p>
                                                <p className="mt-1 text-[11px] uppercase tracking-[0.14em] text-emerald-700 font-bold">{data.serpRaw.knowledgeGraph.type}</p>
                                                <p className="mt-2 text-sm leading-relaxed text-black font-medium">{data.serpRaw.knowledgeGraph.description}</p>
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
                                    <div key={i} className="border-2 border-black p-4 bg-white hover:bg-yellow-50 hover:shadow-[4px_4px_0px_0px_#000] transition-all group">
                                        <div className="flex items-start gap-4">
                                            <span className="w-8 h-8 border-2 border-black bg-black text-white flex items-center justify-center text-sm font-black flex-shrink-0">{i + 1}</span>
                                            <div className="flex-1 min-w-0">
                                                <a href={item.url} target="_blank" rel="noreferrer" className="font-black text-black hover:underline flex items-center gap-1.5 text-sm uppercase">
                                                    {item.title}<ExternalLink className="w-3 h-3 opacity-0 group-hover:opacity-100 flex-shrink-0" />
                                                </a>
                                                <p className="text-xs text-emerald-700 font-mono truncate mt-0.5">{item.url}</p>
                                                <p className="text-sm text-slate-600 mt-1.5 leading-relaxed font-medium">{item.snippet}</p>
                                                <button onClick={() => handleScan(item.url)} disabled={scanningUrl === item.url}
                                                    className="mt-2 border border-black px-3 py-1 text-[11px] font-black uppercase bg-white hover:bg-yellow-300 transition-colors inline-flex items-center gap-1 disabled:opacity-50">
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
                    <div className="border-t-2 border-black pt-4 text-center text-xs font-mono font-bold text-slate-500 uppercase pb-8">
                        Analyzed with {data.metadata.provider || 'AI provider'} · {data.metadata.model} · {data.metadata.layers} reasoning layers · {new Date(data.metadata.timestamp).toLocaleString()}
                    </div>
                )}
            </div>

            {/* Scan Modal */}
            <AnimatePresence>
                {scanResult && (
                    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
                        <motion.div initial={{ scale: 0.95, y: 20 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.95, opacity: 0 }}
                            className="bg-white border-2 border-black w-full max-w-2xl max-h-[80vh] flex flex-col"
                            style={{ boxShadow: '8px 8px 0 0 #000' }}
                        >
                            <div className="flex items-center justify-between p-5 border-b-2 border-black bg-black text-white">
                                <div className="flex items-center gap-2">
                                    <Target className="w-5 h-5" />
                                    <h2 className="font-black text-lg uppercase">Keyword X-Ray</h2>
                                </div>
                                <button onClick={() => setScanResult(null)} className="border border-white px-3 py-1 text-sm font-black uppercase hover:bg-white hover:text-black transition-colors">Close</button>
                            </div>
                            <div className="p-5 overflow-y-auto">
                                <div className="mb-4 border-2 border-black p-3 bg-slate-50">
                                    <p className="text-[11px] font-black uppercase text-slate-500">Target</p>
                                    <p className="text-sm font-mono text-black truncate">{scanResult.url}</p>
                                    <p className="text-xs text-slate-500 mt-1 font-mono">
                                        Words: {scanResult.totalWords}
                                        {scanResult.scanSource ? ` · Source: ${scanResult.scanSource}` : ''}
                                    </p>
                                </div>
                                <div className="border-2 border-black overflow-hidden">
                                    <div className="grid grid-cols-12 gap-2 px-4 py-3 bg-black text-white text-[11px] font-black uppercase tracking-wider">
                                        <div className="col-span-6">Keyword</div><div className="col-span-3 text-right">Count</div><div className="col-span-3 text-right">Density</div>
                                    </div>
                                    <div className="divide-y-2 divide-black">
                                        {scanResult.topKeywords.map((keyword, i) => (
                                            <div key={i} className="grid grid-cols-12 gap-2 px-4 py-2.5 text-sm hover:bg-yellow-50 transition-colors">
                                                <div className="col-span-6 font-mono text-black font-bold text-xs">{keyword.keyword}</div>
                                                <div className="col-span-3 text-right text-slate-700 font-bold">{keyword.count}</div>
                                                <div className="col-span-3 text-right"><span className="border border-black px-2 py-0.5 text-[10px] font-black uppercase bg-yellow-200">{keyword.density}</span></div>
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












