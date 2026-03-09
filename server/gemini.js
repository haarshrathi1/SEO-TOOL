require('dotenv').config();
const { GoogleGenerativeAI } = require("@google/generative-ai");
const puppeteer = require('puppeteer');

// Access API key (User to provide)
const apiKey = process.env.GEMINI_API_KEY;

let genAI = null;
let model = null;

if (apiKey) {
    genAI = new GoogleGenerativeAI(apiKey);
    // Use gemini-2.0-flash-exp as requested (assuming 2.5 typod)
    model = genAI.getGenerativeModel({ model: "gemini-3-flash-preview" });
}

/**
 * Fetches text content from a URL using Puppeteer.
 * @param {string} url - The URL to fetch.
 * @returns {Promise<string>} - The extracted text content.
 */
async function fetchPageContent(url) {
    console.log(`Fetching content for analysis: ${url}`);
    let browser = null;
    try {
        browser = await puppeteer.launch({
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });
        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

        // Block resources to speed up
        await page.setRequestInterception(true);
        page.on('request', (req) => {
            if (['image', 'stylesheet', 'font', 'media'].includes(req.resourceType())) {
                req.abort();
            } else {
                req.continue();
            }
        });

        await page.goto(url, { waitUntil: 'networkidle0', timeout: 60000 });

        // Extract main content
        const content = await page.evaluate(() => {
            const scripts = document.querySelectorAll('script, style, noscript, iframe, svg');
            scripts.forEach(s => s.remove());
            return document.body.innerText;
        });

        console.log(`Fetched content length for ${url}: ${content.length}`);
        return content;
    } catch (e) {
        console.error("Puppeteer Fetch Error:", e);
        throw new Error(`Failed to fetch live content: ${e.message}`);
    } finally {
        if (browser) await browser.close();
    }
}

/**
 * Analyzes page content using Gemini AI.
 * @param {string} url - The URL of the page.
 * @param {string} content - The extracted text content of the page. If null, will fetch.
 * @returns {Promise<Object>} - Analysis result.
 */
async function analyzePageContent(url, content) {
    if (!model) {
        throw new Error("Gemini API Key is missing. Please configure GEMINI_API_KEY in .env");
    }

    let textToAnalyze = content;

    // Fetch content if missing
    if (!textToAnalyze) {
        textToAnalyze = await fetchPageContent(url);
    }

    if (!textToAnalyze || textToAnalyze.trim().length < 50) {
        throw new Error("Content is too short or empty.");
    }

    const prompt = `
    You are an expert Technical SEO Consultant.
    Analyze the following content from the web page: ${url}
    
    Content Preview:
    ${textToAnalyze.slice(0, 15000)}... (truncated for context)

    Task:
    1. Identify the primary topic/keyword intent.
    2. Suggest an improved Page Title (max 60 chars).
    3. Suggest an improved Meta Description (max 160 chars).
    4. List 3 critical missing semantic topics/keywords that competitors likely cover.
    5. Rate the content depth on a scale of 0-100.

    Return the result in strictly valid JSON format:
    {
        "topic": "...",
        "suggestedTitle": "...",
        "suggestedDescription": "...",
        "missingTopics": ["...", "...", "..."],
        "score": 85,
        "reasoning": "..."
    }
    `;

    try {
        const result = await model.generateContent(prompt);
        const response = await result.response;
        const text = response.text();

        // Sanitize code blocks if present
        const jsonStr = text.replace(/```json/g, '').replace(/```/g, '').trim();
        return JSON.parse(jsonStr);
    } catch (e) {
        console.error("Gemini Analysis Error:", e);
        throw new Error(`Gemini Error: ${e.message || e.statusText || 'Unknown error'}`);
    }
}

module.exports = { analyzePageContent };
