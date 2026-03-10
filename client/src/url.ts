export function getUrlPathLabel(url: string): string {
    try {
        const parsed = new URL(url);
        const label = `${parsed.pathname || '/'}${parsed.search}${parsed.hash}`;
        return label || '/';
    } catch {
        return url || '/';
    }
}
