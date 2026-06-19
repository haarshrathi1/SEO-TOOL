const express = require('express');
const { generateContent } = require('./genaiProvider');
const { AnalysisHistory, AuditHistory, KeywordResearch, ChatMessage } = require('./models');
const { getProject } = require('./projects');

const PIKAPOPOI_PERSONA = `You are PikaPopoi, The Technical SEO King. You are an expert, direct, and helpful SEO consultant embedded inside an SEO analytics platform.

Your job: analyze the real project data provided and help users understand and improve their SEO.

Rules:
- Always cite specific numbers from the project data. Say "your 1,240 weekly clicks" not "your traffic".
- Be direct and prescriptive. Rank recommendations by organic traffic impact.
- Keep responses concise: 3–5 sentences or a short bullet list. No essays.
- Format lists with bullet points (use "-" prefix).
- If data doesn't tell you something, say so honestly — never make up figures.
- If no project data is available, tell the user to run an analysis and audit first.`;

async function buildProjectBrief(projectId, workspaceId) {
    const brief = {};
    const scopedQuery = { projectId, workspaceId: workspaceId || null };

    try {
        const latestAnalysis = await AnalysisHistory.findOne(
            scopedQuery,
            null,
            { sort: { timestamp: -1 } }
        ).lean();

        if (latestAnalysis?.data) {
            const d = latestAnalysis.data;
            brief.domain = d.domain || d.project || '';
            brief.lastAnalyzed = latestAnalysis.timestamp;
            brief.gsc = {
                clicks: d.metrics?.clicks,
                impressions: d.metrics?.impressions,
                ctr: d.metrics?.ctr,
                avgPosition: d.metrics?.avgPosition,
                indexedPages: d.metrics?.indexedPages,
                notIndexedPages: d.metrics?.notIndexedPages,
                engagementRate: d.metrics?.engagementRate,
                bounceRate: d.metrics?.bounceRate,
            };
            brief.psi = {
                mobile: d.metrics?.psiMobile,
                desktop: d.metrics?.psiDesktop,
                lcpMobile: d.metrics?.lcpMobile,
                lcpDesktop: d.metrics?.lcpDesktop,
                clsMobile: d.metrics?.clsMobile,
                clsDesktop: d.metrics?.clsDesktop,
                inpMobile: d.metrics?.inpMobile,
                inpDesktop: d.metrics?.inpDesktop,
            };
            brief.score = d.metrics?.score;
            brief.status = d.metrics?.status;
            brief.alerts = Array.isArray(d.alerts) ? d.alerts : [];
            brief.topPages = Array.isArray(d.pages?.top) ? d.pages.top.slice(0, 5) : [];
            brief.topKeywords = Array.isArray(d.keywords?.top) ? d.keywords.top.slice(0, 5) : [];
            brief.issuesSummary = {
                errors: d.issues?.errors || 0,
                indexingWarnings: d.issues?.indexingWarnings || 0,
                psiWarnings: d.issues?.psiWarnings || 0,
            };
        }
    } catch {}

    try {
        const latestAudit = await AuditHistory.findOne(
            scopedQuery,
            null,
            { sort: { timestamp: -1 } }
        ).lean();

        if (latestAudit?.results) {
            const results = Array.isArray(latestAudit.results) ? latestAudit.results : [];
            const totalPages = results.length;
            const brokenPages = results.filter((r) => (r.httpStatus || 0) >= 400 || r.status === 'FAIL').length;
            const missingTitles = results.filter((r) => !r.title).length;
            const missingDescriptions = results.filter((r) => !r.description).length;
            const missingH1 = results.filter((r) => !r.h1Count || r.h1Count === 0).length;
            const schemaErrors = results.filter((r) =>
                r.structuredData?.issues?.some((i) => i.severity === 'error')
            ).length;
            const missingSchema = results.filter((r) =>
                r.structuredData && r.structuredData.totalItems === 0 && (r.structuredData.parseErrors?.length || 0) === 0
            ).length;

            brief.audit = {
                totalPages,
                brokenPages,
                missingTitles,
                missingDescriptions,
                missingH1,
                schemaErrors,
                missingSchema,
                lastAudit: latestAudit.timestamp,
            };
        }
    } catch {}

    try {
        const recentKeywords = await KeywordResearch.find(
            scopedQuery,
            { seed: 1, timestamp: 1 },
            { sort: { timestamp: -1 }, limit: 3 }
        ).lean();
        brief.recentKeywordResearch = recentKeywords.map((k) => k.seed);
    } catch {
        brief.recentKeywordResearch = [];
    }

    return brief;
}

