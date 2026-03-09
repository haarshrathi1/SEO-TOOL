const axios = require('axios');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const cheerio = require('cheerio');
require('dotenv').config();

// ─── Model Configuration ────────────────────────────────────────────────────
// Legacy model for backward compatibility
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const legacyModel = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

// Advanced model: Gemini 3.1 Pro Preview with Thinking
const advancedGenAI = new GoogleGenerativeAI(process.env.GEMINI_KEYWORD_API_KEY);
const advancedModel = advancedGenAI.getGenerativeModel({
    model: process.env.GEMINI_KEYWORD_MODEL || "gemini-3.1-pro-preview",
    generationConfig: {
        responseMimeType: "application/json",
        temperature: 1,        // let the model think freely
        maxOutputTokens: 65536,
    },
});

// ═══════════════════════════════════════════════════════════════════════════
// LAYER 1 — DATA COLLECTION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 1a. Fetch Real-time Google Autocomplete Suggestions
 */
async function fetchAutocomplete(seed) {
    try {
        const suffixes = ['', ' best', ' how to', ' vs', ' for', ' tools', ' examples', ' tips'];
        const allSuggestions = new Set();

        const promises = suffixes.map(async (suffix) => {
            try {
                const url = `http://google.com/complete/search?client=chrome&q=${encodeURIComponent(seed + suffix)}`;
                const response = await axios.get(url, { timeout: 3000 });
                if (response.data && response.data[1]) {
                    response.data[1].forEach(s => allSuggestions.add(s));
                }
            } catch { /* skip failed suffix */ }
        });

        await Promise.all(promises);
        return [...allSuggestions];
    } catch (e) {
        console.error("Autocomplete fetch failed:", e.message);
        return [];
    }
}

/**
 * 1b. Fetch Top 10 Google SERP Results (via SerpApi)
 */
async function fetchSERP(query) {
    console.log(`[SerpApi] Fetching results for: ${query}`);
    try {
        if (!process.env.SERP_API_KEY) {
            throw new Error("SERP_API_KEY is missing in .env");
        }

        const response = await axios.get('https://serpapi.com/search.json', {
            params: {
                api_key: process.env.SERP_API_KEY,
                engine: 'google',
                q: query,
                google_domain: 'google.com',
                gl: 'us',
                hl: 'en'
            }
        });

        if (response.data.error) {
            throw new Error(response.data.error);
        }

        const organicResults = response.data.organic_results || [];
        const results = organicResults.slice(0, 10).map(item => ({
            title: item.title,
            url: item.link,
            snippet: item.snippet || 'No snippet available',
            position: item.position,
            displayed_link: item.displayed_link,
            sitelinks: item.sitelinks ? true : false,
        }));

        // Extract People Also Ask
        const paaQuestions = (response.data.related_questions || []).map(q => ({
            question: q.question,
            snippet: q.snippet || '',
            title: q.title || '',
            link: q.link || '',
        }));

        // Extract Related Searches
        const relatedSearches = (response.data.related_searches || []).map(r => r.query);

        // Extract Knowledge Graph if present
        const knowledgeGraph = response.data.knowledge_graph ? {
            title: response.data.knowledge_graph.title,
            type: response.data.knowledge_graph.type,
            description: response.data.knowledge_graph.description,
        } : null;

        // Detect SERP Features
        const serpFeatures = [];
        if (response.data.answer_box) serpFeatures.push('featured_snippet');
        if (response.data.knowledge_graph) serpFeatures.push('knowledge_graph');
        if (response.data.related_questions) serpFeatures.push('people_also_ask');
        if (response.data.local_results) serpFeatures.push('local_pack');
        if (response.data.shopping_results) serpFeatures.push('shopping');
        if (response.data.inline_videos) serpFeatures.push('video_carousel');
        if (response.data.inline_images) serpFeatures.push('image_pack');
        if (response.data.top_stories) serpFeatures.push('top_stories');

        console.log(`[SerpApi] Successfully fetched ${results.length} results, ${paaQuestions.length} PAA, ${relatedSearches.length} related.`);

        return {
            organic: results,
            paaQuestions,
            relatedSearches,
            knowledgeGraph,
            serpFeatures,
            totalResults: response.data.search_information?.total_results || 0,
        };

    } catch (e) {
        console.error("[SerpApi] Error:", e.message);
        return {
            organic: [],
            paaQuestions: [],
            relatedSearches: [],
            knowledgeGraph: null,
            serpFeatures: [],
            totalResults: 0,
        };
    }
}

