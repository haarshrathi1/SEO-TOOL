const {
    AnalysisHistory,
    AuditHistory,
    AuditJob,
    KeywordJob,
    KeywordResearch,
    Project,
    Viewer,
} = require('./models');
const { assertPublicHttpUrl, isPrivateHostname } = require('./networkSafety');

const SELF_SERVICE_ACCESS = ['keywords', 'dashboard', 'audit'];

const DEFAULT_PROJECTS = [
    {
        id: 'laserlift',
        name: 'Laserlift Solutions',
        domain: 'laserliftsolutions.com',
        url: 'https://laserliftsolutions.com/',
        ga4PropertyId: '503587971',
        spreadsheetId: '1VpSfz6pVmGbgltxcs4UNmDEhHfo0Vh4kMDwtFUaOaWM',
        sheetGid: 0,
        auditMaxPages: 200,
        isActive: true,
    },
    {
        id: 'fleetflow',
        name: 'FleetFlow',
        domain: 'fleetflow.hyvikk.com',
        url: 'https://fleetflow.hyvikk.com/',
        ga4PropertyId: '518947686',
        spreadsheetId: '1VpSfz6pVmGbgltxcs4UNmDEhHfo0Vh4kMDwtFUaOaWM',
        sheetGid: 1772579534,
        auditMaxPages: 200,
        isActive: true,
    },
];

function normalizeText(value) {
    return typeof value === 'string' ? value.trim() : '';
}

function hasOwn(input, key) {
    return Boolean(input) && Object.prototype.hasOwnProperty.call(input, key);
}

function normalizeOwnerEmail(value) {
    return normalizeText(value).toLowerCase();
}

function extractHostname(value) {
    const raw = normalizeText(value);
    if (!raw) {
        return '';
    }

    const withProtocol = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;
    try {
        return new URL(withProtocol).hostname.toLowerCase();
    } catch {
        return '';
    }
}

async function normalizeUrl(value) {
    const raw = normalizeText(value);
    if (!raw) return '';
    try {
        return await assertPublicHttpUrl(raw);
    } catch {
        throw new Error('Project URL must be a valid public http(s) URL');
    }
}

function normalizeDomain(value, url) {
    const direct = extractHostname(value);
    if (direct && !isPrivateHostname(direct)) return direct;
    if (!url) return '';
    return new URL(url).hostname.toLowerCase();
}

async function normalizeSearchConsoleSiteUrl(value, url) {
    const raw = normalizeText(value);
    if (!raw) {
        return url;
    }

    if (/^sc-domain:/i.test(raw)) {
        const domain = raw.replace(/^sc-domain:/i, '').trim().toLowerCase();
        if (!domain || isPrivateHostname(domain)) {
            throw new Error('Search Console property must be a public URL or sc-domain property');
        }
        return `sc-domain:${domain}`;
    }

    try {
        return await assertPublicHttpUrl(raw);
    } catch {
        throw new Error('Search Console property must be a public URL or sc-domain property');
    }
}

function slugifyId(value) {
    const slug = normalizeText(value)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');

    return slug || `project-${Date.now()}`;
}

function toProjectDto(record) {
    return {
        id: record.id,
        name: record.name,
        domain: record.domain,
        url: record.url,
        ownerEmail: record.ownerEmail || '',
        googleConnectionEmail: record.googleConnectionEmail || '',
        gscSiteUrl: record.gscSiteUrl || record.url,
        ga4PropertyId: record.ga4PropertyId || '',
        spreadsheetId: record.spreadsheetId || '',
        sheetGid: Number.isFinite(record.sheetGid) ? record.sheetGid : 0,
        auditMaxPages: record.auditMaxPages || 200,
        isActive: record.isActive !== false,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
    };
}

