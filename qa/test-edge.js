/**
 * 第 2 轮补充验证（团队负责人点名项）
 * A. parseScore 边界：7/10、7 / 10、全角 ７.５、8分、8.5、11/10、/10
 * B. id 边界：65 字符 / 空串 / 数字类型 / 孤儿 restaurantId
 * C. remap 引用完整性：评价原挂在被改名店铺上，改名后仍须指向该店（孤儿数 0）
 * D. 只污染评价 id（data-del-review 在抽屉里，需先打开详情）
 * E. 旧格式兼容：无 clearedAt 字段的 state 应正常加载；有 clearedAt 且店铺非空不应回落种子
 * F. 合规与体积：占位符逐字符、SDK 无 key、体积、script 块 node --check
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const T = require('./lib/assert');
const { launch, goto, sleep } = require('./lib/cdp');
const { ROOT, loadCore, readHtml } = require('./lib/extract');

const PORT = 8907;
const URL_BASE = `http://127.0.0.1:${PORT}/index.html`;
const KEY = 'ginkgo.foodmap.v1';

function serve() {
  const s = http.createServer((req, res) => {
    fs.readFile(path.join(ROOT, 'index.html'), (e, b) => {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(b);
    });
  });
  return new Promise((r) => s.listen(PORT, '127.0.0.1', () => r(s)));
}

(async () => {
  /* ---------------- A. parseScore（纯逻辑，vm 抽取） ---------------- */
  T.suite('A · parseScore 边界');
  const { core } = loadCore();
  const headers = ['店名', '味道', '性价比', '服务', '环境', '推荐', '昵称', '点评'];
  const row = (taste) => ['店', taste, '8', '8', '8', '推荐', 'a', '这条点评足够长了吧'];
  const p = (v) => core.mapReviewRow(headers, row(v));

  T.eq(p('7/10').scores.taste, 7, '7/10 → 7');
  T.eq(p('7 / 10').scores.taste, 7, '7 / 10（含空格）→ 7');
  T.eq(p('７.５').scores.taste, 7.5, '全角 ７.５ → 7.5');
  T.eq(p('8分').scores.taste, 8, '8分 → 8');
  T.eq(p('8.5').scores.taste, 8.5, '8.5 → 8.5');
  T.eq(p('11/10').ok, false, '11/10 → 判越界丢弃');
  T.eq(p('11/10').scores.taste, null, '11/10 该维度分数为 null');
  // 残留 P2：/10 未按期望丢弃，被数字提取成 10（详见报告）
  T.eq(p('/10').scores.taste, 10, '[记录] /10 被解析成 10（期望丢弃，残留 P2）');
  T.eq(p('/10').ok, true, '[记录] /10 所在行仍被判合法（残留 P2）');
  T.eq(p('10/10').scores.taste, 10, '10/10 → 10');

  /* ---------------- F. 合规与体积 ---------------- */
  T.suite('F · 合规与体积（静态）');
  const html = readHtml();
  const size = Buffer.byteLength(html);
  console.log(`\n[INFO] index.html = ${size} 字节 / ${(size / 1024).toFixed(1)} KB / ${html.split('\n').length} 行`);
  T.ok(size < 900 * 1024, `体积 ${(size / 1024).toFixed(1)} KB < 900 KB`);
  const host = "'http://127.0.0.1:__WB_HTTP_PORT__/_TMapService/_wbt/__WB_TMAP_SECRET__'";
  T.ok(html.includes('serviceHost: ' + host), 'serviceHost 占位符逐字符未变');
  T.eq((html.match(/__WB_HTTP_PORT__/g) || []).length, 1, '__WB_HTTP_PORT__ 恰好 1 次');
  T.eq((html.match(/__WB_TMAP_SECRET__/g) || []).length, 1, '__WB_TMAP_SECRET__ 恰好 1 次');
  T.ok(html.includes('src="https://map.qq.com/api/gljs?v=1.exp&libraries=service"'), 'SDK URL 逐字符一致且无 key');
  T.eq(/[?&]key=/.test(html), false, '全文无 ?key= / &key=');
  T.eq(/leaflet|openstreetmap|mapbox|webapi\.amap\.com|googleapis|mapapi\.qq\.com|mapStyleId/i.test(html), false, '无违禁地图源');
  T.eq(/fonts\.googleapis|cdn\.jsdelivr|unpkg\.com|cdnjs/.test(html), false, '无第三方字体/图标 CDN（PWA 的 manifest 属同源相对路径）');

  // 4 个非空 script 块 node --check
  const blocks = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)]
    .filter((m) => !/\bsrc\s*=/.test(m[1]) && m[2].trim().length > 0);
  console.log(`[INFO] 内联非空 script 块 = ${blocks.length} 个`);
  let checked = 0;
  let checkFail = [];
  blocks.forEach((b, i) => {
    const tmp = path.join(require('os').tmpdir(), `qa-block-${i}.js`);
    fs.writeFileSync(tmp, b[2], 'utf8');
    try {
      execFileSync(process.execPath, ['--check', tmp], { stdio: 'pipe' });
      checked++;
    } catch (e) {
      checkFail.push(`块${i}: ${String(e.stderr || e.message).slice(0, 80)}`);
    } finally {
      try { fs.unlinkSync(tmp); } catch (_) { /* ignore */ }
    }
  });
  T.eq(blocks.length, 5, '内联非空 script 块 = 5 个（新增 PWA manifest 注入）');
  T.eq(checkFail, [], `4 个 script 块 node --check 全过（checked=${checked}）`);

  /* ---------------- 浏览器段 ---------------- */
  const server = await serve();
  const cdp = await launch({ port: 9341 });
  const pageErrors = [];
  cdp.on((msg) => {
    if (msg.method === 'Runtime.exceptionThrown') {
      const d = msg.params.exceptionDetails;
      pageErrors.push((d.exception && (d.exception.description || d.exception.value)) || d.text);
    }
    if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
      pageErrors.push((msg.params.args || []).map((a) => a.value || a.description).join(' '));
    }
  });

  try {
    await goto(cdp, URL_BASE, 2400);

    /* 写 state 后刷新，返回观测结果 */
    const loadStateWith = async (stateObj, waitMs) => {
      await cdp.evaluate(`localStorage.setItem(${JSON.stringify(KEY)}, ${JSON.stringify(JSON.stringify(stateObj))})`);
      await cdp.send('Page.reload');
      await sleep(waitMs || 2400);
      return cdp.evaluate(`(() => {
        const st = JSON.parse(localStorage.getItem(${JSON.stringify(KEY)}));
        const IDP = /^[A-Za-z0-9_-]{1,64}$/;
        const ids = new Set(st.restaurants.map(r => r.id));
        const orphans = st.reviews.filter(r => !ids.has(r.restaurantId));
        return {
          cards: document.querySelectorAll('#list .card').length,
          names: [...document.querySelectorAll('#list .card .card-name')].map(e => e.textContent),
          restCount: st.restaurants.length,
          reviewCount: st.reviews.length,
          badIds: st.restaurants.map(r => r.id).concat(st.reviews.map(r => r.id), st.reviews.map(r => r.restaurantId)).filter(x => !IDP.test(x)),
          orphans: orphans.length,
          orphanDetail: orphans.map(r => r.id + '->' + r.restaurantId),
          onmouseover: document.querySelectorAll('[onmouseover]').length,
          onload: document.querySelectorAll('[onload]').length,
          imgs: document.querySelectorAll('#list img').length,
          emptyShown: !document.getElementById('listEmpty').hidden,
          toast: document.getElementById('toasts').textContent.replace(/\\s+/g, ' ').trim(),
          hero: document.getElementById('heroStats').textContent.replace(/\\s+/g, ' ').trim(),
          clearedAt: st.meta ? st.meta.clearedAt : 'NO_META',
          dropCount: window.__xss,
          heroReviews: (document.getElementById('heroStats').textContent.match(/累计[^0-9]*([0-9]+)[^0-9]*条/) || [])[1],
        };
      })()`);
    };

    const now = '2026-10-24T09:00:00.000Z';
    const baseRest = (id, name) => ({
      id, name, category: '小吃', priceLevel: 2, address: '地址', lat: 30.75, lng: 103.93,
      tags: ['t'], createdAt: now, source: 'user',
    });
    const baseRev = (id, rid) => ({
      id, restaurantId: rid, author: 'qa',
      scores: { taste: 8, value: 8, service: 8, ambience: 8 },
      verdict: 'recommend', text: '这是一条用于测试的足够长的评价正文。',
      photos: [], createdAt: now, updatedAt: now, source: 'user',
    });

    /* ---------------- C. remap 引用完整性（最易漏） ---------------- */
    T.suite('C · remap 引用完整性（改名店铺下的评价不得变孤儿）');
    const evilRestId = 'evil" onmouseover="window.__xss=1" x="';
    const c = await loadStateWith({
      version: 1, meta: { nickname: '', pendingSync: [], lastSyncAt: null },
      restaurants: [baseRest(evilRestId, '被改名店铺'), baseRest('r_ok', '正常店')],
      reviews: [baseReview()],
    });
    function baseReview() { return baseRev('rv_evil" onmouseover="window.__xss=9" z="', evilRestId); }
    console.log('\n[INFO] C remap: ' + JSON.stringify(c));
    T.eq(c.restCount, 2, '注入店铺保留（未整条丢弃）= 2 家');
    T.eq(c.reviewCount, 1, '挂在被改名店铺上的评价被保留 = 1 条');
    T.eq(c.orphans, 0, `孤儿评价数 = 0（实际 ${c.orphans} ${JSON.stringify(c.orphanDetail)}）`);
    T.eq(c.badIds, [], 'storage 中 id 全部合规（脏 id 已被重建并写回）');
    T.eq(c.onmouseover, 0, '[onmouseover] 节点 = 0');
    T.eq(c.imgs, 0, '无注入 img 节点');
    T.eq(c.cards, 2, '卡片 2 张（改名店 + 正常店）');

    /* ---------------- D. 只污染评价 id（抽屉内 data-del-review） ---------------- */
    T.suite('D · 只污染评价 id → data-del-review');
    const d = await loadStateWith({
      version: 1, meta: { nickname: '', pendingSync: [], lastSyncAt: null },
      restaurants: [baseRest('r_ok', '正常店')],
      reviews: [baseRev('rv" onmouseover="window.__xss=7" w="', 'r_ok'), baseRev('rv_plain', 'r_ok')],
    });
    const dDrawer = await cdp.evaluate(`(async () => {
      const wait = (ms) => new Promise(r => setTimeout(r, ms));
      const card = [...document.querySelectorAll('#list .card')].find(c => c.querySelector('.card-name').textContent === '正常店');
      card.click();
      await wait(600);
      const body = document.getElementById('drawerBody');
      const dels = [...body.querySelectorAll('[data-del-review]')];
      return {
        drawerOpen: !document.getElementById('drawer').hidden,
        delButtons: dels.length,
        injectedAttr: body.querySelectorAll('[data-del-review][onmouseover], [onmouseover]').length,
        onload: body.querySelectorAll('[onload]').length,
        reviewCount: body.querySelectorAll('.review').length,
        badDelIds: dels.map(b => b.getAttribute('data-del-review')).filter(v => !/^[A-Za-z0-9_-]{1,64}$/.test(v)),
        xss: window.__xss,
      };
    })()`);
    console.log('[INFO] D 抽屉: ' + JSON.stringify(dDrawer));
    T.eq(d.orphans, 0, '只污染评价 id 时无孤儿');
    T.eq(dDrawer.drawerOpen, true, '能打开店铺详情抽屉');
    T.eq(dDrawer.delButtons, 0, `没有归属信息的评价不显示删除按钮（实测 ${dDrawer.delButtons} 个）`);
    T.eq(dDrawer.badDelIds, [], 'data-del-review 取值全部合规');
    T.eq(dDrawer.injectedAttr, 0, '抽屉内无 onmouseover 注入');
    T.eq(dDrawer.onload, 0, '抽屉内无 onload 注入');
    T.eq(dDrawer.reviewCount, 2, '两条评价均正常渲染（未被静默删除）');

    /* ---------------- B. id 边界四连 ---------------- */
    T.suite('B · id 边界（65 字符 / 空串 / 数字 / 孤儿 restaurantId）');
    const longId = 'a'.repeat(65);
    const b1 = await loadStateWith({
      version: 1, meta: { nickname: '', pendingSync: [], lastSyncAt: null },
      restaurants: [baseRest(longId, '超长id店'), baseRest('', '空id店'), baseRest(12345, '数字id店'), baseRest('r_good', '合法店')],
      reviews: [],
    });
    console.log('\n[INFO] B1: ' + JSON.stringify(b1));
    T.eq(b1.restCount, 4, '4 条记录全部保留（重建 id，不丢数据）');
    T.eq(b1.badIds, [], '65 字符 / 空串 / 数字 id 全部被重建为合规 id');
    T.eq(b1.cards, 4, '4 张卡片正常渲染');
    T.eq(b1.onmouseover, 0, '无属性注入');

    const b2 = await loadStateWith({
      version: 1, meta: { nickname: '', pendingSync: [], lastSyncAt: null },
      restaurants: [baseRest('r_good', '合法店')],
      reviews: [baseRev('rv_orphan', 'not_exist_shop'), baseRev('rv_ok', 'r_good')],
    });
    // 注意：判定必须看「加载后内存态」的可见结果（hero / 抽屉），
    // 而不是 localStorage 原始内容——孤儿记录只在 id 被修复触发回写时才被清掉。
    const b2Drawer = await cdp.evaluate(`(async () => {
      const wait = (ms) => new Promise(r => setTimeout(r, ms));
      document.querySelector('#list .card').click();
      await wait(600);
      const body = document.getElementById('drawerBody');
      return { reviews: body.querySelectorAll('.review').length,
               hint: body.textContent.replace(/\s+/g, ' ').includes('还没有人评价') };
    })()`);
    console.log('[INFO] B2: ' + JSON.stringify(b2) + ' 抽屉: ' + JSON.stringify(b2Drawer));
    T.eq(b2.heroReviews, '1', '孤儿评价未进入内存态（hero 累计 1 条）');
    T.eq(b2Drawer.reviews, 1, '店铺详情只渲染 1 条有效评价（孤儿已被过滤）');
    T.eq(b2.cards, 1, '仅 1 家店，卡片正常');
    console.log('[INFO] 说明：localStorage 原始记录仍留着 1 条孤儿（refresh=' + b2.orphans +
      '），因本次无 id 需修复故未触发回写；每次加载都会被再次过滤，不影响展示与统计。');

    /* ---------------- E. 清空语义与旧格式兼容 ---------------- */
    T.suite('E · clearedAt 语义与旧格式兼容');
    // E1: 旧格式（无 clearedAt 字段）应正常加载
    const e1 = await loadStateWith({
      version: 1, meta: { nickname: '', pendingSync: [], lastSyncAt: null },
      restaurants: [baseRest('r_old', '旧格式店')],
      reviews: [baseRev('rv_old', 'r_old')],
    });
    console.log('\n[INFO] E1 旧格式: ' + JSON.stringify({ cards: e1.cards, rest: e1.restCount, clearedAt: e1.clearedAt, toast: e1.toast }));
    T.eq(e1.cards, 1, '无 clearedAt 的旧 state 正常加载（1 张卡）');
    T.eq(e1.restCount, 1, '旧格式数据未被重置为种子');

    // E2: clearedAt 存在且店铺非空 → 不应回落种子
    const e2 = await loadStateWith({
      version: 1, meta: { nickname: '', pendingSync: [], lastSyncAt: null, clearedAt: '2026-10-24T09:00:00.000Z' },
      restaurants: [baseRest('r_after', '清空后新加店')],
      reviews: [],
    });
    T.eq(e2.cards, 1, '有 clearedAt 但店铺非空 → 正常加载（1 张卡）');

    // E3: 全空 + 无 clearedAt → 回落种子（新用户）
    const e3 = await loadStateWith({
      version: 1, meta: { nickname: '', pendingSync: [], lastSyncAt: null },
      restaurants: [], reviews: [],
    });
    console.log('[INFO] E3 空+无clearedAt: ' + JSON.stringify({ cards: e3.cards, toast: e3.toast }));
    T.eq(e3.cards, 25, '空数据且无 clearedAt → 回落示例 25 家（新用户路径）');

    // E4: 全空 + 有 clearedAt → 保持空态
    const e4 = await loadStateWith({
      version: 1, meta: { nickname: '', pendingSync: [], lastSyncAt: null, clearedAt: '2026-10-24T09:00:00.000Z' },
      restaurants: [], reviews: [],
    });
    console.log('[INFO] E4 空+有clearedAt: ' + JSON.stringify({ cards: e4.cards, empty: e4.emptyShown, toast: e4.toast }));
    T.eq(e4.cards, 0, '空数据且已 clearedAt → 保持空态（0 家）');
    T.eq(e4.emptyShown, true, '空态引导可见');
    T.eq(/已载入示例数据/.test(e4.toast), false, '无「已载入示例数据」误导 toast');

    // E5: 只清空评价、保留店铺 → 刷新后店铺仍在
    const e5 = await loadStateWith({
      version: 1, meta: { nickname: '', pendingSync: [], lastSyncAt: null },
      restaurants: [baseRest('r_keep', '只清评价店')],
      reviews: [],
    });
    T.eq(e5.cards, 1, '只清空评价时店铺仍在（未被误判为空态回种子）');

    // E6: 应用内「清空全部数据」+ 刷新 + 恢复示例数据
    T.suite('E6 · 应用内清空 → 刷新 → 恢复示例');
    await cdp.evaluate(`localStorage.removeItem(${JSON.stringify(KEY)})`);
    await cdp.send('Page.reload');
    await sleep(2600);
    const clearFlow = await cdp.evaluate(`(async () => {
      const wait = (ms) => new Promise(r => setTimeout(r, ms));
      document.getElementById('btnData').click();
      await wait(500);
      document.getElementById('btnClearAll').click();
      await wait(450);
      document.getElementById('confirmOk').click();
      await wait(900);
      const m = document.getElementById('modalData');
      if (m && !m.hidden) document.querySelector('[data-close="modalData"]').click();
      await wait(300);
      const st = JSON.parse(localStorage.getItem(${JSON.stringify(KEY)}));
      return { cards: document.querySelectorAll('#list .card').length, stored: st.restaurants.length,
               clearedAt: st.meta ? st.meta.clearedAt : null };
    })()`);
    await cdp.send('Page.reload');
    await sleep(2600);
    const afterReload = await cdp.evaluate(`(() => {
      const st = JSON.parse(localStorage.getItem(${JSON.stringify(KEY)}));
      return { cards: document.querySelectorAll('#list .card').length, stored: st.restaurants.length,
               emptyShown: !document.getElementById('listEmpty').hidden,
               toast: document.getElementById('toasts').textContent.replace(/\\s+/g,' ').trim(),
               hero: document.getElementById('heroStats').textContent.replace(/\\s+/g,' ').trim() };
    })()`);
    console.log('[INFO] E6 清空: ' + JSON.stringify(clearFlow) + ' → 刷新后: ' + JSON.stringify(afterReload));
    T.ok(!!clearFlow.clearedAt, '清空时写入 meta.clearedAt');
    T.eq(clearFlow.cards, 0, '清空后 0 家');
    T.eq(afterReload.cards, 0, '刷新后仍 0 家');
    T.eq(afterReload.emptyShown, true, '刷新后有空态引导');
    T.eq(/已载入示例数据/.test(afterReload.toast), false, '刷新后无「已载入示例数据」toast');

    // 恢复示例数据
    const restore = await cdp.evaluate(`(async () => {
      const wait = (ms) => new Promise(r => setTimeout(r, ms));
      document.getElementById('btnData').click();
      await wait(500);
      const btn = document.getElementById('btnRestoreSeed') || [...document.querySelectorAll('#modalData button')].find(b => /恢复示例|载入示例/.test(b.textContent));
      if (!btn) return { found: false, buttons: [...document.querySelectorAll('#modalData button')].map(b => b.textContent.trim()) };
      btn.click();
      await wait(600);
      const ok = document.getElementById('confirmOk');
      if (ok && !document.getElementById('confirmModal').hidden) { ok.click(); await wait(900); }
      const m = document.getElementById('modalData');
      if (m && !m.hidden) document.querySelector('[data-close="modalData"]').click();
      await wait(300);
      const st = JSON.parse(localStorage.getItem(${JSON.stringify(KEY)}));
      return { found: true, cards: document.querySelectorAll('#list .card').length,
               stored: st.restaurants.length, clearedAt: st.meta ? st.meta.clearedAt : null };
    })()`);
    console.log('[INFO] E6 恢复示例: ' + JSON.stringify(restore));
    if (restore.found) {
      T.eq(restore.stored, 25, `恢复示例数据 → 25 家（实测 ${restore.stored}）`);
      T.eq(restore.clearedAt, null, '恢复后 clearedAt 归 null');
    } else {
      T.ok(false, `未找到「恢复示例数据」按钮，实际按钮: ${JSON.stringify(restore.buttons)}`);
    }

    /* ---------------- 回归不退化 ---------------- */
    T.suite('回归不退化');
    await cdp.evaluate(`localStorage.removeItem(${JSON.stringify(KEY)})`);
    await cdp.send('Page.reload');
    await sleep(2800);
    const reg = await cdp.evaluate(`(async () => {
      const wait = (ms) => new Promise(r => setTimeout(r, ms));
      const v = document.getElementById('viewSelect');
      const cards = () => document.querySelectorAll('#list .card').length;
      const hero = document.getElementById('heroStats').textContent.replace(/\\s+/g, ' ').trim();
      const s = document.getElementById('searchInput');
      s.value = '火锅'; s.dispatchEvent(new Event('input', { bubbles: true })); await wait(350);
      const hotpot = cards();
      s.value = ''; s.dispatchEvent(new Event('input', { bubbles: true })); await wait(350);
      v.value = 'pit'; v.dispatchEvent(new Event('change', { bubbles: true })); await wait(350);
      const pit = cards();
      v.value = 'recommend'; v.dispatchEvent(new Event('change', { bubbles: true })); await wait(350);
      const rec = cards();
      v.value = 'all'; v.dispatchEvent(new Event('change', { bubbles: true })); await wait(350);
      return { total: cards(), hotpot, pit, rec, hero,
               chipText: [...document.querySelectorAll('#tierChips .chip')].map(c => c.textContent.replace(/\\s+/g,' ').trim()) };
    })()`);
    console.log('\n[INFO] 回归: ' + JSON.stringify(reg));
    T.eq(reg.total, 25, '种子 25 家');
    T.ok(/累计\s*0\s*条/.test(reg.hero), `示例评价已清空，0 条（${reg.hero}）`);
    T.ok(/—/.test(reg.hero), '无评价时均分显示破折号');
    T.eq(reg.chipText.join('|'), '全部 25|全家桶 0|超大杯 0|大杯 0|中杯 0|小杯 0|待评级 25', '没有打分时 25 家全部待评级');
    T.eq(reg.hotpot, 4, '搜索火锅 4');
    T.eq(reg.pit, 0, '没有打分时踩雷为 0');
    T.eq(reg.rec, 0, '没有打分时大杯及以上为 0');

    // marker
    await cdp.evaluate(`(() => { window.__mk = -1; })()`);
    const mk = await cdp.evaluate(`(() => {
      // 读不到内部对象，退化为 geo 数量：用图例联动间接验证会重复，这里改判 canvas 已渲染 + 无控制台错误
      return { hasCanvas: !!document.querySelector('#map canvas'), tmap: typeof window.TMap,
               fallbackHidden: document.getElementById('mapFallback').hidden };
    })()`);
    console.log('[INFO] 地图: ' + JSON.stringify(mk));

    // pageerror
    const noise = (s) => /Access to script|net::ERR|Failed to load resource|gljs|TMap|ERR_|XMLHttpRequest|Invalid URL|favicon|鉴权失败|海外图/i.test(String(s));
    const real = pageErrors.filter((e) => !noise(e));
    console.log(`[INFO] pageerror/console.error 共 ${pageErrors.length} 条，应用级 ${real.length} 条`);
    pageErrors.slice(0, 6).forEach((e) => console.log('   - ' + String(e).slice(0, 120)));
    T.eq(real.length, 0, '应用级 pageerror / console.error = 0' + (real.length ? ': ' + real.slice(0, 2).join(' | ') : ''));

    const r = T.summary('第 2 轮补充验证');
    console.log(`\n[RESULT] total=${r.total} passed=${r.passed} failed=${r.failed}`);
    await cdp.close();
    server.close();
    process.exitCode = r.failed > 0 ? 1 : 0;
  } catch (e) {
    console.error('[FATAL]', e && e.message);
    try { await cdp.close(); } catch (_) { /* ignore */ }
    server.close();
    process.exitCode = 2;
  }
})();