/**
 * 1c. Quick word count for top pages
 */
async function getQuickWordCount(url) {
    try {
        const res = await axios.get(url, {
            timeout: 3000,
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
        });
        const text = res.data.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
        return text.split(' ').length;
    } catch {
        return null;
    }
}

/**
 * 1d. Analyze SERP Data (Heuristic Pre-Analysis)
 */
async function analyzeSERP(organic, suggestions = []) {
    if (!organic || organic.length === 0) return null;

    let totalDateCount = 0;
    const types = { informational: 0, transactional: 0, listicle: 0, navigational: 0 };

    const domains = organic.map(r => {
        try { return new URL(r.url).hostname.replace('www.', ''); }
        catch { return ''; }
    });

    // Tiered Brand Analysis
    const tier1 = ['amazon', 'youtube', 'reddit', 'pinterest', 'quora', 'facebook', 'instagram', 'linkedin', 'twitter', 'tiktok', 'medium'];
    const tier2 = ['forbes', 'nytimes', 'healthline', 'investopedia', 'hubspot', 'g2', 'capterra', 'techcrunch', 'theverge', 'cnn', 'bbc', 'webmd'];

    let brandScore = 0;
    const domainTypes = { tier1: 0, tier2: 0, indie: 0 };
    domains.forEach(d => {
        if (tier1.some(b => d.includes(b))) { brandScore += 3; domainTypes.tier1++; }
        else if (tier2.some(b => d.includes(b))) { brandScore += 2; domainTypes.tier2++; }
        else { brandScore += 1; domainTypes.indie++; }
    });

    const maxScore = organic.length * 3;
    const brandPressure = Math.round((brandScore / maxScore) * 100);

    organic.forEach(r => {
        const text = (r.title + " " + r.snippet).toLowerCase();
        if (/\d{1,2} (jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec) \d{4}/i.test(r.snippet) ||
            /\d+ (days?|hours?|mins?) ago/i.test(r.snippet)) {
            totalDateCount++;
        }
        if (text.includes('best') || text.includes('top ') || text.includes('review') || text.includes(' vs ')) types.listicle++;
        else if (text.includes('buy') || text.includes('shop') || text.includes('price') || text.includes('sale') || text.includes('cart')) types.transactional++;
        else if (text.includes('how to') || text.includes('guide') || text.includes('tutorial') || text.includes('what is')) types.informational++;
        else types.informational++;
    });

    // Content Length (Quick Fetch Top 3)
    let avgWords = 0;
    try {
        const top3 = organic.slice(0, 3);
        const counts = await Promise.all(top3.map(r => getQuickWordCount(r.url)));
        const validCounts = counts.filter(c => c !== null);
        if (validCounts.length > 0) {
            avgWords = Math.round(validCounts.reduce((a, b) => a + b, 0) / validCounts.length);
        }
    } catch { /* fallback */ }

    const dominantType = Object.keys(types).reduce((a, b) => types[a] > types[b] ? a : b);
    const sortedTypes = Object.entries(types).sort((a, b) => b[1] - a[1]);
    const secondaryType = sortedTypes[1]?.[0] || 'none';
    const confidence = (types[dominantType] / organic.length).toFixed(2);

    let freshnessDir = "Irrelevant";
    if (totalDateCount > 5) freshnessDir = "Required";
    else if (totalDateCount > 2) freshnessDir = "Optional";

    // Volume Score
    const autocompleteDensity = Math.min((suggestions.length / 15) * 25, 25);
    let featureCount = 0;
    organic.forEach(r => {
        const s = r.snippet.toLowerCase();
        if (s.includes('rating') || s.includes('star') || s.includes('vote') || s.includes('review') || r.title.toLowerCase().includes('video')) {
            featureCount++;
        }
    });
    const serpFeaturesScore = Math.min((featureCount / 5) * 25, 25);
    const trendDirection = Math.min((totalDateCount / 6) * 25, 25);
    let ugcCount = 0;
    const ugcDomains = ['reddit', 'quora', 'pinterest', 'medium', 'youtube', 'tiktok', 'facebook', 'instagram', 'twitter', 'linkedin'];
    domains.forEach(d => {
        if (ugcDomains.some(u => d.includes(u))) ugcCount++;
    });
    const ugcFrequency = Math.min((ugcCount / 3) * 25, 25);
    const volumeScore = Math.round(autocompleteDensity + serpFeaturesScore + trendDirection + ugcFrequency);

    return {
        dominantPageType: dominantType,
        secondaryPageType: secondaryType,
        typeConfidence: confidence,
        brandPressureIndex: brandPressure,
        domainTypes,
        domains: [...new Set(domains)],
        avgContentLength: avgWords > 0 ? `${avgWords} words (est.)` : (dominantType === 'informational' ? 'Long Form (Inf)' : 'Short (Inf)'),
        avgWordCount: avgWords,
        freshness: freshnessDir,
        intentClarity: types[dominantType] >= (organic.length * 0.6) ? "Clear" : "Mixed",
        volumeScore,
        volumeBreakdown: {
            autocompleteDensity: Math.round(autocompleteDensity),
            serpFeatures: Math.round(serpFeaturesScore),
            trendDirection: Math.round(trendDirection),
            ugcFrequency: Math.round(ugcFrequency),
        },
    };
}


