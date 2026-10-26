/**
 * QA 真实浏览器验证（自建 CDP 驱动，零第三方依赖）
 * 覆盖：首屏渲染、marker 数量、写评价、加店、搜索/筛选、移动端、断网、清空数据、
 *       地图 SDK 加载失败降级、XSS 构造注入、控制台错误。
 *
 * marker 数量：用 Page.addScriptToEvaluateOnNewDocument 在页面脚本执行前
 * 挂钩 TMap.MultiMarker.prototype.setGeometries 统计，不依赖页面内部变量。
 * SDK 加载失败：用 Fetch.failRequest 拦截 gljs 请求，真实复现降级路径。
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const T = require('./lib/assert');
const { launch, goto, collectErrors, sleep } = require('./lib/cdp');
const { ROOT } = require('./lib/extract');

const PORT = 8901;
const URL_BASE = `http://127.0.0.1:${PORT}/index.html`;

const HOOK = `
window.__qa = { markerGeoms: -1, markerLog: [], labelGeoms: -1 };
(function poll() {
  try {
    var TMap = window.TMap;
    if (TMap && TMap.MultiMarker && !TMap.MultiMarker.__qaHooked) {
      var p = TMap.MultiMarker.prototype;
      var orig = p.setGeometries;
      var seq = 0;
      p.setGeometries = function (g) {
        var r = orig.apply(this, arguments);
        try {
          var n = (g || []).length;
          if (!this.__qaId) this.__qaId = ++seq;
          if (n >= 10 && !window.__qa.main) window.__qa.main = this.__qaId;
          if (this.__qaId === window.__qa.main) {
            window.__qa.markerGeoms = n;
            window.__qa.markerLog.push(n);
          }
        } catch (e) {}
        return r;
      };
      TMap.MultiMarker.__qaHooked = true;
    }
    if (TMap && TMap.MultiLabel && !TMap.MultiLabel.__qaHooked) {
      var lp = TMap.MultiLabel.prototype;
      var lo = lp.setGeometries;
      lp.setGeometries = function (g) {
        var r = lo.apply(this, arguments);
        try { window.__qa.labelGeoms = (g || []).length; } catch (e) {}
        return r;
      };
      TMap.MultiLabel.__qaHooked = true;
    }
  } catch (e) {}
  setTimeout(poll, 50);
})();
`;

function startServer() {
  const server = http.createServer((req, res) => {
    const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
    fs.readFile(path.join(ROOT, rel), (err, buf) => {
      if (err) { res.writeHead(404); res.end('not found'); return; }
      res.writeHead(200, { 'Content-Type': path.extname(rel) === '.html' ? 'text/html; charset=utf-8' : 'application/octet-stream' });
      res.end(buf);
    });
  });
  return new Promise((resolve) => server.listen(PORT, '127.0.0.1', () => resolve(server)));
}

const out = { steps: {} };

/** 关闭所有浮层 + 回到顶部，避免遮挡干扰点击命中测试 */
const RESET_UI = `(async () => {
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  for (let i = 0; i < 4; i++) { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await wait(120); }
  document.getElementById('toasts').innerHTML = '';
  document.getElementById('drawer').hidden = true;
  document.getElementById('drawerScrim').hidden = true;
  window.scrollTo(0, 0);
  await wait(250);
  return true;
})()`;

