const axios = require('axios');

const {
    BACKEND_VERTEX,
    formatBackendLabel,
    generateJson,
    getProviderRuntime,
} = require('./genaiProvider');

const TOTAL_LAYERS = 5;
const LAYER_LABELS = {
    1: 'Collecting data',
    2: 'SERP DNA analysis',
    3: 'Intent decomposition',
    4: 'Keyword expansion',
    5: 'Strategic synthesis',
};

function getRuntimeProviderLabel() {
    const runtime = getProviderRuntime();
    const fallbackLabel = runtime.allowGeminiFallback && runtime.availableBackends.includes('gemini')
        ? ' with Gemini backup'
        : '';
    const primaryLabel = formatBackendLabel(runtime.primaryBackend);
    return `${primaryLabel} primary${fallbackLabel}`;
}

function clampPercent(value) {
    return Math.max(0, Math.min(100, Math.round(value)));
}

function getLayerPercent(layer, phase = 'start') {
    const completedShare = ((Math.max(1, layer) - 1) / TOTAL_LAYERS) * 100;
    if (phase === 'complete') {
        return clampPercent((layer / TOTAL_LAYERS) * 100);
    }
    if (phase === 'mid') {
        return clampPercent(completedShare + (100 / TOTAL_LAYERS) * 0.55);
    }
    return clampPercent(completedShare + (100 / TOTAL_LAYERS) * 0.15);
}

async function pushProgress(onProgress, update) {
    if (typeof onProgress !== 'function') {
        return;
    }

    await onProgress(update);
}

function buildProgressUpdate(layer, message, options = {}) {
    const safeLayer = Math.max(0, Math.min(TOTAL_LAYERS, Number(layer) || 0));
    const completed = options.phase === 'complete'
        ? safeLayer
        : Math.max(0, safeLayer - (safeLayer > 0 ? 1 : 0));

    return {
        stage: options.stage || (safeLayer > 0 ? `Layer ${safeLayer}` : 'Queued'),
        label: options.label || (safeLayer > 0 ? LAYER_LABELS[safeLayer] : 'Queued'),
        currentLayer: safeLayer,
        totalLayers: TOTAL_LAYERS,
        completed,
        total: TOTAL_LAYERS,
        percent: options.percent ?? getLayerPercent(safeLayer || 1, options.phase || 'start'),
        message,
        provider: options.provider || getRuntimeProviderLabel(),
    };
}

function createProviderEventHandler({ onProgress, layer, label }) {
    return (event) => {
        if (typeof onProgress !== 'function') {
            return;
        }

        if (event.type === 'retry') {
            void pushProgress(onProgress, buildProgressUpdate(layer, `${event.provider} is busy. Retrying ${label.toLowerCase()} (${event.attempt}/${event.maxAttempts})...`, {
                phase: 'mid',
            }));
            return;
        }

        if (event.type === 'fallback') {
            const fromLabel = formatBackendLabel(event.from);
            const toLabel = formatBackendLabel(event.to);
            void pushProgress(onProgress, buildProgressUpdate(layer, `${fromLabel} hit a limit. Switching ${label.toLowerCase()} to ${toLabel}.`, {
                phase: 'mid',
                provider: `${toLabel} active`,
            }));
            return;
        }

        if (event.type === 'model_fallback') {
            void pushProgress(onProgress, buildProgressUpdate(layer, `${event.fromModel} was unavailable. Retrying ${label.toLowerCase()} with ${event.toModel}.`, {
                phase: 'mid',
            }));
        }
    };
}

function buildMetadata(meta) {
    return {
        model: meta?.model || getProviderRuntime().keywordModel,
        layers: TOTAL_LAYERS,
        timestamp: new Date().toISOString(),
        provider: meta?.provider || getRuntimeProviderLabel(),
        backend: meta?.backend || getProviderRuntime().primaryBackend,
    };
}

function buildAnalysisMapping(strategy) {
    return {
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
    };
}

function normalizeSeed(seed) {
    return typeof seed === 'string' ? seed.trim() : '';
}

function shouldUseGroundedSearchFallback(suggestions, serpData) {
    const organicCount = serpData?.organic?.length || 0;
    const questionCount = serpData?.paaQuestions?.length || 0;
    const relatedCount = serpData?.relatedSearches?.length || 0;
    const suggestionCount = suggestions?.length || 0;

    if (organicCount === 0) {
        return true;
    }

    if (organicCount < 5) {
        return true;
    }

    return suggestionCount < 5 && (questionCount + relatedCount) < 4;
}

