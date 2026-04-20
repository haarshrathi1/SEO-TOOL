import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence, useInView } from 'framer-motion';
import {
    Activity, Brain, CheckCircle, ChevronDown, ChevronRight,
    Layout, Link2, Search, Shield, Sparkles, Target,
    TrendingUp, Zap, AlertTriangle, FileSearch, GitBranch,
    Eye, ArrowRight, X, Menu, CheckCircle2, XCircle,
    LogOut, Star, Plus, Globe, DollarSign, BarChart2, Users,
    Loader2,
} from 'lucide-react';
import Logo from './components/app/Logo';

interface LandingPageProps { onLogin: () => void; serverReady?: boolean; }
type Currency = 'INR' | 'USD';

/* ─── SCROLL Y ─── */
function useScrollY() {
    const [y, setY] = useState(0);
    useEffect(() => {
        const fn = () => setY(window.scrollY);
        window.addEventListener('scroll', fn, { passive: true });
        return () => window.removeEventListener('scroll', fn);
    }, []);
    return y;
}

/* ─── COUNT-UP ─── */
function useCountUp(target: number, duration = 1400, trigger: boolean) {
    const [val, setVal] = useState(0);
    useEffect(() => {
        if (!trigger) return;
        const start = performance.now();
        const step = (now: number) => {
            const p = Math.min((now - start) / duration, 1);
            const eased = 1 - Math.pow(1 - p, 3);
            setVal(Math.round(eased * target));
            if (p < 1) requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
    }, [target, duration, trigger]);
    return val;
}

/* ─── ANIMATION PRIMITIVES ─── */
const ease = [0.22, 1, 0.36, 1] as const;

function FadeUp({
    children,
    delay = 0,
    y = 20,
    className = '',
}: {
    children: React.ReactNode;
    delay?: number;
    y?: number;
    className?: string;
}) {
    return (
        <motion.div
            initial={{ opacity: 0, y }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-60px' }}
            transition={{ duration: 0.55, delay, ease }}
            className={className}
        >
            {children}
        </motion.div>
    );
}

function SlideIn({
    children,
    from = 'left',
    delay = 0,
    className = '',
}: {
    children: React.ReactNode;
    from?: 'left' | 'right';
    delay?: number;
    className?: string;
}) {
    return (
        <motion.div
            initial={{ opacity: 0, x: from === 'left' ? -40 : 40 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true, margin: '-60px' }}
            transition={{ duration: 0.65, delay, ease }}
            className={className}
        >
            {children}
        </motion.div>
    );
}

const staggerContainer = {
    hidden: {},
    visible: { transition: { staggerChildren: 0.09, delayChildren: 0.05 } },
};
const staggerItem = {
    hidden: { opacity: 0, y: 22 },
    visible: { opacity: 1, y: 0, transition: { duration: 0.45, ease } },
};

function StaggerGrid({ children, className = '' }: { children: React.ReactNode; className?: string }) {
    return (
        <motion.div
            variants={staggerContainer}
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: '-40px' }}
            className={className}
        >
            {children}
        </motion.div>
    );
}
function StaggerCard({ children, className = '' }: { children: React.ReactNode; className?: string }) {
    return <motion.div variants={staggerItem} className={className}>{children}</motion.div>;
}

/* ─── MOCK UI COMPONENTS ─── */

function ScanOverlay() {
    return (
        <div className="absolute inset-0 pointer-events-none overflow-hidden z-20">
            <div className="animate-scan-line absolute left-0 right-0 h-px bg-gradient-to-r from-transparent via-yellow-400 to-transparent opacity-70" />
        </div>
    );
}

function MockUserBar({ activeTab = 'Dashboard' }: { activeTab?: string }) {
    return (
        <div className="border-b-2 border-black bg-white">
            <div className="flex items-center justify-between gap-4 px-4 py-2.5">
                <Logo variant="dark" height={18} />
                <nav className="flex items-center border-2 border-black divide-x-2 divide-black">
                    {['Dashboard', 'Audit', 'Keywords'].map(tab => (
                        <div key={tab} className={`px-3 py-1.5 text-[10px] font-black uppercase tracking-wide ${tab === activeTab ? 'bg-black text-white' : 'bg-white text-black'}`}>
                            {tab}
                        </div>
                    ))}
                </nav>
                <div className="flex items-center gap-1.5">
                    <div className="flex items-center gap-1.5 border-2 border-black px-2.5 py-1.5">
                        <div className="w-5 h-5 bg-black text-[9px] font-black text-white flex items-center justify-center">HR</div>
                        <span className="hidden sm:block text-[10px] font-black whitespace-nowrap">H. Rathi</span>
                        <span className="border border-black px-1 py-0.5 text-[8px] font-black uppercase bg-yellow-300">admin</span>
                    </div>
                    <div className="border-2 border-black p-1.5"><LogOut className="h-3.5 w-3.5" /></div>
                </div>
            </div>
        </div>
    );
}

function MockHealthGauge() {
    const score = 87;
    const dash = ((score / 100) * 180 / 180) * (2 * Math.PI * 54 / 2);
    return (
        <div className="bg-white p-4 border-2 border-black shadow-[4px_4px_0px_0px_#000] flex flex-col justify-between h-full">
            <h3 className="text-black font-black uppercase tracking-wider text-[9px] bg-yellow-300 px-1 border border-black self-start">Site Health</h3>
            <div className="flex items-center justify-center my-2 relative" style={{ height: 90 }}>
                <svg viewBox="0 0 140 80" className="w-full" style={{ maxWidth: 150 }}>
                    <path d="M 14 70 A 56 56 0 0 1 126 70" fill="none" stroke="#e2e8f0" strokeWidth="12" />
                    <path d="M 14 70 A 56 56 0 0 1 126 70" fill="none" stroke="#000" strokeWidth="12" strokeDasharray={`${dash} 999`} />
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-end pb-1">
                    <div className="text-3xl font-black text-black leading-none">{score}</div>
                    <div className="text-[8px] font-bold text-slate-500 uppercase tracking-widest">Score</div>
                </div>
            </div>
            <div className="grid grid-cols-3 gap-1 pt-2 border-t-2 border-black">
                {[{ label: 'Errors', val: '3', color: 'text-red-600' }, { label: 'Warns', val: '11', color: 'text-amber-600' }, { label: 'Good', val: '234', color: 'text-green-600' }].map(s => (
                    <div key={s.label} className="text-center">
                        <div className="text-[8px] text-slate-500 font-bold uppercase">{s.label}</div>
                        <div className={`text-lg font-black ${s.color} leading-none`}>{s.val}</div>
                    </div>
                ))}
            </div>
        </div>
    );
}

function MockCrawlStatus() {
    return (
        <div className="bg-white p-4 border-2 border-black shadow-[4px_4px_0px_0px_#000] flex flex-col h-full">
            <div className="flex items-center justify-between mb-3">
                <h3 className="text-black font-black uppercase tracking-wider text-[9px] bg-cyan-300 px-1 border border-black">Crawl Coverage</h3>
                <div className="bg-black p-1 border border-black"><Search className="w-2.5 h-2.5 text-white" /></div>
            </div>
            <div className="space-y-2 flex-1">
                {[
                    { icon: <CheckCircle2 className="w-3.5 h-3.5" />, bg: 'bg-green-200', label: 'Indexed', sub: 'Searchable', val: '234' },
                    { icon: <XCircle className="w-3.5 h-3.5" />, bg: 'bg-red-200', label: 'Not Indexed', sub: 'Issues', val: '14' },
                ].map(row => (
                    <div key={row.label} className="flex items-center justify-between p-2 bg-white border-2 border-black shadow-[2px_2px_0px_0px_#000]">
                        <div className="flex items-center gap-2">
                            <div className={`p-1 ${row.bg} border-2 border-black`}>{row.icon}</div>
                            <div>
                                <div className="text-[9px] font-black uppercase">{row.label}</div>
                                <div className="text-[9px] text-slate-500 font-bold">{row.sub}</div>
                            </div>
                        </div>
                        <div className="text-xl font-black">{row.val}</div>
                    </div>
                ))}
            </div>
            <div className="mt-3 pt-2 border-t-2 border-black text-[9px] text-slate-500 font-bold uppercase text-center">248 URLs crawled</div>
        </div>
    );
}

function MockPerformance() {
    const bars = [42, 55, 48, 63, 59, 71, 67, 80, 74, 87, 83, 90];
    return (
        <div className="bg-black p-4 border-2 border-black shadow-[4px_4px_0px_0px_#000] text-white flex flex-col relative overflow-hidden h-full">
            <span className="text-[8px] font-black uppercase tracking-wider text-yellow-400 border border-yellow-400 px-1 py-0.5 self-start">Performance</span>
            <h3 className="text-xl font-black uppercase tracking-tighter mt-1">Stable</h3>
            <p className="text-slate-400 font-bold text-[9px]">Avg: <span className="text-white">83 / 100</span></p>
            <div className="absolute bottom-0 left-0 right-0 h-14 opacity-20 flex items-end gap-0.5 px-3 pb-2">
                {bars.map((h, i) => <div key={i} className="flex-1 bg-white" style={{ height: `${h}%` }} />)}
            </div>
            <div className="relative mt-auto grid grid-cols-2 gap-2 pt-4">
                {[{ label: 'LCP', val: '1.8 s' }, { label: 'CLS', val: '0.04' }].map(m => (
                    <div key={m.label} className="p-2 bg-zinc-900 border border-zinc-700">
                        <div className="text-[8px] text-zinc-400 uppercase font-bold">{m.label}</div>
                        <div className="text-base font-black">{m.val}</div>
                    </div>
                ))}
            </div>
        </div>
    );
}

function MockMetricsBar() {
    return (
        <div className="grid grid-cols-4 gap-2 mt-2">
            {[
                { label: 'Clicks', val: '12,480', delta: '+18%' },
                { label: 'Impressions', val: '284.9K', delta: '+24%' },
                { label: 'CTR', val: '4.38%', delta: '+0.6' },
                { label: 'Avg Position', val: '14.2', delta: '-3.1 pos' },
            ].map(m => (
                <div key={m.label} className="bg-white border-2 border-black shadow-[2px_2px_0px_0px_#000] p-2.5">
                    <div className="text-[8px] font-black uppercase text-slate-500 tracking-wider">{m.label}</div>
                    <div className="text-lg font-black leading-tight mt-0.5">{m.val}</div>
                    <div className="text-[9px] font-black text-green-600">{m.delta} this week</div>
                </div>
            ))}
        </div>
    );
}

