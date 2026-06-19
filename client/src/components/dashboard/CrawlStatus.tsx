import { Search, CheckCircle, XCircle } from 'lucide-react';
import type { AuditResult } from '../../types';

interface CrawlStatusProps {
    results: AuditResult[];
}

export default function CrawlStatus({ results }: CrawlStatusProps) {
    return (
        <div className="bg-white p-6 border-2 border-black shadow-[8px_8px_0px_0px_#000] flex flex-col justify-between group hover:-translate-y-1 transition-transform h-full">
            <div>
                <div className="flex items-center justify-between mb-6">
                    <h3 className="text-black font-black uppercase tracking-wider text-xs bg-cyan-300 px-1 border border-black">Crawl Coverage</h3>
                    <div className="bg-black p-1.5 border border-black shadow-[2px_2px_0px_0px_rgba(0,0,0,0.2)]">
                        <Search className="w-3 h-3 text-white" />
                    </div>
                </div>

                <div className="space-y-3">
                    <div className="flex items-center justify-between p-3 bg-white border-2 border-black shadow-[2px_2px_0px_0px_#000] hover:translate-x-1 transition-transform">
                        <div className="flex items-center gap-3">
                            <div className="p-1.5 bg-green-200 border-2 border-black text-black"><CheckCircle className="w-4 h-4" /></div>
                            <div>
                                <div className="text-[10px] text-black font-black uppercase">Indexed</div>
                                <div className="text-xs text-slate-600 font-bold">Can search</div>
                            </div>
                        </div>
                        <div className="text-2xl font-black text-black">{results.filter(r => r.status === 'PASS').length}</div>
                    </div>

                    <div className="flex items-center justify-between p-3 bg-white border-2 border-black shadow-[2px_2px_0px_0px_#000] hover:translate-x-1 transition-transform">
                        <div className="flex items-center gap-3">
                            <div className="p-1.5 bg-red-200 border-2 border-black text-black"><XCircle className="w-4 h-4" /></div>
                            <div>
                                <div className="text-[10px] text-black font-black uppercase">Not Indexed</div>
                                <div className="text-xs text-slate-600 font-bold">Issues found</div>
                            </div>
                        </div>
                        <div className="text-2xl font-black text-black">{results.filter(r => r.status !== 'PASS').length}</div>
                    </div>
                </div>
            </div>

            <div className="mt-6 pt-3 border-t-2 border-black text-[10px] text-slate-500 font-bold uppercase text-center bg-slate-50 py-1.5 border-b-2">
                Total {results.length} URLs crawled
            </div>
        </div>
    );
}