// ═══════════════════════════════════════════════════════════════════════════
// LAYER 2 — SERP DNA INTELLIGENCE  (Gemini 3.1 Pro with Thinking)
// ═══════════════════════════════════════════════════════════════════════════

async function layer2_serpDna(seed, serpData, serpSummary, suggestions) {
    console.log(`[Layer 2] SERP DNA Intelligence for: ${seed}`);

    const prompt = `
You are a SERP Forensics Analyst with 15 years of experience.

TASK: Analyze the SERP landscape for the seed keyword "${seed}" and produce a SERP DNA Profile.

DATA PROVIDED:
- Seed keyword: "${seed}"
- SERP Results (top 10): ${JSON.stringify(serpData.organic.slice(0, 10))}
- People Also Ask: ${JSON.stringify(serpData.paaQuestions)}
- Related Searches: ${JSON.stringify(serpData.relatedSearches)}
- Knowledge Graph: ${JSON.stringify(serpData.knowledgeGraph)}
- SERP Features Detected: ${JSON.stringify(serpData.serpFeatures)}
- Autocomplete Suggestions: ${JSON.stringify(suggestions.slice(0, 20))}
- Heuristic Summary: ${JSON.stringify(serpSummary)}

THINK DEEPLY about:
1. What is Google's "ideal result" for this query? What content format, depth, and authority does Google prefer?
2. What E-E-A-T signals are present in the top results?
3. What content patterns dominate (format, length, structure)?
4. Where are the gaps — what's missing from the current top results?
5. What topical authority signals does Google require?

RETURN this exact JSON schema:
{
    "serpPersonality": "string — one of: Knowledge Hub, Commercial Battlefield, Tutorial Playground, News Feed, Community Forum, Mixed Bazaar",
    "googleWants": "string — what Google clearly favors for this query (2-3 sentences)",
    "contentFormatDominance": ["list of dominant content formats in order, e.g. 'long-form guide', 'listicle', 'video', 'tool page'"],
    "eatSignals": {
        "experience": "string — what experience signals are present",
        "expertise": "string — what expertise signals are present", 
        "authority": "string — what authority signals matter",
        "trust": "string — what trust signals are visible"
    },
    "topicalAuthority": "string — what topical authority is needed to rank",
    "contentGaps": ["list of 3-5 specific content gaps in the current SERP"],
    "rankerProfile": "string — who currently ranks: Big Brands, Niche Experts, UGC Platforms, Mixed",
    "difficultyVerdict": "string — Easy Pickings, Moderate Fight, Tough Battle, Near Impossible",
    "opportunityAngle": "string — the single best angle to attack this SERP (1-2 sentences)"
}`;

    try {
        const result = await advancedModel.generateContent({
            contents: [{ role: "user", parts: [{ text: prompt }] }],
            generationConfig: {
                responseMimeType: "application/json",
                thinkingConfig: { thinkingBudget: 8192 },
            },
        });
        const response = await result.response;
        let text = response.text();
        text = text.replace(/```json/g, '').replace(/```/g, '').trim();
        return JSON.parse(text);
    } catch (e) {
        console.error("[Layer 2] Error:", e.message);
        return {
            serpPersonality: "Mixed Bazaar",
            googleWants: "Unable to determine due to analysis error.",
            contentFormatDominance: ["unknown"],
            eatSignals: { experience: "N/A", expertise: "N/A", authority: "N/A", trust: "N/A" },
            topicalAuthority: "Unable to determine",
            contentGaps: [],
            rankerProfile: "Unknown",
            difficultyVerdict: "Unknown",
            opportunityAngle: "Retry analysis with more data."
        };
    }
}


