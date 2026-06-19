import PublicPageShell from './PublicPageShell';

const PRIVACY_SECTIONS = [
    {
        title: 'What we collect',
        body: 'Your account uses Google sign-in. We store your workspace profile, project settings, and the SEO data needed to run dashboard snapshots, audits, and saved keyword research.',
    },
    {
        title: 'How Google data is used',
        body: 'When you connect Search Console or GA4, the app reads only the properties you authorize so it can populate dashboard reports and project setup recommendations.',
    },
    {
        title: 'Exports and retention',
        body: 'You can export dashboard, audit, and keyword outputs from the product. Demo data shown on the public demo page is bundled sample data, not customer data.',
    },
    {
        title: 'Contact',
        body: 'Questions about privacy can be sent to the support address shown in the app footer until a dedicated support portal is published.',
    },
];

export default function PrivacyPage({ onCreateWorkspace }: { onCreateWorkspace: () => void }) {
    return (
        <PublicPageShell
            eyebrow="Privacy"
            title="Privacy policy"
            description="This page gives buyers a plain-language view of what data the app stores today and how connected Google data is used."
            actions={(
                <button onClick={onCreateWorkspace} className="border-2 border-black bg-black px-4 py-2 text-xs font-black uppercase tracking-wide text-white hover:bg-yellow-300 hover:text-black">
                    Create Workspace
                </button>
            )}
        >
            <div className="grid gap-4">
                {PRIVACY_SECTIONS.map((section) => (
                    <section key={section.title} className="operator-panel-inset p-5">
                        <h2 className="text-lg font-black uppercase text-black">{section.title}</h2>
                        <p className="mt-3 text-sm font-medium leading-relaxed text-slate-700">{section.body}</p>
                    </section>
                ))}
            </div>
        </PublicPageShell>
    );
}
