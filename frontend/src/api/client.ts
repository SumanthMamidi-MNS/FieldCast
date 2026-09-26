/**
 * The only module in the app that knows where data comes from.
 *
 * Everything else imports `api` from here. The real FastAPI service
 * (`backend/app/main.py`) is the default; `VITE_USE_MOCK=true` swaps in the
 * in-browser mock with no component changes.
 *
 * In dev, requests go to relative `/api/...` paths and Vite proxies them to
 * http://localhost:8000 (see vite.config.ts), so there is no CORS setup to get
 * wrong. `VITE_API_BASE_URL` overrides this for a deployed backend.
 */

import type {
  BaselineComparison,
  BlockForecastResponse,
  BlockSummary,
  HealthResponse,
  PanchayatGeometry,
} from '../types/api'
import { ApiError, mockApi } from './mock'

export { ApiError }

/** Body of `POST /api/blocks/{id}/forecast` — mirrors `BlockInput` in main.py. */
export interface BlockInput {
  date: string
  block_values: Record<string, number>
}

export interface WeatherApi {
  getBlocks(): Promise<BlockSummary[]>
  getBlockGeometry(blockId: string): Promise<PanchayatGeometry[]>
  getBlockForecast(blockId: string, date: string): Promise<BlockForecastResponse>
  postBlockForecast(blockId: string, input: BlockInput): Promise<BlockForecastResponse>
  getBaselines(): Promise<BaselineComparison[]>
  getHealth(): Promise<HealthResponse>
}

/** Real API unless explicitly switched to the mock. */
export const USING_MOCK = import.meta.env.VITE_USE_MOCK === 'true'

/** Region key the backend trains and serves (backend/config.py PRIMARY_REGION). */
export const REGION = import.meta.env.VITE_REGION ?? 'mh_ghats'

const BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '')

/**
 * Turn FastAPI's `detail` into one readable sentence. It is either a string
 * (our own HTTPExceptions) or a list of Pydantic validation errors.
 */
export function readDetail(body: unknown): string | null {
  if (!body || typeof body !== 'object' || !('detail' in body)) return null
  const detail = (body as { detail: unknown }).detail
  if (typeof detail === 'string') return detail
  if (Array.isArray(detail)) {
    const parts = detail
      .map((d) => {
        if (d && typeof d === 'object' && 'msg' in d) {
          const loc = 'loc' in d && Array.isArray(d.loc) ? d.loc.filter((l: unknown) => l !== 'body' && l !== 'query').join('.') : ''
          return loc ? `${loc}: ${String(d.msg)}` : String(d.msg)
        }
        return null
      })
      .filter((s): s is string => s !== null)
    return parts.length > 0 ? parts.join('; ') : null
  }
  return null
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${BASE_URL}${path}`, {
      ...init,
      headers: { Accept: 'application/json', ...(init?.headers ?? {}) },
    })
  } catch {
    throw new ApiError(
      0,
      'Could not reach the forecast service. Check that the backend is running on port 8000.',
    )
  }
  if (!response.ok) {
    let detail: string | null = null
    try {
      detail = readDetail(await response.json())
    } catch {
      // Non-JSON error body; fall through to the status line.
    }
    throw new ApiError(response.status, detail ?? `${response.status} ${response.statusText}`)
  }
  return (await response.json()) as T
}

const q = `region=${encodeURIComponent(REGION)}`
const blockPath = (id: string) => `/api/blocks/${encodeURIComponent(id)}`

const httpApi: WeatherApi = {
  getBlocks: () => request<BlockSummary[]>(`/api/blocks?${q}`),
  getBlockGeometry: (blockId) =>
    request<PanchayatGeometry[]>(`${blockPath(blockId)}/panchayats?${q}`),
  getBlockForecast: (blockId, date) =>
    request<BlockForecastResponse>(
      `${blockPath(blockId)}/forecast?date=${encodeURIComponent(date)}&${q}`,
    ),
  postBlockForecast: (blockId, input) =>
    request<BlockForecastResponse>(`${blockPath(blockId)}/forecast?${q}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    }),
  getBaselines: () => request<BaselineComparison[]>(`/api/evaluation?${q}`),
  getHealth: () => request<HealthResponse>('/api/health'),
}

export const api: WeatherApi = USING_MOCK ? mockApi : httpApi

/**
 * Default date: a replay day inside the held-out 2023 test season, so the
 * dashboard opens on something the backend can actually serve.
 */
export const DEFAULT_DATE = '2023-07-20'

export const DATE_HINT =
  'Available: 1 June – 30 September in 2022 or 2023 (past monsoon seasons replayed from records), ' +
  'or from yesterday up to 15 days ahead (live forecast).'