function hasUsableKeywordSourceData(suggestions, serpData, groundedSearch) {
    const organicCount = serpData?.organic?.length || 0;
    const groundedSignals = (groundedSearch?.topDomains?.length || 0)
        + (groundedSearch?.relatedQueries?.length || 0)
        + (groundedSearch?.questions?.length || 0);

    return organicCount > 0 || groundedSignals > 0;
}

async function fetchGroundedSearchSnapshot(seed, options = {}) {
    const runtime = getProviderRuntime();
    const prompt = `
You are a search research verifier using Google Search grounding.

TASK: Verify the live search landscape for "${seed}" and return only grounded, non-speculative output.

RULES:
1. Do not invent search volume, CPC, keyword difficulty, or ranking metrics.
2. Use short, factual phrases only when supported by Google Search grounding.
3. If a field is uncertain, return an empty array or "Unknown".
4. Keep "topDomains" to at most 5 items.
5. Keep "relatedQueries", "questions", and "searchHighlights" to at most 6 items each.

Return this exact JSON schema:
{
  "summary": "string",
  "topDomains": ["string"],
  "relatedQueries": ["string"],
  "questions": ["string"],
  "searchHighlights": ["string"],
  "freshness": "Evergreen | Mixed | Fresh | Unknown"
}`;

    const response = await generateJson({
        modelType: 'keyword',
        model: runtime.groundedSearchModel,
        modelFallbacks: [runtime.keywordModel, ...runtime.keywordModelFallbacks],
        preferredBackend: options.preferredBackend || BACKEND_VERTEX,
        taskName: 'grounded search verification',
        contents: prompt,
        useGoogleSearchGrounding: true,
        config: {
            temperature: 0.2,
            maxOutputTokens: 4096,
            tools: [{ type: 'google_search' }],
        },
        onEvent: createProviderEventHandler({
            onProgress: options.onProgress,
            layer: 1,
            label: 'grounded search verification',
        }),
    });

    return { data: response.data, meta: response };
}

async function fetchAutocomplete(seed) {
    try {
        const suffixes = ['', ' best', ' how to', ' vs', ' for', ' tools', ' examples', ' tips'];
        const allSuggestions = new Set();

        await Promise.all(suffixes.map(async (suffix) => {
            try {
                const url = `http://google.com/complete/search?client=chrome&q=${encodeURIComponent(seed + suffix)}`;
                const response = await axios.get(url, { timeout: 3000 });
                if (response.data && response.data[1]) {
                    response.data[1].forEach((suggestion) => allSuggestions.add(suggestion));
                }
            } catch {
                // Ignore partial autocomplete failures.
            }
        }));

        return [...allSuggestions];
    } catch (error) {
        console.error('Autocomplete fetch failed:', error.message);
        return [];
    }
}

