const { mongoose } = require('./db');

const { Schema } = mongoose;

const analysisHistorySchema = new Schema({
    timestamp: { type: Date, default: Date.now, index: true },
    projectId: { type: String, index: true },
    data: { type: Schema.Types.Mixed, required: true },
}, { versionKey: false });

const auditHistorySchema = new Schema({
    timestamp: { type: Date, default: Date.now, index: true },
    projectId: { type: String, index: true },
    results: { type: Schema.Types.Mixed, required: true },
}, { versionKey: false });

const keywordResearchSchema = new Schema({
    timestamp: { type: Date, default: Date.now, index: true },
    seed: { type: String, index: true },
    payload: { type: Schema.Types.Mixed, required: true },
}, { versionKey: false });

const viewerSchema = new Schema({
    email: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
    access: { type: [String], default: ['keywords'] },
    createdAt: { type: Date, default: Date.now },
}, { versionKey: false });

const oauthTokenSchema = new Schema({
    provider: { type: String, required: true, unique: true, index: true },
    tokens: { type: Schema.Types.Mixed, required: true },
    updatedAt: { type: Date, default: Date.now },
}, { versionKey: false });

const AnalysisHistory = mongoose.models.AnalysisHistory || mongoose.model('AnalysisHistory', analysisHistorySchema);
const AuditHistory = mongoose.models.AuditHistory || mongoose.model('AuditHistory', auditHistorySchema);
const KeywordResearch = mongoose.models.KeywordResearch || mongoose.model('KeywordResearch', keywordResearchSchema);
const Viewer = mongoose.models.Viewer || mongoose.model('Viewer', viewerSchema);
const OauthToken = mongoose.models.OauthToken || mongoose.model('OauthToken', oauthTokenSchema);

module.exports = {
    AnalysisHistory,
    AuditHistory,
    KeywordResearch,
    Viewer,
    OauthToken,
};
