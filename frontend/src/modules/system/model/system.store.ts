import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

import { toErrorMessage } from '@/shared/lib/toErrorMessage'

import { fetchSystemStatus } from '../api/systemApi'
import type { SystemStatus } from './system.types'

export const useSystemStore = defineStore('system', () => {
  const status = ref<SystemStatus | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)
  const online = computed(() => status.value !== null && error.value === null)

  async function loadStatus() {
    loading.value = true
    error.value = null
    try {
      status.value = await fetchSystemStatus()
    } catch (reason) {
      status.value = null
      error.value = toErrorMessage(reason)
    } finally {
      loading.value = false
    }
  }

  return { status, loading, error, online, loadStatus }
})
