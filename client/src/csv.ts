export function downloadCsv(filename: string, headers: string[], rows: Array<Array<string | number | null | undefined>>) {
    const escape = (value: string | number | null | undefined) => {
        const text = value == null ? '' : String(value);
        const normalized = text.replace(/"/g, '""');
        return /[",\n]/.test(normalized) ? `"${normalized}"` : normalized;
    };

    const csv = [headers, ...rows].map((row) => row.map(escape).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
}
