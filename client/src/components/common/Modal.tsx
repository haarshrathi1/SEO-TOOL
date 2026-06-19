import { useEffect, useId, useRef } from 'react';

function getFocusableElements(container: HTMLElement | null) {
    if (!container) return [];

    return Array.from(
        container.querySelectorAll<HTMLElement>(
            'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
    ).filter((element) => element.getAttribute('aria-hidden') !== 'true');
}

export default function Modal({
    title,
    onClose,
    children,
    size = 'md',
}: {
    title: string;
    onClose: () => void;
    children: React.ReactNode;
    size?: 'md' | 'lg' | 'xl';
}) {
    const width = size === 'xl' ? 'max-w-5xl' : size === 'lg' ? 'max-w-3xl' : 'max-w-xl';
    const titleId = useId();
    const dialogRef = useRef<HTMLDivElement | null>(null);
    const closeButtonRef = useRef<HTMLButtonElement | null>(null);

    useEffect(() => {
        const previousOverflow = document.body.style.overflow;
        const previousActiveElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        document.body.style.overflow = 'hidden';

        const initialFocus = window.setTimeout(() => {
            closeButtonRef.current?.focus();
        }, 0);

        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                onClose();
                return;
            }

            if (event.key !== 'Tab') {
                return;
            }

            const focusableElements = getFocusableElements(dialogRef.current);
            if (focusableElements.length === 0) {
                event.preventDefault();
                dialogRef.current?.focus();
                return;
            }

            const firstElement = focusableElements[0];
            const lastElement = focusableElements[focusableElements.length - 1];
            const activeElement = document.activeElement;

            if (event.shiftKey && activeElement === firstElement) {
                event.preventDefault();
                lastElement.focus();
            } else if (!event.shiftKey && activeElement === lastElement) {
                event.preventDefault();
                firstElement.focus();
            }
        };

        document.addEventListener('keydown', handleKeyDown);

        return () => {
            window.clearTimeout(initialFocus);
            document.removeEventListener('keydown', handleKeyDown);
            document.body.style.overflow = previousOverflow;
            previousActiveElement?.focus();
        };
    }, [onClose]);

    return (
        <div
            className="fixed inset-0 z-[80] flex items-center justify-center bg-black/30 p-4 backdrop-blur-sm"
            onMouseDown={onClose}
        >
            <div
                ref={dialogRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby={titleId}
                tabIndex={-1}
                className={`w-full ${width} max-h-[85vh] overflow-y-auto rounded-2xl border border-slate-200 bg-white shadow-2xl`}
                onMouseDown={(event) => event.stopPropagation()}
            >
                <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
                    <h2 id={titleId} className="text-lg font-bold text-slate-900">{title}</h2>
                    <button
                        ref={closeButtonRef}
                        onClick={onClose}
                        className="text-sm font-medium text-slate-400 transition hover:text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
                    >
                        Close
                    </button>
                </div>
                <div className="p-5">{children}</div>
            </div>
        </div>
    );
}
