/**
 * Ginkgo 美食地图 · 同站点轻量后端
 *
 * 解决三件事：
 *   1. 静态托管 index.html（发布用）
 *   2. 提供 /api/restaurants 与 /api/reviews，语义对齐前端已在用的 PostgREST 子集
 *   3. 服务端注入腾讯地图 Key（Key 存在 data/config.json，不打进前端源码、也不对外提供）
 *
 * 启动：PORT=3000 node server.js
 */
'use strict';

const crypto = require('crypto');
const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data');
const STORE_FILE = path.join(DATA_DIR, 'store.json');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');
const PORT = Number(process.env.PORT) || 3000;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.md': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8'
};

/** 不对外提供的文件：后端代码、数据、配置 */
const BLOCKED = new Set(['server.js', 'data', 'build', 'qa', 'package.json', 'package-lock.json']);

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    return fallback;
  }
}

function writeJson(file, value) {
  ensureDir();
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

function loadStore() {
  const s = readJson(STORE_FILE, null);
  if (s && Array.isArray(s.restaurants) && Array.isArray(s.reviews)) return s;
  return { restaurants: [], reviews: [] };
}

function loadConfig() {
  return readJson(CONFIG_FILE, {});
}

function send(res, code, body, type) {
  res.writeHead(code, {
    'Content-Type': type || 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS'
  });
  res.end(body);
}

/* ------------------------- PostgREST 子集 ------------------------- */

function applyQuery(rows, query) {
  let out = rows.slice();
  const gt = query.get('updated_at');
  if (gt && gt.indexOf('gt.') === 0) {
    const since = Date.parse(gt.slice(3));
    if (!isNaN(since)) out = out.filter((r) => (Date.parse(r.updated_at || r.updatedAt) || 0) > since);
  }
  const order = query.get('order');
  if (order) {
    const [col, dir] = order.split('.');
    const key = col === 'updated_at' ? 'updated_at' : col;
    out.sort((a, b) => {
      const av = a[key], bv = b[key];
      const an = Date.parse(av), bn = Date.parse(bv);
      const cmp = (!isNaN(an) && !isNaN(bn)) ? an - bn : String(av).localeCompare(String(bv));
      return dir === 'desc' ? -cmp : cmp;
    });
  }
  const limit = Number(query.get('limit'));
  if (isFinite(limit) && limit > 0) out = out.slice(0, limit);
  return out;
}

function upsert(table, rows) {
  const store = loadStore();
  const list = store[table] || [];
  let changed = 0;
  rows.forEach((row) => {
    if (!row || typeof row !== 'object' || !row.id) return;
    const i = list.findIndex((r) => r.id === row.id);
    if (i >= 0) { list[i] = Object.assign({}, list[i], row); }
    else { list.push(row); }
    changed += 1;
  });
  store[table] = list;
  writeJson(STORE_FILE, store);
  return changed;
}


/* ------------------------- 管理员口令 / 会话 ------------------------- */

// 代码里只放哈希：即使拿到源码也看不到口令本身。
// 这里只是**首次部署**的初始口令哈希；线上真正生效的是 data/config.json 里那份
// （用「修改口令」改过之后就以 config.json 为准），data/ 不进仓库。
// 初始口令只在社团内部交接时口头/共享文档传递，不写进仓库。
const ADMIN_SALT = 'cfc12bf075db5891';
const ADMIN_HASH = '290f1300a32f028725a9c142ca7b63a5c5108f9e828d5ffe9ac156c2058a43f8';
const SESSION_TTL_MS = 7 * 24 * 3600 * 1000;
const LOGIN_WINDOW_MS = 10 * 60 * 1000;
const LOGIN_MAX_TRIES = 8;
const loginTries = new Map();

function hashCode(code, salt) {
  return crypto.scryptSync(String(code), salt, 32).toString('hex');
}

function sameHash(a, b) {
  try {
    const ba = Buffer.from(String(a), 'hex');
    const bb = Buffer.from(String(b), 'hex');
    return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
  } catch (e) { return false; }
}

function adminState() {
  const cfg = loadConfig();
  if (!cfg.admin || typeof cfg.admin !== 'object') {
    cfg.admin = { salt: ADMIN_SALT, hash: ADMIN_HASH, sessions: {} };
    try { writeJson(CONFIG_FILE, cfg); } catch (e) { /* 只读环境忽略 */ }
  }
  if (!cfg.admin.sessions || typeof cfg.admin.sessions !== 'object') cfg.admin.sessions = {};
  return cfg;
}

function saveAdmin(admin) {
  const cfg = loadConfig();
  cfg.admin = admin;
  writeJson(CONFIG_FILE, cfg);
}

function requireAdmin(req) {
  const cfg = adminState();
  const raw = req.headers['x-admin-token'];
  const token = typeof raw === 'string' ? raw.trim() : '';
  if (!token) return null;
  const exp = cfg.admin.sessions[token];
  if (!exp || exp < Date.now()) return null;
  return { token: token, expiresAt: exp, admin: cfg.admin };
}

function readJsonBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (c) => { body += c; if (body.length > 200000) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(body || '{}')); } catch (e) { resolve(null); } });
  });
}