function formatBriefAsText(brief) {
    if (!brief.domain && !brief.gsc && !brief.audit) {
        return 'No project data is available yet. The user needs to run an analysis and a site audit first.';
    }

    const lines = [];

    if (brief.domain) {
        lines.push(`PROJECT: ${brief.domain}`);
        if (brief.lastAnalyzed) {
            lines.push(`Last analyzed: ${new Date(brief.lastAnalyzed).toDateString()}`);
        }
        lines.push('');
    }

    if (brief.score !== undefined) {
        lines.push(`SEO Health Score: ${brief.score}/100 (${brief.status || 'N/A'})`);
    }

    if (brief.alerts?.length) {
        lines.push(`Active alerts: ${brief.alerts.join('; ')}`);
    }

    if (brief.gsc) {
        lines.push('');
        lines.push('=== SEARCH PERFORMANCE (GSC) ===');
        lines.push(`Clicks: ${brief.gsc.clicks ?? 'N/A'}`);
        lines.push(`Impressions: ${brief.gsc.impressions ?? 'N/A'}`);
        lines.push(`CTR: ${brief.gsc.ctr ?? 'N/A'}`);
        lines.push(`Avg Position: ${brief.gsc.avgPosition ?? 'N/A'}`);
        lines.push(`Indexed pages: ${brief.gsc.indexedPages ?? 'N/A'} | Not indexed: ${brief.gsc.notIndexedPages ?? 'N/A'}`);
        if (brief.gsc.engagementRate) lines.push(`Engagement Rate: ${brief.gsc.engagementRate}`);
        if (brief.gsc.bounceRate) lines.push(`Bounce Rate: ${brief.gsc.bounceRate}`);
    }

    if (brief.psi) {
        lines.push('');
        lines.push('=== CORE WEB VITALS / PAGE SPEED ===');
        lines.push(`Mobile PSI Score: ${brief.psi.mobile ?? 'N/A'} | Desktop: ${brief.psi.desktop ?? 'N/A'}`);
        lines.push(`LCP Mobile: ${brief.psi.lcpMobile ?? 'N/A'} | Desktop: ${brief.psi.lcpDesktop ?? 'N/A'}`);
        lines.push(`CLS Mobile: ${brief.psi.clsMobile ?? 'N/A'} | Desktop: ${brief.psi.clsDesktop ?? 'N/A'}`);
        lines.push(`INP Mobile: ${brief.psi.inpMobile ?? 'N/A'} | Desktop: ${brief.psi.inpDesktop ?? 'N/A'}`);
    }

    if (brief.issuesSummary) {
        lines.push('');
        lines.push('=== ISSUE SUMMARY ===');
        lines.push(`Crawl errors: ${brief.issuesSummary.errors}`);
        lines.push(`Indexing warnings: ${brief.issuesSummary.indexingWarnings}`);
        lines.push(`PSI warnings: ${brief.issuesSummary.psiWarnings}`);
    }

    if (brief.topPages?.length) {
        lines.push('');
        lines.push('=== TOP PAGES ===');
        brief.topPages.forEach((p) => {
            if (typeof p === 'object' && p.url) {
                lines.push(`  ${p.url}: ${p.impressions ?? 0} impressions, ${p.clicks ?? 0} clicks`);
            }
        });
    }

    if (brief.topKeywords?.length) {
        lines.push('');
        lines.push('=== TOP KEYWORDS ===');
        brief.topKeywords.forEach((k) => {
            if (typeof k === 'object' && k.keyword) {
                lines.push(`  "${k.keyword}": ${k.impressions ?? 0} impressions, ${k.clicks ?? 0} clicks`);
            }
        });
    }

    if (brief.audit) {
        lines.push('');
        lines.push('=== TECHNICAL AUDIT ===');
        if (brief.audit.lastAudit) {
            lines.push(`Last audit: ${new Date(brief.audit.lastAudit).toDateString()}`);
        }
        lines.push(`Pages crawled: ${brief.audit.totalPages}`);
        lines.push(`Broken pages (4xx/5xx): ${brief.audit.brokenPages}`);
        lines.push(`Missing title tags: ${brief.audit.missingTitles}`);
        lines.push(`Missing meta descriptions: ${brief.audit.missingDescriptions}`);
        lines.push(`Missing H1 tags: ${brief.audit.missingH1}`);
        lines.push(`Schema errors: ${brief.audit.schemaErrors}`);
        lines.push(`Pages missing schema: ${brief.audit.missingSchema}`);
    }

    if (brief.recentKeywordResearch?.length) {
        lines.push('');
        lines.push('=== RECENT KEYWORD RESEARCH ===');
        brief.recentKeywordResearch.forEach((seed) => lines.push(`  - "${seed}"`));
    }

    return lines.join('\n');
}

