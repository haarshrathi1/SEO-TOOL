const {
    AnalysisHistory,
    AuditHistory,
    AuditJob,
    GoogleConnection,
    KeywordJob,
    KeywordResearch,
    Project,
} = require('./models');
const { assertPublicHttpUrl, isPrivateHostname } = require('./networkSafety');
const { recordAuditEvent } = require('./auditEvents');

function normalizeText(value) {
    return typeof value === 'string' ? value.trim() : '';
}

function hasOwn(input, key) {
    return Boolean(input) && Object.prototype.hasOwnProperty.call(input, key);
}

function normalizeOwnerEmail(value) {
    return normalizeText(value).toLowerCase();
}

function normalizeWorkspaceId(value) {
    if (!value) {
        return null;
    }

    if (typeof value === 'string') {
        return value.trim() || null;
    }

    if (typeof value.toString === 'function') {
        return value.toString();
    }

    return null;
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

function isDuplicateProjectIdError(error) {
    return Boolean(
        error
        && (error.code === 11000 || /E11000|duplicate key/i.test(error.message || ''))
        && (
            error.keyPattern?.id
            || error.keyValue?.id
            || /projects.*id/i.test(error.message || '')
        )
    );
}

function getDuplicateProjectMessage(projectId) {
    const suffix = projectId ? ` "${projectId}"` : '';
    return `Project ID${suffix} already exists. Use a different Project ID, or edit the existing project instead.`;
}

function toProjectDto(record) {
    return {
        id: record.id,
        workspaceId: normalizeWorkspaceId(record.workspaceId),
        googleConnectionId: normalizeWorkspaceId(record.googleConnectionId),
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

function canManageWorkspaceProjects(user) {
    if (!user) {
        return false;
    }

    const effectiveRole = user.workspaceRole || user.role;
    return effectiveRole !== 'viewer';
}

function canManageProjectRecord(record, user) {
    if (!record || !user) {
        return false;
    }

    if (!canManageWorkspaceProjects(user)) {
        return false;
    }

    return normalizeWorkspaceId(record.workspaceId) === normalizeWorkspaceId(user.workspaceId);
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

    if (!scope.length) {
        return null;
    }

    return scope.length === 1 ? scope[0] : { $or: scope };
}

function buildListProjectsQuery(user, options = {}) {
    const workspaceId = normalizeWorkspaceId(user?.workspaceId);
    const includeInactive = options.includeInactive === true && canManageWorkspaceProjects(user);
    const query = {};

    if (workspaceId) {
        query.workspaceId = workspaceId;
    }

    if (!includeInactive) {
        query.isActive = true;
    }

    const effectiveRole = user?.workspaceRole || user?.role;
    if (effectiveRole === 'viewer') {
        const scope = buildViewerScope(user);
        if (!scope) {
            return null;
        }

        if (scope.$or) {
            query.$or = scope.$or;
        } else if (scope.id) {
            query.id = scope.id;
        } else if (scope.ownerEmail) {
            query.ownerEmail = scope.ownerEmail;
        }
    }

    return query;
}

function buildGetProjectQuery(id, user, options = {}) {
    const query = {};
    const workspaceId = normalizeWorkspaceId(options.workspaceId || user?.workspaceId);

    if (id) {
        query.id = id;
    }

    if (workspaceId) {
        query.workspaceId = workspaceId;
    }

    const effectiveRole = user?.workspaceRole || user?.role;
    if (effectiveRole === 'viewer') {
        const scope = buildViewerScope(user);
        if (!scope) {
            return null;
        }

        if (scope.$or) {
            query.$or = scope.$or;
        } else if (scope.id) {
            if (!scope.id.$in.includes(id)) {
                return null;
            }
            query.id = id;
        } else if (scope.ownerEmail) {
            query.ownerEmail = scope.ownerEmail;
        }
    }

    return Object.keys(query).length > 0 ? query : null;
}

async function resolveGoogleConnection(input, existing = null, options = {}) {
    const workspaceId = normalizeWorkspaceId(options.workspaceId || existing?.workspaceId);
    if (!workspaceId) {
        return { googleConnectionId: null, googleConnectionEmail: '' };
    }

    const requestedConnectionId = normalizeWorkspaceId(
        hasOwn(input, 'googleConnectionId') ? input.googleConnectionId : existing?.googleConnectionId || null
    );
    const requestedEmail = normalizeOwnerEmail(
        hasOwn(input, 'googleConnectionEmail') ? input.googleConnectionEmail : existing?.googleConnectionEmail || ''
    );

    if (requestedConnectionId) {
        const connection = await GoogleConnection.findOne({
            _id: requestedConnectionId,
            workspaceId,
        }).lean();

        if (!connection) {
            throw new Error('Selected Google connection was not found in this workspace');
        }

        return {
            googleConnectionId: String(connection._id),
            googleConnectionEmail: connection.googleEmail || '',
        };
    }

    if (requestedEmail) {
        const connection = await GoogleConnection.findOne({
            workspaceId,
            googleEmail: requestedEmail,
        }).sort({ updatedAt: -1 }).lean();

        if (!connection) {
            throw new Error('Selected Google connection was not found in this workspace');
        }

        return {
            googleConnectionId: String(connection._id),
            googleConnectionEmail: connection.googleEmail || requestedEmail,
        };
    }

    return {
        googleConnectionId: null,
        googleConnectionEmail: '',
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

    const workspaceId = normalizeWorkspaceId(options.workspaceId || existing?.workspaceId || options.user?.workspaceId);
    const domain = normalizeDomain(input.domain, url);
    const auditMaxPages = Number(input.auditMaxPages ?? existing?.auditMaxPages ?? 200);
    const ownerEmail = normalizeOwnerEmail(
        options.ownerEmail !== undefined
            ? options.ownerEmail
            : hasOwn(input, 'ownerEmail')
                ? input.ownerEmail
                : existing?.ownerEmail || options.user?.email || ''
    );
    const gscSiteUrl = await normalizeSearchConsoleSiteUrl(
        hasOwn(input, 'gscSiteUrl') ? input.gscSiteUrl : existing?.gscSiteUrl || url,
        url
    );
    const googleConnection = await resolveGoogleConnection(input, existing, { workspaceId });

    return {
        id: existing?.id || slugifyId(input.id || name),
        workspaceId,
        googleConnectionId: googleConnection.googleConnectionId,
        name,
        domain,
        url,
        ownerEmail,
        googleConnectionEmail: googleConnection.googleConnectionEmail,
        gscSiteUrl,
        ga4PropertyId: normalizeText(input.ga4PropertyId || existing?.ga4PropertyId || ''),
        spreadsheetId: normalizeText(input.spreadsheetId || existing?.spreadsheetId || ''),
        sheetGid: Number.isFinite(Number(input.sheetGid)) ? Number(input.sheetGid) : Number(existing?.sheetGid || 0),
        auditMaxPages: Number.isFinite(auditMaxPages) && auditMaxPages > 0 ? Math.min(auditMaxPages, 2000) : 200,
        isActive: typeof input.isActive === 'boolean' ? input.isActive : existing?.isActive !== false,
    };
}

async function initializeProjects() {
    return null;
}

async function listProjects(user, options = {}) {
    const query = buildListProjectsQuery(user, options);
    if (!query) {
        return [];
    }

    const records = await Project.find(query).sort({ name: 1 }).lean();
    return records.map(toProjectDto);
}

async function getProject(id, user = null, options = {}) {
    const query = buildGetProjectQuery(id, user, options);
    if (!query) {
        return null;
    }

    const record = await Project.findOne(query).sort({ name: 1 }).lean();
    return record ? toProjectDto(record) : null;
}

async function createProject(input, user) {
    if (!canManageWorkspaceProjects(user)) {
        throw new Error('Project access denied');
    }

    const payload = await buildProjectPayload(input, null, {
        workspaceId: user.workspaceId,
        ownerEmail: user.email,
        user,
    });
    const existing = await Project.findOne({ id: payload.id }).lean();
    if (existing) {
        throw new Error(getDuplicateProjectMessage(payload.id));
    }

    let doc;
    try {
        doc = await Project.create(payload);
    } catch (error) {
        if (isDuplicateProjectIdError(error)) {
            throw new Error(getDuplicateProjectMessage(payload.id));
        }
        throw error;
    }
    await recordAuditEvent({
        workspaceId: user.workspaceId,
        userId: user.userId,
        action: 'project.created',
        entityType: 'project',
        entityId: payload.id,
        metadata: { url: payload.url },
    });
    return toProjectDto(doc.toObject());
}

async function updateProject(id, input, user) {
    const existing = await Project.findOne({
        workspaceId: user.workspaceId,
        id,
    });
    if (!existing) {
        throw new Error('Project not found');
    }

    if (!canManageProjectRecord(existing.toObject(), user)) {
        throw new Error('Project access denied');
    }

    const payload = await buildProjectPayload(input, existing.toObject(), {
        workspaceId: user.workspaceId,
        ownerEmail: existing.ownerEmail || user.email,
        user,
    });
    payload.id = existing.id;

    existing.set(payload);
    try {
        await existing.save();
    } catch (error) {
        if (isDuplicateProjectIdError(error)) {
            throw new Error(getDuplicateProjectMessage(existing.id));
        }
        throw error;
    }

    await recordAuditEvent({
        workspaceId: user.workspaceId,
        userId: user.userId,
        action: 'project.updated',
        entityType: 'project',
        entityId: existing.id,
        metadata: { url: existing.url },
    });

    return toProjectDto(existing.toObject());
}

async function archiveProject(id, user) {
    const existing = await Project.findOne({
        workspaceId: user.workspaceId,
        id,
    });
    if (!existing) {
        throw new Error('Project not found');
    }

    if (!canManageProjectRecord(existing.toObject(), user)) {
        throw new Error('Project access denied');
    }

    existing.set({ isActive: false });
    await existing.save();
    return toProjectDto(existing.toObject());
}

async function deleteProject(id, user) {
    const existing = await Project.findOne({
        workspaceId: user.workspaceId,
        id,
    });
    if (!existing) {
        throw new Error('Project not found');
    }

    const record = existing.toObject();
    if (!canManageProjectRecord(record, user)) {
        throw new Error('Project access denied');
    }

    await Promise.all([
        Project.deleteOne({ workspaceId: user.workspaceId, id }),
        AnalysisHistory.deleteMany({ workspaceId: user.workspaceId, projectId: id }),
        AuditHistory.deleteMany({ workspaceId: user.workspaceId, projectId: id }),
        AuditJob.deleteMany({ workspaceId: user.workspaceId, projectId: id }),
        KeywordJob.deleteMany({ workspaceId: user.workspaceId, projectId: id }),
        KeywordResearch.deleteMany({ workspaceId: user.workspaceId, projectId: id }),
    ]);

    await recordAuditEvent({
        workspaceId: user.workspaceId,
        userId: user.userId,
        action: 'project.deleted',
        entityType: 'project',
        entityId: id,
        metadata: { url: record.url },
    });

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
        buildGetProjectQuery,
        buildListProjectsQuery,
        buildProjectPayload,
        buildViewerScope,
        canManageProjectRecord,
        canManageWorkspaceProjects,
        getDuplicateProjectMessage,
        isDuplicateProjectIdError,
        isPrivateHostname,
        normalizeDomain,
        normalizeOwnerEmail,
        normalizeSearchConsoleSiteUrl,
        normalizeUrl,
        resolveGoogleConnection,
        slugifyId,
        toProjectDto,
    },
};
