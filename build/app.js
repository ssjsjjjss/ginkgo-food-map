/* ============================================================================
 * Ginkgo 美食地图 · 应用层
 * 职责：DOM 渲染、地图联动、抽屉与弹层、导入导出、同步
 * 依赖：window.GinkgoCore（纯逻辑）、window.SeedData（种子数据）、window.TMap（可选）
 * ========================================================================== */
(function () {
  'use strict';

  /* ========================================================================
   * 0. 常量与配置
   * ====================================================================== */

  var Core = window.GinkgoCore;
  var SeedData = window.SeedData;

  var TIERS = Core.TIERS;
  /** 无评价时使用的「待评级」档，仅用于展示，不参与 tierOf 计算 */
  var TIER_NONE = { key: 'none', label: '待评级', min: null, color: '#B9B2A4', edge: '#FFFFFF', size: 18, order: 0, slogan: '等你来评' };
  var ALL_TIERS = TIERS.concat([TIER_NONE]);

  var STORAGE_KEY = 'ginkgo.foodmap.v1';
  var CHANNEL_NAME = 'ginkgo-foodmap';
  var PHOTO_DB_NAME = 'ginkgo-foodmap-photos';

  /** 电子科技大学清水河校区中心（GCJ-02），用于算直线距离与新建店铺默认坐标 */
  var CAMPUS = { lat: 30.7544, lng: 103.9312, name: '电子科技大学清水河校区' };
  var CITY_CENTER = { lat: 30.6570, lng: 104.0660 };
  var CITY_ZOOM = 11.5;
  var LABEL_ZOOM = 14;

  var DIMS = ['taste', 'value', 'service', 'ambience'];
  var DIM_LABEL = { taste: '味道', value: '性价比', service: '服务', ambience: '环境' };

  var CATEGORIES = ['火锅', '川菜', '小吃', '食堂', '快餐', '烧烤', '甜品', '冒菜', '面馆', '麻辣烫', '粥粉面', '轻食', '其他'];

  /* ------------------------------------------------------------------
   * 云同步配置。不再需要改源码：在「数据管理 → 云同步」里填地址和密钥即可，
   * 存在 localStorage，刷新后仍然生效。
   * endpoint 例：https://xxxx.supabase.co/rest/v1
   * 建表 SQL 见 SYNC_SQL 常量（面板里可一键复制）。
   * ------------------------------------------------------------------ */
  var SYNC_STORE_KEY = 'ginkgo.sync.v1';

  var SYNC_CONFIG = {
    mode: 'local',        // 由 endpoint / anonKey 是否齐全自动推导
    endpoint: '',
    anonKey: '',
    pollMs: 15000
  };

  (function initSyncConfig() {
    try {
      var raw = localStorage.getItem(SYNC_STORE_KEY);
      if (!raw) return;
      var saved = JSON.parse(raw);
      if (!saved || typeof saved !== 'object') return;
      if (typeof saved.endpoint === 'string') SYNC_CONFIG.endpoint = saved.endpoint.replace(/\/+$/, '');
      if (typeof saved.anonKey === 'string') SYNC_CONFIG.anonKey = saved.anonKey;
      if (saved.pollMs) SYNC_CONFIG.pollMs = Math.max(5000, Number(saved.pollMs) || 15000);
      SYNC_CONFIG.mode = (SYNC_CONFIG.endpoint && SYNC_CONFIG.anonKey) ? 'cloud' : 'local';
    } catch (e) { /* 配置损坏就按本地模式跑 */ }
  })();

  /** 一键复制的建表脚本：社团管理员在 Supabase SQL Editor 里执行一次即可 */
  var SYNC_SQL = [
    '-- Ginkgo 美食地图 · 云端建表脚本（在 Supabase → SQL Editor 里整段执行一次）',
    'create table if not exists public.restaurants (',
    '  id text primary key,',
    '  name text not null,',
    '  category text default \'其他\',',
    '  price_level int default 2,',
    '  address text default \'\',',
    '  lat double precision default 30.7527,',
    '  lng double precision default 103.9336,',
    '  tags jsonb default \'[]\'::jsonb,',
    '  closed boolean default false,',
    '  source text default \'user\',',
    '  created_at timestamptz default now(),',
    '  created_by text default \'社员\',',
    '  needs_location boolean default false',
    ');',
    '',
    'create table if not exists public.reviews (',
    '  id text primary key,',
    '  restaurant_id text not null,',
    '  author text default \'匿名社员\',',
    '  scores jsonb not null default \'{}\'::jsonb,',
    '  verdict text default \'recommend\',',
    '  text text default \'\',',
    '  photos jsonb default \'[]\'::jsonb,',
    '  created_at timestamptz default now(),',
    '  updated_at timestamptz default now(),',
    '  source text default \'user\'',
    ');',
    '',
    'create index if not exists reviews_updated_at_idx on public.reviews (updated_at desc);',
    'create index if not exists reviews_restaurant_idx on public.reviews (restaurant_id);',
    '',
    'alter table public.restaurants enable row level security;',
    'alter table public.reviews enable row level security;',
    '',
    'drop policy if exists "ginkgo read restaurants" on public.restaurants;',
    'drop policy if exists "ginkgo write restaurants" on public.restaurants;',
    'drop policy if exists "ginkgo read reviews" on public.reviews;',
    'drop policy if exists "ginkgo write reviews" on public.reviews;',
    '',
    'create policy "ginkgo read restaurants" on public.restaurants for select using (true);',
    'create policy "ginkgo write restaurants" on public.restaurants for all using (true) with check (true);',
    'create policy "ginkgo read reviews" on public.reviews for select using (true);',
    'create policy "ginkgo write reviews" on public.reviews for all using (true) with check (true);'
  ].join('\n');

  /** 读写云端配置；填齐两个值即进入 cloud 模式 */
  var SyncConfig = {
    save: function (endpoint, anonKey) {
      var normalized = '';
      try { normalized = normalizeEndpoint(endpoint); } catch (e) { normalized = String(endpoint || '').trim(); }
      SYNC_CONFIG.endpoint = normalized;
      SYNC_CONFIG.anonKey = String(anonKey || '').trim();
      SYNC_CONFIG.mode = (SYNC_CONFIG.endpoint && SYNC_CONFIG.anonKey) ? 'cloud' : 'local';
      try {
        if (SYNC_CONFIG.endpoint && SYNC_CONFIG.anonKey) {
          window.localStorage.setItem(SYNC_STORE_KEY, JSON.stringify({
            endpoint: SYNC_CONFIG.endpoint,
            anonKey: SYNC_CONFIG.anonKey,
            pollMs: SYNC_CONFIG.pollMs
          }));
        } else {
          window.localStorage.removeItem(SYNC_STORE_KEY);
        }
      } catch (e) { /* 存不了就只在本次会话生效 */ }
    }
  };

  /**
   * 发布后的站点带分享码校验：同源请求也要把 sharecode 带上，
   * 否则会被平台拦成「链接不完整」的 HTML 页面。
   */
  function withShareCode(target) {
    try {
      var code = new URLSearchParams(location.search).get('sharecode');
      if (!code) return target;
      return target + (target.indexOf('?') >= 0 ? '&' : '?') + 'sharecode=' + encodeURIComponent(code);
    } catch (e) {
      return target;
    }
  }

  /* ---- 管理员会话：口令换 token，token 存本机，7 天有效 ---- */
  var ADMIN_KEY = 'ginkgo.admin.v1';
  var MEMBER_KEY = 'ginkgo.member.v1';
  var adminToken = '';
  var memberCode = '';
  try { memberCode = window.localStorage.getItem(MEMBER_KEY) || ''; } catch (e) { memberCode = ''; }

  try { adminToken = window.localStorage.getItem(ADMIN_KEY) || ''; } catch (e) { adminToken = ''; }

  function adminApi(path, body) {
    var opt = { headers: { 'Content-Type': 'application/json' } };
    if (adminToken) opt.headers['x-admin-token'] = adminToken;
    if (body) { opt.method = 'POST'; opt.body = JSON.stringify(body); }
    return fetch(withShareCode(location.origin + '/api/admin/' + path), opt).then(function (resp) {
      return resp.json().catch(function () { return {}; }).then(function (data) {
        if (!resp.ok) throw new Error((data && data.error) || ('HTTP ' + resp.status));
        return data || {};
      });
    });
  }

  function setAdminToken(token) {
    adminToken = token || '';
    try {
      if (adminToken) window.localStorage.setItem(ADMIN_KEY, adminToken);
      else window.localStorage.removeItem(ADMIN_KEY);
    } catch (e) { /* 存不了就只在本次生效 */ }
    ui.isAdmin = !!adminToken;
    updateAdminUI();
  }

  function verifyAdmin() {
    if (!adminToken) { ui.isAdmin = false; updateAdminUI(); return; }
    adminApi('session').then(function (data) {
      ui.isAdmin = !!data.ok;
      ui.adminExp = data.expiresAt || 0;
      updateAdminUI();
    }).catch(function () { setAdminToken(''); });
  }

  /** 管理员专属：已删除店铺的回收站 */
  function renderAdminTrash() {
    var box = el('adminTrash');
    if (!box) return;
    if (!ui.isAdmin) { box.innerHTML = ''; return; }
    var gone = state.restaurants.filter(function (r) { return r.deleted; });
    if (!gone.length) { box.innerHTML = '<p class="hint-line">没有被删除的店铺。</p>'; return; }
    box.innerHTML = '<p class="hint-line">已删除的店铺（' + gone.length + '），点恢复即可重新出现：</p>' +
      gone.map(function (r) {
        return '<div class="trash-row"><span>' + esc(r.name) + '</span>' +
          '<button class="btn btn-sm" type="button" data-admin-restore-shop="' + esc(r.id) + '">恢复</button></div>';
      }).join('');
  }

  /** 清理后按服务端现状重建本地数据（把墓碑和孤儿一并清掉） */
  function resyncFromServer() {
    var base = location.origin + '/api/';
    return fetch(withShareCode(base + 'restaurants?select=*')).then(function (r) { return r.json(); })
      .then(function (rows) {
        var shops = (rows || []).map(remoteToRestaurant).filter(Boolean);
        return fetch(withShareCode(base + 'reviews?select=*')).then(function (r2) { return r2.json(); })
          .then(function (rrows) {
            state.restaurants = shops;
            state.reviews = (rrows || []).map(remoteToReview).filter(Boolean);
            state.meta.pendingSync = [];
            state.meta.pendingRestaurants = [];
            saveState('remote');
            rebuildAggregates();
            renderList();
            if (MapCtl.ready) MapCtl.sync();
            renderAdminTrash();
          });
      });
  }

  /** 恢复一家被软删除的店铺 */
  function restoreShopById(id) {
    if (!id) return;
    adminApi('restaurant', { id: id, action: 'restore' })
      .then(function () { return Sync.pullRestaurants(); })
      .then(function () {
        rebuildAggregates();
        renderList();
        if (MapCtl.ready) MapCtl.sync();
        renderAdminTrash();
        toast('店铺已恢复');
      })
      .catch(function (e) { toast('恢复失败：' + (e.message || '网络错误'), 'error'); });
  }

  /** 社团口令：管理员开启后，写操作必须带上 */
  function refreshMemberState() {
    if (!/^https?:$/.test(location.protocol)) return;
    fetch(withShareCode(location.origin + '/api/health'))
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (info) {
        ui.memberRequired = !!(info && info.memberRequired);
        updateMemberUI();
        updateMemberAdminUI();
      })
      .catch(function () { /* 没有后端就不管 */ });
  }

  function setMemberCode(code) {
    memberCode = code || '';
    try {
      if (memberCode) window.localStorage.setItem(MEMBER_KEY, memberCode);
      else window.localStorage.removeItem(MEMBER_KEY);
    } catch (e) { /* 存不了只在本次生效 */ }
    updateMemberUI();
  }

  function updateMemberUI() {
    var hint = el('memberHint');
    if (!hint) return;
    var input = el('memberCode');
    if (input && input.value === '' && memberCode) input.value = memberCode;
    if (ui.memberRequired) {
      hint.innerHTML = memberCode
        ? '<b style="color:var(--matcha)">已保存社团口令</b>：可以正常写评价、加店。'
        : '<b style="color:var(--amber)">已开启社团口令</b>：没填的话写评价/加店会被拒绝，填一次就好。';
    } else {
      hint.textContent = '管理员还没开启社团口令，现在拿到链接的人都能写评价。';
    }
  }

  /** 管理员设置/关闭社团口令（服务端校验，前端没有特权） */
  function saveMemberCode(code) {
    adminApi('member-code', { code: code || '' })
      .then(function (data) {
        if (el('adminMemberCode')) el('adminMemberCode').value = '';
        // 口令一变，本机保存的成员口令就作废了
        setMemberCode('');
        refreshMemberState();
        toast(data.enabled ? '社团口令已开启' : '社团口令已关闭');
      })
      .catch(function (e) { toast('设置失败：' + (e.message || '网络错误'), 'error'); });
  }

  /** 刷新数据面板里的管理员区块 */
  function updateAdminUI() {
    var hint = el('adminHint');
    if (!hint) return;
    var loginBox = el('adminLoginBox');
    var loginBtns = el('adminLoginBtns');
    var changeBox = el('adminChangeBox');
    var opsBtns = el('adminOpsBtns');
    if (ui.isAdmin) {
      var when = ui.adminExp ? new Date(ui.adminExp).toLocaleString() : '7 天后';
      hint.innerHTML = '<b style="color:var(--matcha)">已进入管理模式</b>：可以删除/恢复任何人的评价。有效至 ' + esc(when) + '。';
      if (loginBox) loginBox.hidden = true;
      if (loginBtns) loginBtns.hidden = true;
      if (changeBox) changeBox.hidden = false;
      if (opsBtns) opsBtns.hidden = false;
      var purgeBox = el('adminPurgeBox');
      if (purgeBox) purgeBox.hidden = false;
      var mBox = el('adminMemberBox');
      if (mBox) mBox.hidden = false;
      var mBtns = el('adminMemberBtns');
      if (mBtns) mBtns.hidden = false;
    } else {
      hint.textContent = '未登录。输入口令后可以删除/恢复任何人的评价。';
      if (loginBox) loginBox.hidden = false;
      if (loginBtns) loginBtns.hidden = false;
      if (changeBox) changeBox.hidden = true;
      if (opsBtns) opsBtns.hidden = true;
      var purgeBox2 = el('adminPurgeBox');
      if (purgeBox2) purgeBox2.hidden = true;
      var mBox2 = el('adminMemberBox');
      if (mBox2) mBox2.hidden = true;
      var mBtns2 = el('adminMemberBtns');
      if (mBtns2) mBtns2.hidden = true;
    }
    renderAdminTrash();
    updateMemberAdminUI();
  }

  /** 管理员视角的社团口令状态 */
  function updateMemberAdminUI() {
    var hint = el('adminMemberHint');
    if (!hint) return;
    if (!ui.isAdmin) { hint.textContent = ''; return; }
    hint.innerHTML = ui.memberRequired
      ? '<b style="color:var(--matcha)">已开启</b>：社员在「评分说明」里填一次后就能写评价；链接外流也刷不了分。'
      : '当前<b>未开启</b>：任何人拿到链接都能写评价。建议开启。';
  }

  /** 云端请求头：新版 publishable key 只放 apikey，旧版 anon JWT 才加 Bearer */
  function syncHeaders(key, member) {
    var headers = { 'Content-Type': 'application/json', apikey: key };
    if (/^eyJ[A-Za-z0-9_-]+\./.test(key)) headers.Authorization = 'Bearer ' + key;
    if (member) headers['x-member-code'] = member;
    return headers;
  }

  /**
   * 把用户可能粘错的形式尽量修正；修不了就抛出能看懂的错误。
   * 常见错误：把 sb_publishable_... 密钥当地址、漏了 https://、漏了 /rest/v1。
   */
  function normalizeEndpoint(input) {
    var raw = String(input || '').trim();
    if (!raw) throw new Error('接口地址不能为空');
    if (/^sb_(publishable|secret)_/i.test(raw)) {
      throw new Error('这串是密钥，不是地址。地址应该形如 https://xxxx.supabase.co');
    }
    var url = raw;
    if (!/^https?:\/\//i.test(url)) {
      if (!/\.supabase\.co/i.test(url) && !/^[\w.-]+\.[a-z]{2,}\//i.test(url) && !/^[\w.-]+\.[a-z]{2,}$/i.test(url)) {
        throw new Error('这看起来不是地址。应该填 https://项目名.supabase.co');
      }
      url = 'https://' + url;
    }
    url = url.replace(/\/+$/, '').replace(/\/rest\/v1$/i, '');
    return url + '/rest/v1';
  }

  /** 连接自检：顺手区分「表没建」「密钥不对」「地址写错」「项目没起来」 */
  function testSyncConnection(endpoint, anonKey) {
    var base;
    try {
      base = normalizeEndpoint(endpoint);
    } catch (err) {
      return Promise.reject(err);
    }
    var key = String(anonKey || '').trim();
    if (!key) return Promise.reject(new Error('密钥不能为空'));
    if (!/^(sb_publishable_|sb_secret_|eyJ)/.test(key)) {
      return Promise.reject(new Error('密钥格式不对，应该以 sb_publishable_ 或 eyJ 开头'));
    }
    return fetch(base + '/restaurants?select=id&limit=1', {
      headers: syncHeaders(key)
    }).then(function (resp) {
      if (resp.ok) return true;
      return resp.text().then(function (body) {
        if (resp.status === 404) throw new Error('连上了，但表还没建。请先执行建表 SQL');
        if (resp.status === 401 || resp.status === 403) throw new Error('密钥不对，或表的权限策略没建好');
        throw new Error('HTTP ' + resp.status + ' ' + String(body).slice(0, 100));
      });
    }).catch(function (err) {
      if (err && /Failed to fetch|NetworkError|Load failed/i.test(err.message || '')) {
        throw new Error('连不上服务器：检查地址是否写对；也可能是项目还在初始化或已被暂停（去后台看项目状态是否 Active）');
      }
      throw err;
    });
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text);
    }
    return new Promise(function (resolve, reject) {
      try {
        var ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        resolve();
      } catch (e) { reject(e); }
    });
  }


  var TEMPLATE_HEADERS = ['店名', '味道', '性价比', '服务', '环境', '推荐', '昵称', '点评', '日期'];
  var TEMPLATE_ROWS = [
    ['银桦餐厅', '7', '7', '6', '6', '推荐', '小林', '二楼阿姨手不抖，八块钱两荤一素', '2026-10-01'],
    ['小龙坎火锅(全球总店)', '7', '6', '8', '8', '推荐', '阿哲', '牛油锅够味，就是人均有点贵', '2026-10-05']
  ];

  /* ========================================================================
   * 1. 运行时状态
   * ====================================================================== */

  var state = null;                 // 当前数据快照
  var aggCache = Object.create(null); // restaurantId -> 聚合结果

  var ui = {
    search: '',
    tiers: [],            // 选中的杯型 key 数组
    sort: 'score',
    view: 'all',
    selectedId: null,
    pickMode: false,
    restDraft: null,
    reviewDraft: null,
    importDraft: null,
    placeCandidates: [],
    isAdmin: false,
    adminExp: 0,
    memberRequired: false,
    photoUrls: new Map(),
    suppressBroadcast: false
  };

  var channel = null;
  var confirmResolver = null;
  var labelTimer = 0;
  var lastZoom = null;

  /* ========================================================================
   * 2. 小工具
   * ====================================================================== */

  function el(id) { return document.getElementById(id); }

  /** 事件委托用：兼容 target 不是元素节点的情况 */
  function closestOf(node, selector) {
    if (!node || node.nodeType !== 1 || typeof node.closest !== 'function') return null;
    return node.closest(selector);
  }

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  }

  function pad2(n) { return n < 10 ? '0' + n : String(n); }

  function toast(message, kind) {
    var box = el('toasts');
    if (!box) return;
    var node = document.createElement('div');
    node.className = 'toast' + (kind ? ' toast-' + kind : '');
    node.textContent = message;
    box.appendChild(node);
    setTimeout(function () { node.classList.add('out'); }, 3200);
    setTimeout(function () { if (node.parentNode) node.parentNode.removeChild(node); }, 3800);
  }

  function nowIso() { return new Date().toISOString(); }

  /** 两点直线距离（km，Haversine） */
  function haversine(a, b) {
    var R = 6371;
    var toRad = Math.PI / 180;
    var dLat = (b.lat - a.lat) * toRad;
    var dLng = (b.lng - a.lng) * toRad;
    var s = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(a.lat * toRad) * Math.cos(b.lat * toRad) *
      Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
  }

  function distanceText(r) {
    if (!isFinite(r.lat) || !isFinite(r.lng)) return '位置待补';
    var km = haversine(CAMPUS, { lat: r.lat, lng: r.lng });
    return km.toFixed(1) + ' km';
  }

  /** 相对时间：刚刚 / x 分钟前 / x 小时前 / x 天前 / x 个月前 */
  function relativeTime(iso) {
    var t = Date.parse(iso);
    if (!isFinite(t)) return '';
    var diff = Date.now() - t;
    if (diff < 0) diff = 0;
    var min = Math.floor(diff / 60000);
    if (min < 1) return '刚刚';
    if (min < 60) return min + ' 分钟前';
    var hour = Math.floor(min / 60);
    if (hour < 24) return hour + ' 小时前';
    var day = Math.floor(hour / 24);
    if (day < 30) return day + ' 天前';
    var month = Math.floor(day / 30);
    if (month < 12) return month + ' 个月前';
    return Math.floor(month / 12) + ' 年前';
  }

  /* ---- 人均消费：9 档快捷 + 可自定义具体金额 ---- */
  var PRICE_PRESETS = [
    { v: 15, label: '15 内' },
    { v: 25, label: '15–30' },
    { v: 40, label: '30–50' },
    { v: 65, label: '50–80' },
    { v: 100, label: '80–120' },
    { v: 160, label: '120–200' },
    { v: 350, label: '200–500' },
    { v: 750, label: '500–1000' },
    { v: 1000, label: '1000+' }
  ];
  var LEGACY_LEVEL_PRICE = { 1: 15, 2: 25, 3: 65, 4: 120 };

  /** 人均展示：填了具体金额就直接显示，没填显示待补 */
  function priceLabel(r) {
    var p = Number(r && r.price);
    if (!isFinite(p) || p <= 0) return '人均待补';
    return p >= 1000 ? '¥1000+' : '¥' + Math.round(p);
  }

  function priceToLevel(p) {
    if (!p) return 2;
    if (p <= 20) return 1;
    if (p <= 50) return 2;
    if (p <= 120) return 3;
    return 4;
  }

  function priceSymbol(level) {
    var n = Math.max(1, Math.min(4, Number(level) || 1));
    return new Array(n + 1).join('¥');
  }

  function tierFg(t) {
    return (t.key === 'medium' || t.key === 'none') ? '#2B2A26' : '#FFFFFF';
  }

  function nameCompare(a, b) {
    return String(a.name).localeCompare(String(b.name), 'zh-CN');
  }

  /** 文本 → 剪贴板（带降级） */
  function copyText(text, okMessage) {
    function fallback() {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', 'readonly');
      ta.style.position = 'fixed';
      ta.style.top = '-1000px';
      document.body.appendChild(ta);
      ta.select();
      var done = false;
      try { done = document.execCommand('copy'); } catch (e) { done = false; }
      document.body.removeChild(ta);
      toast(done ? (okMessage || '已复制到剪贴板') : '复制失败，请手动选中复制', done ? '' : 'warn');
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () {
        toast(okMessage || '已复制到剪贴板');
      }).catch(fallback);
    } else {
      fallback();
    }
  }

  /* WGS84 → GCJ-02（浏览器定位返回 WGS84，腾讯地图用 GCJ-02） */
  var GCJ = (function () {
    var PI = Math.PI;
    var A = 6378245.0;
    var EE = 0.00669342162296594323;
    function outOfChina(lat, lng) {
      return !(lng > 73.66 && lng < 135.05 && lat > 3.86 && lat < 53.55);
    }
    function transformLat(x, y) {
      var ret = -100 + 2 * x + 3 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x));
      ret += (20 * Math.sin(6 * x * PI) + 20 * Math.sin(2 * x * PI)) * 2 / 3;
      ret += (20 * Math.sin(y * PI) + 40 * Math.sin(y / 3 * PI)) * 2 / 3;
      ret += (160 * Math.sin(y / 12 * PI) + 320 * Math.sin(y * PI / 30)) * 2 / 3;
      return ret;
    }
    function transformLng(x, y) {
      var ret = 300 + x + 2 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
      ret += (20 * Math.sin(6 * x * PI) + 20 * Math.sin(2 * x * PI)) * 2 / 3;
      ret += (20 * Math.sin(x * PI) + 40 * Math.sin(x / 3 * PI)) * 2 / 3;
      ret += (150 * Math.sin(x / 12 * PI) + 300 * Math.sin(x / 30 * PI)) * 2 / 3;
      return ret;
    }
    function wgs2gcj(lat, lng) {
      if (outOfChina(lat, lng)) return { lat: lat, lng: lng };
      var dLat = transformLat(lng - 105, lat - 35);
      var dLng = transformLng(lng - 105, lat - 35);
      var radLat = lat / 180 * PI;
      var magic = Math.sin(radLat);
      magic = 1 - EE * magic * magic;
      var sqrtMagic = Math.sqrt(magic);
      dLat = (dLat * 180) / ((A * (1 - EE)) / (magic * sqrtMagic) * PI);
      dLng = (dLng * 180) / (A / sqrtMagic * Math.cos(radLat) * PI);
      return { lat: lat + dLat, lng: lng + dLng };
    }
    return { wgs2gcj: wgs2gcj };
  })();

  /* ========================================================================
   * 3. 数据层：种子 / 归一化 / 读写
   * ====================================================================== */

  function seedState() {
    var built = SeedData.buildSeed();
    return {
      version: 1,
      restaurants: built.restaurants,
      reviews: [],   // 示例评价已废弃：分数只来自真实社员打分
      meta: { lastSyncAt: null, pendingSync: [], pendingRestaurants: [], nickname: '', clearedAt: null, seedPurged: true, deviceId: Core.uid('dev') }
    };
  }

  /** id 只允许安全字符，杜绝把外部数据拼进 HTML 属性时被注入 */
  var ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
  /** 本次清洗中「非法 id 被重新生成」的次数，用于把脏数据就地写回本机 */
  var sanitizeRepairCount = 0;

  /**
   * 归一化店铺。
   * @param {*} raw 原始记录
   * @param {Object} [remap] 旧 id → 新 id 映射表。店铺 id 被重建时写入，
   *        同批次的评价据此把 restaurantId 一起改写，避免产生孤儿评价。
   */
  function normalizeRestaurant(raw, remap) {
    if (!raw || typeof raw !== 'object') return null;
    var rawId = typeof raw.id === 'string' ? raw.id : '';
    var id = rawId;
    if (!ID_PATTERN.test(rawId)) {
      id = Core.uid('r');
      sanitizeRepairCount += 1;
      if (rawId && remap) remap[rawId] = id;
    }
    var name = typeof raw.name === 'string' ? raw.name.trim() : '';
    if (!name) return null;
    var lat = Number(raw.lat);
    var lng = Number(raw.lng);
    if (!isFinite(lat) || !isFinite(lng)) { lat = CAMPUS.lat; lng = CAMPUS.lng; }
    var avgPrice = Number(raw.price);
    if (!isFinite(avgPrice) || avgPrice < 0) avgPrice = 0;
    if (!avgPrice) {
      var lv = Math.round(Number(raw.priceLevel));
      avgPrice = LEGACY_LEVEL_PRICE[lv] || 0;
    }
    avgPrice = Math.min(5000, Math.round(avgPrice));
    var tags = Array.isArray(raw.tags) ? raw.tags.filter(function (t) { return typeof t === 'string' && t; }).slice(0, 8) : [];
    return {
      id: id,
      name: name,
      category: typeof raw.category === 'string' && raw.category ? raw.category : '其他',
      price: avgPrice,
      priceLevel: priceToLevel(avgPrice),
      address: typeof raw.address === 'string' ? raw.address : '',
      lat: lat,
      lng: lng,
      tags: tags,
      closed: !!raw.closed,
      deleted: raw.deleted === true,
      owner: typeof raw.owner === 'string' ? raw.owner.slice(0, 64) : '',
      source: raw.source === 'seed' ? 'seed' : 'user',
      needsLocation: !!raw.needsLocation,
      createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : nowIso(),
      createdBy: typeof raw.createdBy === 'string' ? raw.createdBy : '社员'
    };
  }

  /**
   * 归一化评价。id 非法时重新生成；restaurantId 若在 remap 里能对上就改写，
   * 仍然对不上（孤儿）则整条丢弃。
   */
  function normalizeReview(raw, remap) {
    if (!raw || typeof raw !== 'object') return null;
    var rawId = typeof raw.id === 'string' ? raw.id : '';
    var id = rawId;
    if (!ID_PATTERN.test(rawId)) {
      id = Core.uid('rv');
      sanitizeRepairCount += 1;
    }
    var rawRid = typeof raw.restaurantId === 'string' ? raw.restaurantId : '';
    var rid = (remap && typeof remap[rawRid] === 'string') ? remap[rawRid] : rawRid;
    if (!ID_PATTERN.test(rid)) return null;
    var scores = raw.scores && typeof raw.scores === 'object' ? raw.scores : {};
    var clean = {};
    for (var i = 0; i < DIMS.length; i++) {
      var v = Number(scores[DIMS[i]]);
      if (!isFinite(v) || v < 0 || v > 10) return null;
      clean[DIMS[i]] = Math.round(v * 2) / 2;
    }
    return {
      id: id,
      restaurantId: rid,
      author: typeof raw.author === 'string' && raw.author.trim() ? raw.author.trim().slice(0, 20) : '匿名社员',
      scores: clean,
      verdict: raw.verdict === 'not_recommend' ? 'not_recommend' : 'recommend',
      text: typeof raw.text === 'string' ? raw.text.slice(0, 500) : '',
      photos: Array.isArray(raw.photos) ? raw.photos.filter(function (p) { return typeof p === 'string'; }).slice(0, 2) : [],
      deleted: raw.deleted === true,
      owner: typeof raw.owner === 'string' ? raw.owner.slice(0, 64) : '',
      comments: (function () {
        var list = Array.isArray(raw.comments) ? raw.comments : [];
        return list.slice(-50).map(function (c) {
          if (!c || typeof c !== 'object') return null;
          var txt = typeof c.text === 'string' ? c.text.trim().slice(0, 200) : '';
          if (!txt) return null;
          return {
            id: (typeof c.id === 'string' && ID_PATTERN.test(c.id)) ? c.id : Core.uid('c'),
            author: (typeof c.author === 'string' && c.author.trim()) ? c.author.trim().slice(0, 20) : '匿名社员',
            text: txt,
            createdAt: typeof c.createdAt === 'string' ? c.createdAt : nowIso(),
            // 保留回复人的设备 ID，贡献榜据此准确归因；历史回复没有该字段则为 ''
            owner: (typeof c.owner === 'string' && ID_PATTERN.test(c.owner)) ? c.owner.slice(0, 64) : ''
          };
        }).filter(Boolean);
      })(),
      createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : nowIso(),
      updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : (typeof raw.createdAt === 'string' ? raw.createdAt : nowIso()),
      source: raw.source === 'seed' ? 'seed' : 'user'
    };
  }

  function sanitizeState(raw) {
    if (!raw || typeof raw !== 'object') return null;
    sanitizeRepairCount = 0;
    var out = {
      version: 1,
      restaurants: [],
      reviews: [],
      // 旧数据没有 seedPurged 字段时默认 false，触发一次示例评价清理
      meta: { lastSyncAt: null, pendingSync: [], pendingRestaurants: [], nickname: '', clearedAt: null, seedPurged: false }
    };
    var remap = Object.create(null);
    var restIds = Object.create(null);
    if (Array.isArray(raw.restaurants)) {
      raw.restaurants.forEach(function (item) {
        var r = normalizeRestaurant(item, remap);
        if (!r) return;
        if (restIds[r.id]) return; // 同 id 重复，保留先出现的
        restIds[r.id] = true;
        out.restaurants.push(r);
      });
    }
    var reviewIds = Object.create(null);
    if (Array.isArray(raw.reviews)) {
      raw.reviews.forEach(function (item) {
        var rv = normalizeReview(item, remap);
        if (!rv || !restIds[rv.restaurantId]) return; // 孤儿评价丢弃
        if (reviewIds[rv.id]) return;
        reviewIds[rv.id] = true;
        out.reviews.push(rv);
      });
    }
    if (raw.meta && typeof raw.meta === 'object') {
      out.meta.lastSyncAt = typeof raw.meta.lastSyncAt === 'string' ? raw.meta.lastSyncAt : null;
      out.meta.pendingSync = Array.isArray(raw.meta.pendingSync)
        ? raw.meta.pendingSync.filter(function (x) { return typeof x === 'string'; })
        : [];
      out.meta.pendingRestaurants = Array.isArray(raw.meta.pendingRestaurants)
        ? raw.meta.pendingRestaurants.filter(function (x) { return typeof x === 'string'; })
        : [];
      out.meta.nickname = typeof raw.meta.nickname === 'string' ? raw.meta.nickname : '';
      out.meta.clearedAt = typeof raw.meta.clearedAt === 'string' ? raw.meta.clearedAt : null;
      out.meta.seedPurged = raw.meta.seedPurged === true;
      out.meta.deviceId = (typeof raw.meta.deviceId === 'string' && ID_PATTERN.test(raw.meta.deviceId))
        ? raw.meta.deviceId
        : Core.uid('dev');
    }
    return out;
  }

  function loadState() {
    var raw = null;
    try {
      raw = window.localStorage.getItem(STORAGE_KEY);
    } catch (e) {
      toast('本机存储不可用，本次改动可能不会被保存', 'warn');
      return seedState();
    }
    if (!raw) return seedState();
    var parsed = null;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      toast('本机数据已损坏，已载入示例数据（原数据未覆盖，仍可手动导出）', 'warn');
      return seedState();
    }
    var clean = sanitizeState(parsed);
    if (!clean) {
      toast('本机数据格式异常，已载入示例数据（原数据未覆盖）', 'warn');
      return seedState();
    }
    var isEmpty = !clean.restaurants.length && !clean.reviews.length;
    // 只有「从未被主动清空过」的空数据（例如导入了一个空对象）才回落示例数据；
    // 用户点了「清空全部数据」会写入 meta.clearedAt，此后刷新必须保持空态。
    if (isEmpty && !clean.meta.clearedAt) {
      toast('本机数据为空或格式异常，已载入示例数据', 'warn');
      return seedState();
    }
    return clean;
  }

  function saveState(reason) {
    if (!state) return;
    state.meta.lastSyncAt = nowIso();
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      toast('保存失败：本机存储空间可能已满', 'error');
    }
    updateStatusBar();
    if (reason !== 'remote') broadcastState();
    if (reason !== 'remote') Sync.schedulePush();
  }

  /** 已软删除的店铺仍在 state 里（用于同步墓碑），但任何统计/展示都必须排除 */
  function liveRestaurants() {
    return state.restaurants.filter(function (r) { return !r.deleted; });
  }

  /** 已软删除的评价仍在 state 里（用于同步墓碑），但任何统计/展示都必须排除 */
  function liveReviews() {
    var shops = {};
    state.restaurants.forEach(function (r) { if (!r.deleted) shops[r.id] = true; });
    return state.reviews.filter(function (rv) { return !rv.deleted && shops[rv.restaurantId]; });
  }

  function rebuildAggregates() {
    var list = liveReviews();
    Object.keys(aggCache).forEach(function (k) { delete aggCache[k]; });
    state.restaurants.forEach(function (r) {
      aggCache[r.id] = Core.aggregate(list, r.id);
    });
  }

  function getRestaurant(id) {
    for (var i = 0; i < state.restaurants.length; i++) {
      if (state.restaurants[i].id === id) return state.restaurants[i];
    }
    return null;
  }

  function reviewsOf(id) {
    return liveReviews().filter(function (rv) { return rv.restaurantId === id; })
      .sort(function (a, b) { return (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0); });
  }

  function aggOf(id) {
    return aggCache[id] || Core.aggregate([]);
  }

  function globalStats() {
    var overalls = liveReviews().map(function (rv) { return Core.overall(rv.scores); })
      .filter(function (v) { return v !== null; });
    var avg = overalls.length
      ? overalls.reduce(function (a, b) { return a + b; }, 0) / overalls.length
      : null;
    return { restaurants: liveRestaurants().length, reviews: overalls.length, avg: avg };
  }

  /* ========================================================================
   * 4. 照片存储（IndexedDB，失败降级到内存）
   * ====================================================================== */

  var PhotoDB = (function () {
    var dbPromise = null;
    var memory = new Map();
    var supported = true;

    function openDB() {
      if (dbPromise) return dbPromise;
      dbPromise = new Promise(function (resolve, reject) {
        if (!window.indexedDB) { reject(new Error('no indexedDB')); return; }
        var req = window.indexedDB.open(PHOTO_DB_NAME, 1);
        req.onupgradeneeded = function () {
          var db = req.result;
          if (!db.objectStoreNames.contains('photos')) db.createObjectStore('photos');
        };
        req.onsuccess = function () { resolve(req.result); };
        req.onerror = function () { reject(req.error || new Error('open failed')); };
      });
      return dbPromise;
    }

    function put(key, blob) {
      return openDB().then(function (db) {
        return new Promise(function (resolve, reject) {
          var tx = db.transaction('photos', 'readwrite');
          tx.objectStore('photos').put(blob, key);
          tx.oncomplete = function () { resolve(key); };
          tx.onerror = function () { reject(tx.error || new Error('IndexedDB 事务失败')); };
        });
      }).catch(function () {
        supported = false;
        memory.set(key, blob);
        return key;
      });
    }

    function get(key) {
      return openDB().then(function (db) {
        return new Promise(function (resolve) {
          var tx = db.transaction('photos', 'readonly');
          var req = tx.objectStore('photos').get(key);
          req.onsuccess = function () { resolve(req.result || null); };
          req.onerror = function () { resolve(null); };
        });
      }).catch(function () {
        return memory.get(key) || null;
      });
    }

    function remove(key) {
      memory.delete(key);
      return openDB().then(function (db) {
        return new Promise(function (resolve) {
          var tx = db.transaction('photos', 'readwrite');
          tx.objectStore('photos').delete(key);
          tx.oncomplete = function () { resolve(true); };
          tx.onerror = function () { resolve(false); };
        });
      }).catch(function () { return false; });
    }

    function count() {
      return openDB().then(function (db) {
        return new Promise(function (resolve) {
          var tx = db.transaction('photos', 'readonly');
          var req = tx.objectStore('photos').count();
          req.onsuccess = function () { resolve(req.result || 0); };
          req.onerror = function () { resolve(memory.size); };
        });
      }).catch(function () { return memory.size; });
    }

    return { put: put, get: get, remove: remove, count: count, isSupported: function () { return supported; } };
  })();

  function photoUrl(key) {
    if (ui.photoUrls.has(key)) return Promise.resolve(ui.photoUrls.get(key));
    return PhotoDB.get(key).then(function (blob) {
      if (!blob) return null;
      var url = URL.createObjectURL(blob);
      ui.photoUrls.set(key, url);
      return url;
    }).catch(function () { return null; });
  }

  /** 把页面上所有 [data-photo-key] 的占位块填成真实图片 */
  function hydratePhotos(scope) {
    var root = scope || document;
    var nodes = root.querySelectorAll('[data-photo-key]');
    Array.prototype.forEach.call(nodes, function (node) {
      var key = node.getAttribute('data-photo-key');
      if (!key) return;
      photoUrl(key).then(function (url) {
        if (url) {
          node.style.backgroundImage = 'url("' + url + '")';
          node.classList.add('has-img');
          node.removeAttribute('data-photo-key');
          node.setAttribute('data-photo-url', url);
        } else {
          node.classList.add('no-img');
        }
      });
    });
  }

  /** 前端压缩：最长边 1200，JPEG 0.78；单张压到 200KB 以内（云同步要传 base64） */
  function compressImage(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onerror = function () { reject(new Error('读取图片失败')); };
      reader.onload = function () {
        var img = new Image();
        img.onerror = function () { reject(new Error('图片解码失败')); };
        img.onload = function () {
          var MAX_EDGE = 1200;
          var w = img.width;
          var h = img.height;
          var scale = Math.min(1, MAX_EDGE / Math.max(w, h));
          var cw = Math.max(1, Math.round(w * scale));
          var ch = Math.max(1, Math.round(h * scale));
          var canvas = document.createElement('canvas');
          canvas.width = cw;
          canvas.height = ch;
          var ctx = canvas.getContext('2d');
          ctx.fillStyle = '#FFFFFF';
          ctx.fillRect(0, 0, cw, ch);
          ctx.drawImage(img, 0, 0, cw, ch);

          var qualities = [0.78, 0.68, 0.58, 0.48, 0.38, 0.3, 0.24];
          var index = 0;
          function tryNext() {
            if (index >= qualities.length) { resolve(null); return; }
            var q = qualities[index];
            index += 1;
            if (!canvas.toBlob) { resolve(null); return; }
            canvas.toBlob(function (blob) {
              if (!blob) { resolve(null); return; }
              if (blob.size <= 200 * 1024 || index >= qualities.length) {
              resolve(blob.size <= 300 * 1024 ? blob : null);   // 还是太大就放弃这张，避免撑爆同步
            }
              else { tryNext(); }
            }, 'image/jpeg', q);
          }
          tryNext();
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  /* ========================================================================
   * 5. 视图模型：筛选与排序
   * ====================================================================== */

  function tierKeyOf(id) {
    var agg = aggCache[id];
    return agg && agg.tier ? agg.tier.key : 'none';
  }

  function visibleRestaurants() {
    var q = ui.search.trim().toLowerCase();
    var list = state.restaurants.filter(function (r) {
      if (r.deleted) return false;
      if (q) {
        var hay = (r.name + ' ' + r.address + ' ' + r.category + ' ' + (r.tags || []).join(' ')).toLowerCase();
        if (hay.indexOf(q) < 0) return false;
      }
      var key = tierKeyOf(r.id);
      if (ui.tiers.length && ui.tiers.indexOf(key) < 0) return false;
      if (ui.view === 'recommend') {
        var t = aggCache[r.id] && aggCache[r.id].tier;
        if (!t || t.order < 3) return false;
      }
      if (ui.view === 'pit') {
        if (key !== 'small') return false;
      }
      return true;
    });
    return sortRestaurants(list);
  }

  function sortRestaurants(list) {
    var arr = list.slice();
    var mode = ui.sort;

    function scoreOf(r) {
      var agg = aggCache[r.id];
      return agg ? agg.score : null;
    }
    function dimOf(r, dim) {
      var agg = aggCache[r.id];
      return agg ? agg.dims[dim] : null;
    }

    if (mode === 'reviews') {
      arr.sort(function (a, b) {
        var ca = aggCache[a.id] ? aggCache[a.id].count : 0;
        var cb = aggCache[b.id] ? aggCache[b.id].count : 0;
        if (cb !== ca) return cb - ca;
        return nameCompare(a, b);
      });
      return arr;
    }

    if (mode === 'price') {
      arr.sort(function (a, b) {
        var ap = a.price > 0 ? a.price : 1e9, bp = b.price > 0 ? b.price : 1e9;
        if (ap !== bp) return ap - bp;
        var sa = scoreOf(a);
        var sb = scoreOf(b);
        if (sa === null && sb === null) return nameCompare(a, b);
        if (sa === null) return 1;
        if (sb === null) return -1;
        if (sb !== sa) return sb - sa;
        return nameCompare(a, b);
      });
      return arr;
    }

    arr.sort(function (a, b) {
      var va = mode === 'score' ? scoreOf(a) : dimOf(a, mode);
      var vb = mode === 'score' ? scoreOf(b) : dimOf(b, mode);
      var na = (va === null || va === undefined);
      var nb = (vb === null || vb === undefined);
      if (na && nb) return nameCompare(a, b);
      if (na) return 1;
      if (nb) return -1;
      if (vb !== va) return vb - va;
      return nameCompare(a, b);
    });
    return arr;
  }

  /* ========================================================================
   * 6. 渲染：图形片段
   * ====================================================================== */

  /** 杯子图标（用于徽章 / 图例） */
  function cupGlyph(fill, px, strokeColor) {
    var stroke = strokeColor || 'rgba(0,0,0,0.10)';
    return '<svg viewBox="0 0 24 24" width="' + px + '" height="' + px + '" aria-hidden="true">' +
      '<path d="M6.3 8.1h11.4l-1.35 10.2H7.65Z" fill="' + fill + '" stroke="' + stroke + '" stroke-width="1.1" stroke-linejoin="round"/>' +
      '<path d="M17 10.1h1.25a2.05 2.05 0 0 1 0 4.1h-1.05" fill="none" stroke="' + fill + '" stroke-width="1.7" stroke-linecap="round"/>' +
      '<path d="M5.3 5.7h13.4" stroke="' + fill + '" stroke-width="1.7" stroke-linecap="round"/>' +
      '</svg>';
  }

  function badgeHtml(tier, opts) {
    var o = opts || {};
    var t = tier || TIER_NONE;
    var fg = tierFg(t);
    var cls = 'badge' + (o.large ? ' badge-lg' : '') + (t.key === 'bucket' ? ' is-bucket' : '');
    var px = o.large ? 17 : 13;
    return '<span class="' + cls + '" style="--c:' + t.color + ';color:' + fg + '">' +
      cupGlyph(fg, px, t.key === 'bucket' ? '#E9B949' : 'rgba(255,255,255,0.35)') +
      '<em style="font-style:normal">' + esc(t.label) + '</em></span>';
  }

  /** 地图 marker：杯子形状的 pin，尺寸随档位递增 */
  function markerSvg(tier, opts) {
    var o = opts || {};
    var t = tier || TIER_NONE;
    var selected = !!o.selected;
    var closed = !!o.closed;
    var color = closed ? '#A8A29A' : t.color;
    var edge = (!closed && t.key === 'bucket') ? '#E9B949' : '#FFFFFF';
    var opacity = closed ? 0.55 : 1;
    var w = Math.round((t.size + 22) * (selected ? 1.32 : 1));
    var h = Math.round(w * 1.3);
    var cx = w / 2;
    var cy = w * 0.44;
    var r = w * 0.36;
    var cupH = w * 0.24;
    var cupTopW = w * 0.34;
    var cupBotW = w * 0.24;
    var cupTopY = cy - cupH * 0.34;
    var cupBotY = cy + cupH * 0.66;
    var strokeW = selected ? 2.6 : 1.8;

    var path = 'M' + cx + ' ' + (h - 2) +
      ' C ' + (cx - r * 1.05) + ' ' + (h * 0.63) + ' ' + (cx - r) + ' ' + (cy + r * 0.62) + ' ' + (cx - r) + ' ' + cy +
      ' A ' + r + ' ' + r + ' 0 1 1 ' + (cx + r) + ' ' + cy +
      ' C ' + (cx + r) + ' ' + (cy + r * 0.62) + ' ' + (cx + r * 1.05) + ' ' + (h * 0.63) + ' ' + cx + ' ' + (h - 2) + ' Z';

    var cup = 'M' + (cx - cupTopW / 2) + ' ' + cupTopY +
      ' L' + (cx + cupTopW / 2) + ' ' + cupTopY +
      ' L' + (cx + cupBotW / 2) + ' ' + (cupBotY - 1.6) +
      ' Q' + cx + ' ' + cupBotY + ' ' + (cx - cupBotW / 2) + ' ' + (cupBotY - 1.6) + ' Z';
    var lidH = cupH * 0.2;
    var lid = '<rect x="' + (cx - cupTopW / 2 - 1.6) + '" y="' + (cupTopY - lidH - 0.6) +
      '" width="' + (cupTopW + 3.2) + '" height="' + lidH + '" rx="' + (lidH / 2) +
      '" fill="#FFFFFF" opacity="0.95"/>';

    return '<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '">' +
      '<g opacity="' + opacity + '">' +
      '<path d="' + path + '" fill="' + color + '" stroke="' + edge + '" stroke-width="' + strokeW + '"/>' +
      '<path d="' + cup + '" fill="#FFFFFF" opacity="0.94"/>' +
      lid +
      '</g>' +
      (selected ? '<circle cx="' + cx + '" cy="' + cy + '" r="' + (r + 4) + '" fill="none" stroke="' + color + '" stroke-width="2" opacity="0.42"/>' : '') +
      '</svg>';
  }

  function radarSvg(dims) {
    var size = 210;
    var cx = size / 2;
    var cy = size / 2;
    var R = 62;
    var axes = [
      { key: 'taste', label: '味道', deg: -90 },
      { key: 'value', label: '性价比', deg: 0 },
      { key: 'service', label: '服务', deg: 90 },
      { key: 'ambience', label: '环境', deg: 180 }
    ];
    function point(deg, ratio) {
      var rad = deg * Math.PI / 180;
      return [cx + Math.cos(rad) * R * ratio, cy + Math.sin(rad) * R * ratio];
    }
    var rings = [0.25, 0.5, 0.75, 1].map(function (k) {
      var pts = axes.map(function (a) { return point(a.deg, k).join(','); }).join(' ');
      return '<polygon points="' + pts + '" fill="none" stroke="#E7DFD0" stroke-width="1"/>';
    }).join('');
    var spokes = axes.map(function (a) {
      var p = point(a.deg, 1);
      return '<line x1="' + cx + '" y1="' + cy + '" x2="' + p[0] + '" y2="' + p[1] + '" stroke="#E7DFD0"/>';
    }).join('');
    var pts = axes.map(function (a) {
      var v = dims[a.key];
      var ratio = (v === null || v === undefined) ? 0 : Math.max(0.04, Math.min(1, v / 10));
      return point(a.deg, ratio);
    });
    var poly = pts.map(function (p) { return p.join(','); }).join(' ');
    var dots = pts.map(function (p) {
      return '<circle cx="' + p[0] + '" cy="' + p[1] + '" r="3" fill="#E9B949" stroke="#2B2A26" stroke-width="1"/>';
    }).join('');
    var labels = axes.map(function (a) {
      var p = point(a.deg, 1.36);
      return '<text x="' + p[0] + '" y="' + p[1] + '" text-anchor="middle" dominant-baseline="middle" font-size="11" fill="#8B8478">' + a.label + '</text>';
    }).join('');
    return '<svg viewBox="0 0 ' + size + ' ' + size + '" role="img" aria-label="四维评分雷达图">' +
      rings + spokes +
      '<polygon points="' + poly + '" fill="rgba(233,185,73,0.32)" stroke="#E9B949" stroke-width="2" stroke-linejoin="round"/>' +
      dots + labels + '</svg>';
  }

  function avatarColor(name) {
    var palette = ['#C98A4B', '#5B7F5E', '#B5651D', '#8A94A6', '#C0392B', '#7E8F5A', '#A9743F', '#6F7F93'];
    var hash = 0;
    var s = String(name || '匿');
    for (var i = 0; i < s.length; i++) hash = (hash * 31 + s.charCodeAt(i)) % 9973;
    return palette[hash % palette.length];
  }

  /* ========================================================================
   * 7. 渲染：首屏 / 列表 / 图例
   * ====================================================================== */

  function renderHeroStats() {
    var s = globalStats();
    el('heroStats').innerHTML =
      '<span class="stat">已收录 <b>' + s.restaurants + '</b> 家</span>' +
      '<span class="stat">累计 <b>' + s.reviews + '</b> 条评价</span>' +
      '<span class="stat">全站平均 <b>' + (s.avg === null ? '—' : Core.fmtScore(s.avg)) + '</b> 分</span>';
  }

  function renderTierChips() {
    var total = state.restaurants.length;
    var html = '<button class="chip" type="button" data-tier="__all" aria-pressed="' + (ui.tiers.length === 0 ? 'true' : 'false') + '">全部 <span style="opacity:.6">' + total + '</span></button>';
    ALL_TIERS.forEach(function (t) {
      var count = state.restaurants.filter(function (r) { return tierKeyOf(r.id) === t.key; }).length;
      var pressed = ui.tiers.indexOf(t.key) >= 0 ? 'true' : 'false';
      html += '<button class="chip" type="button" data-tier="' + t.key + '" aria-pressed="' + pressed + '" title="' + esc(t.slogan) + '">' +
        '<span class="swatch" style="background:' + t.color + '"></span>' + esc(t.label) +
        ' <span style="opacity:.6">' + count + '</span></button>';
    });
    el('tierChips').innerHTML = html;
  }

  function renderLegend() {
    var html = ALL_TIERS.map(function (t) {
      var pressed = ui.tiers.indexOf(t.key) >= 0 ? 'true' : 'false';
      return '<button class="legend-item" type="button" data-legend="' + t.key + '" aria-pressed="' + pressed + '" title="点击筛选：' + esc(t.slogan) + '">' +
        '<span class="swatch" style="background:' + t.color + '"></span>' + esc(t.label) +
        '<span style="color:#A9A29A">' + esc(t.slogan) + '</span></button>';
    }).join('');
    el('mapLegend').innerHTML = html;
  }

  function cardHtml(r) {
    var agg = aggOf(r.id);
    var t = agg.tier || TIER_NONE;
    var isActive = r.id === ui.selectedId;
    var cls = 'card' + (isActive ? ' active' : '') + (r.closed ? ' is-closed' : '');
    var scoreTxt = agg.score === null ? '—' : Core.fmtScore(agg.score);
    var bars = DIMS.map(function (k) {
      var v = agg.dims[k];
      var pct = (v === null || v === undefined) ? 0 : Math.max(0, Math.min(100, v / 10 * 100));
      return '<span class="mini" title="' + DIM_LABEL[k] + ' ' + (v === null ? '—' : Core.fmtScore(v)) + '"><i style="width:' + pct.toFixed(1) + '%;background:' + t.color + '"></i></span>';
    }).join('');

    var tags = (r.tags || []).slice(0, 3).map(function (tag) {
      return '<span class="tag">' + esc(tag) + '</span>';
    }).join('');
    if (r.closed) tags += '<span class="tag tag-closed">已停业</span>';

    var needsLoc = r.needsLocation
      ? '<button class="needs-loc" type="button" data-locate="' + esc(r.id) + '">待定位，点此补坐标</button>'
      : '';

    return '<article class="' + cls + '" data-id="' + esc(r.id) + '" tabindex="0" role="button" aria-label="' + esc(r.name) + '">' +
      '<div class="card-top">' +
      badgeHtml(t) +
      '<div class="card-name">' + esc(r.name) + '</div>' +
      '<div class="card-score">' + scoreTxt + (agg.score === null ? '' : '<small>分</small>') + '</div>' +
      '</div>' +
      '<div class="card-meta">' +
      '<span>' + esc(r.category) + '</span><span class="sep">·</span>' +
      '<span>' + priceLabel(r) + '</span><span class="sep">·</span>' +
      '<span>' + agg.count + ' 条评价</span><span class="sep">·</span>' +
      '<span>距校区 ' + distanceText(r) + '</span>' +
      '</div>' +
      '<div class="mini-bars">' + bars + '</div>' +
      (tags || needsLoc ? '<div class="card-tags">' + tags + '</div>' : '') +
      needsLoc +
      '</article>';
  }

  function renderList() {
    var list = visibleRestaurants();
    var box = el('list');
    var frag = document.createDocumentFragment();

    list.forEach(function (r) {
      var wrap = document.createElement('div');
      wrap.innerHTML = cardHtml(r);
      frag.appendChild(wrap.firstChild);
    });
    box.innerHTML = '';
    box.appendChild(frag);

    var total = state.restaurants.length;
    el('listCount').innerHTML = list.length === total
      ? '共 <b>' + total + '</b> 家店'
      : '筛出 <b>' + list.length + '</b> / ' + total + ' 家';

    var empty = el('listEmpty');
    if (!list.length) {
      empty.hidden = false;
      empty.innerHTML = '<b>这里暂时没有店</b>换个关键词，或者点「添加餐厅」把新发现记下来。';
    } else {
      empty.hidden = true;
    }

    renderTierChips();
    renderLegend();
    renderHeroStats();
  }

  /** 只重刷卡片选中态，避免整列表重绘 */
  function markActiveCard() {
    var cards = el('list').querySelectorAll('.card');
    Array.prototype.forEach.call(cards, function (card) {
      if (card.getAttribute('data-id') === ui.selectedId) card.classList.add('active');
      else card.classList.remove('active');
    });
  }

  /* ========================================================================
   * 8. 地图控制
   * ====================================================================== */

  var MapCtl = {
    map: null,
    markers: null,
    labels: null,
    preview: null,
    styles: null,
    ready: false,

    init: function () {
      if (this.ready) return true;
      if (!window.TMap || typeof window.TMap.Map !== 'function') return false;
      try {
        this.map = new window.TMap.Map(el('map'), {
          center: new window.TMap.LatLng(CITY_CENTER.lat, CITY_CENTER.lng),
          zoom: CITY_ZOOM,
          viewMode: '2D'
        });

        this.styles = buildMarkerStyles();
        this.markers = new window.TMap.MultiMarker({
          map: this.map,
          styles: this.styles,
          geometries: []
        });
        this.markers.on('click', function (evt) {
          var id = evt && evt.geometry ? evt.geometry.id : null;
          if (id) openDetail(id);
        });

        this.labels = new window.TMap.MultiLabel({
          map: this.map,
          styles: { name: buildLabelStyle() },
          geometries: []
        });

        this.preview = new window.TMap.MultiMarker({
          map: this.map,
          styles: { pick: buildPickStyle() },
          geometries: []
        });

        this.map.on('click', function (evt) {
          if (ui.pickMode && evt && evt.latLng) handleMapPick(evt.latLng);
        });

        this.ready = true;
        this.sync();
        this.watchZoom();
        return true;
      } catch (err) {
        if (window.console && console.warn) console.warn('[Ginkgo] 地图初始化失败：', err);
        this.ready = false;
        return false;
      }
    },

    /** 重建全部 marker（按当前筛选结果） */
    sync: function () {
      if (!this.ready) return;
      var list = visibleRestaurants();
      var geoms = [];
      var TMap = window.TMap;
      list.forEach(function (r) {
        if (!isFinite(r.lat) || !isFinite(r.lng)) return;
        var agg = aggCache[r.id] || Core.aggregate([]);
        var t = agg.tier || TIER_NONE;
        var key = r.closed ? 'closed' : t.key;
        if (r.id === ui.selectedId) key = 'sel-' + (r.closed ? 'closed' : t.key);
        geoms.push({
          id: r.id,
          styleId: key,
          position: new TMap.LatLng(r.lat, r.lng)
        });
      });
      try {
        this.markers.setGeometries(geoms);
      } catch (e) {
        if (window.console && console.warn) console.warn('[Ginkgo] marker 更新失败', e);
      }
      this.renderLabels();
    },

    renderLabels: function () {
      if (!this.ready) return;
      var TMap = window.TMap;
      var zoom = 0;
      try { zoom = this.map.getZoom(); } catch (e) { zoom = 0; }
      var geoms = [];
      if (zoom >= LABEL_ZOOM) {
        visibleRestaurants().forEach(function (r) {
          if (!isFinite(r.lat) || !isFinite(r.lng)) return;
          geoms.push({
            id: 'lb-' + r.id,
            styleId: 'name',
            position: new TMap.LatLng(r.lat, r.lng),
            content: r.name
          });
        });
      }
      try {
        this.labels.setGeometries(geoms);
      } catch (e) { /* 忽略：label 只是锦上添花 */ }
    },

    watchZoom: function () {
      var self = this;
      if (labelTimer) window.clearInterval(labelTimer);
      labelTimer = window.setInterval(function () {
        if (!self.ready) return;
        var z = 0;
        try { z = self.map.getZoom(); } catch (e) { return; }
        if (z !== lastZoom) {
          lastZoom = z;
          self.renderLabels();
        }
      }, 350);
    },

    focus: function (lat, lng, zoom) {
      if (!this.ready) return;
      try {
        this.map.setCenter(new window.TMap.LatLng(lat, lng));
        if (zoom) this.map.setZoom(zoom);
      } catch (e) { /* 地图不可用时静默 */ }
    },

    zoomBy: function (delta) {
      if (!this.ready) return;
      try {
        this.map.setZoom(Math.max(3, Math.min(19, this.map.getZoom() + delta)));
      } catch (e) { /* 忽略 */ }
    },

    reset: function () {
      this.focus(CITY_CENTER.lat, CITY_CENTER.lng, CITY_ZOOM);
    },

    showPreview: function (lat, lng) {
      if (!this.ready) return;
      try {
        this.preview.setGeometries([{
          id: 'preview',
          styleId: 'pick',
          position: new window.TMap.LatLng(lat, lng)
        }]);
      } catch (e) { /* 忽略 */ }
    },

    clearPreview: function () {
      if (!this.ready) return;
      try { this.preview.setGeometries([]); } catch (e) { /* 忽略 */ }
    }
  };

  function buildMarkerStyles() {
    var TMap = window.TMap;
    var styles = {};
    ALL_TIERS.forEach(function (t) {
      [false, true].forEach(function (selected) {
        var svg = markerSvg(t, { selected: selected, closed: false });
        var w = Math.round((t.size + 22) * (selected ? 1.32 : 1));
        var h = Math.round(w * 1.3);
        var id = (selected ? 'sel-' : '') + t.key;
        styles[id] = new TMap.MarkerStyle({
          width: w,
          height: h,
          anchor: { x: w / 2, y: h - 2 },
          src: 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg)
        });
      });
    });
    // 已停业：统一用灰色小杯
    [false, true].forEach(function (selected) {
      var svg = markerSvg(TIER_NONE, { selected: selected, closed: true });
      var w = Math.round((TIER_NONE.size + 22) * (selected ? 1.32 : 1));
      var h = Math.round(w * 1.3);
      styles[(selected ? 'sel-' : '') + 'closed'] = new TMap.MarkerStyle({
        width: w,
        height: h,
        anchor: { x: w / 2, y: h - 2 },
        src: 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg)
      });
    });
    return styles;
  }

  function buildLabelStyle() {
    return new window.TMap.LabelStyle({
      color: '#2B2A26',
      size: 12,
      offset: { x: 0, y: 0 },
      angle: 0,
      alignment: 'center',
      verticalAlignment: 'middle',
      backgroundColor: '#FFFFFF',
      borderColor: '#E7DFD0',
      borderWidth: 1,
      padding: '4px 8px',
      borderRadius: 6
    });
  }

  function buildPickStyle() {
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="30" height="40" viewBox="0 0 30 40">' +
      '<path d="M15 38C15 38 28 24 28 14.5A13 13 0 1 0 2 14.5C2 24 15 38 15 38Z" fill="#2B2A26" stroke="#E9B949" stroke-width="2.5"/>' +
      '<circle cx="15" cy="14" r="4.5" fill="#E9B949"/></svg>';
    return new window.TMap.MarkerStyle({
      width: 30,
      height: 40,
      anchor: { x: 15, y: 38 },
      src: 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg)
    });
  }

  function showMapFallback() {
    el('mapFallback').hidden = false;
    el('mapControls').hidden = true;
    el('map').style.display = 'none';
  }

  function bootMap() {
    var started = Date.now();
    var timer = window.setInterval(function () {
      if (MapCtl.init()) {
        window.clearInterval(timer);
        el('mapFallback').hidden = true;
        el('mapControls').hidden = false;
        return;
      }
      if (Date.now() - started > 8000) {
        window.clearInterval(timer);
        showMapFallback();
      }
    }, 250);
  }

  /* ========================================================================
   * 9. 详情抽屉
   * ====================================================================== */

  function openDetail(id) {
    var r = getRestaurant(id);
    if (!r) return;
    ui.selectedId = id;
    renderDrawer(r);
    el('drawerScrim').hidden = false;
    el('drawer').hidden = false;
    markActiveCard();
    if (MapCtl.ready) {
      MapCtl.focus(r.lat, r.lng, Math.max(14, lastZoom || 14));
      MapCtl.sync();
    }
  }

  function closeDrawer() {
    el('drawer').hidden = true;
    el('drawerScrim').hidden = true;
    ui.selectedId = null;
    markActiveCard();
    if (MapCtl.ready) MapCtl.sync();
  }

  function renderDrawer(r) {
    var agg = aggOf(r.id);
    var t = agg.tier || TIER_NONE;
    var reviews = reviewsOf(r.id);
    var photos = [];
    reviews.forEach(function (rv) {
      (rv.photos || []).forEach(function (key) {
        if (photos.length < 12 && photos.indexOf(key) < 0) photos.push(key);
      });
    });

    var dimBars = DIMS.map(function (k) {
      var v = agg.dims[k];
      var pct = (v === null || v === undefined) ? 0 : Math.max(0, Math.min(100, v / 10 * 100));
      return '<div class="dim-row">' +
        '<div class="dim-top"><span>' + DIM_LABEL[k] + '</span><b>' + (v === null ? '—' : Core.fmtScore(v)) + '</b></div>' +
        '<div class="dim-track"><i style="width:' + pct.toFixed(1) + '%;background:' + t.color + '"></i></div>' +
        '</div>';
    }).join('');

    var photoWall = photos.length
      ? '<div class="photo-wall">' + photos.map(function (key) {
        return '<button class="ph" type="button" data-photo-key="' + esc(key) + '" data-open-photo="1" aria-label="查看大图"></button>';
      }).join('') + '</div>'
      : '<div class="field-hint">还没有照片，写评价时最多可以传 3 张。</div>';

    var reviewList = reviews.length ? reviews.map(reviewHtml).join('') : '<div class="field-hint">还没有人评价，做第一个吃的人吧。</div>';
    if (ui.isAdmin) {
      var gone = state.reviews.filter(function (rv) { return rv.deleted && rv.restaurantId === r.id; });
      if (gone.length) {
        reviewList += '<div class="d-section-title" style="margin-top:16px">已删除<span class="hint">仅管理员可见</span></div>' +
          gone.map(reviewHtml).join('');
      }
    }

    var recommendTxt = agg.recommendRate === null ? '—' : Math.round(agg.recommendRate * 100) + '%';

    el('drawerBody').innerHTML =
      '<div class="d-head">' +
        '<button class="icon-btn d-close" type="button" data-close-drawer aria-label="关闭">×</button>' +
        '<div class="d-title-row">' + badgeHtml(t, { large: true }) +
          '<h2 class="d-title">' + esc(r.name) + '</h2>' +
        '</div>' +
        '<p class="d-sub">' + esc(r.category) + '<span class="sep">·</span>' + priceLabel(r) +
          '<span class="sep">·</span>距校区 ' + distanceText(r) +
          (r.closed ? '<span class="sep">·</span><b style="color:var(--danger)">已停业</b>' : '') + '</p>' +
        '<div class="d-addr"><span class="addr-text">' + esc(r.address || '地址待补充') + '</span>' +
          '<button class="btn btn-sm btn-ghost" type="button" data-copy-addr>复制地址</button></div>' +
        '<div class="kpis">' +
          '<div class="kpi"><b style="color:' + (agg.score === null ? '#B9B2A4' : t.color) + '">' +
            (agg.score === null ? '—' : Core.fmtScore(agg.score)) + '</b><span>综合分</span></div>' +
          '<div class="kpi"><b>' + recommendTxt + '</b><span>推荐率</span></div>' +
          '<div class="kpi"><b>' + agg.count + '</b><span>评价数</span></div>' +
        '</div>' +
      '</div>' +

      '<div class="d-section">' +
        '<h3 class="d-section-title">四维评分<span class="hint">' + esc(t.slogan) + '</span></h3>' +
        (agg.count
          ? '<div class="radar-wrap">' + radarSvg(agg.dims) + '<div class="dim-bars">' + dimBars + '</div></div>'
          : '<div class="field-hint">还没有评价，暂无雷达图。第一个评价就能点亮它。</div>') +
      '</div>' +

      '<div class="d-section">' +
        '<h3 class="d-section-title">照片墙<span class="hint">' + (photos.length ? photos.length + ' 张' : '暂无') + '</span></h3>' +
        photoWall +
      '</div>' +

      '<div class="d-section">' +
        '<h3 class="d-section-title">评价<span class="hint">共 ' + reviews.length + ' 条</span></h3>' +
        reviewList +
      '</div>' +

      '<div class="d-actions">' +
        '<button class="btn btn-gold" type="button" data-detail-act="review">写评价</button>' +
        '<button class="btn" type="button" data-detail-act="share">分享这家店</button>' +
        '<button class="btn btn-ghost" type="button" data-detail-act="edit">编辑店铺</button>' +
        ((ui.isAdmin || (r.source === 'user' && r.owner && r.owner === state.meta.deviceId))
          ? '<button class="btn btn-ghost" type="button" data-detail-act="delete" style="color:var(--danger)">删除</button>'
          : '') +
      '</div>';

    hydratePhotos(el('drawerBody'));
  }

  function reviewHtml(rv) {
    var author = rv.author || '匿名社员';
    var initial = author.slice(0, 1);
    var scores = DIMS.map(function (k) {
      return '<span>' + DIM_LABEL[k] + ' <b>' + Core.fmtScore(rv.scores[k]) + '</b></span>';
    }).join('');
    var photos = (rv.photos || []).map(function (key) {
      return '<button class="ph" type="button" data-photo-key="' + esc(key) + '" data-open-photo="1" aria-label="查看大图"></button>';
    }).join('');
    return '<div class="review">' +
      '<div class="review-top">' +
        '<span class="avatar" style="background:' + avatarColor(author) + '">' + esc(initial) + '</span>' +
        '<div class="review-who"><b>' + esc(author) + '</b><span>' + relativeTime(rv.createdAt) + '</span></div>' +
        '<span class="verdict ' + (rv.verdict === 'recommend' ? 'up' : 'down') + '">' +
          (rv.verdict === 'recommend' ? '推荐' : '不推荐') + '</span>' +
      '</div>' +
      '<div class="review-scores">' + scores + '</div>' +
      (rv.text ? '<p class="review-text">' + esc(rv.text) + '</p>' : '') +
      (photos ? '<div class="review-photos">' + photos + '</div>' : '') +
      repliesHtml(rv) +
      '<div class="review-foot">' +
        (rv.deleted ? '' : '<button class="link-btn" type="button" data-reply="' + esc(rv.id) + '">回复</button>') +
        (rv.deleted
          ? (ui.isAdmin
            ? '<span class="del-badge">已删除</span><button class="link-btn" type="button" data-admin-restore="' + esc(rv.id) + '">恢复</button>'
            : '')
          : ((ui.isAdmin || (rv.source === 'user' && rv.owner && rv.owner === state.meta.deviceId))
            ? '<button class="link-btn" type="button" data-del-review="' + esc(rv.id) + '">删除</button>'
            : '')) +
      '</div>' +
      (rv.deleted ? '' :
        '<div class="reply-box" data-reply-box="' + esc(rv.id) + '" hidden>' +
          '<input type="text" maxlength="200" placeholder="回一句…（回车发送）" data-reply-input="' + esc(rv.id) + '" />' +
          '<button class="btn btn-gold btn-sm" type="button" data-reply-send="' + esc(rv.id) + '">发送</button>' +
        '</div>') +
      '</div>';
  }

  /** 一条评价下面的回复列表 */
  function repliesHtml(rv) {
    var list = rv.comments || [];
    if (!list.length) return '';
    return '<div class="review-replies">' + list.map(function (c) {
      return '<div class="cmt">' +
        '<span class="cmt-who">' + esc(c.author || '匿名社员') + '</span>' +
        '<span class="cmt-time">' + relativeTime(c.createdAt) + '</span>' +
        '<p>' + esc(c.text) + '</p>' +
        '</div>';
    }).join('') + '</div>';
  }

  /** 在别人的评价下面回一句 */
  function addReply(reviewId, text) {
    var t = String(text || '').trim();
    if (!t) return;
    var rv = null;
    for (var i = 0; i < state.reviews.length; i++) {
      if (state.reviews[i].id === reviewId) { rv = state.reviews[i]; break; }
    }
    if (!rv) return;
    rv.comments = rv.comments || [];
    rv.comments.push({
      id: Core.uid('c'),
      author: state.meta.nickname || '匿名社员',
      text: t.slice(0, 200),
      createdAt: nowIso(),
      owner: state.meta.deviceId || ''
    });
    rv.updatedAt = nowIso();
    state.meta.pendingSync = (state.meta.pendingSync || []).concat([rv.id]);
    saveState();
    var cur = getRestaurant(ui.selectedId);
    if (cur) renderDrawer(cur);
  }

  function shareText(r) {
    var agg = aggOf(r.id);
    var t = agg.tier || TIER_NONE;
    return '【Ginkgo 美食地图】' + r.name + ' · ' + t.label +
      (agg.score === null ? '（待评级）' : ' ' + Core.fmtScore(agg.score) + ' 分') + '\n' +
      '分类：' + r.category + '｜' + priceLabel(r) + '｜' + agg.count + ' 条评价\n' +
      '地址：' + (r.address || '待补充') + '\n' +
      '一句话：' + t.slogan + ' —— 电子科技大学 Ginkgo 烹饪社内部测评';
  }

  /* ========================================================================
   * 10. 弹层基础
   * ====================================================================== */

  function openModal(id) {
    var node = el(id);
    if (!node) return;
    node.hidden = false;
    document.body.style.overflow = 'hidden';
  }

  function closeModal(id) {
    var node = el(id);
    if (!node) return;
    node.hidden = true;
    if (!anyLayerOpen()) document.body.style.overflow = '';
  }

  function anyLayerOpen() {
    var ids = ['lightbox', 'confirmModal', 'modalReview', 'modalRestaurant', 'modalData', 'modalRanking', 'modalContrib', 'modalHelp'];
    for (var i = 0; i < ids.length; i++) {
      var node = el(ids[i]);
      if (node && !node.hidden) return true;
    }
    return false;
  }

  function closeTopLayer() {
    if (!el('lightbox').hidden) { el('lightbox').hidden = true; return true; }
    if (!el('confirmModal').hidden) { resolveConfirm(false); return true; }
    var modals = ['modalReview', 'modalRestaurant', 'modalData', 'modalRanking', 'modalContrib', 'modalHelp'];
    for (var i = 0; i < modals.length; i++) {
      if (!el(modals[i]).hidden) { closeModal(modals[i]); return true; }
    }
    if (!el('drawer').hidden) { closeDrawer(); return true; }
    return false;
  }

  function askConfirm(title, html, okText) {
    return new Promise(function (resolve) {
      el('confirmTitle').textContent = title;
      el('confirmBody').innerHTML = html;
      el('confirmOk').textContent = okText || '确认';
      confirmResolver = resolve;
      openModal('confirmModal');
    });
  }

  function resolveConfirm(value) {
    closeModal('confirmModal');
    if (confirmResolver) {
      var fn = confirmResolver;
      confirmResolver = null;
      fn(value);
    }
  }

  function openLightbox(url) {
    if (!url) { toast('这张图片已经找不到了', 'warn'); return; }
    el('lightboxImg').src = url;
    el('lightbox').hidden = false;
    document.body.style.overflow = 'hidden';
  }

  /* ========================================================================
   * 11. 写评价
   * ====================================================================== */

  function openReviewModal(restaurantId) {
    var rid = restaurantId || ui.selectedId || (state.restaurants[0] ? state.restaurants[0].id : '');
    if (!state.restaurants.length) {
      toast('先添加一家店，再来写评价吧', 'warn');
      return;
    }
    ui.reviewDraft = {
      restaurantId: rid,
      scores: { taste: 7, value: 7, service: 7, ambience: 7 },
      verdict: 'recommend',
      author: state.meta.nickname || '',
      text: '',
      photos: [],
      error: ''
    };
    renderReviewForm();
    openModal('modalReview');
  }

  function renderReviewForm() {
    var d = ui.reviewDraft;
    var options = state.restaurants.map(function (r) {
      return '<option value="' + esc(r.id) + '"' + (r.id === d.restaurantId ? ' selected' : '') + '>' + esc(r.name) + '</option>';
    }).join('');

    var sliders = DIMS.map(function (k) {
      return '<div class="slider-row">' +
        '<span class="slider-name">' + DIM_LABEL[k] + '</span>' +
        '<input type="range" min="0" max="10" step="0.5" value="' + d.scores[k] + '" data-dim="' + k + '" aria-label="' + DIM_LABEL[k] + '">' +
        '<output data-out="' + k + '">' + Number(d.scores[k]).toFixed(1) + '</output>' +
        '</div>';
    }).join('');

    var thumbs = d.photos.map(function (p, i) {
      return '<span class="thumb" style="background-image:url(\'' + p.url + '\')">' +
        '<button type="button" data-rm-photo="' + i + '" aria-label="删除照片">×</button></span>';
    }).join('');

    el('reviewBody').innerHTML =
      '<div class="field">' +
        '<label for="reviewRestaurant">评价哪家店</label>' +
        '<select id="reviewRestaurant">' + options + '</select>' +
      '</div>' +
      '<div class="preview-strip" id="reviewPreview"></div>' +
      '<div class="field">' + sliders + '<div class="field-hint">四项都是 0–10 分，步进 0.5；拖动后实时预测杯型。</div></div>' +
      '<div class="field">' +
        '<label>你的判断</label>' +
        '<div class="seg" id="verdictSeg">' +
          '<button type="button" data-verdict="recommend" aria-pressed="' + (d.verdict === 'recommend') + '">推荐</button>' +
          '<button type="button" data-verdict="not_recommend" aria-pressed="' + (d.verdict === 'not_recommend') + '">不推荐</button>' +
        '</div>' +
      '</div>' +
      '<div class="field">' +
        '<label for="reviewAuthor">昵称</label>' +
        '<input type="text" id="reviewAuthor" maxlength="20" value="' + esc(d.author) + '" placeholder="匿名社员" />' +
        '<div class="field-hint">填了昵称才会计入贡献榜；不填就显示「匿名社员」</div>' +
      '</div>' +
      '<div class="field">' +
        '<label for="reviewText">写点什么 <span class="req">*</span></label>' +
        '<textarea id="reviewText" maxlength="500" placeholder="比如：二楼阿姨手不抖，八块钱两荤一素，赶早八前来一份刚好。">' + esc(d.text) + '</textarea>' +
        '<div class="field-hint"><span id="reviewCount">' + d.text.length + '</span> / 500 · 至少 5 个字</div>' +
      '</div>' +
      '<div class="field">' +
        '<label>照片（最多 2 张，自动压缩）</label>' +
        '<div class="dropzone" id="dropzone">' +
          '<div>把图片拖到这里，或 <b>点击选择</b></div>' +
          '<div class="field-hint">会自动同步给所有人，别拍同学正脸；每张压到 200KB 以内</div>' +
          '<input type="file" id="photoInput" accept="image/*" multiple />' +
        '</div>' +
        '<div class="thumbs" id="photoThumbs">' + thumbs + '</div>' +
      '</div>' +
      '<div class="field-err" id="reviewError" hidden></div>';

    bindReviewForm();
    updateReviewPreview();
  }

  function bindReviewForm() {
    var d = ui.reviewDraft;

    var select = el('reviewRestaurant');
    if (select) select.addEventListener('change', function () {
      d.restaurantId = select.value;
      updateReviewPreview();
    });

    Array.prototype.forEach.call(document.querySelectorAll('#reviewBody input[type="range"]'), function (input) {
      input.addEventListener('input', function () {
        var dim = input.getAttribute('data-dim');
        var val = Number(input.value);
        d.scores[dim] = val;
        var out = document.querySelector('#reviewBody output[data-out="' + dim + '"]');
        if (out) out.textContent = val.toFixed(1);
        updateReviewPreview();
      });
    });

    var seg = el('verdictSeg');
    if (seg) seg.addEventListener('click', function (evt) {
      var btn = closestOf(evt.target, 'button[data-verdict]');
      if (!btn) return;
      d.verdict = btn.getAttribute('data-verdict');
      Array.prototype.forEach.call(seg.querySelectorAll('button'), function (b) {
        b.setAttribute('aria-pressed', b === btn ? 'true' : 'false');
      });
      updateReviewPreview();
    });

    var author = el('reviewAuthor');
    if (author) author.addEventListener('input', function () { d.author = author.value; });

    var text = el('reviewText');
    if (text) text.addEventListener('input', function () {
      d.text = text.value;
      var counter = el('reviewCount');
      if (counter) counter.textContent = String(text.value.length);
    });

    var zone = el('dropzone');
    var input = el('photoInput');
    if (zone && input) {
      zone.addEventListener('click', function () { input.click(); });
      input.addEventListener('change', function () {
        handlePhotoFiles(input.files);
        input.value = '';
      });
      ['dragenter', 'dragover'].forEach(function (name) {
        zone.addEventListener(name, function (e) { e.preventDefault(); zone.classList.add('over'); });
      });
      ['dragleave', 'drop'].forEach(function (name) {
        zone.addEventListener(name, function (e) { e.preventDefault(); zone.classList.remove('over'); });
      });
      zone.addEventListener('drop', function (e) {
        if (e.dataTransfer && e.dataTransfer.files) handlePhotoFiles(e.dataTransfer.files);
      });
    }

    var thumbs = el('photoThumbs');
    if (thumbs) thumbs.addEventListener('click', function (evt) {
      var btn = closestOf(evt.target, 'button[data-rm-photo]');
      if (!btn) return;
      var idx = Number(btn.getAttribute('data-rm-photo'));
      var item = d.photos[idx];
      if (item) {
        if (item.url) URL.revokeObjectURL(item.url);
        d.photos.splice(idx, 1);
      }
      renderReviewForm();
    });
  }

  function handlePhotoFiles(fileList) {
    var d = ui.reviewDraft;
    if (!d) return;
    var files = Array.prototype.slice.call(fileList || []).filter(function (f) {
      return f && f.type && f.type.indexOf('image/') === 0;
    });
    if (!files.length) { toast('只能上传图片文件', 'warn'); return; }
    var room = 2 - d.photos.length;
    if (room <= 0) { toast('每条评价最多 2 张照片', 'warn'); return; }
    files = files.slice(0, room);

    files.reduce(function (chain, file) {
      return chain.then(function () {
        return compressImage(file).then(function (blob) {
          if (!blob) { toast('有一张图片压缩失败，已跳过', 'warn'); return; }
          var key = Core.uid('photo');
          return PhotoDB.put(key, blob).then(function () {
            d.photos.push({ key: key, url: URL.createObjectURL(blob), size: blob.size });
            renderReviewForm();
          });
        }).catch(function () {
          toast('图片处理失败，试试换一张', 'error');
        });
      });
    }, Promise.resolve());
  }

  function updateReviewPreview() {
    var d = ui.reviewDraft;
    if (!d) return;
    var box = el('reviewPreview');
    if (!box) return;
    var self = Core.overall(d.scores);
    var existing = liveReviews().filter(function (rv) { return rv.restaurantId === d.restaurantId; });
    var before = Core.aggregate(existing, null);
    var after = Core.aggregate(existing.concat([{ scores: d.scores, verdict: d.verdict }]), null);
    var afterTier = after.tier || TIER_NONE;
    var beforeTier = before.tier || TIER_NONE;
    box.innerHTML =
      '<span class="lbl">本条总分</span><b>' + (self === null ? '—' : Core.fmtScore(self)) + '</b>' +
      '<span class="lbl">这家店现在</span>' + badgeHtml(beforeTier) +
      '<span class="lbl">→ 加上这条</span>' + badgeHtml(afterTier) +
      '<span class="lbl">预测综合分</span><b>' + (after.score === null ? '—' : Core.fmtScore(after.score)) + '</b>';
  }

  function submitReview() {
    var d = ui.reviewDraft;
    if (!d) return;
    var errBox = el('reviewError');
    var errors = [];

    DIMS.forEach(function (k) {
      var v = d.scores[k];
      if (typeof v !== 'number' || !isFinite(v) || v < 0 || v > 10) errors.push(DIM_LABEL[k] + ' 分数无效');
    });
    var text = (d.text || '').trim();
    if (text.length < 5) errors.push('正文至少写 5 个字');
    if (text.length > 500) errors.push('正文最多 500 字');
    if (!getRestaurant(d.restaurantId)) errors.push('请选择要评价的店铺');

    if (errors.length) {
      if (errBox) {
        errBox.hidden = false;
        errBox.textContent = errors.join('；');
      }
      return;
    }
    if (errBox) errBox.hidden = true;

    var author = (d.author || '').trim() || '匿名社员';
    var stamp = nowIso();
    var review = {
      id: Core.uid('rv'),
      restaurantId: d.restaurantId,
      author: author.slice(0, 20),
      scores: {
        taste: d.scores.taste,
        value: d.scores.value,
        service: d.scores.service,
        ambience: d.scores.ambience
      },
      verdict: d.verdict === 'not_recommend' ? 'not_recommend' : 'recommend',
      text: text,
      photos: d.photos.map(function (p) { return p.key; }),
      comments: [],
      deleted: false,
      owner: state.meta.deviceId || '',
      createdAt: stamp,
      updatedAt: stamp,
      source: 'user'
    };

    state.reviews.unshift(review);
    state.meta.nickname = review.author;
    state.meta.pendingSync = (state.meta.pendingSync || []).concat([review.id]);

    saveState();
    rebuildAggregates();
    renderList();
    if (MapCtl.ready) MapCtl.sync();

    var agg = aggOf(review.restaurantId);
    var t = agg.tier || TIER_NONE;
    closeModal('modalReview');
    ui.reviewDraft = null;
    toast('评价已记录，店铺杯型更新为「' + t.label + '」');

    var r = getRestaurant(review.restaurantId);
    if (r) openDetail(r.id);
  }

  /* ========================================================================
   * 12. 添加 / 编辑店铺
   * ====================================================================== */

  function openRestaurantModal(id) {
    var existing = id ? getRestaurant(id) : null;
    ui.restDraft = existing
      ? {
        id: existing.id,
        name: existing.name,
        category: existing.category,
        price: existing.price,
        priceLevel: existing.priceLevel,
        address: existing.address,
        lat: existing.lat,
        lng: existing.lng,
        tags: (existing.tags || []).join('、'),
        closed: existing.closed
      }
      : {
        id: null,
        name: '',
        category: '小吃',
        price: 25,
        priceLevel: 2,
        address: '',
        lat: CAMPUS.lat,
        lng: CAMPUS.lng,
        tags: '',
        closed: false
      };
    renderRestaurantForm();
    el('restTitle').textContent = existing ? '编辑店铺' : '添加餐厅';
    openModal('modalRestaurant');
  }

  function renderRestaurantForm() {
    var d = ui.restDraft;
    var catOptions = CATEGORIES.map(function (c) {
      return '<option value="' + c + '"' + (c === d.category ? ' selected' : '') + '>' + c + '</option>';
    }).join('');

    el('restBody').innerHTML =
      '<div class="field">' +
        '<label for="restSearch">先搜店名，直接定位 <span class="field-hint">（不用再填经纬度）</span></label>' +
        '<div class="search-row">' +
          '<input type="text" id="restSearch" maxlength="60" autocomplete="off" placeholder="aq羊肉串 / 海吃牛鲜 / 建设路" />' +
          '<button class="btn btn-ink btn-sm" type="button" id="btnRestSearch">搜索</button>' +
        '</div>' +
        '<div class="place-hint" id="restSearchHint">腾讯地图上有的店会直接列出候选；同名店多家会让你选；查不到就输入路名（如「建设路」），地图会跳过去让你点选门口位置。</div>' +
        '<div class="place-list" id="restCandidates" hidden></div>' +
      '</div>' +
      '<div class="field">' +
        '<label for="restName">店名 <span class="req">*</span></label>' +
        '<input type="text" id="restName" maxlength="40" value="' + esc(d.name) + '" placeholder="比如：钟水饺(建设路店)" />' +
      '</div>' +
      '<div class="field-row">' +
        '<div class="field"><label for="restCategory">分类</label><select id="restCategory">' + catOptions + '</select></div>' +
        '<div class="field"><label for="restPrice">人均消费（元）</label>' +
          '<input type="number" id="restPrice" min="0" max="5000" step="1" value="' + (d.price > 0 ? d.price : '') + '" placeholder="比如 35" />' +
          '<div class="price-presets">' +
            PRICE_PRESETS.map(function (p) {
              return '<button type="button" class="price-chip' + (Number(d.price) === p.v ? ' is-on' : '') + '" data-price="' + p.v + '">' + p.label + '</button>';
            }).join('') +
          '</div>' +
        '</div>' +
      '</div>' +
      '<div class="field">' +
        '<label for="restAddress">地址</label>' +
        '<input type="text" id="restAddress" maxlength="80" value="' + esc(d.address) + '" placeholder="比如：建设路 53 号" />' +
      '</div>' +
      '<div class="row-btns" style="margin-bottom:10px">' +
        '<button class="btn btn-sm" type="button" id="btnPickOnMap">在地图上点选位置</button>' +
        '<span class="field-hint" style="align-self:center" id="restCoordTip">坐标：' + Number(d.lat).toFixed(6) + ', ' + Number(d.lng).toFixed(6) + '</span>' +
      '</div>' +
      '<details class="adv-coords">' +
        '<summary>手动填经纬度（一般用不到）</summary>' +
        '<div class="field-row">' +
          '<div class="field"><label for="restLat">纬度 lat</label><input type="text" id="restLat" value="' + Number(d.lat).toFixed(6) + '" /></div>' +
          '<div class="field"><label for="restLng">经度 lng</label><input type="text" id="restLng" value="' + Number(d.lng).toFixed(6) + '" /></div>' +
        '</div>' +
      '</details>' +
      '<div class="field">' +
        '<label for="restTags">标签（用顿号或逗号分隔）</label>' +
        '<input type="text" id="restTags" maxlength="80" value="' + esc(d.tags) + '" placeholder="比如：手工水饺、人均 15 元、必吃" />' +
      '</div>' +
      '<div class="field">' +
        '<label><input type="checkbox" id="restClosed"' + (d.closed ? ' checked' : '') + ' /> 已停业（地图上显示为灰色）</label>' +
      '</div>' +
      '<div class="field-err" id="restError" hidden></div>';

    bindRestaurantForm();
  }

  function bindRestaurantForm() {
    var d = ui.restDraft;
    function bind(id, key, transform) {
      var node = el(id);
      if (!node) return;
      node.addEventListener('input', function () {
        d[key] = transform ? transform(node.value) : node.value;
      });
      node.addEventListener('change', function () {
        d[key] = transform ? transform(node.value) : node.value;
      });
    }
    bind('restName', 'name');
    bind('restCategory', 'category');
    bind('restPrice', 'price', function (v) {
      var n = Number(v);
      return (isFinite(n) && n > 0) ? Math.min(5000, Math.round(n)) : 0;
    });
    bind('restAddress', 'address');
    bind('restTags', 'tags');
    bind('restLat', 'lat', function (v) { var n = Number(v); return isFinite(n) ? n : d.lat; });
    bind('restLng', 'lng', function (v) { var n = Number(v); return isFinite(n) ? n : d.lng; });
    var closed = el('restClosed');
    if (closed) closed.addEventListener('change', function () { d.closed = closed.checked; });

    var presetWrap = document.querySelector('.price-presets');
    if (presetWrap) {
      presetWrap.addEventListener('click', function (evt) {
        var btn = evt.target && evt.target.closest ? evt.target.closest('[data-price]') : null;
        if (!btn) return;
        var v = Number(btn.getAttribute('data-price'));
        d.price = v;
        if (el('restPrice')) el('restPrice').value = v;
        var chips = presetWrap.querySelectorAll('[data-price]');
        for (var i = 0; i < chips.length; i++) {
          chips[i].classList.toggle('is-on', Number(chips[i].getAttribute('data-price')) === v);
        }
      });
    }

    var pick = el('btnPickOnMap');
    if (pick) pick.addEventListener('click', startPickMode);

    // 地点搜索：边打边给候选，回车或点「搜索」时对唯一结果直接选定
    var searchInput = el('restSearch');
    var searchTimer = 0;
    function runSearch(autoPick) {
      var kw = searchInput ? searchInput.value.trim() : '';
      if (!kw) { setPlaceHint('先输入店名或路名', 'warn'); return; }
      doPlaceSearch(kw, autoPick === true);
    }
    if (searchInput) {
      searchInput.addEventListener('input', function () {
        if (searchTimer) window.clearTimeout(searchTimer);
        searchTimer = window.setTimeout(function () { runSearch(false); }, 420);
      });
      searchInput.addEventListener('keydown', function (evt) {
        if (evt.key === 'Enter') {
          evt.preventDefault();
          if (searchTimer) window.clearTimeout(searchTimer);
          runSearch(true);
        } else if (evt.key === 'Escape' && el('restCandidates') && !el('restCandidates').hidden) {
          evt.stopPropagation();
          closeCandidates();
        }
      });
    }
    var btnSearch = el('btnRestSearch');
    if (btnSearch) btnSearch.addEventListener('click', function () { runSearch(true); });

    var candBox = el('restCandidates');
    if (candBox) {
      candBox.addEventListener('click', function (evt) {
        var node = evt.target && evt.target.closest ? evt.target.closest('.place-item') : null;
        if (!node) return;
        applyPlaceCandidate(Number(node.getAttribute('data-idx')));
      });
    }
  }

  /* ======================================================================
   * 12.1 地点搜索：Suggestion（联想）→ Search（城市检索）→ Geocoder（路名解析）
   *      全走 TMap.service，由 SDK 内部代理，不手工拼 serviceHost
   * ====================================================================== */

  var placeSearchToken = 0;

  function setPlaceHint(text, kind) {
    var node = el('restSearchHint');
    if (!node) return;
    node.className = 'place-hint' + (kind ? ' is-' + kind : '');
    node.textContent = text;
  }

  function closeCandidates() {
    var box = el('restCandidates');
    if (box) { box.hidden = true; box.innerHTML = ''; }
    ui.placeCandidates = [];
  }

  function mapServiceReady() {
    return !!(MapCtl.ready && window.TMap && TMap.service && TMap.LatLng);
  }

  function syncFormFromDraft() {
    var d = ui.restDraft;
    if (!d) return;
    if (el('restName')) el('restName').value = d.name || '';
    if (el('restAddress')) el('restAddress').value = d.address || '';
    if (el('restLat')) el('restLat').value = Number(d.lat).toFixed(6);
    if (el('restLng')) el('restLng').value = Number(d.lng).toFixed(6);
    var tip = el('restCoordTip');
    if (tip) tip.textContent = '坐标：' + Number(d.lat).toFixed(6) + ', ' + Number(d.lng).toFixed(6);
  }

  function doPlaceSearch(keyword, autoPick) {
    var kw = String(keyword || '').trim();
    if (!kw) return;
    if (!mapServiceReady()) {
      setPlaceHint('地图服务还没加载好，暂时搜不了。可以先填地址，再点「在地图上点选位置」。', 'warn');
      return;
    }
    var token = ++placeSearchToken;

    // 「建设路」「玉林四巷 3 号」这类纯地址：直接解析坐标跳过去，不用先列一堆 POI
    if (PURE_ADDRESS.test(kw)) {
      closeCandidates();
      setPlaceHint('正在定位「' + kw + '」…');
      geocodeAddress(kw, token);
      return;
    }

    setPlaceHint('正在搜索「' + kw + '」…');

    var suggestion = new TMap.service.Suggestion({ pageSize: 10, region: '成都市', regionFix: false });
    suggestion.getSuggestions({ keyword: kw, addressFormat: 'short' })
      .then(function (res) {
        if (token !== placeSearchToken) return null;
        var list = (res && res.data) || [];
        if (list.length) { showCandidates(list, kw, autoPick); return null; }
        return searchByRegion(kw, token, autoPick);
      })
      .catch(function () {
        if (token !== placeSearchToken) return null;
        return searchByRegion(kw, token, autoPick);
      });
  }

  function searchByRegion(kw, token, autoPick) {
    var search = new TMap.service.Search({ pageSize: 10 });
    return search.searchRegion({
      keyword: kw,
      cityName: '成都市',
      autoExtend: true,
      referenceLocation: new TMap.LatLng(CAMPUS.lat, CAMPUS.lng)
    }).then(function (res) {
      if (token !== placeSearchToken) return;
      var list = (res && res.data) || [];
      if (list.length) { showCandidates(list, kw, autoPick); return; }
      return geocodeAddress(kw, token);
    }).catch(function () {
      if (token === placeSearchToken) return geocodeAddress(kw, token);
    });
  }

  /** 像地址的关键词才做解析，避免"随便一个店名"把地图带偏 */
  var ADDRESS_LIKE = /(路|街|巷|道|弄|号|区|县|镇|村|广场|大厦|中心|小区|大学|学院|学校|医院|公园|商场|市场|地铁|车站|附近|门口)/;
  /** 纯地址（整串就是一个路名/门牌）：直接解析坐标并跳过去，不列候选 */
  var PURE_ADDRESS = /^[\u4e00-\u9fa5A-Za-z0-9·\s]{1,14}(路|街|巷|道|大道|大街|广场|小区|大厦|弄|号)(\d+号?)?$/;

  /** 地图上没有这家店：把「xx路」解析成坐标，跳到那条路让用户自己点门口 */
  function geocodeAddress(kw, token) {
    if (!ADDRESS_LIKE.test(kw)) {
      closeCandidates();
      setPlaceHint('腾讯地图上没有「' + kw + '」这家店，所以地图不动。' +
        '想定位的话，补一个地址（比如「' + kw + ' 建设路」），或者直接点「在地图上点选位置」手动落点。', 'warn');
      return Promise.resolve();
    }
    var geo = new TMap.service.Geocoder();
    // 必须带城市：裸路名会被解析到同名外地（如「玉林四巷」→ 广西玉林）
    var query = /成都/.test(kw) ? kw : '成都市' + kw;
    return geo.getLocation({ address: query }).then(function (res) {
      if (token !== placeSearchToken) return;
      var r = res && res.result;
      if (!r || !r.location || !isFinite(Number(r.location.lat))) {
        setPlaceHint('没搜到「' + kw + '」。换个说法，或直接点「在地图上点选位置」。', 'err');
        return;
      }
      var lat = Number(r.location.lat);
      var lng = Number(r.location.lng);
      var isRoad = PURE_ADDRESS.test(kw);
      var comp = r.address_components || {};
      var addrText = [comp.city, comp.district, comp.street, comp.street_number]
        .filter(Boolean).join('') || r.title || kw;

      closeCandidates();
      ui.restDraft.lat = lat;
      ui.restDraft.lng = lng;
      if (!ui.restDraft.address) ui.restDraft.address = addrText;
      // 纯路名只用来定位，不能当成店名（否则会存出一家叫"建设路"的店）
      if (!isRoad && !ui.restDraft.name) ui.restDraft.name = kw;
      syncFormFromDraft();
      MapCtl.focus(lat, lng, 16);
      MapCtl.showPreview(lat, lng);

      var sure = (typeof r.reliability === 'number' && r.reliability >= 7);
      if (isRoad) {
        setPlaceHint('已定位到「' + (r.title || kw) + '」，坐标 ' + lat.toFixed(6) + ', ' + lng.toFixed(6) + '。' +
          '补上店名就能保存；要精确到门口就点「在地图上点选位置」再点一下。', 'ok');
      } else {
        setPlaceHint('腾讯地图上没有「' + kw + '」这家店，已跳到「' + (r.title || kw) + '」' +
          (sure ? '，定位比较可信' : '，但定位可能不准') +
          '。确认位置后补上店名保存，必要时点「在地图上点选位置」精确到门口。', 'warn');
      }
    }).catch(function () {
      if (token !== placeSearchToken) return;
      setPlaceHint('搜索失败了，可能是网络或地图服务未就绪。可以手填地址，再点「在地图上点选位置」。', 'err');
    });
  }

  function showCandidates(list, kw, autoPick) {
    var items = list.slice(0, 10).map(function (p) {
      return {
        id: p.id || '',
        title: p.title || '',
        address: p.address || '',
        lat: p.location ? Number(p.location.lat) : NaN,
        lng: p.location ? Number(p.location.lng) : NaN,
        distance: typeof p._distance === 'number' ? p._distance : null
      };
    }).filter(function (p) { return isFinite(p.lat) && isFinite(p.lng); });

    if (!items.length) {
      setPlaceHint('结果里没有带坐标的地点，换个关键词试试。', 'warn');
      return;
    }
    ui.placeCandidates = items;

    var box = el('restCandidates');
    if (box) {
      box.hidden = false;
      box.innerHTML = items.map(function (p, i) {
        var dist = '';
        if (p.distance != null) {
          dist = p.distance >= 1000 ? (p.distance / 1000).toFixed(1) + ' km' : Math.round(p.distance) + ' m';
        }
        return '<button type="button" class="place-item" data-idx="' + i + '">' +
          '<span class="pi-dist">' + esc(dist) + '</span>' +
          '<div class="pi-title">' + esc(p.title) + '</div>' +
          '<div class="pi-sub">' + esc(p.address) + '</div>' +
          '</button>';
      }).join('');
    }

    var exact = [];
    items.forEach(function (p) { if (p.title === kw) exact.push(p); });

    // 只有一条结果、且关键词够具体：直接选定，就是"输入店名就指向那家"
    if (items.length === 1 && (autoPick || kw.length >= 4)) {
      applyPlaceCandidate(0);
      return;
    }
    if (autoPick && exact.length === 1) {
      applyPlaceCandidate(items.indexOf(exact[0]));
      return;
    }
    if (items.length === 1) {
      setPlaceHint('找到 1 个结果，按回车或点一下采用。', '');
    } else if (exact.length === 1) {
      setPlaceHint('找到 ' + items.length + ' 个结果，其中「' + kw + '」完全同名。按回车直接选它，或点上面某一条。', '');
    } else {
      setPlaceHint('找到 ' + items.length + ' 个结果，同名店有多家，请看地址选一个。', 'warn');
    }
  }

  function applyPlaceCandidate(idx) {
    var p = (ui.placeCandidates || [])[idx];
    if (!p || !ui.restDraft) return;
    var d = ui.restDraft;
    d.lat = p.lat;
    d.lng = p.lng;
    if (p.title) d.name = p.title;
    if (p.address) d.address = p.address;
    syncFormFromDraft();

    var box = el('restCandidates');
    if (box) {
      var nodes = box.querySelectorAll('.place-item');
      for (var i = 0; i < nodes.length; i++) {
        if (i === idx) nodes[i].classList.add('is-active');
        else nodes[i].classList.remove('is-active');
      }
    }
    MapCtl.focus(p.lat, p.lng, 17);
    MapCtl.showPreview(p.lat, p.lng);
    setPlaceHint('已选中「' + p.title + '」→ ' + p.address + '，坐标 ' + p.lat.toFixed(6) + ', ' + p.lng.toFixed(6) + '。' +
      (ui.placeCandidates.length > 1 ? '如果不是这家，点上面另一条。' : '确认无误就可以保存。'), 'ok');
  }

  function startPickMode() {
    if (!MapCtl.ready) {
      toast('地图没有加载成功，暂时不能点选，请手动填经纬度', 'warn');
      return;
    }
    if (ui.restDraft) readRestFormValues();
    closeModal('modalRestaurant');
    ui.pickMode = true;
    el('mapPickTip').hidden = false;
    el('map').classList.add('map-crosshair');
    MapCtl.clearPreview();
    if (ui.restDraft) {
      MapCtl.focus(ui.restDraft.lat, ui.restDraft.lng, Math.max(14, lastZoom || 14));
      MapCtl.showPreview(ui.restDraft.lat, ui.restDraft.lng);
    }
  }

  function readRestFormValues() {
    var map = {
      restName: 'name',
      restCategory: 'category',
      restAddress: 'address',
      restTags: 'tags'
    };
    Object.keys(map).forEach(function (id) {
      var node = el(id);
      if (node) ui.restDraft[map[id]] = node.value;
    });
    var price = el('restPrice');
    if (price) {
      var pv = Number(price.value);
      ui.restDraft.price = (isFinite(pv) && pv > 0) ? Math.min(5000, Math.round(pv)) : 0;
    }
    var lat = el('restLat');
    if (lat) { var la = Number(lat.value); if (isFinite(la)) ui.restDraft.lat = la; }
    var lng = el('restLng');
    if (lng) { var ln = Number(lng.value); if (isFinite(ln)) ui.restDraft.lng = ln; }
    var closed = el('restClosed');
    if (closed) ui.restDraft.closed = closed.checked;
  }

  function stopPickMode() {
    ui.pickMode = false;
    el('mapPickTip').hidden = true;
    el('map').classList.remove('map-crosshair');
  }

  function handleMapPick(latLng) {
    if (!ui.restDraft) return;
    ui.restDraft.lat = Number(latLng.lat);
    ui.restDraft.lng = Number(latLng.lng);
    MapCtl.showPreview(ui.restDraft.lat, ui.restDraft.lng);
    stopPickMode();
    renderRestaurantForm();
    openModal('modalRestaurant');
    toast('已回填坐标，记得保存店铺');
  }

  function submitRestaurant() {
    var d = ui.restDraft;
    if (!d) return;
    readRestFormValues();
    var errBox = el('restError');
    var errors = [];
    if (!d.name || !d.name.trim()) errors.push('店名不能为空');
    var lat = Number(d.lat);
    var lng = Number(d.lng);
    if (!isFinite(lat) || lat < 3 || lat > 54) errors.push('纬度需要在 3–54 之间');
    if (!isFinite(lng) || lng < 73 || lng > 136) errors.push('经度需要在 73–136 之间');

    if (errors.length) {
      if (errBox) { errBox.hidden = false; errBox.textContent = errors.join('；'); }
      return;
    }
    if (errBox) errBox.hidden = true;

    var tags = String(d.tags || '').split(/[、,，;；]+/).map(function (t) { return t.trim(); })
      .filter(Boolean).slice(0, 8);

    if (d.id) {
      var target = getRestaurant(d.id);
      if (target) {
        target.name = d.name.trim();
        target.category = d.category;
        target.price = d.price;
        target.priceLevel = priceToLevel(d.price);
        target.address = d.address.trim();
        target.lat = lat;
        target.lng = lng;
        target.tags = tags;
        target.closed = !!d.closed;
        target.needsLocation = false;
      }
    } else {
      var created = {
        id: Core.uid('r'),
        name: d.name.trim(),
        category: d.category,
        price: d.price,
        priceLevel: priceToLevel(d.price),
        address: d.address.trim(),
        lat: lat,
        lng: lng,
        tags: tags,
        closed: !!d.closed,
        deleted: false,
        owner: state.meta.deviceId || '',
        source: 'user',
        needsLocation: false,
        createdAt: nowIso(),
        createdBy: state.meta.nickname || '社员'
      };
      state.restaurants.push(created);
      d.id = created.id;
    }

    // 新店/改过的店都要进待上传队列，否则云端只收到评价、收不到店铺
    if (d.id) {
      state.meta.pendingRestaurants = state.meta.pendingRestaurants || [];
      if (state.meta.pendingRestaurants.indexOf(d.id) < 0) state.meta.pendingRestaurants.push(d.id);
    }

    saveState();
    rebuildAggregates();
    renderList();
    if (MapCtl.ready) {
      MapCtl.sync();
      MapCtl.focus(lat, lng, Math.max(15, lastZoom || 15));
    }
    closeModal('modalRestaurant');
    MapCtl.clearPreview();
    stopPickMode();
    toast(d.id ? '店铺已保存' : '店铺已添加');
    ui.restDraft = null;
  }

  /* ========================================================================
   * 13. 导入 / 导出
   * ====================================================================== */

  function download(filename, content, mime) {
    var blob = new Blob([content], { type: mime || 'text/plain;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1200);
  }

  function exportJson() {
    var photoKeys = [];
    state.reviews.forEach(function (rv) {
      (rv.photos || []).forEach(function (k) { if (photoKeys.indexOf(k) < 0) photoKeys.push(k); });
    });
    var snapshot = {
      version: 1,
      app: 'ginkgo-food-map',
      exportedAt: nowIso(),
      note: '图片只导出索引 key，二进制内容保存在浏览器 IndexedDB，不会随 JSON 迁移。',
      photoKeys: photoKeys,
      restaurants: state.restaurants,
      reviews: state.reviews,
      meta: { nickname: state.meta.nickname, lastSyncAt: state.meta.lastSyncAt }
    };
    var stamp = new Date();
    var name = 'ginkgo-foodmap-' + stamp.getFullYear() + pad2(stamp.getMonth() + 1) + pad2(stamp.getDate()) + '-' + pad2(stamp.getHours()) + pad2(stamp.getMinutes()) + '.json';
    download(name, JSON.stringify(snapshot, null, 2), 'application/json;charset=utf-8');
    toast('已导出 JSON 快照');
  }

  function mergeIncoming(raw) {
    if (!raw || typeof raw !== 'object') {
      toast('这个 JSON 格式看不懂，请检查文件', 'error');
      return;
    }
    // 注意：这里不能复用 sanitizeState，它会按「导入快照内部」的店铺过滤评价，
    // 而增量导入的评价往往指向本机已有的店铺，会被误删。
    var remap = Object.create(null);
    var incomingRestaurants = (Array.isArray(raw.restaurants) ? raw.restaurants : [])
      .map(function (item) { return normalizeRestaurant(item, remap); }).filter(Boolean);
    var incomingReviews = (Array.isArray(raw.reviews) ? raw.reviews : [])
      .map(function (item) { return normalizeReview(item, remap); }).filter(Boolean);
    if (!incomingRestaurants.length && !incomingReviews.length) {
      toast('这个 JSON 里没有可导入的店铺或评价', 'error');
      return;
    }

    var restMap = Object.create(null);
    state.restaurants.forEach(function (r) { restMap[r.id] = r; });
    var added = 0;
    var updated = 0;

    incomingRestaurants.forEach(function (r) {
      var local = restMap[r.id];
      if (!local) {
        state.restaurants.push(r);
        restMap[r.id] = r;
        added += 1;
      } else {
        var lt = Date.parse(local.createdAt) || 0;
        var rt = Date.parse(r.createdAt) || 0;
        if (rt > lt) {
          Object.keys(r).forEach(function (k) { local[k] = r[k]; });
          updated += 1;
        }
      }
    });

    var reviewMap = Object.create(null);
    state.reviews.forEach(function (rv) { reviewMap[rv.id] = rv; });
    var rAdded = 0;
    var rUpdated = 0;
    incomingReviews.forEach(function (rv) {
      if (!restMap[rv.restaurantId]) return;
      var local = reviewMap[rv.id];
      if (!local) {
        state.reviews.push(rv);
        reviewMap[rv.id] = rv;
        rAdded += 1;
      } else {
        var lu = Date.parse(local.updatedAt) || 0;
        var ru = Date.parse(rv.updatedAt) || 0;
        if (ru > lu) {
          Object.keys(rv).forEach(function (k) { local[k] = rv[k]; });
          rUpdated += 1;
        }
      }
    });

    saveState();
    rebuildAggregates();
    renderList();
    if (MapCtl.ready) MapCtl.sync();
    toast('导入完成：新增 ' + (added + rAdded) + ' 条，更新 ' + (updated + rUpdated) + ' 条');
  }

  function readFileAsText(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () { resolve(String(reader.result || '')); };
      reader.onerror = function () { reject(new Error('文件读取失败')); };
      reader.readAsText(file, 'utf-8');
    });
  }

  function parseCsvInput() {
    var text = el('csvInput').value;
    if (!text || !text.trim()) {
      toast('先把表格内容粘贴进来，或者选一个文件', 'warn');
      return;
    }
    var rows = Core.parseDelimited(text);
    if (rows.length < 2) {
      toast('至少需要一行表头 + 一行数据', 'warn');
      return;
    }
    var headers = rows[0];
    var good = [];
    var bad = [];
    for (var i = 1; i < rows.length; i++) {
      var mapped = Core.mapReviewRow(headers, rows[i]);
      if (mapped.ok) good.push(mapped);
      else bad.push({ line: i + 1, name: mapped.name || '（无店名）', errors: mapped.errors });
    }
    ui.importDraft = { headers: headers, good: good, bad: bad };
    renderImportPreview();
  }

  function renderImportPreview() {
    var d = ui.importDraft;
    var box = el('importPreview');
    if (!d) { box.innerHTML = ''; el('importActions').hidden = true; return; }

    var previewRows = d.good.slice(0, 5);
    var tableHtml = '';
    if (previewRows.length) {
      tableHtml = '<div class="table-wrap" style="margin-top:10px"><table class="preview"><thead><tr>' +
        '<th>店名</th><th>昵称</th><th>味道</th><th>性价比</th><th>服务</th><th>环境</th><th>推荐</th><th>日期</th><th>点评</th>' +
        '</tr></thead><tbody>' +
        previewRows.map(function (row) {
          return '<tr>' +
            '<td>' + esc(row.name) + '</td>' +
            '<td>' + esc(row.author || '匿名社员') + '</td>' +
            '<td>' + esc(row.scores.taste) + '</td>' +
            '<td>' + esc(row.scores.value) + '</td>' +
            '<td>' + esc(row.scores.service) + '</td>' +
            '<td>' + esc(row.scores.ambience) + '</td>' +
            '<td>' + (row.verdict === 'recommend' ? '推荐' : '不推荐') + '</td>' +
            '<td>' + esc(row.date || '—') + '</td>' +
            '<td title="' + esc(row.text) + '">' + esc(row.text) + '</td>' +
            '</tr>';
        }).join('') +
        '</tbody></table></div>' +
        (d.good.length > 5 ? '<div class="field-hint">仅预览前 5 行，共 ' + d.good.length + ' 行可导入。</div>' : '');
    }

    box.innerHTML =
      '<div class="import-summary">' +
        '<span class="pill-ok">可导入 ' + d.good.length + ' 条</span>' +
        (d.bad.length ? '<span class="pill-bad">跳过 ' + d.bad.length + ' 条</span>' : '<span class="pill-warn">没有跳过行</span>') +
      '</div>' +
      (d.bad.length
        ? '<div class="field-hint" style="color:var(--danger)">' + d.bad.slice(0, 5).map(function (b) {
          return '第 ' + b.line + ' 行「' + esc(b.name) + '」：' + esc(b.errors.join('、'));
        }).join('<br />') + (d.bad.length > 5 ? '<br />…还有 ' + (d.bad.length - 5) + ' 行' : '') + '</div>'
        : '') +
      tableHtml;

    el('importActions').hidden = d.good.length === 0;
  }

  function commitImport() {
    var d = ui.importDraft;
    if (!d || !d.good.length) return;
    var autoCreate = el('autoCreateRestaurant').checked;
    var nameIndex = Object.create(null);
    state.restaurants.forEach(function (r) { nameIndex[r.name.trim()] = r; });

    var createdCount = 0;
    var reviewCount = 0;
    var skipped = 0;
    var jitter = 0;

    d.good.forEach(function (row) {
      var name = row.name.trim();
      var restaurant = nameIndex[name];
      if (!restaurant) {
        if (!autoCreate) { skipped += 1; return; }
        jitter += 1;
        var offset = 0.0009 * jitter;
        restaurant = {
          id: Core.uid('r'),
          name: name,
          category: '其他',
          priceLevel: 2,
          address: '待补充地址',
          lat: CAMPUS.lat + offset,
          lng: CAMPUS.lng - offset,
          tags: ['待定位'],
          closed: false,
          source: 'user',
          needsLocation: true,
          createdAt: nowIso(),
          createdBy: '收集表导入'
        };
        state.restaurants.push(restaurant);
        nameIndex[name] = restaurant;
        createdCount += 1;
      }

      var duplicated = state.reviews.some(function (rv) {
        return rv.restaurantId === restaurant.id &&
          rv.author === (row.author || '匿名社员') &&
          rv.text === row.text;
      });
      if (duplicated) { skipped += 1; return; }

      var created = row.date && !isNaN(Date.parse(row.date)) ? new Date(row.date).toISOString() : nowIso();
      var stamp = nowIso();
      state.reviews.push({
        id: Core.uid('rv'),
        restaurantId: restaurant.id,
        author: (row.author || '匿名社员').slice(0, 20),
        scores: row.scores,
        verdict: row.verdict,
        text: row.text.slice(0, 500),
        photos: [],
        createdAt: created,
        updatedAt: stamp,
        source: 'user'
      });
      reviewCount += 1;
    });

    saveState();
    rebuildAggregates();
    renderList();
    if (MapCtl.ready) MapCtl.sync();

    ui.importDraft = null;
    el('csvInput').value = '';
    renderImportPreview();
    toast('已导入 ' + reviewCount + ' 条评价，新建 ' + createdCount + ' 家店' + (skipped ? '，跳过 ' + skipped + ' 条' : ''));
  }

  function downloadTemplate() {
    var lines = [TEMPLATE_HEADERS.join(',')].concat(TEMPLATE_ROWS.map(function (row) {
      return row.map(function (cell) {
        var s = String(cell);
        return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
      }).join(',');
    }));
    download('ginkgo-收集表导入模板.csv', '\uFEFF' + lines.join('\r\n'), 'text/csv;charset=utf-8');
    toast('模板已下载，用 Excel 或腾讯文档打开即可');
  }

  function updateStorageInfo() {
    var box = el('storageInfo');
    if (!box) return;
    var bytes = 0;
    try { bytes = new Blob([JSON.stringify(state)]).size; } catch (e) { bytes = JSON.stringify(state).length; }
    var photoTotal = 0;
    state.reviews.forEach(function (rv) { photoTotal += (rv.photos || []).length; });
    PhotoDB.count().then(function (stored) {
      box.innerHTML = '数据体积约 <b>' + (bytes / 1024).toFixed(1) + ' KB</b>（' + state.restaurants.length +
        ' 家店 / ' + state.reviews.length + ' 条评价），评价引用照片 ' + photoTotal +
        ' 张，IndexedDB 实际存有 ' + stored + ' 张。';
    });
  }

  /* ========================================================================
   * 14. 排行榜 / 评分说明
   * ====================================================================== */

  function openRanking() {
    var html = '';
    ALL_TIERS.forEach(function (t) {
      var group = state.restaurants
        .filter(function (r) { return tierKeyOf(r.id) === t.key; })
        .map(function (r) { return { r: r, agg: aggOf(r.id) }; })
        .sort(function (a, b) {
          var sa = a.agg.score === null ? -1 : a.agg.score;
          var sb = b.agg.score === null ? -1 : b.agg.score;
          if (sb !== sa) return sb - sa;
          return nameCompare(a.r, b.r);
        })
        .slice(0, 3);
      if (!group.length) return;
      html += '<div class="rank-group">' +
        '<h4>' + badgeHtml(t) + (t.key === 'none' ? '' : '<span style="color:var(--muted);font-weight:500">' + esc(t.slogan) + '</span>') + '</h4>' +
        group.map(function (item, i) {
          return '<button class="rank-item" type="button" data-rank-id="' + esc(item.r.id) + '">' +
            '<span class="rank-no">' + (i + 1) + '</span>' +
            '<span class="rank-name">' + esc(item.r.name) + '</span>' +
            '<span class="rank-score">' + (item.agg.score === null ? '—' : Core.fmtScore(item.agg.score)) + '</span>' +
            '<span class="rank-count">' + item.agg.count + ' 评</span>' +
            '</button>';
        }).join('') +
        '</div>';
    });
    el('rankBody').innerHTML = html || '<div class="field-hint">还没有任何店铺，先去添加一家吧。</div>';
    openModal('modalRanking');
  }

  /* ------------------------------------------------------------------------
   * 贡献榜
   *
   * 身份主键用 owner（设备 ID），不用 author（昵称）：
   * 默认昵称都是「匿名社员」，按昵称分组会把不同的人错误合并成一个人。
   * ---------------------------------------------------------------------- */

  /** 前三名的序号用奖牌代替 */
  var CONTRIB_MEDALS = ['🥇', '🥈', '🥉'];
  /** 榜单最多展示的名次，超出后只单独补一行「我」 */
  var CONTRIB_TOP_N = 10;

  /**
   * 是否算「有昵称」。
   * 空值、以及两个默认值（评价的「匿名社员」、店铺的「社员」）都不算，
   * 这样贡献榜上只出现真正填了名字的人。
   */
  function isNamedName(name) {
    var s = String(name == null ? '' : name).trim();
    if (!s) return false;
    if (s === '匿名社员') return false;
    if (s === '社员') return false;
    return true;
  }

  /**
   * 汇总每位社员的贡献量。
   *
   * 口径：**以昵称分组**，并且只统计填了昵称的内容——
   *  - 匿名的评价 / 店铺 / 回复一律不计入；
   *  - 按昵称分组而不是按设备 ID，是因为同一个人换设备（手机 + 电脑）
   *    在按设备口径下会被切成两个人、榜上出现两个同名行，看着像 bug；
   *  - 代价是两个恰好重名的人会被合并成一行。社团里昵称基本自拟，
   *    这个代价远小于"一个人被切成两行"。
   *
   * @returns {Array<{name:string,reviews:number,shops:number,replies:number}>}
   *          按 reviews → shops → replies 降序、name 升序排列。
   */
  function contribStats() {
    var byName = {};
    var order = [];

    /** 取（或新建）某个昵称对应的贡献者记录 */
    function personOf(name) {
      if (!byName[name]) {
        byName[name] = { name: name, reviews: 0, shops: 0, replies: 0 };
        order.push(name);
      }
      return byName[name];
    }

    // 1) 评价：匿名的一律不计入
    liveReviews().forEach(function (rv) {
      if (rv.source !== 'user') return;
      if (!isNamedName(rv.author)) return;
      personOf(String(rv.author).trim()).reviews += 1;
    });

    // 2) 店铺：createdBy 是默认值「社员」时不计入
    liveRestaurants().forEach(function (r) {
      if (r.source !== 'user') return;
      if (!isNamedName(r.createdBy)) return;
      personOf(String(r.createdBy).trim()).shops += 1;
    });

    // 3) 回复：匿名的不计入
    liveReviews().forEach(function (rv) {
      (rv.comments || []).forEach(function (c) {
        if (!c || !isNamedName(c.author)) return;
        personOf(String(c.author).trim()).replies += 1;
      });
    });

    return order.map(function (name) {
      return byName[name];
    }).sort(function (a, b) {
      if (b.reviews !== a.reviews) return b.reviews - a.reviews;
      if (b.shops !== a.shops) return b.shops - a.shops;
      if (b.replies !== a.replies) return b.replies - a.replies;
      return nameCompare(a, b);
    });
  }

  /** 一行贡献数据：`3 条评价 · 1 家店 · 2 条回复` */
  function contribMetricsHtml(person) {
    return '<span class="contrib-metrics">' + person.reviews + ' 条评价 · ' +
      person.shops + ' 家店 · ' + person.replies + ' 条回复</span>';
  }

  /**
   * 渲染贡献榜的一行。
   * @param {{owner:string,name:string,reviews:number,shops:number,replies:number}} person 贡献者
   * @param {number} index 在完整榜单中的下标（0 起）
   * @param {boolean} isMe 是否是当前设备
   * @param {string} [noOverride] 自定义序号文案，例如「第 12 名」；给出时序号位会自动加宽
   * @returns {string} HTML
   */
  function contribRowHtml(person, index, isMe, noOverride) {
    var no = noOverride || (index < CONTRIB_MEDALS.length ? CONTRIB_MEDALS[index] : String(index + 1));
    return '<div class="contrib-row' + (isMe ? ' is-me' : '') + '">' +
      '<span class="contrib-no' + (noOverride ? ' contrib-no-wide' : '') + '">' + no + '</span>' +
      '<span class="contrib-name">' + esc(person.name) +
      (isMe ? '<span class="contrib-me">（我）</span>' : '') + '</span>' +
      contribMetricsHtml(person) +
      '</div>';
  }

  /** 打开贡献榜弹层 */
  function openContrib() {
    var body = el('contribBody');
    if (!body) return;
    var list = contribStats();

    if (!list.length) {
      body.innerHTML = '<div class="field-hint">还没有填昵称的评价。写评价时填个昵称，就能上贡献榜。</div>';
      openModal('modalContrib');
      return;
    }

    // 「我」= 本机填过的昵称；没填昵称就没人可高亮
    var meName = isNamedName(state.meta.nickname) ? String(state.meta.nickname).trim() : '';
    var html = list.slice(0, CONTRIB_TOP_N).map(function (person, i) {
      return contribRowHtml(person, i, !!meName && person.name === meName);
    }).join('');

    // 没进前 10 但有贡献：末尾单独补一行，序号位写「第 N 名」
    var myIndex = -1;
    for (var i = 0; i < list.length; i++) {
      if (list[i].name === meName) { myIndex = i; break; }
    }
    if (meName && myIndex >= CONTRIB_TOP_N) {
      html += '<div class="contrib-sep"></div>' +
        contribRowHtml(list[myIndex], myIndex, true, '第 ' + (myIndex + 1) + ' 名');
    }

    html += '<div class="field-hint" style="margin-top:10px">' +
      '按昵称统计：换设备也会算作同一个人；两个重名的人会被合并。<br/>' +
      '只统计填了昵称的内容，匿名的不计入。</div>';
    body.innerHTML = html;
    openModal('modalContrib');
  }

  function renderHelpTierTable() {
    var rows = ALL_TIERS.map(function (t) {
      var range = t.key === 'bucket' ? '≥ 8.6'
        : t.key === 'super' ? '7.4 – 8.59'
          : t.key === 'large' ? '6.2 – 7.39'
            : t.key === 'medium' ? '5.0 – 6.19'
              : t.key === 'small' ? '< 5.0'
                : '无评价';
      return '<tr><td><span class="dotc" style="background:' + t.color + '"></span>' + esc(t.label) + '</td>' +
        '<td style="color:var(--muted)">' + range + '</td>' +
        '<td>' + esc(t.slogan) + '</td></tr>';
    }).join('');
    el('helpTierTable').innerHTML = rows;
  }

  /* ========================================================================
   * 15. 同步：状态条 / 广播 / 云端
   * ====================================================================== */

  function updateStatusBar() {
    var node = el('syncStatus');
    if (!node) return;
    var offline = (typeof navigator !== 'undefined' && navigator.onLine === false);
    var stamp = state && state.meta && state.meta.lastSyncAt ? new Date(state.meta.lastSyncAt) : null;
    var hhmm = stamp && !isNaN(stamp.getTime()) ? pad2(stamp.getHours()) + ':' + pad2(stamp.getMinutes()) : '--:--';

    if (offline) {
      node.className = 'sync-pill is-offline';
      node.innerHTML = '<span class="dot"></span>离线模式，改动已暂存，联网后自动合并';
    } else if (Sync.lastError) {
      node.className = 'sync-pill is-offline';
      node.innerHTML = '<span class="dot"></span>云端同步失败，已回退本地';
    } else {
      node.className = 'sync-pill is-online';
      node.innerHTML = '<span class="check">✓</span>' +
        (SYNC_CONFIG.mode === 'cloud' ? '已同步到云端' : '已保存到本机') + ' · ' + hhmm;
    }
  }

  /**
   * 刷新「数据管理 → 云同步」面板里的状态说明。
   * @param {boolean} [keepInputs] 为 true 时不回写输入框，避免连接失败后把用户刚填的内容清掉
   */
  function updateSyncPanel(keepInputs) {
    var hint = el('syncHint');
    if (!hint) return;
    var pending = (state.meta.pendingSync || []).length + (state.meta.pendingRestaurants || []).length;
    var parts = [];

    if (!Sync.enabled()) {
      parts.push('现在是<b>本地模式</b>：评价只保存在这台电脑上，别人看不到。');
      parts.push('把下面的地址和密钥填好保存，大家就会共用同一份数据。');
    } else {
      parts.push('已连接云端，每 ' + Math.round((Number(SYNC_CONFIG.pollMs) || 15000) / 1000) + ' 秒自动拉取一次新评价。');
      if (pending) parts.push('有 <b>' + pending + '</b> 条改动排队等待上传。');
      if (Sync.lastOkAt) {
        var t = new Date(Sync.lastOkAt);
        if (!isNaN(t.getTime())) {
          parts.push('上次同步成功：' + pad2(t.getHours()) + ':' + pad2(t.getMinutes()) + ':' + pad2(t.getSeconds()));
        }
      }
      if (Sync.lastError) {
        parts.push('<span style="color:var(--danger)">最近一次失败：' + esc(Sync.lastErrorMessage || '网络异常') + '</span>');
      }
    }
    hint.innerHTML = parts.join(' ');

    var chip = el('syncModeChip');
    if (chip) {
      chip.textContent = Sync.enabled() ? '云端模式' : '本地模式';
      chip.className = 'chip' + (Sync.enabled() ? ' is-on' : '');
    }
    if (!keepInputs) {
      var ep = el('syncEndpoint');
      if (ep && document.activeElement !== ep) ep.value = SYNC_CONFIG.endpoint || '';
      var ak = el('syncAnonKey');
      if (ak && document.activeElement !== ak) ak.value = SYNC_CONFIG.anonKey || '';
    }
    var btnOff = el('btnSyncDisconnect');
    if (btnOff) btnOff.disabled = !Sync.enabled();
  }

  /**
   * 探测同源后端（server.js 提供的 /api）。
   * 发布到公网时自动启用，让所有人共用一份数据；本地 double-click 打开时没有后端，会静默跳过。
   * 用户手动保存过云端配置的，不覆盖。
   */
  function autoDetectBackend() {
    try {
      if (window.localStorage && localStorage.getItem(SYNC_STORE_KEY)) return;
    } catch (e) { /* 存储不可用就继续探测 */ }
    if (!/^https?:$/.test(location.protocol)) return;

    fetch(withShareCode(location.origin + '/api/health'), { headers: { accept: 'application/json' } })
      .then(function (resp) { return resp.ok ? resp.json() : null; })
      .then(function (info) {
        if (!info || !info.ok) return;
        SYNC_CONFIG.endpoint = location.origin + '/api';
        SYNC_CONFIG.anonKey = 'same-origin';
        SYNC_CONFIG.mode = 'cloud';
        Sync.stop();
        Sync.cursor = null;
        Sync.start();
        updateSyncPanel();
        updateStatusBar();
      })
      .catch(function () { /* 没有后端，继续本地模式 */ });
  }

  /** 地图 Key 面板：状态来自服务端，Key 本身不回显 */
  function refreshMapKeyPanel() {
    var hint = el('mapKeyHint');
    if (!hint) return;
    hint.textContent = '正在检查…';
    fetch(withShareCode(location.origin + '/api/mapkey'), { headers: { accept: 'application/json' } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (info) {
        if (!info) throw new Error('no backend');
        hint.innerHTML = info.configured
          ? '<b style="color:var(--matcha)">已配置地图 Key</b>，搜索可用。换 Key 后需要刷新页面才生效。'
          : '<b style="color:var(--amber)">还没配置地图 Key</b>：地图能显示，但「搜店名定位」用不了。把腾讯位置服务的 Key 填在下面保存即可。';
      })
      .catch(function () {
        hint.textContent = '当前是本地文件模式，没有后端；地图搜索需要在带后端的发布版里配置。';
      });
  }



  function broadcastState() {
    if (!channel || ui.suppressBroadcast) return;    try {
      channel.postMessage({ type: 'state', payload: state, at: nowIso() });
    } catch (e) { /* 忽略 */ }
  }

  function applyRemoteState(payload, sourceLabel) {
    var clean = sanitizeState(payload);
    if (!clean) return;
    ui.suppressBroadcast = true;
    state = clean;
    rebuildAggregates();
    renderList();
    if (MapCtl.ready) MapCtl.sync();
    if (ui.selectedId && getRestaurant(ui.selectedId)) renderDrawer(getRestaurant(ui.selectedId));
    ui.suppressBroadcast = false;
    updateStatusBar();
    if (sourceLabel) toast(sourceLabel);
  }

  function reviewToRemote(rv, photoUrls) {
    return {
      id: rv.id,
      restaurant_id: rv.restaurantId,
      author: rv.author,
      scores: rv.scores,
      verdict: rv.verdict,
      text: rv.text,
      photos: Array.isArray(photoUrls) ? photoUrls : [],
      comments: Array.isArray(rv.comments) ? rv.comments : [],
      deleted: rv.deleted === true,
      owner: rv.owner || '',
      created_at: rv.createdAt,
      updated_at: rv.updatedAt,
      source: rv.source
    };
  }

  function remoteToReview(row) {
    if (!row || !row.id || !row.restaurant_id) return null;
    return normalizeReview({
      id: row.id,
      restaurantId: row.restaurant_id,
      author: row.author,
      scores: row.scores,
      verdict: row.verdict,
      text: row.text,
      photos: Array.isArray(row.photos) ? row.photos : [],
      comments: Array.isArray(row.comments) ? row.comments : [],
      deleted: row.deleted === true,
      owner: row.owner,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      source: 'user'
    });
  }

  function restaurantToRemote(r) {
    return {
      id: r.id,
      name: r.name,
      category: r.category,
      price_level: r.priceLevel,
      price: r.price,
      address: r.address,
      lat: r.lat,
      lng: r.lng,
      tags: r.tags,
      closed: !!r.closed,
      deleted: r.deleted === true,
      owner: r.owner || '',
      source: r.source,
      created_at: r.createdAt,
      created_by: r.createdBy,
      needs_location: !!r.needsLocation
    };
  }

  function remoteToRestaurant(row) {
    if (!row || !row.id || !row.name) return null;
    return normalizeRestaurant({
      id: row.id,
      name: row.name,
      category: row.category,
      priceLevel: row.price_level,
      price: row.price,
      address: row.address,
      lat: row.lat,
      lng: row.lng,
      tags: row.tags,
      closed: row.closed,
      deleted: row.deleted === true,
      owner: row.owner,
      source: 'user',
      createdAt: row.created_at,
      createdBy: row.created_by,
      needsLocation: row.needs_location
    });
  }

  /* ---- 图片：本地存 Blob（IndexedDB），云端存 dataURL，跨设备时双向转换 ---- */

  function photoKeyToDataUrl(key) {
    return PhotoDB.get(key).then(function (blob) {
      if (!blob) return '';
      return new Promise(function (resolve) {
        var reader = new FileReader();
        reader.onload = function () { resolve(typeof reader.result === 'string' ? reader.result : ''); };
        reader.onerror = function () { resolve(''); };
        reader.readAsDataURL(blob);
      });
    }).catch(function () { return ''; });
  }

  function dataUrlToPhotoKey(dataUrl) {
    return new Promise(function (resolve) {
      try {
        var comma = String(dataUrl).indexOf(',');
        if (comma < 0) { resolve(''); return; }
        var head = String(dataUrl).slice(0, comma);
        var mime = /data:([^;]+)/.exec(head);
        var binary = atob(String(dataUrl).slice(comma + 1));
        var bytes = new Uint8Array(binary.length);
        for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        var key = Core.uid('p');
        PhotoDB.put(key, new Blob([bytes], { type: mime ? mime[1] : 'image/jpeg' }))
          .then(function () { resolve(key); })
          .catch(function () { resolve(''); });
      } catch (e) { resolve(''); }
    });
  }

  /** 云端拉下来的照片是 dataURL，落地成本地 key；失败的图片直接丢弃不影响评价 */
  function adoptRemotePhotos(rv) {
    var urls = (rv.photos || []).filter(function (p) { return typeof p === 'string' && p.indexOf('data:') === 0; });
    if (!urls.length) return Promise.resolve(rv);
    return Promise.all(urls.map(dataUrlToPhotoKey)).then(function (keys) {
      rv.photos = keys.filter(Boolean);
      return rv;
    });
  }

  var Sync = {
    lastError: false,
    lastErrorMessage: '',
    timer: 0,
    cursor: null,
    pushTimer: 0,
    busy: false,
    lastOkAt: null,

    enabled: function () {
      return SYNC_CONFIG.mode === 'cloud' && !!SYNC_CONFIG.endpoint && !!SYNC_CONFIG.anonKey;
    },

    start: function () {
      if (!this.enabled()) return;
      var self = this;
      if (!this.timer) {
        this.timer = window.setInterval(function () { self.tick(); }, Math.max(5000, Number(SYNC_CONFIG.pollMs) || 15000));
      }
      this.tick();
    },

    stop: function () {
      if (this.timer) { window.clearInterval(this.timer); this.timer = 0; }
      this.busy = false;
    },

    headers: function () {
      return syncHeaders(SYNC_CONFIG.anonKey, memberCode);
    },

    base: function () {
      return String(SYNC_CONFIG.endpoint).replace(/\/+$/, '');
    },

    get: function (path) {
      return fetch(withShareCode(this.base() + path), { headers: this.headers() }).then(function (resp) {
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
        return resp.json();
      });
    },

    upsert: function (table, rows) {
      return fetch(withShareCode(this.base() + table), {
        method: 'POST',
        headers: Object.assign({ Prefer: 'resolution=merge-duplicates,return=minimal' }, this.headers()),
        body: JSON.stringify(rows)
      }).then(function (resp) {
        if (resp.ok) return true;
        return resp.text().then(function (body) {
          throw new Error('HTTP ' + resp.status + ' ' + String(body).slice(0, 140));
        });
      });
    },

    /** 一轮：先拉店铺 → 再拉评价 → 最后推本地未上传的内容 */
    tick: function () {
      var self = this;
      if (!self.enabled() || self.busy) return;
      if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
      self.busy = true;
      self.pullRestaurants()
        .then(function () { return self.pullReviews(); })
        .then(function () { return self.push(); })
        .then(function () {
          self.lastError = false;
          self.lastErrorMessage = '';
          self.lastOkAt = nowIso();
          updateStatusBar();
          updateSyncPanel();
        })
        .catch(function (err) {
          self.lastError = true;
          self.lastErrorMessage = (err && err.message) ? err.message : '网络异常';
          updateStatusBar();
          updateSyncPanel();
        })
        .then(function () { self.busy = false; });
    },

    /**
     * 店铺必须先落地：别人的评价指向一家你本地没有的店时，
     * mergeRemoteReview 会把它当孤儿丢掉——这正是"只看到默认评价"的根因之一。
     */
    pullRestaurants: function () {
      return this.get('/restaurants?select=*').then(function (rows) {
        if (!Array.isArray(rows) || !rows.length) {
          // 云端还是空的：把本地店铺目录整体推上去，
          // 否则别人提交的评价在云端找不到对应的店，回来时会被当孤儿丢掉
          if (state.restaurants.length && !(state.meta.pendingRestaurants || []).length) {
            state.meta.pendingRestaurants = state.restaurants.map(function (r) { return r.id; });
          }
          return 0;
        }
        var added = 0;
        var flagChanged = 0;
        rows.forEach(function (row) {
          var r = remoteToRestaurant(row);
          if (!r) return;
          var local = getRestaurant(r.id);
          if (local) {
            // 本地还有未推送的改动时不要被远端覆盖
            var pending = (state.meta.pendingRestaurants || []).indexOf(r.id) >= 0;
            if (!pending && !!local.deleted !== !!r.deleted) {
              local.deleted = r.deleted;
              flagChanged += 1;
            }
            return;
          }
          state.restaurants.push(r);
          added += 1;
        });
        if (added || flagChanged) {
          if (flagChanged) saveState('remote');
          rebuildAggregates();
          renderList();
          if (MapCtl.ready) MapCtl.sync();
        }
        return added + flagChanged;
      });
    },

    pullReviews: function () {
      var self = this;
      var since = self.cursor ? '&updated_at=gt.' + encodeURIComponent(self.cursor) : '';
      return self.get('/reviews?select=*' + since + '&order=updated_at.asc&limit=500').then(function (rows) {
        if (!Array.isArray(rows) || !rows.length) return;
        var tasks = [];
        rows.forEach(function (row) {
          var rv = remoteToReview(row);
          if (!rv) return;
          if (rv.updatedAt) self.cursor = rv.updatedAt;
          tasks.push(adoptRemotePhotos(rv));
        });
        return Promise.all(tasks).then(function (list) {
          var changed = 0;
          list.forEach(function (rv) { if (mergeRemoteReview(rv)) changed += 1; });
          if (!changed) return;
          rebuildAggregates();
          renderList();
          if (MapCtl.ready) MapCtl.sync();
          if (ui.selectedId && getRestaurant(ui.selectedId)) renderDrawer(getRestaurant(ui.selectedId));
          toast('已同步 ' + changed + ' 条别人的评价');
        });
      });
    },

    push: function () {
      var self = this;
      if (!self.enabled()) return Promise.resolve();

      var pendR = (state.meta.pendingRestaurants || []).slice();
      var pendV = (state.meta.pendingSync || []).slice();
      if (!pendR.length && !pendV.length) return Promise.resolve();

      var restRows = pendR.map(function (id) {
        var r = getRestaurant(id);
        return r ? restaurantToRemote(r) : null;
      }).filter(Boolean);

      var reviewItems = pendV.map(function (id) {
        for (var i = 0; i < state.reviews.length; i++) {
          if (state.reviews[i].id === id) return state.reviews[i];
        }
        return null;
      }).filter(Boolean);

      var chain = restRows.length ? self.upsert('/restaurants', restRows) : Promise.resolve(true);

      return chain.then(function () {
        if (!reviewItems.length) return true;
        return Promise.all(reviewItems.map(function (rv) {
          var reads = (rv.photos || []).map(photoKeyToDataUrl);
          return Promise.all(reads).then(function (list) {
            var usable = list.filter(Boolean);
            var bytes = usable.reduce(function (n, u) { return n + u.length; }, 0);
            // 单条评价图片总量超过 400KB 就只传文字，避免整条推送被网关拒绝
            return reviewToRemote(rv, bytes <= 400000 ? usable : []);
          });
        })).then(function (rows) { return self.upsert('/reviews', rows); });
      }).then(function () {
        state.meta.pendingRestaurants = [];
        state.meta.pendingSync = [];
        self.lastError = false;
        self.lastErrorMessage = '';
        self.lastOkAt = nowIso();
        saveState('remote');
        updateSyncPanel();
      }).catch(function (err) {
        self.lastError = true;
        self.lastErrorMessage = (err && err.message) ? err.message : '网络异常';
        if (/社团口令/.test(self.lastErrorMessage || '')) {
          toast('这台设备还没填社团口令：「评分说明」→ 社团口令', 'warn');
        }
        updateStatusBar();
        updateSyncPanel();
      });
    },

    schedulePush: function () {
      var self = this;
      if (!self.enabled()) return;
      if (self.pushTimer) window.clearTimeout(self.pushTimer);
      self.pushTimer = window.setTimeout(function () { self.tick(); }, 900);
    }
  };

  function mergeRemoteReview(rv) {
    if (!getRestaurant(rv.restaurantId)) return false;
    for (var i = 0; i < state.reviews.length; i++) {
      var local = state.reviews[i];
      if (local.id === rv.id) {
        if ((Date.parse(rv.updatedAt) || 0) > (Date.parse(local.updatedAt) || 0)) {
          state.reviews[i] = rv;
          return true;
        }
        return false;
      }
    }
    state.reviews.push(rv);
    return true;
  }

  /* ========================================================================
   * 16. 事件绑定
   * ====================================================================== */

  function bindGlobalEvents() {
    // 顶部按钮
    el('btnRanking').addEventListener('click', openRanking);
    el('btnContrib').addEventListener('click', openContrib);
    el('btnHelp').addEventListener('click', function () {
      openModal('modalHelp');
      refreshMemberState();
    });
    el('btnData').addEventListener('click', requestDataModal);
    el('btnOpenData').addEventListener('click', requestDataModal);

    el('btnAddRestaurant').addEventListener('click', function () { openRestaurantModal(null); });
    el('btnWriteReview').addEventListener('click', function () { openReviewModal(ui.selectedId); });

    // 搜索
    el('searchInput').addEventListener('input', function () {
      ui.search = this.value;
      renderList();
      if (MapCtl.ready) MapCtl.sync();
    });
    el('btnClearSearch').addEventListener('click', function () {
      ui.search = '';
      el('searchInput').value = '';
      renderList();
      if (MapCtl.ready) MapCtl.sync();
    });

    // 排序 / 视图
    el('sortSelect').addEventListener('change', function () {
      ui.sort = this.value;
      renderList();
      if (MapCtl.ready) MapCtl.sync();
    });
    el('viewSelect').addEventListener('change', function () {
      ui.view = this.value;
      renderList();
      if (MapCtl.ready) MapCtl.sync();
    });

    // 杯型 chips 与地图图例共用一套筛选逻辑
    el('tierChips').addEventListener('click', function (evt) {
      var btn = closestOf(evt.target, 'button[data-tier]');
      if (!btn) return;
      toggleTier(btn.getAttribute('data-tier'));
    });
    el('mapLegend').addEventListener('click', function (evt) {
      var btn = closestOf(evt.target, 'button[data-legend]');
      if (!btn) return;
      toggleTier(btn.getAttribute('data-legend'));
    });

    // 列表点击
    el('list').addEventListener('click', function (evt) {
      var locate = closestOf(evt.target, 'button[data-locate]');
      if (locate) {
        evt.stopPropagation();
        var lid = locate.getAttribute('data-locate');
        var rr = getRestaurant(lid);
        if (rr) {
          openRestaurantModal(lid);
          startPickMode();
        }
        return;
      }
      var card = closestOf(evt.target, '.card');
      if (!card) return;
      openDetail(card.getAttribute('data-id'));
    });
    el('list').addEventListener('keydown', function (evt) {
      if (evt.key !== 'Enter' && evt.key !== ' ') return;
      var card = closestOf(evt.target, '.card');
      if (!card) return;
      evt.preventDefault();
      openDetail(card.getAttribute('data-id'));
    });

    // 抽屉
    el('drawerScrim').addEventListener('click', closeDrawer);
    el('drawerBody').addEventListener('click', function (evt) {
      if (closestOf(evt.target, '[data-close-drawer]')) { closeDrawer(); return; }
      if (closestOf(evt.target, '[data-copy-addr]')) {
        var r0 = getRestaurant(ui.selectedId);
        if (r0) copyText(r0.address || r0.name, '地址已复制');
        return;
      }
      var photoBtn = closestOf(evt.target, '[data-open-photo]');
      if (photoBtn) {
        var url = photoBtn.getAttribute('data-photo-url');
        if (!url) {
          photoUrl(photoBtn.getAttribute('data-photo-key')).then(openLightbox);
        } else {
          openLightbox(url);
        }
        return;
      }
      var restoreBtn = closestOf(evt.target, '[data-admin-restore]');
      if (restoreBtn) {
        var restoreId = restoreBtn.getAttribute('data-admin-restore');
        adminApi('review', { id: restoreId, action: 'restore' })
          .then(function () { return Sync.pullReviews(); })
          .then(function () {
            rebuildAggregates();
            renderList();
            if (MapCtl.ready) MapCtl.sync();
            var c1 = getRestaurant(ui.selectedId);
            if (c1) renderDrawer(c1);
            toast('已恢复');
          })
          .catch(function (e) { toast('恢复失败：' + (e.message || '网络错误'), 'error'); });
        return;
      }

      var replyBtn = closestOf(evt.target, '[data-reply]');
      if (replyBtn) {
        var replyId = replyBtn.getAttribute('data-reply');
        var box = document.querySelector('[data-reply-box="' + replyId + '"]');
        if (box) {
          box.hidden = !box.hidden;
          if (!box.hidden) {
            var inp = box.querySelector('input');
            if (inp) inp.focus();
          }
        }
        return;
      }

      var sendBtn = closestOf(evt.target, '[data-reply-send]');
      if (sendBtn) {
        var sendId = sendBtn.getAttribute('data-reply-send');
        var sendBox = document.querySelector('[data-reply-box="' + sendId + '"]');
        var sendInput = sendBox ? sendBox.querySelector('input') : null;
        addReply(sendId, sendInput ? sendInput.value : '');
        return;
      }

      var delReview = closestOf(evt.target, '[data-del-review]');
      if (delReview) {
        var rid = delReview.getAttribute('data-del-review');
        var target = null;
        for (var ri = 0; ri < state.reviews.length; ri++) {
          if (state.reviews[ri].id === rid) { target = state.reviews[ri]; break; }
        }
        if (!target) return;
        var isMine = target.owner && target.owner === state.meta.deviceId;
        if (!isMine && !ui.isAdmin) {
          toast('只能删自己写的评价', 'warn');
          return;
        }
        if (!isMine) {
          askConfirm('删除别人的评价？',
            '<p style="margin:0;font-size:13px;color:var(--ink-soft)">以管理员身份删除后所有人都看不到，之后可在「已删除」里恢复。</p>',
            '删除').then(function (ok) {
            if (!ok) return;
            adminApi('review', { id: rid, action: 'delete' })
              .then(function () { return Sync.pullReviews(); })
              .then(function () {
                rebuildAggregates();
                renderList();
                if (MapCtl.ready) MapCtl.sync();
                var c0 = getRestaurant(ui.selectedId);
                if (c0) renderDrawer(c0);
                toast('已删除');
              })
              .catch(function (e) { toast('删除失败：' + (e.message || '网络错误'), 'error'); });
          });
          return;
        }
        askConfirm('删除这条评价？', '<p style="margin:0;font-size:13px;color:var(--ink-soft)">删除后所有人都看不到，店铺杯型会重新计算。</p>', '删除').then(function (ok) {
          if (!ok) return;
          // 软删除：保留墓碑，靠同步让所有人都不再显示
          target.deleted = true;
          target.updatedAt = nowIso();
          state.meta.pendingSync = (state.meta.pendingSync || []).concat([target.id]);
          saveState();
          rebuildAggregates();
          renderList();
          if (MapCtl.ready) MapCtl.sync();
          var cur = getRestaurant(ui.selectedId);
          if (cur) renderDrawer(cur);
          toast('已删除');
        });
        return;
      }
      var act = closestOf(evt.target, '[data-detail-act]');
      if (!act) return;
      var action = act.getAttribute('data-detail-act');
      var r = getRestaurant(ui.selectedId);
      if (!r) return;
      if (action === 'review') openReviewModal(r.id);
      else if (action === 'share') copyText(shareText(r), '店铺信息已复制，粘贴给同学吧');
      else if (action === 'edit') openRestaurantModal(r.id);
      else if (action === 'delete') {
        var isMineShop = r.owner && r.owner === state.meta.deviceId;
        if (!isMineShop && !ui.isAdmin) {
          toast('只能删自己添加的店', 'warn');
          return;
        }
        askConfirm('删除「' + r.name + '」？',
          '<p style="margin:0;font-size:13px;color:var(--ink-soft)">删除后所有人都看不到这家店和它的 ' +
          reviewsOf(r.id).length + ' 条评价（评价本身不会被销毁）。' +
          (isMineShop ? '可以在管理员的「已删除店铺」里恢复。' : '你是以管理员身份删除，可在管理面板恢复。') + '</p>',
          '删除店铺').then(function (ok) {
            if (!ok) return;

            var finish = function () {
              closeDrawer();
              rebuildAggregates();
              renderList();
              if (MapCtl.ready) MapCtl.sync();
              renderAdminTrash();
              toast('店铺已删除');
            };

            if (!isMineShop) {
              adminApi('restaurant', { id: r.id, action: 'delete' })
                .then(function () { return Sync.pullRestaurants(); })
                .then(finish)
                .catch(function (e) { toast('删除失败：' + (e.message || '网络错误'), 'error'); });
              return;
            }

            r.deleted = true;
            state.meta.pendingRestaurants = (state.meta.pendingRestaurants || []).concat([r.id]);
            saveState();
            finish();
          });
      }
    });

    // 地图控件
    el('mapZoomIn').addEventListener('click', function () { MapCtl.zoomBy(1); });
    el('mapZoomOut').addEventListener('click', function () { MapCtl.zoomBy(-1); });
    el('mapReset').addEventListener('click', function () {
      MapCtl.reset();
      toast('已回到全城视野');
    });
    el('mapLocate').addEventListener('click', locateUser);
    el('mapPickCancel').addEventListener('click', function () {
      stopPickMode();
      MapCtl.clearPreview();
      renderRestaurantForm();
      openModal('modalRestaurant');
    });

    // 弹层关闭
    document.addEventListener('click', function (evt) {
      var closer = closestOf(evt.target, '[data-close]');
      if (closer) {
        closeModal(closer.getAttribute('data-close'));
        return;
      }
      if (evt.target.classList && evt.target.classList.contains('modal')) {
        closeModal(evt.target.id);
      }
    });

    el('lightboxClose').addEventListener('click', function () { el('lightbox').hidden = true; document.body.style.overflow = ''; });
    el('lightbox').addEventListener('click', function (evt) {
      if (evt.target === el('lightbox')) { el('lightbox').hidden = true; document.body.style.overflow = ''; }
    });

    // 写评价 / 添加餐厅提交
    el('reviewSubmit').addEventListener('click', submitReview);
    el('restSubmit').addEventListener('click', submitRestaurant);

    // 排行榜跳转
    el('rankBody').addEventListener('click', function (evt) {
      var item = closestOf(evt.target, '[data-rank-id]');
      if (!item) return;
      closeModal('modalRanking');
      openDetail(item.getAttribute('data-rank-id'));
    });

    // 数据管理
    el('btnExportJson').addEventListener('click', exportJson);
    el('btnImportJsonPick').addEventListener('click', function () { el('importJsonFile').click(); });
    el('importJsonFile').addEventListener('change', function () {
      var file = this.files && this.files[0];
      if (!file) return;
      readFileAsText(file).then(function (text) {
        try {
          mergeIncoming(JSON.parse(text));
        } catch (e) {
          toast('JSON 解析失败，请确认文件内容', 'error');
        }
      }).catch(function () { toast('文件读取失败', 'error'); });
      this.value = '';
    });

    el('btnCsvPick').addEventListener('click', function () { el('csvFile').click(); });
    el('csvFile').addEventListener('change', function () {
      var file = this.files && this.files[0];
      if (!file) return;
      readFileAsText(file).then(function (text) {
        el('csvInput').value = text;
        parseCsvInput();
      }).catch(function () { toast('文件读取失败', 'error'); });
      this.value = '';
    });
    el('btnCsvParse').addEventListener('click', parseCsvInput);
    el('btnCsvCommit').addEventListener('click', commitImport);
    el('btnTemplate').addEventListener('click', downloadTemplate);

    /* ---- 云同步设置 ---- */
    var btnSyncSave = el('btnSyncSave');
    if (btnSyncSave) {
      btnSyncSave.addEventListener('click', function () {
        var endpoint = el('syncEndpoint') ? el('syncEndpoint').value : '';
        var anonKey = el('syncAnonKey') ? el('syncAnonKey').value : '';
        if (!String(endpoint).trim() || !String(anonKey).trim()) {
          toast('地址和密钥都要填才能连接', 'error');
          return;
        }
        btnSyncSave.disabled = true;
        testSyncConnection(endpoint, anonKey)
          .then(function () {
            SyncConfig.save(endpoint, anonKey);
            // 把自动补全后的地址回写，让用户看到真正生效的值
            if (el('syncEndpoint')) el('syncEndpoint').value = SYNC_CONFIG.endpoint;
            if (el('syncAnonKey')) el('syncAnonKey').value = SYNC_CONFIG.anonKey;
            Sync.stop();
            Sync.cursor = null;
            Sync.start();
            updateStatusBar();
            updateSyncPanel();
            toast('已连接云端，正在拉取大家的评价');
          })
          .catch(function (err) {
            toast('连接失败：' + (err && err.message ? err.message : '未知错误'), 'error');
            updateSyncPanel(true);
          })
          .then(function () { btnSyncSave.disabled = false; });
      });
    }

    var btnSyncTest = el('btnSyncTest');
    if (btnSyncTest) {
      btnSyncTest.addEventListener('click', function () {
        var endpoint = el('syncEndpoint') ? el('syncEndpoint').value : '';
        var anonKey = el('syncAnonKey') ? el('syncAnonKey').value : '';
        btnSyncTest.disabled = true;
        testSyncConnection(endpoint, anonKey)
          .then(function () { toast('连接正常，表也建好了'); })
          .catch(function (err) { toast('测试失败：' + (err && err.message ? err.message : '未知错误'), 'error'); })
          .then(function () { btnSyncTest.disabled = false; });
      });
    }

    var btnSyncNow = el('btnSyncNow');
    if (btnSyncNow) {
      btnSyncNow.addEventListener('click', function () {
        if (!Sync.enabled()) {
          toast('还没连接云端，先填地址和密钥', 'warn');
          return;
        }
        Sync.tick();
        toast('正在同步…');
      });
    }

    var btnSyncSql = el('btnSyncSql');
    if (btnSyncSql) {
      btnSyncSql.addEventListener('click', function () {
        copyText(SYNC_SQL)
          .then(function () { toast('建表 SQL 已复制，去 Supabase 的 SQL Editor 粘贴执行'); })
          .catch(function () { toast('复制失败，请手动从 README 里复制 SQL', 'error'); });
      });
    }

    var btnSyncDisconnect = el('btnSyncDisconnect');
    if (btnSyncDisconnect) {
      btnSyncDisconnect.addEventListener('click', function () {
        askConfirm('断开云端？', '<p style="margin:0;font-size:13px;color:var(--ink-soft)">断开后评价只保存在本机，已经同步上去的数据不会被删除。</p>', '断开').then(function (ok) {
          if (!ok) return;
          Sync.stop();
          SyncConfig.save('', '');
          updateStatusBar();
          updateSyncPanel();
          toast('已断开云端，回到本地模式', 'warn');
        });
      });
    }

    var btnSaveMapKey = el('btnSaveMapKey');
    if (btnSaveMapKey) {
      btnSaveMapKey.addEventListener('click', function () {
        var key = el('mapKeyInput') ? el('mapKeyInput').value.trim() : '';
        if (!key) { toast('先把 Key 填上', 'warn'); return; }
        btnSaveMapKey.disabled = true;
        fetch(withShareCode(location.origin + '/api/mapkey'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key: key })
        }).then(function (r) {
          if (!r.ok) throw new Error('HTTP ' + r.status);
          return r.json();
        }).then(function () {
          if (el('mapKeyInput')) el('mapKeyInput').value = '';
          toast('已保存，刷新页面后搜索就能用了');
          refreshMapKeyPanel();
        }).catch(function (err) {
          toast('保存失败：' + (err && err.message ? err.message : '网络错误'), 'error');
        }).then(function () { btnSaveMapKey.disabled = false; });
      });
    }


    var btnAdminLogin = el('btnAdminLogin');
    if (btnAdminLogin) {
      btnAdminLogin.addEventListener('click', function () {
        var code = el('adminCode') ? el('adminCode').value.trim() : '';
        if (!code) { toast('先输入口令', 'warn'); return; }
        btnAdminLogin.disabled = true;
        adminApi('login', { code: code })
          .then(function (data) {
            setAdminToken(data.token);
            ui.adminExp = data.expiresAt || 0;
            if (el('adminCode')) el('adminCode').value = '';
            var err2 = el('adminLoginErr');
            if (err2) err2.textContent = '';
            closeModal('modalAdminLogin');
            updateAdminUI();
            openDataModal();
            renderList();
            var c = getRestaurant(ui.selectedId);
            if (c) renderDrawer(c);
            toast('已进入管理模式');
          })
          .catch(function (e) {
            var err3 = el('adminLoginErr');
            if (err3) err3.textContent = '登录失败：' + (e.message || '网络错误');
          })
          .then(function () { btnAdminLogin.disabled = false; });
      });
    }

    var adminCodeInput = el('adminCode');
    if (adminCodeInput) {
      adminCodeInput.addEventListener('keydown', function (evt) {
        if (evt.key === 'Enter') {
          evt.preventDefault();
          var btn = el('btnAdminLogin');
          if (btn) btn.click();
        }
      });
    }

    var btnAdminMemberSave = el('btnAdminMemberSave');
    if (btnAdminMemberSave) {
      btnAdminMemberSave.addEventListener('click', function () {
        var v = el('adminMemberCode') ? el('adminMemberCode').value.trim() : '';
        if (!v) {
          askConfirm('关闭社团口令？',
            '<p style="margin:0;font-size:13px;color:var(--ink-soft)">关闭后，任何拿到链接的人都能写评价和加店。</p>',
            '确认关闭').then(function (ok) {
            if (!ok) return;
            saveMemberCode(v);
          });
          return;
        }
        saveMemberCode(v);
      });
    }

    var btnMemberSave = el('btnMemberSave');
    if (btnMemberSave) {
      btnMemberSave.addEventListener('click', function () {
        var v = el('memberCode') ? el('memberCode').value.trim() : '';
        if (!v) { toast('先填口令', 'warn'); return; }
        setMemberCode(v);
        toast('社团口令已保存');
      });
    }

    var btnMemberClear = el('btnMemberClear');
    if (btnMemberClear) {
      btnMemberClear.addEventListener('click', function () {
        setMemberCode('');
        if (el('memberCode')) el('memberCode').value = '';
        toast('已清除社团口令', 'warn');
      });
    }

    var btnAdminLogout = el('btnAdminLogout');
    if (btnAdminLogout) {
      btnAdminLogout.addEventListener('click', function () {
        adminApi('logout').catch(function () { return null; }).then(function () {
          setAdminToken('');
          renderList();
          toast('已退出管理模式', 'warn');
        });
      });
    }

    var btnAdminChange = el('btnAdminChange');
    if (btnAdminChange) {
      btnAdminChange.addEventListener('click', function () {
        var next = el('adminNewCode') ? el('adminNewCode').value.trim() : '';
        if (next.length < 6) { toast('新口令至少 6 位', 'warn'); return; }
        btnAdminChange.disabled = true;
        adminApi('change-code', { code: next })
          .then(function (data) {
            setAdminToken(data.token);
            if (el('adminNewCode')) el('adminNewCode').value = '';
            toast('口令已更新，其他设备需要重新登录');
          })
          .catch(function (e) { toast('修改失败：' + (e.message || '网络错误'), 'error'); })
          .then(function () { btnAdminChange.disabled = false; });
      });
    }

    // 「已删除店铺」的恢复按钮在数据管理弹层里，必须单独委托
    var modalDataNode = el('modalData');
    if (modalDataNode) {
      modalDataNode.addEventListener('click', function (evt) {
        var btn = closestOf(evt.target, '[data-admin-restore-shop]');
        if (!btn) return;
        restoreShopById(btn.getAttribute('data-admin-restore-shop'));
      });
    }

    var btnPurge = el('btnAdminPurge');
    if (btnPurge) {
      btnPurge.addEventListener('click', function () {
        var drop = el('purgeDropPhotos') ? el('purgeDropPhotos').checked : false;
        askConfirm('永久清理？',
          '<p style="margin:0 0 8px;font-size:13px;color:var(--ink-soft)">会先自动导出一份 JSON 快照到你的电脑，然后把 <b>已删除的店铺、已删除的评价、孤儿评价</b> 从服务器<b>物理删除</b>。</p>' +
          (drop ? '<p style="margin:0 0 8px;font-size:13px;color:var(--danger)">你勾选了清空照片：所有评价的照片引用都会被移除。</p>' : '') +
          '<p style="margin:0;font-size:12px;color:var(--danger)">这一步不可撤销，只能靠刚才导出的快照重新导入。</p>',
          '我已备份，继续').then(function (ok) {
            if (!ok) return;
            exportJson();                       // 先落一份快照，留退路
            btnPurge.disabled = true;
            adminApi('purge', { dropPhotos: drop })
              .then(function () { return resyncFromServer(); })
              .then(function () { toast('清理完成'); })
              .catch(function (e) { toast('清理失败：' + (e.message || '网络错误'), 'error'); })
              .then(function () { btnPurge.disabled = false; });
          });
      });
    }

    el('btnRestoreSeed').addEventListener('click', function () {
      askConfirm('恢复示例数据？', '<p style="margin:0;font-size:13px;color:var(--ink-soft)">当前的本地数据会被示例数据覆盖，建议先导出 JSON 备份。</p>', '恢复示例').then(function (ok) {
        if (!ok) return;
        state = seedState();
        closeDrawer();
        saveState();
        rebuildAggregates();
        renderList();
        if (MapCtl.ready) MapCtl.sync();
        updateStorageInfo();
        toast('已恢复 25 家示例店铺');
      });
    });

    el('btnClearAll').addEventListener('click', function () {
      askConfirm('清空全部数据？',
        '<p style="margin:0 0 8px;font-size:13px;color:var(--ink-soft)">店铺、评价、照片索引都会被清空。这一步不可撤销，确定要继续吗？</p>' +
        '<p style="margin:0;font-size:12px;color:var(--danger)">建议先「导出 JSON 快照」。</p>',
        '我确定，清空').then(function (ok) {
          if (!ok) return;
          state = { version: 1, restaurants: [], reviews: [], meta: { lastSyncAt: null, pendingSync: [], pendingRestaurants: [], nickname: state.meta.nickname || '', clearedAt: nowIso() } };
          closeDrawer();
          saveState();
          rebuildAggregates();
          renderList();
          if (MapCtl.ready) MapCtl.sync();
          updateStorageInfo();
          toast('已清空全部数据', 'warn');
        });
    });

    el('confirmOk').addEventListener('click', function () { resolveConfirm(true); });

    // 键盘
    document.addEventListener('keydown', function (evt) {
      // 回复框里按回车直接发送
      if (evt.key === 'Enter' && evt.target && evt.target.getAttribute && evt.target.getAttribute('data-reply-input')) {
        evt.preventDefault();
        var rid2 = evt.target.getAttribute('data-reply-input');
        addReply(rid2, evt.target.value);
        return;
      }
      if (evt.key === 'Escape') {
        if (ui.pickMode) {
          stopPickMode();
          MapCtl.clearPreview();
          renderRestaurantForm();
          openModal('modalRestaurant');
          return;
        }
        closeTopLayer();
      }
    });

    // 在线 / 离线
    window.addEventListener('online', function () {
      updateStatusBar();
      toast('网络恢复了，正在尝试同步');
      Sync.tick();
    });
    window.addEventListener('offline', function () {
      updateStatusBar();
      toast('已进入离线模式，改动会暂存在本机', 'warn');
    });

    // 多标签页
    if (typeof BroadcastChannel === 'function') {
      try {
        channel = new BroadcastChannel(CHANNEL_NAME);
        channel.onmessage = function (evt) {
          if (evt && evt.data && evt.data.type === 'state') {
            applyRemoteState(evt.data.payload, '另一个标签页更新了数据，已同步');
          }
        };
      } catch (e) {
        channel = null;
      }
    }

    window.addEventListener('storage', function (evt) {
      if (evt.key !== STORAGE_KEY || !evt.newValue) return;
      try {
        applyRemoteState(JSON.parse(evt.newValue), '另一个标签页更新了数据，已同步');
      } catch (e) { /* 忽略坏数据 */ }
    });
  }

  function toggleTier(key) {
    if (key === '__all') {
      ui.tiers = [];
    } else {
      var idx = ui.tiers.indexOf(key);
      if (idx >= 0) ui.tiers.splice(idx, 1);
      else ui.tiers.push(key);
    }
    renderList();
    if (MapCtl.ready) MapCtl.sync();
  }

  function locateUser() {
    if (!navigator.geolocation) {
      toast('这个浏览器不支持定位，已回到全城视野', 'warn');
      MapCtl.reset();
      return;
    }
    toast('正在获取位置…');
    navigator.geolocation.getCurrentPosition(function (pos) {
      var gcj = GCJ.wgs2gcj(pos.coords.latitude, pos.coords.longitude);
      MapCtl.focus(gcj.lat, gcj.lng, 15);
      MapCtl.sync();
      var nearest = null;
      var best = Infinity;
      state.restaurants.forEach(function (r) {
        var d = haversine(gcj, { lat: r.lat, lng: r.lng });
        if (d < best) { best = d; nearest = r; }
      });
      if (nearest && best < 30) toast('已定位，最近的店：' + nearest.name + '（' + (best < 1 ? Math.round(best * 1000) + ' m' : best.toFixed(1) + ' km') + '）');
      else toast('已定位到你的位置');
    }, function () {
      toast('没有拿到定位权限，已回到全城视野', 'warn');
      MapCtl.reset();
    }, { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 });
  }

  /** 数据管理是管理员专属：没登录就先弹口令框 */
  function requestDataModal() {
    if (ui.isAdmin) { openDataModal(); return; }
    var err = el('adminLoginErr');
    if (err) err.textContent = '';
    openModal('modalAdminLogin');
    var input = el('adminCode');
    if (input) {
      input.value = '';
      window.setTimeout(function () { input.focus(); }, 60);
    }
  }

  function openDataModal() {
    el('syncModeLabel').textContent = SYNC_CONFIG.mode;
    el('dataSub').textContent = '本机版本 · ' + state.restaurants.length + ' 家店 / ' + state.reviews.length + ' 条评价';
    el('importPreview').innerHTML = '';
    el('importActions').hidden = true;
    ui.importDraft = null;
    updateSyncPanel();
    refreshMapKeyPanel();
    updateAdminUI();
    updateStorageInfo();
    openModal('modalData');
  }

  /* ========================================================================
   * 17. 启动
   * ====================================================================== */

  function renderAll() {
    renderHeroStats();
    renderTierChips();
    renderLegend();
    renderList();
    updateStatusBar();
    if (MapCtl.ready) MapCtl.sync();
  }

  function boot() {
    var purgeToast = false;
    el('heroCover').src = window.GINKGO_COVER || '';
    el('helpCover').src = window.GINKGO_COVER || '';

    var hadStored = false;
    try { hadStored = !!window.localStorage.getItem(STORAGE_KEY); } catch (e) { hadStored = false; }

    state = loadState();
    if (!state.meta.lastSyncAt) state.meta.lastSyncAt = nowIso();

    // 一次性清掉早期内置的示例评价（店铺保留，分数从此只来自真实打分）
    if (!state.meta.seedPurged) {
      var beforePurge = state.reviews.length;
      state.reviews = state.reviews.filter(function (rv) { return rv.source !== 'seed'; });
      state.meta.seedPurged = true;
      sanitizeRepairCount += 1;   // 借这个标记触发下面的落盘
      if (beforePurge !== state.reviews.length) purgeToast = true;
    }

    rebuildAggregates();
    renderHelpTierTable();
    bindGlobalEvents();
    renderAll();
    bootMap();
    Sync.start();
    autoDetectBackend();
    verifyAdmin();
    refreshMemberState();

    // 首次进入把示例数据落盘（状态条时间才有意义）；
    // 若加载时清洗掉了非法 id，也一并写回，避免脏数据一直留在本机。
    if (!hadStored || sanitizeRepairCount > 0) {
      saveState();
      sanitizeRepairCount = 0;
    }
    if (purgeToast) toast('已清除示例评价，分数从现在起只算真实打分');

    // PWA：注册 Service Worker，让手机/电脑可以把网页"安装"成应用
    if ('serviceWorker' in navigator && location.protocol === 'https:') {
      window.addEventListener('load', function () {
        navigator.serviceWorker.register(withShareCode('./sw.js')).catch(function () { /* 不支持就算了 */ });
      });
    }

    // 首次访问给一句提示，之后不再打扰
    var seen = false;
    try { seen = window.localStorage.getItem('ginkgo.foodmap.seen') === '1'; } catch (e) { seen = false; }
    if (!seen) {
      try { window.localStorage.setItem('ginkgo.foodmap.seen', '1'); } catch (e) { /* 忽略 */ }
      setTimeout(function () {
        toast('欢迎！点地图上的杯子看店铺，点「写评价」可以给店打分');
      }, 700);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
