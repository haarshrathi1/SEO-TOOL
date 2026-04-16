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
    features: { type: [String], default: [] },
    projectIds: { type: [String], default: [] },
    registrationSource: { type: String, default: null },
    status: { type: String, default: 'active' },
    displayName: { type: String, default: '' },
    picture: { type: String, default: '' },
    registeredAt: { type: Date, default: null },
    lastLoginAt: { type: Date, default: null },
    createdAt: { type: Date, default: Date.now },
}, { versionKey: false });

const oauthTokenSchema = new Schema({
    provider: { type: String, required: true, unique: true, index: true },
    tokens: { type: Schema.Types.Mixed, required: true },
    updatedAt: { type: Date, default: Date.now },
}, { versionKey: false });

const userGoogleConnectionSchema = new Schema({
    ownerEmail: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
    provider: { type: String, default: 'google-user-oauth', index: true },
    googleEmail: { type: String, default: '', lowercase: true, trim: true },
    displayName: { type: String, default: '' },
    picture: { type: String, default: '' },
    scope: { type: String, default: '' },
    tokens: { type: Schema.Types.Mixed, required: true },
    connectedAt: { type: Date, default: Date.now },
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
    ownerEmail: { type: String, default: '', lowercase: true, trim: true, index: true },
    googleConnectionEmail: { type: String, default: '', lowercase: true, trim: true },
    gscSiteUrl: { type: String, default: '', trim: true },
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
    leaseOwner: { type: String, default: null, index: true },
    leaseExpiresAt: { type: Date, default: null, index: true },
    lastHeartbeatAt: { type: Date, default: null },
    leaseStartedAt: { type: Date, default: null },
    attemptCount: { type: Number, default: 0 },
}, {
    versionKey: false,
    timestamps: true,
});

const keywordJobSchema = new Schema({
    seed: { type: String, required: true, trim: true, index: true },
    projectId: { type: String, default: null, index: true },
    ownerEmail: { type: String, required: true, lowercase: true, trim: true, index: true },
    options: { type: Schema.Types.Mixed, default: {} },
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
    keywordHistoryId: { type: String, default: null },
    historySaveError: { type: String, default: '' },
    error: { type: String, default: '' },
    startedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
    leaseOwner: { type: String, default: null, index: true },
    leaseExpiresAt: { type: Date, default: null, index: true },
    lastHeartbeatAt: { type: Date, default: null },
    leaseStartedAt: { type: Date, default: null },
    attemptCount: { type: Number, default: 0 },
}, {
    versionKey: false,
    timestamps: true,
});

const keywordFeatureUsageSchema = new Schema({
    scope: { type: String, default: 'user', index: true },
    ownerEmail: { type: String, default: '', lowercase: true, trim: true, index: true },
    feature: { type: String, required: true, trim: true, index: true },
    period: { type: String, required: true, trim: true, index: true },
    windowKey: { type: String, required: true, trim: true, index: true },
    count: { type: Number, default: 0 },
}, {
    versionKey: false,
    timestamps: true,
});

keywordFeatureUsageSchema.index({ scope: 1, ownerEmail: 1, feature: 1, period: 1, windowKey: 1 }, { unique: true });

const keywordAdsCacheSchema = new Schema({
    cacheKey: { type: String, required: true, unique: true, index: true },
    provider: { type: String, default: 'google_ads_api', index: true },
    seed: { type: String, required: true, trim: true, index: true },
    locationCode: { type: Number, default: null },
    languageCode: { type: String, default: null },
    searchPartners: { type: Boolean, default: false },
    payload: { type: Schema.Types.Mixed, required: true },
    expiresAt: { type: Date, required: true, index: { expires: 0 } },
}, {
    versionKey: false,
    timestamps: true,
});

const AnalysisHistory = mongoose.models.AnalysisHistory || mongoose.model('AnalysisHistory', analysisHistorySchema);
const AuditHistory = mongoose.models.AuditHistory || mongoose.model('AuditHistory', auditHistorySchema);
const KeywordResearch = mongoose.models.KeywordResearch || mongoose.model('KeywordResearch', keywordResearchSchema);
const Viewer = mongoose.models.Viewer || mongoose.model('Viewer', viewerSchema);
const OauthToken = mongoose.models.OauthToken || mongoose.model('OauthToken', oauthTokenSchema);
const UserGoogleConnection = mongoose.models.UserGoogleConnection || mongoose.model('UserGoogleConnection', userGoogleConnectionSchema);
const AdminUser = mongoose.models.AdminUser || mongoose.model('AdminUser', adminUserSchema);
const Project = mongoose.models.Project || mongoose.model('Project', projectSchema);
const AuditJob = mongoose.models.AuditJob || mongoose.model('AuditJob', auditJobSchema);
const KeywordJob = mongoose.models.KeywordJob || mongoose.model('KeywordJob', keywordJobSchema);
const KeywordFeatureUsage = mongoose.models.KeywordFeatureUsage || mongoose.model('KeywordFeatureUsage', keywordFeatureUsageSchema);
const KeywordAdsCache = mongoose.models.KeywordAdsCache || mongoose.model('KeywordAdsCache', keywordAdsCacheSchema);

module.exports = {
    AnalysisHistory,
    AuditHistory,
    KeywordResearch,
    Viewer,
    OauthToken,
    UserGoogleConnection,
    AdminUser,
    Project,
    AuditJob,
    KeywordJob,
    KeywordFeatureUsage,
    KeywordAdsCache,
};
