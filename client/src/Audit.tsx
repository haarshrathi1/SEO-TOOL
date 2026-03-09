import { useState, useEffect } from 'react';
import { Loader2, Play, Search, History, Calendar, LayoutDashboard, AlertOctagon, TableProperties, Sparkles, Filter } from 'lucide-react';
import type { AuditResult } from './types';
import { api, requestIndexing } from './api';
import AuditOverview from './components/audit/AuditOverview';
import AuditIssues from './components/audit/AuditIssues';
import AuditTable from './components/audit/AuditTable';
import AuditAI from './components/audit/AuditAI';

interface AuditHistoryItem {
    id: string;
    timestamp: string;
    projectId: string;
    results: AuditResult[];
}

interface AuditProps {
    projectId: string;
}

type Tab = 'overview' | 'issues' | 'pages' | 'ai';

export default function Audit({ projectId }: AuditProps) {
    const [results, setResults] = useState<AuditResult[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [activeTab, setActiveTab] = useState<Tab>('overview');
    const [filterId, setFilterId] = useState<string>('');

    // History State
    const [history, setHistory] = useState<AuditHistoryItem[]>([]);
    const [selectedHistoryId, setSelectedHistoryId] = useState<string>('live');

    // Fetch History on Mount
    useEffect(() => {
        fetchHistory();
    }, []);

    const fetchHistory = async () => {
        try {
            const data = await api.getAuditHistory();
            setHistory(data);
        } catch (e) {
            console.error('Failed to fetch audit history', e);
        }
    };

    const runAudit = async () => {
        setLoading(true);
        setError('');
        setResults([]);
        setSelectedHistoryId('live'); // Reset state to live
        try {
            const data = await api.runAudit(projectId);
            setResults(data);
            fetchHistory(); // Refresh dropdown
        } catch (e: unknown) {
            console.error(e);
            if (e instanceof Error && e.message === 'Unauthorized') {
                setError('Please log in with Google to perform audits.');
            } else {
                setError(e instanceof Error ? e.message : 'Failed to run audit');
            }
        } finally {
            setLoading(false);
        }
    };

    const handleHistorySelect = (id: string) => {
        setSelectedHistoryId(id);
        if (id === 'live') {
            setResults([]); // Clear results for "ready state"
            return;
        }
        const item = history.find(h => h.id === id);
        if (item) {
            setResults(item.results);
            setError('');
        }
    };

    const handleRequestIndexing = async (url: string) => {
        try {
            await requestIndexing(url);
            alert('Indexing Requested Successfully!');
        } catch (e: unknown) {
            alert(`Request failed: ${e instanceof Error ? e.message : 'Unknown error'}`);
        }
    };

    // Filter Logic
    const getFilteredResults = () => {
        if (!filterId) return results;
        switch (filterId) {
            case 'not-indexed': return results.filter(r => r.status === 'FAIL');
            case 'no-h1': return results.filter(r => r.h1Count === 0);
            case 'multi-h1': return results.filter(r => r.h1Count && r.h1Count > 1);
            case 'missing-desc': return results.filter(r => !r.description);
            case 'low-word-count': return results.filter(r => (r.wordCount || 0) < 300);
            case 'orphans': return results.filter(r => (r.incomingLinks || 0) === 0);
            case 'slow-performance': return results.filter(r => (r.psi_data?.desktop?.score || 0) < 50);
            default: return results;
        }
    };

    const filteredResults = getFilteredResults();

    const handleReviewIssue = (id: string) => {
        setFilterId(id);
        setActiveTab('pages');
    };

    // Filter history for current project (optional)
    const projectHistory = history.filter(h => h.projectId === projectId);
    const formatDate = (iso: string) => new Date(iso).toLocaleString();

    return (
        <div className="space-y-8 animate-in fade-in slide-in-from-bottom-6 duration-700 pb-20">
            {/* Header Section */}
            <div className="flex flex-col md:flex-row items-center justify-between gap-6 bg-white border-2 border-black p-6 shadow-[8px_8px_0px_0px_#000]">
                <div className="flex items-center gap-5 w-full md:w-auto">
                    <div className="p-3 bg-[#FF6B6B] border-2 border-black text-black shadow-[4px_4px_0px_0px_rgba(0,0,0,0.1)]">
                        <Search className="w-8 h-8" />
                    </div>
                    <div>
                        <h2 className="text-4xl font-black text-black tracking-tighter uppercase italic">
                            SEO Commander
                        </h2>
                        <div className="flex items-center gap-2 mt-1">
                            <span className="w-2 h-2 bg-green-500 rounded-full border border-black animate-pulse"></span>
                            <p className="text-xs font-bold text-slate-500 uppercase tracking-widest">System Ready</p>
                        </div>
                    </div>
                </div>

                <div className="flex items-center gap-3 w-full md:w-auto">
                    {/* History Dropdown */}
                    {projectHistory.length > 0 && (
                        <div className="relative group flex-1 md:flex-none">
                            <select
                                value={selectedHistoryId}
                                onChange={(e) => handleHistorySelect(e.target.value)}
                                className="w-full md:w-56 appearance-none bg-white hover:bg-slate-50 border-2 border-black text-black text-sm font-bold py-3 pl-4 pr-10 shadow-[4px_4px_0px_0px_#000] focus:translate-x-[2px] focus:translate-y-[2px] focus:shadow-none focus:outline-none transition-all cursor-pointer uppercase"
                            >
                                <option value="live">⚡ New Audit</option>
                                <optgroup label="Previous Audits">
                                    {projectHistory.map((h) => (
                                        <option key={h.id} value={h.id}>
                                            📄 {formatDate(h.timestamp)}
                                        </option>
                                    ))}
                                </optgroup>
                            </select>
                            <History className="w-4 h-4 text-black absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                        </div>
                    )}

                    <button
                        onClick={runAudit}
                        disabled={loading}
                        className="flex-1 md:flex-none flex items-center justify-center gap-2 bg-black hover:bg-slate-800 text-white px-8 py-3.5 border-2 border-transparent hover:border-black hover:bg-white hover:text-black hover:shadow-[4px_4px_0px_0px_#000] disabled:opacity-50 disabled:pointer-events-none transition-all font-black text-sm active:translate-x-[2px] active:translate-y-[2px] active:shadow-none uppercase tracking-wide"
                    >
                        {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                        {loading ? 'Scanning...' : 'Start Audit'}
                    </button>
                </div>
            </div>

            {error && (
                <div className="bg-red-50/80 backdrop-blur-sm text-red-600 p-4 rounded-2xl border border-red-100 flex items-center gap-3 shadow-sm animate-in fade-in zoom-in-95">
                    <LayoutDashboard className="w-5 h-5 flex-shrink-0 animate-bounce" />
                    <span className="font-medium">{error}</span>
                </div>
            )}

            {/* Main Content Area */}
            {results.length > 0 && (
                <div className="space-y-6">

                    {/* Tabs Navigation - Improved Button Group */}
                    <div className="flex flex-wrap items-center gap-4 mb-2">
                        {[
                            { id: 'overview', label: 'Overview', icon: LayoutDashboard },
                            { id: 'issues', label: 'Issues', icon: AlertOctagon },
                            { id: 'pages', label: 'All Pages', icon: TableProperties },
                            { id: 'ai', label: 'AI Insight', icon: Sparkles, special: true },
                        ].map((tab) => (
                            <button
                                key={tab.id}
                                onClick={() => setActiveTab(tab.id as Tab)}
                                className={`
                                    flex items-center gap-2 px-6 py-3 text-sm font-black transition-all uppercase tracking-wider border-2 border-black
                                    ${activeTab === tab.id
                                        ? 'bg-black text-white shadow-none translate-x-[4px] translate-y-[4px]'
                                        : 'bg-white text-black shadow-[4px_4px_0px_0px_#000] hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-[2px_2px_0px_0px_#000]'
                                    }
                                    ${tab.special && activeTab !== tab.id ? 'text-blue-600' : ''}
                                `}
                            >
                                <tab.icon className={`w-4 h-4 ${tab.special && activeTab !== tab.id ? 'text-blue-600 animate-pulse' : ''}`} />
                                {tab.label}
                            </button>
                        ))}
                    </div>

                    {/* Historical Banner */}
                    {selectedHistoryId !== 'live' && (
                        <div className="bg-white border-2 border-black p-3 flex items-center gap-3 text-black text-sm shadow-[4px_4px_0px_0px_#000] w-fit">
                            <Calendar className="w-4 h-4 text-black" />
                            <div>Historical Snapshot: <span className="font-black bg-yellow-300 px-1 border border-black">{formatDate(history.find(h => h.id === selectedHistoryId)?.timestamp || '')}</span></div>
                        </div>
                    )}

                    {/* Tab Content */}
                    <div className="min-h-[400px]">
                        {activeTab === 'overview' && <AuditOverview results={results} history={projectHistory} />}
                        {activeTab === 'issues' && <AuditIssues results={results} onReview={handleReviewIssue} />}
                        {activeTab === 'pages' && (
                            <div className="space-y-4">
                                {filterId && (
                                    <div className="flex items-center justify-between bg-indigo-50 border border-indigo-100 p-3 rounded-xl animate-in fade-in slide-in-from-top-2">
                                        <div className="text-sm font-bold text-indigo-700 flex items-center gap-2">
                                            <Filter className="w-4 h-4" />
                                            Filtering by: <span className="uppercase">{filterId.replace('-', ' ')}</span>
                                            <span className="bg-white px-2 py-0.5 rounded text-xs border border-indigo-200">{filteredResults.length}</span>
                                        </div>
                                        <button
                                            onClick={() => setFilterId('')}
                                            className="text-xs font-bold text-indigo-600 hover:text-indigo-800 hover:underline"
                                        >
                                            Clear Filter
                                        </button>
                                    </div>
                                )}
                                <AuditTable results={filteredResults} onRequestIndexing={handleRequestIndexing} />
                            </div>
                        )}
                        {activeTab === 'ai' && <AuditAI results={results} />}
                    </div>
                </div>
            )}
        </div>
    );
}