async function fetchSERP(query) {
    console.log(`[SerpApi] Fetching results for: ${query}`);

    try {
        if (!process.env.SERP_API_KEY) {
            throw new Error('SERP_API_KEY is missing in .env');
        }

        const response = await axios.get('https://serpapi.com/search.json', {
            params: {
                api_key: process.env.SERP_API_KEY,
                engine: 'google',
                q: query,
                google_domain: 'google.com',
                gl: 'us',
                hl: 'en',
            },
        });

        if (response.data.error) {
            throw new Error(response.data.error);
        }

        const organicResults = response.data.organic_results || [];
        const organic = organicResults.slice(0, 10).map((item) => ({
            title: item.title,
            url: item.link,
            snippet: item.snippet || 'No snippet available',
            position: item.position,
            displayed_link: item.displayed_link,
            sitelinks: Boolean(item.sitelinks),
        }));

        const paaQuestions = (response.data.related_questions || []).map((question) => ({
            question: question.question,
            snippet: question.snippet || '',
            title: question.title || '',
            link: question.link || '',
        }));

        const relatedSearches = (response.data.related_searches || []).map((item) => item.query);
        const knowledgeGraph = response.data.knowledge_graph ? {
            title: response.data.knowledge_graph.title,
            type: response.data.knowledge_graph.type,
            description: response.data.knowledge_graph.description,
        } : null;

        const serpFeatures = [];
        if (response.data.answer_box) serpFeatures.push('featured_snippet');
        if (response.data.knowledge_graph) serpFeatures.push('knowledge_graph');
        if (response.data.related_questions) serpFeatures.push('people_also_ask');
        if (response.data.local_results) serpFeatures.push('local_pack');
        if (response.data.shopping_results) serpFeatures.push('shopping');
        if (response.data.inline_videos) serpFeatures.push('video_carousel');
        if (response.data.inline_images) serpFeatures.push('image_pack');
        if (response.data.top_stories) serpFeatures.push('top_stories');

        console.log(`[SerpApi] Successfully fetched ${organic.length} results, ${paaQuestions.length} PAA, ${relatedSearches.length} related.`);

        return {
            organic,
            paaQuestions,
            relatedSearches,
            knowledgeGraph,
            serpFeatures,
            totalResults: response.data.search_information?.total_results || 0,
        };
    } catch (error) {
        console.error('[SerpApi] Error:', error.message);
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

async function getQuickWordCount(url) {
    try {
        const response = await axios.get(url, {
            timeout: 3000,
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
        });
        const text = response.data.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
        return text.split(' ').length;
    } catch {
        return null;
    }
}

async function analyzeSERP(organic, suggestions = []) {
    if (!organic || organic.length === 0) {
        return null;
    }

    let totalDateCount = 0;
    const types = { informational: 0, transactional: 0, listicle: 0, navigational: 0 };
    const domains = organic.map((result) => {
        try {
            return new URL(result.url).hostname.replace('www.', '');
        } catch {
            return '';
        }
    });

    const tier1 = ['amazon', 'youtube', 'reddit', 'pinterest', 'quora', 'facebook', 'instagram', 'linkedin', 'twitter', 'tiktok', 'medium'];
    const tier2 = ['forbes', 'nytimes', 'healthline', 'investopedia', 'hubspot', 'g2', 'capterra', 'techcrunch', 'theverge', 'cnn', 'bbc', 'webmd'];
    let brandScore = 0;
    const domainTypes = { tier1: 0, tier2: 0, indie: 0 };

    domains.forEach((domain) => {
        if (tier1.some((brand) => domain.includes(brand))) {
            brandScore += 3;
            domainTypes.tier1 += 1;
        } else if (tier2.some((brand) => domain.includes(brand))) {
            brandScore += 2;
            domainTypes.tier2 += 1;
        } else {
            brandScore += 1;
            domainTypes.indie += 1;
        }
    });

    const maxScore = organic.length * 3;
    const brandPressure = Math.round((brandScore / maxScore) * 100);

    organic.forEach((result) => {
        const text = `${result.title} ${result.snippet}`.toLowerCase();
        if (/\d{1,2} (jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec) \d{4}/i.test(result.snippet)
            || /\d+ (days?|hours?|mins?) ago/i.test(result.snippet)) {
            totalDateCount += 1;
        }

        if (text.includes('best') || text.includes('top ') || text.includes('review') || text.includes(' vs ')) {
            types.listicle += 1;
        } else if (text.includes('buy') || text.includes('shop') || text.includes('price') || text.includes('sale') || text.includes('cart')) {
            types.transactional += 1;
        } else if (text.includes('how to') || text.includes('guide') || text.includes('tutorial') || text.includes('what is')) {
            types.informational += 1;
        } else {
            types.informational += 1;
        }
    });

    let avgWords = 0;
    try {
        const topThree = organic.slice(0, 3);
        const counts = await Promise.all(topThree.map((result) => getQuickWordCount(result.url)));
        const validCounts = counts.filter((count) => count !== null);
        if (validCounts.length > 0) {
            avgWords = Math.round(validCounts.reduce((sum, count) => sum + count, 0) / validCounts.length);
        }
    } catch {
        // Keep heuristic fallback.
    }

    const dominantType = Object.keys(types).reduce((left, right) => (types[left] > types[right] ? left : right));
    const sortedTypes = Object.entries(types).sort((left, right) => right[1] - left[1]);
    const secondaryType = sortedTypes[1]?.[0] || 'none';
    const confidence = (types[dominantType] / organic.length).toFixed(2);

    let freshnessDir = 'Irrelevant';
    if (totalDateCount > 5) freshnessDir = 'Required';
    else if (totalDateCount > 2) freshnessDir = 'Optional';

    const autocompleteDensity = Math.min((suggestions.length / 15) * 25, 25);
    let featureCount = 0;
    organic.forEach((result) => {
        const snippet = result.snippet.toLowerCase();
        if (snippet.includes('rating') || snippet.includes('star') || snippet.includes('vote') || snippet.includes('review') || result.title.toLowerCase().includes('video')) {
            featureCount += 1;
        }
    });

    const serpFeaturesScore = Math.min((featureCount / 5) * 25, 25);
    const trendDirection = Math.min((totalDateCount / 6) * 25, 25);
    let ugcCount = 0;
    const ugcDomains = ['reddit', 'quora', 'pinterest', 'medium', 'youtube', 'tiktok', 'facebook', 'instagram', 'twitter', 'linkedin'];
    domains.forEach((domain) => {
        if (ugcDomains.some((ugcDomain) => domain.includes(ugcDomain))) {
            ugcCount += 1;
        }
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
        intentClarity: types[dominantType] >= (organic.length * 0.6) ? 'Clear' : 'Mixed',
        volumeScore,
        volumeBreakdown: {
            autocompleteDensity: Math.round(autocompleteDensity),
            serpFeatures: Math.round(serpFeaturesScore),
            trendDirection: Math.round(trendDirection),
            ugcFrequency: Math.round(ugcFrequency),
        },
    };
}

async function layer2SerpDna(seed, serpData, serpSummary, suggestions, groundedSearch, options = {}) {
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
- Grounded Search Verification: ${JSON.stringify(groundedSearch)}

Think deeply about:
1. What is Google's ideal result for this query?
2. What E-E-A-T signals are present in the top results?
3. What content patterns dominate?
4. Where are the gaps in the current SERP?
5. What topical authority signals does Google require?

OUTPUT STYLE:
- Keep the output concise and card-friendly.
- "googleWants", "topicalAuthority", "rankerProfile", and "opportunityAngle" must each be one short sentence, max 18 words.
- Each E-E-A-T value must be max 10 words.
- "contentFormatDominance" must contain at most 4 items, 1-3 words each.
- "contentGaps" must contain at most 4 items, max 12 words each.

Return this exact JSON schema:
{
  "serpPersonality": "Knowledge Hub | Commercial Battlefield | Tutorial Playground | News Feed | Community Forum | Mixed Bazaar",
  "googleWants": "string",
  "contentFormatDominance": ["string"],
  "eatSignals": {
    "experience": "string",
    "expertise": "string",
    "authority": "string",
    "trust": "string"
  },
  "topicalAuthority": "string",
  "contentGaps": ["string"],
  "rankerProfile": "string",
  "difficultyVerdict": "Easy Pickings | Moderate Fight | Tough Battle | Near Impossible",
  "opportunityAngle": "string"
}`;

    try {
        const response = await generateJson({
            modelType: 'keyword',
            preferredBackend: options.preferredBackend || BACKEND_VERTEX,
            taskName: 'SERP DNA analysis',
            contents: prompt,
            config: {
                temperature: 0.2,
                maxOutputTokens: 65536,
                thinkingConfig: { thinkingBudget: 8192 },
            },
            onEvent: createProviderEventHandler({
                onProgress: options.onProgress,
                layer: 2,
                label: 'SERP DNA analysis',
            }),
        });

        return { data: response.data, meta: response };
    } catch (error) {
        console.error('[Layer 2] Error:', error.message);
        return {
            data: {
                serpPersonality: 'Mixed Bazaar',
                googleWants: 'Unable to determine due to analysis error.',
                contentFormatDominance: ['unknown'],
                eatSignals: { experience: 'N/A', expertise: 'N/A', authority: 'N/A', trust: 'N/A' },
                topicalAuthority: 'Unable to determine',
                contentGaps: [],
                rankerProfile: 'Unknown',
                difficultyVerdict: 'Unknown',
                opportunityAngle: 'Retry analysis with more data.',
            },
            meta: null,
        };
    }
}

async function layer3IntentDecomposition(seed, serpData, serpDna, suggestions, groundedSearch, options = {}) {
    console.log(`[Layer 3] Intent Decomposition for: ${seed}`);

    const prompt = `
You are a Search Intent Psychologist specializing in user behavior analysis.

TASK: Decompose the search intent for "${seed}" across multiple dimensions.

CONTEXT:
- SERP DNA Profile: ${JSON.stringify(serpDna)}
- People Also Ask: ${JSON.stringify(serpData.paaQuestions)}
- Related Searches: ${JSON.stringify(serpData.relatedSearches)}
- Autocomplete: ${JSON.stringify(suggestions.slice(0, 20))}
- Grounded Search Verification: ${JSON.stringify(groundedSearch)}

Think deeply about:
1. The full spectrum of why someone searches for "${seed}".
2. Where they are in the buyer journey.
3. What micro-intents exist beneath the surface query.
4. How intent shifts based on modifiers and context.

OUTPUT STYLE:
- Keep the output concise and dashboard-friendly.
- "primaryIntent" must be 1-3 words.
- "intentInsight" must be one short sentence, max 18 words.
- "contentAngle" must be max 10 words.
- "microIntents" must contain at most 4 items.
- Each micro-intent "intent" must be max 4 words and "example_query" max 6 words.

Return this exact JSON schema:
{
  "primaryIntent": "string",
  "intentSpectrum": {
    "know": 0,
    "do": 0,
    "go": 0,
    "buy": 0,
    "compare": 0,
    "learn": 0
  },
  "buyerJourney": {
    "awareness": 0,
    "consideration": 0,
    "decision": 0,
    "retention": 0
  },
  "microIntents": [
    {
      "intent": "string",
      "strength": "High | Medium | Low",
      "example_query": "string"
    }
  ],
  "intentInsight": "string",
  "contentAngle": "string"
}`;

    try {
        const response = await generateJson({
            modelType: 'keyword',
            preferredBackend: options.preferredBackend || BACKEND_VERTEX,
            taskName: 'intent decomposition',
            contents: prompt,
            config: {
                temperature: 0.2,
                maxOutputTokens: 65536,
                thinkingConfig: { thinkingBudget: 8192 },
            },
            onEvent: createProviderEventHandler({
                onProgress: options.onProgress,
                layer: 3,
                label: 'intent decomposition',
            }),
        });

        return { data: response.data, meta: response };
    } catch (error) {
        console.error('[Layer 3] Error:', error.message);
        return {
            data: {
                primaryIntent: 'Informational',
                intentSpectrum: { know: 50, do: 20, go: 5, buy: 10, compare: 10, learn: 5 },
                buyerJourney: { awareness: 40, consideration: 30, decision: 20, retention: 10 },
                microIntents: [],
                intentInsight: 'Unable to perform deep intent analysis.',
                contentAngle: 'Focus on comprehensive coverage.',
            },
            meta: null,
        };
    }
}

async function layer4KeywordUniverse(seed, serpData, serpDna, intentData, suggestions, groundedSearch, options = {}) {
    console.log(`[Layer 4] Keyword Universe Expansion for: ${seed}`);

    const prompt = `
You are a Keyword Strategist who merges data science with SEO expertise.

TASK: Build a comprehensive keyword universe for "${seed}" using only the data provided.

DATA PROVIDED:
- Autocomplete suggestions: ${JSON.stringify(suggestions)}
- People Also Ask: ${JSON.stringify(serpData.paaQuestions.map((question) => question.question))}
- Related Searches: ${JSON.stringify(serpData.relatedSearches)}
- SERP titles/snippets: ${JSON.stringify(serpData.organic.slice(0, 10).map((result) => ({ title: result.title, snippet: result.snippet })))}
- SERP DNA: ${JSON.stringify(serpDna)}
- Intent Analysis: ${JSON.stringify(intentData)}
- Grounded Search Verification: ${JSON.stringify(groundedSearch)}

RULES:
1. Use only keywords visible in the provided data or semantically implied by titles/snippets.
2. You may generate long-tail variations of visible keywords.
3. Classify every keyword with intent and opportunity score.
4. Opportunity score = (relevance * intent alignment) / estimated difficulty on a 1-100 scale.
5. Limit total keywords to 40-60.

Return this exact JSON schema:
{
  "totalKeywords": 0,
  "keywords": [
    {
      "term": "string",
      "intent": "Informational | Commercial | Transactional | Navigational | Comparison",
      "volume": "High | Medium | Low",
      "difficulty": "Easy | Medium | Hard",
      "opportunityScore": 0,
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
  "lsiTerms": ["string"],
  "longTailGems": [
    {
      "term": "string",
      "reason": "string",
      "opportunityScore": 0
    }
  ]
}`;

    try {
        const response = await generateJson({
            modelType: 'keyword',
            preferredBackend: options.preferredBackend || BACKEND_VERTEX,
            taskName: 'keyword universe expansion',
            contents: prompt,
            config: {
                temperature: 0.2,
                maxOutputTokens: 65536,
                thinkingConfig: { thinkingBudget: 16384 },
            },
            onEvent: createProviderEventHandler({
                onProgress: options.onProgress,
                layer: 4,
                label: 'keyword expansion',
            }),
        });

        return { data: response.data, meta: response };
    } catch (error) {
        console.error('[Layer 4] Error:', error.message);
        return {
            data: {
                totalKeywords: 0,
                keywords: [],
                questionKeywords: [],
                lsiTerms: [],
                longTailGems: [],
            },
            meta: null,
        };
    }
}

async function layer5StrategicSynthesis(seed, serpDna, intentData, keywordUniverse, serpSummary, groundedSearch, options = {}) {
    console.log(`[Layer 5] Strategic Synthesis for: ${seed}`);

    const prompt = `
You are the Chief SEO Strategist producing the final actionable intelligence report.

TASK: Synthesize all previous analysis layers into a prioritized action plan for "${seed}".

ANALYSIS INPUTS:
- SERP DNA Profile: ${JSON.stringify(serpDna)}
- Intent Decomposition: ${JSON.stringify(intentData)}
- Keyword Universe (${keywordUniverse.totalKeywords} keywords): ${JSON.stringify(keywordUniverse.keywords?.slice(0, 30))}
- Long-tail gems: ${JSON.stringify(keywordUniverse.longTailGems)}
- Question keywords: ${JSON.stringify(keywordUniverse.questionKeywords)}
- Heuristic Summary: ${JSON.stringify(serpSummary)}
- Grounded Search Verification: ${JSON.stringify(groundedSearch)}

Think deeply to produce the most actionable, realistic strategy. Avoid optimism bias and be honest about difficulty and timeline.

OUTPUT STYLE:
- Write like an operator brief, not an essay.
- "difficulty.reason", each viability "reason", "contentGap", and "alternativeStrategy.reason" must be one short sentence, max 18 words.
- "contentBlueprint.uniqueAngle" must be max 14 words.
- "clusters" must contain at most 4 items and each cluster should include at most 5 keywords.
- "quickWins" must contain at most 4 items.
- Each quick win "reason" and "action" must be max 12 words.
- "mustInclude" and "avoid" must each contain at most 5 short items, 2-6 words each.
- "alternativeStrategy.keywords" must contain at most 4 items.
- "executionPriority" must contain at most 5 items, max 10 words each.

Return this exact JSON schema:
{
  "difficulty": {
    "score": 0,
    "label": "Easy | Moderate | Hard | Very Hard | Near Impossible",
    "reason": "string"
  },
  "viability": {
    "soloCreator": { "verdict": "High | Medium | Low", "reason": "string" },
    "smallBusiness": { "verdict": "High | Medium | Low", "reason": "string" },
    "brand": { "verdict": "High | Medium | Low", "reason": "string" }
  },
  "clusters": [
    {
      "name": "string",
      "priority": "P0 | P1 | P2 | P3",
      "intent": "string",
      "keywords": [
        { "term": "string", "intent": "string", "volume": "string", "opportunityScore": 0 }
      ],
      "contentFormat": "string",
      "estimatedTraffic": "High | Medium | Low"
    }
  ],
  "quickWins": [
    {
      "keyword": "string",
      "reason": "string",
      "action": "string",
      "timeToRank": "string"
    }
  ],
  "contentBlueprint": {
    "primaryFormat": "string",
    "wordCountTarget": "string",
    "uniqueAngle": "string",
    "mustInclude": ["string"],
    "avoid": ["string"],
    "timeToImpact": "string",
    "confidence": "High | Medium | Low"
  },
  "alternativeStrategy": {
    "angle": "string",
    "reason": "string",
    "keywords": ["string"]
  },
  "contentGap": "string",
  "executionPriority": ["string"]
}`;

    try {
        const response = await generateJson({
            modelType: 'keyword',
            preferredBackend: options.preferredBackend || BACKEND_VERTEX,
            taskName: 'strategic synthesis',
            contents: prompt,
            config: {
                temperature: 0.2,
                maxOutputTokens: 65536,
                thinkingConfig: { thinkingBudget: 16384 },
            },
            onEvent: createProviderEventHandler({
                onProgress: options.onProgress,
                layer: 5,
                label: 'strategic synthesis',
            }),
        });

        return { data: response.data, meta: response };
    } catch (error) {
        console.error('[Layer 5] Error:', error.message);
        return {
            data: {
                difficulty: { score: 0, label: 'Unknown', reason: 'Analysis failed' },
                viability: {
                    soloCreator: { verdict: 'Unknown', reason: 'Analysis failed' },
                    smallBusiness: { verdict: 'Unknown', reason: 'Analysis failed' },
                    brand: { verdict: 'Unknown', reason: 'Analysis failed' },
                },
                clusters: [],
                quickWins: [],
                contentBlueprint: {
                    primaryFormat: 'Unknown',
                    wordCountTarget: 'Unknown',
                    uniqueAngle: 'Unknown',
                    mustInclude: [],
                    avoid: [],
                    timeToImpact: 'Unknown',
                    confidence: 'Low',
                },
                alternativeStrategy: { angle: 'Retry', reason: 'Analysis failed', keywords: [] },
                contentGap: 'Analysis failed',
                executionPriority: [],
            },
            meta: null,
        };
    }
}

async function analyzeWithAi(seed, suggestions, serpResults, serpSummary, options = {}) {
    const serpContext = serpResults.length > 0
        ? JSON.stringify(serpResults.slice(0, 5))
        : 'No live SERP data available. Rely on your internal knowledge of this topic.';
    const summaryContext = serpSummary
        ? JSON.stringify(serpSummary, null, 2)
        : 'No automated SERP summary available.';

    const prompt = `You are a SERP Feasibility Analyst. Analyze "${seed}".
Autocomplete: ${JSON.stringify(suggestions.slice(0, 15))}
SERP: ${serpContext}
Summary: ${summaryContext}
Return valid JSON with: difficulty, viability, recommendedStrategy, alternativeStrategy, clusters, contentGap.`;

    const response = await generateJson({
        modelType: 'keyword',
        preferredBackend: options.preferredBackend || BACKEND_VERTEX,
        taskName: 'legacy keyword analysis',
        contents: prompt,
        config: {
            temperature: 0.8,
            maxOutputTokens: 8192,
        },
        onEvent: createProviderEventHandler({
            onProgress: options.onProgress,
            layer: 5,
            label: 'legacy keyword analysis',
        }),
    });

    return { data: response.data, meta: response };
}

async function runKeywordResearchV2(seedInput, options = {}) {
    const seed = normalizeSeed(seedInput);
    if (!seed) {
        throw new Error('Seed keyword required');
    }

    let lastAiMeta = null;

    await pushProgress(options.onProgress, {
        stage: 'Queued',
        label: 'Queued',
        currentLayer: 0,
        totalLayers: TOTAL_LAYERS,
        completed: 0,
        total: TOTAL_LAYERS,
        percent: 0,
        message: `Queued keyword research for "${seed}"`,
        provider: getRuntimeProviderLabel(),
    });

    console.log(`\n${'='.repeat(60)}`);
    console.log(`  ADVANCED KEYWORD INTELLIGENCE: "${seed}"`);
    console.log(`${'='.repeat(60)}\n`);

    await pushProgress(options.onProgress, buildProgressUpdate(1, 'Collecting autocomplete suggestions and live SERP data...', {
        phase: 'start',
    }));

    const [suggestions, serpData] = await Promise.all([
        fetchAutocomplete(seed),
        fetchSERP(seed),
    ]);

    let groundedSearch = null;

    await pushProgress(options.onProgress, buildProgressUpdate(1, `Fetched ${suggestions.length} autocomplete ideas and ${serpData.organic.length} top SERP results.`, {
        phase: 'mid',
    }));

    if (shouldUseGroundedSearchFallback(suggestions, serpData)) {
        await pushProgress(options.onProgress, buildProgressUpdate(1, 'Live keyword signals are thin. Verifying the query with Google Search grounding...', {
            phase: 'mid',
        }));
        try {
            const groundedSearchResponse = await fetchGroundedSearchSnapshot(seed, options);
            groundedSearch = groundedSearchResponse.data;
            lastAiMeta = groundedSearchResponse.meta || lastAiMeta;
        } catch (error) {
            console.error('[Grounded Search] Error:', error.message);
        }
    }

    if (!hasUsableKeywordSourceData(suggestions, serpData, groundedSearch)) {
        throw new Error(`Keyword research stopped because no reliable search data was available for "${seed}".`);
    }

    const serpSummary = await analyzeSERP(serpData.organic, suggestions);

    await pushProgress(options.onProgress, buildProgressUpdate(1, `Layer 1 complete. ${serpData.paaQuestions.length} People Also Ask prompts and ${serpData.relatedSearches.length} related searches captured.`, {
        phase: 'complete',
    }));

    await pushProgress(options.onProgress, buildProgressUpdate(2, 'Mapping SERP DNA and authority patterns...', {
        phase: 'start',
    }));
    const serpDnaResponse = await layer2SerpDna(seed, serpData, serpSummary, suggestions, groundedSearch, options);
    const serpDna = serpDnaResponse.data;
    lastAiMeta = serpDnaResponse.meta || lastAiMeta;
    await pushProgress(options.onProgress, buildProgressUpdate(2, `Layer 2 complete. SERP personality: ${serpDna.serpPersonality}.`, {
        phase: 'complete',
        provider: serpDnaResponse.meta?.provider || getRuntimeProviderLabel(),
    }));

    await pushProgress(options.onProgress, buildProgressUpdate(3, 'Decomposing user intent and buyer journey signals...', {
        phase: 'start',
        provider: serpDnaResponse.meta?.provider || getRuntimeProviderLabel(),
    }));
    const intentResponse = await layer3IntentDecomposition(seed, serpData, serpDna, suggestions, groundedSearch, options);
    const intentData = intentResponse.data;
    lastAiMeta = intentResponse.meta || lastAiMeta;
    await pushProgress(options.onProgress, buildProgressUpdate(3, `Layer 3 complete. Primary intent: ${intentData.primaryIntent}.`, {
        phase: 'complete',
        provider: intentResponse.meta?.provider || getRuntimeProviderLabel(),
    }));

    await pushProgress(options.onProgress, buildProgressUpdate(4, 'Expanding the keyword universe and scoring opportunities...', {
        phase: 'start',
        provider: intentResponse.meta?.provider || getRuntimeProviderLabel(),
    }));
    const keywordUniverseResponse = await layer4KeywordUniverse(seed, serpData, serpDna, intentData, suggestions, groundedSearch, options);
    const keywordUniverse = keywordUniverseResponse.data;
    lastAiMeta = keywordUniverseResponse.meta || lastAiMeta;
    await pushProgress(options.onProgress, buildProgressUpdate(4, `Layer 4 complete. ${keywordUniverse.totalKeywords} keywords surfaced for prioritization.`, {
        phase: 'complete',
        provider: keywordUniverseResponse.meta?.provider || getRuntimeProviderLabel(),
    }));

    await pushProgress(options.onProgress, buildProgressUpdate(5, 'Synthesizing the strategy and execution plan...', {
        phase: 'start',
        provider: keywordUniverseResponse.meta?.provider || getRuntimeProviderLabel(),
    }));
    const strategyResponse = await layer5StrategicSynthesis(seed, serpDna, intentData, keywordUniverse, serpSummary, groundedSearch, options);
    const strategy = strategyResponse.data;
    lastAiMeta = strategyResponse.meta || lastAiMeta;
    await pushProgress(options.onProgress, buildProgressUpdate(5, `Layer 5 complete. Difficulty scored at ${strategy.difficulty.score}/100.`, {
        phase: 'complete',
        provider: strategyResponse.meta?.provider || getRuntimeProviderLabel(),
        percent: 100,
    }));

    console.log(`\n${'='.repeat(60)}`);
    console.log(`  PIPELINE COMPLETE for "${seed}"`);
    console.log(`${'='.repeat(60)}\n`);

    return {
        seed,
        projectId: options.projectId || null,
        serp: serpData.organic,
        serpRaw: {
            paaQuestions: serpData.paaQuestions,
            relatedSearches: serpData.relatedSearches,
            knowledgeGraph: serpData.knowledgeGraph,
            serpFeatures: serpData.serpFeatures,
            totalResults: serpData.totalResults,
        },
        groundedSearch,
        serpSummary,
        serpDna,
        intentData,
        keywordUniverse,
        strategy,
        analysis: buildAnalysisMapping(strategy),
        metadata: {
            ...buildMetadata(lastAiMeta),
            groundedSearchUsed: Boolean(groundedSearch),
        },
    };
}

async function runLegacyKeywordResearch(seedInput, options = {}) {
    const seed = normalizeSeed(seedInput);
    if (!seed) {
        throw new Error('Seed keyword required');
    }

    console.log(`Starting Legacy Research for: ${seed}`);

    const [suggestions, serpData] = await Promise.all([
        fetchAutocomplete(seed),
        fetchSERP(seed),
    ]);

    const serpSummary = await analyzeSERP(serpData.organic, suggestions);
    const analysisResponse = await analyzeWithAi(seed, suggestions, serpData.organic, serpSummary, options);

    return {
        seed,
        projectId: options.projectId || null,
        serp: serpData.organic,
        serpSummary,
        analysis: analysisResponse.data,
        metadata: buildMetadata(analysisResponse.meta),
    };
}

module.exports = {
    TOTAL_LAYERS,
    getRuntimeProviderLabel,
    runKeywordResearchV2,
    runLegacyKeywordResearch,
};
