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
    ownerEmail: { type: String, required: true, lowercase: true, trim: true, index: true },
    projectId: { type: String, default: null, index: true },
    payload: { type: Schema.Types.Mixed, required: true },
}, { versionKey: false });

const viewerSchema = new Schema({
    email: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
    access: { type: [String], default: ['keywords'] },
    projectIds: { type: [String], default: [] },
    createdAt: { type: Date, default: Date.now },
}, { versionKey: false });

const oauthTokenSchema = new Schema({
    provider: { type: String, required: true, unique: true, index: true },
    tokens: { type: Schema.Types.Mixed, required: true },
    updatedAt: { type: Date, default: Date.now },
}, { versionKey: false });

const adminUserSchema = new Schema({
    email: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
    createdAt: { type: Date, default: Date.now },
}, { versionKey: false });

const projectSchema = new Schema({
    id: { type: String, required: true, unique: true, index: true },
    name: { type: String, required: true, trim: true },
    domain: { type: String, required: true, trim: true },
    url: { type: String, required: true, trim: true },
    ga4PropertyId: { type: String, default: '' },
    spreadsheetId: { type: String, default: '' },
    sheetGid: { type: Number, default: 0 },
    auditMaxPages: { type: Number, default: 200 },
    isActive: { type: Boolean, default: true, index: true },
}, {
    versionKey: false,
    timestamps: true,
});

const auditJobSchema = new Schema({
    projectId: { type: String, required: true, index: true },
    ownerEmail: { type: String, required: true, lowercase: true, trim: true, index: true },
    status: {
        type: String,
        enum: ['queued', 'running', 'completed', 'failed'],
        default: 'queued',
        index: true,
    },
    progress: {
        stage: { type: String, default: 'Queued' },
        completed: { type: Number, default: 0 },
        total: { type: Number, default: 0 },
        percent: { type: Number, default: 0 },
        message: { type: String, default: 'Waiting to start' },
        currentUrl: { type: String, default: '' },
    },
    result: { type: Schema.Types.Mixed, default: null },
    auditHistoryId: { type: String, default: null },
    error: { type: String, default: '' },
    startedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
}, {
    versionKey: false,
    timestamps: true,
});

const keywordJobSchema = new Schema({
    seed: { type: String, required: true, trim: true, index: true },
    projectId: { type: String, default: null, index: true },
    ownerEmail: { type: String, required: true, lowercase: true, trim: true, index: true },
    status: {
        type: String,
        enum: ['queued', 'running', 'completed', 'failed'],
        default: 'queued',
        index: true,
    },
    progress: {
        stage: { type: String, default: 'Queued' },
        label: { type: String, default: 'Queued' },
        currentLayer: { type: Number, default: 0 },
        totalLayers: { type: Number, default: 5 },
        completed: { type: Number, default: 0 },
        total: { type: Number, default: 5 },
        percent: { type: Number, default: 0 },
        message: { type: String, default: 'Waiting to start' },
        provider: { type: String, default: '' },
    },
    result: { type: Schema.Types.Mixed, default: null },
    error: { type: String, default: '' },
    startedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
}, {
    versionKey: false,
    timestamps: true,
});

const AnalysisHistory = mongoose.models.AnalysisHistory || mongoose.model('AnalysisHistory', analysisHistorySchema);
const AuditHistory = mongoose.models.AuditHistory || mongoose.model('AuditHistory', auditHistorySchema);
const KeywordResearch = mongoose.models.KeywordResearch || mongoose.model('KeywordResearch', keywordResearchSchema);
const Viewer = mongoose.models.Viewer || mongoose.model('Viewer', viewerSchema);
const OauthToken = mongoose.models.OauthToken || mongoose.model('OauthToken', oauthTokenSchema);
const AdminUser = mongoose.models.AdminUser || mongoose.model('AdminUser', adminUserSchema);
const Project = mongoose.models.Project || mongoose.model('Project', projectSchema);
const AuditJob = mongoose.models.AuditJob || mongoose.model('AuditJob', auditJobSchema);
const KeywordJob = mongoose.models.KeywordJob || mongoose.model('KeywordJob', keywordJobSchema);

module.exports = {
    AnalysisHistory,
    AuditHistory,
    KeywordResearch,
    Viewer,
    OauthToken,
    AdminUser,
    Project,
    AuditJob,
    KeywordJob,
};
