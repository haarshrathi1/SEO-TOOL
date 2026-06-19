type ToastPush = (options: {
    tone: 'success' | 'error' | 'info';
    title: string;
    description?: string;
}) => void;

export function printCurrentPage() {
    window.print();
}

export async function copyCurrentUrl(push: ToastPush, path = window.location.pathname) {
    const url = new URL(path, window.location.origin).toString();

    try {
        await navigator.clipboard.writeText(url);
        push({ tone: 'success', title: 'Link copied', description: url });
    } catch {
        push({ tone: 'error', title: 'Copy failed', description: 'Clipboard access was blocked by the browser.' });
    }
}

export async function shareCurrentUrl(
    push: ToastPush,
    options: { path?: string; title: string; text?: string },
) {
    const url = new URL(options.path || window.location.pathname, window.location.origin).toString();

    if (navigator.share) {
        try {
            await navigator.share({
                title: options.title,
                text: options.text,
                url,
            });
            return;
        } catch (error) {
            if (error instanceof Error && error.name === 'AbortError') {
                return;
            }
        }
    }

    await copyCurrentUrl(push, options.path);
}
