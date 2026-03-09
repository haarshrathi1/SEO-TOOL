import { AlertTriangle, XCircle, ChevronRight, Info } from 'lucide-react';
import type { AuditResult } from '../../types';

interface IssuesProps {
    results: AuditResult[];
    onReview: (filterId: string) => void;
}

export default function AuditIssues({ results, onReview }: IssuesProps) {

    // Group Issues
    const errors = [
        {
            id: 'not-indexed',
            title: 'Pages not indexed by Google',
            count: results.filter(r => r.status === 'FAIL').length,
            severity: 'critical',
            desc: 'These pages are completely invisible to search engines.'
        },
        {
            id: 'no-h1',
            title: 'Missing H1 Tags',
            count: results.filter(r => r.h1Count === 0).length,
            severity: 'critical',
            desc: 'H1 tags are crucial for ranking. Several pages have none.'
        },
        {
            id: 'multi-h1',
            title: 'Multiple H1 Tags',
            count: results.filter(r => r.h1Count && r.h1Count > 1).length,
            severity: 'critical',
            desc: 'Multiple H1s confuse search engines about the main topic.'
        }
    ].filter(i => i.count > 0);

    const warnings = [
        {
            id: 'missing-desc',
            title: 'Missing Meta Descriptions',
            count: results.filter(r => !r.description).length,
            severity: 'warning',
            desc: 'CTR may be lower because Google will generate random snippets.'
        },
        {
            id: 'low-word-count',
            title: 'Low Word Count (< 300 words)',
            count: results.filter(r => (r.wordCount || 0) < 300).length,
            severity: 'warning',
            desc: 'Thin content is hard to rank.'
        },
        {
            id: 'slow-performance',
            title: 'Slow Desktop Performance (< 50)',
            count: results.filter(r => (r.psi_data?.desktop?.score || 0) < 50).length,
            severity: 'warning',
            desc: 'User experience is poor on these pages.'
        }
    ].filter(i => i.count > 0);

    return (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
            {/* Critical Errors Section */}
            <div>
                <h3 className="text-sm font-black text-black uppercase tracking-wider mb-4 flex items-center gap-2 bg-red-100 w-fit px-2 border-2 border-black">
                    <XCircle className="w-4 h-4 text-red-600" />
                    Critical Issues ({errors.reduce((a, b) => a + b.count, 0)})
                </h3>
                <div className="space-y-3">
                    {errors.map((err, i) => (
                        <div
                            key={i}
                            onClick={() => onReview(err.id)}
                            className="bg-white p-4 border-2 border-black shadow-[4px_4px_0px_0px_#000] hover:translate-x-[-2px] hover:translate-y-[-2px] hover:shadow-[6px_6px_0px_0px_#000] transition-all flex items-center justify-between group cursor-pointer"
                        >
                            <div className="flex items-center gap-4">
                                <div className="p-3 bg-[#FF6B6B] text-black border-2 border-black">
                                    <AlertTriangle className="w-5 h-5" />
                                </div>
                                <div>
                                    <div className="font-black text-black text-lg uppercase">{err.count} {err.title}</div>
                                    <div className="text-slate-600 font-bold text-sm mt-0.5">{err.desc}</div>
                                </div>
                            </div>
                            <div className="flex items-center gap-2 text-black font-black text-sm bg-red-100 px-4 py-2 border-2 border-black group-hover:bg-black group-hover:text-white transition-colors uppercase">
                                Fix Now <ChevronRight className="w-4 h-4" />
                            </div>
                        </div>
                    ))}
                    {errors.length === 0 && (
                        <div className="p-6 bg-slate-50 border-2 border-black text-center text-slate-500 font-bold italic shadow-[4px_4px_0px_0px_rgba(0,0,0,0.1)]">
                            Great work! No critical issues found.
                        </div>
                    )}
                </div>
            </div>

            {/* Warnings Section */}
            <div>
                <h3 className="text-sm font-black text-black uppercase tracking-wider mb-4 flex items-center gap-2 bg-yellow-100 w-fit px-2 border-2 border-black">
                    <AlertTriangle className="w-4 h-4 text-amber-600" />
                    Warnings ({warnings.reduce((a, b) => a + b.count, 0)})
                </h3>
                <div className="space-y-3">
                    {warnings.map((warn, i) => (
                        <div
                            key={i}
                            onClick={() => onReview(warn.id)}
                            className="bg-white p-4 border-2 border-black shadow-[4px_4px_0px_0px_#000] hover:translate-x-[-2px] hover:translate-y-[-2px] hover:shadow-[6px_6px_0px_0px_#000] transition-all flex items-center justify-between group cursor-pointer"
                        >
                            <div className="flex items-center gap-4">
                                <div className="p-3 bg-yellow-300 text-black border-2 border-black">
                                    <Info className="w-5 h-5" />
                                </div>
                                <div>
                                    <div className="font-black text-black text-lg uppercase">{warn.count} {warn.title}</div>
                                    <div className="text-slate-600 font-bold text-sm mt-0.5">{warn.desc}</div>
                                </div>
                            </div>
                            <div className="flex items-center gap-2 text-black font-black text-sm bg-yellow-100 px-4 py-2 border-2 border-black group-hover:bg-black group-hover:text-white transition-colors uppercase">
                                Review <ChevronRight className="w-4 h-4" />
                            </div>
                        </div>
                    ))}
                    {warnings.length === 0 && (
                        <div className="p-6 bg-slate-50 border-2 border-black text-center text-slate-500 font-bold italic shadow-[4px_4px_0px_0px_rgba(0,0,0,0.1)]">
                            No warnings found.
                        </div>
                    )}
                </div>
                {/* Link Doctor Section */}
                <div>
                    <h3 className="text-sm font-black text-black uppercase tracking-wider mb-4 flex items-center gap-2 bg-blue-100 w-fit px-2 border-2 border-black">
                        <AlertTriangle className="w-4 h-4 text-blue-600" />
                        Link Health ({results.filter(r => (r.incomingLinks || 0) === 0).length > 0 ? 1 : 0})
                    </h3>
                    <div className="space-y-3">
                        {/* Orphaned Pages */}
                        {results.filter(r => (r.incomingLinks || 0) === 0).length > 0 && (
                            <div
                                onClick={() => onReview('orphans')}
                                className="bg-white p-4 border-2 border-black shadow-[4px_4px_0px_0px_#000] hover:translate-x-[-2px] hover:translate-y-[-2px] hover:shadow-[6px_6px_0px_0px_#000] transition-all flex items-center justify-between group cursor-pointer"
                            >
                                <div className="flex items-center gap-4">
                                    <div className="p-3 bg-blue-300 text-black border-2 border-black">
                                        <AlertTriangle className="w-5 h-5" />
                                    </div>
                                    <div>
                                        <div className="font-black text-black text-lg uppercase">
                                            {results.filter(r => (r.incomingLinks || 0) === 0).length} Orphaned Pages
                                        </div>
                                        <div className="text-slate-600 font-bold text-sm mt-0.5">Pages with ZERO internal links (Ghosts).</div>
                                    </div>
                                </div>
                                <div className="flex items-center gap-2 text-black font-black text-sm bg-blue-100 px-4 py-2 border-2 border-black group-hover:bg-black group-hover:text-white transition-colors uppercase">
                                    Connect <ChevronRight className="w-4 h-4" />
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
