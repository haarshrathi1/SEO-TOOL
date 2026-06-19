import type { AuditResult } from '../../types';
import HealthGauge from '../dashboard/HealthGauge';
import CrawlStatus from '../dashboard/CrawlStatus';
import PerformanceSummary from '../dashboard/PerformanceSummary';

interface OverviewProps {
    results: AuditResult[];
    history?: { timestamp: string; results: AuditResult[] }[];
}

export default function AuditOverview({ results, history = [] }: OverviewProps) {
    return (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
            {/* Top ROW: Assessment Cards - Uniform Height */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-stretch">
                <div className="h-full">
                    <HealthGauge results={results} />
                </div>
                <div className="h-full">
                    <CrawlStatus results={results} />
                </div>
                <div className="h-full">
                    <PerformanceSummary results={results} history={history} />
                </div>
            </div>
        </div>
    );
}
