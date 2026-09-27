import { SUPPORT_LEVELS, confidenceStyle } from '../../lib/confidenceTexture'
import { TIER_NAME, TIER_SUMMARY } from '../../lib/tiers'
import { TextureSwatch } from '../common/TextureSwatch'
import { TerrainDiagram } from './TerrainDiagram'

const SUPPORT_TITLE = { high: 'High', medium: 'Moderate', low: 'Low' } as const

const SOURCES = [
  {
    name: 'Open-Meteo',
    use: 'Past weather (an ERA5 reanalysis blend) for training and replay, and the live block forecast.',
  },
  {
    name: 'AWS Terrain Tiles',
    use: 'Elevation for every terrain input, including the ridge upwind of each gram panchayat.',
  },
  { name: 'Natural Earth', use: 'Coastline, for distance to the sea.' },
  { name: 'GADM 4.1', use: 'Block (taluka) boundaries.' },
  { name: 'datameet village boundaries', use: 'Real village outlines: 11,740 in Maharashtra and 7,999 in Karnataka.' },
  {
    name: 'LGD (Local Government Directory)',
    use: 'Which gram panchayat each village belongs to, joined by census village code.',
  },
  {
    name: 'NOAA GHCN-Daily',
    use: 'Real rain-gauge records: a handful of modern gauges, and about 100 per state from the late 1950s. Used for checking and range calibration, never for training.',
  },
]

/** From the README's "Limitations, stated plainly"; keep the two in step. */
const LIMITS = [
  'Panchayat-level (T3) values are inference: no panchayat-scale measurements exist to check them against.',
  'About 5% of villages could not be matched to a gram panchayat in LGD and are grouped into labelled village clusters.',
  'The models learn from a reanalysis (ERA5), not an IMD operational forecast. IMD block values can be supplied through the app (“Use official bulletin”), but were not used in training.',
  'Modern rain gauges are scarce (4 in the modelled Maharashtra blocks); the ~100-gauge test uses 1960, when the reanalysis assimilated fewer observations.',
  'Each state needs its own training: in a region it was not trained on, rainfall amounts were worse than the block value.',
  'Humidity and wind have no gauge validation, so their ranges use a fixed widening.',
]

const UNIT_STATS = [
  { state: 'Maharashtra', gp: '8,072', clusters: '138', matched: '94%' },
  { state: 'Karnataka', gp: '1,730', clusters: '63', matched: '96%' },
]

export function HowItWorksPage() {
  return (
    <article className="page prose-page">
      <header className="page-head">
        <p className="kicker">How it works</p>
        <h1 className="page-title">From one block number to every gram panchayat</h1>
        <p className="page-lead">
          IMD issues one forecast per block. But a block in the Western Ghats can hold a rain-soaked
          slope and a dry valley a few kilometres apart. FieldCast refines the block forecast for
          each gram panchayat using the shape of the land, and says honestly how far each number
          can be trusted.
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
            follows height too: higher places are cooler.
          </p>
          <p>
            A rain shadow is caused by the ridge <strong>upwind</strong> of a place, not by its own
            slope. So for every gram panchayat FieldCast looks back along the monsoon wind (from
            245°, the south-west) and measures how high the ridge in the way stands, and how
            steeply the land rises just ahead. A village on gentle ground behind a tall ridge is
            still in the shadow.
          </p>
          <p>
            Alongside those, it looks at elevation, slope, which way the slope faces the monsoon,
            roughness and distance to the coast, and predicts how far each gram panchayat differs
            from the block value. It predicts the <strong>difference</strong>, not a fresh number,
            so if it has learned nothing it simply returns the block value.
          </p>
          <p>
            It learned from the <strong>whole year</strong>, not just the rains: four monsoons
            (2019–2022) and the 2021–22 dry season, October to May. The 2022–23 dry season and the 2023
            monsoon were kept back for testing, so the results on the Evidence page come from
            seasons the model never saw.
          </p>
          <p>
            Panchayat values are then adjusted so their area-weighted average equals the official
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
        <h2 id="hw-units">Real gram panchayats</h2>
        <div className="prose">
          <p>
            Each unit on the map is a real <strong>gram panchayat</strong>. FieldCast builds it from
            the outlines of the villages that belong to it, using the Government of India&rsquo;s
            Local Government Directory (LGD), matched village by village on the census code. A gram
            panchayat covers about 1.4 villages on average.
          </p>
          <p>
            A few villages have no match in LGD. Rather than guess, FieldCast groups them into a
            small <strong>village cluster</strong> and says so: the list marks it
            &ldquo;cluster&rdquo;, and its page reads &ldquo;Village cluster (approximate
            boundary)&rdquo;.
          </p>
        </div>
        <table className="unit-stats">
          <caption className="visually-hidden">Gram panchayats and village clusters served, by state</caption>
          <thead>
            <tr>
              <th scope="col">State</th>
              <th scope="col">Gram panchayats</th>
              <th scope="col">Village clusters</th>
              <th scope="col">Villages matched</th>
            </tr>
          </thead>
          <tbody>
            {UNIT_STATS.map((s) => (
              <tr key={s.state}>
                <th scope="row">{s.state}</th>
                <td className="num">{s.gp}</td>
                <td className="num">{s.clusters}</td>
                <td className="num">{s.matched}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="prose-section" aria-labelledby="hw-conf">
        <h2 id="hw-conf">What the confidence levels mean</h2>
        <div className="prose">
          <p>
            Every number comes with a likely range that should hold the truth on 8 days in 10, and a
            confidence level. Confidence is lower where the panchayat&rsquo;s terrain is unlike anywhere
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
          <p>
            Rain gauges are the real test, and modern ones are scarce: only 4 share daily records
            in the modelled Maharashtra blocks. India&rsquo;s older station network had about 100
            gauges per state, so FieldCast is also checked against roughly 100 historical gauges
            per state in the 1960 monsoon, none of them used in training. The likely ranges were
            widened using the 1958 monsoon so they hold real gauge readings about 8 days in 10.
          </p>
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
