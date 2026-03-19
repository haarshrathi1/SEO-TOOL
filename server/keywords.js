const axios = require('axios');
const cheerio = require('cheerio');

const {
    runKeywordResearchV2,
    runLegacyKeywordResearch,
} = require('./keywordResearchService');

async function researchKeywordV2(req, res) {
    const seed = typeof req.body?.seed === 'string' ? req.body.seed.trim() : '';
    if (!seed) {
        return res.status(400).json({ error: 'Seed keyword required' });
    }

    try {
        const result = await runKeywordResearchV2(seed, {
            projectId: req.body?.projectId || null,
        });
        return res.json(result);
    } catch (error) {
        console.error('Advanced Research Failed:', error);
        return res.status(500).json({ error: error.message });
    }
}

async function researchKeyword(req, res) {
    const seed = typeof req.body?.seed === 'string' ? req.body.seed.trim() : '';
    if (!seed) {
        return res.status(400).json({ error: 'Seed keyword required' });
    }

    try {
        const result = await runLegacyKeywordResearch(seed, {
            projectId: req.body?.projectId || null,
        });
        return res.json(result);
    } catch (error) {
        console.error('Research Failed:', error);
        return res.status(500).json({ error: error.message });
    }
}

async function analyzePageContent(req, res) {
    const { url } = req.body;
    if (!url) {
        return res.status(400).json({ error: 'URL is required' });
    }

    try {
        console.log(`[Content Scanner] Fetching: ${url}`);
        const response = await axios.get(url, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
            timeout: 5000,
        });

        const $ = cheerio.load(response.data);
        $('script, style, noscript, nav, footer, header').remove();
        const text = $('body').text().replace(/\s+/g, ' ').toLowerCase().trim();

        const words = text.split(/[^a-z0-9]+/);
        const stopWords = new Set(['the', 'and', 'to', 'of', 'a', 'in', 'is', 'that', 'for', 'it', 'on', 'with', 'as', 'are', 'this', 'by', 'be', 'at', 'or', 'from', 'an', 'was', 'not', 'but', 'can', 'will', 'if', 'has', 'more', 'about', 'one', 'all', 'so', 'we', 'your', 'my', 'you', 'they', 'our', 'us', 'do', 'how']);

        const ngrams = {};
        const addNgram = (phrase) => {
            if (phrase.split(' ').some((word) => stopWords.has(word) || word.length < 3)) {
                return;
            }
            ngrams[phrase] = (ngrams[phrase] || 0) + 1;
        };

        for (let index = 0; index < words.length; index += 1) {
            if (words[index].length > 2 && !stopWords.has(words[index])) {
                ngrams[words[index]] = (ngrams[words[index]] || 0) + 1;
            }
            if (index < words.length - 1) {
                addNgram(`${words[index]} ${words[index + 1]}`);
            }
            if (index < words.length - 2) {
                addNgram(`${words[index]} ${words[index + 1]} ${words[index + 2]}`);
            }
        }

        const topKeywords = Object.entries(ngrams)
            .sort((left, right) => right[1] - left[1])
            .slice(0, 20)
            .map(([keyword, count]) => ({
                keyword,
                count,
                density: `${((count / words.length) * 100).toFixed(2)}%`,
            }));

        return res.json({ url, totalWords: words.length, topKeywords });
    } catch (error) {
        console.error('Content Scan Failed:', error.message);
        return res.status(500).json({ error: 'Failed to scan page content. It might be blocking bots.' });
    }
}

module.exports = {
    researchKeyword,
    researchKeywordV2,
    analyzePageContent,
};
