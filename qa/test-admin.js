/**
 * 管理员功能验证（本地起 server.js，走真实 HTTP）
 *
 * 覆盖：
 *   1. 口令错误被拒、正确则发 token；无 token 不能调管理接口
 *   2. 管理员可以删除「别人的」评价（普通用户看不到删除按钮）
 *   3. 删除后普通用户看不到；管理员能在「已删除」里恢复
 *   4. 改口令后旧 token 失效、新 token 可用；改回原口令
 */
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { launch, goto, collectErrors, sleep } = require('./lib/cdp');

const ROOT = path.resolve(__dirname, '..');
const PORT = 8961;
const B = `http://127.0.0.1:${PORT}`;
// 测试专用的管理员口令：只在本地临时数据目录里生效，不是线上那个口令。
// 仓库里不写真实口令，测试启动前自己把哈希写进 data/config.json。
const CODE = 'qa-test-admin-code';
const SALT = 'qa-test-salt';
const TEMP_CODE = 'qa-test-temp-code';
const seedAdminConfig = () => {
  const dir = path.join(ROOT, 'data');
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({
    admin: {
      salt: SALT,
      hash: crypto.scryptSync(CODE, SALT, 32).toString('hex'),
      sessions: {}
    }
  }, null, 2));
};

let pass = 0;
let fail = 0;
const check = (n, ok, d) => {
  if (ok) { pass++; console.log('  ✓ ' + n); }
  else { fail++; console.log('  ✗ ' + n + (d ? '  → ' + d : '')); }
};

const post = (p, body, headers) => fetch(B + p, {
  method: 'POST',
  headers: Object.assign({ 'Content-Type': 'application/json' }, headers || {}),
  body: JSON.stringify(body || {})
});
const get = (p, headers) => fetch(B + p, { headers: headers || {} });