// ═══════════════════════════════════════════════════════════════════════════
// LAYER 3 — INTENT DECOMPOSITION
// ═══════════════════════════════════════════════════════════════════════════

async function layer3_intentDecomposition(seed, serpData, serpDna, suggestions) {
    console.log(`[Layer 3] Intent Decomposition for: ${seed}`);

    const prompt = `
You are a Search Intent Psychologist specializing in user behavior analysis.

TASK: Decompose the search intent for "${seed}" across multiple dimensions.

CONTEXT:
- SERP DNA Profile: ${JSON.stringify(serpDna)}
- People Also Ask: ${JSON.stringify(serpData.paaQuestions)}
- Related Searches: ${JSON.stringify(serpData.relatedSearches)}
- Autocomplete: ${JSON.stringify(suggestions.slice(0, 20))}

THINK DEEPLY about:
1. The FULL spectrum of WHY someone searches for "${seed}"
2. Where they are in the buyer journey
3. What micro-intents exist beneath the surface query
4. How intent shifts based on modifiers and context

RETURN this exact JSON schema:
{
    "primaryIntent": "string — the dominant search intent category",
    "intentSpectrum": {
        "know": number 0-100,
        "do": number 0-100,
        "go": number 0-100,
        "buy": number 0-100,
        "compare": number 0-100,
        "learn": number 0-100
    },
    "buyerJourney": {
        "awareness": number 0-100,
        "consideration": number 0-100,
        "decision": number 0-100,
        "retention": number 0-100
    },
    "microIntents": [
        {
            "intent": "string — specific micro intent",
            "strength": "High | Medium | Low",
            "example_query": "string — example search query for this micro intent"
        }
    ],
    "intentInsight": "string — 2-3 sentence insight about the searcher's true needs",
    "contentAngle": "string — the best content angle to satisfy the dominant intent"
}`;

    try {
        const result = await advancedModel.generateContent({
            contents: [{ role: "user", parts: [{ text: prompt }] }],
            generationConfig: {
                responseMimeType: "application/json",
                thinkingConfig: { thinkingBudget: 8192 },
            },
        });
        const response = await result.response;
        let text = response.text();
        text = text.replace(/```json/g, '').replace(/```/g, '').trim();
        return JSON.parse(text);
    } catch (e) {
        console.error("[Layer 3] Error:", e.message);
        return {
            primaryIntent: "Informational",
            intentSpectrum: { know: 50, do: 20, go: 5, buy: 10, compare: 10, learn: 5 },
            buyerJourney: { awareness: 40, consideration: 30, decision: 20, retention: 10 },
            microIntents: [],
            intentInsight: "Unable to perform deep intent analysis.",
            contentAngle: "Focus on comprehensive coverage."
        };
    }
}


