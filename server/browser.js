const fs = require('fs');
const { spawnSync } = require('child_process');
const puppeteer = require('puppeteer');

const COMMON_ARGS = [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
];

const LINUX_CHROME_PATHS = [
    '/usr/bin/google-chrome-stable',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
];

let installPromise = null;

function getExecutablePathFromEnvOrSystem() {
    if (process.env.PUPPETEER_EXECUTABLE_PATH) {
        return process.env.PUPPETEER_EXECUTABLE_PATH;
    }

    if (process.platform === 'linux') {
        return LINUX_CHROME_PATHS.find((path) => fs.existsSync(path));
    }

    return undefined;
}

function isMissingChromeError(error) {
    const message = error?.message || '';
    return message.includes('Could not find Chrome') || message.includes('Could not find Chromium');
}

function installChromeForPuppeteer() {
    if (installPromise) {
        return installPromise;
    }

    installPromise = Promise.resolve().then(() => {
        const npxCmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';
        const result = spawnSync(
            npxCmd,
            ['puppeteer', 'browsers', 'install', 'chrome'],
            { stdio: 'inherit', env: process.env }
        );

        if (result.error || result.status !== 0) {
            const installErr = result.error || new Error(`Installer exited with code ${result.status}`);
            throw installErr;
        }
    }).finally(() => {
        installPromise = null;
    });

    return installPromise;
}

async function launchBrowser() {
    const launchOptions = {
        headless: true,
        args: COMMON_ARGS,
    };

    const executablePath = getExecutablePathFromEnvOrSystem();
    if (executablePath) {
        launchOptions.executablePath = executablePath;
    }

    try {
        return await puppeteer.launch(launchOptions);
    } catch (error) {
        if (!isMissingChromeError(error)) {
            throw error;
        }

        console.warn('[Puppeteer] Chrome not found. Attempting one-time install...');

        try {
            await installChromeForPuppeteer();
            return await puppeteer.launch(launchOptions);
        } catch (installError) {
            throw new Error(
                `Chrome for Puppeteer is missing. Configure PUPPETEER_EXECUTABLE_PATH or run "npx puppeteer browsers install chrome". Root cause: ${installError.message}`
            );
        }
    }
}

module.exports = { launchBrowser };
