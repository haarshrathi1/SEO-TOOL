const fs = require('fs');
const path = require('path');

const FILE_PATH = path.join(__dirname, 'keyword_history.json');

function getHistory() {
    if (!fs.existsSync(FILE_PATH)) return [];
    try {
        const data = fs.readFileSync(FILE_PATH, 'utf8');
        return JSON.parse(data);
    } catch (e) {
        return [];
    }
}

function saveResearch(data) {
    const history = getHistory();
    // Add new item with timestamp
    const newItem = {
        id: Date.now().toString(),
        timestamp: new Date().toISOString(),
        ...data
    };
    history.unshift(newItem); // Add to top

    // Keep last 50
    if (history.length > 50) history.pop();

    fs.writeFileSync(FILE_PATH, JSON.stringify(history, null, 2));
    return newItem;
}

module.exports = { getHistory, saveResearch };
