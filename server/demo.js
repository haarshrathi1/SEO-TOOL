const fs = require('fs');
const path = require('path');
const { normalizeAnalysisData } = require('./analysisMetrics');

const ANALYSIS_HISTORY_PATH = path.join(__dirname, 'data', 'history.json');
const AUDIT_HISTORY_PATH = path.join(__dirname, 'data', 'audit_history.json');
const KEYWORD_HISTORY_PATH = path.join(__dirname, 'keyword_history.json');

function readJsonArray(filePath) {
    try {
        const raw = fs.readFileSync(filePath, 'utf8');
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
        console.error(`Failed to read demo data from ${path.basename(filePath)}:`, error.message);
        return [];
    }
}

function toTimestamp(value) {
    const timestamp = new Date(value || 0).getTime();
    return Number.isFinite(timestamp) ? timestamp : 0;
}

function sortByTimestampDesc(items = []) {
    return [...items].sort((left, right) => toTimestamp(right.timestamp) - toTimestamp(left.timestamp));
}

function serializeAnalysisRecord(record) {
    if (!record) {
        return null;
    }

    return {
        id: String(record.id || ''),
        timestamp: record.timestamp || new Date(0).toISOString(),
        projectId: record.projectId || '',
        data: normalizeAnalysisData(record.data || {}),
    };
}

function serializeAuditRecord(record) {
    if (!record) {
        return null;
    }

    return {
        id: String(record.id || ''),
        timestamp: record.timestamp || new Date(0).toISOString(),
        projectId: record.projectId || '',
        results: Array.isArray(record.results) ? record.results : [],
    };
}

function serializeKeywordRecord(record) {
    if (!record) {
        return null;
    }

    return {
        ...record,
        id: String(record.id || ''),
        timestamp: record.timestamp || new Date(0).toISOString(),
        projectId: record.projectId || null,
    };
}

function buildDemoSummary({
    analysisRecords = [],
    auditRecords = [],
    keywordRecords = [],
} = {}) {
    const latestAnalysis = serializeAnalysisRecord(sortByTimestampDesc(analysisRecords)[0] || null);
    const demoProjectId = latestAnalysis?.projectId || null;
    const auditPool = demoProjectId
        ? auditRecords.filter((record) => record.projectId === demoProjectId)
        : auditRecords;
    const latestAudit = serializeAuditRecord(sortByTimestampDesc(auditPool)[0] || null);
    const latestKeyword = serializeKeywordRecord(sortByTimestampDesc(keywordRecords)[0] || null);

    return {
        generatedAt: new Date().toISOString(),
        analysis: latestAnalysis,
        audit: latestAudit,
        keyword: latestKeyword,
    };
}

function getDemoSummary() {
    return buildDemoSummary({
        analysisRecords: readJsonArray(ANALYSIS_HISTORY_PATH),
        auditRecords: readJsonArray(AUDIT_HISTORY_PATH),
        keywordRecords: readJsonArray(KEYWORD_HISTORY_PATH),
    });
}

module.exports = {
    getDemoSummary,
    __internal: {
        buildDemoSummary,
        readJsonArray,
        serializeAnalysisRecord,
        serializeAuditRecord,
        serializeKeywordRecord,
        sortByTimestampDesc,
        toTimestamp,
    },
};