function DashboardMock() {
    return (
        <div className="relative border-2 border-black shadow-[12px_12px_0px_0px_#000] bg-white overflow-hidden">
            <ScanOverlay />
            <MockUserBar activeTab="Dashboard" />
            <div className="p-4" style={{ background: 'radial-gradient(circle at top left, rgba(254,240,138,0.2) 0%, transparent 40%), radial-gradient(circle at top right, rgba(147,197,253,0.2) 0%, transparent 40%), #f8fafc' }}>
                <div className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">Dashboard / example.com</div>
                <MockMetricsBar />
                <div className="grid grid-cols-3 gap-2 mt-2" style={{ height: 200 }}>
                    <MockHealthGauge />
                    <MockCrawlStatus />
                    <MockPerformance />
                </div>
            </div>
        </div>
    );
}

function MockAuditRow({ url, status, score, issue }: { url: string; status: 'LIVE' | 'FAIL' | 'WARN'; score: number; issue: string }) {
    const badge = status === 'LIVE'
        ? <span className="inline-flex items-center gap-1 border-2 border-black bg-green-300 px-1.5 py-0.5 text-[8px] font-black shadow-[2px_2px_0px_0px_#000]"><CheckCircle2 className="h-2.5 w-2.5" />LIVE</span>
        : status === 'FAIL'
            ? <span className="inline-flex items-center gap-1 border-2 border-black bg-red-300 px-1.5 py-0.5 text-[8px] font-black shadow-[2px_2px_0px_0px_#000]"><XCircle className="h-2.5 w-2.5" />FAIL</span>
            : <span className="inline-flex items-center gap-1 border-2 border-black bg-amber-300 px-1.5 py-0.5 text-[8px] font-black shadow-[2px_2px_0px_0px_#000]"><AlertTriangle className="h-2.5 w-2.5" />WARN</span>;
    const barColor = score >= 80 ? 'bg-green-500' : score >= 50 ? 'bg-amber-500' : 'bg-red-500';
    return (
        <div className="grid grid-cols-12 items-center gap-1.5 px-3 py-2 border-b-2 border-black/10 hover:bg-slate-50">
            <div className="col-span-5 text-[9px] font-bold truncate">{url}</div>
            <div className="col-span-2">{badge}</div>
            <div className="col-span-2 flex items-center gap-1">
                <div className="h-1.5 w-10 bg-slate-200 border border-black/20 overflow-hidden">
                    <div className={`h-full ${barColor}`} style={{ width: `${score}%` }} />
                </div>
                <span className="text-[9px] font-black">{score}</span>
            </div>
            <div className="col-span-3 text-[8px] text-slate-500 truncate">{issue}</div>
        </div>
    );
}

function AuditMock() {
    const rows = [
        { url: '/blog/10-seo-tips', status: 'LIVE' as const, score: 91, issue: 'None' },
        { url: '/products/crm-software', status: 'FAIL' as const, score: 38, issue: 'Duplicate canonical' },
        { url: '/about-us', status: 'WARN' as const, score: 62, issue: 'Thin content (230 words)' },
        { url: '/pricing', status: 'LIVE' as const, score: 78, issue: 'Missing schema' },
        { url: '/contact', status: 'FAIL' as const, score: 29, issue: '404 on 3 internal links' },
    ];
    return (
        <div className="relative border-2 border-black shadow-[12px_12px_0px_0px_#000] bg-white overflow-hidden">
            <ScanOverlay />
            <MockUserBar activeTab="Audit" />
            <div className="p-4" style={{ background: 'radial-gradient(circle at top left, rgba(254,240,138,0.2) 0%, transparent 40%), #f8fafc' }}>
                <div className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-3">Site Audit / example.com</div>
                <div className="grid grid-cols-5 gap-2 mb-3">
                    {[
                        { label: 'Crawled', val: '248', color: 'bg-black text-white' },
                        { label: 'Indexed', val: '234', color: 'bg-green-300 text-black' },
                        { label: 'Not Indexed', val: '14', color: 'bg-red-300 text-black' },
                        { label: 'Issues', val: '47', color: 'bg-amber-300 text-black' },
                        { label: 'Avg Score', val: '72', color: 'bg-cyan-300 text-black' },
                    ].map(s => (
                        <div key={s.label} className={`border-2 border-black p-2 text-center shadow-[2px_2px_0px_0px_#000] ${s.color}`}>
                            <div className="text-[8px] font-black uppercase tracking-wide opacity-70">{s.label}</div>
                            <div className="text-xl font-black leading-tight">{s.val}</div>
                        </div>
                    ))}
                </div>
                <div className="border-2 border-black bg-white">
                    <div className="grid grid-cols-12 gap-1.5 px-3 py-1.5 border-b-2 border-black bg-slate-100">
                        {['URL', 'Status', 'SEO Score', 'Top Issue'].map((h, i) => (
                            <div key={h} className={`${i === 0 ? 'col-span-5' : i === 3 ? 'col-span-3' : 'col-span-2'} text-[8px] font-black uppercase tracking-wider`}>{h}</div>
                        ))}
                    </div>
                    {rows.map(r => <MockAuditRow key={r.url} {...r} />)}
                </div>
            </div>
        </div>
    );
}

function MockStepIndicator({ step, label, active }: { step: number; label: string; active: boolean }) {
    return (
        <div className={`flex items-center gap-2 px-3 py-1.5 border-2 border-black text-[9px] font-black uppercase tracking-wide whitespace-nowrap ${active ? 'bg-black text-white' : 'bg-white text-slate-400'}`}>
            <span className={`w-4 h-4 flex items-center justify-center border border-current text-[8px] font-black ${active ? 'bg-yellow-400 text-black border-yellow-400' : ''}`}>{step}</span>
            {label}
        </div>
    );
}

