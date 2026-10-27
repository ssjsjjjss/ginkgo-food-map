<script setup lang="ts">
import { computed, onMounted } from 'vue'

import { useSystemStore } from '../model/system.store'

const systemStore = useSystemStore()
const statusText = computed(() => {
  if (systemStore.loading) return '正在连接 Java 后端…'
  if (systemStore.error) return '后端暂未连接'
  return 'Vue 与 Java 后端连接正常'
})

onMounted(() => systemStore.loadStatus())
</script>

<template>
  <section class="status-card" :class="{ online: systemStore.online }" aria-live="polite">
    <span class="status-dot" aria-hidden="true"></span>
    <div>
      <strong>{{ statusText }}</strong>
      <p v-if="systemStore.error">启动后端后刷新页面即可：{{ systemStore.error }}</p>
      <p v-else-if="systemStore.status">
        {{ systemStore.status.application }} · {{ systemStore.status.architecture }}
      </p>
    </div>
  </section>
</template>