// ═══════════════════════════════════════════════════════════════════════════
// LAYER 4 — KEYWORD UNIVERSE EXPANSION
// ═══════════════════════════════════════════════════════════════════════════

async function layer4_keywordUniverse(seed, serpData, serpDna, intentData, suggestions) {
    console.log(`[Layer 4] Keyword Universe Expansion for: ${seed}`);

    const prompt = `
You are a Keyword Strategist who merges data science with SEO expertise.

TASK: Build a comprehensive keyword universe for "${seed}" using ONLY the data provided.

DATA PROVIDED:
- Autocomplete suggestions: ${JSON.stringify(suggestions)}
- People Also Ask: ${JSON.stringify(serpData.paaQuestions.map(q => q.question))}
- Related Searches: ${JSON.stringify(serpData.relatedSearches)}
- SERP titles/snippets: ${JSON.stringify(serpData.organic.slice(0, 10).map(r => ({ title: r.title, snippet: r.snippet })))}
- SERP DNA: ${JSON.stringify(serpDna)}
- Intent Analysis: ${JSON.stringify(intentData)}

RULES:
1. You may ONLY use keywords visible in the provided data or semantically implied by titles/snippets
2. You MAY generate long-tail variations of visible keywords
3. You MUST classify every keyword with intent AND opportunity score
4. Opportunity score = (relevance × intent alignment) / estimated difficulty — scale 1-100
5. Limit total keywords to 40-60

RETURN this exact JSON schema:
{
    "totalKeywords": number,
    "keywords": [
        {
            "term": "string",
            "intent": "Informational | Commercial | Transactional | Navigational | Comparison",
            "volume": "High | Medium | Low",
            "difficulty": "Easy | Medium | Hard",
            "opportunityScore": number 1-100,
            "source": "autocomplete | paa | related | serp_implied | long_tail",
            "buyerStage": "Awareness | Consideration | Decision | Retention"
        }
    ],
    "questionKeywords": [
        {
            "question": "string", 
            "intent": "string",
            "volume": "High | Medium | Low"
        }
    ],
    "lsiTerms": ["list of LSI/semantic terms discovered from SERP content"],
    "longTailGems": [
        {
            "term": "string — low competition long-tail keyword",
            "reason": "string — why this is a gem",
            "opportunityScore": number 1-100
        }
    ]
}`;

    try {
        const result = await advancedModel.generateContent({
            contents: [{ role: "user", parts: [{ text: prompt }] }],
            generationConfig: {
                responseMimeType: "application/json",
                thinkingConfig: { thinkingBudget: 16384 },
            },
        });
        const response = await result.response;
        let text = response.text();
        text = text.replace(/```json/g, '').replace(/```/g, '').trim();
        return JSON.parse(text);
    } catch (e) {
        console.error("[Layer 4] Error:", e.message);
        return {
            totalKeywords: 0,
            keywords: [],
            questionKeywords: [],
            lsiTerms: [],
            longTailGems: [],
        };
    }
}


// ═══════════════════════════════════════════════════════════════════════════
// LAYER 5 — STRATEGIC SYNTHESIS  (Final Reasoning Layer)
// ═══════════════════════════════════════════════════════════════════════════

