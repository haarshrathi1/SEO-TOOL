const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
const AUDIT_HISTORY_FILE = path.join(DATA_DIR, 'audit_history.json');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Ensure history file exists
if (!fs.existsSync(AUDIT_HISTORY_FILE)) {
    fs.writeFileSync(AUDIT_HISTORY_FILE, JSON.stringify([], null, 2));
}

const addAudit = (results, projectId) => {
    try {
        const fileContent = fs.readFileSync(AUDIT_HISTORY_FILE, 'utf8');
        let history = [];
        try {
            history = JSON.parse(fileContent);
        } catch (parseError) {
            console.error('Error parsing audit history file, resetting', parseError);
            history = [];
        }

        const newRecord = {
            id: Date.now().toString(),
            timestamp: new Date().toISOString(),
            projectId,
            results: results // The full array of URL objects
        };

        history.push(newRecord);

        // Keep last 50 audits to avoid huge file
        if (history.length > 50) {
            history = history.slice(-50);
        }

        fs.writeFileSync(AUDIT_HISTORY_FILE, JSON.stringify(history, null, 2));
        console.log(`Audit saved. Total records: ${history.length}`);
    } catch (error) {
        console.error('Failed to save audit history:', error);
    }
};

const getAuditHistory = () => {
    try {
        if (!fs.existsSync(AUDIT_HISTORY_FILE)) return [];
        const fileContent = fs.readFileSync(AUDIT_HISTORY_FILE, 'utf8');
        // We might want to return a summary list (without large 'results' array) for the dropdown?
        // But for simplicity, let's return everything and let client filter. 
        // If file gets huge, we'll need a separate summary method.
        // For now, let's strip results to keep payload small for the LIST view.
        // Wait, client needs data when selected.
        // Let's return full data for now, user likely won't have 1000s of audits yet.
        return JSON.parse(fileContent);
    } catch (error) {
        console.error('Failed to read audit history:', error);
        return [];
    }
};

module.exports = { addAudit, getAuditHistory };
