interface LogoProps {
    /** 'dark' = bars black, CLIMB black, SEO yellow — for light backgrounds
     *  'light' = bars white, CLIMB white, SEO yellow — for dark backgrounds */
    variant?: 'dark' | 'light';
    /** Pixel height of the SVG icon. The wordmark scales proportionally. Default 28. */
    height?: number;
    /** Extra CSS classes on the outer wrapper */
    className?: string;
}

/**
 * ClimbSEO inline SVG logo — matches the brand image exactly:
 *   3 ascending bars (dark or white) + amber arrow + "CLIMB" + "SEO" wordmark.
 *
 * Fully scalable, no external file dependencies, no whitespace issues.
 */
export default function Logo({ variant = 'dark', height = 28, className = '' }: LogoProps) {
    const bar    = variant === 'light' ? '#FFFFFF' : '#1A1A1A';
    const word   = variant === 'light' ? '#FFFFFF' : '#1A1A1A';
    const yellow = '#F5B800';
    const glow   = variant === 'light' ? '0 0 12px #FBBF24cc, 0 0 28px #FBBF2466' : 'none';

    // Wordmark font-size scales with icon height
    const fontSize = height * 0.72;

    return (
        <div
            className={`inline-flex items-center gap-2 select-none shrink-0 ${className}`}
            aria-label="ClimbSEO"
            role="img"
        >
            {/* ── Icon mark — 3 ascending bars + diagonal arrow ── */}
            <svg
                viewBox="0 0 56 44"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
                style={{ height: `${height}px`, width: 'auto' }}
                aria-hidden="true"
            >
                {/* Three ascending bars */}
                <rect x="2"  y="28" width="12" height="14" rx="1.5" fill={bar} />
                <rect x="17" y="18" width="12" height="24" rx="1.5" fill={bar} />
                <rect x="32" y="6"  width="12" height="36" rx="1.5" fill={bar} />

                {/* Arrow shaft — diagonal across bars */}
                <line
                    x1="4"  y1="38"
                    x2="50" y2="4"
                    stroke={yellow}
                    strokeWidth="4"
                    strokeLinecap="round"
                />

                {/* Arrow head — solid triangle */}
                <polygon
                    points="50,2 39,7 45,15"
                    fill={yellow}
                />
            </svg>

            {/* ── Wordmark ── */}
            <span
                style={{
                    fontSize: `${fontSize}px`,
                    fontWeight: 900,
                    letterSpacing: '-0.02em',
                    lineHeight: 1,
                    whiteSpace: 'nowrap',
                }}
            >
                <span style={{ color: word }}>CLIMB</span>
                <span style={{ color: yellow, textShadow: glow }}>SEO</span>
            </span>
        </div>
    );
}
