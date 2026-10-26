/**
 * 云同步端到端验证（自建 mock Supabase，零第三方依赖）
 *
 * 验证目标（这是"别人评价看不到"的根因修复）：
 *   1. 云端有、本地没有的「店」能被拉下来并出现在地图/列表里 —— 旧实现只拉评价，会把这类店当孤儿丢掉
 *   2. 挂在云端新店下面的「评价」能正确落地，而不是被 mergeRemoteReview 静默丢弃
 *   3. 本地新写的店与评价能推上去（POST 真的到达后端，pending 队列清空）
 *   4. 断网/错误地址时不崩，状态条给出提示
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const T = require('./lib/assert');
const { launch, goto, collectErrors, sleep } = require('./lib/cdp');

const ROOT = path.resolve(__dirname, '..');
const APP_PORT = 8911;
const API_PORT = 8912;
const API_BASE = `http://127.0.0.1:${API_PORT}/rest/v1`;

/* ---------------- 静态站点 ---------------- */

function serveApp() {
  const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css' };
  return http.createServer((req, res) => {
    const url = decodeURIComponent((req.url || '/').split('?')[0]);
    const file = path.join(ROOT, url === '/' ? 'index.html' : url);
    fs.readFile(file, (err, buf) => {
      if (err) { res.writeHead(404); res.end('not found'); return; }
      res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
      res.end(buf);
    });
  }).listen(APP_PORT);
}

/* ---------------- mock Supabase（PostgREST 子集） ---------------- */

const store = { restaurants: [], reviews: [] };
const log = [];

const now = () => new Date().toISOString();
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS',
  'Access-Control-Expose-Headers': '*'
};

function serveApi() {
  return http.createServer((req, res) => {
    const full = req.url || '/';
    const [pathname, qs] = full.split('?');
    const table = pathname.replace('/rest/v1/', '').replace(/^\//, '');
    log.push({ method: req.method, url: full });

    if (req.method === 'OPTIONS') {
      res.writeHead(204, CORS);
      res.end();
      return;
    }

    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      if (!store[table]) {
        res.writeHead(404, { ...CORS, 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ message: 'relation does not exist' }));
        return;
      }

      if (req.method === 'GET') {
        let rows = store[table].slice();
        const params = new URLSearchParams(qs || '');
        const gt = params.get('updated_at');
        if (gt && gt.startsWith('gt.')) {
          const since = Date.parse(gt.slice(3));
          rows = rows.filter((r) => (Date.parse(r.updated_at) || 0) > since);
        }
        res.writeHead(200, { ...CORS, 'Content-Type': 'application/json' });
        res.end(JSON.stringify(rows));
        return;
      }

      if (req.method === 'POST') {
        let rows;
        try { rows = JSON.parse(body); } catch (e) { rows = null; }
        if (!rows) { res.writeHead(400, CORS); res.end('bad json'); return; }
        const list = Array.isArray(rows) ? rows : [rows];
        list.forEach((row) => {
          if (!row || !row.id) return;
          const idx = store[table].findIndex((r) => r.id === row.id);
          if (idx >= 0) store[table][idx] = { ...store[table][idx], ...row };
          else store[table].push({ ...row });
        });
        res.writeHead(201, CORS);
        res.end('');
        return;
      }

      res.writeHead(405, CORS);
      res.end('');
    });
  }).listen(API_PORT);
}

/* ---------------- 断言 ---------------- */

let pass = 0;
let fail = 0;
function check(name, ok, detail) {
  if (ok) { pass += 1; console.log('  ✓ ' + name); }
  else { fail += 1; console.log('  ✗ ' + name + (detail ? '  → ' + detail : '')); }
}

