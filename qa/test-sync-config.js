/**
 * 云同步「配置输入」兼容性验证
 *
 * 针对真实踩过的坑：
 *   1. 把 sb_publishable_xxx 密钥当成接口地址粘贴 → 必须明确报错，不能静默失败
 *   2. 漏写 /rest/v1 → 自动补全
 *   3. 结尾多个斜杠 → 归一化
 *   4. 新版 publishable key 不应发 Authorization: Bearer（会被拒），旧版 anon JWT 才发
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const T = require('./lib/assert');
const { launch, goto, collectErrors, sleep } = require('./lib/cdp');

const ROOT = path.resolve(__dirname, '..');
const APP_PORT = 8931;
const API_PORT = 8932;
const BASE = `http://127.0.0.1:${APP_PORT}/index.html`;

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

const hits = [];
function serveApi() {
  const CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS'
  };
  return http.createServer((req, res) => {
    hits.push({ method: req.method, url: req.url, auth: req.headers.authorization || '', apikey: req.headers.apikey || '' });
    if (req.method === 'OPTIONS') { res.writeHead(204, CORS); res.end(); return; }
    res.writeHead(200, { ...CORS, 'Content-Type': 'application/json' });
    res.end('[]');
  }).listen(API_PORT);
}

let pass = 0;
let fail = 0;
function check(name, ok, detail) {
  if (ok) { pass += 1; console.log('  ✓ ' + name); }
  else { fail += 1; console.log('  ✗ ' + name + (detail ? '  → ' + detail : '')); }
}

async function tryConnect(cdp, endpoint, key) {
  // 必须先导航到页面才能访问 localStorage（about:blank 会抛 SecurityError）
  await goto(cdp, BASE, 900);
  await cdp.evaluate(`try { localStorage.removeItem('ginkgo.sync.v1'); } catch (e) {}`);
  await goto(cdp, BASE, 1600);
  await cdp.evaluate(`document.getElementById('btnData').click()`);
  await sleep(300);
  hits.length = 0;  // 只统计本次点击之后发出的请求
  await cdp.evaluate(`(function(){
    document.getElementById('syncEndpoint').value = ${JSON.stringify(endpoint)};
    document.getElementById('syncAnonKey').value = ${JSON.stringify(key)};
    document.getElementById('btnSyncSave').click();
  })()`);
  await sleep(1600);
  return cdp.evaluate(`(function(){
    return {
      endpoint: document.getElementById('syncEndpoint').value,
      status: (document.getElementById('syncStatus') || {}).textContent || '',
      hint: (document.getElementById('syncHint') || {}).textContent || ''
    };
  })()`);
}

(async function main() {
  const app = serveApp();
  const api = serveApi();
  await sleep(150);
  const cdp = await launch({ port: 9431 });
  const errs = collectErrors(cdp);

  console.log('\n[1] 漏写 /rest/v1 → 自动补全并用旧版 JWT 发送 Bearer');
  hits.length = 0;
  const r1 = await tryConnect(cdp, `http://127.0.0.1:${API_PORT}`, 'eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoiYW5vbiJ9.sig');
  check('地址被补成 /rest/v1', r1.endpoint === `http://127.0.0.1:${API_PORT}/rest/v1`, r1.endpoint);
  check('确实请求到了后端', hits.some((h) => h.method !== 'OPTIONS' && h.url && h.url.indexOf('/rest/v1/restaurants') === 0), JSON.stringify(hits.slice(0, 2)));
  const hit1 = hits.find((h) => h.method !== 'OPTIONS' && h.url && h.url.indexOf('/rest/v1/restaurants') === 0) || {};
  check('旧版 anon JWT 带上 Authorization', /^Bearer eyJ/.test(hit1.auth || ''), hit1.auth || '(空)');
  check('状态条切到云端', /云端/.test(r1.status), r1.status);

  console.log('\n[2] 结尾多斜杠 → 归一化；新版 publishable key 不发 Bearer');
  hits.length = 0;
  const r2 = await tryConnect(cdp, `http://127.0.0.1:${API_PORT}/rest/v1/`, 'sb_publishable_ZQj5WmfwLgjNzGZ0avh1OQ_yEQkaHt9');
  check('多余的 /rest/v1/ 被归一化', r2.endpoint === `http://127.0.0.1:${API_PORT}/rest/v1`, r2.endpoint);
  const hit2 = hits.find((h) => h.method !== 'OPTIONS' && h.url && h.url.indexOf('/rest/v1/restaurants') === 0) || {};
  check('publishable key 只放 apikey，不放 Authorization', !hit2.auth, hit2.auth || '(空)');
  check('apikey 头带的是 publishable key', /^sb_publishable_/.test(hit2.apikey || ''), (hit2.apikey || '').slice(0, 22));

  console.log('\n[3] 把密钥当地址粘 → 必须明确报错且不保存');
  hits.length = 0;
  const r3 = await tryConnect(cdp, 'sb_publishable_ZQj5WmfwLgjNzGZ0avh1OQ_yEQkaHt9/rest/v1', 'sb_publishable_ZQj5WmfwLgjNzGZ0avh1OQ_yEQkaHt9');
  check('没有发出任何请求', hits.length === 0, JSON.stringify(hits.slice(0, 2)));
  check('地址栏没有被写成一个非法值', r3.endpoint.indexOf('sb_publishable') >= 0, r3.endpoint);
  check('状态条仍是本地模式', !/云端/.test(r3.status), r3.status);
  const stored = await cdp.evaluate(`localStorage.getItem('ginkgo.sync.v1')`);
  check('没有把坏配置写进本机', stored === null, String(stored).slice(0, 40));

  console.log('\n[4] 控制台');
  const NOISE = /favicon|TMapService|鉴权|file 协议|net::ERR|Invalid URL|Failed to load resource/i;
  const bad = errs.pageErrors.filter((e) => !NOISE.test(e));
  check('无应用级 JS 异常', bad.length === 0, bad.slice(0, 2).join(' | '));

  console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
  await cdp.close();
  app.close();
  api.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('测试脚本异常：', e); process.exit(2); });