async function layer5_strategicSynthesis(seed, serpDna, intentData, keywordUniverse, serpSummary) {
    console.log(`[Layer 5] Strategic Synthesis for: ${seed}`);

    const prompt = `
You are the Chief SEO Strategist producing the final actionable intelligence report.

TASK: Synthesize all previous analysis layers into a prioritized action plan for "${seed}".

ANALYSIS INPUTS:
- SERP DNA Profile: ${JSON.stringify(serpDna)}
- Intent Decomposition: ${JSON.stringify(intentData)}
- Keyword Universe (${keywordUniverse.totalKeywords} keywords): ${JSON.stringify(keywordUniverse.keywords?.slice(0, 30))}
- Long-Tail Gems: ${JSON.stringify(keywordUniverse.longTailGems)}
- Question Keywords: ${JSON.stringify(keywordUniverse.questionKeywords)}
- Heuristic Summary: ${JSON.stringify(serpSummary)}

THINK DEEPLY to produce the most actionable, realistic strategy. Avoid optimism bias. 
Be brutally honest about difficulty and timeline.

RETURN this exact JSON schema:
{
    "difficulty": {
        "score": number 0-100,
        "label": "Easy | Moderate | Hard | Very Hard | Near Impossible",
        "reason": "string — why this difficulty score"
    },
    "viability": {
        "soloCreator": { "verdict": "High | Medium | Low", "reason": "string" },
        "smallBusiness": { "verdict": "High | Medium | Low", "reason": "string" },
        "brand": { "verdict": "High | Medium | Low", "reason": "string" }
    },
    "clusters": [
        {
            "name": "string — cluster name",
            "priority": "P0 | P1 | P2 | P3",
            "intent": "string — dominant intent",
            "keywords": [
                { "term": "string", "intent": "string", "volume": "string", "opportunityScore": number }
            ],
            "contentFormat": "string — recommended format for this cluster",
            "estimatedTraffic": "High | Medium | Low"
        }
    ],
    "quickWins": [
        {
            "keyword": "string",
            "reason": "string — why this is a quick win",
            "action": "string — specific immediate action",
            "timeToRank": "string — estimated time"
        }
    ],
    "contentBlueprint": {
        "primaryFormat": "string — e.g., 'Ultimate Guide + Tool Comparison'",
        "wordCountTarget": "string — e.g., '3000-5000 words'",
        "uniqueAngle": "string — what differentiates this from current top results",
        "mustInclude": ["list of must-include elements"],
        "avoid": ["list of things to avoid"],
        "timeToImpact": "string — realistic timeline",
        "confidence": "High | Medium | Low"
    },
    "alternativeStrategy": {
        "angle": "string — alternative approach if primary is too competitive",
        "reason": "string — why this alternative works",
        "keywords": ["list of 3-5 alternative keywords to target"]
    },
    "contentGap": "string — the single biggest content gap opportunity",
    "executionPriority": [
        "string — step 1",
        "string — step 2",
        "string — step 3",
        "string — step 4",
        "string — step 5"
    ]
}`;

    try {
        const result = await advancedModel.generateContent({
            contents: [{ role: "user", parts: [{ text: prompt }] }],
            generationConfig: {
                responseMimeType: "application/json",
                thinkingConfig: { thinkingBudget: 16384 },
            },
        });
        const response = await result.response;
        let text = response.text();
        text = text.replace(/```json/g, '').replace(/```/g, '').trim();
        return JSON.parse(text);
    } catch (e) {
        console.error("[Layer 5] Error:", e.message);
        return {
            difficulty: { score: 0, label: "Unknown", reason: "Analysis failed" },
            viability: {
                soloCreator: { verdict: "Unknown", reason: "Analysis failed" },
                smallBusiness: { verdict: "Unknown", reason: "Analysis failed" },
                brand: { verdict: "Unknown", reason: "Analysis failed" },
            },
            clusters: [],
            quickWins: [],
            contentBlueprint: {
                primaryFormat: "Unknown",
                wordCountTarget: "Unknown",
                uniqueAngle: "Unknown",
                mustInclude: [],
                avoid: [],
                timeToImpact: "Unknown",
                confidence: "Low",
            },
            alternativeStrategy: { angle: "Retry", reason: "Analysis failed", keywords: [] },
            contentGap: "Analysis failed",
            executionPriority: [],
        };
    }
}


// ═══════════════════════════════════════════════════════════════════════════
// CONTROLLER — V2 Advanced Research (5-Layer Pipeline)
// ═══════════════════════════════════════════════════════════════════════════

