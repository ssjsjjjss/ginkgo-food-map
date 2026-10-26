/**
 * QA 独立校验 —— 种子店铺数据
 *
 * 背景：早期版本内置了 75 条"示例评价"，会把店直接刷成杯型。
 * 现在示例评价已移除，种子只保留店铺，分数必须完全来自真实打分。
 * 本套件用来守住这条底线。
 */
'use strict';

const T = require('./lib/assert');
const { loadSeed } = require('./lib/extract');

const { seed } = loadSeed();
const data = seed.buildSeed();
const R = data.restaurants;
const V = data.reviews;

/* ------------------------------ 1. 规模 ------------------------------ */
T.suite('种子数据规模');
T.eq(R.length, 25, '店铺数 = 25');
T.eq(V.length, 0, '不含任何示例评价（分数必须来自真实打分）');

/* ------------------------------ 2. 完整性 ------------------------------ */
T.suite('店铺字段完整性');
const ids = new Set();
let dup = 0;
let badName = 0;
let badAddr = 0;
for (const r of R) {
  if (ids.has(r.id)) dup += 1;
  ids.add(r.id);
  if (!r.name || typeof r.name !== 'string') badName += 1;
  if (typeof r.address !== 'string') badAddr += 1;
}
T.eq(dup, 0, 'id 无重复');
T.eq(badName, 0, '每家店都有名字');
T.eq(badAddr, 0, '每家店都有 address 字段（可为空字符串）');

/* ------------------------------ 3. 坐标 ------------------------------ */
T.suite('坐标合法性（成都市范围，GCJ-02）');
let outside = 0;
let nonNumber = 0;
for (const r of R) {
  if (typeof r.lat !== 'number' || typeof r.lng !== 'number' || !isFinite(r.lat) || !isFinite(r.lng)) {
    nonNumber += 1;
    continue;
  }
  if (r.lat < 30.4 || r.lat > 31.2 || r.lng < 103.6 || r.lng > 104.5) outside += 1;
}
T.eq(nonNumber, 0, '经纬度都是有效数字');
T.eq(outside, 0, '全部落在大成都范围');

/* ------------------------------ 4. 不许内置分数 ------------------------------ */
T.suite('店铺对象不得内置分数或杯型');
let hardcoded = 0;
for (const r of R) {
  if ('score' in r || 'tier' in r || 'avg' in r) hardcoded += 1;
}
T.eq(hardcoded, 0, '没有任何一家店写死 score / tier');

/* ------------------------------ 5. 语义 ------------------------------ */
T.suite('数据语义');
const catSet = new Set(R.map((r) => r.category));
T.ok(catSet.size >= 3, `分类不少于 3 种（实际 ${catSet.size} 种）`);
const allSeed = R.every((r) => r.source === 'seed');
T.ok(allSeed, '全部标记为 source=seed');
const closedCount = R.filter((r) => r.closed).length;
T.ok(closedCount >= 1, `至少有一家停业店用于展示灰色状态（实际 ${closedCount} 家）`);
const noCoord = R.filter((r) => !isFinite(r.lat) || !isFinite(r.lng)).length;
T.eq(noCoord, 0, '没有缺坐标的店');

T.summary('种子数据核验');