(async () => {
  const server = await startServer();
  const cdp = await launch({ port: 9335 });
  const errs = collectErrors(cdp);
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: HOOK });

  // 内置示例评价已移除，这里注入一份固定夹具，保证断言只依赖测试自己的数据
  const SEED_SHOPS = require('../build/seed.js').buildSeed().restaurants;
  const t0 = '2026-10-01T10:00:00.000Z';
  const FIXTURE_REVIEWS = [
    { id: 'qa_v1', restaurantId: 'r01', author: '测试甲', scores: { taste: 9, value: 9, service: 9, ambience: 9 }, verdict: 'recommend', text: '夹具评价一', photos: [], createdAt: t0, updatedAt: t0, source: 'user' },
    { id: 'qa_v2', restaurantId: 'r02', author: '测试乙', scores: { taste: 8, value: 8, service: 8, ambience: 8 }, verdict: 'recommend', text: '夹具评价二', photos: [], createdAt: t0, updatedAt: t0, source: 'user' },
    { id: 'qa_v3', restaurantId: 'r03', author: '测试丙', scores: { taste: 7, value: 7, service: 7, ambience: 7 }, verdict: 'recommend', text: '夹具评价三', photos: [], createdAt: t0, updatedAt: t0, source: 'user' },
    { id: 'qa_v4', restaurantId: 'r04', author: '测试丁', scores: { taste: 6, value: 6, service: 6, ambience: 6 }, verdict: 'recommend', text: '夹具评价四', photos: [], createdAt: t0, updatedAt: t0, source: 'user' },
    { id: 'qa_v5', restaurantId: 'r05', author: '测试戊', scores: { taste: 4, value: 4, service: 4, ambience: 4 }, verdict: 'not_recommend', text: '夹具评价五（踩雷）', photos: [], createdAt: t0, updatedAt: t0, source: 'user' }
  ];
  const FIXTURE = JSON.stringify({
    version: 1,
    restaurants: SEED_SHOPS,
    reviews: FIXTURE_REVIEWS,
    meta: { lastSyncAt: null, pendingSync: [], pendingRestaurants: [], nickname: '', clearedAt: null, seedPurged: true }
  });
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
    source: `(function(){try{if(localStorage.getItem('__qa_seeded'))return;localStorage.setItem('ginkgo.foodmap.v1', ${JSON.stringify(FIXTURE)});localStorage.setItem('__qa_seeded','1');}catch(e){}})();`
  });

  try {
    /* ============================================ 1. 首屏渲染 ============================================ */
    T.suite('浏览器 · 首屏渲染');
    await goto(cdp, URL_BASE, 2600);
    const baselineErrors = { page: errs.pageErrors.length, console: errs.consoleErrors.length };

    const first = await cdp.evaluate(`(() => {
      const q = (s) => document.querySelectorAll(s).length;
      const txt = (id) => { const e = document.getElementById(id); return e ? e.textContent.replace(/\\s+/g, ' ').trim() : null; };
      const card = document.querySelector('#list .card');
      const cover = document.getElementById('heroCover');
      return {
        title: document.title,
        cards: q('#list .card'),
        heroStats: txt('heroStats'),
        listCount: txt('listCount'),
        chips: q('#tierChips .chip'),
        chipLabels: [...document.querySelectorAll('#tierChips .chip')].map(c => c.textContent.replace(/\\s+/g, ' ').trim()),
        legend: q('#mapLegend .legend-item'),
        legendLabels: [...document.querySelectorAll('#mapLegend .legend-item')].map(c => c.textContent.replace(/\\s+/g, ' ').trim()),
        markers: window.__qa ? window.__qa.markerGeoms : null,
        markerLog: window.__qa ? window.__qa.markerLog.slice(-5) : null,
        tmapType: typeof window.TMap,
        sdkErr: !!window.__tmapLoadError,
        fallbackHidden: document.getElementById('mapFallback').hidden,
        syncStatus: txt('syncStatus'),
        bodyBg: getComputedStyle(document.body).backgroundColor,
        bodyColor: getComputedStyle(document.body).color,
        heroCover: cover ? String(cover.src).slice(0, 24) : null,
        firstCardScore: card ? card.querySelector('.card-score').textContent.trim() : null,
        firstCardCount: card ? (card.querySelector('.card-meta').textContent.match(/(\\d+) 条评价/) || [])[1] : null,
      };
    })()`);
    out.steps.first = first;
    console.log('\n[INFO] 首屏: ' + JSON.stringify({
      cards: first.cards, chips: first.chips, legend: first.legend,
      markers: first.markers, tmap: first.tmapType, heroStats: first.heroStats,
    }));
    console.log('[INFO] chip 文案: ' + first.chipLabels.join(' | '));
    console.log('[INFO] 图例文案: ' + first.legendLabels.join(' | '));

    T.eq(first.title, 'Ginkgo 美食地图 · 电子科技大学 Ginkgo 烹饪社', '页面标题正确');
    T.eq(first.cards, 25, '首屏卡片数 = 25');
    T.eq(first.chips, 7, '杯型筛选 chip = 7（全部 + 5 档 + 待评级）');
    T.eq(first.legend, 6, '地图图例 = 6（5 档 + 待评级）');
    T.ok(first.chipLabels.some((l) => /全家桶/.test(l)), ' chip 含「全家桶」档');
    T.ok(/已收录\s*25\s*家/.test(first.heroStats), `统计条 25 家店（实际: ${first.heroStats}）`);
    T.ok(/累计\s*5\s*条评价/.test(first.heroStats), `统计条 5 条评价（实际: ${first.heroStats}）`);
    T.ok(/共\s*25\s*家/.test(first.listCount), `列表计数（实际: ${first.listCount}）`);
    T.ok(/已保存到本机|已同步到云端/.test(first.syncStatus), `状态条已保存（实际: ${first.syncStatus}）`);
    T.eq(first.bodyBg, 'rgb(251, 247, 239)', 'body 背景浅色 #FBF7EF');
    T.eq(first.bodyColor, 'rgb(43, 42, 38)', '主文字 #2B2A26');
    T.ok(/^data:image\/jpeg/.test(String(first.heroCover)), '封面为内联 data:image（无外部图片请求）');
    T.eq(first.firstCardCount, '1', '首张卡片评价数 1（夹具）');

    if (first.tmapType === 'object' && first.markers > 0) {
      T.eq(first.markers, 25, `地图 marker 数量 = 25（实测 ${first.markers}）`);
      const legendMarker = await cdp.evaluate(`(() => {
        document.querySelector('#mapLegend [data-legend="bucket"]').click();
        return new Promise(r => setTimeout(() => {
          const only = window.__qa.markerGeoms;
          document.querySelector('#mapLegend [data-legend="bucket"]').click();
          setTimeout(() => r({ bucketOnly: only, restored: window.__qa.markerGeoms }), 600);
        }, 600));
      })()`);
      out.markers = { initial: first.markers, ...legendMarker };
      T.eq(legendMarker.bucketOnly, 1, `图例筛选「全家桶」后 marker = 1（实测 ${legendMarker.bucketOnly}）`);
      T.eq(legendMarker.restored, 25, `取消图例筛选后 marker 恢复 25（实测 ${legendMarker.restored}）`);
    } else {
      // 2.6s 内 SDK 未必就绪（CDN 抖动），bootMap 有 8s 超时；等待后二选一判定
      console.log('[WARN] 首屏 2.6s 内 SDK 未就绪（TMap=' + first.tmapType + '），等待 12s 观察是否就绪或走降级');
      await sleep(12000);
      const late = await cdp.evaluate(`({
        tmap: typeof window.TMap,
        markers: window.__qa ? window.__qa.markerGeoms : -1,
        fallbackHidden: document.getElementById('mapFallback').hidden,
        fallbackText: document.getElementById('mapFallback').textContent.replace(/\\s+/g, ' ').trim().slice(0, 30),
        mapDisplay: getComputedStyle(document.getElementById('map')).display,
      })`);
      out.markers = { late };
      console.log('[INFO] 12s 后: ' + JSON.stringify(late));
      if (late.markers > 0) {
        T.eq(late.markers, 25, `延迟就绪后 marker 数量 = 25（实测 ${late.markers}）`);
      } else if (late.mapDisplay !== 'none') {
        // SDK 晚到但地图已初始化：QA 钩子没抓到 marker（真实 SDK 的方法未必挂在原型上），
        // 此时只能校验「没有误报降级」，不能反过来要求降级卡
        T.ok(late.fallbackHidden === true, `地图已就绪时不应显示降级卡（实测 hidden=${late.fallbackHidden}）`);
        T.ok(late.tmap === 'object', 'SDK 晚到但最终可用');
      } else {
        T.ok(late.fallbackHidden === false, 'SDK 始终不可用时显示降级提示卡而非白屏');
        T.eq(late.mapDisplay, 'none', '降级时地图容器被隐藏');
        T.ok(/地图需要联网/.test(late.fallbackText), `降级文案可读（${late.fallbackText}）`);
      }
    }

    /* ============================================ 2. 写一条评价 ============================================ */
    T.suite('浏览器 · 写评价 9/8/7/6 + 推荐');
    const target = await cdp.evaluate(`(() => {
      const card = document.querySelector('#list .card[data-id="r01"]');
      card.click();
      return { id: card.getAttribute('data-id'), drawerOpen: !document.getElementById('drawer').hidden };
    })()`);
    await sleep(500);
    T.ok(target.drawerOpen, '点击卡片打开详情抽屉');
    T.eq(target.id, 'r01', '定位到种子店 r01');

    const flow = await cdp.evaluate(`(async () => {
      const wait = (ms) => new Promise(r => setTimeout(r, ms));
      document.querySelector('[data-detail-act="review"]').click();
      await wait(450);
      const modalOpen = !document.getElementById('modalReview').hidden;
      const sliders = [...document.querySelectorAll('#reviewBody input[type=range]')];
      [9, 8, 7, 6].forEach((v, i) => { sliders[i].value = v; sliders[i].dispatchEvent(new Event('input', { bubbles: true })); });
      await wait(350);
      const preview = document.getElementById('reviewPreview').textContent.replace(/\\s+/g, ' ').trim();
      [...document.querySelectorAll('#verdictSeg button')].find(b => b.dataset.verdict === 'recommend').click();
      const author = document.getElementById('reviewAuthor');
      author.value = 'QA严过关';
      author.dispatchEvent(new Event('input', { bubbles: true }));
      const ta = document.getElementById('reviewText');
      ta.value = 'QA 自动化测试写入的一条评价，用于验证评分与杯型联动是否正确。';
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      await wait(300);
      document.getElementById('reviewSubmit').click();
      await wait(1000);
      return { modalOpen, preview, modalClosed: document.getElementById('modalReview').hidden,
               err: (document.getElementById('reviewError') || {}).textContent || '' };
    })()`);
    out.steps.reviewForm = flow;
    T.ok(flow.modalOpen, '写评价弹层可打开');
    T.ok(/本条总分/.test(flow.preview), '滑杆拖动后出现实时预测');
    T.ok(/7\.5/.test(flow.preview), `9/8/7/6 → 本条总分 7.5（预测: ${flow.preview}）`);
    T.ok(/超大杯/.test(flow.preview), 'r01 现有 9.0 + 本条 7.5 → 预测 8.25 落超大杯' + flow.preview);
    T.ok(flow.modalClosed, '提交后弹层关闭');
    T.eq(String(flow.err).trim(), '', '无校验错误提示');

    const after = await cdp.evaluate(`(() => {
      const id = ${JSON.stringify(target.id)};
      const st = JSON.parse(localStorage.getItem('ginkgo.foodmap.v1'));
      const C = window.GinkgoCore;
      const agg = C.aggregate(st.reviews, id);
      const card = document.querySelector('#list .card[data-id="' + id + '"]');
      const list = st.reviews.filter(r => r.restaurantId === id)
        .map(r => Math.round(((r.scores.taste + r.scores.value + r.scores.service + r.scores.ambience) / 4) * 100) / 100);
      return {
        reviewsForShop: list.length,
        mineSaved: st.reviews.some(r => r.author === 'QA严过关'),
        totalReviews: st.reviews.length,
        coreScore: C.fmtScore(agg.score),
        coreTier: agg.tier && agg.tier.label,
        cardScore: card ? card.querySelector('.card-score').textContent.trim() : null,
        cardCount: card ? (card.querySelector('.card-meta').textContent.match(/(\\d+) 条评价/) || [])[1] : null,
        independentAvg: list.reduce((a, b) => a + b, 0) / list.length,
        hero: document.getElementById('heroStats').textContent.replace(/\\s+/g, ' ').trim(),
        markers: window.__qa ? window.__qa.markerGeoms : null,
      };
    })()`);
    out.steps.afterReview = after;
    T.eq(after.reviewsForShop, 2, '该店评价数 1 → 2');
    T.eq(after.cardCount, '2', '卡片上显示 2 条评价');
    T.ok(after.mineSaved, '新评价已持久化到 localStorage（作者 QA严过关）');
    T.eq(after.totalReviews, 6, '全站评价数 5 → 6');
    T.ok(after.cardScore && after.cardScore.startsWith(after.coreScore), `卡片分数与 Core 一致（${after.cardScore} vs ${after.coreScore}）`);
    T.near(parseFloat(after.coreScore), Math.round(after.independentAvg * 10) / 10, 0.051,
      `店铺分 = QA 独立重算均值 ${after.independentAvg.toFixed(4)} → ${after.coreScore} 分 / ${after.coreTier}`);
    T.ok(/累计\s*6\s*条/.test(after.hero), '首屏统计条更新为 6 条');

    /* ============================================ 3. 添加店铺 ============================================ */
    T.suite('浏览器 · 添加店铺');
    const add = await cdp.evaluate(`(async () => {
      const wait = (ms) => new Promise(r => setTimeout(r, ms));
      document.getElementById('drawer').hidden = true;
      document.getElementById('drawerScrim').hidden = true;
      await wait(200);
      const beforeCards = document.querySelectorAll('#list .card').length;
      const beforeMarkers = window.__qa ? window.__qa.markerGeoms : null;
      document.getElementById('btnAddRestaurant').click();
      await wait(450);
      const set = (id, v) => { const e = document.getElementById(id); e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); };
      set('restName', 'QA测试面馆');
      set('restAddress', 'QA 自动化测试地址 1 号');
      set('restTags', 'QA、自动化');
      await wait(250);
      document.getElementById('restSubmit').click();
      await wait(1200);
      const st = JSON.parse(localStorage.getItem('ginkgo.foodmap.v1'));
      return {
        beforeCards, afterCards: document.querySelectorAll('#list .card').length,
        beforeMarkers, afterMarkers: window.__qa ? window.__qa.markerGeoms : null,
        markerLog: window.__qa ? window.__qa.markerLog.slice(-4) : null,
        created: st.restaurants.find(r => r.name === 'QA测试面馆') || null,
        modalClosed: document.getElementById('modalRestaurant').hidden,
      };
    })()`);
    out.steps.add = add;
    T.eq(add.afterCards, add.beforeCards + 1, '卡片数 +1');
    T.ok(add.created, '新店铺写入 state');
    T.ok(add.created && add.created.source === 'user', 'source = user');
    T.ok(add.created && add.created.id, '获得 id');
    T.ok(add.modalClosed, '提交后弹层关闭');
    if (add.beforeMarkers > 0 && add.afterMarkers > 0) {
      T.eq(add.afterMarkers, add.beforeMarkers + 1, `地图 marker +1（${add.beforeMarkers} → ${add.afterMarkers}，log=${JSON.stringify(add.markerLog)}）`);
    } else {
      console.log('[WARN] marker 不可用：before=' + add.beforeMarkers + ' after=' + add.afterMarkers + ' log=' + JSON.stringify(add.markerLog));
      T.ok(false, `地图 marker +1（实测 before=${add.beforeMarkers} → after=${add.afterMarkers}）`);
    }

    /* ============================================ 4. 搜索与筛选 ============================================ */
    T.suite('浏览器 · 搜索与筛选');
    const filters = await cdp.evaluate(`(async () => {
      const wait = (ms) => new Promise(r => setTimeout(r, ms));
      const s = document.getElementById('searchInput');
      const v = document.getElementById('viewSelect');
      const cards = () => document.querySelectorAll('#list .card').length;
      const countText = () => document.getElementById('listCount').textContent.replace(/\\s+/g, ' ').trim();
      const type = async (x) => { s.value = x; s.dispatchEvent(new Event('input', { bubbles: true })); await wait(350); };
      await type('火锅');
      const hotpot = { cards: cards(), listCount: countText(),
        names: [...document.querySelectorAll('#list .card .card-name')].map(e => e.textContent) };
      await type('');
      v.value = 'pit'; v.dispatchEvent(new Event('change', { bubbles: true })); await wait(350);
      const pit = { cards: cards(), listCount: countText() };
      v.value = 'recommend'; v.dispatchEvent(new Event('change', { bubbles: true })); await wait(350);
      const largeAndUp = { cards: cards(), listCount: countText() };
      v.value = 'all'; v.dispatchEvent(new Event('change', { bubbles: true })); await wait(350);
      const restored = cards();
      document.querySelector('#tierChips [data-tier="large"]').click(); await wait(350);
      const largeChip = cards();
      document.querySelector('#tierChips [data-tier="__all"]').click(); await wait(350);
      await type('绝对不存在的店xyz');
      const emptyState = { cards: cards(), emptyShown: !document.getElementById('listEmpty').hidden };
      await type('');
      return { hotpot, pit, largeAndUp, restored, largeChip, emptyState };
    })()`);
    out.steps.filters = filters;
    T.ok(filters.hotpot.cards > 0, `搜索「火锅」有结果（${filters.hotpot.cards} 家: ${filters.hotpot.names.join('/')}）`);
    T.eq(filters.hotpot.cards, 4, '「火锅」精确命中 4 家');
    T.eq(filters.pit.cards, 1, '「只看踩雷（小杯）」= 1 家');
    T.eq(filters.largeAndUp.cards, 3, '「大杯及以上」= 全家桶1 + 超大杯1 + 大杯1 = 3 家');
    T.eq(filters.restored, 26, '清空筛选恢复全部（25 seed + 1 QA 新增）');
    T.eq(filters.largeChip, 1, '「大杯」档 chip = 1 家（夹具）');
    T.ok(filters.emptyState.emptyShown && filters.emptyState.cards === 0, '无结果时展示空态');

    /* ============================================ 5. 移动端 390×844 ============================================ */
    T.suite('浏览器 · 移动端 390×844');
    await cdp.evaluate(RESET_UI);
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    await sleep(900);
    await cdp.evaluate(RESET_UI);
    const mobile = await cdp.evaluate(`(() => {
      const btn = document.getElementById('btnAddRestaurant');
      const r = btn.getBoundingClientRect();
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      const hit = document.elementFromPoint(cx, cy);
      const write = document.getElementById('btnWriteReview').getBoundingClientRect();
      const card = document.querySelector('#list .card');
      return {
        docScrollWidth: document.documentElement.scrollWidth,
        bodyScrollWidth: document.body.scrollWidth,
        innerWidth: window.innerWidth,
        addRect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
        addVisible: r.width > 0 && r.height > 0 && r.top >= 0 && r.top < 844,
        hitElement: hit ? hit.tagName + '#' + hit.id : null,
        addClickable: !!hit && (hit === btn || btn.contains(hit)),
        writeVisible: write.width > 0 && write.height > 0,
        cards: document.querySelectorAll('#list .card').length,
        cardWidth: card ? Math.round(card.getBoundingClientRect().width) : 0,
        horizontalScrollbar: window.innerWidth < document.documentElement.scrollWidth,
      };
    })()`);
    out.steps.mobile = mobile;
    T.ok(mobile.docScrollWidth <= 390, `无横向滚动（documentElement.scrollWidth=${mobile.docScrollWidth} ≤ 390）`);
    T.ok(mobile.bodyScrollWidth <= 390, `body.scrollWidth=${mobile.bodyScrollWidth} ≤ 390`);
    T.eq(mobile.horizontalScrollbar, false, '无横向滚动条');
    T.ok(mobile.addVisible, `「添加餐厅」按钮在视口内（${JSON.stringify(mobile.addRect)}）`);
    T.ok(mobile.addClickable, `「添加餐厅」按钮可命中点击（命中元素 ${mobile.hitElement}）`);
    T.ok(mobile.writeVisible, '「写评价」按钮可见');
    T.ok(mobile.cards > 0, `移动端列表渲染 ${mobile.cards} 张卡`);
    T.ok(mobile.cardWidth > 200 && mobile.cardWidth <= 390, `卡片宽度合理（${mobile.cardWidth}px）`);
    const tap = await cdp.evaluate(`(async () => {
      const wait = (ms) => new Promise(r => setTimeout(r, ms));
      document.getElementById('btnAddRestaurant').click();
      await wait(450);
      const open = !document.getElementById('modalRestaurant').hidden;
      const closeBtn = document.querySelector('[data-close="modalRestaurant"]');
      const cr = closeBtn.getBoundingClientRect();
      const hit = document.elementFromPoint(cr.left + cr.width / 2, cr.top + cr.height / 2);
      closeBtn.click();
      await wait(350);
      return { open, closeClickable: !!hit && (hit === closeBtn || closeBtn.contains(hit)),
               closedAfter: document.getElementById('modalRestaurant').hidden };
    })()`);
    out.steps.mobileTap = tap;
    T.ok(tap.open, '移动端点击「添加餐厅」能打开弹层');
    T.ok(tap.closeClickable, '移动端弹层关闭按钮可点击');
    T.ok(tap.closedAfter, '移动端弹层可关闭');
    await cdp.send('Emulation.clearDeviceMetricsOverride');
    await sleep(500);

    /* ============================================ 6. 断网降级 ============================================ */
    T.suite('浏览器 · 断网降级');
    await cdp.send('Network.enable');
    const statusBefore = await cdp.evaluate(`document.getElementById('syncStatus').textContent.trim()`);
    await cdp.send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 });
    await sleep(1200);
    const offlineMid = await cdp.evaluate(`(async () => {
      const wait = (ms) => new Promise(r => setTimeout(r, ms));
      window.dispatchEvent(new Event('offline'));
      await wait(800);
      const node = document.getElementById('syncStatus');
      const offlineText = node.textContent.trim();
      const pill = node.className;
      document.getElementById('btnAddRestaurant').click();
      await wait(450);
      const e = document.getElementById('restName');
      e.value = '离线测试店';
      e.dispatchEvent(new Event('input', { bubbles: true }));
      document.getElementById('restSubmit').click();
      await wait(900);
      const st = JSON.parse(localStorage.getItem('ginkgo.foodmap.v1'));
      return { offlineText, pill, saved: !!st.restaurants.find(r => r.name === '离线测试店'),
               cards: document.querySelectorAll('#list .card').length };
    })()`);
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    await sleep(1200);
    const onlineBack = await cdp.evaluate(`(() => {
      window.dispatchEvent(new Event('online'));
      return new Promise(r => setTimeout(() => r(document.getElementById('syncStatus').textContent.trim()), 700));
    })()`);
    out.steps.offline = { before: statusBefore, ...offlineMid, restored: onlineBack };
    T.ok(/离线模式/.test(offlineMid.offlineText), `断网后状态条显示离线（${offlineMid.offlineText}）`);
    T.ok(/is-offline/.test(offlineMid.pill), '状态条样式 is-offline');
    T.ok(offlineMid.saved, '离线状态下写入仍成功（localStorage 持久化）');
    T.ok(!/离线模式/.test(onlineBack), `恢复联网后状态条复原（${onlineBack}）`);

    /* ============================================ 7. 清空全部数据（应用内按钮） ============================================ */
    T.suite('浏览器 · 清空全部数据');
    const clearFlow = await cdp.evaluate(`(async () => {
      const wait = (ms) => new Promise(r => setTimeout(r, ms));
      document.getElementById('btnData').click();
      await wait(450);
      document.getElementById('btnClearAll').click();
      await wait(400);
      const confirmShown = !document.getElementById('confirmModal').hidden;
      document.getElementById('confirmOk').click();
      await wait(800);
      const dataModal = document.getElementById('modalData');
      if (dataModal && !dataModal.hidden) document.querySelector('[data-close="modalData"]').click();
      await wait(300);
      return {
        confirmShown,
        cards: document.querySelectorAll('#list .card').length,
        emptyShown: !document.getElementById('listEmpty').hidden,
        hero: document.getElementById('heroStats').textContent.replace(/\\s+/g, ' ').trim(),
        stored: JSON.parse(localStorage.getItem('ginkgo.foodmap.v1')).restaurants.length,
      };
    })()`);
    out.steps.clearInApp = clearFlow;
    T.ok(clearFlow.confirmShown, '清空前弹出二次确认');
    T.eq(clearFlow.cards, 0, '清空后列表为空');
    T.eq(clearFlow.stored, 0, '清空后 localStorage 中店铺数 = 0');
    T.ok(clearFlow.emptyShown, '清空后显示空态引导');
    T.ok(/已收录\s*0\s*家/.test(clearFlow.hero), `统计归零（${clearFlow.hero}）`);

    await cdp.send('Page.reload');
    await sleep(2600);
    const afterReload = await cdp.evaluate(`(() => ({
      cards: document.querySelectorAll('#list .card').length,
      stored: JSON.parse(localStorage.getItem('ginkgo.foodmap.v1')).restaurants.length,
      hero: document.getElementById('heroStats').textContent.replace(/\\s+/g, ' ').trim(),
      toast: document.getElementById('toasts').textContent.replace(/\\s+/g, ' ').trim(),
    }))()`);
    out.steps.clearReload = afterReload;
    console.log('[INFO] 清空后刷新: ' + JSON.stringify(afterReload));
    T.eq(afterReload.cards, 0,
      `清空数据后刷新仍应为空（实测 ${afterReload.cards} 家自动复活，toast="${afterReload.toast}"）`);

    /* ============================================ 8. 地图 SDK 加载失败降级 ============================================ */
    T.suite('浏览器 · 地图 SDK 加载失败降级');
    // 上一节把数据清空了，这里先塞回 2 家合法店铺，否则无法验证「列表仍可用」
    await cdp.evaluate(`(() => {
      const now = new Date().toISOString();
      const st = { version: 1, meta: { nickname: '', pendingSync: [], lastSyncAt: null, initialized: true }, restaurants: [], reviews: [] };
      st.restaurants.push({ id: 'qa_fb_1', name: '降级测试店A', category: '小吃', priceLevel: 2, address: '地址A', lat: 30.75, lng: 103.93, tags: ['A'], createdAt: now, source: 'user', needsLocation: false, closed: false });
      st.restaurants.push({ id: 'qa_fb_2', name: '降级测试店B', category: '食堂', priceLevel: 1, address: '地址B', lat: 30.76, lng: 103.94, tags: ['B'], createdAt: now, source: 'user', needsLocation: false, closed: false });
      localStorage.setItem('ginkgo.foodmap.v1', JSON.stringify(st));
      return true;
    })()`);
    await cdp.send('Page.reload');
    await sleep(2000);
    await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
    await cdp.send('Fetch.enable', { patterns: [{ urlPattern: '*map.qq.com*', requestStage: 'Request' }] });
    cdp.on((msg) => {
      if (msg.method === 'Fetch.requestPaused') {
        cdp.send('Fetch.failRequest', { requestId: msg.params.requestId, errorReason: 'ConnectionRefused' }).catch(() => {});
      }
    });
    await cdp.send('Page.reload');
    await sleep(11000); // bootMap 8s 超时 + 余量
    const fb = await cdp.evaluate(`(() => {
      const card = document.querySelector('#list .card');
      return {
        tmap: typeof window.TMap,
        cards: document.querySelectorAll('#list .card').length,
        bodyTextLen: document.body.innerText.length,
        fallbackHidden: document.getElementById('mapFallback').hidden,
        fallbackText: document.getElementById('mapFallback').textContent.replace(/\\s+/g, ' ').trim().slice(0, 40),
        mapDisplay: getComputedStyle(document.getElementById('map')).display,
        controlsHidden: document.getElementById('mapControls').hidden,
        listUsable: !!card,
      };
    })()`);
    out.steps.fallback = fb;
    console.log('[INFO] gljs 被拦截后: ' + JSON.stringify(fb));
    T.eq(fb.tmap, 'undefined', 'SDK 被拦截后 window.TMap 不存在');
    T.ok(fb.fallbackHidden === false, '超过 8s 超时后显示降级提示卡 #mapFallback');
    T.ok(/地图需要联网/.test(fb.fallbackText), `降级文案可读（${fb.fallbackText}）`);
    T.eq(fb.mapDisplay, 'none', '地图容器被隐藏');
    T.ok(fb.controlsHidden, '地图控件被隐藏');
    T.eq(fb.cards, 2, `SDK 缺失时列表仍完整渲染（${fb.cards} 张卡）`);
    T.ok(fb.listUsable && fb.bodyTextLen > 300, `列表等核心功能不受影响（正文 ${fb.bodyTextLen} 字）`);
    await cdp.send('Fetch.disable');

    /* ============================================ 9. XSS 构造注入 ============================================ */
    T.suite('浏览器 · XSS 构造数据注入');
    const evilId = 'evil" onmouseover="window.__xss=1" x="';
    await cdp.evaluate(`(() => {
      const st = { version: 1, meta: { nickname: '', pendingSync: [], lastSyncAt: null }, restaurants: [], reviews: [] };
      st.restaurants.push({
        id: ${JSON.stringify(evilId)},
        name: '<img src=x onerror="window.__xss=2">',
        category: '<script>window.__xss=3</scr' + 'ipt>',
        priceLevel: 2,
        address: '"><svg onload="window.__xss=4">',
        lat: 30.75, lng: 103.93,
        tags: ['<img src=x onerror="window.__xss=5">'],
        createdAt: new Date().toISOString(), source: 'user'
      });
      st.restaurants.push({
        id: 'r_ok_1', name: '正常对照店', category: '小吃', priceLevel: 2,
        address: '正常地址', lat: 30.76, lng: 103.94, tags: ['正常'],
        createdAt: new Date().toISOString(), source: 'user'
      });
      st.reviews.push({
        id: 'evil-rv" onmouseover="window.__xss=6" y="',
        restaurantId: 'r_ok_1',
        author: '"><svg onload="window.__xss=7">',
        scores: { taste: 8, value: 8, service: 8, ambience: 8 },
        verdict: 'recommend',
        text: '<script>window.__xss=8</scr' + 'ipt>正文长度足够了吧',
        photos: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), source: 'user'
      });
      localStorage.setItem('ginkgo.foodmap.v1', JSON.stringify(st));
      return true;
    })()`);
    await cdp.send('Page.reload');
    await sleep(3000);
    const xss = await cdp.evaluate(`(() => {
      window.__xss = 0;
      const cards = [...document.querySelectorAll('#list .card')];
      const evil = cards.find(c => (c.getAttribute('data-id') || '').indexOf('evil') === 0);
      const okCard = cards.find(c => c.getAttribute('data-id') === 'r_ok_1');
      if (okCard) okCard.click();
      let rankExec = 0;
      const rb = document.getElementById('btnRanking');
      if (rb) { rb.click();
        const cm = document.getElementById('modalRanking');
        if (cm && !cm.hidden) document.querySelector('[data-close="modalRanking"]').click(); }
      const st = JSON.parse(localStorage.getItem('ginkgo.foodmap.v1'));
      const IDP = /^[A-Za-z0-9_-]{1,64}$/;
      const badIds = [];
      st.restaurants.forEach(r => { if (!IDP.test(r.id)) badIds.push('r:' + r.id); });
      st.reviews.forEach(r => {
        if (!IDP.test(r.id)) badIds.push('rv:' + r.id);
        if (!IDP.test(r.restaurantId)) badIds.push('rid:' + r.restaurantId);
      });
      const badDomIds = [...document.querySelectorAll('[data-id]')]
        .map(e => e.getAttribute('data-id')).filter(v => !IDP.test(v));
      const names = [...document.querySelectorAll('#list .card .card-name')].map(e => e.textContent);
      return {
        cards: cards.length,
        imgs: document.querySelectorAll('#list img, #drawerBody img, #rankBody img').length,
        liveOnload: document.querySelectorAll('[onload]').length,
        liveOnmouseover: document.querySelectorAll('[onmouseover]').length,
        scriptTags: document.querySelectorAll('#list script, #drawerBody script, #rankBody script').length,
        evilCardFound: !!evil,
        evilCardIdAttr: evil ? evil.getAttribute('data-id') : null,
        evilCardHasOnmouseover: evil ? evil.hasAttribute('onmouseover') : null,
        evilCardOnmouseoverValue: evil ? evil.getAttribute('onmouseover') : null,
        evilCardOuterStart: evil ? evil.outerHTML.slice(0, 150) : null,
        drawerDelBtnInjected: !!document.querySelector('#drawerBody [data-del-review][onmouseover]'),
        xssFlag: window.__xss,
        names,
        badIdsInStorage: badIds,
        badDomIds,
        repairedRestaurants: st.restaurants.length,
        repairedReviews: st.reviews.length,
        reviewTextEscaped: document.getElementById('drawerBody').textContent.indexOf('<script>') >= 0,
        payloadShownAsText: names.some(n => n.indexOf('<img') === 0),
      };
    })()`);
    out.steps.xss = xss;
    console.log('\n[INFO] XSS 探针: ' + JSON.stringify(xss, null, 2));
    T.eq(xss.imgs, 0, '店名/标签中的 <img onerror> 未生成真实 img 元素');
    T.eq(xss.scriptTags, 0, '分类/正文中的 <script> 未生成 script 元素');
    T.eq(xss.liveOnload, 0, '地址/昵称中的 <svg onload> 未生成带 onload 的节点');
    T.eq(xss.xssFlag, 0, 'window.__xss 未被置位（无脚本执行）');
    T.eq(xss.badIdsInStorage, [], 'localStorage 中已无非法 id（店铺/评价 id 与 restaurantId 全部合规）');
    T.eq(xss.badDomIds, [], 'DOM 中所有 data-id 均合规，无可逃逸值');
    T.eq(xss.liveOnmouseover, 0, '页面内无任何 onmouseover 属性被注入');
    T.eq(xss.payloadShownAsText, true, '注入店名以纯文本形式展示（<img 作为文字可见，未解析为节点）');
    T.eq(xss.reviewTextEscaped, true, '评价正文中的 <script> 以纯文本展示，未解析执行');
    T.ok(xss.repairedReviews >= 1, `非法 id 的评价被重建 id 后保留（${xss.repairedReviews} 条），未产生孤儿`);
    T.ok(xss.cards >= 2, `数据未被误删（${xss.cards} 张卡：注入店以新 id 保留 + 对照店）`);
    T.eq(xss.drawerDelBtnInjected, false, '评价 id 未逃逸出 data-del-review 属性');

    /* ============================================ 10. 控制台错误 ============================================ */
    T.suite('浏览器 · 控制台错误');
    // 可归因于本机环境的噪声：占位符 serviceHost 造成的 SDK XHR 失败、favicon 404、
    // 被本测试主动拦截的 gljs、以及测试主动删除 window.TMap 引发的 sync 报错。
    const envNoise = (s) => /Access to script|net::ERR|Failed to load resource|gljs|TMap|ERR_NAME|ERR_CONNECTION|ERR_CERT|ERR_INTERNET|XMLHttpRequest|Invalid URL|favicon|Inspected target|鉴权失败|海外图/i.test(String(s));
    const all = errs.pageErrors.concat(errs.consoleErrors);
    const real = all.filter((e) => !envNoise(e));
    out.errors = { baselineErrors, total: all.length, realCount: real.length, real: real.slice(0, 10), sample: all.slice(0, 40) };
    console.log(`\n[INFO] 首次加载阶段错误基线: page=${baselineErrors.page} console=${baselineErrors.console}`);
    console.log(`[INFO] 全程捕获 ${all.length} 条，其中可归因环境/测试干预的已过滤，剩余 ${real.length} 条`);
    all.forEach((e) => console.log('   - ' + String(e).slice(0, 150)));
    T.eq(real.length, 0, '无非预期 pageerror / console.error' + (real.length ? ': ' + real.slice(0, 3).join(' | ') : ''));
    const firstLoadErrors = all.slice(0, baselineErrors.page + baselineErrors.console).filter((e) => !envNoise(e));
    T.eq(firstLoadErrors.length, 0, '首屏加载阶段无 JS 异常');

    const r = T.summary('浏览器实测');
    out.summary = { total: r.total, passed: r.passed, failed: r.failed };
    await cdp.close();
    server.close();
    fs.writeFileSync(path.join(__dirname, 'browser-results.json'), JSON.stringify(out, null, 2), 'utf8');
    process.exitCode = r.failed > 0 ? 1 : 0;
  } catch (e) {
    console.error('\n[FATAL] 浏览器测试中断:', e && e.message);
    out.fatal = String(e && e.message);
    try { await cdp.close(); } catch (_) { /* ignore */ }
    server.close();
    fs.writeFileSync(path.join(__dirname, 'browser-results.json'), JSON.stringify(out, null, 2), 'utf8');
    process.exitCode = 2;
  }
})();
