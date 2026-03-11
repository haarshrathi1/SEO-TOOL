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

    return (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/30 p-4 backdrop-blur-sm" onClick={onClose}>
            <div className={`w-full ${width} max-h-[85vh] overflow-y-auto rounded-2xl border border-slate-200 bg-white shadow-2xl`} onClick={(event) => event.stopPropagation()}>
                <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
                    <h2 className="text-lg font-bold text-slate-900">{title}</h2>
                    <button onClick={onClose} className="text-sm font-medium text-slate-400 transition hover:text-slate-700">Close</button>
                </div>
                <div className="p-5">{children}</div>
            </div>
        </div>
    );
}
