import { useState, useEffect, useRef } from 'react';
import { Search, Loader2, Target, BarChart3, Layers, Sparkles, ExternalLink, Zap, Save, History, ChevronRight, TrendingUp, Brain, Lightbulb, Crosshair, Rocket, ArrowRight, ChevronDown, ChevronUp, HelpCircle, Star, Shield, Eye, BookOpen, Filter, type LucideIcon } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { api } from './api';
import type { KeywordDataV2, KeywordHistoryItem, KeywordItem, KeywordScanResult, StrategicSynthesis } from './types';

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

function isKeywordDataV2(item: KeywordHistoryItem): item is KeywordDataV2 & { id: string; timestamp: string } {
    return 'keywordUniverse' in item && 'strategy' in item && 'metadata' in item;
}

const intentColors: Record<string, string> = {
    informational: 'bg-blue-100 text-blue-700', commercial: 'bg-amber-100 text-amber-700',
    transactional: 'bg-emerald-100 text-emerald-700', navigational: 'bg-violet-100 text-violet-700',
    comparison: 'bg-rose-100 text-rose-700',
};
const volColors: Record<string, string> = { High: 'text-emerald-600', Medium: 'text-amber-600', Low: 'text-slate-500' };
const diffColors: Record<string, string> = { Easy: 'bg-emerald-100 text-emerald-700', Medium: 'bg-amber-100 text-amber-700', Hard: 'bg-rose-100 text-rose-700' };
const prioColors: Record<string, string> = { P0: 'bg-rose-500 text-white', P1: 'bg-amber-500 text-white', P2: 'bg-blue-500 text-white', P3: 'bg-slate-400 text-white' };

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

