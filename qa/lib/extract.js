/**
 * QA 独立测试支撑：从 index.html 中抽取脚本块并在 vm 沙箱里执行。
 * 不依赖 build/ 下的任何开发者产物。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..', '..');
const INDEX = path.join(ROOT, 'index.html');

function readHtml(file) {
  return fs.readFileSync(file || INDEX, 'utf8');
}

/** 抽出所有内联 <script> 块（不含 src=）的内容，附带起始行号 */
function inlineScripts(html) {
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/g;
  const out = [];
  let m;
  while ((m = re.exec(html)) !== null) {
    const attrs = m[1] || '';
    if (/\bsrc\s*=/.test(attrs)) continue;
    const startLine = html.slice(0, m.index).split('\n').length;
    out.push({ attrs: attrs.trim(), code: m[2], startLine, index: m.index });
  }
  return out;
}

function byId(html, id) {
  const blocks = inlineScripts(html);
  for (const b of blocks) {
    if (new RegExp('\\bid\\s*=\\s*["\']' + id + '["\']').test(b.attrs)) return b;
  }
  return null;
}

function byContent(html, needle) {
  const blocks = inlineScripts(html);
  for (const b of blocks) {
    if (b.code.includes(needle)) return b;
  }
  return null;
}

/** 在沙箱中执行一段代码，返回注入的 window 桩 */
function runCode(code, extraGlobals) {
  const sandbox = { window: {}, console, Date, Math, JSON, isFinite, Number, String, Array, Object };
  if (extraGlobals) Object.assign(sandbox, extraGlobals);
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { filename: 'extracted.js', timeout: 10000 });
  return sandbox;
}

/** 加载 window.GinkgoCore（第一个带 id="core" 的脚本块） */
function loadCore(html) {
  const h = html || readHtml();
  const block = byId(h, 'core');
  if (!block) throw new Error('未找到 <script id="core"> 块');
  const sandbox = runCode(block.code);
  if (!sandbox.window.GinkgoCore) throw new Error('core 块未挂载 window.GinkgoCore');
  return { core: sandbox.window.GinkgoCore, block };
}

/** 加载 window.SeedData（含 var RESTAURANTS 的脚本块） */
function loadSeed(html) {
  const h = html || readHtml();
  const block = byContent(h, 'var RESTAURANTS');
  if (!block) throw new Error('未找到种子数据脚本块');
  const sandbox = runCode(block.code);
  if (!sandbox.window.SeedData) throw new Error('seed 块未挂载 window.SeedData');
  return { seed: sandbox.window.SeedData, block };
}

module.exports = { ROOT, INDEX, readHtml, inlineScripts, byId, byContent, runCode, loadCore, loadSeed };
