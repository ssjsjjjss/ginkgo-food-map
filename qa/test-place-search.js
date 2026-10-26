/**
 * 「输入店名直接定位」验证（用假的 TMap.service 模拟腾讯地图返回）
 *
 * 覆盖用户提的四种情况：
 *   1. 成都只有一家 aq羊肉串  → 输入即选中，自动回填店名/地址/坐标
 *   2. 有两家「海吃牛鲜」     → 不自动选，列出候选让用户挑
 *   3. 输入「xx路海吃牛鲜」   → 精确同名那家被选中
 *   4. 腾讯地图上没有这家店   → 退到地址解析，跳到那条路并提示手动点选
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const T = require('./lib/assert');
const { launch, goto, collectErrors, sleep } = require('./lib/cdp');

const ROOT = path.resolve(__dirname, '..');
const PORT = 8921;
const BASE = `http://127.0.0.1:${PORT}/index.html`;

function serve() {
  const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css' };
  return http.createServer((req, res) => {
    const url = decodeURIComponent((req.url || '/').split('?')[0]);
    const file = path.join(ROOT, url === '/' ? 'index.html' : url);
    fs.readFile(file, (err, buf) => {
      if (err) { res.writeHead(404); res.end('not found'); return; }
      res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
      res.end(buf);
    });
  }).listen(PORT);
}

/* 在页面脚本执行前注入：够用的 TMap 桩 + 可控的 service 返回 */
const STUB = `
(function () {
  function FakeMap() { this._z = 12; }
  FakeMap.prototype.on = function () { return this; };
  FakeMap.prototype.setCenter = function (ll) { this._c = ll; };
  FakeMap.prototype.setZoom = function (z) { this._z = z; };
  FakeMap.prototype.getZoom = function () { return this._z; };

  function FakeLayer() { this.geoms = []; }
  FakeLayer.prototype.on = function () { return this; };
  FakeLayer.prototype.setGeometries = function (g) { this.geoms = g || []; return this; };

  function LatLng(lat, lng) { this.lat = lat; this.lng = lng; }

  window.__fakeMode = 'one';
  window.__lastService = '';

  window.TMap = {
    Map: FakeMap,
    MultiMarker: FakeLayer,
    MultiLabel: FakeLayer,
    MarkerStyle: function () {},
    LabelStyle: function () {},
    LatLng: LatLng,
    service: {
      Suggestion: function () {
        this.getSuggestions = function (p) {
          window.__lastService = 'suggestion';
          var kw = p.keyword;
          if (window.__fakeMode === 'two') {
            return Promise.resolve({ data: [
              { id: 'a', title: '海吃牛鲜(建设路店)', address: '建设路 53 号', location: { lat: 30.668035, lng: 104.100483 }, _distance: 1200 },
              { id: 'b', title: '海吃牛鲜(春熙路店)', address: '春熙路 1 号', location: { lat: 30.657117, lng: 104.081240 }, _distance: 8400 }
            ] });
          }
          if (window.__fakeMode === 'none') return Promise.resolve({ data: [] });
          if (window.__fakeMode === 'roadonly') return Promise.resolve({ data: [] });
          return Promise.resolve({ data: [
            { id: 'x', title: kw, address: '成都市建设路 53 号', location: { lat: 30.670123, lng: 104.101456 }, _distance: 800 }
          ] });
        };
      },
      Search: function () {
        this.searchRegion = function () {
          window.__lastService = 'search';
          return Promise.resolve({ data: [] });
        };
      },
      Geocoder: function () {
        this.getLocation = function (p) {
          window.__lastService = 'geocoder';
          if (window.__fakeMode === 'none') {
            return Promise.resolve({ result: {
              title: '建设路', location: { lat: 30.668400, lng: 104.100900 },
              reliability: 8, address_components: { city: '成都市' }
            } });
          }
          return Promise.resolve({ result: null });
        };
      }
    }
  };
})();
`;

