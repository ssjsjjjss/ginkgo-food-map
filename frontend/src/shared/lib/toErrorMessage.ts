import axios from 'axios'

export function toErrorMessage(reason: unknown): string {
  if (axios.isAxiosError(reason)) {
    return reason.response?.data?.message || reason.message || '网络请求失败'
  }
  return reason instanceof Error ? reason.message : '未知错误'
}
