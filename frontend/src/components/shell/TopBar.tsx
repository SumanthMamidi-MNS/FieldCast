import { ROUTES, type Route } from '../../lib/route'
import { Logo } from '../brand/Logo'

export function TopBar({ route }: { route: Route }) {
  return (
    <header className="topbar">
      <a className="topbar-brand" href="#/forecast" aria-label="FieldCast, go to the forecast">
        <Logo tagline />
      </a>
      <nav className="topbar-nav" aria-label="Main">
        <ul>
          {ROUTES.map((r) => (
            <li key={r.route}>
              <a
                href={r.hash}
                className={`nav-link${route === r.route ? ' is-active' : ''}`}
                aria-current={route === r.route ? 'page' : undefined}
              >
                {r.label}
              </a>
            </li>
          ))}
        </ul>
      </nav>
    </header>
  )
}
