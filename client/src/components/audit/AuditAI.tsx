import { useState } from 'react';
import { Sparkles, Bot, Loader2, AlertTriangle, FileText } from 'lucide-react';
import type { AuditResult, AIAnalysisResult } from '../../types';
import { api } from '../../api';

interface AuditAIProps {
    results: AuditResult[];
}

export default function AuditAI({ results }: AuditAIProps) {
    const [selectedUrl, setSelectedUrl] = useState<string>('');
    const [analysis, setAnalysis] = useState<AIAnalysisResult | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    const handleAnalyze = async () => {
        if (!selectedUrl) return;

        const page = results.find(r => r.url === selectedUrl);
        if (!page) return;

        setLoading(true);
        setError('');
        setAnalysis(null);

        try {
            // we need the content. If we didn't save full content in AuditResult, we might need to re-fetch/crawl or assume it's there
            // The crawler logic (which I haven't seen fully updated yet to store 'content' in result) might need a check.
            // Wait, looking at crawler.js plan, we extracted title/h1 but did we save 'content'? 
            // If not, we might need to re-crawl OR pass the text if we have it.
            // For now, I will assume we might need to fetch the page content AGAIN here or assume the crawler saved it.
            // Let's assume for this "Live" tool, we might want to just hit the Analyze endpoint with the URL and let the backend fetch it?
            // BUT, the backend `analyzePageContent` expects `content` argument. 
            // Let's update the backend endpoint to optionally FETCH if content is missing, OR better,
            // let's pass the URL and let the backend do the heavy lifting if we don't have the content string in the frontend.
            // Actually, for "Analyze this page", it's better to verify fresh content.

            // Fetch content if missing handled by backend if we send just URL
            const data = await api.analyzeContent(selectedUrl);
            setAnalysis(data);
        } catch (e: unknown) {
            setError(e instanceof Error ? e.message : 'Failed to analyze page');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
            {/* Sidebar: Page Selector */}
            <div className="lg:col-span-1 bg-white border-2 border-black shadow-[8px_8px_0px_0px_#000] p-6 h-fit">
                <h3 className="text-lg font-black text-black mb-4 flex items-center gap-2 uppercase">
                    <FileText className="w-5 h-5 text-blue-600" /> Select Page
                </h3>
                <div className="space-y-2 max-h-[60vh] overflow-y-auto pr-2 custom-scrollbar">
                    {results.map((r, i) => (
                        <button
                            key={i}
                            onClick={() => { setSelectedUrl(r.url); setAnalysis(null); }}
                            className={`w-full text-left p-3 text-sm transition-all border-2 ${selectedUrl === r.url
                                ? 'bg-black border-black text-white font-bold shadow-[4px_4px_0px_0px_rgba(0,0,0,0.5)]'
                                : 'bg-white border-transparent hover:bg-slate-50 text-slate-600 hover:border-black font-medium'
                                }`}
                        >
                            <div className="truncate font-mono">{(() => { try { return new URL(r.finalUrl || r.url).pathname || '/'; } catch { return r.url; } })()}</div>
                            {r.status === 'FAIL' && <span className="text-[10px] text-red-500 font-bold uppercase block mt-1">Not Indexed</span>}
                        </button>
                    ))}
                </div>
            </div>

            {/* Main Area: Analysis Result */}
            <div className="lg:col-span-2 space-y-6">
                {!selectedUrl ? (
                    <div className="h-full min-h-[400px] flex flex-col items-center justify-center text-center p-10 bg-slate-100 border-2 border-dashed border-slate-300">
                        <div className="p-4 bg-white border-2 border-black shadow-[4px_4px_0px_0px_#000] mb-4">
                            <Bot className="w-8 h-8 text-black" />
                        </div>
                        <h3 className="text-black font-black uppercase text-xl">Select a page to analyze</h3>
                        <p className="text-slate-500 font-bold text-sm mt-2 max-w-xs">Gemini AI will read the content and provide strategic recommendations.</p>
                    </div>
                ) : (
                    <>
                        {/* Header Card */}
                        <div className="bg-white p-6 border-2 border-black shadow-[8px_8px_0px_0px_#000] flex items-center justify-between">
                            <div>
                                <div className="text-xs font-black text-black uppercase tracking-wider mb-1 bg-yellow-300 w-fit px-1 border border-black">Target Page</div>
                                <div className="font-bold text-black truncate max-w-md mt-1">{selectedUrl}</div>
                            </div>
                            <button
                                onClick={handleAnalyze}
                                disabled={loading}
                                className="bg-black text-white px-6 py-3 border-2 border-transparent hover:bg-white hover:text-black hover:border-black hover:shadow-[4px_4px_0px_0px_#000] disabled:opacity-50 disabled:pointer-events-none transition-all flex items-center gap-2 font-bold uppercase active:translate-x-[2px] active:translate-y-[2px] active:shadow-none"
                            >
                                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                                {loading ? 'Reading Page...' : 'Generate Insight'}
                            </button>
                        </div>

                        {/* Error */}
                        {error && (
                            <div className="bg-red-50 text-red-600 p-4 border-2 border-black flex items-center gap-2 font-bold shadow-[4px_4px_0px_0px_#000]">
                                <AlertTriangle className="w-5 h-5" /> {error}
                            </div>
                        )}

                        {/* Results */}
                        {analysis && (
                            <div className="space-y-6 animate-in fade-in slide-in-from-bottom-8 duration-700">
                                {/* Score & Topic */}
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                    <div className="bg-white p-6 border-2 border-black shadow-[4px_4px_0px_0px_#000]">
                                        <div className="text-slate-500 text-xs font-black uppercase tracking-wider mb-2">Detected Intent</div>
                                        <div className="text-xl font-black text-black bg-slate-100 p-2 border-2 border-black uppercase">{analysis.topic || 'General'}</div>
                                        <p className="text-slate-600 text-sm font-bold mt-2">{analysis.reasoning}</p>
                                    </div>
                                    <div className="bg-white p-6 border-2 border-black shadow-[4px_4px_0px_0px_#000] flex flex-col justify-center items-center text-center">
                                        <div className="text-slate-500 text-xs font-black uppercase tracking-wider mb-2">Content Depth</div>
                                        <div className="text-5xl font-black text-black">
                                            {analysis.score}<span className="text-2xl text-slate-400">/100</span>
                                        </div>
                                    </div>
                                </div>

                                {/* Recommendations */}
                                <div className="bg-white p-8 border-2 border-black shadow-[4px_4px_0px_0px_#000] space-y-8">

                                    {/* Title */}
                                    <div className="group">
                                        <div className="flex items-center justify-between mb-3">
                                            <h4 className="font-black text-black flex items-center gap-2 uppercase">
                                                <span className="w-6 h-6 bg-blue-600 text-white flex items-center justify-center text-xs border border-black">T</span>
                                                Title Strategy
                                            </h4>
                                            <button className="text-xs font-bold text-white uppercase opacity-0 group-hover:opacity-100 transition-opacity bg-black px-3 py-1.5 border border-black hover:bg-white hover:text-black">Copy</button>
                                        </div>
                                        <div className="p-4 bg-slate-50 border-2 border-black text-black font-bold font-mono">
                                            {analysis.suggestedTitle}
                                        </div>
                                    </div>

                                    {/* Description */}
                                    <div className="group">
                                        <div className="flex items-center justify-between mb-3">
                                            <h4 className="font-black text-black flex items-center gap-2 uppercase">
                                                <span className="w-6 h-6 bg-green-600 text-white flex items-center justify-center text-xs border border-black">D</span>
                                                Meta Description
                                            </h4>
                                            <button className="text-xs font-bold text-white uppercase opacity-0 group-hover:opacity-100 transition-opacity bg-black px-3 py-1.5 border border-black hover:bg-white hover:text-black">Copy</button>
                                        </div>
                                        <div className="p-4 bg-slate-50 border-2 border-black text-black font-medium leading-relaxed font-mono">
                                            {analysis.suggestedDescription}
                                        </div>
                                    </div>

                                    {/* Missing Topics */}
                                    <div>
                                        <h4 className="font-black text-black mb-4 flex items-center gap-2 uppercase">
                                            <AlertTriangle className="w-4 h-4 text-amber-600" />
                                            Missing Semantic Topics
                                        </h4>
                                        <div className="flex flex-wrap gap-2">
                                            {analysis.missingTopics?.map((topic: string, i: number) => (
                                                <span key={i} className="px-3 py-1.5 bg-yellow-300 text-black border-2 border-black text-sm font-bold shadow-[2px_2px_0px_0px_#000]">
                                                    + {topic}
                                                </span>
                                            ))}
                                        </div>
                                    </div>

                                </div>
                            </div>
                        )}
                    </>
                )}
            </div>
        </div>
    );
}