export default function KeywordResearch() {
    const [seed, setSeed] = useState('');
    const [data, setData] = useState<KeywordDataV2 | null>(null);
    const [history, setHistory] = useState<KeywordHistoryItem[]>([]);
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [showHistory, setShowHistory] = useState(false);
    const [currentLayer, setCurrentLayer] = useState(0);
    const [scanResult, setScanResult] = useState<KeywordScanResult | null>(null);
    const [scanningUrl, setScanningUrl] = useState<string | null>(null);
    const [kwFilter, setKwFilter] = useState('all');
    const [kwSort, setKwSort] = useState<'opportunityScore' | 'term'>('opportunityScore');
    const [activeBanter, setActiveBanter] = useState('');
    const banterIndexRef = useRef<Record<number, number>>({});

    useEffect(() => { void fetchHistory(); }, []);

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

    const fetchHistory = async () => {
        try {
            setHistory(await api.getKeywordHistory());
        } catch (error) {
            console.error('Failed to load keyword history:', error);
        }
    };

    const handleSave = async () => {
        if (!data) return;

        setSaving(true);
        try {
            await api.saveKeywordResearch(data);
            await fetchHistory();
            alert('Research saved!');
        } catch (error) {
            alert(getErrorMessage(error, 'Failed to save research.'));
        } finally {
            setSaving(false);
        }
    };

    const loadFromHistory = (item: KeywordHistoryItem) => {
        if (!isKeywordDataV2(item)) {
            alert('This saved research uses the legacy format and cannot be opened in the new interface.');
            return;
        }

        setData(item);
        setSeed(item.seed);
        setShowHistory(false);
    };

    const handleScan = async (url: string) => {
        setScanningUrl(url);
        try {
            setScanResult(await api.analyzePageKeywords(url));
        } catch (error) {
            alert(getErrorMessage(error, 'Scan failed.'));
        } finally {
            setScanningUrl(null);
        }
    };

    const handleSearch = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!seed.trim()) return;
        setLoading(true); setData(null); setCurrentLayer(0);
        const layerTimer = setInterval(() => setCurrentLayer(p => Math.min(p + 1, 4)), 8000);
        try {
            const json = await api.researchKeywordsV2(seed);
            setData(json);
            setCurrentLayer(5);
        } catch (error) {
            alert(getErrorMessage(error, 'Analysis failed. Please try again.'));
        } finally {
            clearInterval(layerTimer);
            setLoading(false);
        }
    };

    const filteredKeywords = data?.keywordUniverse?.keywords?.filter((k: KeywordItem) => kwFilter === 'all' || k.intent?.toLowerCase() === kwFilter) || [];
    const sortedKeywords = [...filteredKeywords].sort((a, b) => kwSort === 'opportunityScore' ? (b.opportunityScore - a.opportunityScore) : a.term.localeCompare(b.term));
    const viabilityAudiences: Array<{ key: keyof StrategicSynthesis['viability']; label: string }> = [
        { key: 'soloCreator', label: 'Solo Creator' },
        { key: 'smallBusiness', label: 'Small Business' },
        { key: 'brand', label: 'Brand' },
    ];

    return (
        <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-indigo-50/30 relative">
            {/* History Toggle */}
            <button onClick={() => setShowHistory(!showHistory)} className="fixed left-4 top-4 z-50 w-10 h-10 rounded-xl bg-white border border-slate-200 shadow-md flex items-center justify-center hover:bg-indigo-50 hover:border-indigo-200 transition-all">
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
                                <div key={item.id} onClick={() => loadFromHistory(item)}
                                    className="p-3.5 rounded-xl hover:bg-indigo-50 cursor-pointer transition-all border border-transparent hover:border-indigo-100 group">
                                    <div className="flex justify-between items-center">
                                        <span className="font-semibold text-slate-800 group-hover:text-indigo-700">{item.seed}</span>
                                        <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-indigo-500" />
                                    </div>
                                    <span className="text-xs text-slate-400 mt-1 block">{new Date(item.timestamp).toLocaleDateString()}</span>
                                </div>
                            ))}
                            {history.length === 0 && <p className="text-sm text-slate-400 text-center py-8">No saved research yet</p>}
                        </div>
                    </motion.div>
                </>)}
            </AnimatePresence>

            <div className="max-w-7xl mx-auto px-6 py-12 space-y-8">
                {/* Hero */}
                <div className="text-center space-y-5 pt-4 pb-2">
                    <h1 className="text-4xl md:text-5xl font-extrabold text-slate-900 tracking-tight">
                        Keyword <span className="bg-gradient-to-r from-indigo-600 to-violet-600 bg-clip-text text-transparent">Intelligence</span>
                    </h1>
                    <form onSubmit={handleSearch} className="max-w-2xl mx-auto flex gap-3">
                        <div className="flex-1 relative">
                            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                            <input type="text" value={seed} onChange={e => setSeed(e.target.value)} placeholder="Enter a topic or keyword (e.g., CRM software)..."
                                className="premium-input pl-12 pr-4" />
                        </div>
                        <button type="submit" disabled={loading} className="premium-button bg-indigo-600 text-white hover:bg-indigo-700 shadow-lg shadow-indigo-200 disabled:opacity-60">
                            {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <><ArrowRight className="w-5 h-5" /> Analyze</>}
                        </button>
                        {data && (
                            <button onClick={handleSave} disabled={saving} type="button" className="premium-button bg-emerald-600 text-white hover:bg-emerald-700 shadow-lg shadow-emerald-200">
                                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                            </button>
                        )}
                    </form>
                </div>

                {/* Loading */}
                <AnimatePresence>
                    {loading && (
                        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="glass-card p-8 max-w-2xl mx-auto">
                            <div className="space-y-4">
                                {LAYER_STEPS.map((step, i) => {
                                    const Icon = step.icon;
                                    const active = i === currentLayer;
                                    const done = i < currentLayer;
                                    return (
                                        <div key={step.id} className={`flex items-center gap-4 p-3 rounded-xl transition-all duration-500 ${active ? 'bg-indigo-50 border border-indigo-100' : done ? 'opacity-60' : 'opacity-30'}`}>
                                            <div className={`w-10 h-10 rounded-xl flex items-center justify-center transition-all ${done ? 'bg-emerald-100' : active ? 'bg-indigo-100 animate-pulse' : 'bg-slate-100'}`}>
                                                {done ? <span className="text-emerald-600 font-bold text-sm">✓</span> : <Icon className={`w-5 h-5 ${active ? 'text-indigo-600' : 'text-slate-400'}`} />}
                                            </div>
                                            <div className="flex-1">
                                                <p className={`font-semibold text-sm ${active ? 'text-indigo-700' : done ? 'text-emerald-700' : 'text-slate-500'}`}>Layer {step.id}: {step.label}</p>
                                                <p className="text-xs text-slate-400">{step.desc}</p>
                                                {active && (
                                                    <motion.div
                                                        key={`banter-${step.id}-${activeBanter}`}
                                                        initial={{ opacity: 0, y: 4 }}
                                                        animate={{ opacity: 1, y: 0 }}
                                                        transition={{ duration: 0.2 }}
                                                        className="min-h-[36px] mt-2"
                                                    >
                                                        <div
                                                            aria-live="polite"
                                                            className="inline-flex items-center rounded-lg border border-indigo-200/80 bg-gradient-to-r from-indigo-50 to-sky-50 px-2.5 py-1.5 text-xs italic text-indigo-700 shadow-sm animate-pulse-soft"
                                                        >
                                                            {activeBanter}
                                                        </div>
                                                    </motion.div>
                                                )}
                                            </div>
                                            {active && <Loader2 className="w-4 h-4 text-indigo-500 animate-spin ml-auto" />}
                                        </div>
                                    );
                                })}
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
                                <ScoreRing score={data.strategy?.difficulty?.score || 0} color={data.strategy?.difficulty?.score > 70 ? '#E11D48' : data.strategy?.difficulty?.score > 40 ? '#D97706' : '#059669'} />
                                <div><p className="text-xs font-medium text-slate-500 uppercase tracking-wide">Difficulty</p><p className="font-bold text-slate-900">{data.strategy?.difficulty?.label || 'N/A'}</p></div>
                            </div>
                            <div className="premium-card p-5 flex items-center gap-4">
                                <ScoreRing score={data.serpSummary?.volumeScore || 0} color="#4F46E5" />
                                <div><p className="text-xs font-medium text-slate-500 uppercase tracking-wide">Volume Score</p><p className="font-bold text-slate-900">{data.serpSummary?.volumeScore || 0}/100</p></div>
                            </div>
                            <div className="premium-card p-5">
                                <p className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-2">SERP Personality</p>
                                <p className="font-bold text-indigo-600 text-lg">{data.serpDna?.serpPersonality || 'N/A'}</p>
                            </div>
                            <div className="premium-card p-5">
                                <p className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-2">Keywords Found</p>
                                <p className="font-bold text-slate-900 text-3xl">{data.keywordUniverse?.totalKeywords || 0}</p>
                                <p className="text-xs text-slate-400 mt-1">{data.strategy?.quickWins?.length || 0} quick wins identified</p>
                            </div>
                        </div>

                        {/* SERP DNA */}
                        {data.serpDna && (
                            <Section icon={Brain} title="SERP DNA Intelligence" badge="Layer 2">
                                <div className="space-y-4">
                                    <div className="p-4 rounded-xl bg-gradient-to-r from-indigo-50 to-violet-50 border border-indigo-100">
                                        <p className="text-xs font-semibold text-indigo-600 uppercase mb-1">What Google Wants</p>
                                        <p className="text-slate-700 font-medium leading-relaxed">{data.serpDna.googleWants}</p>
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
                                                    <Lightbulb className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" /><p className="text-sm text-amber-800">{gap}</p>
                                                </div>
                                            ))}
                                            <div className="p-2.5 rounded-lg bg-emerald-50 border border-emerald-100">
                                                <p className="text-xs font-semibold text-emerald-600 mb-0.5">Best Opportunity Angle</p>
                                                <p className="text-sm text-emerald-700">{data.serpDna.opportunityAngle}</p>
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
                                        <p className="text-sm text-indigo-800 font-medium">{data.intentData.intentInsight}</p>
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
                                    <div className="flex flex-wrap items-center gap-2">
                                        <Filter className="w-4 h-4 text-slate-400" />
                                        {['all', 'informational', 'commercial', 'transactional', 'comparison'].map(f => (
                                            <button key={f} onClick={() => setKwFilter(f)} className={`premium-badge cursor-pointer transition-colors ${kwFilter === f ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
                                                {f === 'all' ? 'All' : f.charAt(0).toUpperCase() + f.slice(1)}
                                            </button>
                                        ))}
                                        <div className="ml-auto flex gap-2">
                                            <button onClick={() => setKwSort('opportunityScore')} className={`text-xs font-medium ${kwSort === 'opportunityScore' ? 'text-indigo-600' : 'text-slate-400'}`}>By Score</button>
                                            <button onClick={() => setKwSort('term')} className={`text-xs font-medium ${kwSort === 'term' ? 'text-indigo-600' : 'text-slate-400'}`}>A-Z</button>
                                        </div>
                                    </div>
                                    <div className="rounded-xl border border-slate-200 overflow-hidden">
                                        <div className="grid grid-cols-12 gap-2 px-4 py-2.5 bg-slate-50 text-xs font-semibold text-slate-500 uppercase tracking-wider border-b border-slate-200">
                                            <div className="col-span-4">Keyword</div><div className="col-span-2">Intent</div><div className="col-span-1">Vol</div><div className="col-span-2">Difficulty</div><div className="col-span-1">Score</div><div className="col-span-2">Stage</div>
                                        </div>
                                        <div className="max-h-[400px] overflow-y-auto divide-y divide-slate-100">
                                            {sortedKeywords.map((k, i) => (
                                                <div key={i} className="grid grid-cols-12 gap-2 px-4 py-3 items-center hover:bg-indigo-50/30 transition-colors text-sm">
                                                    <div className="col-span-4 font-medium text-slate-800 font-mono text-xs">{k.term}</div>
                                                    <div className="col-span-2"><span className={`premium-badge text-[10px] ${intentColors[k.intent?.toLowerCase()] || 'bg-slate-100 text-slate-600'}`}>{k.intent}</span></div>
                                                    <div className={`col-span-1 font-semibold text-xs ${volColors[k.volume] || ''}`}>{k.volume}</div>
                                                    <div className="col-span-2"><span className={`premium-badge text-[10px] ${diffColors[k.difficulty] || ''}`}>{k.difficulty}</span></div>
                                                    <div className="col-span-1"><span className="font-bold text-indigo-600">{k.opportunityScore}</span></div>
                                                    <div className="col-span-2 text-xs text-slate-500">{k.buyerStage}</div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
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
                                                <span className="text-xs text-slate-300">•</span>
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
                                        <p className="text-slate-700 font-medium">{data.strategy.contentBlueprint.uniqueAngle}</p>
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
                                                <p className="text-xs text-slate-500 mt-2">{v?.reason}</p>
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
                        Analyzed with {data.metadata.model} • {data.metadata.layers} reasoning layers • {new Date(data.metadata.timestamp).toLocaleString()}
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







