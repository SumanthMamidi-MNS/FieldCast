import { SUPPORT_LEVELS, confidenceStyle } from '../../lib/confidenceTexture'
import { TIER_NAME, TIER_SUMMARY } from '../../lib/tiers'
import { TextureSwatch } from '../common/TextureSwatch'
import { TerrainDiagram } from './TerrainDiagram'

const SUPPORT_TITLE = { high: 'High', medium: 'Moderate', low: 'Low' } as const

const SOURCES = [
  {
    name: 'Open-Meteo',
    use: 'Past weather (an ERA5 reanalysis blend) for training and replay, the live block forecast, and elevation.',
  },
  { name: 'GADM 4.1', use: 'Block (taluka) boundaries.' },
  {
    name: 'datameet village boundaries',
    use: '11,740 real village outlines, grouped into village clusters of about six villages each.',
  },
  { name: 'NOAA GHCN-Daily', use: 'Real rain-gauge records, used only for checking, never for training.' },
]

const LIMITS = [
  'Village-level (T3) values are inference, not measurement. Nobody records weather village by village.',
  'Most units are clusters of about six real villages, not official gram-panchayat boundaries. Each village page says which it is.',
  'The model learned from a reanalysis, not from IMD’s operational forecast. You can enter IMD block values with “Use official bulletin”, but the model was not trained on them.',
  'Only 9 quality-checked rain gauges exist in the pilot area, so gauge results carry wide uncertainty.',
  'Trained on monsoon seasons. Requests outside those months are served with confidence halved and a note saying so.',
  'Retrain for each region. In a region it was not trained on, rainfall amounts were worse than simply using the block value.',
  'The distance-to-coast input only makes sense for the peninsular west coast.',
]

export function HowItWorksPage() {
  return (
    <article className="page prose-page">
      <header className="page-head">
        <p className="kicker">How it works</p>
        <h1 className="page-title">From one block number to every village</h1>
        <p className="page-lead">
          IMD issues one forecast per block. But a block in the Western Ghats can hold a rain-soaked
          slope and a dry valley a few kilometres apart. FieldCast refines the block forecast for
          each village using the shape of the land, and says honestly how far each number can be
          trusted.
        </p>
      </header>

      <section className="prose-section" aria-labelledby="hw-refine">
        <h2 id="hw-refine">Refining the block forecast with terrain</h2>
        <TerrainDiagram />
        <div className="prose">
          <p>
            In the monsoon, moist wind blows in from the south-west. Where it meets a slope facing
            the wind, the air rises, cools and drops its rain. On the far side of the ridge, the
            <em> leeward</em> slope, the same air sinks and dries out: a rain shadow. Temperature
            follows height too: higher villages are cooler.
          </p>
          <p>
            FieldCast learned these patterns from several years of past weather across the pilot
            districts. For each village it looks at elevation, slope, which way the slope faces the
            monsoon, roughness and distance to the coast, and predicts how far that village differs
            from the block value. It predicts the <strong>difference</strong>, not a fresh number,
            so if it has learned nothing it simply returns the block value.
          </p>
          <p>
            Village values are then adjusted so their area-weighted average equals the official
            block value. FieldCast never contradicts the agency&rsquo;s own forecast; it only shows
            where within the block the weather is likely to land.
          </p>
          <p>
            Rain is handled in two steps: first the chance that it rains at all (2.5 mm or more,
            IMD&rsquo;s rainy-day threshold), then how much if it does. The chance of rain decides
            spraying and harvest; the amount decides irrigation.
          </p>
        </div>
      </section>

      <section className="prose-section" aria-labelledby="hw-units">
        <h2 id="hw-units">Gram panchayats and village clusters</h2>
        <div className="prose">
          <p>
            Where official gram-panchayat boundaries (from LGD) are available, FieldCast uses them
            and labels the unit a <strong>gram panchayat</strong>. Where they are not, it groups
            about six neighbouring villages into a <strong>village cluster</strong>, an
            approximate boundary, and labels it that way. Every unit served today is a village
            cluster.
          </p>
        </div>
      </section>

      <section className="prose-section" aria-labelledby="hw-conf">
        <h2 id="hw-conf">What the confidence levels mean</h2>
        <div className="prose">
          <p>
            Every number comes with a likely range that should hold the truth on 8 days in 10, and a
            confidence level. Confidence is lower where the village&rsquo;s terrain is unlike anywhere
            the model learned from, or where no rain gauge is nearby. Low confidence widens the range
            and makes the advice more cautious: spraying, fertiliser and harvest move from
            &ldquo;go ahead&rdquo; to &ldquo;take care&rdquo;, never the other way.
          </p>
        </div>
        <ul className="conf-cards">
          {SUPPORT_LEVELS.map((level) => (
            <li key={level} className="conf-card">
              <TextureSwatch support={level} size={36} />
              <div>
                <h3>{SUPPORT_TITLE[level]}</h3>
                <p>{confidenceStyle(level).legendExplanation}</p>
              </div>
            </li>
          ))}
        </ul>
        <p className="muted small">
          On the map, confidence is a pattern, never a paler colour: a faded blue would read as
          &ldquo;less rain&rdquo; rather than &ldquo;less sure&rdquo;.
        </p>
      </section>

      <section className="prose-section" aria-labelledby="hw-tiers">
        <h2 id="hw-tiers">Three levels of evidence</h2>
        <div className="prose">
          <p>Every value says which of these it rests on. Uncertainty widens down the list.</p>
        </div>
        <ol className="tier-cards">
          {(['T1', 'T2', 'T3'] as const).map((t) => (
            <li key={t} className={`tier-card tier-${t.toLowerCase()}`}>
              <span className="tier-card-code">{t}</span>
              <div>
                <h3>{TIER_NAME[t]}</h3>
                <p>{TIER_SUMMARY[t]}</p>
              </div>
            </li>
          ))}
        </ol>
        <p>
          <a href="#/evidence">See the measured results for T1 and T2</a>
        </p>
      </section>

      <section className="prose-section" aria-labelledby="hw-data">
        <h2 id="hw-data">Where the data comes from</h2>
        <dl className="sources">
          {SOURCES.map((s) => (
            <div key={s.name}>
              <dt>{s.name}</dt>
              <dd>{s.use}</dd>
            </div>
          ))}
        </dl>
        <p className="muted small">All public, and none needs an API key.</p>
      </section>

      <section className="prose-section" aria-labelledby="hw-limits">
        <h2 id="hw-limits">Limitations, stated plainly</h2>
        <ol className="limits">
          {LIMITS.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ol>
      </section>
    </article>
  )
}