let pass = 0;
let fail = 0;
function check(name, ok, detail) {
  if (ok) { pass += 1; console.log('  ✓ ' + name); }
  else { fail += 1; console.log('  ✗ ' + name + (detail ? '  → ' + detail : '')); }
}

async function typeSearch(cdp, text, wait) {
  await cdp.evaluate(`
    (function () {
      var i = document.getElementById('restSearch');
      i.value = ${JSON.stringify(text)};
      i.dispatchEvent(new Event('input', { bubbles: true }));
    })()
  `);
  await sleep(wait == null ? 800 : wait);
}

(async function main() {
  const server = serve();
  await sleep(150);
  const cdp = await launch({ port: 9421 });
  const errs = collectErrors(cdp);
  // 必须拦掉真实的腾讯 SDK：它加载后会覆盖我们注入的 TMap 桩
  await cdp.send('Network.enable');
  await cdp.send('Network.setBlockedURLs', { urls: ['*map.qq.com*', '*mapapi.qq.com*'] });
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: STUB });

  console.log('\n[0] 打开新增店铺');
  await goto(cdp, BASE, 2200);
  await cdp.evaluate(`document.getElementById('btnAddRestaurant').click()`);
  await sleep(500);
  const uiReady = await cdp.evaluate(`!!(document.getElementById('restSearch') && document.getElementById('btnRestSearch') && document.getElementById('restCandidates'))`);
  check('搜索框 / 按钮 / 候选区都在', uiReady === true);
  const coordsFolded = await cdp.evaluate(`(function(){var d=document.querySelector('.adv-coords');return !!(d && !d.open);})()`);
  check('经纬度默认收进折叠区', coordsFolded === true);

  console.log('\n[1] 唯一匹配：输入 aq羊肉串 → 直接指向那家');
  await typeSearch(cdp, 'aq羊肉串', 900);
  const one = await cdp.evaluate(`(function(){
    return {
      name: document.getElementById('restName').value,
      address: document.getElementById('restAddress').value,
      lat: document.getElementById('restLat').value,
      hint: document.getElementById('restSearchHint').textContent,
      listHidden: document.getElementById('restCandidates').hidden
    };
  })()`);
  check('店名被自动回填', one.name === 'aq羊肉串', one.name);
  check('地址被自动回填', /建设路/.test(one.address), one.address);
  check('坐标被自动回填', /^30\.67/.test(one.lat), one.lat);
  check('提示里说明已选中', /已选中/.test(one.hint), one.hint);

  console.log('\n[2] 同名两家：海吃牛鲜 → 列候选，不擅自选');
  await cdp.evaluate(`(function(){
    window.__fakeMode='two';
    document.getElementById('restName').value='';
    document.getElementById('restAddress').value='';
    var i=document.getElementById('restSearch'); i.value=''; i.dispatchEvent(new Event('input',{bubbles:true}));
  })()`);
  await typeSearch(cdp, '海吃牛鲜', 900);
  const two = await cdp.evaluate(`(function(){
    var box = document.getElementById('restCandidates');
    return {
      count: box.querySelectorAll('.place-item').length,
      hidden: box.hidden,
      name: document.getElementById('restName').value,
      hint: document.getElementById('restSearchHint').textContent,
      all: Array.from(box.querySelectorAll('.place-item')).map(function (n) { return n.textContent; }).join(' | ')
    };
  })()`);
  check('候选列表出现 2 条', two.count === 2, '实际 ' + two.count);
  check('没有擅自替用户选', two.name === '', '实际 ' + two.name);
  check('提示说明有多家', /多[家条]|选一个/.test(two.hint), two.hint);
  check('候选里带地址便于分辨', /建设路/.test(two.all) && /春熙路/.test(two.all), two.all.replace(/\s+/g, ' ').slice(0, 90));

  console.log('\n[3] 点选第二条 → 回填对应坐标');
  await cdp.evaluate(`document.querySelectorAll('#restCandidates .place-item')[1].click()`);
  await sleep(400);
  const picked = await cdp.evaluate(`(function(){
    return { name: document.getElementById('restName').value, lat: document.getElementById('restLat').value };
  })()`);
  check('点第二条回填春熙路那家', /春熙路/.test(picked.name), picked.name);
  check('坐标随之切换', /^30\.65/.test(picked.lat), picked.lat);

  console.log('\n[4] 带路名精确匹配：xx路海吃牛鲜');
  await cdp.evaluate(`(function(){ window.__fakeMode='one'; })()`);
  await typeSearch(cdp, '建设路海吃牛鲜', 900);
  const exact = await cdp.evaluate(`(function(){
    return { name: document.getElementById('restName').value, hint: document.getElementById('restSearchHint').textContent };
  })()`);
  check('精确同名时自动选定', exact.name === '建设路海吃牛鲜', exact.name);

  console.log('\n[5] 腾讯地图没有这家店 → 退到地址解析，跳到那条路');
  await cdp.evaluate(`(function(){
    window.__fakeMode='none';
    document.getElementById('restName').value='';
    document.getElementById('restAddress').value='';
  })()`);
  await typeSearch(cdp, '玉林四巷某家没名的串串', 1200);
  const none = await cdp.evaluate(`(function(){
    return {
      hint: document.getElementById('restSearchHint').textContent,
      address: document.getElementById('restAddress').value,
      lat: document.getElementById('restLat').value,
      service: window.__lastService
    };
  })()`);
  check('失败后调到 Geocoder 解析地址', none.service === 'geocoder', none.service);
  check('提示说明地图上没有这家店', /没有/.test(none.hint) && /建设路/.test(none.hint), none.hint);
  check('地址被填成解析到的路名', /建设路/.test(none.address), none.address);
  check('地图已定位到该路坐标', /^30\.668/.test(none.lat), none.lat);

  console.log('\n[5b] 不像地址的店名 → 地图不动');
  await cdp.evaluate(`(function(){ window.__fakeMode='none'; })()`);
  const beforeLat = await cdp.evaluate(`document.getElementById('restLat').value`);
  await typeSearch(cdp, '老王烧烤', 1200);
  const noAddr = await cdp.evaluate(`(function(){
    return {hint: document.getElementById('restSearchHint').textContent,
            lat: document.getElementById('restLat').value,
            service: window.__lastService};
  })()`);
  check('没有调用地址解析', noAddr.service !== 'geocoder', noAddr.service);
  check('提示说明地图不动', /不动/.test(noAddr.hint), noAddr.hint);
  check('坐标没有被改掉', noAddr.lat === beforeLat, noAddr.lat + ' vs ' + beforeLat);

  console.log('\n[5c] 纯路名 → 直接解析坐标，不列候选');
  await cdp.evaluate(`(function(){
    window.__fakeMode='none';
    window.__lastService='';
    var n = document.getElementById('restName');
    n.value = '';
    n.dispatchEvent(new Event('input', { bubbles: true }));
    document.getElementById('restLat').value = '';
  })()`);
  await typeSearch(cdp, '建设路', 1500);
  const pure = await cdp.evaluate(`(function(){
    return {service: window.__lastService,
            lat: document.getElementById('restLat').value,
            name: document.getElementById('restName').value,
            items: document.querySelectorAll('#restCandidates .place-item').length,
            hint: document.getElementById('restSearchHint').textContent};
  })()`);
  check('走的是地址解析而不是联想', pure.service === 'geocoder', pure.service);
  check('没有弹候选列表', pure.items === 0, String(pure.items));
  check('坐标被回填到那条路', /^30\.668/.test(pure.lat), pure.lat);
  check('店名没有被填成路名', pure.name === '', pure.name);

  console.log('\n[6] 控制台');
  const NOISE = /favicon|TMapService|鉴权|file 协议|net::ERR|Invalid URL|Failed to load resource/i;
  const appErrors = errs.pageErrors.filter((e) => !NOISE.test(e));
  check('无应用级 JS 异常', appErrors.length === 0, appErrors.slice(0, 2).join(' | '));

  console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
  await cdp.close();
  server.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('测试脚本异常：', e); process.exit(2); });
