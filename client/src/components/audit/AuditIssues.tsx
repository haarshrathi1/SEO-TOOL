import { AlertTriangle, XCircle, ChevronRight, Info, Link2 } from 'lucide-react';
import type { AuditResult } from '../../types';

interface IssuesProps {
    results: AuditResult[];
    onReview: (filterId: string) => void;
}

function count(results: AuditResult[], predicate: (result: AuditResult) => boolean) {
    return results.filter(predicate).length;
}

export default function AuditIssues({ results, onReview }: IssuesProps) {
    const errors = [
        {
            id: 'not-indexed',
            title: 'Pages Not Indexed Or Failing',
            count: count(results, (result) => result.status !== 'PASS'),
            desc: 'These URLs are not passing Google inspection cleanly.',
        },
        {
            id: 'non-200',
            title: '4xx/5xx URLs In Sitemap',
            count: count(results, (result) => (result.httpStatus || 0) >= 400),
            desc: 'Sitemap URLs should resolve cleanly and not return errors.',
        },
        {
            id: 'noindex',
            title: 'Noindex Pages',
            count: count(results, (result) => !!result.isNoindex),
            desc: 'These pages contain a meta noindex directive.',
        },
        {
            id: 'no-h1',
            title: 'Missing H1 Tags',
            count: count(results, (result) => result.h1Count === 0),
            desc: 'Pages without an H1 are missing their primary on-page heading.',
        },
        {
            id: 'multi-h1',
            title: 'Multiple H1 Tags',
            count: count(results, (result) => (result.h1Count || 0) > 1),
            desc: 'Multiple H1 tags can blur page focus and template quality.',
        },
    ].filter((issue) => issue.count > 0);

    const warnings = [
        {
            id: 'missing-desc',
            title: 'Missing Meta Descriptions',
            count: count(results, (result) => !result.description),
            desc: 'CTR is harder to control when descriptions are missing.',
        },
        {
            id: 'missing-canonical',
            title: 'Missing Canonicals',
            count: count(results, (result) => !result.canonicalUrl),
            desc: 'Canonical tags help consolidate duplicate and parameterized URLs.',
        },
        {
            id: 'canonical-issue',
            title: 'Canonical Mismatches',
            count: count(results, (result) => !!result.canonicalIssue),
            desc: 'These pages point canonical to a different URL than the crawled page.',
        },
        {
            id: 'duplicate-title',
            title: 'Duplicate Titles',
            count: count(results, (result) => !!result.duplicateTitle),
            desc: 'Duplicate titles weaken page differentiation across the site.',
        },
        {
            id: 'duplicate-description',
            title: 'Duplicate Descriptions',
            count: count(results, (result) => !!result.duplicateDescription),
            desc: 'Duplicate descriptions usually signal template SEO debt.',
        },
        {
            id: 'low-word-count',
            title: 'Low Word Count (< 300 words)',
            count: count(results, (result) => (result.wordCount || 0) < 300),
            desc: 'Thin content is harder to rank unless the intent is very narrow.',
        },
        {
            id: 'missing-schema',
            title: 'Missing Structured Data',
            count: count(results, (result) => !result.schemaCount),
            desc: 'Structured data improves clarity and feature eligibility.',
        },
        {
            id: 'missing-alt',
            title: 'Images Missing Alt Text',
            count: count(results, (result) => (result.missingAltCount || 0) > 0),
            desc: 'Missing alt text hurts accessibility and image SEO quality.',
        },
        {
            id: 'missing-lang',
            title: 'Missing HTML Lang',
            count: count(results, (result) => !result.lang),
            desc: 'The root html lang attribute should be explicitly set.',
        },
        {
            id: 'missing-social',
            title: 'Missing Social Meta',
            count: count(results, (result) => !result.hasOgTags || !result.hasTwitterCard),
            desc: 'Open Graph and Twitter card tags are missing or incomplete.',
        },
        {
            id: 'redirected',
            title: 'Redirected Sitemap URLs',
            count: count(results, (result) => !!result.redirected && (result.httpStatus || 0) < 400),
            desc: 'Sitemaps should point directly at final canonical URLs.',
        },
        {
            id: 'slow-performance',
            title: 'Slow Desktop Performance (< 50)',
            count: count(results, (result) => (result.psi_data?.desktop?.score || 0) < 50),
            desc: 'These sampled pages have poor desktop performance scores.',
        },
    ].filter((issue) => issue.count > 0);

    const orphanCount = count(results, (result) => !!result.isOrphan);

    return (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div>
                <h3 className="text-sm font-black text-black uppercase tracking-wider mb-4 flex items-center gap-2 bg-red-100 w-fit px-2 border-2 border-black">
                    <XCircle className="w-4 h-4 text-red-600" />
                    Critical Issues ({errors.reduce((sum, issue) => sum + issue.count, 0)})
                </h3>
                <div className="space-y-3">
                    {errors.map((issue) => (
                        <div
                            key={issue.id}
                            onClick={() => onReview(issue.id)}
                            className="bg-white p-4 border-2 border-black shadow-[4px_4px_0px_0px_#000] hover:translate-x-[-2px] hover:translate-y-[-2px] hover:shadow-[6px_6px_0px_0px_#000] transition-all flex items-center justify-between group cursor-pointer"
                        >
                            <div className="flex items-center gap-4">
                                <div className="p-3 bg-[#FF6B6B] text-black border-2 border-black">
                                    <AlertTriangle className="w-5 h-5" />
                                </div>
                                <div>
                                    <div className="font-black text-black text-lg uppercase">{issue.count} {issue.title}</div>
                                    <div className="text-slate-600 font-bold text-sm mt-0.5">{issue.desc}</div>
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

            <div>
                <h3 className="text-sm font-black text-black uppercase tracking-wider mb-4 flex items-center gap-2 bg-yellow-100 w-fit px-2 border-2 border-black">
                    <AlertTriangle className="w-4 h-4 text-amber-600" />
                    Warnings ({warnings.reduce((sum, issue) => sum + issue.count, 0)})
                </h3>
                <div className="space-y-3">
                    {warnings.map((issue) => (
                        <div
                            key={issue.id}
                            onClick={() => onReview(issue.id)}
                            className="bg-white p-4 border-2 border-black shadow-[4px_4px_0px_0px_#000] hover:translate-x-[-2px] hover:translate-y-[-2px] hover:shadow-[6px_6px_0px_0px_#000] transition-all flex items-center justify-between group cursor-pointer"
                        >
                            <div className="flex items-center gap-4">
                                <div className="p-3 bg-yellow-300 text-black border-2 border-black">
                                    <Info className="w-5 h-5" />
                                </div>
                                <div>
                                    <div className="font-black text-black text-lg uppercase">{issue.count} {issue.title}</div>
                                    <div className="text-slate-600 font-bold text-sm mt-0.5">{issue.desc}</div>
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
            </div>

            <div>
                <h3 className="text-sm font-black text-black uppercase tracking-wider mb-4 flex items-center gap-2 bg-blue-100 w-fit px-2 border-2 border-black">
                    <Link2 className="w-4 h-4 text-blue-600" />
                    Link Health ({orphanCount > 0 ? 1 : 0})
                </h3>
                <div className="space-y-3">
                    {orphanCount > 0 && (
                        <div
                            onClick={() => onReview('orphans')}
                            className="bg-white p-4 border-2 border-black shadow-[4px_4px_0px_0px_#000] hover:translate-x-[-2px] hover:translate-y-[-2px] hover:shadow-[6px_6px_0px_0px_#000] transition-all flex items-center justify-between group cursor-pointer"
                        >
                            <div className="flex items-center gap-4">
                                <div className="p-3 bg-blue-300 text-black border-2 border-black">
                                    <AlertTriangle className="w-5 h-5" />
                                </div>
                                <div>
                                    <div className="font-black text-black text-lg uppercase">{orphanCount} Orphaned Pages</div>
                                    <div className="text-slate-600 font-bold text-sm mt-0.5">Pages with zero incoming internal links, excluding the crawl root.</div>
                                </div>
                            </div>
                            <div className="flex items-center gap-2 text-black font-black text-sm bg-blue-100 px-4 py-2 border-2 border-black group-hover:bg-black group-hover:text-white transition-colors uppercase">
                                Connect <ChevronRight className="w-4 h-4" />
                            </div>
                        </div>
                    )}
                    {orphanCount === 0 && (
                        <div className="p-6 bg-slate-50 border-2 border-black text-center text-slate-500 font-bold italic shadow-[4px_4px_0px_0px_rgba(0,0,0,0.1)]">
                            No orphaned pages detected.
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
