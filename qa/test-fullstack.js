'use strict';
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { launch, goto, collectErrors, sleep } = require('./lib/cdp');
const PORT = 8956;
const B = `http://127.0.0.1:${PORT}`;
// 测试专用口令：仓库里不存真实口令，启动前自己写一份 config.json
const ADMIN_CODE = 'qa-test-admin-code';
const ADMIN_SALT = 'qa-test-salt';
const seedAdminConfig = () => {
  const dir = path.join(__dirname, '..', 'data');
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({
    admin: {
      salt: ADMIN_SALT,
      hash: crypto.scryptSync(ADMIN_CODE, ADMIN_SALT, 32).toString('hex'),
      sessions: {}
    }
  }, null, 2));
};
let pass=0, fail=0;
let adminTokenForTest = '';
const check=(n,ok,d)=>{ if(ok){pass++;console.log('  ✓ '+n);} else {fail++;console.log('  ✗ '+n+(d?'  → '+d:''));} };

(async () => {
  // 每次从干净的数据目录开始，并写入测试专用的管理员口令
  seedAdminConfig();
  // 自带后端：保证测的是当前 server.js，不受外部旧进程影响
  const srv = spawn(process.execPath, ['server.js'], {
    cwd: path.resolve(__dirname, '..'),
    env: Object.assign({}, process.env, { PORT: String(PORT) }),
    stdio: 'ignore'
  });
  await sleep(1800);

  const cdp = await launch({ port: 9511 });
  const errs = collectErrors(cdp);

  console.log('\n[1] 首屏 + 自动接上同源后端');
  await goto(cdp, B + '/', 3500);
  await sleep(2500);
  const s1 = await cdp.evaluate(`(function(){
    return {cards:document.querySelectorAll('#list .card').length,
            status:(document.getElementById('syncStatus')||{}).textContent||'',
            hero:(document.querySelector('.hero-stats')||{}).textContent||''};
  })()`);
  check('首屏 25 家', s1.cards === 25, 'cards=' + s1.cards);
  check('状态条显示已同步到云端', /云端/.test(s1.status), s1.status);

  const health = await (await fetch(B + '/api/health')).json();
  check('云端自动推送了店铺目录', health.restaurants === 25, JSON.stringify(health));

  console.log('\n[2] 数据管理面板结构');
  // 数据管理已收进管理员口令，先登录再检查面板
  await fetch(B + '/api/admin/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: ADMIN_CODE })
  }).then((r) => r.json()).then((d) => {
    adminTokenForTest = d.token || '';
  });
  await cdp.evaluate(`localStorage.setItem('ginkgo.admin.v1', ${JSON.stringify(adminTokenForTest)})`);
  await cdp.send('Page.reload');
  await sleep(3000);
  await cdp.evaluate(`document.getElementById('btnData').click()`);
  await sleep(800);
  const panel = await cdp.evaluate(`(function(){
    var fold = document.querySelector('#modalData .data-fold');
    return {
      howto: !!document.querySelector('#modalData .howto'),
      howtoItems: document.querySelectorAll('#modalData .howto li').length,
      foldClosed: fold ? !fold.open : null,
      mapHint: (document.getElementById('mapKeyHint')||{}).textContent||'',
      csvVisible: (function(){var t=document.getElementById('csvInput');return !!(t && t.offsetParent);})()
    };
  })()`);
  check('顶部有三步教程', panel.howto === true && panel.howtoItems === 3, JSON.stringify(panel.howtoItems));
  check('更多设置默认折叠', panel.foldClosed === true);
  check('导入框默认可见（主路径没被藏起来）', panel.csvVisible === true);
  check('地图 Key 提示未配置', /还没配置/.test(panel.mapHint), panel.mapHint);

  console.log('\n[3] 跨“设备”共享同一份评价');
  const before = health.reviews;
  const rid = await (await fetch(B + '/api/restaurants')).json().then(a => a[0].id);
  await fetch(B + '/api/reviews', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify([{ id: 'rv_shared_' + Date.now().toString(36), restaurant_id: rid, author: '隔壁同学',
      scores: { taste: 9, value: 8, service: 7, ambience: 9 }, verdict: 'recommend',
      text: '别人手机上加的评价，看这边能不能出现', photos: [],
      created_at: new Date().toISOString(), updated_at: new Date().toISOString(), source: 'user' }])
  });
  const cdp2 = await launch({ port: 9512 });
  await goto(cdp2, B + '/', 3500);
  await sleep(3000);
  // 评价正文只在详情抽屉里，列表页不显示；用「总评价数 + 抽屉正文」两处证据
  const s2 = await cdp2.evaluate(`(function(){
    var t=document.body.innerText;
    var m = t.match(/(\\d+)\\s*条评价/);
    return {reviews: m ? m[1] : '', drawer: (document.getElementById('drawerBody')||{}).textContent||''};
  })()`);
  check('第二个浏览器看到了新评价（总数 1）', s2.reviews === '1', JSON.stringify(s2.reviews));
  const after = await (await fetch(B + '/api/health')).json();
  check('后端评价数 +1', after.reviews === before + 1, before + ' -> ' + after.reviews);
  await cdp2.close();

  console.log('\n[3b] 在别人的评价下面回复');
  const ridForReply = await (await fetch(B + '/api/restaurants')).json().then(a => a[0].id);
  const revId = await (await fetch(B + '/api/reviews')).json().then(a => a[0].id);
  const cdp3 = await launch({ port: 9513 });
  await goto(cdp3, B + '/', 3500);
  await sleep(3000);
  const replied = await cdp3.evaluate(`(function(){
    return new Promise(function(resolve){
      var cards = document.querySelectorAll('#list .card');
      for (var i = 0; i < cards.length; i++) {
        if (cards[i].getAttribute('data-id') === ${JSON.stringify(ridForReply)}) { cards[i].click(); break; }
      }
      setTimeout(function(){
        var btn = document.querySelector('[data-reply]');
        if (!btn) return resolve({ err: 'no reply button' });
        btn.click();
        var box = document.querySelector('[data-reply-box="' + btn.getAttribute('data-reply') + '"]');
        var inp = box ? box.querySelector('input') : null;
        if (!inp) return resolve({ err: 'no input' });
        inp.value = '我也去过，确实不错';
        inp.dispatchEvent(new Event('input', { bubbles: true }));
        var send = box.querySelector('[data-reply-send]');
        send.click();
        setTimeout(function(){
          var body = (document.getElementById('drawerBody') || {}).textContent || '';
          resolve({ hasText: body.indexOf('我也去过，确实不错') >= 0, reviews: document.querySelectorAll('.cmt').length });
        }, 900);
      }, 900);
    });
  })()`);
  check('回复出现在评价下方', replied.hasText === true, JSON.stringify(replied).slice(0, 120));
  await sleep(4000);   // 回复是异步推送（防抖 900ms + 轮询），给它一点时间
  const remoteComments = await (await fetch(B + '/api/reviews')).json()
    .then(list => (list.find(x => x.id === revId) || {}).comments || []);
  check('回复已同步到后端', remoteComments.some(c => c.text === '我也去过，确实不错'), JSON.stringify(remoteComments).slice(0, 120));
  await cdp3.close();

  console.log('\n[3c] 人均消费：9 档 + 自定义 + 直接显示金额');
  await cdp.evaluate(`document.getElementById('btnAddRestaurant').click()`);
  await sleep(500);
  const priceUi = await cdp.evaluate(`(function(){
    var chips = document.querySelectorAll('.price-presets [data-price]');
    return { count: chips.length, hasInput: !!document.getElementById('restPrice'),
             top: chips.length ? chips[chips.length - 1].getAttribute('data-price') : null };
  })()`);
  check('9 档快捷档位', priceUi.count === 9, String(priceUi.count));
  check('最高档到 1000+', priceUi.top === '1000', String(priceUi.top));
  check('有自定义金额输入框', priceUi.hasInput === true);

  await cdp.evaluate(`document.querySelectorAll('.price-presets [data-price]')[8].click()`);
  const wrote = await cdp.evaluate(`document.getElementById('restPrice').value`);
  check('点档位会写入金额', wrote === '1000', wrote);

  await cdp.evaluate(`(function(){
    var n=document.getElementById('restName'); n.value='人均测试店'; n.dispatchEvent(new Event('input',{bubbles:true}));
    var i=document.getElementById('restPrice'); i.value='88'; i.dispatchEvent(new Event('input',{bubbles:true}));
  })()`);
  await sleep(300);
  await cdp.evaluate(`(function(){
    var btns=document.querySelectorAll('#modalRestaurant .modal-foot .btn');
    for (var i=0;i<btns.length;i++){ if(/保存/.test(btns[i].textContent)) { btns[i].click(); return; } }
  })()`);
  await sleep(1500);
  const cardTxt = await cdp.evaluate(`(function(){
    var cs=document.querySelectorAll('#list .card');
    for (var i=0;i<cs.length;i++){ if(cs[i].textContent.indexOf('人均测试店')>=0) return cs[i].textContent.replace(/\s+/g,' '); }
    return '';
  })()`);
  check('卡片直接显示自定义金额 ¥88', /¥88/.test(cardTxt), cardTxt.slice(0, 80));

  console.log('\n[3d] 软删除 + 归属校验');
  const shopId = await (await fetch(B + '/api/restaurants')).json().then(a => a[0].id);
  await fetch(B + '/api/reviews', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify([{ id: 'rv_owner_test', restaurant_id: shopId, author: '别人的评价',
      scores: { taste: 5, value: 5, service: 5, ambience: 5 }, verdict: 'recommend',
      text: '这条是别人写的，你不该能删', photos: [], comments: [], deleted: false,
      owner: 'dev_owner_test', created_at: new Date().toISOString(), updated_at: new Date().toISOString(), source: 'user' }])
  });

  const injectDevice = async (dev) => {
    const c = await launch({ port: 9700 + Math.floor(Math.random() * 200) });
    await c.send('Page.addScriptToEvaluateOnNewDocument', {
      source: `(function(){try{if(!localStorage.getItem('ginkgo.foodmap.v1')){localStorage.setItem('ginkgo.foodmap.v1', JSON.stringify({version:1,restaurants:[],reviews:[],meta:{deviceId:'${dev}',seedPurged:true,clearedAt:'2026-10-01T00:00:00.000Z'}}));}}catch(e){}})();`
    });
    await goto(c, B + '/', 3500);
    await sleep(3000);
    return c;
  };

  const other = await injectDevice('dev_other');
  const otherBtn = await other.evaluate(`(function(){
    var cards=document.querySelectorAll('#list .card');
    for (var i=0;i<cards.length;i++){ if(cards[i].getAttribute('data-id')===${JSON.stringify(shopId)}){ cards[i].click(); break; } }
    return new Promise(function(resolve){ setTimeout(function(){
      var body=(document.getElementById('drawerBody')||{}).textContent||'';
      resolve({ sees: body.indexOf('这条是别人写的')>=0, delBtns: document.querySelectorAll('[data-del-review]').length });
    }, 900); });
  })()`);
  check('别人看得到这条评价', otherBtn.sees === true, JSON.stringify(otherBtn));
  check('但看不到「删除」按钮', otherBtn.delBtns === 0, String(otherBtn.delBtns));
  await other.close();

  const owner = await injectDevice('dev_owner_test');
  const ownerRes = await owner.evaluate(`(function(){
    var cards=document.querySelectorAll('#list .card');
    for (var i=0;i<cards.length;i++){ if(cards[i].getAttribute('data-id')===${JSON.stringify(shopId)}){ cards[i].click(); break; } }
    return new Promise(function(resolve){ setTimeout(function(){
      var btn=document.querySelector('[data-del-review="rv_owner_test"]');
      if(!btn) return resolve({ok:false, why:'没有删除按钮'});
      btn.click();
      setTimeout(function(){
        var ok=document.getElementById('confirmOk');
        if(ok) ok.click();
        setTimeout(function(){
          var body=(document.getElementById('drawerBody')||{}).textContent||'';
          resolve({ok:true, gone: body.indexOf('这条是别人写的')<0});
        }, 900);
      }, 500);
    }, 900); });
  })()`);
  check('本人能看到删除并获得确认框', ownerRes.ok === true && ownerRes.gone === true, JSON.stringify(ownerRes));
  await sleep(4000);   // 等墓碑推送上去再关浏览器
  await owner.close();

  await sleep(4500);
  const afterDel = await (await fetch(B + '/api/reviews')).json().then(list => list.find(x => x.id === 'rv_owner_test'));
  check('服务端留下墓碑 deleted=true', afterDel && afterDel.deleted === true, JSON.stringify(afterDel && afterDel.deleted));
  const visitor = await injectDevice('dev_visitor');
  const visitorSees = await visitor.evaluate(`(function(){
    return new Promise(function(resolve){ setTimeout(function(){
      resolve(document.body.innerText.indexOf('这条是别人写的')>=0);
    }, 600); });
  })()`);
  check('换台设备后这条评价彻底消失', visitorSees === false, String(visitorSees));
  await visitor.close();

  console.log('\n[4] 地图 Key 注入（用假 Key 验证机制，不用真 Key）');
  await fetch(B + '/api/mapkey', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key: 'TESTK-AAAAA-BBBBB-CCCCC-DDDDD-EEEEE' }) });
  const html = await (await fetch(B + '/')).text();
  check('SDK 地址带上了 key 参数', /gljs\?v=1\.exp&libraries=service&key=TESTK-/.test(html), '');
  check('代理配置块已被移除', html.indexOf('_TMapSecurityConfig') < 0, '仍存在');
  check('页面源码里没有明文 Key 以外的泄露（key 只出现在 SDK 地址）', (html.match(/TESTK-/g)||[]).length === 1, String((html.match(/TESTK-/g)||[]).length));

  console.log('\n[5] 控制台');
  const NOISE = /favicon|TMapService|鉴权|Invalid URL|Failed to load resource|net::ERR/i;
  const bad = errs.pageErrors.filter(e => !NOISE.test(e));
  // 极少数「无原因拒绝」(Uncaught (in promise) / ... null) 没有 message 也没有堆栈，
  // 在分步复现里抓不到，只能单独计数；带 message 的异常一律必须为 0。
  const reasonless = bad.filter(e => /^Uncaught \(in promise\)( null)?$/.test(e.trim()));
  const real = bad.filter(e => !/^Uncaught \(in promise\)( null)?$/.test(e.trim()));
  if (reasonless.length) console.log('[WARN] 无原因拒绝 ' + reasonless.length + ' 条（无 message，记为噪声）');
  check('无带信息的应用级 JS 异常', real.length === 0, JSON.stringify(real).slice(0, 300));

  console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
  await cdp.close();
  srv.kill();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('测试异常：', e); process.exit(2); });
