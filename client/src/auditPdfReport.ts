import { getTechnicalIssues } from './technicalIssues';
import { computeSeoScore } from './seoScore';
import type { AuditResult, TechnicalAuditIssue } from './types';

interface AuditPdfReportOptions {
    projectId: string;
    results: AuditResult[];
    snapshotLabel: string;
    baselineLabel?: string | null;
}

const SEVERITY_ORDER: Record<TechnicalAuditIssue['severity'], number> = {
    critical: 5,
    high: 4,
    medium: 3,
    low: 2,
    info: 1,
};

function escapeHtml(value: unknown) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function pct(value: number, total: number) {
    if (!total) return '0%';
    return `${Math.round((value / total) * 100)}%`;
}

function average(values: number[]) {
    if (!values.length) return 0;
    return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function getIssueRows(results: AuditResult[]) {
    return results
        .flatMap((result) => getTechnicalIssues(result, results).map((issue) => ({ result, issue })))
        .sort((left, right) => (
            (SEVERITY_ORDER[right.issue.severity] || 0) - (SEVERITY_ORDER[left.issue.severity] || 0)
            || left.issue.category.localeCompare(right.issue.category)
            || left.result.url.localeCompare(right.result.url)
        ));
}

function groupIssueCounts(issueRows: ReturnType<typeof getIssueRows>) {
    return issueRows.reduce((counts, row) => {
        counts[row.issue.severity] += 1;
        return counts;
    }, { critical: 0, high: 0, medium: 0, low: 0, info: 0 });
}

function topIssueTypes(issueRows: ReturnType<typeof getIssueRows>) {
    const map = new Map<string, { title: string; category: string; severity: TechnicalAuditIssue['severity']; count: number }>();
    issueRows.forEach(({ issue }) => {
        const key = `${issue.id}:${issue.title}`;
        const current = map.get(key) || { title: issue.title, category: issue.category, severity: issue.severity, count: 0 };
        current.count += 1;
        map.set(key, current);
    });
    return [...map.values()]
        .sort((left, right) => right.count - left.count || (SEVERITY_ORDER[right.severity] || 0) - (SEVERITY_ORDER[left.severity] || 0))
        .slice(0, 12);
}

function getPageLabel(url: string) {
    try {
        const parsed = new URL(url);
        return parsed.pathname === '/' ? parsed.hostname : parsed.pathname;
    } catch {
        return url;
    }
}

function renderMetric(label: string, value: string | number, detail: string) {
    return `
        <div class="metric">
            <div class="metric-label">${escapeHtml(label)}</div>
            <div class="metric-value">${escapeHtml(value)}</div>
            <div class="metric-detail">${escapeHtml(detail)}</div>
        </div>
    `;
}

function renderSeverityPill(severity: TechnicalAuditIssue['severity']) {
    return `<span class="pill pill-${escapeHtml(severity)}">${escapeHtml(severity)}</span>`;
}

function getReportGrade(score: number) {
    if (score >= 85) return { label: 'Strong', className: 'grade-strong', summary: 'The technical foundation is in good shape. Focus on refinement and compounding wins.' };
    if (score >= 70) return { label: 'Opportunity', className: 'grade-opportunity', summary: 'The site is functional, but the audit found issues that can limit rankings, crawl efficiency, or conversions.' };
    if (score >= 50) return { label: 'At Risk', className: 'grade-risk', summary: 'Technical quality is inconsistent. Prioritize crawlability, indexation, and page quality before scaling content.' };
    return { label: 'Critical', className: 'grade-critical', summary: 'The site has material technical risk. Fix critical blockers before investing heavily in growth campaigns.' };
}

function renderClimbSeoLogo(variant: 'dark' | 'light' = 'dark') {
    const bar = variant === 'light' ? '#ffffff' : '#0f172a';
    const word = variant === 'light' ? '#ffffff' : '#0f172a';
    const yellow = '#f59e0b';
    return `
        <div class="logo-mark">
            <svg viewBox="0 0 56 44" aria-hidden="true">
                <rect x="2" y="28" width="12" height="14" rx="1.5" fill="${bar}" />
                <rect x="17" y="18" width="12" height="24" rx="1.5" fill="${bar}" />
                <rect x="32" y="6" width="12" height="36" rx="1.5" fill="${bar}" />
                <line x1="4" y1="38" x2="50" y2="4" stroke="${yellow}" stroke-width="4" stroke-linecap="round" />
                <polygon points="50,2 39,7 45,15" fill="${yellow}" />
            </svg>
            <span><b style="color:${word}">CLIMB</b><b style="color:${yellow}">SEO</b></span>
        </div>
    `;
}

function renderScoreGauge(score: number) {
    const safeScore = Math.max(0, Math.min(100, score));
    const dash = Math.round((safeScore / 100) * 282);
    const stroke = safeScore >= 85 ? '#16a34a' : safeScore >= 70 ? '#2563eb' : safeScore >= 50 ? '#f59e0b' : '#dc2626';
    return `
        <div class="score-gauge">
            <svg viewBox="0 0 120 120">
                <circle cx="60" cy="60" r="45" fill="none" stroke="#e2e8f0" stroke-width="12" />
                <circle cx="60" cy="60" r="45" fill="none" stroke="${stroke}" stroke-width="12" stroke-linecap="round" stroke-dasharray="${dash} 282" transform="rotate(-90 60 60)" />
            </svg>
            <div class="score-center">
                <div>${safeScore}</div>
                <span>/100</span>
            </div>
        </div>
    `;
}

function renderSeverityStack(counts: ReturnType<typeof groupIssueCounts>) {
    const total = Math.max(1, counts.critical + counts.high + counts.medium + counts.low + counts.info);
    return `
        <div class="severity-stack">
            ${(['critical', 'high', 'medium', 'low', 'info'] as const).map((severity) => `
                <div class="severity-segment segment-${severity}" style="width:${Math.max(3, Math.round((counts[severity] / total) * 100))}%">
                    <span>${counts[severity]}</span>
                </div>
            `).join('')}
        </div>
        <div class="severity-legend">
            ${(['critical', 'high', 'medium', 'low', 'info'] as const).map((severity) => `
                <span><i class="dot dot-${severity}"></i>${severity}: ${counts[severity]}</span>
            `).join('')}
        </div>
    `;
}

function getCategoryCounts(issueRows: ReturnType<typeof getIssueRows>) {
    const map = new Map<string, number>();
    issueRows.forEach(({ issue }) => {
        map.set(issue.category, (map.get(issue.category) || 0) + 1);
    });
    return [...map.entries()]
        .map(([category, count]) => ({ category, count }))
        .sort((left, right) => right.count - left.count || left.category.localeCompare(right.category));
}

function renderCategoryBars(issueRows: ReturnType<typeof getIssueRows>) {
    const categories = getCategoryCounts(issueRows).slice(0, 8);
    const max = Math.max(1, ...categories.map((item) => item.count));
    return categories.map((item) => `
        <div class="bar-row">
            <div class="bar-label">${escapeHtml(item.category)}</div>
            <div class="bar-track"><div class="bar-fill" style="width:${Math.max(7, Math.round((item.count / max) * 100))}%"></div></div>
            <div class="bar-value">${item.count}</div>
        </div>
    `).join('');
}

function getRoadmap(issueRows: ReturnType<typeof getIssueRows>) {
    const has = (ids: string[]) => issueRows.some(({ issue }) => ids.includes(issue.id));
    return [
        {
            phase: 'First 7 Days',
            title: 'Remove technical blockers',
            items: [
                has(['http-4xx', 'http-5xx', 'content-unreachable']) ? 'Resolve pages returning HTTP errors or unreadable rendered content.' : 'Confirm all high-value URLs resolve cleanly and render body content.',
                has(['not-indexed', 'robots-blocked', 'meta-noindex']) ? 'Fix blocked, noindex, or excluded URLs that should rank.' : 'Review excluded URLs and keep intentional exclusions documented.',
                has(['broken-link']) ? 'Repair broken internal and external links found during the crawl.' : 'Keep link checks in the recurring audit cadence.',
            ],
        },
        {
            phase: 'Next 30 Days',
            title: 'Strengthen search signals',
            items: [
                has(['missing-title', 'duplicate-title', 'long-title', 'short-title']) ? 'Rewrite weak, duplicate, missing, or overlong titles.' : 'Tune titles for CTR and query intent on priority pages.',
                has(['missing-desc', 'duplicate-desc', 'long-desc', 'short-desc']) ? 'Create unique meta descriptions for pages with weak snippets.' : 'Refresh descriptions where commercial intent is strongest.',
                has(['missing-canonical', 'canonical-mismatch', 'cross-domain-canonical', 'canonical-loop']) ? 'Normalize canonical tags and redirecting canonical targets.' : 'Audit canonical strategy for templates and parameter URLs.',
            ],
        },
        {
            phase: 'Next 60-90 Days',
            title: 'Scale performance and authority',
            items: [
                has(['slow-mobile', 'slow-desktop']) ? 'Improve PageSpeed and Core Web Vitals on sampled slow pages.' : 'Monitor Core Web Vitals on new templates and important pages.',
                has(['schema-errors', 'schema-warnings']) ? 'Fix structured data errors and expand rich-result eligible markup.' : 'Add schema where it can improve result appearance.',
                has(['indexed-orphan', 'high-value-underlinked']) ? 'Build internal links into indexed orphan and high-value underlinked pages.' : 'Use internal links to push authority toward conversion pages.',
            ],
        },
    ];
}

function renderRoadmap(issueRows: ReturnType<typeof getIssueRows>) {
    return getRoadmap(issueRows).map((phase, index) => `
        <div class="roadmap-card">
            <div class="roadmap-index">${index + 1}</div>
            <div>
                <div class="roadmap-phase">${escapeHtml(phase.phase)}</div>
                <h3>${escapeHtml(phase.title)}</h3>
                <ul>${phase.items.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>
            </div>
        </div>
    `).join('');
}

function getExecutiveDiagnosis(avgScore: number, severityCounts: ReturnType<typeof groupIssueCounts>, results: AuditResult[]) {
    const grade = getReportGrade(avgScore);
    const highRisk = severityCounts.critical + severityCounts.high;
    const notIndexed = results.filter((result) => result.status !== 'PASS').length;
    const copy = [
        grade.summary,
        highRisk > 0
            ? `${highRisk} critical or high-priority issue${highRisk === 1 ? '' : 's'} should be handled before the next content or link-building push.`
            : 'No critical/high blockers were detected in the normalized issue queue.',
        notIndexed > 0
            ? `${notIndexed} page${notIndexed === 1 ? '' : 's'} need indexation review, including pages excluded by Google or blocked by technical signals.`
            : 'All audited pages are currently passing the primary indexation checks.',
    ];
    return copy.join(' ');
}

function renderImpactCard(label: string, count: number, detail: string, className = '') {
    return `
        <div class="impact-card ${className}">
            <span>${escapeHtml(label)}</span>
            <strong>${escapeHtml(count)}</strong>
            <p>${escapeHtml(detail)}</p>
        </div>
    `;
}

function buildAuditReportHtml(options: AuditPdfReportOptions) {
    const { projectId, results, snapshotLabel, baselineLabel } = options;
    const issueRows = getIssueRows(results);
    const severityCounts = groupIssueCounts(issueRows);
    const scores = results.map(computeSeoScore);
    const avgScore = average(scores.map((score) => score.total));
    const indexedCount = results.filter((result) => result.status === 'PASS').length;
    const httpErrorCount = results.filter((result) => (result.httpStatus || 0) >= 400).length;
    const canonicalIssueCount = results.filter((result) => (result.canonicalIssues || []).length > 0).length;
    const schemaIssueCount = results.filter((result) => (
        (result.structuredData?.parseErrors || []).length > 0
        || (result.structuredData?.issues || []).length > 0
    )).length;
    const pagesWithPsi = results.filter((result) => typeof result.psi_data?.desktop?.score === 'number' || typeof result.psi_data?.mobile?.score === 'number');
    const avgDesktopPsi = average(results.map((result) => result.psi_data?.desktop?.score || 0).filter(Boolean));
    const avgMobilePsi = average(results.map((result) => result.psi_data?.mobile?.score || 0).filter(Boolean));
    const generatedAt = new Date().toLocaleString();
    const grade = getReportGrade(avgScore);
    const diagnosis = getExecutiveDiagnosis(avgScore, severityCounts, results);
    const topPages = results
        .map((result) => ({
            result,
            score: computeSeoScore(result),
            issues: getTechnicalIssues(result, results),
        }))
        .sort((left, right) => (
            (SEVERITY_ORDER[right.issues[0]?.severity || 'info'] || 0) - (SEVERITY_ORDER[left.issues[0]?.severity || 'info'] || 0)
            || left.score.total - right.score.total
        ))
        .slice(0, 30);

    const issueTypeRows = topIssueTypes(issueRows).map((issue) => `
        <tr>
            <td>${renderSeverityPill(issue.severity)}</td>
            <td><strong>${escapeHtml(issue.title)}</strong><br><span>${escapeHtml(issue.category)}</span></td>
            <td class="num">${issue.count}</td>
        </tr>
    `).join('');

    const priorityRows = issueRows.slice(0, 45).map(({ result, issue }) => `
        <tr>
            <td>${renderSeverityPill(issue.severity)}</td>
            <td>
                <strong>${escapeHtml(issue.title)}</strong>
                <div class="muted">${escapeHtml(issue.details || issue.category)}</div>
            </td>
            <td>
                <a href="${escapeHtml(result.url)}">${escapeHtml(getPageLabel(result.url))}</a>
                <div class="muted mono">${escapeHtml(result.url)}</div>
            </td>
        </tr>
    `).join('');

    const pageRows = topPages.map(({ result, score, issues }) => `
        <tr>
            <td>
                <a href="${escapeHtml(result.url)}">${escapeHtml(getPageLabel(result.url))}</a>
                <div class="muted mono">${escapeHtml(result.url)}</div>
            </td>
            <td class="num">${score.total}</td>
            <td>${escapeHtml(result.status)}</td>
            <td class="num">${escapeHtml(result.psi_data?.mobile?.score ?? '-')}</td>
            <td class="num">${escapeHtml(result.psi_data?.desktop?.score ?? '-')}</td>
            <td class="num">${issues.length}</td>
        </tr>
    `).join('');

    const quickWinRows = issueRows
        .filter(({ issue }) => ['metadata', 'content', 'links', 'structured-data'].includes(issue.category))
        .slice(0, 18)
        .map(({ result, issue }) => `
            <tr>
                <td>${renderSeverityPill(issue.severity)}</td>
                <td><strong>${escapeHtml(issue.title)}</strong><div class="muted">${escapeHtml(issue.details || issue.category)}</div></td>
                <td><a href="${escapeHtml(result.url)}">${escapeHtml(getPageLabel(result.url))}</a></td>
                <td><span class="effort">Low-Med</span></td>
            </tr>
        `).join('');

    return `<!doctype html>
<html>
<head>
    <meta charset="utf-8" />
    <title>Deep Technical Audit - ${escapeHtml(projectId)}</title>
    <style>
        @page { size: A4; margin: 12mm; }
        * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        body { margin: 0; color: #0f172a; background: #fff; font-family: Inter, Arial, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; line-height: 1.45; }
        a { color: #1d4ed8; text-decoration: none; }
        p { margin: 0; }
        .cover { min-height: 242mm; display: flex; flex-direction: column; justify-content: space-between; padding: 6mm 0 0; position: relative; overflow: hidden; }
        .cover:before { content: ""; position: absolute; top: 0; right: 0; width: 44mm; height: 100%; background: #f8fafc; border-left: 1px solid #dbe3ef; z-index: 0; }
        .cover:after { content: ""; position: absolute; left: 0; right: 52mm; bottom: 0; height: 2mm; background: #f59e0b; z-index: 0; }
        .cover > * { position: relative; z-index: 1; }
        .brand { display: flex; justify-content: space-between; align-items: flex-start; gap: 10mm; }
        .logo-mark { display: inline-flex; align-items: center; gap: 3mm; font-weight: 900; font-size: 20px; line-height: 1; }
        .logo-mark svg { width: 19mm; height: auto; }
        .meta-box { border: 1px solid #dbe3ef; background: #ffffff; border-radius: 6px; padding: 4mm; color: #475569; font-size: 10px; text-align: right; min-width: 62mm; box-shadow: 0 4px 14px rgba(15, 23, 42, 0.08); }
        .meta-box strong { color: #0f172a; }
        .eyebrow { display: inline-flex; align-items: center; gap: 2mm; border: 1px solid #f2c94c; background: #fff7d6; color: #92400e; border-radius: 999px; padding: 1.4mm 3mm; font-size: 8px; font-weight: 900; letter-spacing: 0.14em; text-transform: uppercase; }
        h1 { margin: 24mm 0 5mm; max-width: 166mm; font-size: 45px; line-height: 1.02; letter-spacing: 0; color: #0f172a; }
        .subtitle { max-width: 142mm; font-size: 15px; font-weight: 650; color: #475569; }
        .cover-main { display: grid; grid-template-columns: 1.15fr 0.85fr; gap: 7mm; align-items: stretch; margin-top: 16mm; }
        .score-panel { border: 1px solid #dbe3ef; background: #ffffff; border-radius: 8px; padding: 6mm; box-shadow: 0 10px 30px rgba(15, 23, 42, 0.10); }
        .grade { display: inline-block; border-radius: 999px; padding: 1.1mm 3mm; text-transform: uppercase; font-weight: 900; font-size: 9px; letter-spacing: 0.08em; }
        .grade-strong { background: #dcfce7; color: #166534; }
        .grade-opportunity { background: #dbeafe; color: #1d4ed8; }
        .grade-risk { background: #ffedd5; color: #9a3412; }
        .grade-critical { background: #fee2e2; color: #991b1b; }
        .score-gauge { position: relative; width: 44mm; height: 44mm; margin: 1mm auto 4mm; }
        .score-gauge svg { width: 100%; height: 100%; }
        .score-center { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; }
        .score-center div { font-size: 29px; font-weight: 950; line-height: 1; color: #0f172a; }
        .score-center span { font-size: 9px; font-weight: 850; color: #64748b; }
        .cover-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 4mm; }
        .metric { border: 1px solid #dbe3ef; background: #ffffff; border-radius: 7px; padding: 4mm; min-height: 25mm; break-inside: avoid; box-shadow: 0 5px 15px rgba(15, 23, 42, 0.06); }
        .metric-label { font-size: 7.5px; font-weight: 900; letter-spacing: 0.12em; text-transform: uppercase; color: #64748b; }
        .metric-value { margin-top: 2mm; font-size: 24px; line-height: 1; font-weight: 950; color: #0f172a; }
        .metric-detail { margin-top: 2mm; font-size: 8.8px; font-weight: 650; color: #64748b; }
        .section { break-before: page; padding-top: 2mm; }
        .section-title { position: relative; display: flex; align-items: flex-end; justify-content: space-between; gap: 5mm; margin-bottom: 5mm; border-bottom: 1px solid #dbe3ef; padding-bottom: 3mm; }
        .section-title:before { content: ""; display: block; width: 10mm; height: 1.2mm; background: #f59e0b; position: absolute; margin-top: 12mm; }
        h2 { margin: 0; font-size: 24px; line-height: 1.08; color: #0f172a; letter-spacing: 0; }
        h3 { margin: 0 0 3mm; font-size: 13px; color: #0f172a; }
        .kicker { display: inline-block; border: 1px solid #dbeafe; background: #eff6ff; color: #1d4ed8; border-radius: 999px; padding: 1mm 2.4mm; font-size: 7.5px; font-weight: 900; letter-spacing: 0.12em; text-transform: uppercase; }
        .summary-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 4mm; margin-bottom: 7mm; }
        .note { border-left: 1.2mm solid #f59e0b; background: #fffbeb; border-radius: 6px; padding: 4mm; color: #334155; font-size: 11px; font-weight: 650; margin: 5mm 0 7mm; }
        .diagnosis { display: grid; grid-template-columns: 1.35fr 0.65fr; gap: 5mm; margin-bottom: 7mm; }
        .diagnosis-copy { border: 1px solid #dbe3ef; border-radius: 8px; padding: 5mm; background: #fff; box-shadow: 0 6px 18px rgba(15, 23, 42, 0.06); font-size: 11.5px; color: #334155; }
        .impact-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 3mm; }
        .impact-card { border: 1px solid #dbe3ef; border-radius: 7px; padding: 3.2mm; background: #fff; break-inside: avoid; }
        .impact-card.hot { background: #fee2e2; }
        .impact-card.warm { background: #fef3c7; }
        .impact-card.cool { background: #dbeafe; }
        .impact-card span { display:block; font-size: 8px; font-weight: 900; text-transform: uppercase; letter-spacing: .12em; color: #475569; }
        .impact-card strong { display:block; margin-top: 1mm; font-size: 21px; line-height: 1; color: #0f172a; }
        .impact-card p { margin: 1mm 0 0; font-size: 8.8px; font-weight: 650; color: #475569; }
        table { width: 100%; border-collapse: collapse; break-inside: auto; font-size: 10px; }
        th { text-align: left; background: #0f172a; color: #fff; font-size: 7.5px; letter-spacing: 0.11em; text-transform: uppercase; border: 1px solid #0f172a; padding: 2.2mm; }
        td { border: 1px solid #dbe3ef; padding: 2.4mm; vertical-align: top; background: #fff; }
        tbody tr:nth-child(even) td { background: #f8fafc; }
        tr { break-inside: avoid; }
        .num { text-align: right; font-variant-numeric: tabular-nums; }
        .muted { margin-top: 1mm; color: #64748b; font-size: 9px; }
        .mono { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; word-break: break-all; }
        .pill { display: inline-block; min-width: 17mm; border-radius: 999px; padding: 0.8mm 1.8mm; text-align: center; font-size: 7px; font-weight: 900; text-transform: uppercase; letter-spacing: 0.05em; }
        .pill-critical { background: #991b1b; color: #fff; }
        .pill-high { background: #fee2e2; color: #991b1b; }
        .pill-medium { background: #fef3c7; color: #92400e; }
        .pill-low { background: #dbeafe; color: #1e40af; }
        .pill-info { background: #e2e8f0; color: #334155; }
        .severity-stack { display: flex; height: 10mm; border-radius: 999px; background: #e2e8f0; overflow: hidden; }
        .severity-segment { display: flex; align-items: center; justify-content: center; font-size: 7.5px; font-weight: 950; color: #0f172a; border-right: 1px solid rgba(255,255,255,0.82); }
        .severity-segment:last-child { border-right: 0; }
        .segment-critical { background: #991b1b; color: #fff; }
        .segment-high { background: #ef4444; color: #fff; }
        .segment-medium { background: #f59e0b; }
        .segment-low { background: #60a5fa; color: #082f49; }
        .segment-info { background: #cbd5e1; }
        .severity-legend { display: flex; flex-wrap: wrap; gap: 2mm 4mm; margin-top: 3mm; font-size: 8.5px; font-weight: 750; text-transform: uppercase; }
        .dot { display: inline-block; width: 2.4mm; height: 2.4mm; border-radius: 999px; margin-right: 1mm; vertical-align: -0.35mm; }
        .dot-critical { background: #991b1b; }
        .dot-high { background: #ef4444; }
        .dot-medium { background: #f59e0b; }
        .dot-low { background: #60a5fa; }
        .dot-info { background: #cbd5e1; }
        .bar-row { display: grid; grid-template-columns: 31mm 1fr 10mm; gap: 2mm; align-items: center; margin-bottom: 2mm; font-size: 9px; font-weight: 800; text-transform: uppercase; }
        .bar-track { height: 5mm; border-radius: 999px; background: #e2e8f0; overflow: hidden; }
        .bar-fill { height: 100%; background: #2563eb; border-radius: 999px; }
        .bar-value { text-align: right; font-weight: 950; }
        .two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 6mm; align-items: start; }
        .panel { border: 1px solid #dbe3ef; border-radius: 8px; background: #fff; padding: 5mm; box-shadow: 0 6px 18px rgba(15, 23, 42, 0.06); break-inside: avoid; }
        .roadmap { display: grid; grid-template-columns: 1fr; gap: 4mm; }
        .roadmap-card { display: grid; grid-template-columns: 13mm 1fr; gap: 4mm; border: 1px solid #dbe3ef; border-radius: 8px; background: #fff; padding: 4mm; box-shadow: 0 6px 18px rgba(15, 23, 42, 0.06); break-inside: avoid; }
        .roadmap-index { width: 10mm; height: 10mm; display: flex; align-items: center; justify-content: center; border-radius: 999px; background: #0f172a; color: #fff; font-weight: 950; }
        .roadmap-phase { display: inline-block; margin-bottom: 1.5mm; font-size: 8px; font-weight: 950; letter-spacing: .14em; text-transform: uppercase; color: #64748b; }
        ul { margin: 0; padding-left: 4mm; }
        li { margin: 1.3mm 0; font-size: 10px; color: #334155; }
        .effort { display: inline-block; border-radius: 999px; background: #dcfce7; color: #166534; padding: 0.8mm 1.8mm; font-size: 7.8px; font-weight: 900; text-transform: uppercase; }
        .footer { margin-top: 8mm; border-top: 1px solid #dbe3ef; padding-top: 3mm; color: #64748b; font-size: 9px; font-weight: 700; display: flex; justify-content: space-between; }
        @media screen {
            body { background: #e5e7eb; padding: 24px; }
            .paper { width: 210mm; margin: 0 auto; background: #fff; padding: 12mm; box-shadow: 0 20px 45px rgba(15, 23, 42, 0.18); }
        }
        @media print {
            .paper { padding: 0; }
            .no-print { display: none; }
        }
    </style>
</head>
<body>
    <div class="paper">
        <section class="cover">
            <div>
                <div class="brand">
                    <div>
                        ${renderClimbSeoLogo('dark')}
                        <div style="margin-top:5mm">${'<span class="eyebrow">Agency Technical Audit</span>'}</div>
                    </div>
                    <div class="meta-box">
                        Project: <strong>${escapeHtml(projectId)}</strong><br>
                        Snapshot: ${escapeHtml(snapshotLabel)}<br>
                        ${baselineLabel ? `Baseline: ${escapeHtml(baselineLabel)}<br>` : ''}
                        Generated: ${escapeHtml(generatedAt)}
                    </div>
                </div>
                <h1>Deep Technical SEO Audit</h1>
                <p class="subtitle">A client-ready technical diagnosis built from rendered crawl data, Google index signals, PageSpeed samples, structured data validation, canonical logic, and internal link analysis.</p>
                <div class="cover-main">
                    <div class="cover-grid">
                        ${renderMetric('Audited Pages', results.length, 'URLs in scope')}
                        ${renderMetric('Indexed Pages', indexedCount, `${pct(indexedCount, results.length)} passing index checks`)}
                        ${renderMetric('Open Issues', issueRows.length, `${severityCounts.critical + severityCounts.high} critical/high`)}
                        ${renderMetric('PSI Sample', pagesWithPsi.length, 'Pages with speed data')}
                    </div>
                    <div class="score-panel">
                        ${renderScoreGauge(avgScore)}
                        <div style="text-align:center">${`<span class="grade ${grade.className}">${escapeHtml(grade.label)}</span>`}</div>
                        <p style="margin:4mm 0 0;text-align:center;font-size:11px;font-weight:700;color:#475569">Average technical SEO score</p>
                    </div>
                </div>
            </div>
            <div class="footer">
                <span>ClimbSEO technical intelligence</span>
                <span>${escapeHtml(projectId)}</span>
            </div>
        </section>

        <section class="section">
            <div class="section-title">
                <h2>Executive Diagnosis</h2>
                <span class="kicker">${escapeHtml(grade.label)} foundation</span>
            </div>
            <div class="diagnosis">
                <div class="diagnosis-copy">
                    <h3>What this means for the client</h3>
                    <p>${escapeHtml(diagnosis)}</p>
                    <div class="note">The recommended fix order is crawlability and indexation first, then metadata and canonical clarity, then performance and internal authority improvements.</div>
                    ${renderSeverityStack(severityCounts)}
                </div>
                <div class="impact-grid">
                    ${renderImpactCard('Critical', severityCounts.critical, 'Immediate risk', 'hot')}
                    ${renderImpactCard('High', severityCounts.high, 'Near-term priority', 'warm')}
                    ${renderImpactCard('HTTP Errors', httpErrorCount, 'Bad responses', 'hot')}
                    ${renderImpactCard('Not Indexed', results.filter((result) => result.status !== 'PASS').length, 'Index review', 'cool')}
                </div>
            </div>
            <div class="summary-grid">
                ${renderMetric('Canonical Issues', canonicalIssueCount, 'Pages with canonical warnings')}
                ${renderMetric('Schema Issues', schemaIssueCount, 'Structured data warnings/errors')}
                ${renderMetric('Avg Mobile PSI', avgMobilePsi || '-', 'Sampled PageSpeed score')}
                ${renderMetric('Avg Desktop PSI', avgDesktopPsi || '-', 'Sampled PageSpeed score')}
                ${renderMetric('Indexed Coverage', pct(indexedCount, results.length), `${indexedCount}/${results.length} URLs passing`)}
                ${renderMetric('Avg SEO Score', `${avgScore}/100`, 'Weighted page score')}
            </div>
        </section>

        <section class="section">
            <div class="section-title">
                <h2>Issue Landscape</h2>
                <span class="kicker">Where the risk lives</span>
            </div>
            <div class="two-col">
                <div class="panel">
                    <h3>Top Issue Types</h3>
                    <table>
                        <thead><tr><th>Severity</th><th>Issue</th><th class="num">Pages</th></tr></thead>
                        <tbody>${issueTypeRows || '<tr><td colspan="3">No technical issues detected.</td></tr>'}</tbody>
                    </table>
                </div>
                <div class="panel">
                    <h3>Issue Categories</h3>
                    ${renderCategoryBars(issueRows) || '<p class="muted">No category issues detected.</p>'}
                </div>
            </div>
        </section>

        <section class="section">
            <div class="section-title">
                <h2>90-Day Technical Roadmap</h2>
                <span class="kicker">Client action plan</span>
            </div>
            <div class="roadmap">${renderRoadmap(issueRows)}</div>
            <h3 style="margin-top:7mm">Quick-Win Fix Queue</h3>
            <table>
                <thead><tr><th>Severity</th><th>Fix</th><th>Page</th><th>Effort</th></tr></thead>
                <tbody>${quickWinRows || '<tr><td colspan="4">No quick-win fixes detected.</td></tr>'}</tbody>
            </table>
        </section>

        <section class="section">
            <div class="section-title">
                <h2>Priority Fix Queue</h2>
                <span class="kicker">Sorted by risk</span>
            </div>
            <table>
                <thead><tr><th>Severity</th><th>Issue</th><th>Page</th></tr></thead>
                <tbody>${priorityRows || '<tr><td colspan="3">No priority fixes detected.</td></tr>'}</tbody>
            </table>
        </section>

        <section class="section">
            <div class="section-title">
                <h2>Page-Level Audit Table</h2>
                <span class="kicker">Appendix</span>
            </div>
            <table>
                <thead>
                    <tr>
                        <th>Page</th>
                        <th class="num">SEO</th>
                        <th>Index</th>
                        <th class="num">Mobile PSI</th>
                        <th class="num">Desktop PSI</th>
                        <th class="num">Issues</th>
                    </tr>
                </thead>
                <tbody>${pageRows || '<tr><td colspan="6">No pages available.</td></tr>'}</tbody>
            </table>
        </section>
    </div>
</body>
</html>`;
}

export function printAuditPdfReport(options: AuditPdfReportOptions) {
    if (!options.results.length) {
        return false;
    }

    const existingFrame = document.getElementById('audit-pdf-print-frame');
    existingFrame?.remove();

    const frame = document.createElement('iframe');
    frame.id = 'audit-pdf-print-frame';
    frame.title = 'Audit PDF report';
    frame.style.position = 'fixed';
    frame.style.right = '0';
    frame.style.bottom = '0';
    frame.style.width = '0';
    frame.style.height = '0';
    frame.style.border = '0';
    frame.style.visibility = 'hidden';
    document.body.appendChild(frame);

    const reportDocument = frame.contentDocument || frame.contentWindow?.document;
    if (!reportDocument || !frame.contentWindow) {
        frame.remove();
        return false;
    }

    reportDocument.open();
    reportDocument.write(buildAuditReportHtml(options));
    reportDocument.close();

    const printFrame = () => {
        frame.contentWindow?.focus();
        frame.contentWindow?.print();
        window.setTimeout(() => frame.remove(), 60_000);
    };

    if (reportDocument.readyState === 'complete') {
        window.setTimeout(printFrame, 100);
    } else {
        frame.onload = () => window.setTimeout(printFrame, 100);
    }

    return true;
}