async function buildProjectPayload(input, existing = null, options = {}) {
    const url = await normalizeUrl(input.url || existing?.url || '');
    if (!url) {
        throw new Error('Project URL is required');
    }

    const name = normalizeText(input.name || existing?.name || '');
    if (!name) {
        throw new Error('Project name is required');
    }

    const domain = normalizeDomain(input.domain, url);
    const auditMaxPages = Number(input.auditMaxPages ?? existing?.auditMaxPages ?? 200);
    const ownerEmail = normalizeOwnerEmail(
        options.ownerEmail !== undefined
            ? options.ownerEmail
            : hasOwn(input, 'ownerEmail')
                ? input.ownerEmail
                : existing?.ownerEmail || ''
    );
    const googleConnectionEmail = normalizeOwnerEmail(
        options.googleConnectionEmail !== undefined
            ? options.googleConnectionEmail
            : hasOwn(input, 'googleConnectionEmail')
                ? input.googleConnectionEmail
                : existing?.googleConnectionEmail || ownerEmail
    );
    const gscSiteUrl = await normalizeSearchConsoleSiteUrl(
        hasOwn(input, 'gscSiteUrl') ? input.gscSiteUrl : existing?.gscSiteUrl || url,
        url
    );

    return {
        id: existing?.id || slugifyId(input.id || name),
        name,
        domain,
        url,
        ownerEmail,
        googleConnectionEmail,
        gscSiteUrl,
        ga4PropertyId: normalizeText(input.ga4PropertyId || existing?.ga4PropertyId || ''),
        spreadsheetId: normalizeText(input.spreadsheetId || existing?.spreadsheetId || ''),
        sheetGid: Number.isFinite(Number(input.sheetGid)) ? Number(input.sheetGid) : Number(existing?.sheetGid || 0),
        auditMaxPages: Number.isFinite(auditMaxPages) && auditMaxPages > 0 ? Math.min(auditMaxPages, 500) : 200,
        isActive: typeof input.isActive === 'boolean' ? input.isActive : existing?.isActive !== false,
    };
}

function buildViewerScope(user) {
    const ownerEmail = normalizeOwnerEmail(user?.email);
    const projectIds = Array.isArray(user?.projectIds)
        ? [...new Set(user.projectIds.map((projectId) => String(projectId || '').trim()).filter(Boolean))]
        : [];
    const scope = [];

    if (projectIds.length > 0) {
        scope.push({ id: { $in: projectIds } });
    }

    if (ownerEmail) {
        scope.push({ ownerEmail });
    }

    return scope.length > 0 ? { $or: scope } : null;
}

function buildListProjectsQuery(user, options = {}) {
    const includeInactive = options.includeInactive === true && user?.role === 'admin';
    const query = includeInactive ? {} : { isActive: true };

    if (user?.role === 'viewer') {
        const scope = buildViewerScope(user);
        if (!scope) {
            return null;
        }
        query.$or = scope.$or;
    }

    return query;
}

function buildGetProjectQuery(id, user) {
    const query = {};

    if (id) {
        query.id = id;
    } else {
        query.isActive = true;
    }

    if (user?.role === 'viewer') {
        const scope = buildViewerScope(user);
        if (!scope) {
            return null;
        }
        query.$or = scope.$or;
    }

    return query;
}

function canManageProjectRecord(record, user) {
    if (!record || !user) {
        return false;
    }

    if (user.role === 'admin') {
        return true;
    }

    return normalizeOwnerEmail(record.ownerEmail) === normalizeOwnerEmail(user.email);
}

async function syncViewerProjectAccess(ownerEmail, projectId, options = {}) {
    const normalizedOwnerEmail = normalizeOwnerEmail(ownerEmail);
    if (!normalizedOwnerEmail || !projectId) {
        return;
    }

    const addToSet = { projectIds: projectId };
    if (options.grantSelfServiceAccess) {
        addToSet.access = { $each: SELF_SERVICE_ACCESS };
    }

    await Viewer.findOneAndUpdate(
        { email: normalizedOwnerEmail },
        { $addToSet: addToSet }
    );
}

async function initializeProjects() {
    const count = await Project.countDocuments({});
    if (count > 0) {
        return;
    }

    await Project.insertMany(DEFAULT_PROJECTS, { ordered: false });
}

async function listProjects(user, options = {}) {
    const query = buildListProjectsQuery(user, options);
    if (!query) {
        return [];
    }

    const records = await Project.find(query).sort({ name: 1 }).lean();
    return records.map(toProjectDto);
}