(async () => {
  seedAdminConfig();
  const srv = spawn(process.execPath, ['server.js'], {
    cwd: ROOT, env: Object.assign({}, process.env, { PORT: String(PORT) }), stdio: 'ignore'
  });
  await sleep(1800);

  try {
    console.log('\n[1] 口令与令牌');
    const bad = await post('/api/admin/login', { code: 'nope' });
    check('错误口令返回 401', bad.status === 401, String(bad.status));
    const ok = await post('/api/admin/login', { code: CODE });
    const session = await ok.json();
    check('正确口令发放 token', ok.status === 200 && !!session.token, String(ok.status));
    const sess = await get('/api/admin/session', { 'x-admin-token': session.token });
    check('token 可校验', sess.status === 200, String(sess.status));
    const noTok = await post('/api/admin/review', { id: 'x', action: 'delete' });
    check('无 token 调管理接口被拒', noTok.status === 401, String(noTok.status));

    console.log('\n[2] 造一条「别人的」评价');
    await post('/api/restaurants', [{ id: 'r01', name: '银桦餐厅', category: '食堂', price_level: 1, price: 12, address: '校内', lat: 30.7544, lng: 103.9312, tags: [], closed: false, source: 'seed', created_at: '2026-10-01T00:00:00.000Z', created_by: 'seed' }]);
    const rid = 'r01';
    const revId = 'rv_admin_test';
    await post('/api/reviews', [{
      id: revId, restaurant_id: rid, author: '路人甲',
      scores: { taste: 6, value: 6, service: 6, ambience: 6 }, verdict: 'recommend',
      text: '这是别人写的评价，管理员应该能删', photos: [], comments: [], deleted: false,
      owner: 'dev_stranger', created_at: new Date().toISOString(), updated_at: new Date().toISOString(), source: 'user'
    }]);

    // 造一家「别人的」店，用于测试店铺删除
    await post('/api/restaurants', [{
      id: 's_admin_test', name: '别人的测试店', category: '小吃', price_level: 2, price: 30,
      address: '测试路 1 号', lat: 30.75, lng: 103.93, tags: [], closed: false, deleted: false,
      owner: 'dev_stranger', source: 'user', created_at: new Date().toISOString(), created_by: '路人'
    }]);

    const cdp = await launch({ port: 9811 });
    const errs = collectErrors(cdp);
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
      source: `(function(){try{if(!localStorage.getItem('ginkgo.foodmap.v1')){localStorage.setItem('ginkgo.foodmap.v1', JSON.stringify({version:1,restaurants:[],reviews:[],meta:{deviceId:'dev_self',seedPurged:true,clearedAt:'2026-10-01T00:00:00.000Z'}}));}}catch(e){}})();`
    });
    await goto(cdp, B + '/', 3500);
    await sleep(3000);

    const openShop = () => cdp.evaluate(`(function(){
      var cards = document.querySelectorAll('#list .card');
      for (var i=0;i<cards.length;i++){ if(cards[i].getAttribute('data-id')==='${rid}'){ cards[i].click(); break; } }
      return new Promise(function(r){ setTimeout(function(){
        r({
          seen: (function(){
            var nodes = document.querySelectorAll('.review'), t = '';
            for (var i=0;i<nodes.length;i++){ if(!nodes[i].querySelector('.del-badge')) t += nodes[i].textContent; }
            return t.indexOf('这是别人写的评价') >= 0;
          })(),
          del: document.querySelectorAll('[data-del-review]').length,
          restore: document.querySelectorAll('[data-admin-restore]').length
        });
      }, 900); });
    })()`);

    console.log('\n[3] 普通用户视角');
    const asGuest = await openShop();
    check('能看到别人的评价', asGuest.seen === true, JSON.stringify(asGuest));
    check('看不到删除按钮', asGuest.del === 0, String(asGuest.del));

    const shopDel = await cdp.evaluate(`(function(){
      var cards = document.querySelectorAll('#list .card');
      for (var i=0;i<cards.length;i++){
        if (cards[i].getAttribute('data-id')==='s_admin_test'){ cards[i].click(); break; }
      }
      return new Promise(function(r){ setTimeout(function(){
        r(document.querySelectorAll('[data-detail-act="delete"]').length);
      }, 800); });
    })()`);
    check('普通用户看不到别人店铺的删除按钮', shopDel === 0, String(shopDel));

    const gate = await cdp.evaluate(`(function(){
      document.getElementById('btnData').click();
      return new Promise(function(r){ setTimeout(function(){
        r({ login: !document.getElementById('modalAdminLogin').hidden,
            data: !document.getElementById('modalData').hidden });
      }, 600); });
    })()`);
    check('未登录点「数据管理」只弹口令框', gate.login === true && gate.data === false, JSON.stringify(gate));
    await cdp.evaluate(`document.querySelector('[data-close="modalAdminLogin"]').click()`);
    await sleep(300);

    console.log('\n[4] 管理员登录后');
    await cdp.evaluate(`document.getElementById('btnData').click()`);
    await sleep(600);
    await cdp.evaluate(`(function(){
      document.querySelector('#modalData .data-fold').open = true;
      document.getElementById('adminCode').value = '${CODE}';
      document.getElementById('btnAdminLogin').click();
    })()`);
    await sleep(1500);
    const loggedIn = await cdp.evaluate(`(document.getElementById('adminHint')||{}).textContent||''`);
    check('面板显示已进入管理模式', /已进入管理模式/.test(loggedIn), loggedIn.slice(0, 40));

    await cdp.evaluate(`document.querySelector('[data-close="modalData"]').click()`);
    await sleep(400);
    const asAdmin = await openShop();
    check('管理员能看到删除按钮', asAdmin.del >= 1, String(asAdmin.del));

    console.log('\n[5] 删除与恢复');
    await cdp.evaluate(`(function(){ document.querySelector('[data-del-review]').click(); })()`);
    await sleep(500);
    await cdp.evaluate(`(function(){ var ok=document.getElementById('confirmOk'); if(ok) ok.click(); })()`);
    await sleep(3500);
    const afterDel = await openShop();
    check('删除后普通区不再显示', afterDel.seen === false, JSON.stringify(afterDel));
    check('进入「已删除」列表', afterDel.restore >= 1, String(afterDel.restore));
    const remote1 = await (await get('/api/reviews')).json();
    check('服务端标记 deleted=true', (remote1.find((x) => x.id === revId) || {}).deleted === true);

    await cdp.evaluate(`(function(){ document.querySelector('[data-admin-restore]').click(); })()`);
    await sleep(3500);
    const afterRestore = await openShop();
    check('恢复后又能看到', afterRestore.seen === true, JSON.stringify(afterRestore));
    const remote2 = await (await get('/api/reviews')).json();
    check('服务端 deleted=false', (remote2.find((x) => x.id === revId) || {}).deleted === false);

    console.log('\n[5b] 删除店铺与恢复');
    await cdp.evaluate(`document.querySelector('[data-close-drawer]').click()`);
    await sleep(300);
    const shopDelAdmin = await cdp.evaluate(`(function(){
      var cards = document.querySelectorAll('#list .card');
      for (var i=0;i<cards.length;i++){
        if (cards[i].getAttribute('data-id')==='s_admin_test'){ cards[i].click(); break; }
      }
      return new Promise(function(r){ setTimeout(function(){
        var btns = document.querySelectorAll('[data-detail-act="delete"]');
        if (btns.length) btns[0].click();
        setTimeout(function(){ var ok=document.getElementById('confirmOk'); if(ok) ok.click(); r(true); }, 400);
      }, 800); });
    })()`);
    await sleep(3500);
    const goneCard = await cdp.evaluate(`!!Array.from(document.querySelectorAll('#list .card')).find(function(n){return n.getAttribute('data-id')==='s_admin_test';})`);
    check('管理员删除后店里从列表消失', goneCard === false, String(goneCard));
    const shopRemote = await (await get('/api/restaurants')).json();
    check('服务端店铺 deleted=true', (shopRemote.find((x) => x.id === 's_admin_test') || {}).deleted === true);

    await cdp.evaluate(`(function(){
      document.getElementById('btnData').click();
    })()`);
    await sleep(700);
    await cdp.evaluate(`(function(){
      var b = document.querySelector('[data-admin-restore-shop="s_admin_test"]');
      if (b) b.click();
    })()`);
    await sleep(3500);
    const backCard = await cdp.evaluate(`!!Array.from(document.querySelectorAll('#list .card')).find(function(n){return n.getAttribute('data-id')==='s_admin_test';})`);
    check('恢复后店铺回到列表', backCard === true, String(backCard));
    const shopRemote2 = await (await get('/api/restaurants')).json();
    check('服务端店铺 deleted=false', (shopRemote2.find((x) => x.id === 's_admin_test') || {}).deleted === false);

    console.log('\n[5c] 永久清理（物理删除）');
    await post('/api/restaurants', [{
      id: 's_purge', name: '待清理店', category: '小吃', price_level: 2, price: 20,
      address: 'x', lat: 30.75, lng: 103.93, tags: [], closed: false, deleted: false,
      owner: 'dev_x', source: 'user', created_at: new Date().toISOString(), created_by: 'x'
    }]);
    await post('/api/reviews', [{
      id: 'rv_purge', restaurant_id: 's_purge', author: 'x',
      scores: { taste: 5, value: 5, service: 5, ambience: 5 }, verdict: 'recommend',
      text: '待清理评价', photos: [], comments: [], deleted: false, owner: 'dev_x',
      created_at: new Date().toISOString(), updated_at: new Date().toISOString(), source: 'user'
    }]);
    // 一条孤儿评价（指向不存在的店）
    await post('/api/reviews', [{
      id: 'rv_orphan', restaurant_id: 's_no_such_shop', author: 'x',
      scores: { taste: 5, value: 5, service: 5, ambience: 5 }, verdict: 'recommend',
      text: '孤儿评价', photos: [], comments: [], deleted: false, owner: 'dev_x',
      created_at: new Date().toISOString(), updated_at: new Date().toISOString(), source: 'user'
    }]);
    await post('/api/admin/review', { id: 'rv_purge', action: 'delete' }, { 'x-admin-token': session.token });
    await post('/api/admin/restaurant', { id: 's_purge', action: 'delete' }, { 'x-admin-token': session.token });

    const purgeRes = await post('/api/admin/purge', { dropPhotos: false }, { 'x-admin-token': session.token });
    const purged = await purgeRes.json();
    check('清理返回移除统计', purged.removedRestaurants >= 1 && purged.removedReviews >= 2, JSON.stringify(purged));

    const afterShops = await (await get('/api/restaurants')).json();
    const afterReviews = await (await get('/api/reviews')).json();
    check('已删除的店被物理移除', !afterShops.find((x) => x.id === 's_purge'), 'still there');
    check('已删除的评价被物理移除', !afterReviews.find((x) => x.id === 'rv_purge'), 'still there');
    check('孤儿评价被物理移除', !afterReviews.find((x) => x.id === 'rv_orphan'), 'still there');
    check('正常数据保留', afterShops.find((x) => x.id === 'r01') && afterReviews.find((x) => x.id === revId), 'lost good data');

    console.log('\n[5d] 社团口令（服务端强制）');
    const tok2 = await (await post('/api/admin/login', { code: CODE })).json();
    const memTok = tok2.token;

    const mkReview = (id) => ({
      id: id, restaurant_id: rid, author: 'x',
      scores: { taste: 5, value: 5, service: 5, ambience: 5 }, verdict: 'recommend',
      text: '口令测试 ' + id, photos: [], comments: [], deleted: false, owner: 'dev_x',
      created_at: new Date().toISOString(), updated_at: new Date().toISOString(), source: 'user'
    });

    const free = await post('/api/reviews', [mkReview('rv_free')]);
    check('未开启时可自由写', free.status === 201, String(free.status));

    const on = await post('/api/admin/member-code', { code: 'club2026' }, { 'x-admin-token': memTok });
    check('管理员开启社团口令', on.status === 200, String(on.status));
    const blocked = await post('/api/reviews', [mkReview('rv_blocked')]);
    check('开启后：无口令被拒 401', blocked.status === 401, String(blocked.status));
    const wrong = await post('/api/reviews', [mkReview('rv_wrong')], { 'x-member-code': 'nope' });
    check('开启后：错误口令被拒', wrong.status === 401, String(wrong.status));
    const okWrite = await post('/api/reviews', [mkReview('rv_ok')], { 'x-member-code': 'club2026' });
    check('开启后：正确口令可写', okWrite.status === 201, String(okWrite.status));
    const shopBlocked = await post('/api/restaurants', [{ id: 's_blocked', name: 'x', category: 'x', price_level: 1, price: 1, address: '', lat: 30.75, lng: 103.93, tags: [], closed: false, deleted: false, owner: 'x', source: 'user', created_at: new Date().toISOString() }]);
    check('开接口令后加店也被拦', shopBlocked.status === 401, String(shopBlocked.status));

    const healthNow = await (await get('/api/health')).json();
    check('health 暴露 memberRequired=true', healthNow.memberRequired === true, JSON.stringify(healthNow));

    // 社员在「评分说明」里填一次后应能写（客户端行为：存 localStorage 后带上头）
    const memberFlow = await cdp.evaluate(`(function(){
      document.getElementById('btnHelp').click();
      return new Promise(function(r){
        setTimeout(function(){
          var input = document.getElementById('memberCode');
          if (!input) return r({ ok:false, why:'没有口令输入框' });
          input.value = 'club2026';
          document.getElementById('btnMemberSave').click();
          setTimeout(function(){
            r({ ok: localStorage.getItem('ginkgo.member.v1') === 'club2026',
                hint: (document.getElementById('memberHint')||{}).textContent || '' });
          }, 400);
        }, 700);
      });
    })()`);
    check('社员保存口令后本机已记录', memberFlow.ok === true, JSON.stringify(memberFlow));
    check('提示文案反映已开启', /已保存社团口令|已开启社团口令/.test(memberFlow.hint), memberFlow.hint.slice(0, 40));
    await cdp.evaluate(`document.querySelector('[data-close="modalHelp"]').click()`);
    await sleep(300);

    const off = await post('/api/admin/member-code', { code: '' }, { 'x-admin-token': memTok });
    check('管理员关闭社团口令', off.status === 200, String(off.status));
    const freeAgain = await post('/api/reviews', [mkReview('rv_free2')]);
    check('关闭后恢复自由写', freeAgain.status === 201, String(freeAgain.status));

    console.log('\n[6] 改口令');
    const changed = await post('/api/admin/change-code', { code: TEMP_CODE }, { 'x-admin-token': session.token });
    const changedBody = await changed.json();
    check('改口令成功并换发 token', changed.status === 200 && !!changedBody.token, String(changed.status));
    const oldTok = await get('/api/admin/session', { 'x-admin-token': session.token });
    check('旧 token 失效', oldTok.status === 401, String(oldTok.status));
    const newLogin = await post('/api/admin/login', { code: TEMP_CODE });
    check('新口令可登录', newLogin.status === 200, String(newLogin.status));
    const back = await post('/api/admin/change-code', { code: CODE }, { 'x-admin-token': changedBody.token });
    check('改回原口令（复原测试环境）', back.status === 200, String(back.status));

    console.log('\n[7] 控制台');
    const NOISE = /favicon|TMapService|Invalid URL|Failed to load resource|net::ERR/i;
    const real = errs.pageErrors.filter((e) => !NOISE.test(e) && !/^Uncaught \(in promise\)( null)?$/.test(e.trim()));
    check('无带信息的异常', real.length === 0, JSON.stringify(real).slice(0, 200));
    await cdp.close();
  } finally {
    srv.kill();
  }

  console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('测试异常：', e); process.exit(2); });
