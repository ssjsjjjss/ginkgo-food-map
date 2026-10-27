<template>
  <header class="topbar">
    <RouterLink class="brand" to="/" aria-label="返回首页">
      <span class="brand-mark" aria-hidden="true">杏</span>
      <span>
        <strong>Ginkgo 美食地图</strong>
        <small>Ginkgo 烹饪社</small>
      </span>
    </RouterLink>

    <nav aria-label="主要导航">
      <RouterLink to="/">地图首页</RouterLink>
      <button type="button" disabled>排行榜</button>
      <button class="login-button" type="button" disabled>登录</button>
    </nav>
  </header>
</template>
