<script setup lang="ts">
import AppHeader from '@/shared/ui/layout/AppHeader.vue'
</script>

<template>
  <div class="app-shell">
    <AppHeader />
    <main>
      <RouterView />
    </main>
  </div>
</template>
