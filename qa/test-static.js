/**
 * QA 独立静态 / 安全审查
 * 覆盖：XSS 注入点、地图合规红线、外部资源、存储健壮性、浅色主题对比度、基础项。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const T = require('./lib/assert');
const { readHtml, ROOT } = require('./lib/extract');

const html = readHtml();
const lines = html.split('\n');

function lineOf(idx) {
  return html.slice(0, idx).split('\n').length;
}

/* ------------------------------------------------ 1. 基础项 ------------------------------------------------ */
T.suite('基础项');
T.ok(/^\uFEFF?<!DOCTYPE html>/i.test(html.trimStart()), '<!DOCTYPE html> 声明存在');
T.ok(/<html[^>]*\blang="zh-CN"/.test(html), 'lang="zh-CN"');
T.ok(/<meta\s+name="viewport"[^>]*width=device-width/.test(html), 'viewport meta 存在');
T.ok(/<title>[^<]+<\/title>/.test(html), '<title> 存在且有内容');
T.eq((html.match(/<title>([^<]+)<\/title>/) || [])[1], 'Ginkgo 美食地图 · 电子科技大学 Ginkgo 烹饪社', 'title 文案');
T.eq(/console\.error/.test(html), false, '无 console.error 遗留');
T.eq(/console\.log/.test(html), false, '无 console.log 遗留调试输出');
T.eq(/\bdebugger\b/.test(html), false, '无 debugger 断点');
T.eq(/TODO|FIXME|XXX:/.test(html), false, '无 TODO / FIXME 遗留');
T.ok(/<meta charset="utf-8"/i.test(html), 'charset=utf-8');

/* ------------------------------------------------ 2. 地图合规红线 ------------------------------------------------ */
T.suite('地图合规红线');
const forbidden = ['leaflet', 'openstreetmap', 'mapbox', 'webapi.amap.com', 'googleapis', 'mapapi.qq.com', 'mapStyleId'];
for (const w of forbidden) {
  const re = new RegExp(w.replace(/\./g, '\\.'), 'i');
  const m = re.exec(html);
  T.eq(m, null, `不含违禁源 "${w}"` + (m ? `（出现在第 ${lineOf(m.index)} 行）` : ''));
}
const serviceHostLine = lines.findIndex((l) => l.includes('serviceHost'));
T.ok(serviceHostLine >= 0, '存在 serviceHost 配置');
const exact = "'http://127.0.0.1:__WB_HTTP_PORT__/_TMapService/_wbt/__WB_TMAP_SECRET__'";
T.ok(lines[serviceHostLine].includes(exact),
  `serviceHost 占位符精确保留（第 ${serviceHostLine + 1} 行）实际: ${lines[serviceHostLine].trim()}`);
T.eq((html.match(/__WB_HTTP_PORT__/g) || []).length, 1, '__WB_HTTP_PORT__ 出现且仅出现 1 次');
T.eq((html.match(/__WB_TMAP_SECRET__/g) || []).length, 1, '__WB_TMAP_SECRET__ 出现且仅出现 1 次');

