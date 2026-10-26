/**
 * QA 浏览器补充验证：待评级（无评价）路径、推荐率展示、以及清空数据缺陷的复现最小化。
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const T = require('./lib/assert');
const { launch, goto, sleep } = require('./lib/cdp');
const { ROOT } = require('./lib/extract');

const PORT = 8903;
const URL_BASE = `http://127.0.0.1:${PORT}/index.html`;

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
  const server = await serve();
  const cdp = await launch({ port: 9336 });
  try {
    T.suite('浏览器 · 待评级与推荐率');
    await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
    // 干净起步：清掉本机数据，让页面回到 seed
    await goto(cdp, URL_BASE, 1200);
    await cdp.evaluate(`localStorage.removeItem('ginkgo.foodmap.v1')`);
    await cdp.send('Page.reload');
    await sleep(2600);

    const added = await cdp.evaluate(`(async () => {
      const wait = (ms) => new Promise(r => setTimeout(r, ms));
      document.getElementById('btnAddRestaurant').click();
      await wait(450);
      const set = (id, v) => { const e = document.getElementById(id); e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); };
      set('restName', '待评级测试店');
      await wait(200);
      document.getElementById('restSubmit').click();
      await wait(1000);
      const chip = [...document.querySelectorAll('#tierChips .chip')].find(c => c.dataset.tier === 'none');
      const card = [...document.querySelectorAll('#list .card')].find(c => c.querySelector('.card-name').textContent === '待评级测试店');
      return {
        chipText: chip ? chip.textContent.replace(/\\s+/g, ' ').trim() : null,
        cardScore: card ? card.querySelector('.card-score').textContent.trim() : null,
        cardBadge: card ? (card.querySelector('.badge') || {}).textContent : null,
        cardCount: card ? (card.querySelector('.card-meta').textContent.match(/(\\d+) 条评价/) || [])[1] : null,
      };
    })()`);
    console.log('\n[INFO] 新增无评价店铺: ' + JSON.stringify(added));
    T.eq(added.cardCount, '0', '新店评价数显示 0');
    T.eq(added.cardScore, '—', '无评价时卡片分数显示破折号（待评级）');
    T.ok(/待评级\s*1/.test(String(added.chipText)), `「待评级」chip 计数 = 1（实际 ${added.chipText}）`);

    const drawer = await cdp.evaluate(`(async () => {
      const wait = (ms) => new Promise(r => setTimeout(r, ms));
      const card = [...document.querySelectorAll('#list .card')].find(c => c.querySelector('.card-name').textContent === '待评级测试店');
      card.click();
      await wait(500);
      const body = document.getElementById('drawerBody');
      return {
        kpis: [...body.querySelectorAll('.kpi b')].map(e => e.textContent.trim()),
        hint: body.textContent.replace(/\\s+/g, ' ').includes('还没有评价'),
        badge: (body.querySelector('.badge') || {}).textContent,
      };
    })()`);
    console.log('[INFO] 待评级店铺抽屉: ' + JSON.stringify(drawer));
    T.eq(drawer.kpis[0], '—', '抽屉综合分显示 —');
    T.eq(drawer.kpis[1], '—', '抽屉推荐率显示 —（无评价时不除零）');
    T.eq(drawer.kpis[2], '0', '抽屉评价数 0');
    T.ok(drawer.hint, '抽屉给出「还没有评价」引导');
    T.eq(String(drawer.badge).trim(), '待评级', '抽屉徽标为「待评级」');

    // 写一条「不推荐」，推荐率应为 0%
    const rec = await cdp.evaluate(`(async () => {
      const wait = (ms) => new Promise(r => setTimeout(r, ms));
      document.querySelector('[data-detail-act="review"]').click();
      await wait(450);
      [...document.querySelectorAll('#verdictSeg button')].find(b => b.dataset.verdict === 'not_recommend').click();
      const ta = document.getElementById('reviewText');
      ta.value = 'QA 测试：给这家新店写一条不推荐评价。';
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      await wait(250);
      document.getElementById('reviewSubmit').click();
      await wait(1000);
      const card = [...document.querySelectorAll('#list .card')].find(c => c.querySelector('.card-name').textContent === '待评级测试店');
      return { score: card ? card.querySelector('.card-score').textContent.trim() : null,
               drawerKpis: [...document.querySelectorAll('#drawerBody .kpi b')].map(e => e.textContent.trim()) };
    })()`);
    console.log('[INFO] 写完不推荐评价: ' + JSON.stringify(rec));
    T.ok(/^[0-9]\.[0-9]/.test(String(rec.score)), `1 条 7 分评价后分数正常显示（${rec.score}）`);
    T.eq(rec.drawerKpis[1], '0%', '推荐率 = 0/1 = 0%（不推荐评价）');

    const r = T.summary('浏览器补充验证');
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
