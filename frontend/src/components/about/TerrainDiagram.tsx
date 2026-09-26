/**
 * Illustration of the core idea: one official block number in, different
 * village numbers out, driven by which side of the hills a village is on.
 * Text lives in HTML so it reflows on a phone; the SVG only draws terrain,
 * wind and rain, with a few large labels.
 */
export function TerrainDiagram() {
  return (
    <figure className="diagram">
      <div className="diagram-flow">
        <div className="diagram-card">
          <p className="diagram-step">1 · In</p>
          <p className="diagram-card-title">Official block forecast</p>
          <p className="diagram-big num">
            12<span> mm</span>
          </p>
          <p className="diagram-note">One number for every village in the block.</p>
        </div>

        <span className="diagram-arrow" aria-hidden>
          <svg viewBox="0 0 24 24" width="28" height="28">
            <path d="M4 12h15m0 0-5-5m5 5-5 5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>

        <div className="diagram-terrain">
          <p className="diagram-step">2 · Terrain</p>
          <svg viewBox="0 0 400 230" role="img" aria-labelledby="terrain-title terrain-desc">
            <title id="terrain-title">Monsoon wind meeting a ridge</title>
            <desc id="terrain-desc">
              Moist south-west monsoon wind rises over the windward slope and drops rain there. The
              far side of the ridge sits in a rain shadow and stays drier.
            </desc>
            {/* Wind */}
            <g stroke="var(--brand-500)" strokeWidth="3" fill="none" strokeLinecap="round">
              <path d="M14 112c40 0 70-4 104-26" />
              <path d="M14 138c46 0 84-8 118-34" />
              <path d="M110 80l10 5-4 10M124 98l10 5-4 10" strokeLinejoin="round" />
            </g>
            <text x="14" y="40" className="diagram-svg-label">Monsoon wind</text>
            <text x="14" y="58" className="diagram-svg-sub">from the south-west</text>
            {/* Cloud and rain on the windward side */}
            <g transform="translate(14 8)">
              <path
                d="M140 56a16 16 0 0 1 30-8 14 14 0 0 1 26 6 12 12 0 0 1-2 24h-50a12 12 0 0 1-4-22z"
                fill="#dfe7ee"
                stroke="#9aaebf"
                strokeWidth="1.5"
              />
              <path
                d="M150 86l-5 12M163 86l-5 12M176 86l-5 12M189 86l-5 12M156 104l-4 10M170 104l-4 10M183 104l-4 10"
                stroke="var(--rain)"
                strokeWidth="2.4"
                strokeLinecap="round"
              />
            </g>
            {/* Sun on the leeward side */}
            <g stroke="var(--accent-500)" strokeWidth="2.4" strokeLinecap="round">
              <circle cx="330" cy="56" r="12" fill="#fbe0bf" />
              <path d="M330 32v-6M330 86v-6M306 56h-6M360 56h-6M313 39l-4-4M351 77l-4-4M313 73l-4 4M351 35l-4 4" />
            </g>
            {/* Terrain */}
            <path
              d="M0 230V200c40-4 80-14 120-38s60-62 90-66c28-4 40 32 70 54s70 38 120 46v34z"
              fill="var(--brand-100)"
              stroke="var(--brand-600)"
              strokeWidth="2"
            />
            <path d="M0 214c60-4 120-10 180-8s140 8 220 6" stroke="var(--brand-300)" strokeWidth="1.5" fill="none" strokeDasharray="4 5" />
            {/* Villages */}
            <g className="diagram-villages">
              <circle cx="132" cy="154" r="9" />
              <text x="132" y="159">A</text>
              <circle cx="210" cy="104" r="9" />
              <text x="210" y="109">B</text>
              <circle cx="318" cy="182" r="9" />
              <text x="318" y="187">C</text>
            </g>
            <text x="300" y="150" className="diagram-svg-sub">rain shadow</text>
          </svg>
        </div>

        <span className="diagram-arrow" aria-hidden>
          <svg viewBox="0 0 24 24" width="28" height="28">
            <path d="M4 12h15m0 0-5-5m5 5-5 5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>

        <div className="diagram-card">
          <p className="diagram-step">3 · Out</p>
          <p className="diagram-card-title">Refined for each village</p>
          <ul className="diagram-villages-list num">
            <li>
              <span className="v-dot">A</span> Windward slope <strong>18 mm</strong>
            </li>
            <li>
              <span className="v-dot">B</span> Ridge <strong>13 mm</strong>
            </li>
            <li>
              <span className="v-dot">C</span> Rain shadow <strong>5 mm</strong>
            </li>
          </ul>
          <p className="diagram-note">Together they still average to the official 12 mm.</p>
        </div>
      </div>
      <figcaption className="diagram-caption">Illustration with made-up numbers, not a real forecast.</figcaption>
    </figure>
  )
}
