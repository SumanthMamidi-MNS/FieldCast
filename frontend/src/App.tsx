import { Suspense, lazy } from 'react'
import { USING_MOCK } from './api/client'
import { useHashRoute } from './hooks/useHashRoute'
import { TopBar } from './components/shell/TopBar'
import { ForecastPage } from './components/forecast/ForecastPage'
import { Skeleton, SkeletonText } from './components/common/Skeleton'

// The two reading pages are not needed for the first paint of the map.
const EvidencePage = lazy(() =>
  import('./components/evidence/EvidencePage').then((m) => ({ default: m.EvidencePage })),
)
const HowItWorksPage = lazy(() =>
  import('./components/about/HowItWorksPage').then((m) => ({ default: m.HowItWorksPage })),
)

function PageFallback() {
  return (
    <div className="page" aria-busy="true">
      <Skeleton height="2.2rem" width="50%" />
      <SkeletonText lines={4} />
      <Skeleton height="240px" radius="12px" />
    </div>
  )
}

export default function App() {
  const route = useHashRoute()

  return (
    <div className={`app route-${route}`}>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <TopBar route={route} />
      {USING_MOCK && (
        <p className="mock-banner" role="status">
          <strong>Demo data.</strong> Running on the built-in mock (VITE_USE_MOCK=true). These numbers
          are generated in the browser, not by the model.
        </p>
      )}
      {/* The forecast stays mounted so its map, block and village survive a visit to other pages. */}
      <div hidden={route !== 'forecast'} className="route-forecast-wrap">
        <ForecastPage active={route === 'forecast'} />
      </div>
      {route !== 'forecast' && (
        <main id="main" className="page-main" tabIndex={-1}>
          <Suspense fallback={<PageFallback />}>
            {route === 'evidence' ? <EvidencePage /> : <HowItWorksPage />}
          </Suspense>
        </main>
      )}
    </div>
  )
}
