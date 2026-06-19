const dns = require('node:dns/promises');
const net = require('node:net');

function normalizePublicHttpUrl(value) {
    if (typeof value !== 'string') {
        return '';
    }

    const trimmed = value.trim();
    if (!trimmed) {
        return '';
    }

    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) && !/^https?:\/\//i.test(trimmed)) {
        return '';
    }

    const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;

    try {
        const parsed = new URL(withProtocol);
        if (!['http:', 'https:'].includes(parsed.protocol)) {
            return '';
        }
        return parsed.toString();
    } catch {
        return '';
    }
}

function isPrivateHostname(hostname) {
    const normalized = String(hostname || '').trim().toLowerCase();
    if (!normalized) {
        return true;
    }

    if (normalized === 'localhost' || normalized === '127.0.0.1' || normalized === '::1') {
        return true;
    }

    if (normalized.endsWith('.local')) {
        return true;
    }

    const ipType = net.isIP(normalized);
    if (ipType === 4) {
        const parts = normalized.split('.').map((part) => Number(part));
        if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
            return true;
        }

        if (parts[0] === 10 || parts[0] === 127 || parts[0] === 0) {
            return true;
        }

        if (parts[0] === 169 && parts[1] === 254) {
            return true;
        }

        if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) {
            return true;
        }

        if (parts[0] === 192 && parts[1] === 168) {
            return true;
        }

        return false;
    }

    if (ipType === 6) {
        return normalized === '::1'
            || normalized.startsWith('fc')
            || normalized.startsWith('fd')
            || normalized.startsWith('fe80');
    }

    return false;
}

async function assertPublicHttpUrl(value) {
    const normalizedUrl = normalizePublicHttpUrl(value);
    if (!normalizedUrl) {
        throw new Error('URL must be a valid public http(s) address');
    }

    const parsedUrl = new URL(normalizedUrl);
    if (isPrivateHostname(parsedUrl.hostname)) {
        throw new Error('Private and localhost URLs are not allowed');
    }

    const addresses = await dns.lookup(parsedUrl.hostname, { all: true, verbatim: true });
    if (!Array.isArray(addresses) || addresses.length === 0) {
        throw new Error('URL hostname could not be resolved');
    }

    if (addresses.some((entry) => isPrivateHostname(entry?.address))) {
        throw new Error('Private and localhost URLs are not allowed');
    }

    return normalizedUrl;
}

module.exports = {
    normalizePublicHttpUrl,
    isPrivateHostname,
    assertPublicHttpUrl,
};