const chatRouter = express.Router();

async function requireProjectAccess(req, res, projectId) {
    const project = await getProject(projectId, req.user);
    if (!project) {
        res.status(404).json({ error: 'Project not found' });
        return null;
    }
    return project;
}

chatRouter.post('/message', async (req, res) => {
    try {
        const { projectId, message } = req.body;

        if (!projectId || typeof projectId !== 'string') {
            return res.status(400).json({ error: 'projectId is required' });
        }

        if (!message || typeof message !== 'string' || !message.trim()) {
            return res.status(400).json({ error: 'message is required' });
        }

        if (!await requireProjectAccess(req, res, projectId)) {
            return undefined;
        }

        const user = req.user;

        const history = await ChatMessage.find(
            { projectId, ownerEmail: user.email },
            { role: 1, content: 1 },
            { sort: { createdAt: -1 }, limit: 10 }
        ).lean();

        const recentHistory = history.reverse();

        const brief = await buildProjectBrief(projectId, user.workspaceId);
        const briefText = formatBriefAsText(brief);

        const systemInstruction = `${PIKAPOPOI_PERSONA}\n\n--- PROJECT DATA ---\n${briefText}\n--- END PROJECT DATA ---`;

        const contents = [
            ...recentHistory.map((msg) => ({
                role: msg.role === 'user' ? 'user' : 'model',
                parts: [{ text: msg.content }],
            })),
            { role: 'user', parts: [{ text: message.trim() }] },
        ];

        const response = await generateContent({
            modelType: 'page',
            taskName: 'pikapopoi-chat',
            contents,
            config: {
                systemInstruction,
                temperature: 0.5,
                maxOutputTokens: 1024,
            },
        });

        const assistantText = (response.text || '').trim() || 'I had trouble generating a response. Please try again.';

        await ChatMessage.insertMany([
            { projectId, ownerEmail: user.email, workspaceId: user.workspaceId || null, role: 'user', content: message.trim() },
            { projectId, ownerEmail: user.email, workspaceId: user.workspaceId || null, role: 'assistant', content: assistantText },
        ]);

        return res.json({ message: assistantText });
    } catch (error) {
        const msg = error?.message || 'Unknown error';
        return res.status(500).json({ error: msg });
    }
});

chatRouter.get('/history', async (req, res) => {
    try {
        const projectId = typeof req.query.projectId === 'string' ? req.query.projectId.trim() : '';
        if (!projectId) {
            return res.status(400).json({ error: 'projectId is required' });
        }

        if (!await requireProjectAccess(req, res, projectId)) {
            return undefined;
        }

        const user = req.user;
        const messages = await ChatMessage.find(
            { projectId, ownerEmail: user.email },
            { role: 1, content: 1, createdAt: 1 },
            { sort: { createdAt: 1 }, limit: 50 }
        ).lean();

        return res.json({
            messages: messages.map((m) => ({
                role: m.role,
                content: m.content,
                timestamp: m.createdAt,
            })),
        });
    } catch (error) {
        const msg = error?.message || 'Unknown error';
        return res.status(500).json({ error: msg });
    }
});

chatRouter.delete('/history', async (req, res) => {
    try {
        const projectId = typeof req.query.projectId === 'string' ? req.query.projectId.trim() : '';
        if (!projectId) {
            return res.status(400).json({ error: 'projectId is required' });
        }

        if (!await requireProjectAccess(req, res, projectId)) {
            return undefined;
        }

        const user = req.user;
        await ChatMessage.deleteMany({ projectId, ownerEmail: user.email });

        return res.json({ message: 'Chat history cleared' });
    } catch (error) {
        const msg = error?.message || 'Unknown error';
        return res.status(500).json({ error: msg });
    }
});

module.exports = { chatRouter };