async function researchKeywordV2(req, res) {
    const { seed } = req.body;
    if (!seed) return res.status(400).json({ error: "Seed keyword required" });

    try {
        console.log(`\n${'═'.repeat(60)}`);
        console.log(`  ADVANCED KEYWORD INTELLIGENCE: "${seed}"`);
        console.log(`${'═'.repeat(60)}\n`);

        // ── Layer 1: Data Collection ────────────────────────────────
        console.log(`[Pipeline] Layer 1 — Data Collection...`);
        const [suggestions, serpData] = await Promise.all([
            fetchAutocomplete(seed),
            fetchSERP(seed),
        ]);
        const serpSummary = await analyzeSERP(serpData.organic, suggestions);
        console.log(`[Pipeline] Layer 1 ✓ — ${suggestions.length} suggestions, ${serpData.organic.length} SERP results, ${serpData.paaQuestions.length} PAA`);

        // ── Layer 2: SERP DNA Intelligence ──────────────────────────
        console.log(`[Pipeline] Layer 2 — SERP DNA Intelligence...`);
        const serpDna = await layer2_serpDna(seed, serpData, serpSummary, suggestions);
        console.log(`[Pipeline] Layer 2 ✓ — SERP Personality: ${serpDna.serpPersonality}`);

        // ── Layer 3: Intent Decomposition ───────────────────────────
        console.log(`[Pipeline] Layer 3 — Intent Decomposition...`);
        const intentData = await layer3_intentDecomposition(seed, serpData, serpDna, suggestions);
        console.log(`[Pipeline] Layer 3 ✓ — Primary Intent: ${intentData.primaryIntent}`);

        // ── Layer 4: Keyword Universe Expansion ─────────────────────
        console.log(`[Pipeline] Layer 4 — Keyword Universe Expansion...`);
        const keywordUniverse = await layer4_keywordUniverse(seed, serpData, serpDna, intentData, suggestions);
        console.log(`[Pipeline] Layer 4 ✓ — ${keywordUniverse.totalKeywords} keywords discovered`);

        // ── Layer 5: Strategic Synthesis ─────────────────────────────
        console.log(`[Pipeline] Layer 5 — Strategic Synthesis...`);
        const strategy = await layer5_strategicSynthesis(seed, serpDna, intentData, keywordUniverse, serpSummary);
        console.log(`[Pipeline] Layer 5 ✓ — Difficulty: ${strategy.difficulty.score}/100`);

        console.log(`\n${'═'.repeat(60)}`);
        console.log(`  PIPELINE COMPLETE for "${seed}"`);
        console.log(`${'═'.repeat(60)}\n`);

        // ── Assemble Final Response ─────────────────────────────────
        res.json({
            seed,
            serp: serpData.organic,
            serpRaw: {
                paaQuestions: serpData.paaQuestions,
                relatedSearches: serpData.relatedSearches,
                knowledgeGraph: serpData.knowledgeGraph,
                serpFeatures: serpData.serpFeatures,
                totalResults: serpData.totalResults,
            },
            serpSummary,
            serpDna,
            intentData,
            keywordUniverse,
            strategy,
            // Backward compatibility mapping
            analysis: {
                difficulty: strategy.difficulty,
                viability: {
                    soloCreator: strategy.viability.soloCreator.verdict,
                    smallBusiness: strategy.viability.smallBusiness.verdict,
                    brand: strategy.viability.brand.verdict,
                },
                recommendedStrategy: {
                    format: strategy.contentBlueprint.primaryFormat,
                    angle: strategy.contentBlueprint.uniqueAngle,
                    avoid: strategy.contentBlueprint.avoid?.join(', ') || '',
                    timeToImpact: strategy.contentBlueprint.timeToImpact,
                    confidence: strategy.contentBlueprint.confidence,
                },
                alternativeStrategy: strategy.alternativeStrategy,
                clusters: strategy.clusters,
                contentGap: strategy.contentGap,
            },
            metadata: {
                model: process.env.GEMINI_KEYWORD_MODEL || "gemini-3.1-pro-preview",
                layers: 5,
                timestamp: new Date().toISOString(),
            },
        });

    } catch (e) {
        console.error("Advanced Research Failed:", e);
        res.status(500).json({ error: e.message });
    }
}


// ═══════════════════════════════════════════════════════════════════════════
// LEGACY CONTROLLER — V1 (backward compat)
// ═══════════════════════════════════════════════════════════════════════════

