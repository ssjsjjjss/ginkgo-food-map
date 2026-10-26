/**
 * 零依赖 CDP 驱动：启动本机 Chrome headless，通过 DevTools Protocol 执行断言。
 * 仅用 Node 22 内建 WebSocket / fetch，不引入 puppeteer、playwright。
 */
'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const CHROME_CANDIDATES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
];

function findChrome() {
  for (const p of CHROME_CANDIDATES) if (fs.existsSync(p)) return p;
  return null;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForDevtools(port, timeoutMs) {
  const deadline = Date.now() + (timeoutMs || 20000);
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/list`);
      const list = await res.json();
      const page = list.find((t) => t.type === 'page');
      if (page && page.webSocketDebuggerUrl) return page;
    } catch (e) { /* 还没起来 */ }
    await sleep(250);
  }
  throw new Error('DevTools 未在超时时间内就绪（Chrome 可能被环境阻止启动）');
}

class CDP {
  constructor(ws) {
    this.ws = ws;
    this.seq = 0;
    this.pending = new Map();
    this.events = [];
    this.listeners = [];
    ws.addEventListener('message', (ev) => {
      let msg;
      try { msg = JSON.parse(typeof ev.data === 'string' ? ev.data : ev.data.toString()); } catch { return; }
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(JSON.stringify(msg.error)));
        else resolve(msg.result);
        return;
      }
      if (msg.method) {
        this.events.push(msg);
        this.listeners.forEach((fn) => fn(msg));
      }
    });
  }

  on(fn) { this.listeners.push(fn); }

  send(method, params) {
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params: params || {} }));
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error('CDP 超时: ' + method));
        }
      }, 30000);
    });
  }

  async evaluate(expression) {
    const r = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
      userGesture: true,
    });
    if (r.exceptionDetails) {
      throw new Error('页面内脚本异常: ' + (r.exceptionDetails.exception && r.exceptionDetails.exception.description
        || r.exceptionDetails.text));
    }
    return r.result.value;
  }
}

async function launch(opts) {
  const o = opts || {};
  const bin = findChrome();
  if (!bin) throw new Error('未找到 Chrome/Edge 可执行文件');
  const port = o.port || 9333;
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-cdp-'));
  const args = [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--disable-background-networking',
    '--disable-sync',
    '--hide-scrollbars',
    '--user-data-dir=' + profile,
    '--remote-debugging-port=' + port,
    o.mobile ? '--window-size=390,844' : '--window-size=1280,900',
    'about:blank',
  ];
  const proc = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = '';
  proc.stderr.on('data', (d) => { stderr += d.toString(); });
  proc.on('error', (e) => { stderr += 'spawn error: ' + e.message; });

  const page = await waitForDevtools(port, o.timeout || 25000);
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', (e) => reject(new Error('WebSocket 连接失败: ' + (e.message || e.type))), { once: true });
  });
  const cdp = new CDP(ws);
  cdp.events.length = 0;

  await cdp.send('Runtime.enable');
  await cdp.send('Page.enable');
  await cdp.send('Log.enable');

  cdp.close = async () => {
    try { ws.close(); } catch (e) { /* ignore */ }
    try { proc.kill(); } catch (e) { /* ignore */ }
    await sleep(300);
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) { /* ignore */ }
  };
  cdp.stderr = () => stderr;
  cdp.binPath = bin;
  return cdp;
}

/** 导航并等待 load 完成 */
async function goto(cdp, url, waitMs) {
  const loaded = new Promise((resolve) => {
    const t = setTimeout(resolve, 15000);
    cdp.on((msg) => {
      if (msg.method === 'Page.loadEventFired') { clearTimeout(t); resolve(); }
    });
  });
  await cdp.send('Page.navigate', { url });
  await loaded;
  await sleep(waitMs == null ? 900 : waitMs);
}

/** 收集 console / pageerror 记录 */
function collectErrors(cdp) {
  const consoleErrors = [];
  const pageErrors = [];
  cdp.on((msg) => {
    if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
      consoleErrors.push((msg.params.args || []).map((a) => a.value || a.description || a.type).join(' '));
    }
    if (msg.method === 'Runtime.exceptionThrown') {
      const d = msg.params.exceptionDetails;
      pageErrors.push((d.exception && (d.exception.description || d.exception.value)) || d.text);
    }
    if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') {
      pageErrors.push('[log] ' + msg.params.entry.text);
    }
  });
  return { consoleErrors, pageErrors };
}

module.exports = { launch, goto, collectErrors, findChrome, sleep };
