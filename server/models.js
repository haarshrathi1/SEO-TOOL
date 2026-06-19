const { mongoose } = require('./db');

const { Schema } = mongoose;

const WORKSPACE_ROLES = ['owner', 'admin', 'member', 'viewer'];

const analysisHistorySchema = new Schema({
    timestamp: { type: Date, default: Date.now, index: true },
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', default: null, index: true },
    projectId: { type: String, index: true },
    data: { type: Schema.Types.Mixed, required: true },
}, { versionKey: false });

const auditHistorySchema = new Schema({
    timestamp: { type: Date, default: Date.now, index: true },
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', default: null, index: true },
    projectId: { type: String, index: true },
    results: { type: Schema.Types.Mixed, required: true },
}, { versionKey: false });

const keywordResearchSchema = new Schema({
    timestamp: { type: Date, default: Date.now, index: true },
    seed: { type: String, index: true },
    ownerEmail: { type: String, required: true, lowercase: true, trim: true, index: true },
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', default: null, index: true },
    projectId: { type: String, default: null, index: true },
    payload: { type: Schema.Types.Mixed, required: true },
}, { versionKey: false });

const userSchema = new Schema({
    email: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
    displayName: { type: String, default: '' },
    picture: { type: String, default: '' },
    status: { type: String, default: 'active', index: true },
    registrationSource: { type: String, default: null },
    registeredAt: { type: Date, default: null },
    lastLoginAt: { type: Date, default: null },
    createdAt: { type: Date, default: Date.now },
}, { versionKey: false });

const workspaceSchema = new Schema({
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, trim: true, unique: true, index: true },
    ownerUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
}, {
    versionKey: false,
    timestamps: true,
});

const workspaceMembershipSchema = new Schema({
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    role: { type: String, enum: WORKSPACE_ROLES, default: 'member', index: true },
    access: { type: [String], default: ['keywords', 'dashboard', 'audit'] },
    features: { type: [String], default: [] },
    projectIds: { type: [String], default: [] },
    status: { type: String, default: 'active', index: true },
}, {
    versionKey: false,
    timestamps: true,
});

workspaceMembershipSchema.index({ workspaceId: 1, userId: 1 }, { unique: true });

const sessionSchema = new Schema({
    tokenHash: { type: String, required: true, unique: true, index: true },
    csrfToken: { type: String, required: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true, index: true },
    userAgent: { type: String, default: '' },
    ipAddress: { type: String, default: '' },
    expiresAt: { type: Date, required: true },
    lastSeenAt: { type: Date, default: Date.now },
}, {
    versionKey: false,
    timestamps: true,
});

sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

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

const googleConnectionSchema = new Schema({
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    provider: { type: String, default: 'google-user-oauth', index: true },
    label: { type: String, default: '' },
    googleEmail: { type: String, default: '', lowercase: true, trim: true },
    displayName: { type: String, default: '' },
    picture: { type: String, default: '' },
    scope: { type: String, default: '' },
    tokens: { type: Schema.Types.Mixed, required: true },
    connectedAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
}, {
    versionKey: false,
    timestamps: true,
});

const adminUserSchema = new Schema({
    email: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
    createdAt: { type: Date, default: Date.now },
}, { versionKey: false });