async function analyzeWithGemini(seed, suggestions, serpResults, serpSummary) {
    const serpContext = serpResults.length > 0
        ? JSON.stringify(serpResults.slice(0, 5))
        : "No live SERP data available. Rely on your internal knowledge of this topic.";
    const summaryContext = serpSummary
        ? JSON.stringify(serpSummary, null, 2)
        : "No automated SERP summary available.";

    const prompt = `You are a SERP Feasibility Analyst. Analyze "${seed}".
    Autocomplete: ${JSON.stringify(suggestions.slice(0, 15))}
    SERP: ${serpContext}
    Summary: ${summaryContext}
    Return valid JSON with: difficulty, viability, recommendedStrategy, alternativeStrategy, clusters, contentGap.`;

    try {
        const result = await legacyModel.generateContent(prompt);
        const response = await result.response;
        let text = response.text();
        text = text.replace(/```json/g, '').replace(/```/g, '').trim();
        return JSON.parse(text);
    } catch (e) {
        console.error("Gemini Error:", e);
        throw new Error("AI Analysis Failed");
    }
}

async function researchKeyword(req, res) {
    const { seed } = req.body;
    if (!seed) return res.status(400).json({ error: "Seed keyword required" });

    try {
        console.log(`Starting Legacy Research for: ${seed}`);
        const [suggestions, serpData] = await Promise.all([
            fetchAutocomplete(seed),
            fetchSERP(seed),
        ]);
        const serpSummary = await analyzeSERP(serpData.organic, suggestions);
        const analysis = await analyzeWithGemini(seed, suggestions, serpData.organic, serpSummary);
        res.json({ seed, serp: serpData.organic, serpSummary, analysis });
    } catch (e) {
        console.error("Research Failed:", e);
        res.status(500).json({ error: e.message });
    }
}


// ═══════════════════════════════════════════════════════════════════════════
// CONTENT DENSITY SCANNER
// ═══════════════════════════════════════════════════════════════════════════

async function analyzePageContent(req, res) {
    const { url } = req.body;
    if (!url) return res.status(400).json({ error: "URL is required" });

    try {
        console.log(`[Content Scanner] Fetching: ${url}`);
        const { data } = await axios.get(url, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
            timeout: 5000
        });

        const $ = cheerio.load(data);
        $('script, style, noscript, nav, footer, header').remove();
        const text = $('body').text().replace(/\s+/g, ' ').toLowerCase().trim();

        const words = text.split(/[^a-z0-9]+/);
        const stopWords = new Set(['the', 'and', 'to', 'of', 'a', 'in', 'is', 'that', 'for', 'it', 'on', 'with', 'as', 'are', 'this', 'by', 'be', 'at', 'or', 'from', 'an', 'was', 'not', 'but', 'can', 'will', 'if', 'has', 'more', 'about', 'one', 'all', 'so', 'we', 'your', 'my', 'you', 'they', 'our', 'us', 'do', 'how']);

        const ngrams = {};
        const addNgram = (phrase) => {
            if (phrase.split(' ').some(w => stopWords.has(w) || w.length < 3)) return;
            ngrams[phrase] = (ngrams[phrase] || 0) + 1;
        };

        for (let i = 0; i < words.length; i++) {
            if (words[i].length > 2 && !stopWords.has(words[i])) ngrams[words[i]] = (ngrams[words[i]] || 0) + 1;
            if (i < words.length - 1) addNgram(words[i] + ' ' + words[i + 1]);
            if (i < words.length - 2) addNgram(words[i] + ' ' + words[i + 1] + ' ' + words[i + 2]);
        }

        const sorted = Object.entries(ngrams)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 20)
            .map(([keyword, count]) => ({ keyword, count, density: ((count / words.length) * 100).toFixed(2) + '%' }));

        res.json({ url, totalWords: words.length, topKeywords: sorted });

    } catch (e) {
        console.error("Content Scan Failed:", e.message);
        res.status(500).json({ error: "Failed to scan page content. It might be blocking bots." });
    }
}

module.exports = { researchKeyword, researchKeywordV2, analyzePageContent };
