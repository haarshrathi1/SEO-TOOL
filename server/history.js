const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
const HISTORY_FILE = path.join(DATA_DIR, 'history.json');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Ensure history file exists
if (!fs.existsSync(HISTORY_FILE)) {
    fs.writeFileSync(HISTORY_FILE, JSON.stringify([], null, 2));
}

const addToHistory = (analysisData, projectId) => {
    try {
        const fileContent = fs.readFileSync(HISTORY_FILE, 'utf8');
        let history = [];
        try {
            history = JSON.parse(fileContent);
        } catch (parseError) {
            console.error('Error parsing history file, resetting to empty array', parseError);
            history = [];
        }

        const newRecord = {
            id: Date.now().toString(),
            timestamp: new Date().toISOString(),
            projectId,
            data: analysisData
        };

        history.push(newRecord);

        // Optional: Limit history size? User said "save all output", so we keep valid for now.
        // Maybe limit to last 100 to prevent infinite growth if running daily?
        // User said "save all", so I won't limit yet.

        fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2));
        console.log(`Analysis saved to history. Total records: ${history.length}`);
    } catch (error) {
        console.error('Failed to save analysis history:', error);
    }
};

const getHistory = () => {
    try {
        if (!fs.existsSync(HISTORY_FILE)) return [];
        const fileContent = fs.readFileSync(HISTORY_FILE, 'utf8');
        return JSON.parse(fileContent);
    } catch (error) {
        console.error('Failed to read history:', error);
        return [];
    }
};

module.exports = { addToHistory, getHistory };
