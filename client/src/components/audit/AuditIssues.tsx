import { AlertTriangle, ChevronRight, Info, XCircle } from 'lucide-react';
import { isHighValueUnderlinked, isIndexedOrphan } from '../../internalLinkRecommendations';
import type { AuditResult } from '../../types';

interface IssuesProps {
    results: AuditResult[];
    onReview: (filterId: string) => void;
}

export default function AuditIssues({ results, onReview }: IssuesProps) {
    const orphanCount = results.filter((result) => isIndexedOrphan(result)).length;
    const highValueUnderlinkedCount = results.filter((result) => isHighValueUnderlinked(result)).length;

    const errors = [
        {
            id: 'not-indexed',
            title: 'Pages not indexed by Google',
            count: results.filter((result) => result.status === 'FAIL').length,
            severity: 'critical',
            desc: 'These pages are completely invisible to search engines.',
        },
        {
            id: 'no-h1',
            title: 'Missing H1 Tags',
            count: results.filter((result) => result.h1Count === 0).length,
            severity: 'critical',
            desc: 'H1 tags are crucial for ranking. Several pages have none.',
        },
        {
            id: 'multi-h1',
            title: 'Multiple H1 Tags',
            count: results.filter((result) => result.h1Count && result.h1Count > 1).length,
            severity: 'critical',
            desc: 'Multiple H1s confuse search engines about the main topic.',
        },
    ].filter((issue) => issue.count > 0);

    const warnings = [
        {
            id: 'missing-desc',
            title: 'Missing Meta Descriptions',
            count: results.filter((result) => !result.description).length,
            severity: 'warning',
            desc: 'CTR may be lower because Google will generate random snippets.',
        },
        {
            id: 'low-word-count',
            title: 'Low Word Count (< 300 words)',
            count: results.filter((result) => (result.wordCount || 0) < 300).length,
            severity: 'warning',
            desc: 'Thin content is hard to rank.',
        },
        {
            id: 'slow-performance',
            title: 'Slow Desktop Performance (< 50)',
            count: results.filter((result) => (result.psi_data?.desktop?.score || 0) < 50).length,
            severity: 'warning',
            desc: 'User experience is poor on these pages.',
        },
    ].filter((issue) => issue.count > 0);

    return (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div>
                <h3 className="mb-4 flex w-fit items-center gap-2 border-2 border-black bg-red-100 px-2 text-sm font-black uppercase tracking-wider text-black">
                    <XCircle className="h-4 w-4 text-red-600" />
                    Critical Issues ({errors.reduce((sum, issue) => sum + issue.count, 0)})
                </h3>
                <div className="space-y-3">
                    {errors.map((issue, index) => (
                        <button
                            key={index}
                            type="button"
                            onClick={() => onReview(issue.id)}
                            className="group flex w-full cursor-pointer items-center justify-between border-2 border-black bg-white p-4 text-left shadow-[4px_4px_0px_0px_#000] transition-all hover:translate-x-[-2px] hover:translate-y-[-2px] hover:shadow-[6px_6px_0px_0px_#000] focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
                        >
                            <div className="flex items-center gap-4">
                                <div className="border-2 border-black bg-[#FF6B6B] p-3 text-black">
                                    <AlertTriangle className="h-5 w-5" />
                                </div>
                                <div>
                                    <div className="text-lg font-black uppercase text-black">{issue.count} {issue.title}</div>
                                    <div className="mt-0.5 text-sm font-bold text-slate-600">{issue.desc}</div>
                                </div>
                            </div>
                            <div className="flex items-center gap-2 border-2 border-black bg-red-100 px-4 py-2 text-sm font-black uppercase text-black transition-colors group-hover:bg-black group-hover:text-white">
                                Fix Now <ChevronRight className="h-4 w-4" />
                            </div>
                        </button>
                    ))}
                    {errors.length === 0 && (
                        <div className="p-6 text-center font-bold italic text-slate-500 shadow-[4px_4px_0px_0px_rgba(0,0,0,0.1)] border-2 border-black bg-slate-50">
                            Great work! No critical issues found.
                        </div>
                    )}
                </div>
            </div>

            <div>
                <h3 className="mb-4 flex w-fit items-center gap-2 border-2 border-black bg-yellow-100 px-2 text-sm font-black uppercase tracking-wider text-black">
                    <AlertTriangle className="h-4 w-4 text-amber-600" />
                    Warnings ({warnings.reduce((sum, issue) => sum + issue.count, 0)})
                </h3>
                <div className="space-y-3">
                    {warnings.map((issue, index) => (
                        <button
                            key={index}
                            type="button"
                            onClick={() => onReview(issue.id)}
                            className="group flex w-full cursor-pointer items-center justify-between border-2 border-black bg-white p-4 text-left shadow-[4px_4px_0px_0px_#000] transition-all hover:translate-x-[-2px] hover:translate-y-[-2px] hover:shadow-[6px_6px_0px_0px_#000] focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
                        >
                            <div className="flex items-center gap-4">
                                <div className="border-2 border-black bg-yellow-300 p-3 text-black">
                                    <Info className="h-5 w-5" />
                                </div>
                                <div>
                                    <div className="text-lg font-black uppercase text-black">{issue.count} {issue.title}</div>
                                    <div className="mt-0.5 text-sm font-bold text-slate-600">{issue.desc}</div>
                                </div>
                            </div>
                            <div className="flex items-center gap-2 border-2 border-black bg-yellow-100 px-4 py-2 text-sm font-black uppercase text-black transition-colors group-hover:bg-black group-hover:text-white">
                                Review <ChevronRight className="h-4 w-4" />
                            </div>
                        </button>
                    ))}
                    {warnings.length === 0 && (
                        <div className="border-2 border-black bg-slate-50 p-6 text-center font-bold italic text-slate-500 shadow-[4px_4px_0px_0px_rgba(0,0,0,0.1)]">
                            No warnings found.
                        </div>
                    )}
                </div>

                <div>
                    <h3 className="mb-4 flex w-fit items-center gap-2 border-2 border-black bg-blue-100 px-2 text-sm font-black uppercase tracking-wider text-black">
                        <AlertTriangle className="h-4 w-4 text-blue-600" />
                        Link Opportunities ({(orphanCount > 0 ? 1 : 0) + (highValueUnderlinkedCount > 0 ? 1 : 0)})
                    </h3>
                    <div className="space-y-3">
                        {orphanCount > 0 && (
                            <button
                                type="button"
                                onClick={() => onReview('links-indexed-orphans')}
                                className="group flex w-full cursor-pointer items-center justify-between border-2 border-black bg-white p-4 text-left shadow-[4px_4px_0px_0px_#000] transition-all hover:translate-x-[-2px] hover:translate-y-[-2px] hover:shadow-[6px_6px_0px_0px_#000] focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
                            >
                                <div className="flex items-center gap-4">
                                    <div className="border-2 border-black bg-blue-300 p-3 text-black">
                                        <AlertTriangle className="h-5 w-5" />
                                    </div>
                                    <div>
                                        <div className="text-lg font-black uppercase text-black">{orphanCount} Indexed Orphan Pages</div>
                                        <div className="mt-0.5 text-sm font-bold text-slate-600">Indexed pages with zero internal support.</div>
                                    </div>
                                </div>
                                <div className="flex items-center gap-2 border-2 border-black bg-blue-100 px-4 py-2 text-sm font-black uppercase text-black transition-colors group-hover:bg-black group-hover:text-white">
                                    Connect <ChevronRight className="h-4 w-4" />
                                </div>
                            </button>
                        )}
                        {highValueUnderlinkedCount > 0 && (
                            <button
                                type="button"
                                onClick={() => onReview('links-high-value-underlinked')}
                                className="group flex w-full cursor-pointer items-center justify-between border-2 border-black bg-white p-4 text-left shadow-[4px_4px_0px_0px_#000] transition-all hover:translate-x-[-2px] hover:translate-y-[-2px] hover:shadow-[6px_6px_0px_0px_#000] focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
                            >
                                <div className="flex items-center gap-4">
                                    <div className="border-2 border-black bg-blue-300 p-3 text-black">
                                        <Info className="h-5 w-5" />
                                    </div>
                                    <div>
                                        <div className="text-lg font-black uppercase text-black">{highValueUnderlinkedCount} High-Value Underlinked Pages</div>
                                        <div className="mt-0.5 text-sm font-bold text-slate-600">Pages with traffic or substantial content that only have one or two internal links.</div>
                                    </div>
                                </div>
                                <div className="flex items-center gap-2 border-2 border-black bg-blue-100 px-4 py-2 text-sm font-black uppercase text-black transition-colors group-hover:bg-black group-hover:text-white">
                                    Review <ChevronRight className="h-4 w-4" />
                                </div>
                            </button>
                        )}
                        {orphanCount === 0 && highValueUnderlinkedCount === 0 && (
                            <div className="border-2 border-black bg-slate-50 p-6 text-center font-bold italic text-slate-500 shadow-[4px_4px_0px_0px_rgba(0,0,0,0.1)]">
                                No priority internal linking gaps found.
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
