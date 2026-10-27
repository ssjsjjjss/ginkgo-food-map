import type { ApiResponse } from '@/shared/api/api.types'
import { httpClient } from '@/shared/api/httpClient'

import type { SystemStatus } from '../model/system.types'

export async function fetchSystemStatus(): Promise<SystemStatus> {
  const response = await httpClient.get<ApiResponse<SystemStatus>>('/public/status')
  return response.data.data
}
