import type { KeywordDataV2, StrategicCluster } from './types';

function escapeHtml(value: unknown) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function renderClimbSeoLogo(variant: 'dark' | 'light' = 'dark') {
    const bar = variant === 'light' ? '#ffffff' : '#0f172a';
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
            <span><b style="color:${bar}">CLIMB</b><b style="color:${yellow}">SEO</b></span>
        </div>
    `;
}

function renderDifficultyGauge(score: number) {
    const safe = Math.max(0, Math.min(100, score));
    const dash = Math.round((safe / 100) * 282);
    const stroke = safe <= 35 ? '#16a34a' : safe <= 60 ? '#f59e0b' : '#dc2626';
    return `
        <div class="score-gauge">
            <svg viewBox="0 0 120 120">
                <circle cx="60" cy="60" r="45" fill="none" stroke="#e2e8f0" stroke-width="12" />
                <circle cx="60" cy="60" r="45" fill="none" stroke="${stroke}" stroke-width="12" stroke-linecap="round" stroke-dasharray="${dash} 282" transform="rotate(-90 60 60)" />
            </svg>
            <div class="score-center">
                <div>${safe}</div>
                <span>/100</span>
            </div>
        </div>
    `;
}

function priorityColor(priority: StrategicCluster['priority']) {
    const map: Record<string, string> = { P0: '#991b1b', P1: '#92400e', P2: '#1e40af', P3: '#374151' };
    return map[priority] || '#374151';
}

function priorityBg(priority: StrategicCluster['priority']) {
    const map: Record<string, string> = { P0: '#fee2e2', P1: '#fef3c7', P2: '#dbeafe', P3: '#f1f5f9' };
    return map[priority] || '#f1f5f9';
}

function renderVolPill(vol: string) {
    const colors: Record<string, string> = { High: 'pill-vol-high', Medium: 'pill-vol-med', Low: 'pill-vol-low' };
    return `<span class="pill ${colors[vol] || 'pill-vol-low'}">${escapeHtml(vol)}</span>`;
}

function renderDiffPill(diff: string) {
    const colors: Record<string, string> = { Easy: 'pill-diff-easy', Medium: 'pill-diff-med', Hard: 'pill-diff-hard' };
    return `<span class="pill ${colors[diff] || 'pill-diff-med'}">${escapeHtml(diff)}</span>`;
}

function renderIntentPill(intent: string) {
    return `<span class="pill pill-intent">${escapeHtml(intent)}</span>`;
}

function renderMetricBox(label: string, value: string | number, detail: string) {
    return `
        <div class="metric">
            <div class="metric-label">${escapeHtml(label)}</div>
            <div class="metric-value">${escapeHtml(value)}</div>
            <div class="metric-detail">${escapeHtml(detail)}</div>
        </div>
    `;
}

function buildKeywordReportHtml(data: KeywordDataV2): string {
    const { seed, keywordUniverse, strategy, serpRaw, serp } = data;
    const generatedAt = new Date().toLocaleString();
    const totalKeywords = keywordUniverse?.totalKeywords ?? keywordUniverse?.keywords?.length ?? 0;
    const clusters = strategy?.clusters ?? [];
    const quickWins = strategy?.quickWins ?? [];
    const blueprint = strategy?.contentBlueprint;
    const difficulty = strategy?.difficulty;
    const viability = strategy?.viability;
    const alternativeStrategy = strategy?.alternativeStrategy;
    const executionPriority = strategy?.executionPriority ?? [];
    const contentGap = strategy?.contentGap ?? '';
    const topKeywords = (keywordUniverse?.keywords ?? []).slice(0, 50);
    const questionKeywords = (keywordUniverse?.questionKeywords ?? []).slice(0, 20);
    const longTailGems = (keywordUniverse?.longTailGems ?? []).slice(0, 15);
    const lsiTerms = (keywordUniverse?.lsiTerms ?? []).slice(0, 20);
    const paaQuestions = (serpRaw?.paaQuestions ?? []).slice(0, 12);
    const relatedSearches = (serpRaw?.relatedSearches ?? []).slice(0, 12);
    const serpFeatures = serpRaw?.serpFeatures ?? [];
    const kg = serpRaw?.knowledgeGraph;
    const diffScore = difficulty?.score ?? 0;

    const clusterRows = clusters.map((cluster) => `
        <div class="cluster-card" style="border-left-color:${priorityColor(cluster.priority)}">
            <div class="cluster-header">
                <span class="priority-badge" style="background:${priorityBg(cluster.priority)};color:${priorityColor(cluster.priority)}">${escapeHtml(cluster.priority)}</span>
                <strong class="cluster-name">${escapeHtml(cluster.name)}</strong>
                <span class="cluster-meta">${escapeHtml(cluster.intent)} &middot; ${escapeHtml(cluster.contentFormat)} &middot; Traffic: ${escapeHtml(cluster.estimatedTraffic)}</span>
            </div>
            <div class="cluster-keywords">
                ${cluster.keywords.slice(0, 6).map((kw) => `
                    <span class="cluster-kw">
                        ${escapeHtml(kw.term)}
                        <span class="kw-score">${kw.opportunityScore}</span>
                    </span>
                `).join('')}
                ${cluster.keywords.length > 6 ? `<span class="cluster-kw-more">+${cluster.keywords.length - 6} more</span>` : ''}
            </div>
        </div>
    `).join('');

    const quickWinRows = quickWins.map((qw) => `
        <tr>
            <td><strong>${escapeHtml(qw.keyword)}</strong></td>
            <td>${escapeHtml(qw.reason)}</td>
            <td>${escapeHtml(qw.action)}</td>
            <td><span class="effort">${escapeHtml(qw.timeToRank)}</span></td>
        </tr>
    `).join('');

    const keywordTableRows = topKeywords.map((kw) => `
        <tr>
            <td><strong>${escapeHtml(kw.term)}</strong></td>
            <td>${renderIntentPill(kw.intent)}</td>
            <td>${renderVolPill(kw.volume)}</td>
            <td>${renderDiffPill(kw.difficulty)}</td>
            <td class="num">${kw.opportunityScore}</td>
            <td>${escapeHtml(kw.buyerStage ?? '')}</td>
            ${kw.adsMetrics?.searchVolume != null ? `<td class="num">${kw.adsMetrics.searchVolume.toLocaleString()}</td>` : '<td class="num muted">—</td>'}
            ${kw.adsMetrics?.cpc != null ? `<td class="num">$${kw.adsMetrics.cpc.toFixed(2)}</td>` : '<td class="num muted">—</td>'}
        </tr>
    `).join('');

    const serpRows = serp.slice(0, 10).map((result, i) => `
        <tr>
            <td class="num">${i + 1}</td>
            <td>
                <strong>${escapeHtml(result.title)}</strong>
                <div class="muted mono">${escapeHtml(result.url)}</div>
                ${result.snippet ? `<div class="muted" style="margin-top:1mm">${escapeHtml(result.snippet.slice(0, 150))}${result.snippet.length > 150 ? '…' : ''}</div>` : ''}
            </td>
        </tr>
    `).join('');

    const viabilityCards = viability ? [
        { key: 'soloCreator', label: 'Solo Creator', data: viability.soloCreator },
        { key: 'smallBusiness', label: 'Small Business', data: viability.smallBusiness },
        { key: 'brand', label: 'Brand', data: viability.brand },
    ].map(({ label, data }) => {
        const verdict = data?.verdict ?? '';
        const isGreen = /yes|viable|good|strong|high/i.test(verdict);
        const isRed = /no|avoid|hard|low|poor/i.test(verdict);
        const cls = isGreen ? 'viab-yes' : isRed ? 'viab-no' : 'viab-mid';
        return `
            <div class="viab-card ${cls}">
                <div class="viab-label">${escapeHtml(label)}</div>
                <div class="viab-verdict">${escapeHtml(verdict)}</div>
                <div class="viab-reason">${escapeHtml(data?.reason ?? '')}</div>
            </div>
        `;
    }).join('') : '';

    return `<!doctype html>
<html>
<head>
    <meta charset="utf-8" />
    <title>Keyword Research Report — ${escapeHtml(seed)}</title>
    <style>
        @page { size: A4; margin: 12mm; }
        * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        body { margin: 0; color: #0f172a; background: #fff; font-family: Inter, Arial, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; line-height: 1.45; }
        a { color: #1d4ed8; text-decoration: none; }
        p { margin: 0; }

        /* Cover */
        .cover { min-height: 242mm; display: flex; flex-direction: column; justify-content: space-between; padding: 6mm 0 0; position: relative; overflow: hidden; }
        .cover:before { content: ""; position: absolute; top: 0; right: 0; width: 44mm; height: 100%; background: #f8fafc; border-left: 1px solid #dbe3ef; z-index: 0; }
        .cover:after { content: ""; position: absolute; left: 0; right: 52mm; bottom: 0; height: 2mm; background: #f59e0b; z-index: 0; }
        .cover > * { position: relative; z-index: 1; }
        .brand { display: flex; justify-content: space-between; align-items: flex-start; gap: 10mm; }
        .logo-mark { display: inline-flex; align-items: center; gap: 3mm; font-weight: 900; font-size: 20px; line-height: 1; }
        .logo-mark svg { width: 19mm; height: auto; }
        .meta-box { border: 1px solid #dbe3ef; background: #fff; border-radius: 6px; padding: 4mm; color: #475569; font-size: 10px; text-align: right; min-width: 62mm; box-shadow: 0 4px 14px rgba(15,23,42,0.08); }
        .meta-box strong { color: #0f172a; }
        .eyebrow { display: inline-flex; align-items: center; gap: 2mm; border: 1px solid #f2c94c; background: #fff7d6; color: #92400e; border-radius: 999px; padding: 1.4mm 3mm; font-size: 8px; font-weight: 900; letter-spacing: 0.14em; text-transform: uppercase; }
        h1 { margin: 14mm 0 4mm; max-width: 156mm; font-size: 38px; line-height: 1.05; color: #0f172a; }
        .seed-pill { display: inline-block; background: #fef3c7; border: 1px solid #f59e0b; color: #92400e; border-radius: 999px; padding: 1.5mm 4mm; font-size: 12px; font-weight: 900; letter-spacing: 0.06em; margin-bottom: 5mm; }
        .subtitle { max-width: 142mm; font-size: 13px; font-weight: 650; color: #475569; }

        /* Cover main grid */
        .cover-main { display: grid; grid-template-columns: 1.2fr 0.8fr; gap: 7mm; align-items: stretch; margin-top: 12mm; }
        .cover-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 4mm; }
        .metric { border: 1px solid #dbe3ef; background: #fff; border-radius: 7px; padding: 4mm; min-height: 22mm; break-inside: avoid; box-shadow: 0 5px 15px rgba(15,23,42,0.06); }
        .metric-label { font-size: 7.5px; font-weight: 900; letter-spacing: 0.12em; text-transform: uppercase; color: #64748b; }
        .metric-value { margin-top: 2mm; font-size: 24px; line-height: 1; font-weight: 950; color: #0f172a; }
        .metric-detail { margin-top: 2mm; font-size: 8.5px; font-weight: 650; color: #64748b; }
        .score-panel { border: 1px solid #dbe3ef; background: #fff; border-radius: 8px; padding: 5mm; box-shadow: 0 10px 30px rgba(15,23,42,0.10); }
        .score-gauge { position: relative; width: 44mm; height: 44mm; margin: 1mm auto 3mm; }
        .score-gauge svg { width: 100%; height: 100%; }
        .score-center { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; }
        .score-center div { font-size: 28px; font-weight: 950; line-height: 1; color: #0f172a; }
        .score-center span { font-size: 9px; font-weight: 850; color: #64748b; }

        /* Viability */
        .viab-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 3mm; margin: 5mm 0 0; }
        .viab-card { border: 1px solid #dbe3ef; border-radius: 7px; padding: 3.5mm; break-inside: avoid; }
        .viab-yes { background: #f0fdf4; border-color: #86efac; }
        .viab-no { background: #fef2f2; border-color: #fca5a5; }
        .viab-mid { background: #fffbeb; border-color: #fcd34d; }
        .viab-label { font-size: 7.5px; font-weight: 900; text-transform: uppercase; letter-spacing: .12em; color: #64748b; }
        .viab-verdict { font-size: 12px; font-weight: 900; color: #0f172a; margin: 1mm 0; }
        .viab-reason { font-size: 8.5px; color: #475569; }

        /* Sections */
        .section { break-before: page; padding-top: 2mm; }
        .section-title { position: relative; display: flex; align-items: flex-end; justify-content: space-between; gap: 5mm; margin-bottom: 5mm; border-bottom: 1px solid #dbe3ef; padding-bottom: 3mm; }
        .section-title:before { content: ""; display: block; width: 10mm; height: 1.2mm; background: #f59e0b; position: absolute; margin-top: 12mm; }
        h2 { margin: 0; font-size: 22px; line-height: 1.08; color: #0f172a; }
        h3 { margin: 0 0 3mm; font-size: 13px; color: #0f172a; }
        .kicker { display: inline-block; border: 1px solid #dbeafe; background: #eff6ff; color: #1d4ed8; border-radius: 999px; padding: 1mm 2.4mm; font-size: 7.5px; font-weight: 900; letter-spacing: 0.12em; text-transform: uppercase; }

        /* Clusters */
        .cluster-card { border: 1px solid #dbe3ef; border-left: 4px solid #f59e0b; border-radius: 7px; padding: 4mm; margin-bottom: 3mm; break-inside: avoid; background: #fff; box-shadow: 0 4px 12px rgba(15,23,42,0.05); }
        .cluster-header { display: flex; align-items: center; gap: 2.5mm; flex-wrap: wrap; margin-bottom: 2.5mm; }
        .priority-badge { display: inline-block; border-radius: 999px; padding: 0.8mm 2.2mm; font-size: 8px; font-weight: 900; letter-spacing: .1em; text-transform: uppercase; }
        .cluster-name { font-size: 13px; font-weight: 900; color: #0f172a; }
        .cluster-meta { font-size: 8.5px; color: #64748b; font-weight: 700; }
        .cluster-keywords { display: flex; flex-wrap: wrap; gap: 1.5mm; }
        .cluster-kw { display: inline-flex; align-items: center; gap: 1mm; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 999px; padding: 0.8mm 2mm; font-size: 8.5px; font-weight: 700; color: #334155; }
        .kw-score { background: #f59e0b; color: #fff; border-radius: 999px; padding: 0.2mm 1.4mm; font-size: 7px; font-weight: 950; }
        .cluster-kw-more { display: inline-flex; align-items: center; background: #e2e8f0; border-radius: 999px; padding: 0.8mm 2mm; font-size: 8px; font-weight: 700; color: #64748b; }

        /* Tables */
        table { width: 100%; border-collapse: collapse; break-inside: auto; font-size: 9.5px; }
        th { text-align: left; background: #0f172a; color: #fff; font-size: 7.5px; letter-spacing: 0.11em; text-transform: uppercase; border: 1px solid #0f172a; padding: 2.2mm; }
        td { border: 1px solid #dbe3ef; padding: 2.4mm; vertical-align: top; background: #fff; }
        tbody tr:nth-child(even) td { background: #f8fafc; }
        tr { break-inside: avoid; }
        .num { text-align: right; font-variant-numeric: tabular-nums; }
        .muted { margin-top: 1mm; color: #64748b; font-size: 8.5px; }
        .mono { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; word-break: break-all; }

        /* Pills */
        .pill { display: inline-block; border-radius: 999px; padding: 0.7mm 1.8mm; text-align: center; font-size: 7px; font-weight: 900; text-transform: uppercase; letter-spacing: 0.05em; }
        .pill-vol-high { background: #dcfce7; color: #166534; }
        .pill-vol-med { background: #fef3c7; color: #92400e; }
        .pill-vol-low { background: #f1f5f9; color: #475569; }
        .pill-diff-easy { background: #dcfce7; color: #166534; }
        .pill-diff-med { background: #fef3c7; color: #92400e; }
        .pill-diff-hard { background: #fee2e2; color: #991b1b; }
        .pill-intent { background: #eff6ff; color: #1e40af; }

        /* Blueprint */
        .blueprint-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 4mm; margin-bottom: 5mm; }
        .bp-card { border: 1px solid #dbe3ef; border-radius: 7px; padding: 4mm; background: #fff; box-shadow: 0 4px 12px rgba(15,23,42,0.05); }
        .bp-label { font-size: 7.5px; font-weight: 900; text-transform: uppercase; letter-spacing: .12em; color: #64748b; margin-bottom: 1.5mm; }
        .bp-value { font-size: 12px; font-weight: 900; color: #0f172a; }
        .bp-list { margin: 0; padding-left: 4mm; }
        .bp-list li { font-size: 9.5px; color: #334155; margin: 1.5mm 0; }
        .bp-list-avoid li { border-left: 2.5px solid #ef4444; padding-left: 2mm; list-style: none; }
        .bp-list-must li { border-left: 2.5px solid #16a34a; padding-left: 2mm; list-style: none; }

        /* Execution priority */
        .exec-list { counter-reset: exec; margin: 0; padding: 0; list-style: none; }
        .exec-list li { counter-increment: exec; display: flex; align-items: flex-start; gap: 3mm; padding: 2.5mm 0; border-bottom: 1px solid #e2e8f0; font-size: 10px; color: #334155; }
        .exec-list li:last-child { border-bottom: 0; }
        .exec-list li:before { content: counter(exec); display: flex; align-items: center; justify-content: center; width: 6mm; height: 6mm; border-radius: 999px; background: #0f172a; color: #fff; font-weight: 950; font-size: 9px; flex-shrink: 0; margin-top: 0.5mm; }

        /* SERP features */
        .feature-list { display: flex; flex-wrap: wrap; gap: 2mm; }
        .feature-tag { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 999px; padding: 1mm 2.5mm; font-size: 8.5px; font-weight: 700; color: #475569; }

        /* PAA */
        .paa-list { margin: 0; padding: 0; list-style: none; }
        .paa-list li { padding: 2mm 0; border-bottom: 1px solid #e2e8f0; font-size: 9.5px; color: #334155; }
        .paa-list li:last-child { border-bottom: 0; }

        /* LSI */
        .lsi-grid { display: flex; flex-wrap: wrap; gap: 1.5mm; }
        .lsi-tag { background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 999px; padding: 0.8mm 2mm; font-size: 8.5px; font-weight: 700; color: #1e40af; }

        /* Two col */
        .two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 6mm; align-items: start; }
        .panel { border: 1px solid #dbe3ef; border-radius: 8px; background: #fff; padding: 5mm; box-shadow: 0 6px 18px rgba(15,23,42,0.06); break-inside: avoid; }

        /* Alt strategy */
        .alt-panel { border: 1px solid #dbe3ef; border-left: 4px solid #8b5cf6; border-radius: 7px; padding: 5mm; background: #faf5ff; margin-top: 5mm; }
        .alt-angle { font-size: 16px; font-weight: 900; color: #0f172a; margin-bottom: 2mm; }
        .alt-reason { font-size: 10px; color: #475569; margin-bottom: 3mm; }
        .alt-keywords { display: flex; flex-wrap: wrap; gap: 1.5mm; }
        .alt-kw { background: #ede9fe; border: 1px solid #c4b5fd; border-radius: 999px; padding: 0.8mm 2mm; font-size: 8.5px; font-weight: 700; color: #5b21b6; }

        /* Note */
        .note { border-left: 1.2mm solid #f59e0b; background: #fffbeb; border-radius: 6px; padding: 4mm; color: #334155; font-size: 10.5px; font-weight: 650; margin: 5mm 0; }

        /* Effort */
        .effort { display: inline-block; border-radius: 999px; background: #dcfce7; color: #166534; padding: 0.8mm 1.8mm; font-size: 7.8px; font-weight: 900; text-transform: uppercase; }

        /* Footer */
        .footer { margin-top: 8mm; border-top: 1px solid #dbe3ef; padding-top: 3mm; color: #64748b; font-size: 9px; font-weight: 700; display: flex; justify-content: space-between; }

        /* Screen preview */
        @media screen {
            body { background: #e5e7eb; padding: 24px; }
            .paper { width: 210mm; margin: 0 auto; background: #fff; padding: 12mm; box-shadow: 0 20px 45px rgba(15,23,42,0.18); }
        }
        @media print {
            .paper { padding: 0; }
            .no-print { display: none; }
        }
    </style>
</head>
<body>
<div class="paper">

    <!-- COVER -->
    <section class="cover">
        <div>
            <div class="brand">
                <div>
                    ${renderClimbSeoLogo('dark')}
                    <div style="margin-top:5mm"><span class="eyebrow">Agency Keyword Intelligence</span></div>
                </div>
                <div class="meta-box">
                    Seed keyword: <strong>${escapeHtml(seed)}</strong><br>
                    Generated: ${escapeHtml(generatedAt)}<br>
                    Total keywords: <strong>${totalKeywords}</strong>
                </div>
            </div>
            <h1>Keyword Research Report</h1>
            <div class="seed-pill">${escapeHtml(seed)}</div>
            <p class="subtitle">A complete keyword intelligence package including SERP analysis, strategic clusters, quick wins, content blueprint, and a 5-layer expansion of the keyword universe.</p>
            <div class="cover-main">
                <div class="cover-grid">
                    ${renderMetricBox('Total Keywords', totalKeywords, 'In the keyword universe')}
                    ${renderMetricBox('Strategic Clusters', clusters.length, 'Priority topic groups')}
                    ${renderMetricBox('Quick Wins', quickWins.length, 'Fast-rank opportunities')}
                    ${renderMetricBox('PAA Questions', serpRaw?.paaQuestions?.length ?? 0, '"People Also Ask" signals')}
                </div>
                <div class="score-panel">
                    ${renderDifficultyGauge(diffScore)}
                    <div style="text-align:center;font-size:8.5px;font-weight:900;text-transform:uppercase;letter-spacing:.1em;color:#64748b">Difficulty Score</div>
                    ${difficulty?.label ? `<p style="text-align:center;font-size:13px;font-weight:900;color:#0f172a;margin-top:2mm">${escapeHtml(difficulty.label)}</p>` : ''}
                    ${difficulty?.reason ? `<p style="text-align:center;font-size:9px;color:#64748b;margin-top:1.5mm">${escapeHtml(difficulty.reason)}</p>` : ''}
                </div>
            </div>
            ${viabilityCards ? `
            <div class="viab-grid">
                ${viabilityCards}
            </div>` : ''}
        </div>
        <div class="footer">
            <span>ClimbSEO keyword intelligence</span>
            <span>Generated ${escapeHtml(generatedAt)}</span>
        </div>
    </section>

    <!-- CONTENT BLUEPRINT + EXECUTION PRIORITY -->
    <section class="section">
        <div class="section-title">
            <h2>Content Blueprint</h2>
            <span class="kicker">${blueprint?.confidence ?? ''} confidence</span>
        </div>
        ${blueprint ? `
        <div class="blueprint-grid">
            <div class="bp-card">
                <div class="bp-label">Primary Format</div>
                <div class="bp-value">${escapeHtml(blueprint.primaryFormat)}</div>
            </div>
            <div class="bp-card">
                <div class="bp-label">Target Word Count</div>
                <div class="bp-value">${escapeHtml(blueprint.wordCountTarget)}</div>
            </div>
            <div class="bp-card">
                <div class="bp-label">Time to Impact</div>
                <div class="bp-value">${escapeHtml(blueprint.timeToImpact)}</div>
            </div>
            <div class="bp-card">
                <div class="bp-label">Confidence</div>
                <div class="bp-value">${escapeHtml(blueprint.confidence)}</div>
            </div>
        </div>
        <div class="note"><strong>Unique angle:</strong> ${escapeHtml(blueprint.uniqueAngle)}</div>
        <div class="two-col" style="margin-top:4mm">
            <div class="panel">
                <h3>Must Include</h3>
                <ul class="bp-list bp-list-must">
                    ${(blueprint.mustInclude || []).map((item) => `<li>${escapeHtml(item)}</li>`).join('')}
                </ul>
            </div>
            <div class="panel">
                <h3>Avoid</h3>
                <ul class="bp-list bp-list-avoid">
                    ${(blueprint.avoid || []).map((item) => `<li>${escapeHtml(item)}</li>`).join('')}
                </ul>
            </div>
        </div>
        ` : '<p class="muted">No content blueprint available.</p>'}

        ${executionPriority.length > 0 ? `
        <h3 style="margin-top:7mm">Execution Priority</h3>
        <ol class="exec-list">
            ${executionPriority.map((step) => `<li>${escapeHtml(step)}</li>`).join('')}
        </ol>` : ''}

        ${contentGap ? `
        <div class="note" style="margin-top:5mm"><strong>Content Gap:</strong> ${escapeHtml(contentGap)}</div>` : ''}
    </section>

    <!-- STRATEGIC CLUSTERS -->
    <section class="section">
        <div class="section-title">
            <h2>Strategic Clusters</h2>
            <span class="kicker">${clusters.length} topic groups</span>
        </div>
        ${clusterRows || '<p class="muted">No clusters available.</p>'}
    </section>

    <!-- QUICK WINS -->
    <section class="section">
        <div class="section-title">
            <h2>Quick Wins</h2>
            <span class="kicker">Fast-rank opportunities</span>
        </div>
        <table>
            <thead>
                <tr>
                    <th>Keyword</th>
                    <th>Why it wins</th>
                    <th>Action</th>
                    <th>Time to Rank</th>
                </tr>
            </thead>
            <tbody>${quickWinRows || '<tr><td colspan="4">No quick wins available.</td></tr>'}</tbody>
        </table>
    </section>

    <!-- KEYWORD UNIVERSE -->
    <section class="section">
        <div class="section-title">
            <h2>Keyword Universe</h2>
            <span class="kicker">Top ${topKeywords.length} of ${totalKeywords}</span>
        </div>
        <table>
            <thead>
                <tr>
                    <th>Keyword</th>
                    <th>Intent</th>
                    <th>Volume</th>
                    <th>Difficulty</th>
                    <th class="num">Score</th>
                    <th>Buyer Stage</th>
                    <th class="num">Ads Vol</th>
                    <th class="num">CPC</th>
                </tr>
            </thead>
            <tbody>${keywordTableRows || '<tr><td colspan="8">No keywords available.</td></tr>'}</tbody>
        </table>

        ${longTailGems.length > 0 ? `
        <h3 style="margin-top:6mm">Long-Tail Gems</h3>
        <table>
            <thead><tr><th>Term</th><th>Opportunity Reason</th><th class="num">Score</th></tr></thead>
            <tbody>
                ${longTailGems.map((gem) => `
                    <tr>
                        <td><strong>${escapeHtml(gem.term)}</strong></td>
                        <td>${escapeHtml(gem.reason)}</td>
                        <td class="num">${gem.opportunityScore}</td>
                    </tr>
                `).join('')}
            </tbody>
        </table>` : ''}

        ${lsiTerms.length > 0 ? `
        <h3 style="margin-top:6mm">LSI / Semantic Terms</h3>
        <div class="lsi-grid">
            ${lsiTerms.map((term) => `<span class="lsi-tag">${escapeHtml(term)}</span>`).join('')}
        </div>` : ''}
    </section>

    <!-- SERP INTELLIGENCE -->
    <section class="section">
        <div class="section-title">
            <h2>SERP Intelligence</h2>
            <span class="kicker">Search landscape</span>
        </div>
        <div class="two-col">
            <div>
                ${serpFeatures.length > 0 ? `
                <div class="panel" style="margin-bottom:5mm">
                    <h3>SERP Features Detected</h3>
                    <div class="feature-list">
                        ${serpFeatures.map((f) => `<span class="feature-tag">${escapeHtml(f)}</span>`).join('')}
                    </div>
                </div>` : ''}
                ${kg ? `
                <div class="panel">
                    <h3>Knowledge Graph</h3>
                    <div style="font-size:12px;font-weight:900;color:#0f172a">${escapeHtml(kg.title)}</div>
                    <div style="font-size:9px;color:#64748b;margin:1mm 0 2mm">${escapeHtml(kg.type)}</div>
                    <div style="font-size:9.5px;color:#334155">${escapeHtml(kg.description)}</div>
                </div>` : ''}
            </div>
            <div class="panel">
                <h3>Related Searches</h3>
                <ul class="paa-list">
                    ${relatedSearches.map((s) => `<li>${escapeHtml(s)}</li>`).join('') || '<li class="muted">None detected.</li>'}
                </ul>
            </div>
        </div>

        ${paaQuestions.length > 0 ? `
        <h3 style="margin-top:6mm">People Also Ask</h3>
        <ul class="paa-list">
            ${paaQuestions.map((q) => `<li><strong>${escapeHtml(q.question)}</strong>${q.snippet ? `<div class="muted">${escapeHtml(q.snippet.slice(0, 180))}${q.snippet.length > 180 ? '…' : ''}</div>` : ''}</li>`).join('')}
        </ul>` : ''}

        ${questionKeywords.length > 0 ? `
        <h3 style="margin-top:6mm">Question Keywords</h3>
        <table>
            <thead><tr><th>Question</th><th>Intent</th><th>Volume</th></tr></thead>
            <tbody>
                ${questionKeywords.map((qk) => `
                    <tr>
                        <td>${escapeHtml(qk.question)}</td>
                        <td>${renderIntentPill(qk.intent)}</td>
                        <td>${renderVolPill(qk.volume)}</td>
                    </tr>
                `).join('')}
            </tbody>
        </table>` : ''}
    </section>

    <!-- TOP SERP RESULTS -->
    ${serp.length > 0 ? `
    <section class="section">
        <div class="section-title">
            <h2>Current SERP Results</h2>
            <span class="kicker">Who ranks today</span>
        </div>
        <table>
            <thead><tr><th class="num">#</th><th>Result</th></tr></thead>
            <tbody>${serpRows}</tbody>
        </table>
    </section>` : ''}

    <!-- ALTERNATIVE STRATEGY -->
    ${alternativeStrategy ? `
    <section class="section">
        <div class="section-title">
            <h2>Alternative Strategy</h2>
            <span class="kicker">Pivot option</span>
        </div>
        <div class="alt-panel">
            <div class="alt-angle">${escapeHtml(alternativeStrategy.angle)}</div>
            <div class="alt-reason">${escapeHtml(alternativeStrategy.reason)}</div>
            <div class="alt-keywords">
                ${(alternativeStrategy.keywords || []).map((kw) => `<span class="alt-kw">${escapeHtml(kw)}</span>`).join('')}
            </div>
        </div>
    </section>` : ''}

</div>
</body>
</html>`;
}

export function printKeywordPdfReport(data: KeywordDataV2): boolean {
    const existingFrame = document.getElementById('keyword-pdf-print-frame');
    existingFrame?.remove();

    const frame = document.createElement('iframe');
    frame.id = 'keyword-pdf-print-frame';
    frame.title = 'Keyword research PDF report';
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
    reportDocument.write(buildKeywordReportHtml(data));
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