const projectSchema = new Schema({
    id: { type: String, required: true, unique: true, index: true },
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', default: null, index: true },
    googleConnectionId: { type: Schema.Types.ObjectId, ref: 'GoogleConnection', default: null, index: true },
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

const auditIssueSchema = new Schema({
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true, index: true },
    projectId: { type: String, required: true, index: true },
    auditJobId: { type: Schema.Types.ObjectId, ref: 'AuditJob', required: true, index: true },
    url: { type: String, required: true, trim: true, index: true },
    category: { type: String, required: true, trim: true, index: true },
    severity: { type: String, enum: ['critical', 'high', 'medium', 'low', 'info'], default: 'medium', index: true },
    title: { type: String, required: true, trim: true },
    details: { type: String, default: '' },
    metadata: { type: Schema.Types.Mixed, default: {} },
}, {
    versionKey: false,
    timestamps: true,
});

const auditSnapshotSchema = new Schema({
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true, index: true },
    projectId: { type: String, required: true, index: true },
    auditJobId: { type: Schema.Types.ObjectId, ref: 'AuditJob', required: true, index: true },
    summary: {
        crawledUrls: { type: Number, default: 0 },
        inspectedUrls: { type: Number, default: 0 },
        psiSampledUrls: { type: Number, default: 0 },
        brokenLinkChecks: { type: Number, default: 0 },
        issuesBySeverity: { type: Schema.Types.Mixed, default: {} },
    },
    metadata: { type: Schema.Types.Mixed, default: {} },
}, {
    versionKey: false,
    timestamps: true,
});

const projectMetricSnapshotSchema = new Schema({
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true, index: true },
    projectId: { type: String, required: true, index: true },
    source: { type: String, required: true, trim: true, index: true },
    snapshotDate: { type: Date, required: true, index: true },
    metrics: { type: Schema.Types.Mixed, default: {} },
}, {
    versionKey: false,
    timestamps: true,
});

