<script setup lang="ts">
import { SystemStatus } from '@/modules/system'

const capabilities = [
  { title: 'MySQL', text: '保存用户、店铺和评价等核心业务数据。' },
  { title: 'Redis', text: '承载登录状态、验证码和热点数据缓存。' },
  { title: '模块化单体', text: '先把边界做清楚，再按真实压力拆分服务。' },
]
</script>

<template>
  <div class="home-page">
    <section class="hero">
      <div class="hero-copy">
        <p class="eyebrow">UESTC · CHENGDU FOOD GUIDE</p>
        <h1>认真吃饭，<br /><span>认真记录。</span></h1>
        <p class="summary">
          新版前端已经切换到 Vue 3。接下来会把地图、店铺、评价和登录功能逐个从旧页面迁入组件。
        </p>
        <div class="hero-actions">
          <button class="primary-action" type="button" disabled>浏览美食地图</button>
          <a href="#migration">查看迁移进度</a>
        </div>
      </div>

      <aside class="hero-card" aria-label="项目当前状态">
        <span class="cup">杯</span>
        <p>当前阶段</p>
        <strong>Vue 工程基线</strong>
        <small>页面功能正在从旧版渐进迁移</small>
      </aside>
    </section>

    <SystemStatus />

    <section id="migration" class="capability-section">
      <div class="section-heading">
        <p class="eyebrow">ARCHITECTURE</p>
        <h2>轻量，但不是玩具架构</h2>
      </div>
      <div class="capability-grid">
        <article v-for="item in capabilities" :key="item.title">
          <h3>{{ item.title }}</h3>
          <p>{{ item.text }}</p>
        </article>
      </div>
    </section>
  </div>
</template>