async function handleAdmin(req, res, table) {
  const cfg = adminState();

  if (table === 'admin/login' && req.method === 'POST') {
    const ip = req.socket.remoteAddress || 'unknown';
    const rec = loginTries.get(ip) || { count: 0, since: Date.now() };
    if (Date.now() - rec.since > LOGIN_WINDOW_MS) { rec.count = 0; rec.since = Date.now(); }
    if (rec.count >= LOGIN_MAX_TRIES) {
      return send(res, 429, JSON.stringify({ error: '尝试次数过多，请 10 分钟后再试' }));
    }
    const body = await readJsonBody(req);
    const code = String((body && body.code) || '').trim();
    if (!code || !sameHash(hashCode(code, cfg.admin.salt), cfg.admin.hash)) {
      rec.count += 1;
      loginTries.set(ip, rec);
      return send(res, 401, JSON.stringify({ error: '口令不对' }));
    }
    rec.count = 0;
    loginTries.set(ip, rec);
    const token = crypto.randomBytes(24).toString('hex');
    cfg.admin.sessions[token] = Date.now() + SESSION_TTL_MS;
    Object.keys(cfg.admin.sessions).forEach((k) => {
      if (cfg.admin.sessions[k] < Date.now()) delete cfg.admin.sessions[k];
    });
    saveAdmin(cfg.admin);
    return send(res, 200, JSON.stringify({ ok: true, token: token, expiresAt: cfg.admin.sessions[token] }));
  }

  if (table === 'admin/session' && req.method === 'GET') {
    const hit = requireAdmin(req);
    if (!hit) return send(res, 401, JSON.stringify({ ok: false }));
    return send(res, 200, JSON.stringify({ ok: true, expiresAt: hit.expiresAt }));
  }

  if (table === 'admin/logout' && req.method === 'POST') {
    const hit = requireAdmin(req);
    if (hit) { delete hit.admin.sessions[hit.token]; saveAdmin(hit.admin); }
    return send(res, 200, JSON.stringify({ ok: true }));
  }

  if (table === 'admin/change-code' && req.method === 'POST') {
    const hit = requireAdmin(req);
    if (!hit) return send(res, 401, JSON.stringify({ error: '未登录' }));
    const body = await readJsonBody(req);
    const next = String((body && body.code) || '').trim();
    if (next.length < 6) return send(res, 400, JSON.stringify({ error: '口令至少 6 位' }));
    const salt = crypto.randomBytes(8).toString('hex');
    hit.admin.salt = salt;
    hit.admin.hash = hashCode(next, salt);
    hit.admin.sessions = {};                       // 改口令后旧会话全部作废
    const fresh = crypto.randomBytes(24).toString('hex');
    hit.admin.sessions[fresh] = Date.now() + SESSION_TTL_MS;
    saveAdmin(hit.admin);
    return send(res, 200, JSON.stringify({ ok: true, token: fresh }));
  }

  if (table === 'admin/review' && req.method === 'POST') {
    if (!requireAdmin(req)) return send(res, 401, JSON.stringify({ error: '未登录' }));
    const body = await readJsonBody(req);
    const id = String((body && body.id) || '');
    const action = String((body && body.action) || '');
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(id) || (action !== 'delete' && action !== 'restore')) {
      return send(res, 400, JSON.stringify({ error: '参数不对' }));
    }
    const store = loadStore();
    const idx = store.reviews.findIndex((r) => r.id === id);
    if (idx < 0) return send(res, 404, JSON.stringify({ error: '评价不存在' }));
    store.reviews[idx] = Object.assign({}, store.reviews[idx], {
      deleted: action === 'delete',
      updated_at: new Date().toISOString()
    });
    writeJson(STORE_FILE, store);
    return send(res, 200, JSON.stringify({ ok: true, deleted: action === 'delete' }));
  }

  if (table === 'admin/restaurant' && req.method === 'POST') {
    if (!requireAdmin(req)) return send(res, 401, JSON.stringify({ error: '未登录' }));
    const body = await readJsonBody(req);
    const id = String((body && body.id) || '');
    const action = String((body && body.action) || '');
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(id) || (action !== 'delete' && action !== 'restore')) {
      return send(res, 400, JSON.stringify({ error: '参数不对' }));
    }
    const store = loadStore();
    const idx = store.restaurants.findIndex((r) => r.id === id);
    if (idx < 0) return send(res, 404, JSON.stringify({ error: '店铺不存在' }));
    store.restaurants[idx] = Object.assign({}, store.restaurants[idx], { deleted: action === 'delete' });
    writeJson(STORE_FILE, store);
    return send(res, 200, JSON.stringify({ ok: true, deleted: action === 'delete' }));
  }

  if (table === 'admin/purge' && req.method === 'POST') {
    if (!requireAdmin(req)) return send(res, 401, JSON.stringify({ error: '未登录' }));
    const body = await readJsonBody(req);
    const dropPhotos = !!(body && body.dropPhotos);
    const store = loadStore();
    const before = { restaurants: store.restaurants.length, reviews: store.reviews.length };

    // 1) 物理移除已软删除的店铺
    store.restaurants = store.restaurants.filter((r) => !r.deleted);
    // 2) 物理移除已软删除的评价
    store.reviews = store.reviews.filter((r) => !r.deleted);
    // 3) 移除指向不存在店铺的孤儿评价
    const alive = new Set(store.restaurants.map((r) => r.id));
    store.reviews = store.reviews.filter((r) => alive.has(r.restaurant_id));
    // 4) 可选：清空所有照片（照片最占空间）
    if (dropPhotos) {
      store.reviews.forEach((r) => { r.photos = []; });
    }
    writeJson(STORE_FILE, store);
    return send(res, 200, JSON.stringify({
      ok: true,
      removedRestaurants: before.restaurants - store.restaurants.length,
      removedReviews: before.reviews - store.reviews.length,
      droppedPhotos: dropPhotos,
      remaining: { restaurants: store.restaurants.length, reviews: store.reviews.length }
    }));
  }

  if (table === 'admin/member-code' && req.method === 'POST') {
    if (!requireAdmin(req)) return send(res, 401, JSON.stringify({ error: '未登录' }));
    const body = await readJsonBody(req);
    const code = String((body && body.code) || '').trim();
    const cfgNow = loadConfig();
    if (!code) {
      cfgNow.member = { enabled: false };
      writeJson(CONFIG_FILE, cfgNow);
      return send(res, 200, JSON.stringify({ ok: true, enabled: false }));
    }
    if (code.length < 4) return send(res, 400, JSON.stringify({ error: '社团口令至少 4 位' }));
    const salt = crypto.randomBytes(8).toString('hex');
    cfgNow.member = { enabled: true, salt: salt, hash: hashCode(code, salt) };
    writeJson(CONFIG_FILE, cfgNow);
    return send(res, 200, JSON.stringify({ ok: true, enabled: true }));
  }

  send(res, 404, JSON.stringify({ error: 'not found' }));
}