const auditJobSchema = new Schema({
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', default: null, index: true },
    projectId: { type: String, required: true, index: true },
    ownerEmail: { type: String, required: true, lowercase: true, trim: true, index: true },
    status: {
        type: String,
        enum: ['queued', 'running', 'completed', 'failed', 'cancelled'],
        default: 'queued',
        index: true,
    },
    mode: {
        type: String,
        enum: ['standard', 'gsc-deep'],
        default: 'standard',
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
    summary: {
        crawledUrls: { type: Number, default: 0 },
        inspectedUrls: { type: Number, default: 0 },
        psiSampledUrls: { type: Number, default: 0 },
        brokenLinkChecks: { type: Number, default: 0 },
        issuesBySeverity: { type: Schema.Types.Mixed, default: {} },
    },
    auditHistoryId: { type: String, default: null },
    error: { type: String, default: '' },
    startedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
    queueJobId: { type: String, default: null, index: true },
    attemptCount: { type: Number, default: 0 },
    leaseOwner: { type: String, default: null, index: true },
    leaseStartedAt: { type: Date, default: null },
    leaseExpiresAt: { type: Date, default: null, index: true },
    lastHeartbeatAt: { type: Date, default: null },
}, {
    versionKey: false,
    timestamps: true,
});

const keywordJobSchema = new Schema({
    seed: { type: String, required: true, trim: true, index: true },
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', default: null, index: true },
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
    queueJobId: { type: String, default: null, index: true },
    attemptCount: { type: Number, default: 0 },
    leaseOwner: { type: String, default: null, index: true },
    leaseStartedAt: { type: Date, default: null },
    leaseExpiresAt: { type: Date, default: null, index: true },
    lastHeartbeatAt: { type: Date, default: null },
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

const psiCacheSchema = new Schema({
    cacheKey: { type: String, required: true, unique: true, index: true },
    url: { type: String, required: true, trim: true, index: true },
    payload: { type: Schema.Types.Mixed, required: true },
    expiresAt: { type: Date, required: true, index: { expires: 0 } },
}, {
    versionKey: false,
    timestamps: true,
});

const linkCheckCacheSchema = new Schema({
    url: { type: String, required: true, unique: true, trim: true, index: true },
    status: { type: Number, default: 0 },
    result: { type: String, default: '' },
    expiresAt: { type: Date, required: true, index: { expires: 0 } },
}, {
    versionKey: false,
    timestamps: true,
});

const auditEventSchema = new Schema({
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', default: null, index: true },
    action: { type: String, required: true, trim: true, index: true },
    entityType: { type: String, default: '', trim: true },
    entityId: { type: String, default: '', trim: true },
    metadata: { type: Schema.Types.Mixed, default: {} },
    createdAt: { type: Date, default: Date.now, index: true },
}, { versionKey: false });

const chatMessageSchema = new Schema({
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', default: null, index: true },
    projectId: { type: String, required: true, index: true },
    ownerEmail: { type: String, required: true, lowercase: true, trim: true, index: true },
    role: { type: String, enum: ['user', 'assistant'], required: true },
    content: { type: String, required: true },
}, {
    versionKey: false,
    timestamps: true,
});

chatMessageSchema.index({ projectId: 1, ownerEmail: 1, createdAt: 1 });

const User = mongoose.models.User || mongoose.model('User', userSchema);
const Workspace = mongoose.models.Workspace || mongoose.model('Workspace', workspaceSchema);
const WorkspaceMembership = mongoose.models.WorkspaceMembership || mongoose.model('WorkspaceMembership', workspaceMembershipSchema);
const Session = mongoose.models.Session || mongoose.model('Session', sessionSchema);
const AnalysisHistory = mongoose.models.AnalysisHistory || mongoose.model('AnalysisHistory', analysisHistorySchema);
const AuditHistory = mongoose.models.AuditHistory || mongoose.model('AuditHistory', auditHistorySchema);
const KeywordResearch = mongoose.models.KeywordResearch || mongoose.model('KeywordResearch', keywordResearchSchema);
const Viewer = mongoose.models.Viewer || mongoose.model('Viewer', viewerSchema);
const OauthToken = mongoose.models.OauthToken || mongoose.model('OauthToken', oauthTokenSchema);
const UserGoogleConnection = mongoose.models.UserGoogleConnection || mongoose.model('UserGoogleConnection', userGoogleConnectionSchema);
const GoogleConnection = mongoose.models.GoogleConnection || mongoose.model('GoogleConnection', googleConnectionSchema);
const AdminUser = mongoose.models.AdminUser || mongoose.model('AdminUser', adminUserSchema);
const Project = mongoose.models.Project || mongoose.model('Project', projectSchema);
const AuditIssue = mongoose.models.AuditIssue || mongoose.model('AuditIssue', auditIssueSchema);
const AuditSnapshot = mongoose.models.AuditSnapshot || mongoose.model('AuditSnapshot', auditSnapshotSchema);
const ProjectMetricSnapshot = mongoose.models.ProjectMetricSnapshot || mongoose.model('ProjectMetricSnapshot', projectMetricSnapshotSchema);
const AuditJob = mongoose.models.AuditJob || mongoose.model('AuditJob', auditJobSchema);
const KeywordJob = mongoose.models.KeywordJob || mongoose.model('KeywordJob', keywordJobSchema);
const KeywordFeatureUsage = mongoose.models.KeywordFeatureUsage || mongoose.model('KeywordFeatureUsage', keywordFeatureUsageSchema);
const KeywordAdsCache = mongoose.models.KeywordAdsCache || mongoose.model('KeywordAdsCache', keywordAdsCacheSchema);
const PsiCache = mongoose.models.PsiCache || mongoose.model('PsiCache', psiCacheSchema);
const LinkCheckCache = mongoose.models.LinkCheckCache || mongoose.model('LinkCheckCache', linkCheckCacheSchema);
const AuditEvent = mongoose.models.AuditEvent || mongoose.model('AuditEvent', auditEventSchema);
const ChatMessage = mongoose.models.ChatMessage || mongoose.model('ChatMessage', chatMessageSchema);

module.exports = {
    WORKSPACE_ROLES,
    User,
    Workspace,
    WorkspaceMembership,
    Session,
    AnalysisHistory,
    AuditHistory,
    KeywordResearch,
    Viewer,
    OauthToken,
    UserGoogleConnection,
    GoogleConnection,
    AdminUser,
    Project,
    AuditIssue,
    AuditSnapshot,
    ProjectMetricSnapshot,
    AuditJob,
    AuditRun: AuditJob,
    KeywordJob,
    KeywordRun: KeywordJob,
    KeywordFeatureUsage,
    KeywordAdsCache,
    PsiCache,
    LinkCheckCache,
    AuditEvent,
    ChatMessage,
};