function KeywordMock() {
    const rows = [
        { kw: 'best crm software 2024', vol: '18,100', diff: 'MED', intent: 'COMMERCIAL' },
        { kw: 'crm for small business', vol: '9,900', diff: 'LOW', intent: 'COMMERCIAL' },
        { kw: 'crm vs spreadsheet', vol: '2,400', diff: 'LOW', intent: 'INFO' },
        { kw: 'free crm comparison', vol: '5,400', diff: 'MED', intent: 'COMMERCIAL' },
        { kw: 'what is a crm system', vol: '12,000', diff: 'LOW', intent: 'INFO' },
    ];
    return (
        <div className="relative border-2 border-black shadow-[12px_12px_0px_0px_#000] bg-white overflow-hidden">
            <ScanOverlay />
            <MockUserBar activeTab="Keywords" />
            <div className="p-4" style={{ background: 'radial-gradient(circle at top right, rgba(147,197,253,0.2) 0%, transparent 40%), #f8fafc' }}>
                <div className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-3">Keyword Research</div>
                <div className="flex items-center gap-2 border-2 border-black bg-white px-3 py-2 shadow-[2px_2px_0px_0px_#000] mb-3">
                    <Search className="w-3.5 h-3.5 text-black" />
                    <span className="text-sm font-bold text-black flex-1">crm software</span>
                    <span className="bg-black text-white text-[8px] font-black uppercase px-2 py-1">Analyze</span>
                </div>
                <div className="flex gap-1.5 mb-3 overflow-x-auto pb-1">
                    {[{ n: 1, label: 'Collecting Data', active: false }, { n: 2, label: 'SERP DNA', active: false }, { n: 3, label: 'Intent Map', active: true }, { n: 4, label: 'Keyword Universe', active: false }, { n: 5, label: 'Strategy', active: false }].map(s => (
                        <MockStepIndicator key={s.n} step={s.n} label={s.label} active={s.active} />
                    ))}
                </div>
                <div className="border-2 border-black bg-white">
                    <div className="grid grid-cols-12 gap-1 px-3 py-1.5 border-b-2 border-black bg-slate-100">
                        {[['Keyword', 5], ['Volume', 2], ['Difficulty', 2], ['Intent', 3]].map(([h, span]) => (
                            <div key={h as string} className={`col-span-${span} text-[8px] font-black uppercase tracking-wider`}>{h}</div>
                        ))}
                    </div>
                    {rows.map(r => (
                        <div key={r.kw} className="grid grid-cols-12 gap-1 items-center px-3 py-2 border-b-2 border-black/10">
                            <div className="col-span-5 text-[9px] font-bold truncate">{r.kw}</div>
                            <div className="col-span-2 text-[9px] font-black text-green-700">{r.vol}</div>
                            <div className="col-span-2"><span className={`text-[8px] font-black px-1.5 py-0.5 border border-black ${r.diff === 'LOW' ? 'bg-green-200' : 'bg-amber-200'}`}>{r.diff}</span></div>
                            <div className="col-span-3"><span className={`text-[8px] font-black px-1.5 py-0.5 border border-black ${r.intent === 'COMMERCIAL' ? 'bg-violet-200' : 'bg-sky-200'}`}>{r.intent}</span></div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}

function CompetitorScanMock() {
    const theirKws = [
        { kw: 'crm software 2024', pos: 2, vol: '18.1K', gap: true },
        { kw: 'free crm tools', pos: 4, vol: '9.9K', gap: true },
        { kw: 'crm vs excel', pos: 1, vol: '4.2K', gap: false },
        { kw: 'sales pipeline crm', pos: 3, vol: '6.7K', gap: true },
        { kw: 'crm for startups', pos: 5, vol: '5.4K', gap: true },
    ];
    const gaps = [
        { kw: 'crm software 2024', opp: 'HIGH', vol: '18.1K' },
        { kw: 'free crm tools', opp: 'HIGH', vol: '9.9K' },
        { kw: 'sales pipeline crm', opp: 'MED', vol: '6.7K' },
        { kw: 'crm for startups', opp: 'MED', vol: '5.4K' },
    ];
    return (
        <div className="relative border-2 border-black shadow-[12px_12px_0px_0px_#000] bg-white overflow-hidden">
            <ScanOverlay />
            <MockUserBar activeTab="Keywords" />
            <div className="p-4" style={{ background: 'radial-gradient(circle at top left, rgba(251,191,36,0.15) 0%, transparent 50%), #f8fafc' }}>
                <div className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-3">Competitor Intelligence</div>
                <div className="flex items-center gap-2 border-2 border-black bg-white px-3 py-2 shadow-[3px_3px_0px_0px_#000] mb-3">
                    <Globe className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                    <span className="text-[10px] font-bold text-slate-400">https://</span>
                    <span className="text-sm font-bold text-black flex-1">competitor.com</span>
                    <div className="bg-black text-white text-[8px] font-black uppercase px-2 py-1 flex items-center gap-1 whitespace-nowrap">
                        <Search className="w-2.5 h-2.5" /> Scan Site
                    </div>
                </div>
                <div className="grid grid-cols-3 gap-2 mb-3">
                    {[
                        { label: 'Est. Traffic', val: '84.2K', color: 'bg-orange-200', delta: '+12% wk' },
                        { label: 'Organic KWs', val: '1,284', color: 'bg-violet-200', delta: '+38 new' },
                        { label: 'Ranking Pages', val: '347', color: 'bg-cyan-200', delta: '+21 pages' },
                    ].map(s => (
                        <div key={s.label} className={`border-2 border-black p-2 shadow-[2px_2px_0px_0px_#000] ${s.color}`}>
                            <div className="text-[8px] font-black uppercase tracking-wide text-black/60">{s.label}</div>
                            <div className="text-lg font-black text-black leading-tight">{s.val}</div>
                            <div className="text-[8px] font-black text-green-700">{s.delta}</div>
                        </div>
                    ))}
                </div>
                <div className="grid grid-cols-2 gap-2">
                    <div className="border-2 border-black bg-white overflow-hidden">
                        <div className="px-2.5 py-1.5 border-b-2 border-black bg-slate-100 flex items-center justify-between">
                            <span className="text-[8px] font-black uppercase tracking-wider">Their Keywords</span>
                            <span className="text-[7px] font-black text-slate-400 uppercase">competitor.com</span>
                        </div>
                        {theirKws.map(row => (
                            <div key={row.kw} className={`flex items-center justify-between px-2.5 py-1.5 border-b border-black/10 ${row.gap ? 'bg-red-50' : 'bg-white'}`}>
                                <span className="text-[9px] font-bold truncate flex-1 mr-1">{row.kw}</span>
                                <div className="flex items-center gap-1.5 shrink-0">
                                    <span className="text-[8px] font-black text-slate-500">#{row.pos}</span>
                                    <span className="text-[8px] font-black text-green-700">{row.vol}</span>
                                    {row.gap && <span className="text-[7px] font-black bg-red-300 border border-black px-1">GAP</span>}
                                </div>
                            </div>
                        ))}
                    </div>
                    <div className="border-2 border-black bg-white overflow-hidden">
                        <div className="px-2.5 py-1.5 border-b-2 border-black bg-yellow-100 flex items-center justify-between">
                            <span className="text-[8px] font-black uppercase tracking-wider">⚡ Your Gaps</span>
                            <span className="text-[7px] font-black text-amber-700 uppercase">4 found</span>
                        </div>
                        {gaps.map(row => (
                            <div key={row.kw} className="flex items-center justify-between px-2.5 py-1.5 border-b border-black/10 bg-yellow-50/50">
                                <span className="text-[9px] font-bold truncate flex-1 mr-1">{row.kw}</span>
                                <div className="flex items-center gap-1.5 shrink-0">
                                    <span className={`text-[7px] font-black border border-black px-1 ${row.opp === 'HIGH' ? 'bg-red-300' : 'bg-amber-200'}`}>{row.opp}</span>
                                    <span className="text-[8px] font-black text-slate-600">{row.vol}</span>
                                </div>
                            </div>
                        ))}
                        <div className="px-2.5 py-2 bg-black text-white text-[8px] font-black uppercase text-center tracking-wide">Generate Content Plan →</div>
                    </div>
                </div>
            </div>
        </div>
    );
}

/* ─── LANDING SECTIONS ─── */

/* ─── SERVER WARM-UP TOAST ─── */

function WarmupToast({ serverReady }: { serverReady: boolean }) {
    const [dismissed, setDismissed] = useState(false);

    // Auto-dismiss 2.5 s after server becomes ready
    useEffect(() => {
        if (!serverReady) return;
        const t = setTimeout(() => setDismissed(true), 2500);
        return () => clearTimeout(t);
    }, [serverReady]);

    return (
        <AnimatePresence>
            {!dismissed && (
                <motion.div
                    initial={{ opacity: 0, y: 24, scale: 0.95 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 16, scale: 0.95 }}
                    transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
                    className="fixed bottom-5 right-5 z-[60] border-2 border-black bg-white shadow-[4px_4px_0px_0px_#000] px-4 py-3 flex items-center gap-3 max-w-[280px]"
                >
                    {!serverReady ? (
                        <>
                            <div className="shrink-0 w-7 h-7 border-2 border-black bg-yellow-300 flex items-center justify-center">
                                <Loader2 className="w-3.5 h-3.5 animate-spin text-black" />
                            </div>
                            <div className="min-w-0">
                                <div className="text-[11px] font-black uppercase tracking-wide text-black">Server warming up</div>
                                <div className="text-[10px] text-slate-500 font-medium leading-tight mt-0.5">
                                    ~30s on first visit.<br />Sign-in is ready when it finishes.
                                </div>
                            </div>
                            <button
                                onClick={() => setDismissed(true)}
                                className="shrink-0 text-slate-400 hover:text-black transition-colors ml-1"
                                aria-label="Dismiss"
                            >
                                <X className="w-3.5 h-3.5" />
                            </button>
                        </>
                    ) : (
                        <>
                            <div className="shrink-0 w-7 h-7 border-2 border-black bg-green-300 flex items-center justify-center">
                                <CheckCircle className="w-3.5 h-3.5 text-black" />
                            </div>
                            <div className="text-[11px] font-black uppercase tracking-wide text-green-700">Server ready!</div>
                        </>
                    )}
                </motion.div>
            )}
        </AnimatePresence>
    );
}

function NavBar({ onLogin }: { onLogin: () => void }) {
    const scrollY = useScrollY();
    const [menuOpen, setMenuOpen] = useState(false);
    const solid = scrollY > 20;
    return (
        <motion.nav
            aria-label="Main navigation"
            initial={{ y: -64, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ duration: 0.5, ease }}
            className={`fixed top-0 inset-x-0 z-50 transition-all duration-300 ${solid ? 'bg-white border-b-2 border-black shadow-[0_2px_0_0_#000]' : 'bg-transparent'}`}
        >
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
                <a href="https://seotool.harshrathi.com/" rel="home">
                    <Logo variant="dark" height={36} />
                </a>
                <div className="hidden md:flex items-center gap-1">
                    {[['Features', '#features'], ['Why ClimbSEO', '#why'], ['Pricing', '#pricing'], ['FAQ', '#faq']].map(([label, href]) => (
                        <a key={label} href={href}
                            className="border-2 border-transparent hover:border-black px-3 py-1.5 text-xs font-black uppercase tracking-wide text-black transition-all hover:shadow-[2px_2px_0px_0px_#000]">
                            {label}
                        </a>
                    ))}
                </div>
                <div className="hidden md:flex items-center gap-2">
                    <button onClick={onLogin} className="border-2 border-black bg-white px-4 py-2 text-xs font-black uppercase tracking-wide shadow-[3px_3px_0px_0px_#000] hover:translate-x-[1px] hover:translate-y-[1px] hover:shadow-[2px_2px_0px_0px_#000] transition-all">Sign In</button>
                    <button onClick={onLogin} className="relative overflow-hidden border-2 border-black bg-black px-4 py-2 text-xs font-black uppercase tracking-wide text-white shadow-[3px_3px_0px_0px_#000] hover:translate-x-[1px] hover:translate-y-[1px] hover:shadow-[2px_2px_0px_0px_#000] transition-all">
                        <span className="relative z-10">Free Trial</span>
                        <span className="animate-shimmer-sweep absolute inset-0 w-1/3 bg-white/20 blur-sm" />
                    </button>
                </div>
                <button aria-label="Toggle menu" className="md:hidden border-2 border-black p-2" onClick={() => setMenuOpen(!menuOpen)}>
                    {menuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
                </button>
            </div>
            {menuOpen && (
                <motion.div
                    initial={{ opacity: 0, y: -8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.2 }}
                    className="md:hidden bg-white border-t-2 border-black px-4 py-4 space-y-1"
                >
                    {[['Features', '#features'], ['Why ClimbSEO', '#why'], ['Pricing', '#pricing'], ['FAQ', '#faq']].map(([label, href]) => (
                        <a key={label} href={href} onClick={() => setMenuOpen(false)}
                            className="block text-sm font-black uppercase tracking-wide text-black py-3 border-b-2 border-black/10">{label}</a>
                    ))}
                    <div className="pt-3 flex flex-col gap-2">
                        <button onClick={onLogin} className="w-full border-2 border-black bg-white text-black text-sm font-black uppercase py-3">Sign In</button>
                        <button onClick={onLogin} className="w-full border-2 border-black bg-black text-white text-sm font-black uppercase py-3">Start Free Trial</button>
                    </div>
                </motion.div>
            )}
        </motion.nav>
    );
}

function Hero({ onLogin }: { onLogin: () => void }) {
    return (
        <section aria-labelledby="hero-heading" className="relative pt-24 pb-12 overflow-hidden"
            style={{
                background: 'radial-gradient(circle at top left, rgba(254,240,138,0.35) 0%, transparent 30%), radial-gradient(circle at top right, rgba(147,197,253,0.28) 0%, transparent 28%), #f8fafc',
                backgroundImage: `
                    radial-gradient(circle at top left, rgba(254,240,138,0.35) 0%, transparent 30%),
                    radial-gradient(circle at top right, rgba(147,197,253,0.28) 0%, transparent 28%),
                    radial-gradient(circle, #00000009 1px, transparent 1px)
                `,
                backgroundSize: 'auto, auto, 28px 28px',
            }}
        >
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                <div className="text-center mb-10">
                    {/* Badge */}
                    <motion.div
                        initial={{ opacity: 0, scale: 0.85, y: 10 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        transition={{ duration: 0.45, ease }}
                        className="relative inline-flex items-center gap-1.5 border-2 border-black bg-yellow-300 px-3 py-1 text-[10px] font-black uppercase tracking-widest shadow-[3px_3px_0px_0px_#000] mb-6 overflow-hidden"
                    >
                        <span className="animate-shimmer-sweep absolute inset-0 w-1/3 bg-white/30 blur-sm" />
                        <Sparkles className="w-3 h-3 relative z-10" />
                        <span className="relative z-10">Full SEO Platform. From ₹499/mo or $6.99/mo.</span>
                    </motion.div>

                    {/* Headline — line by line */}
                    <h1 id="hero-heading" className="text-4xl sm:text-5xl lg:text-6xl font-black text-black leading-[1.05] tracking-tight max-w-4xl mx-auto">
                        {['The SEO platform that', 'big tools left incomplete'].map((line, i) => (
                            <motion.span
                                key={line}
                                initial={{ opacity: 0, y: 20 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ duration: 0.5, delay: 0.1 + i * 0.12, ease }}
                                className="block"
                            >
                                {i === 0 ? line : (
                                    <span className="relative inline-block">
                                        <span className="relative z-10">{line}</span>
                                        <motion.span
                                            initial={{ scaleX: 0 }}
                                            animate={{ scaleX: 1 }}
                                            transition={{ duration: 0.5, delay: 0.55, ease }}
                                            className="absolute -bottom-1 left-0 right-0 h-4 bg-yellow-300 -z-0 origin-left"
                                        />
                                    </span>
                                )}
                            </motion.span>
                        ))}
                    </h1>

                    {/* Sub */}
                    <motion.p
                        initial={{ opacity: 0, y: 16 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.5, delay: 0.38, ease }}
                        className="mt-6 text-base sm:text-lg text-slate-600 max-w-2xl mx-auto leading-relaxed font-medium"
                    >
                        Full site crawl. SERP DNA keyword research. Competitor keyword gaps. Indexation analysis.
                        Change detection. AI insights. All connected to your live GSC and GA4 data.
                    </motion.p>

                    {/* CTAs */}
                    <motion.div
                        initial={{ opacity: 0, y: 16 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.5, delay: 0.52, ease }}
                        className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-3"
                    >
                        <button onClick={onLogin}
                            className="animate-glow-pulse w-full sm:w-auto relative overflow-hidden border-2 border-black bg-black text-white font-black px-8 py-3.5 text-sm uppercase tracking-wide transition-all hover:translate-x-[2px] hover:translate-y-[2px] flex items-center justify-center gap-2">
                            <span className="animate-shimmer-sweep absolute inset-0 w-1/3 bg-white/10" />
                            <span className="relative z-10 flex items-center gap-2">Start Free Trial <ArrowRight className="w-4 h-4" /></span>
                        </button>
                        <a href="#pricing"
                            className="w-full sm:w-auto border-2 border-black bg-white text-black font-black px-8 py-3.5 text-sm uppercase tracking-wide shadow-[5px_5px_0px_0px_#000] hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-[3px_3px_0px_0px_#000] transition-all flex items-center justify-center gap-2">
                            See Pricing <ChevronDown className="w-4 h-4" />
                        </a>
                    </motion.div>

                    {/* Trust pills */}
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ duration: 0.5, delay: 0.68 }}
                        className="mt-5 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-xs text-slate-500 font-bold uppercase tracking-wide"
                    >
                        {['No credit card', '2-minute setup', 'Cancel anytime', 'GSC + GA4 included'].map((t, i) => (
                            <motion.span
                                key={t}
                                initial={{ opacity: 0, x: -8 }}
                                animate={{ opacity: 1, x: 0 }}
                                transition={{ duration: 0.3, delay: 0.72 + i * 0.07 }}
                                className="flex items-center gap-1.5"
                            >
                                <CheckCircle className="w-3.5 h-3.5 text-green-600" /> {t}
                            </motion.span>
                        ))}
                    </motion.div>
                </div>

                {/* Hero mock — floats + scans on load */}
                <motion.div
                    initial={{ opacity: 0, y: 40, scale: 0.97 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    transition={{ duration: 0.7, delay: 0.3, ease }}
                    className="overflow-x-auto -mx-4 sm:mx-0 px-4 sm:px-0"
                >
                    <motion.div
                        animate={{ y: [0, -8, 0] }}
                        transition={{ duration: 5, repeat: Infinity, ease: 'easeInOut' }}
                        className="min-w-[600px] max-w-5xl mx-auto"
                    >
                        <DashboardMock />
                    </motion.div>
                </motion.div>
            </div>
        </section>
    );
}

function StatsSection() {
    const ref = useRef(null);
    const inView = useInView(ref, { once: true });
    const c1 = useCountUp(2400, 1300, inView);
    const c2 = useCountUp(1200, 1500, inView);
    const c3 = useCountUp(38, 1100, inView);

    const stats = [
        { icon: Users, display: `${c1.toLocaleString()}+`, label: 'Sites Audited', color: 'bg-yellow-300' },
        { icon: Search, display: `${c2.toLocaleString()}K+`, label: 'Keywords Analyzed', color: 'bg-cyan-300' },
        { icon: BarChart2, display: `${c3}%`, label: 'Avg Traffic Lift', color: 'bg-green-300' },
        { icon: TrendingUp, display: '₹499', label: 'Starting Price / mo', color: 'bg-violet-300' },
    ];

    return (
        <div ref={ref} className="bg-black border-y-2 border-black py-8">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                    {stats.map((s, i) => (
                        <motion.div
                            key={i}
                            initial={{ opacity: 0, y: 20 }}
                            whileInView={{ opacity: 1, y: 0 }}
                            viewport={{ once: true }}
                            transition={{ duration: 0.45, delay: i * 0.08, ease }}
                            className="flex items-center gap-4 p-4 border-2 border-white/10 hover:border-white/30 transition-colors"
                        >
                            <div className={`w-10 h-10 border-2 border-white flex items-center justify-center shrink-0 ${s.color}`}>
                                <s.icon className="w-5 h-5 text-black" />
                            </div>
                            <div>
                                <div className="text-2xl font-black text-white leading-none">{s.display}</div>
                                <div className="text-[10px] font-black text-white/50 uppercase tracking-wider mt-0.5">{s.label}</div>
                            </div>
                        </motion.div>
                    ))}
                </div>
            </div>
        </div>
    );
}

function ComparisonStrip() {
    const tools = ['Ahrefs', 'SEMrush', 'Screaming Frog', 'Moz', 'SurferSEO', 'Search Console', 'Ubersuggest', 'Sitebulb'];
    const doubled = [...tools, ...tools];
    return (
        <div className="bg-white border-b-2 border-black py-5 overflow-hidden">
            <FadeUp delay={0}>
                <p className="text-center text-[10px] font-black uppercase tracking-widest text-slate-400 mb-4">Why SEO teams switch from expensive tools</p>
            </FadeUp>
            <div className="relative">
                {/* Fade edges */}
                <div className="absolute left-0 top-0 bottom-0 w-16 bg-gradient-to-r from-white to-transparent z-10 pointer-events-none" />
                <div className="absolute right-0 top-0 bottom-0 w-16 bg-gradient-to-l from-white to-transparent z-10 pointer-events-none" />
                <div className="flex animate-marquee gap-3 whitespace-nowrap">
                    {doubled.map((t, i) => (
                        <span key={i} className="border-2 border-black bg-white text-[10px] font-black uppercase tracking-wide px-3 py-1.5 shadow-[2px_2px_0px_0px_#000] inline-block">
                            vs {t}
                        </span>
                    ))}
                </div>
            </div>
        </div>
    );
}

function WhySection() {
    const items = [
        { icon: FileSearch, problem: 'Ahrefs and SEMrush show keyword data but cannot tell you why specific pages are not getting indexed by Google', solution: 'Indexation gap analysis plus live crawl shows exactly which pages Google skips and the precise reason why' },
        { icon: GitBranch, problem: 'Screaming Frog crawls your site but exports a flat CSV with zero context on what changed since the last audit', solution: 'Change detection compares every audit against the previous one and highlights exactly what broke between crawls' },
        { icon: Brain, problem: 'SEMrush keyword research gives volume numbers without analyzing SERP DNA, real intent, or what format Google rewards', solution: 'SERP DNA analysis decodes what Google actually ranks: content intent, format signals, and authority patterns' },
        { icon: Layout, problem: 'You need 4 separate tools for audit, keywords, analytics integration, and Search Console data — each billed separately', solution: 'GSC plus GA4 plus site crawl plus keyword research in one dashboard, connected to your real live data' },
        { icon: Shield, problem: 'Ahrefs starts at $99/mo. SEMrush at $119/mo. They still lack indexation gap analysis and change detection', solution: 'ClimbSEO starts at ₹499/mo ($6.99) and includes every feature — indexation gaps, change detection, AI insights, all of it' },
        { icon: Link2, problem: 'No major tool scans a competitor URL and shows you exactly which keywords they rank for that you do not', solution: 'Competitor Intelligence scans any site in seconds, maps their keyword footprint, and surfaces your exact content gaps' },
    ];
    return (
        <section id="why" aria-labelledby="why-heading" className="py-20 operator-shell">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                <FadeUp className="text-center mb-12">
                    <div className="inline-flex items-center gap-1.5 border-2 border-black bg-red-300 px-3 py-1 text-[10px] font-black uppercase tracking-widest shadow-[3px_3px_0px_0px_#000] mb-4">
                        <AlertTriangle className="w-3 h-3" /> The gap big tools leave open
                    </div>
                    <h2 id="why-heading" className="text-3xl sm:text-4xl lg:text-5xl font-black text-black leading-tight">
                        What $99/month tools<br />still cannot do
                    </h2>
                    <p className="mt-3 text-slate-600 text-base max-w-xl mx-auto font-medium">
                        ClimbSEO was built by cataloguing every gap found in premium tools. Here is exactly what they miss.
                    </p>
                </FadeUp>
                <StaggerGrid className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {items.map((c, i) => (
                        <StaggerCard key={i}>
                            <motion.div
                                whileHover={{ y: -4, boxShadow: '7px 7px 0px 0px #000' }}
                                transition={{ duration: 0.2 }}
                                className="bg-white border-2 border-black p-5 shadow-[5px_5px_0px_0px_#000] h-full"
                            >
                                <div className="w-8 h-8 border-2 border-black bg-yellow-300 flex items-center justify-center mb-4">
                                    <c.icon className="w-4 h-4 text-black" />
                                </div>
                                <div className="flex items-start gap-2 mb-3">
                                    <X className="w-3.5 h-3.5 text-red-600 shrink-0 mt-0.5" />
                                    <p className="text-slate-600 text-xs leading-relaxed font-medium">{c.problem}</p>
                                </div>
                                <div className="flex items-start gap-2">
                                    <CheckCircle className="w-3.5 h-3.5 text-green-600 shrink-0 mt-0.5" />
                                    <p className="text-black text-xs leading-relaxed font-bold">{c.solution}</p>
                                </div>
                            </motion.div>
                        </StaggerCard>
                    ))}
                </StaggerGrid>
            </div>
        </section>
    );
}

function UniqueFeatures() {
    const features = [
        { color: 'bg-red-300', icon: Eye, label: 'Indexation Gap Analysis', tag: 'Not in Ahrefs or SEMrush', desc: 'See the exact delta between your sitemap and what Google has actually indexed. Find pages Google is silently skipping — before they cost you traffic.', stat: { val: '14', unit: 'avg hidden pages found per site' } },
        { color: 'bg-cyan-300', icon: GitBranch, label: 'Audit Change Detection', tag: 'Not in Screaming Frog', desc: 'Every audit is compared against the previous one. New errors flagged in red. Fixed issues confirmed in green. No manual CSV diffing ever again.', stat: { val: '6 hrs', unit: 'saved per week on average' } },
        { color: 'bg-violet-300', icon: Brain, label: 'SERP DNA Analysis', tag: 'Unique to ClimbSEO', desc: 'Stop guessing what format Google wants. ClimbSEO decodes intent signals, content structure, and authority patterns directly from live SERPs before you write a single word.', stat: { val: '3×', unit: 'faster content strategy' } },
        { color: 'bg-orange-300', icon: Target, label: 'Competitor Intelligence', tag: 'Unique to ClimbSEO', desc: 'Paste any competitor URL and instantly see every keyword they rank for, your gaps, and a prioritized content plan to close them — in one click.', stat: { val: '1,200+', unit: 'avg competitor keywords revealed' } },
    ];
    return (
        <section className="py-20 bg-black border-t-2 border-black">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                <FadeUp className="text-center mb-12">
                    <div className="inline-flex items-center gap-1.5 border-2 border-yellow-300 px-3 py-1 text-[10px] font-black uppercase tracking-widest text-yellow-300 mb-4">
                        <Zap className="w-3 h-3" /> Only in ClimbSEO
                    </div>
                    <h2 className="text-3xl sm:text-4xl lg:text-5xl font-black text-white">
                        4 features no other<br />affordable tool has
                    </h2>
                    <p className="mt-3 text-slate-400 text-base max-w-xl mx-auto font-medium">
                        These are not minor differences. They fundamentally change how you find and fix SEO problems.
                    </p>
                </FadeUp>
                <StaggerGrid className="grid sm:grid-cols-2 gap-5">
                    {features.map((f, i) => (
                        <StaggerCard key={i}>
                            <motion.div
                                whileHover={{ borderColor: 'rgba(255,255,255,0.4)' }}
                                className="bg-zinc-900 border-2 border-white/10 p-6 h-full group"
                            >
                                <div className="flex items-start justify-between mb-5">
                                    <div className={`w-10 h-10 border-2 border-white flex items-center justify-center ${f.color}`}>
                                        <f.icon className="w-5 h-5 text-black" />
                                    </div>
                                    <span className={`${f.color} border-0 text-[9px] font-black uppercase tracking-wider px-2 py-1 text-black`}>{f.tag}</span>
                                </div>
                                <h3 className="text-lg font-black text-white uppercase tracking-tight mb-2">{f.label}</h3>
                                <p className="text-slate-400 text-sm leading-relaxed font-medium mb-5">{f.desc}</p>
                                <div className="pt-4 border-t border-white/10 flex items-end gap-2">
                                    <motion.span
                                        initial={{ opacity: 0, y: 10 }}
                                        whileInView={{ opacity: 1, y: 0 }}
                                        viewport={{ once: true }}
                                        transition={{ duration: 0.4, delay: 0.2 + i * 0.1 }}
                                        className="text-3xl font-black text-white"
                                    >{f.stat.val}</motion.span>
                                    <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wide pb-1">{f.stat.unit}</span>
                                </div>
                            </motion.div>
                        </StaggerCard>
                    ))}
                </StaggerGrid>
            </div>
        </section>
    );
}

function ValueComparison() {
    const rows = [
        { feature: 'Full site crawl + technical audit', climb: true, ahrefs: 'Partial', semrush: 'Partial' },
        { feature: 'Indexation gap analysis', climb: true, ahrefs: false, semrush: false },
        { feature: 'Audit change detection', climb: true, ahrefs: false, semrush: false },
        { feature: 'SERP DNA keyword research', climb: true, ahrefs: false, semrush: false },
        { feature: 'Competitor keyword scanning', climb: true, ahrefs: 'Limited', semrush: 'Limited' },
        { feature: 'Google Search Console (live data)', climb: true, ahrefs: 'Limited', semrush: 'Limited' },
        { feature: 'GA4 integration', climb: true, ahrefs: false, semrush: true },
        { feature: 'Template clustering', climb: true, ahrefs: false, semrush: false },
        { feature: 'Internal link intelligence', climb: true, ahrefs: 'Basic', semrush: 'Basic' },
        { feature: 'Structured data audit', climb: true, ahrefs: false, semrush: false },
        { feature: 'AI-powered insights', climb: true, ahrefs: false, semrush: false },
        { feature: 'Starting price / month', climb: '₹499 ($6.99)', ahrefs: '$99', semrush: '$119' },
    ];
    function Cell({ val }: { val: boolean | string }) {
        if (val === true) return <CheckCircle className="w-4 h-4 text-green-600 mx-auto" />;
        if (val === false) return <X className="w-4 h-4 text-red-500 mx-auto" />;
        return <span className="text-[10px] font-bold text-slate-500 text-center block">{val}</span>;
    }
    return (
        <section className="py-16 bg-white border-t-2 border-black">
            <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
                <FadeUp className="text-center mb-10">
                    <div className="inline-flex items-center gap-1.5 border-2 border-black bg-violet-300 px-3 py-1 text-[10px] font-black uppercase tracking-widest shadow-[3px_3px_0px_0px_#000] mb-4">
                        <Target className="w-3 h-3" /> Feature comparison
                    </div>
                    <h2 className="text-2xl sm:text-3xl font-black text-black">ClimbSEO vs the competition</h2>
                    <p className="mt-2 text-slate-600 text-sm font-medium">More features. A fraction of the price.</p>
                </FadeUp>
                <FadeUp delay={0.1}>
                    <div className="overflow-x-auto">
                        <div className="border-2 border-black shadow-[6px_6px_0px_0px_#000] overflow-hidden min-w-[500px]">
                            <div className="grid grid-cols-4 border-b-2 border-black bg-black text-white">
                                <div className="px-4 py-3 text-[10px] font-black uppercase tracking-wider">Feature</div>
                                {[{ label: 'ClimbSEO', highlight: true }, { label: 'Ahrefs', highlight: false }, { label: 'SEMrush', highlight: false }].map(h => (
                                    <div key={h.label} className={`px-2 py-3 text-[10px] font-black uppercase tracking-wider text-center ${h.highlight ? 'bg-yellow-300 text-black' : ''}`}>{h.label}</div>
                                ))}
                            </div>
                            {rows.map((r, i) => (
                                <motion.div
                                    key={i}
                                    initial={{ opacity: 0, x: -10 }}
                                    whileInView={{ opacity: 1, x: 0 }}
                                    viewport={{ once: true }}
                                    transition={{ duration: 0.3, delay: i * 0.04 }}
                                    className={`grid grid-cols-4 border-b border-black/10 ${i % 2 === 0 ? 'bg-white' : 'bg-slate-50'}`}
                                >
                                    <div className="px-4 py-2.5 text-[10px] font-bold text-black">{r.feature}</div>
                                    <div className="px-2 py-2.5 bg-yellow-50 flex items-center justify-center border-x-2 border-black/10"><Cell val={r.climb} /></div>
                                    <div className="px-2 py-2.5 flex items-center justify-center"><Cell val={r.ahrefs} /></div>
                                    <div className="px-2 py-2.5 flex items-center justify-center"><Cell val={r.semrush} /></div>
                                </motion.div>
                            ))}
                        </div>
                    </div>
                </FadeUp>
            </div>
        </section>
    );
}

function FeatureShowcase() {
    const features = [
        { badge: { text: 'Dashboard', color: 'bg-yellow-300' }, title: 'Unified SEO Command Center', desc: 'All your GSC and GA4 performance data, site health score, crawl status, and keyword insights in one live view. No switching between 4 different tools on 4 different invoices.', tags: ['Google Search Console', 'GA4 Integration', 'Health Score', 'Change History'], mock: <DashboardMock />, reverse: false },
        { badge: { text: 'Site Audit', color: 'bg-cyan-300' }, title: 'Full Site Crawl and Technical Audit', desc: 'Crawl your entire site and detect HTTP errors, canonical issues, broken internal links, thin content, missing metadata, and PageSpeed scores in one run. Change detection shows exactly what broke between audits.', tags: ['Canonical Audit', 'Internal Links', 'PSI Scores', 'Change Detection'], mock: <AuditMock />, reverse: true },
        { badge: { text: 'Keywords', color: 'bg-violet-300' }, title: 'SERP DNA Keyword Research', desc: 'Go beyond volume. Analyze what Google actually ranks: intent, format, authority signals, competitive density. Get a prioritized content blueprint in minutes, not just a spreadsheet of keywords.', tags: ['Intent Mapping', 'SERP Analysis', 'Strategic Blueprint', 'Google Ads Data'], mock: <KeywordMock />, reverse: false },
        { badge: { text: 'Competitor Intel', color: 'bg-orange-300' }, title: 'Competitor Keyword Scanner', desc: 'Paste any competitor URL and see every keyword they rank for, their estimated traffic, and the exact gaps in your own content strategy. One click from URL to content plan.', tags: ['URL Scan', 'Keyword Gaps', 'Traffic Estimate', 'Content Plan'], mock: <CompetitorScanMock />, reverse: true },
    ];
    return (
        <section id="features" aria-labelledby="features-heading" className="py-20 bg-white border-t-2 border-black">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                <FadeUp className="text-center mb-16">
                    <div className="inline-flex items-center gap-1.5 border-2 border-black bg-cyan-300 px-3 py-1 text-[10px] font-black uppercase tracking-widest shadow-[3px_3px_0px_0px_#000] mb-4">
                        <Zap className="w-3 h-3" /> What is inside
                    </div>
                    <h2 id="features-heading" className="text-3xl sm:text-4xl lg:text-5xl font-black text-black">
                        Every feature an SEO team needs,<br className="hidden sm:block" />nothing they do not
                    </h2>
                </FadeUp>
                <div className="space-y-20 lg:space-y-28">
                    {features.map((f, i) => (
                        <article key={i} className={`flex flex-col ${f.reverse ? 'lg:flex-row-reverse' : 'lg:flex-row'} items-start gap-8 lg:gap-16`}>
                            <SlideIn from={f.reverse ? 'right' : 'left'} delay={0.1} className="flex-1 w-full min-w-0 overflow-x-auto">
                                <motion.div
                                    whileHover={{ y: -4, transition: { duration: 0.2 } }}
                                    className="min-w-[520px]"
                                >
                                    {f.mock}
                                </motion.div>
                            </SlideIn>
                            <SlideIn from={f.reverse ? 'left' : 'right'} delay={0.2} className="flex-1 w-full space-y-4 lg:pt-4">
                                <div className={`inline-flex border-2 border-black ${f.badge.color} px-2 py-0.5 text-[9px] font-black uppercase tracking-widest shadow-[2px_2px_0px_0px_#000]`}>{f.badge.text}</div>
                                <h3 className="text-2xl sm:text-3xl font-black text-black">{f.title}</h3>
                                <p className="text-slate-600 text-base leading-relaxed font-medium">{f.desc}</p>
                                <div className="flex flex-wrap gap-2 pt-1">
                                    {f.tags.map((tag, ti) => (
                                        <motion.span
                                            key={tag}
                                            initial={{ opacity: 0, scale: 0.9 }}
                                            whileInView={{ opacity: 1, scale: 1 }}
                                            viewport={{ once: true }}
                                            transition={{ duration: 0.25, delay: 0.3 + ti * 0.06 }}
                                            className="border-2 border-black bg-white text-[9px] font-black uppercase tracking-wide px-2.5 py-1 shadow-[2px_2px_0px_0px_#000]"
                                        >{tag}</motion.span>
                                    ))}
                                </div>
                            </SlideIn>
                        </article>
                    ))}
                </div>
            </div>
        </section>
    );
}

function FeatureGrid() {
    const extras = [
        { icon: GitBranch, label: 'Audit Change Detection', desc: 'Know exactly what changed between crawls: new errors, fixed issues, new pages. No manual CSV diffing.' },
        { icon: Eye, label: 'Indexation Gap Analysis', desc: "Find pages that should be indexed but are not. Understand the gap between your sitemap and Google's index." },
        { icon: Layout, label: 'Template Clustering', desc: 'Detect which page templates have systemic SEO issues. Fix 100 pages by fixing one template pattern.' },
        { icon: Link2, label: 'Internal Link Intelligence', desc: 'Page-level internal link recommendations. Identify orphan pages, over-linked pages, and anchor text issues.' },
        { icon: Shield, label: 'Structured Data Audit', desc: 'Validate schema.org markup across your entire site. Catch broken JSON-LD before Google does.' },
        { icon: Sparkles, label: 'AI-Powered Insights', desc: 'AI analysis of your audit results with prioritised action items, not just raw data dumps.' },
        { icon: Activity, label: 'Request Indexing', desc: 'Submit pages for indexing directly from ClimbSEO. No need to switch to GSC in a separate tab.' },
        { icon: TrendingUp, label: 'Performance Tracking', desc: 'Compare week-over-week metrics: clicks, impressions, CTR, and rankings with visual history.' },
        { icon: Target, label: 'Multi-Project Support', desc: 'Manage multiple websites under one account. Add projects at ₹149/mo ($1.99/mo) each.' },
    ];
    return (
        <section className="py-16 operator-shell border-t-2 border-black">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                <FadeUp className="text-center mb-10">
                    <h2 className="text-2xl sm:text-3xl font-black text-black uppercase">The complete toolkit</h2>
                    <p className="text-slate-600 font-bold text-sm mt-1">Everything in every plan. One price. No surprises.</p>
                </FadeUp>
                <StaggerGrid className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {extras.map((e, i) => (
                        <StaggerCard key={i}>
                            <motion.div
                                whileHover={{ y: -4, boxShadow: '6px 6px 0px 0px #000' }}
                                transition={{ duration: 0.2 }}
                                className="bg-white border-2 border-black p-5 shadow-[4px_4px_0px_0px_#000] h-full"
                            >
                                <div className="w-7 h-7 border-2 border-black bg-black flex items-center justify-center mb-3">
                                    <e.icon className="w-3.5 h-3.5 text-white" />
                                </div>
                                <h4 className="text-black font-black text-xs uppercase tracking-wide mb-1">{e.label}</h4>
                                <p className="text-slate-500 text-xs leading-relaxed">{e.desc}</p>
                            </motion.div>
                        </StaggerCard>
                    ))}
                </StaggerGrid>
            </div>
        </section>
    );
}

function Testimonials() {
    const quotes = [
        { text: 'We replaced Screaming Frog, SEMrush, and a separate GSC dashboard with ClimbSEO. The change detection feature alone saved us 6 hours a week of manual diffing.', author: 'Priya Mehta', role: 'Head of SEO, D2C Brand' },
        { text: 'The SERP DNA analysis is genuinely different. It tells you what format Google wants and what intent angle to take, not just volume data. Our content hit page 1 in 3 weeks.', author: 'Rahul Sharma', role: 'Founder, Content Agency' },
        { text: 'Running audits on 8 client sites. Template clustering caught a canonical error pattern across 300 pages in minutes. Paying ₹499 + ₹149 per extra project is incredibly fair for agencies.', author: 'Ankit Joshi', role: 'SEO Consultant, 8 Clients' },
    ];
    return (
        <section className="py-20 bg-white border-t-2 border-black">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                <FadeUp className="text-center mb-10">
                    <div className="inline-flex items-center gap-1.5 border-2 border-black bg-yellow-300 px-3 py-1 text-[10px] font-black uppercase tracking-widest shadow-[3px_3px_0px_0px_#000] mb-4">
                        <Star className="w-3 h-3" /> Trusted by SEO teams
                    </div>
                    <h2 className="text-3xl sm:text-4xl font-black text-black">What our users say</h2>
                </FadeUp>
                <StaggerGrid className="grid md:grid-cols-3 gap-5">
                    {quotes.map((q, i) => (
                        <StaggerCard key={i}>
                            <motion.blockquote
                                whileHover={{ y: -6, boxShadow: '8px 8px 0px 0px #000' }}
                                transition={{ duration: 0.2 }}
                                className="bg-white border-2 border-black p-6 shadow-[5px_5px_0px_0px_#000] flex flex-col h-full"
                            >
                                <div className="flex gap-0.5 mb-4">
                                    {Array.from({ length: 5 }).map((_, si) => <Star key={si} className="w-3.5 h-3.5 fill-yellow-400 text-yellow-400" />)}
                                </div>
                                <p className="text-slate-700 text-sm leading-relaxed flex-1 font-medium">"{q.text}"</p>
                                <footer className="mt-5 pt-4 border-t-2 border-black">
                                    <div className="font-black text-black text-sm">{q.author}</div>
                                    <div className="text-slate-500 text-xs font-medium">{q.role}</div>
                                </footer>
                            </motion.blockquote>
                        </StaggerCard>
                    ))}
                </StaggerGrid>
            </div>
        </section>
    );
}

function FitSection({ onLogin }: { onLogin: () => void }) {
    const notFor = [
        'You run a link-building agency and need a backlink index with millions of domains',
        'You need historical rank tracking across thousands of keywords going back years',
        'You are crawling sites with 500,000+ pages and need enterprise-scale infrastructure',
        'You want a tool that does everything including social media, PPC, and brand monitoring',
    ];
    const yesFor = [
        { label: 'Founders', desc: 'You built a product and need to understand why Google is not sending you traffic. You want answers, not a 47-tab spreadsheet.' },
        { label: 'Small Agencies', desc: 'You manage 3 to 15 client sites. You need audit, keyword research, and GSC data in one place without paying $99 per seat per client.' },
        { label: 'In-House SEO Teams', desc: 'You own one or a few company sites and care deeply about technical health, indexation, and content that actually ranks.' },
        { label: 'Content Strategists', desc: 'You want to know what Google rewards before you write. SERP DNA analysis tells you the intent, format, and angle — not just the volume.' },
    ];
    return (
        <section className="py-20 bg-white border-t-2 border-black">
            <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
                <FadeUp>
                    <div className="border-2 border-black bg-black p-8 sm:p-10 shadow-[8px_8px_0px_0px_rgba(0,0,0,0.25)] mb-8 relative overflow-hidden">
                        <div className="absolute top-0 left-0 right-0 h-1.5 bg-yellow-300" />
                        <div className="relative">
                            <div className="inline-flex items-center gap-1.5 border-2 border-yellow-300 px-3 py-1 text-[10px] font-black uppercase tracking-widest text-yellow-300 mb-5">Honest positioning</div>
                            <p className="text-white text-xl sm:text-2xl font-black leading-snug max-w-3xl">ClimbSEO is a genuinely strong tool for founders, small agencies, and in-house SEOs who care about technical health, indexation, and content strategy.</p>
                            <p className="text-yellow-300 text-xl sm:text-2xl font-black leading-snug mt-2">Not everyone needs a backlink empire. Most sites need better fundamentals first.</p>
                            <p className="text-slate-400 text-sm font-medium mt-4 max-w-2xl">We would rather you know exactly who this is for than sign up, feel confused, and leave.</p>
                        </div>
                    </div>
                </FadeUp>
                <div className="grid md:grid-cols-2 gap-5">
                    <FadeUp delay={0.1}>
                        <div className="border-2 border-black bg-slate-50 p-6 shadow-[5px_5px_0px_0px_#000]">
                            <div className="inline-flex border-2 border-black bg-red-300 px-2 py-0.5 text-[9px] font-black uppercase tracking-widest shadow-[2px_2px_0px_0px_#000] mb-5">Not the right fit if...</div>
                            <ul className="space-y-3">
                                {notFor.map((item, i) => (
                                    <li key={i} className="flex items-start gap-3">
                                        <span className="w-5 h-5 border-2 border-black bg-red-300 flex items-center justify-center shrink-0 mt-0.5 text-[10px] font-black">X</span>
                                        <span className="text-slate-700 text-sm font-medium leading-snug">{item}</span>
                                    </li>
                                ))}
                            </ul>
                            <p className="mt-5 text-[10px] font-bold text-slate-400 uppercase tracking-wide border-t-2 border-black pt-4">For those cases, Ahrefs or SEMrush are worth their price.</p>
                        </div>
                    </FadeUp>
                    <FadeUp delay={0.2}>
                        <div className="border-2 border-black bg-white p-6 shadow-[5px_5px_0px_0px_#000]">
                            <div className="inline-flex border-2 border-black bg-green-300 px-2 py-0.5 text-[9px] font-black uppercase tracking-widest shadow-[2px_2px_0px_0px_#000] mb-5">Built exactly for you if you are a...</div>
                            <ul className="space-y-4">
                                {yesFor.map((item, i) => (
                                    <li key={i} className="flex items-start gap-3">
                                        <span className="w-5 h-5 border-2 border-black bg-yellow-300 flex items-center justify-center shrink-0 mt-0.5 text-[10px] font-black">+</span>
                                        <div>
                                            <div className="text-black text-xs font-black uppercase tracking-wide">{item.label}</div>
                                            <div className="text-slate-600 text-xs font-medium leading-snug mt-0.5">{item.desc}</div>
                                        </div>
                                    </li>
                                ))}
                            </ul>
                            <motion.button
                                onClick={onLogin}
                                whileHover={{ x: 1, y: 1, boxShadow: '2px 2px 0px 0px rgba(0,0,0,0.25)' }}
                                className="mt-6 w-full border-2 border-black bg-black text-white font-black py-3 text-xs uppercase tracking-wide shadow-[4px_4px_0px_0px_rgba(0,0,0,0.25)] transition-shadow flex items-center justify-center gap-2"
                            >
                                That is me. Start Free Trial <ArrowRight className="w-3.5 h-3.5" />
                            </motion.button>
                        </div>
                    </FadeUp>
                </div>
            </div>
        </section>
    );
}

function Pricing({ onLogin }: { onLogin: () => void }) {
    const [currency, setCurrency] = useState<Currency>('INR');
    const inr = currency === 'INR';
    const plans = [
        { name: 'Monthly', priceINR: '₹499', priceUSD: '$6.99', periodLabel: 'per month', perMonthINR: null, perMonthUSD: null, sub: '1 project included. Full access. No lock-in.', savings: null, savingsPct: null, highlight: false, badge: null },
        { name: '6 Months', priceINR: '₹2,499', priceUSD: '$29.99', periodLabel: 'for 6 months', perMonthINR: '₹416', perMonthUSD: '$5.00', sub: '1 project included. Billed once every 6 months.', savings: inr ? 'Save ₹495' : 'Save $11.95', savingsPct: '17%', highlight: true, badge: 'MOST POPULAR' },
        { name: 'Annual', priceINR: '₹4,599', priceUSD: '$49.99', periodLabel: 'per year', perMonthINR: '₹383', perMonthUSD: '$4.17', sub: '1 project included. Best value for ongoing SEO work.', savings: inr ? 'Save ₹1,389' : 'Save $33.89', savingsPct: '23%', highlight: false, badge: 'BEST VALUE' },
    ];
    const price = (p: typeof plans[0]) => inr ? p.priceINR : p.priceUSD;
    const perMonth = (p: typeof plans[0]) => inr ? p.perMonthINR : p.perMonthUSD;
    const addOnPrice = inr ? '₹149' : '$1.99';
    const included = ['Unlimited site crawls', 'SERP DNA keyword research', 'Indexation gap analysis', 'Audit change detection', 'Competitor keyword scanning', 'Internal link intelligence', 'Template clustering', 'Structured data audit', 'AI-powered insights', 'GSC + GA4 live integration', 'Request indexing', 'CSV and Google Sheets export'];
    const agencyExamples = [
        { sites: 1, monthly: inr ? '₹499' : '$6.99', label: 'Solo / Startup' },
        { sites: 3, monthly: inr ? '₹797' : '$10.97', label: 'Small Agency' },
        { sites: 5, monthly: inr ? '₹1,095' : '$14.95', label: 'Growing Agency' },
        { sites: 10, monthly: inr ? '₹1,841' : '$24.90', label: 'Full Agency' },
    ];
    return (
        <section id="pricing" aria-labelledby="pricing-heading" className="py-20 operator-shell border-t-2 border-black">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                <FadeUp className="text-center mb-10">
                    <div className="inline-flex items-center gap-1.5 border-2 border-black bg-green-300 px-3 py-1 text-[10px] font-black uppercase tracking-widest shadow-[3px_3px_0px_0px_#000] mb-4">
                        <TrendingUp className="w-3 h-3" /> Transparent pricing
                    </div>
                    <h2 id="pricing-heading" className="text-3xl sm:text-4xl lg:text-5xl font-black text-black">Pay per project.<br />Keep every feature.</h2>
                    <p className="mt-3 text-slate-600 font-medium text-base max-w-lg mx-auto">Your base plan covers 1 project with full access to everything. Add more projects at {addOnPrice} per month each.</p>
                    <div className="mt-6 inline-flex border-2 border-black bg-white shadow-[3px_3px_0px_0px_#000]">
                        <button onClick={() => setCurrency('INR')} className={`flex items-center gap-1.5 px-4 py-2 text-xs font-black uppercase tracking-wide transition-all ${currency === 'INR' ? 'bg-black text-white' : 'text-slate-500 hover:text-black'}`}><Globe className="w-3 h-3" /> INR</button>
                        <button onClick={() => setCurrency('USD')} className={`flex items-center gap-1.5 px-4 py-2 text-xs font-black uppercase tracking-wide transition-all border-l-2 border-black ${currency === 'USD' ? 'bg-black text-white' : 'text-slate-500 hover:text-black'}`}><DollarSign className="w-3 h-3" /> USD</button>
                    </div>
                </FadeUp>
                <StaggerGrid className="grid sm:grid-cols-3 gap-5 mb-8">
                    {plans.map((p, i) => (
                        <StaggerCard key={i}>
                            <motion.div
                                whileHover={{ y: p.highlight ? -8 : -4, transition: { duration: 0.2 } }}
                                className={`relative bg-white border-2 border-black p-7 flex flex-col h-full ${p.highlight ? 'shadow-[8px_8px_0px_0px_#000] sm:-translate-y-1' : 'shadow-[5px_5px_0px_0px_#000]'}`}
                            >
                                {p.badge && <div className={`absolute -top-3.5 left-1/2 -translate-x-1/2 border-2 border-black text-[9px] font-black px-3 py-0.5 uppercase tracking-widest shadow-[2px_2px_0px_0px_#000] whitespace-nowrap ${p.badge === 'MOST POPULAR' ? 'bg-yellow-300' : 'bg-green-300'}`}>{p.badge}</div>}
                                {p.savings && <div className="self-start border-2 border-black bg-green-300 px-2 py-0.5 text-[9px] font-black uppercase tracking-wide mb-4">{p.savings} ({p.savingsPct} off)</div>}
                                <div className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-2">{p.name}</div>
                                <div className="text-4xl font-black text-black mb-0.5">{price(p)}</div>
                                <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wide mb-1">{p.periodLabel}</div>
                                {perMonth(p) && <div className="text-[10px] font-black text-green-700 uppercase tracking-wide mb-3">{perMonth(p)} / mo effective</div>}
                                {!perMonth(p) && <div className="mb-3" />}
                                <p className="text-xs text-slate-600 font-medium mb-6">{p.sub}</p>
                                <button onClick={onLogin} className={`w-full border-2 border-black font-black py-3 text-xs uppercase tracking-wide mt-auto relative overflow-hidden transition-all hover:translate-x-[1px] hover:translate-y-[1px] ${p.highlight ? 'bg-black text-white shadow-[4px_4px_0px_0px_rgba(0,0,0,0.3)] hover:shadow-[2px_2px_0px_0px_rgba(0,0,0,0.3)]' : 'bg-white text-black shadow-[4px_4px_0px_0px_#000] hover:shadow-[2px_2px_0px_0px_#000]'}`}>
                                    {p.highlight && <span className="animate-shimmer-sweep absolute inset-0 w-1/3 bg-white/15" />}
                                    <span className="relative z-10">Start Free Trial</span>
                                </button>
                            </motion.div>
                        </StaggerCard>
                    ))}
                </StaggerGrid>
                <FadeUp delay={0.1}>
                    <div className="bg-white border-2 border-black p-6 shadow-[5px_5px_0px_0px_#000] mb-6">
                        <div className="flex items-start gap-4">
                            <div className="w-9 h-9 border-2 border-black bg-cyan-300 flex items-center justify-center shrink-0 mt-0.5"><Plus className="w-5 h-5 text-black" /></div>
                            <div className="flex-1">
                                <h3 className="font-black text-black uppercase tracking-wide text-sm mb-1">Additional projects: {addOnPrice} per project / month</h3>
                                <p className="text-slate-600 text-xs font-medium mb-4">Every base plan includes 1 project. Add each extra project for {addOnPrice}/mo, billed alongside your base plan.</p>
                                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                                    {agencyExamples.map((ex, i) => (
                                        <div key={i} className="border-2 border-black bg-slate-50 p-3 shadow-[2px_2px_0px_0px_#000]">
                                            <div className="text-[9px] font-black uppercase tracking-wide text-slate-500 mb-1">{ex.label}</div>
                                            <div className="text-base font-black text-black">{ex.monthly}</div>
                                            <div className="text-[9px] text-slate-500 font-medium">{ex.sites} site{ex.sites > 1 ? 's' : ''} / mo</div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                    </div>
                </FadeUp>
                <FadeUp delay={0.2}>
                    <div className="bg-white border-2 border-black p-8 shadow-[5px_5px_0px_0px_#000]">
                        <h3 className="text-black font-black uppercase text-sm text-center mb-6">Everything included in every plan</h3>
                        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
                            {included.map((item, i) => (
                                <motion.div
                                    key={item}
                                    initial={{ opacity: 0, x: -8 }}
                                    whileInView={{ opacity: 1, x: 0 }}
                                    viewport={{ once: true }}
                                    transition={{ duration: 0.3, delay: i * 0.04 }}
                                    className="flex items-center gap-2.5"
                                >
                                    <CheckCircle className="w-4 h-4 text-green-600 shrink-0" />
                                    <span className="text-slate-700 text-xs font-bold">{item}</span>
                                </motion.div>
                            ))}
                        </div>
                    </div>
                </FadeUp>
            </div>
        </section>
    );
}

function FAQ() {
    const [open, setOpen] = useState<number | null>(null);
    const faqs = [
        { q: 'What counts as a project?', a: 'One project is one website or domain. Your base plan includes 1 project with full access to all features including crawl, keyword research, audit, and GSC/GA4 integration. Add extra projects for ₹149 ($1.99) per month each.' },
        { q: 'Can I switch between INR and USD billing?', a: 'Yes. Indian users can pay in INR via UPI, net banking, or cards. International users pay in USD via card. Both currencies give access to the same full feature set.' },
        { q: 'Do I need a Google Ads account to use keyword research?', a: 'No. The SERP DNA analysis and keyword research work without Google Ads. The Ads integration is optional and unlocks search volume data from the Google Ads API when connected.' },
        { q: 'How does the Google Search Console integration work?', a: 'Connect your Google account once and ClimbSEO pulls real GSC data including clicks, impressions, positions, and indexed pages directly. No sampling and no estimates.' },
        { q: 'How is ClimbSEO different from Screaming Frog?', a: 'Screaming Frog is a desktop crawler with no cloud access, no keyword research, no GSC or GA4 integration, and no change detection between audits. ClimbSEO runs in the cloud with SERP DNA analysis, AI insights, real-time GSC and GA4 data, and audit change detection built in.' },
        { q: 'How is ClimbSEO different from Ahrefs or SEMrush?', a: 'Ahrefs ($99/mo) and SEMrush ($119/mo) focus on backlink and keyword volume data. Neither offers indexation gap analysis, audit change detection, or template clustering. They also do not integrate directly with your live GSC or GA4 data. ClimbSEO does all of this starting at ₹499/mo ($6.99/mo).' },
        { q: 'Is there a free trial?', a: 'Yes. Start your free trial with no credit card required. You get full access to every feature including crawl, keyword research, GSC integration, and AI insights during the trial period.' },
        { q: 'What happens to my data if I cancel?', a: 'Export all your audit history and keyword data at any time via CSV or Google Sheets before cancelling. We do not hold your data hostage. Cancel anytime with no penalty.' },
    ];
    return (
        <section id="faq" aria-labelledby="faq-heading" className="py-20 bg-white border-t-2 border-black">
            <div className="max-w-3xl mx-auto px-4 sm:px-6">
                <FadeUp className="text-center mb-10">
                    <h2 id="faq-heading" className="text-3xl sm:text-4xl font-black text-black">Frequently Asked Questions</h2>
                </FadeUp>
                <div className="space-y-2">
                    {faqs.map((faq, i) => (
                        <motion.div
                            key={i}
                            initial={{ opacity: 0, y: 12 }}
                            whileInView={{ opacity: 1, y: 0 }}
                            viewport={{ once: true }}
                            transition={{ duration: 0.35, delay: i * 0.05 }}
                            className="border-2 border-black bg-white shadow-[3px_3px_0px_0px_#000]"
                        >
                            <button onClick={() => setOpen(open === i ? null : i)}
                                className="w-full flex items-center justify-between px-5 py-4 text-left gap-4 hover:bg-slate-50 transition-colors">
                                <span className="text-black font-black text-sm">{faq.q}</span>
                                <motion.span animate={{ rotate: open === i ? 90 : 0 }} transition={{ duration: 0.2 }}>
                                    {open === i ? <ChevronDown className="w-4 h-4 text-black shrink-0" /> : <ChevronRight className="w-4 h-4 text-slate-400 shrink-0" />}
                                </motion.span>
                            </button>
                            {open === i && (
                                <motion.div
                                    initial={{ opacity: 0, height: 0 }}
                                    animate={{ opacity: 1, height: 'auto' }}
                                    exit={{ opacity: 0, height: 0 }}
                                    transition={{ duration: 0.2 }}
                                    className="px-5 pb-4 text-slate-600 text-sm leading-relaxed font-medium border-t-2 border-black pt-3"
                                >{faq.a}</motion.div>
                            )}
                        </motion.div>
                    ))}
                </div>
            </div>
        </section>
    );
}

function CTA({ onLogin }: { onLogin: () => void }) {
    return (
        <section className="py-20 operator-shell border-t-2 border-black">
            <div className="max-w-4xl mx-auto px-4 text-center">
                <FadeUp y={30}>
                    <div className="bg-black border-2 border-black p-10 sm:p-16 shadow-[10px_10px_0px_0px_rgba(0,0,0,0.3)] relative overflow-hidden">
                        <div className="absolute top-0 left-0 right-0 h-1.5 bg-yellow-300" />
                        {/* Animated corner accents */}
                        <motion.div
                            animate={{ opacity: [0.3, 0.7, 0.3] }}
                            transition={{ duration: 3, repeat: Infinity }}
                            className="absolute top-4 left-4 w-8 h-8 border-t-2 border-l-2 border-yellow-300/40"
                        />
                        <motion.div
                            animate={{ opacity: [0.3, 0.7, 0.3] }}
                            transition={{ duration: 3, repeat: Infinity, delay: 1.5 }}
                            className="absolute bottom-4 right-4 w-8 h-8 border-b-2 border-r-2 border-yellow-300/40"
                        />
                        <div className="relative">
                            <h2 className="text-3xl sm:text-4xl lg:text-5xl font-black text-white leading-tight uppercase">
                                Stop paying $99/month<br />for incomplete tools
                            </h2>
                            <p className="mt-4 text-slate-300 text-base max-w-xl mx-auto font-medium">
                                Full site audit, SERP DNA keyword research, competitor keyword scanning, indexation gap analysis, change detection, and AI insights from ₹499/month ($6.99).
                            </p>
                            <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-3">
                                <motion.button
                                    onClick={onLogin}
                                    whileHover={{ scale: 1.02, y: -2 }}
                                    whileTap={{ scale: 0.98, y: 0 }}
                                    className="animate-glow-pulse w-full sm:w-auto relative overflow-hidden border-2 border-yellow-300 bg-yellow-300 text-black font-black px-8 py-3.5 text-sm uppercase tracking-wide flex items-center justify-center gap-2"
                                >
                                    <span className="animate-shimmer-sweep absolute inset-0 w-1/3 bg-white/30" />
                                    <span className="relative z-10 flex items-center gap-2">Start Free Trial <ArrowRight className="w-4 h-4" /></span>
                                </motion.button>
                                <a href="#pricing"
                                    className="w-full sm:w-auto border-2 border-white bg-transparent text-white hover:bg-white hover:text-black font-black px-8 py-3.5 text-sm uppercase tracking-wide transition-all flex items-center justify-center gap-2">
                                    See Pricing
                                </a>
                            </div>
                            <p className="mt-4 text-slate-500 text-xs font-bold uppercase tracking-wide">No credit card required. Full access. Cancel anytime.</p>
                        </div>
                    </div>
                </FadeUp>
            </div>
        </section>
    );
}

function Footer() {
    const year = new Date().getFullYear();
    return (
        <footer className="bg-white border-t-2 border-black py-10">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                <div className="flex flex-col sm:flex-row items-center justify-between gap-6 mb-8">
                    <a href="https://seotool.harshrathi.com/" rel="home"><Logo variant="dark" height={28} /></a>
                    <p className="text-slate-400 text-xs font-bold uppercase tracking-wide order-last sm:order-none">{year} ClimbSEO. All rights reserved.</p>
                    <div className="flex gap-5 text-xs font-bold uppercase tracking-wide text-slate-500">
                        <a href="https://seotool.harshrathi.com/privacy" rel="noopener" className="hover:text-black transition-colors">Privacy</a>
                        <a href="https://seotool.harshrathi.com/terms" rel="noopener" className="hover:text-black transition-colors">Terms</a>
                        <a href="mailto:support@seotool.harshrathi.com" rel="noopener" className="hover:text-black transition-colors">Contact</a>
                    </div>
                </div>
                <div className="border-t-2 border-black pt-6 grid sm:grid-cols-3 gap-4 text-[10px] font-medium text-slate-400">
                    <p>ClimbSEO is an independent SEO platform. Not affiliated with Google, Ahrefs, or SEMrush.</p>
                    <p className="text-center">Starting at ₹499/month (India) or $6.99/month (International) for 1 project. Additional projects at ₹149/$1.99 per month.</p>
                    <p className="sm:text-right">seotool.harshrathi.com</p>
                </div>
            </div>
        </footer>
    );
}

export default function LandingPage({ onLogin, serverReady = false }: LandingPageProps) {
    return (
        <div className="min-h-screen bg-[#f8fafc] font-sans">
            <WarmupToast serverReady={serverReady} />
            <NavBar onLogin={onLogin} />
            <main>
                <Hero onLogin={onLogin} />
                <StatsSection />
                <ComparisonStrip />
                <WhySection />
                <UniqueFeatures />
                <ValueComparison />
                <FeatureShowcase />
                <FeatureGrid />
                <Testimonials />
                <FitSection onLogin={onLogin} />
                <Pricing onLogin={onLogin} />
                <FAQ />
                <CTA onLogin={onLogin} />
            </main>
            <Footer />
        </div>
    );
}