function handleApi(req, res, pathname, query) {
  const table = pathname.replace(/^\/api\//, '');

  if (table.indexOf('admin/') === 0) {
    return handleAdmin(req, res, table).catch(function (e) {
      send(res, 500, JSON.stringify({ error: String(e && e.message || e) }));
    });
  }

  if (table === 'health') {
    const store = loadStore();
    const cfg = loadConfig();
    return send(res, 200, JSON.stringify({
      ok: true,
      restaurants: store.restaurants.length,
      reviews: store.reviews.length,
      mapKey: !!cfg.tmapKey,
      memberRequired: !!(cfg.member && cfg.member.enabled)
    }));
  }

  if (table === 'mapkey') {
    if (req.method === 'GET') {
      const cfg = loadConfig();
      return send(res, 200, JSON.stringify({ configured: !!cfg.tmapKey }));
    }
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      let payload = {};
      try { payload = JSON.parse(body || '{}'); } catch (e) { return send(res, 400, '{"error":"bad json"}'); }
      const key = String(payload.key || '').trim();
      if (!/^[A-Za-z0-9-]{10,64}$/.test(key)) return send(res, 400, '{"error":"key format"}');
      const cfg = loadConfig();
      cfg.tmapKey = key;
      writeJson(CONFIG_FILE, cfg);
      send(res, 200, JSON.stringify({ ok: true }));
    });
    return;
  }

  // 社团口令开启后，写操作（新增/修改店铺与评价）必须带上，否则 401
  if ((table === 'restaurants' || table === 'reviews') && req.method === 'POST') {
    const cfgNow = loadConfig();
    const mem = cfgNow.member;
    if (mem && mem.enabled) {
      const code = req.headers['x-member-code'];
      if (typeof code !== 'string' || !sameHash(hashCode(code, mem.salt), mem.hash)) {
        return send(res, 401, JSON.stringify({ error: '需要社团口令' }));
      }
    }
  }

  if (table !== 'restaurants' && table !== 'reviews') {
    return send(res, 404, JSON.stringify({ message: 'relation does not exist' }));
  }

  if (req.method === 'GET') {
    const store = loadStore();
    return send(res, 200, JSON.stringify(applyQuery(store[table] || [], query)));
  }

  if (req.method === 'POST') {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      let parsed;
      try { parsed = JSON.parse(body || '[]'); } catch (e) { return send(res, 400, '{"error":"bad json"}'); }
      const rows = Array.isArray(parsed) ? parsed : [parsed];
      const n = upsert(table, rows);
      send(res, 201, JSON.stringify({ upserted: n }));
    });
    return;
  }

  send(res, 405, '');
}