async function getProject(id, user) {
    const query = buildGetProjectQuery(id, user);
    if (!query) {
        return null;
    }

    const record = await Project.findOne(query).sort({ name: 1 }).lean();
    return record ? toProjectDto(record) : null;
}

async function createProject(input, user) {
    const ownerEmail = user?.role === 'admin'
        ? normalizeOwnerEmail(input.ownerEmail || '')
        : normalizeOwnerEmail(user?.email || '');
    const googleConnectionEmail = user?.role === 'admin'
        ? (hasOwn(input, 'googleConnectionEmail') ? input.googleConnectionEmail : ownerEmail)
        : normalizeOwnerEmail(user?.email || '');
    const payload = await buildProjectPayload(input, null, {
        ownerEmail,
        googleConnectionEmail,
    });
    const existing = await Project.findOne({ id: payload.id }).lean();
    if (existing) {
        throw new Error('Project ID already exists');
    }

    const doc = await Project.create(payload);
    if (payload.ownerEmail) {
        await syncViewerProjectAccess(payload.ownerEmail, payload.id, {
            grantSelfServiceAccess: user?.role !== 'admin',
        });
    }
    return toProjectDto(doc.toObject());
}

async function updateProject(id, input, user) {
    const existing = await Project.findOne({ id });
    if (!existing) {
        throw new Error('Project not found');
    }

    if (user && !canManageProjectRecord(existing.toObject(), user)) {
        throw new Error('Project access denied');
    }

    const payload = await buildProjectPayload(input, existing.toObject(), {
        ownerEmail: user?.role === 'admin'
            ? (hasOwn(input, 'ownerEmail') ? input.ownerEmail : existing.ownerEmail)
            : existing.ownerEmail || user?.email || '',
        googleConnectionEmail: user?.role === 'admin'
            ? (hasOwn(input, 'googleConnectionEmail') ? input.googleConnectionEmail : existing.googleConnectionEmail || existing.ownerEmail)
            : (hasOwn(input, 'googleConnectionEmail') ? input.googleConnectionEmail : existing.googleConnectionEmail || existing.ownerEmail || user?.email || ''),
    });
    payload.id = existing.id;

    existing.set(payload);
    await existing.save();
    if (payload.ownerEmail) {
        await syncViewerProjectAccess(payload.ownerEmail, payload.id, {
            grantSelfServiceAccess: user?.role !== 'admin',
        });
    }
    return toProjectDto(existing.toObject());
}

async function archiveProject(id, user) {
    const existing = await Project.findOne({ id });
    if (!existing) {
        throw new Error('Project not found');
    }

    if (user && !canManageProjectRecord(existing.toObject(), user)) {
        throw new Error('Project access denied');
    }

    existing.set({ isActive: false });
    await existing.save();

    return toProjectDto(existing.toObject());
}

async function deleteProject(id, user) {
    const existing = await Project.findOne({ id });
    if (!existing) {
        throw new Error('Project not found');
    }

    const record = existing.toObject();
    if (user && !canManageProjectRecord(record, user)) {
        throw new Error('Project access denied');
    }

    await Promise.all([
        Project.deleteOne({ id }),
        Viewer.updateMany({ projectIds: id }, { $pull: { projectIds: id } }),
        AnalysisHistory.deleteMany({ projectId: id }),
        AuditHistory.deleteMany({ projectId: id }),
        AuditJob.deleteMany({ projectId: id }),
        KeywordJob.deleteMany({ projectId: id }),
        KeywordResearch.deleteMany({ projectId: id }),
    ]);

    return toProjectDto(record);
}

module.exports = {
    initializeProjects,
    listProjects,
    getProject,
    createProject,
    updateProject,
    archiveProject,
    deleteProject,
    __internal: {
        normalizeUrl,
        normalizeDomain,
        normalizeOwnerEmail,
        normalizeSearchConsoleSiteUrl,
        slugifyId,
        buildProjectPayload,
        buildListProjectsQuery,
        buildGetProjectQuery,
        buildViewerScope,
        canManageProjectRecord,
        toProjectDto,
        isPrivateHostname,
    },
};

