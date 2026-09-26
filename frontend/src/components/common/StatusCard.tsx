import type { ReactNode } from 'react'
import { Icon, type IconName } from './Icon'

interface StatusCardProps {
  tone: 'error' | 'empty' | 'info'
  title: string
  children?: ReactNode
  actions?: ReactNode
  icon?: IconName
  /** role="alert" for errors that just happened; status otherwise. */
  live?: boolean
}

/** One shape for every empty, error and notice state, so they read as a family. */
export function StatusCard({ tone, title, children, actions, icon, live = false }: StatusCardProps) {
  const glyph: IconName = icon ?? (tone === 'error' ? 'alert' : tone === 'empty' ? 'map-pin' : 'info')
  return (
    <div className={`status-card status-${tone}`} role={live ? (tone === 'error' ? 'alert' : 'status') : undefined}>
      <span className="status-icon">
        <Icon name={glyph} size={20} />
      </span>
      <div className="status-body">
        <h2 className="status-title">{title}</h2>
        {children && <div className="status-text">{children}</div>}
        {actions && <div className="status-actions">{actions}</div>}
      </div>
    </div>
  )
}
