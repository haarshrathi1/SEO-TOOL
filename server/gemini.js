require('dotenv').config();

const { launchBrowser } = require('./browser');
const { BACKEND_VERTEX, generateJson } = require('./genaiProvider');

async function fetchPageContent(url) {
    console.log(`Fetching content for analysis: ${url}`);
    let browser = null;

    try {
        browser = await launchBrowser();
        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

        await page.setRequestInterception(true);
        page.on('request', (request) => {
            if (['image', 'stylesheet', 'font', 'media'].includes(request.resourceType())) {
                request.abort();
            } else {
                request.continue();
            }
        });

        await page.goto(url, { waitUntil: 'networkidle0', timeout: 60000 });

        const content = await page.evaluate(() => {
            const noisyNodes = document.querySelectorAll('script, style, noscript, iframe, svg');
            noisyNodes.forEach((node) => node.remove());
            return document.body.innerText;
        });

        console.log(`Fetched content length for ${url}: ${content.length}`);
        return content;
    } catch (error) {
        console.error('Puppeteer Fetch Error:', error);
        throw new Error(`Failed to fetch live content: ${error.message}`);
    } finally {
        if (browser) {
            await browser.close();
        }
    }
}

async function analyzePageContent(url, content) {
    let textToAnalyze = content;
    if (!textToAnalyze) {
        textToAnalyze = await fetchPageContent(url);
    }

    if (!textToAnalyze || textToAnalyze.trim().length < 50) {
        throw new Error('Content is too short or empty.');
    }

    const prompt = `
You are an expert Technical SEO Consultant.
Analyze the following content from the web page: ${url}

Content Preview:
${textToAnalyze.slice(0, 15000)}... (truncated for context)

Task:
1. Identify the primary topic or keyword intent.
2. Suggest an improved Page Title (max 60 chars).
3. Suggest an improved Meta Description (max 160 chars).
4. List 3 critical missing semantic topics or keywords that competitors likely cover.
5. Rate the content depth on a scale of 0-100.

Return strictly valid JSON:
{
  "topic": "string",
  "suggestedTitle": "string",
  "suggestedDescription": "string",
  "missingTopics": ["string", "string", "string"],
  "score": 85,
  "reasoning": "string"
}`;

    try {
        const response = await generateJson({
            modelType: 'page',
            preferredBackend: BACKEND_VERTEX,
            taskName: 'page content analysis',
            contents: prompt,
            config: {
                temperature: 0.4,
                maxOutputTokens: 4096,
            },
        });

        return response.data;
    } catch (error) {
        console.error('GenAI Analysis Error:', error);
        throw new Error(`AI Analysis Error: ${error.message || 'Unknown error'}`);
    }
}

module.exports = { analyzePageContent };
