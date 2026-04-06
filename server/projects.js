const { Project } = require('./models');
const { assertPublicHttpUrl, isPrivateHostname } = require('./networkSafety');

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
        ga4PropertyId: record.ga4PropertyId || '',
        spreadsheetId: record.spreadsheetId || '',
        sheetGid: Number.isFinite(record.sheetGid) ? record.sheetGid : 0,
        auditMaxPages: record.auditMaxPages || 200,
        isActive: record.isActive !== false,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
    };
}

async function buildProjectPayload(input, existing = null) {
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

    return {
        id: existing?.id || slugifyId(input.id || name),
        name,
        domain,
        url,
        ga4PropertyId: normalizeText(input.ga4PropertyId || existing?.ga4PropertyId || ''),
        spreadsheetId: normalizeText(input.spreadsheetId || existing?.spreadsheetId || ''),
        sheetGid: Number.isFinite(Number(input.sheetGid)) ? Number(input.sheetGid) : Number(existing?.sheetGid || 0),
        auditMaxPages: Number.isFinite(auditMaxPages) && auditMaxPages > 0 ? Math.min(auditMaxPages, 500) : 200,
        isActive: typeof input.isActive === 'boolean' ? input.isActive : existing?.isActive !== false,
    };
}

function buildListProjectsQuery(user, options = {}) {
    const includeInactive = options.includeInactive === true && user?.role === 'admin';
    const query = includeInactive ? {} : { isActive: true };

    if (user?.role === 'viewer') {
        if (!Array.isArray(user.projectIds) || user.projectIds.length === 0) {
            return null;
        }
        query.id = { $in: user.projectIds };
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
        if (!Array.isArray(user.projectIds) || user.projectIds.length === 0) {
            return null;
        }
        if (id && !user.projectIds.includes(id)) {
            return null;
        }
        query.id = id || { $in: user.projectIds };
    }

    return query;
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

async function createProject(input) {
    const payload = await buildProjectPayload(input);
    const existing = await Project.findOne({ id: payload.id }).lean();
    if (existing) {
        throw new Error('Project ID already exists');
    }

    const doc = await Project.create(payload);
    return toProjectDto(doc.toObject());
}

async function updateProject(id, input) {
    const existing = await Project.findOne({ id });
    if (!existing) {
        throw new Error('Project not found');
    }

    const payload = await buildProjectPayload(input, existing.toObject());
    payload.id = existing.id;

    existing.set(payload);
    await existing.save();
    return toProjectDto(existing.toObject());
}

async function archiveProject(id) {
    const doc = await Project.findOneAndUpdate(
        { id },
        { isActive: false },
        { new: true }
    ).lean();

    if (!doc) {
        throw new Error('Project not found');
    }

    return toProjectDto(doc);
}

module.exports = {
    initializeProjects,
    listProjects,
    getProject,
    createProject,
    updateProject,
    archiveProject,
    __internal: {
        normalizeUrl,
        normalizeDomain,
        slugifyId,
        buildProjectPayload,
        buildListProjectsQuery,
        buildGetProjectQuery,
        toProjectDto,
        isPrivateHostname,
    },
};

