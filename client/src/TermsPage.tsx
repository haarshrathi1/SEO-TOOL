import PublicPageShell from './PublicPageShell';

const TERMS_SECTIONS = [
    {
        title: 'Service access',
        body: 'Workspace access is tied to the Google account that signs in. Admins manage shared access, while self-serve workspaces can create their own projects directly from the setup flow.',
    },
    {
        title: 'Usage',
        body: 'The product provides SEO dashboards, audit workflows, and keyword research tools. You are responsible for the sites and Google properties you connect.',
    },
    {
        title: 'Availability',
        body: 'Features may evolve while checkout, billing, and additional integrations are still being finalized. Public demo data and sample seeds are provided to help you evaluate the product before setup.',
    },
    {
        title: 'Support',
        body: 'If something looks wrong or access needs to be changed, use the contact path shown inside the app. Formal support SLAs are not published yet.',
    },
];

export default function TermsPage({ onCreateWorkspace }: { onCreateWorkspace: () => void }) {
    return (
        <PublicPageShell
            eyebrow="Terms"
            title="Terms of use"
            description="These terms set expectations for account access, connected properties, and the current product stage while self-serve checkout is still being completed."
            actions={(
                <button onClick={onCreateWorkspace} className="border-2 border-black bg-black px-4 py-2 text-xs font-black uppercase tracking-wide text-white hover:bg-yellow-300 hover:text-black">
                    Create Workspace
                </button>
            )}
        >
            <div className="grid gap-4">
                {TERMS_SECTIONS.map((section) => (
                    <section key={section.title} className="operator-panel-inset p-5">
                        <h2 className="text-lg font-black uppercase text-black">{section.title}</h2>
                        <p className="mt-3 text-sm font-medium leading-relaxed text-slate-700">{section.body}</p>
                    </section>
                ))}
            </div>
        </PublicPageShell>
    );
}