(async function main() {
  const appServer = serveApp();
  const apiServer = serveApi();
  await sleep(200);

  // 云端预置：一家本地没有的店 + 一条别人的评价
  store.restaurants.push({
    id: 'r_remote1', name: '云端测试店', category: '火锅', price_level: 3,
    address: '成都市测试路 1 号', lat: 30.66, lng: 104.07, tags: ['云端'],
    closed: false, source: 'user', created_at: now(), created_by: '云端同学', needs_location: false
  });
  store.reviews.push({
    id: 'rv_remote1', restaurant_id: 'r_remote1', author: '云端同学',
    scores: { taste: 9, value: 8, service: 7, ambience: 9 }, verdict: 'recommend',
    text: '云端评价内容：锅底香，排队有点久', photos: [],
    created_at: now(), updated_at: now(), source: 'user'
  });

  const cdp = await launch({ port: 9411 });
  const errs = collectErrors(cdp);

  console.log('\n[1] 首次加载（本地模式）');
  await goto(cdp, `http://127.0.0.1:${APP_PORT}/index.html`, 2200);
  const localCount = await cdp.evaluate(`document.querySelectorAll('#list .card').length`);
  check('本地模式渲染出种子店铺', localCount >= 20, '卡片数 ' + localCount);

  console.log('\n[2] 配置云端并注入一条待上传的本机数据');
  await cdp.evaluate(`
    (function () {
      var s = JSON.parse(localStorage.getItem('ginkgo.foodmap.v1'));
      var t = new Date().toISOString();
      s.restaurants.push({
        id: 'r_local1', name: '本机测试店', category: '小吃', priceLevel: 1,
        address: '本机地址', lat: 30.755, lng: 103.93, tags: [],
        closed: false, source: 'user', createdAt: t, createdBy: '本机同学'
      });
      s.reviews.push({
        id: 'rv_local1', restaurantId: 'r_local1', author: '本机同学',
        scores: { taste: 8, value: 8, service: 8, ambience: 8 }, verdict: 'recommend',
        text: '本机评价内容：出餐快，适合下课冲', photos: [],
        createdAt: t, updatedAt: t, source: 'user'
      });
      s.meta.pendingSync = ['rv_local1'];
      s.meta.pendingRestaurants = ['r_local1'];
      localStorage.setItem('ginkgo.foodmap.v1', JSON.stringify(s));
      localStorage.setItem('ginkgo.sync.v1', JSON.stringify({ endpoint: '${API_BASE}', anonKey: 'test-anon-key', pollMs: 5000 }));
    })()
  `);
  await goto(cdp, `http://127.0.0.1:${APP_PORT}/index.html`, 6000);

  console.log('\n[3] 拉取：别人的店与评价必须出现');
  const hasRemoteShop = await cdp.evaluate(`!!Array.from(document.querySelectorAll('#list .card')).find(function (n) { return n.textContent.indexOf('云端测试店') >= 0; })`);
  check('云端新增的「店」出现在列表', hasRemoteShop === true);

  const remoteCardScore = await cdp.evaluate(`
    (function () {
      var c = Array.from(document.querySelectorAll('#list .card')).find(function (n) { return n.textContent.indexOf('云端测试店') >= 0; });
      if (!c) return null;
      var s = c.querySelector('.score-num, .card-score');
      return s ? s.textContent.trim() : c.textContent.replace(/\\s+/g, ' ').slice(0, 80);
    })()
  `);
  check('云端店铺带上了分数（8.25 四舍五入 8.3）', /8\.[23]/.test(String(remoteCardScore)), '实际 ' + remoteCardScore);

  const remoteReviewInDom = await cdp.evaluate(`
    (function () {
      var card = Array.from(document.querySelectorAll('#list .card')).find(function (n) { return n.textContent.indexOf('云端测试店') >= 0; });
      if (!card) return false;
      card.click();
      return new Promise(function (resolve) {
        setTimeout(function () {
          var drawer = document.querySelector('#drawer, .drawer, #detailDrawer');
          resolve(!!drawer && drawer.textContent.indexOf('云端评价内容') >= 0);
        }, 700);
      });
    })()
  `);
  check('云端评价内容渲染进详情抽屉（没被当孤儿丢掉）', remoteReviewInDom === true);

  console.log('\n[4] 推送：本机新增的店与评价必须到达后端');
  const pushedShop = store.restaurants.some((r) => r.id === 'r_local1');
  const pushedReview = store.reviews.some((r) => r.id === 'rv_local1');
  check('本机新店已 POST 到 /restaurants', pushedShop === true);
  check('本机新评价已 POST 到 /reviews', pushedReview === true);
  check('推送请求带上了 apikey 头之外的正确路径', log.some((l) => l.method === 'POST' && l.url.indexOf('/rest/v1/restaurants') === 0), JSON.stringify(log.slice(0, 4)));

  const pendingCleared = await cdp.evaluate(`
    (function () {
      var s = JSON.parse(localStorage.getItem('ginkgo.foodmap.v1'));
      return { v: (s.meta.pendingSync || []).length, r: (s.meta.pendingRestaurants || []).length };
    })()
  `);
  check('上传成功后 pending 队列已清空', pendingCleared.v === 0 && pendingCleared.r === 0, JSON.stringify(pendingCleared));

  const badgeText = await cdp.evaluate(`(function(){var n=document.getElementById('syncStatus');return n?n.textContent.trim():'';})()`);
  check('状态条显示已同步到云端', /云端/.test(badgeText), badgeText);

  console.log('\n[5] 容错：地址写错不能白屏');
  await cdp.evaluate(`
    localStorage.setItem('ginkgo.sync.v1', JSON.stringify({ endpoint: 'http://127.0.0.1:9/rest/v1', anonKey: 'k', pollMs: 5000 }));
  `);
  await goto(cdp, `http://127.0.0.1:${APP_PORT}/index.html`, 5000);
  const stillAlive = await cdp.evaluate(`document.querySelectorAll('#list .card').length`);
  check('连不上后端时页面仍可用', stillAlive >= 20, '卡片数 ' + stillAlive);

  console.log('\n[6] 控制台');
  // 噪声：静态服务器没有替换 TMap 代理占位符，SDK 自己会抛 Invalid URL / 404 favicon
  const NOISE = /favicon|TMapService|鉴权|file 协议|net::ERR|Invalid URL|Failed to load resource/i;
  const appErrors = errs.pageErrors.filter((e) => !NOISE.test(e));
  check('无应用级 JS 异常', appErrors.length === 0, appErrors.slice(0, 2).join(' | '));

  // 单独盯住同步链路：任何提到 rest/v1 或 pending 的异常都不算噪声
  const syncErrors = errs.pageErrors.filter((e) => /rest\/v1|pending|Sync\.|Cannot read/i.test(e));
  check('同步链路无异常', syncErrors.length === 0, syncErrors.slice(0, 2).join(' | '));

  console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
  await cdp.close();
  appServer.close();
  apiServer.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error('测试脚本异常：', e);
  process.exit(2);
});
