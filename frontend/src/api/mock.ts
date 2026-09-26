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
  HealthResponse,
  PanchayatGeometry,
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
  async getBlocks(): Promise<BlockSummary[]> {
    return delay(listBlocks())
  },

  async getBlockGeometry(blockId: string): Promise<PanchayatGeometry[]> {
    const geometry = listGeometry(blockId)
    if (!geometry) throw new ApiError(404, `No geometry for block ${blockId}`)
    return delay(geometry)
  },

  async getBlockForecast(blockId: string, date: string): Promise<BlockForecastResponse> {
    const forecast = buildForecast(blockId, date)
    if (!forecast) throw new ApiError(404, `No forecast for block ${blockId}`)
    return delay(forecast, LATENCY_MS + 140)
  },

  async postBlockForecast(
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

  async getBaselines(): Promise<BaselineComparison[]> {
    return delay(listBaselines())
  },

  async getHealth(): Promise<HealthResponse> {
    return delay(health(), 80)
  },
}
