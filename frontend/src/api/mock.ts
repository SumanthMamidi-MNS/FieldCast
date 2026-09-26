/**
 * The mock API.
 *
 * Same function signatures as the real client, same response shapes, same
 * failure modes. It also keeps a small artificial latency so the skeleton states
 * are exercised during development rather than discovered in the demo.
 */

import type {
  BaselineComparison,
  BlockForecastResponse,
  BlockSummary,
  EvaluationReports,
  HealthResponse,
  PanchayatGeometry,
  RegionInfo,
} from '../types/api'
import { buildForecast, health, listBaselines, listBlocks, listGeometry } from './mockData'

export class ApiError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

const LATENCY_MS = 260

function delay<T>(value: T, ms = LATENCY_MS): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms))
}

export const mockApi = {
  async getRegions(): Promise<RegionInfo[]> {
    const blocks = listBlocks()
    const districts = [...new Set(blocks.map((b) => b.district))]
    return delay([
      { key: 'mh_ghats', state: blocks[0]?.state ?? 'Maharashtra', districts, served: true },
    ])
  },

  async getBlocks(_region: string): Promise<BlockSummary[]> {
    return delay(listBlocks())
  },

  async getBlockGeometry(_region: string, blockId: string): Promise<PanchayatGeometry[]> {
    const geometry = listGeometry(blockId)
    if (!geometry) throw new ApiError(404, `No geometry for block ${blockId}`)
    return delay(geometry)
  },

  async getBlockForecast(_region: string, blockId: string, date: string): Promise<BlockForecastResponse> {
    const forecast = buildForecast(blockId, date)
    if (!forecast) throw new ApiError(404, `No forecast for block ${blockId}`)
    return delay(forecast, LATENCY_MS + 140)
  },

  async postBlockForecast(
    _region: string,
    blockId: string,
    input: { date: string; block_values: Record<string, number> },
  ): Promise<BlockForecastResponse> {
    if (Object.keys(input.block_values).length === 0) {
      throw new ApiError(422, 'block_values must not be empty')
    }
    const forecast = buildForecast(blockId, input.date, input.block_values)
    if (!forecast) throw new ApiError(404, `No forecast for block ${blockId}`)
    return delay(forecast, LATENCY_MS + 140)
  },

  async getBaselines(_region: string): Promise<BaselineComparison[]> {
    return delay(listBaselines())
  },

  /** The mock has no evaluation reports; the Evidence page shows its empty state. */
  async getEvaluationReports(): Promise<EvaluationReports> {
    return delay({})
  },

  async getHealth(): Promise<HealthResponse> {
    return delay(health(), 80)
  },
}