/* ------------------------- 静态文件 + 地图 Key 注入 ------------------------- */

function serveIndex(res, sharecode) {
  let html;
  try {
    html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  } catch (e) {
    return send(res, 500, 'index.html missing', 'text/plain; charset=utf-8');
  }
  const cfg = loadConfig();
  if (cfg.tmapKey) {
    // 有 Key：去掉代理配置，并把 key 拼进 SDK 地址（Key 只存在服务端文件里）
    html = html.replace(/<!--__TMAP_BEGIN__-->[\s\S]*?<!--__TMAP_END__-->/, '<!-- 地图：Key 模式（服务端注入） -->');
    html = html.replace(
      'gljs?v=1.exp&libraries=service"',
      'gljs?v=1.exp&libraries=service&key=' + encodeURIComponent(cfg.tmapKey) + '"'
    );
  }
  // 分享码校验会拦住不带参数的静态资源，这里按当前请求的 sharecode 补上
  if (sharecode) {
    html = html.replace('href="./manifest.webmanifest"',
      'href="./manifest.webmanifest?sharecode=' + encodeURIComponent(sharecode) + '"');
    html = html.replace(/href="\.\/assets\/([^"?]+)"/g,
      'href="./assets/$1?sharecode=' + encodeURIComponent(sharecode) + '"');
  }
  send(res, 200, html, 'text/html; charset=utf-8');
}

/** manifest 里的图标同样要带分享码，否则 403 */
function serveManifest(res, sharecode) {
  let json;
  try {
    json = fs.readFileSync(path.join(ROOT, 'manifest.webmanifest'), 'utf8');
  } catch (e) {
    return send(res, 404, '{}', 'application/manifest+json; charset=utf-8');
  }
  if (sharecode) {
    json = json.replace(/"\.\/assets\/([^"?]+)"/g,
      '"./assets/$1?sharecode=' + encodeURIComponent(sharecode) + '"');
    // 仓库里 start_url 写的是 "./"（不含真实分享码，便于开源/公开）；
    // 部署后按当前请求带的分享码补全，装了 PWA 再点图标才能直接进得来。
    json = json.replace('"start_url": "./"',
      '"start_url": "./?sharecode=' + encodeURIComponent(sharecode) + '"');
  }
  send(res, 200, json, 'application/manifest+json; charset=utf-8');
}

function serveStatic(req, res, pathname, sharecode) {
  if (pathname === '/' || pathname === '/index.html') return serveIndex(res, sharecode);
  if (pathname === '/manifest.webmanifest') return serveManifest(res, sharecode);

  const rel = decodeURIComponent(pathname.replace(/^\//, ''));
  const first = rel.split('/')[0];
  if (BLOCKED.has(first) || rel.indexOf('..') >= 0) {
    return send(res, 404, 'not found', 'text/plain; charset=utf-8');
  }
  const file = path.join(ROOT, rel);
  if (!file.startsWith(ROOT)) return send(res, 403, 'forbidden', 'text/plain; charset=utf-8');
  fs.readFile(file, (err, buf) => {
    if (err) return send(res, 404, 'not found', 'text/plain; charset=utf-8');
    send(res, 200, buf, MIME[path.extname(file).toLowerCase()] || 'application/octet-stream');
  });
}

const server = http.createServer((req, res) => {
  let parsed;
  try {
    parsed = new URL(req.url, 'http://127.0.0.1');
  } catch (e) {
    return send(res, 400, 'bad request', 'text/plain; charset=utf-8');
  }
  const pathname = parsed.pathname || '/';

  if (req.method === 'OPTIONS') return send(res, 204, '');

  if (pathname.indexOf('/api/') === 0) {
    try {
      return handleApi(req, res, pathname, parsed.searchParams);
    } catch (e) {
      return send(res, 500, JSON.stringify({ error: String(e && e.message || e) }));
    }
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, '');
  serveStatic(req, res, pathname, parsed.searchParams.get('sharecode'));
});

ensureDir();
server.listen(PORT, '0.0.0.0', () => {
  console.log('[ginkgo] listening on 0.0.0.0:' + PORT);
});
