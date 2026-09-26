/** How each advisory action is worded and drawn. */

import type { AdvisoryAction } from '../types/api'

export interface ActionPresentation {
  /** What the officer tells the farmer. */
  word: string
  /** Distinct silhouette per action — the cue that survives colour-blindness. */
  glyph: 'check' | 'triangle' | 'octagon' | 'question'
}

export const ACTIONS: Record<AdvisoryAction, ActionPresentation> = {
  proceed: { word: 'Go ahead', glyph: 'check' },
  caution: { word: 'Take care', glyph: 'triangle' },
  avoid: { word: 'Hold off', glyph: 'octagon' },
  no_guidance: { word: 'No advice', glyph: 'question' },
}

export function actionPresentation(action: AdvisoryAction): ActionPresentation {
  return ACTIONS[action] ?? ACTIONS.no_guidance
}