const sdk = html.match(/<script[^>]+src="(https:\/\/map\.qq\.com[^"]*)"/);
T.ok(sdk, 'SDK script 标签存在');
T.eq(sdk && sdk[1], 'https://map.qq.com/api/gljs?v=1.exp&libraries=service', 'SDK URL 与规定完全一致（无 key 参数）');
T.eq(/[?&]key=/.test(html), false, '全文无 ?key= / &key= 查询参数（真实 API Key 泄漏）');
T.eq(/api[_-]?key\s*[:=]\s*['"][A-Za-z0-9]{8,}/i.test(html), false, '无硬编码 API Key 形态字符串');

/* ------------------------------------------------ 3. 外部资源 ------------------------------------------------ */
T.suite('外部资源审计（除腾讯地图 CDN / data: / blob: 外不应有第三方请求）');
const externals = [];
const reAttr = /(?:src|href)\s*=\s*"([^"]*)"/g;
let m;
while ((m = reAttr.exec(html)) !== null) {
  const u = m[1];
  if (!u || u.startsWith('data:') || u.startsWith('blob:') || u.startsWith('#')) continue;
  externals.push({ url: u, line: lineOf(m.index) });
}
// 允许：腾讯地图 CDN、同源相对路径（PWA 的 manifest 与图标）、data:/blob:
const bad = externals.filter((x) => !/^https:\/\/map\.qq\.com\//.test(x.url) && !/^\.\//.test(x.url));
T.eq(bad.length, 0, 'src/href 外链仅限腾讯地图 CDN 与同源相对路径' + (bad.length ? ' 违规:' + bad.map((x) => `L${x.line} ${x.url}`).join(' | ') : ''));
console.log(`\n[INFO] 外部 src/href 白名单命中: ${externals.map((x) => `L${x.line} ${x.url}`).join(' ; ') || '（无）'}`);

T.eq(/@import\s+url/i.test(html), false, 'CSS 无 @import 远程字体/样式');
T.eq(/fonts\.googleapis|fonts\.gstatic|cdn\.jsdelivr|unpkg\.com|cdnjs/.test(html), false, '无第三方字体/图标 CDN');
const linkHrefs = [...html.matchAll(/<link\b[^>]*href\s*=\s*"([^"]*)"/g)].map((x) => x[1]);
T.ok(linkHrefs.every((u) => /^\.\//.test(u)), '所有 <link> 都是同源相对路径（manifest / 图标）：' + linkHrefs.join(', '));
T.eq(/<img\b[^>]+src="(?!data:)/.test(html), false, '无远程 <img>');
const fetchCalls = [...html.matchAll(/fetch\(/g)].map((x) => ({
  line: lineOf(x.index),
  ctx: html.slice(x.index, x.index + 200)
}));
console.log(`[INFO] fetch( 出现位置: ${fetchCalls.map((c) => 'L' + c.line).join(', ')}`);
// 语义断言：每个 fetch 的目标都必须来自云同步配置（this.base()/base），不向任何第三方地址发请求
// 允许三类目标：云同步配置的地址、同源 /api（自建后端）、location.origin + '/api'
const ALLOWED_FETCH = /(this\.base\(\)|self\.base\(\)|\bbase\s*\+|'\/api\/|"\/api\/|location\.origin\s*\+\s*'\/api')/;
const foreignFetch = fetchCalls.filter((c) => !ALLOWED_FETCH.test(c.ctx));
T.ok(foreignFetch.length === 0,
  'fetch 只指向云同步配置的地址（不向第三方发请求）' + (foreignFetch.length ? ' → L' + foreignFetch.map((c) => c.line).join(',') : ''));
T.eq(/XMLHttpRequest/.test(html), false, '无 XMLHttpRequest');
T.eq(/new\s+WebSocket/.test(html), false, '无 WebSocket 外连');
const codeOnly = html
  .replace(/<!--[\s\S]*?-->/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n')
  .filter((l) => !/serviceHost|map\.qq\.com|127\.0\.0\.1|supabase|example|endpoint|README|示例|例：|xmlns|w3\.org/.test(l))
  .join('\n');
const remoteHits = [...codeOnly.matchAll(/https?:\/\/([a-z0-9.-]+)/gi)].map((x) => x[1]);
const remoteBad = remoteHits.filter((h) => !/^(127\.0\.0\.1|map\.qq\.com|www\.w3\.org)$/i.test(h));
T.eq(remoteBad, [], '非注释、非配置示例代码中无其他远程域名' + (remoteBad.length ? ' 命中:' + [...new Set(remoteBad)].join(',') : ''));

/* ------------------------------------------------ 4. XSS 注入点 ------------------------------------------------ */
T.suite('XSS 注入点审计');
const sinks = [];
['innerHTML', 'insertAdjacentHTML', 'outerHTML', 'document.write'].forEach((k) => {
  let idx = -1;
  while ((idx = html.indexOf(k, idx + 1)) >= 0) {
    if (html[idx - 1] === '.' || k === 'document.write') sinks.push({ kind: k, line: lineOf(idx) });
  }
});
console.log(`\n[INFO] HTML 注入 sink 共 ${sinks.length} 处: ${sinks.map((s) => s.line).join(', ')}`);

const escDef = html.match(/function esc\(value\)\s*\{[\s\S]*?\n  \}/);
T.ok(escDef, '存在 esc() 转义函数');
const escSrc = escDef[0];
T.ok(/&/.test(escSrc) && /&amp;/.test(escSrc) && /&lt;/.test(escSrc) && /&gt;/.test(escSrc) &&
  /&quot;/.test(escSrc) && /&#39;/.test(escSrc), 'esc() 覆盖 & < > " \' 五个字符');

// 真实执行 esc() 验证
const jsdomLike = {};
const fn = new Function('return ' + escSrc.replace(/^function esc/, 'function esc') )();
T.eq(fn('<img src=x onerror=alert(1)>'), '&lt;img src=x onerror=alert(1)&gt;', 'esc 处理 <img onerror>');
T.eq(fn('"><svg onload=alert(1)>'), '&quot;&gt;&lt;svg onload=alert(1)&gt;', 'esc 处理属性逃逸 "><svg>');
T.eq(fn('<script>alert(1)</script>'), '&lt;script&gt;alert(1)&lt;/script&gt;', 'esc 处理 <script>');
T.eq(fn(null), '', 'esc(null) → 空串');

// 检查用户可控文本字段在 HTML 拼接行中是否都包了 esc(
// 只审查同时含 HTML 标记的行，避免把 textContent / 剪贴板文案误判为 XSS
const userTextExprs = [
  'r.name', 'rv.author', 'rv.text', 'r.address', 'r.category', 'tag', 'row.name', 'row.text',
  'row.author', 'd.author', 'd.text', 'd.name', 'd.address', 'd.tags', 'b.name',
];
const unescapedText = [];
lines.forEach((line, i) => {
  if (!/="|<|>/.test(line)) return;
  for (const field of userTextExprs) {
    const re = new RegExp('\\+\\s*' + field.replace(/\./g, '\\.') + '\\b(?!\\.)', 'g');
    let mm;
    while ((mm = re.exec(line)) !== null) {
      const before = line.slice(Math.max(0, mm.index - 6), mm.index + 1);
      if (!/esc\($/.test(before)) unescapedText.push(`${field} @L${i + 1}: ${line.trim().slice(0, 80)}`);
    }
  }
});
T.eq(unescapedText.length, 0, '店名/昵称/正文/地址/标签在 HTML 拼接中均经 esc() 输出' +
  (unescapedText.length ? ' 未转义:' + unescapedText.join(', ') : ''));
console.log('[INFO] 非 HTML 上下文的用户文本直出（分享文案 / 搜索 haystack / confirm 标题，均非 HTML 上下文，安全）');

// 重点：id 字段是否逃逸（可经导入 JSON / 云端同步注入）
// 逐行扫描：命中 HTML 属性拼接（行内出现 =" 或 <）且未包 esc( 的 id 插值
const unescapedId = [];
lines.forEach((raw, i) => {
  const line = raw;
  if (!/="|<|>/.test(line)) return;
  const re = /\+\s*(?:item\.r\.id|item\.id|r\.id|rv\.id)\b/g;
  let mm;
  while ((mm = re.exec(line)) !== null) {
    const before = line.slice(Math.max(0, mm.index - 6), mm.index + 1);
    if (!/esc\($/.test(before)) unescapedId.push(`L${i + 1}: ${line.trim().slice(0, 90)}`);
  }
});
if (unescapedId.length) {
  console.log('\n[缺陷] id 未转义的 HTML 属性注入点:');
  unescapedId.forEach((x) => console.log('  ' + x));
}
T.eq(unescapedId.length, 0, 'id 字段在 HTML 属性中亦经转义' + (unescapedId.length ? `（未转义 ${unescapedId.length} 处）` : ''));

// normalizeRestaurant 是否限制 id 字符集（能否通过导入投毒）
const normRest = html.match(/function normalizeRestaurant\([\s\S]*?\n  \}/);
T.ok(normRest, '存在 normalizeRestaurant()');
const normRestSrc = normRest ? normRest[0] : '';
const idGuard = /ID_PATTERN/.test(normRestSrc) || /A-Za-z0-9_-/.test(normRestSrc);
T.ok(normRest, '找到 normalizeRestaurant() 定义');
T.ok(idGuard, 'normalizeRestaurant 对 id 做字符集白名单校验（ID_PATTERN）');
const normRev = html.match(/function normalizeReview\([\s\S]*?\n  \}/);
T.ok(normRev, '找到 normalizeReview() 定义');
T.ok(/ID_PATTERN/.test(normRev ? normRev[0] : ''), 'normalizeReview 的 id 与 restaurantId 均过白名单');

/* ------------------------------------------------ 5. 存储健壮性 ------------------------------------------------ */
T.suite('存储健壮性');
const lsGet = html.match(/function loadState\(\)\s*\{[\s\S]*?\n  \}/);
T.ok(lsGet, '存在 loadState()');
T.ok(/try\s*\{[\s\S]*getItem[\s\S]*\}\s*catch/.test(lsGet[0]), 'localStorage.getItem 包在 try/catch 中');
T.ok(/try\s*\{\s*[\s\S]*JSON\.parse[\s\S]*\}\s*catch/.test(lsGet[0]), 'JSON.parse 有 try/catch 兜底');
T.ok(/seedState\(\)/.test(lsGet[0]), '解析失败时降级到 seedState()（不白屏）');

const lsSave = html.match(/function saveState\(reason\)\s*\{[\s\S]*?\n  \}/);
T.ok(lsSave, '存在 saveState()');
T.ok(/try\s*\{[\s\S]*setItem[\s\S]*\}\s*catch/.test(lsSave[0]), 'localStorage.setItem 包在 try/catch 中');
T.ok(/toast\([^)]*保存失败/.test(lsSave[0]), '写失败时给出用户可见提示（含配额超限）');
T.eq(/QuotaExceededError/.test(html), false, '[记录] 未按 name 区分 QuotaExceededError，但统一 catch 已覆盖并 toast');

T.ok(/window\.indexedDB/.test(html) && /\.catch\(function \(\) \{/.test(html), 'IndexedDB 调用有 catch 降级');
T.ok(/memory\.set\(key, blob\)/.test(html), 'IndexedDB 不可用时降级到内存 Map');

/* ------------------------------------------------ 6. 主题与对比度 ------------------------------------------------ */
T.suite('浅色主题与文字对比度');
function hex2rgb(h) {
  const s = h.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(s.substr(i, 2), 16));
}
function lum(rgb) {
  const a = rgb.map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2];
}
function contrast(fg, bg) {
  const L1 = lum(hex2rgb(fg));
  const L2 = lum(hex2rgb(bg));
  return (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
}
const paper = '#FBF7EF';
const ink = '#2B2A26';
const inkSoft = '#57534B';
const muted = '#8B8478';
T.eq(/--paper:\s*#FBF7EF/.test(html), true, 'body 背景为浅色纸质 #FBF7EF');
T.eq(/--ink:\s*#2B2A26/.test(html), true, '主文字色 #2B2A26');
const cInk = contrast(ink, paper);
const cSoft = contrast(inkSoft, paper);
const cMuted = contrast(muted, paper);
console.log(`\n[INFO] 对比度：主文字 #2B2A26 on #FBF7EF = ${cInk.toFixed(2)}:1；次级 #57534B = ${cSoft.toFixed(2)}:1；弱化 #8B8478 = ${cMuted.toFixed(2)}:1`);
T.ok(cInk >= 7, `主文字对比度 ≥ 7:1（实测 ${cInk.toFixed(2)}:1，AAA）`);
T.ok(cSoft >= 4.5, `次级文字对比度 ≥ 4.5:1（实测 ${cSoft.toFixed(2)}:1，AA）`);
T.ok(cMuted >= 3, `弱化文字对比度 ≥ 3:1（实测 ${cMuted.toFixed(2)}:1，仅满足 AA 大字号）`);
T.ok(/color-scheme"\s+content="light"/.test(html), '声明 color-scheme: light（不跟随系统深色）');
T.eq(/prefers-color-scheme:\s*dark/.test(html), false, '无深色模式覆盖（始终浅色）');
T.eq(/background(-\w+)?:\s*#(0[0-9a-f]{2}|1[0-9a-f]{2}|2[0-9a-f]{2})\b/i.test(html.replace(/rgba?\([^)]*\)/g, '')), false, '无近黑底色');

/* ------------------------------------------------ 7. 降级逻辑（静态阅读） ------------------------------------------------ */
T.suite('地图降级逻辑');
const fb = html.match(/function showMapFallback\(\)[\s\S]*?\n  \}/);
T.ok(fb, '存在 showMapFallback()');
const fbBody = fb[0];
T.ok(/mapFallback'\)\.hidden\s*=\s*false/.test(fbBody), '降级时显示 #mapFallback 提示卡');
T.ok(/map'\)\.style\.display\s*=\s*'none'/.test(fbBody), '降级时隐藏地图容器');
T.eq(/innerHTML\s*=\s*''/.test(fbBody), false, '降级逻辑不清空页面（不白屏）');
T.ok(/地图需要联网才能加载/.test(html), '降级文案存在且对用户可读');

const initFn = html.match(/init: function \(\) \{[\s\S]*?\n    \},/);
T.ok(initFn, '存在 MapCtl.init()');
T.ok(/if \(!window\.TMap \|\| typeof window\.TMap\.Map !== 'function'\) return false/
  .test(initFn[0]), 'MapCtl.init 在 window.TMap 缺失时返回 false');
T.ok(/setTimeout|setInterval/.test(html.split('function bootMap')[1].slice(0, 800)), 'bootMap 有轮询 + 超时兜底');
T.ok(/Date\.now\(\) - started > \d+/.test(html), 'bootMap 超时阈值判断存在');
T.ok(/__tmapLoadError/.test(html), 'SDK onerror 置 __tmapLoadError 标记');
T.ok(/catch \(err\)[\s\S]{0,200}this\.ready = false;[\s\S]{0,40}return false;/.test(html),
  '构造地图抛错时 return false（走降级而非白屏）');

const r = T.summary('静态与安全审查');
process.exitCode = r.failed > 0 ? 1 : 0;
