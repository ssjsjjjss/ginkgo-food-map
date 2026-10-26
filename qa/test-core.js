/**
 * QA 独立单测 —— GinkgoCore 纯逻辑层
 * 全部断言由 QA 依据产品规格独立编写，未复用 build/test-core.js。
 */
'use strict';

const T = require('./lib/assert');
const { loadCore } = require('./lib/extract');

const { core } = loadCore();
const { TIERS, tierOf, overall, aggregate, parseDelimited, mapReviewRow, uid, fmtScore } = core;

/* ---------------------------------------------------------------- 1. tierOf */
T.suite('tierOf 阈值边界');
const boundary = [
  [8.6, '全家桶'],
  [8.5999, '超大杯'],
  [7.4, '超大杯'],
  [7.3999, '大杯'],
  [6.2, '大杯'],
  [6.1999, '中杯'],
  [5.0, '中杯'],
  [4.9999, '小杯'],
  [0, '小杯'],
  [10, '全家桶'],
  [-1, '小杯'],
];
for (const [v, label] of boundary) {
  const t = tierOf(v);
  T.eq(t && t.label, label, `tierOf(${v}) → ${label}`);
}
T.eq(tierOf(null), null, 'tierOf(null) → null（待评级）');
T.eq(tierOf(undefined), null, 'tierOf(undefined) → null');
T.eq(tierOf(NaN), null, 'tierOf(NaN) → null');
T.eq(tierOf('8.6'), null, 'tierOf("8.6") 字符串 → null（不做隐式转换）');
T.eq(tierOf(Infinity), null, 'tierOf(Infinity) → null');
T.eq(tierOf(10.01) && tierOf(10.01).label, '全家桶', 'tierOf(10.01) 超上限仍返回最高档（不抛错）');

T.suite('TIERS 定义');
T.eq(TIERS.length, 5, 'TIERS 共 5 档');
T.eq(TIERS.map((t) => t.label).join(','), '全家桶,超大杯,大杯,中杯,小杯', '档位名称与顺序');
T.eq(TIERS.map((t) => t.min).slice(0, 4).join(','), '8.6,7.4,6.2,5', '阈值 min 与规格一致');

/* -------------------------------------------------------------- 2. overall */
T.suite('overall 单条评价');
T.eq(overall({ taste: 7.875, value: 7.875, service: 7.875, ambience: 7.875 }), 7.88, '四项均 7.875 → 7.88（2 位精度）');
T.eq(overall({ taste: 10, value: 10, service: 10, ambience: 10 }), 10, '四项均 10 → 10');
T.eq(overall({ taste: 9, value: 8, service: 7, ambience: 6 }), 7.5, '9/8/7/6 → 7.5');
T.eq(overall({ taste: 8, value: 8, service: 8, ambience: 8 }), 8, '四项均 8 → 8');
T.eq(overall({ taste: 0, value: 0, service: 0, ambience: 0 }), 0, '四项均 0 → 0');
T.eq(overall({ taste: 8, value: 8, service: 8 }), null, '缺 ambience 一项 → null（四项必填）');
T.eq(overall({ taste: 8, value: 8, service: 8, ambience: '6' }), null, 'ambience 为字符串 → null');
T.eq(overall({ taste: 8, value: 8, service: 8, ambience: NaN }), null, 'ambience 为 NaN → null');
T.eq(overall(null), null, 'overall(null) → null');
T.eq(overall(undefined), null, 'overall(undefined) → null');
T.near(overall({ taste: 0.1, value: 0.2, service: 0.3, ambience: 0 }), 0.15, 1e-9, '浮点累积 (0.1+0.2+0.3)/4 → 0.15 无精度漂移');

/* ------------------------------------------------------------ 3. aggregate */
T.suite('aggregate 店铺聚合');
const emptyAgg = aggregate([]);
T.eq(emptyAgg.count, 0, '空数组 count = 0');
T.eq(emptyAgg.score, null, '空数组 score = null');
T.eq(emptyAgg.tier, null, '空数组 tier = null（待评级）');
T.eq(emptyAgg.recommendRate, null, '空数组 recommendRate = null');
T.throwsNot(() => aggregate([]), 'aggregate([]) 不抛错');
T.throwsNot(() => aggregate(null), 'aggregate(null) 不抛错');
T.throwsNot(() => aggregate(undefined, 'r01'), 'aggregate(undefined, id) 不抛错');

const mk = (id, dims, verdict) => ({
  restaurantId: id,
  scores: { taste: dims[0], value: dims[1], service: dims[2], ambience: dims[3] },
  verdict: verdict || 'recommend',
});

const single = aggregate([mk('a', [8, 8, 8, 8])]);
T.eq(single.count, 1, '单条 count = 1');
T.eq(single.score, 8, '单条 8.0 → score 8');
T.eq(single.tier.label, '超大杯', '单条 8.0 → 超大杯');

const twoA = aggregate([mk('a', [8.5, 8.5, 8.5, 8.5]), mk('a', [8.7, 8.7, 8.7, 8.7])]);
T.near(twoA.score, 8.6, 1e-9, '[8.5,8.7] 均值 = 8.6');
T.eq(twoA.tier.label, '全家桶', '[8.5,8.7] → 8.6 → 全家桶（边界命中）');

const twoB = aggregate([mk('a', [8.5, 8.5, 8.5, 8.5]), mk('a', [8.6, 8.6, 8.6, 8.6])]);
T.near(twoB.score, 8.55, 1e-9, '[8.5,8.6] 均值 = 8.55');
T.eq(twoB.tier.label, '超大杯', '[8.5,8.6] → 8.55 → 超大杯（不得四舍五入成 8.6 后误判全家桶）');

const five = aggregate([mk('a', [5, 5, 5, 5]), mk('a', [5, 5, 5, 5]), mk('a', [5, 5, 5, 5])]);
T.near(five.score, 5, 1e-9, '三条 5.0 均值 = 5.0');
T.eq(five.tier.label, '中杯', '三条 5.0 → 中杯（不得掉到 4.9999 小杯）');

/* 浮点陷阱：均值恰为 8.5999999999999996 时不得判为全家桶 */
const fp = aggregate([mk('a', [8.6, 8.6, 8.6, 8.5]), mk('a', [8.6, 8.6, 8.6, 8.5])]);
T.eq(fp.score < 8.6, true, '8.575×2 均值严格小于 8.6');
T.eq(fp.tier.label, '超大杯', '8.575 → 超大杯');

/* 过滤：只统计指定店铺 */
const mixed = [mk('a', [9, 9, 9, 9]), mk('b', [3, 3, 3, 3]), mk('a', [7, 7, 7, 7])];
const onlyA = aggregate(mixed, 'a');
T.eq(onlyA.count, 2, 'restaurantId 过滤后 count = 2');
T.near(onlyA.score, 8, 1e-9, 'restaurantId 过滤后 score = 8');

/* 推荐率 */
const rec = aggregate([mk('a', [8, 8, 8, 8], 'recommend'), mk('a', [8, 8, 8, 8], 'not_recommend'),
  mk('a', [8, 8, 8, 8], 'recommend'), mk('a', [8, 8, 8, 8], 'recommend')]);
T.near(rec.recommendRate, 0.75, 1e-9, '推荐率 = 3/4 = 0.75');
T.eq(rec.recommendCount, 3, 'recommendCount = 3');

/* 四项维度均值 */
const dimsAgg = aggregate([mk('a', [10, 8, 6, 4]), mk('a', [8, 8, 8, 8])]);
T.near(dimsAgg.dims.taste, 9, 1e-9, 'dims.taste 均值 = 9');
T.near(dimsAgg.dims.ambience, 6, 1e-9, 'dims.ambience 均值 = 6');

/* 无效评价应被跳过而非污染均值 */
const dirty = aggregate([mk('a', [8, 8, 8, 8]), { restaurantId: 'a', scores: { taste: 10 } }, null, { restaurantId: 'a' }]);
T.eq(dirty.count, 1, '残缺评价被跳过，count 仍为 1');
T.eq(dirty.score, 8, '残缺评价不影响均值');

/* ----------------------------------------------------- 4. parseDelimited */
T.suite('parseDelimited 分隔文本解析');
T.eq(parseDelimited(''), [], '空输入 → []');
T.eq(parseDelimited('a,b\nc,d'), [['a', 'b'], ['c', 'd']], '普通 CSV');
T.eq(parseDelimited('a\tb\nc\td'), [['a', 'b'], ['c', 'd']], '纯 TSV 自动识别制表符');
T.eq(parseDelimited('a;b;c'), [['a', 'b', 'c']], '分号自动识别');
T.eq(parseDelimited('a|b|c'), [['a', 'b', 'c']], '竖线自动识别');
T.eq(parseDelimited('\uFEFFa,b\nc,d'), [['a', 'b'], ['c', 'd']], 'BOM 被剥离（不去掉会在首列多出 \\uFEFF）');
T.eq(parseDelimited('a,b\r\nc,d\r\n'), [['a', 'b'], ['c', 'd']], 'CRLF 行尾且末行空行被丢弃');
T.eq(parseDelimited('a,b\rc,d'), [['a', 'b'], ['c', 'd']], '纯 CR 行尾');
T.eq(parseDelimited('name,text\n"张三","你好，世界"'), [['name', 'text'], ['张三', '你好，世界']], '引号内逗号不分割');
T.eq(parseDelimited('a,b\n"他说""好""",2'), [['a', 'b'], ['他说"好"', '2']], '"" 转义为单个双引号');
T.eq(parseDelimited('a,b\n"第一行\n第二行",2'), [['a', 'b'], ['第一行\n第二行', '2']], '引号内换行保留在单元格内');
T.eq(parseDelimited('a,b\n\n\nc,d'), [['a', 'b'], ['c', 'd']], '中间空行被丢弃');
T.eq(parseDelimited('仅在表头'), [['仅在表头']], '只有表头也能解析');
T.eq(parseDelimited('a,b\n  ,  '), [['a', 'b']], '纯空白行被丢弃');
T.eq(parseDelimited('a,b\n"  x  ",y'), [['a', 'b'], ['x', 'y']], '单元格首尾空白被 trim');
T.eq(parseDelimited(null), [], 'null 输入 → []');
T.eq(parseDelimited('a,b\nc,d', '\t'), [['a,b'], ['c,d']], '显式指定分隔符时按指定符切分');

/* ------------------------------------------------------ 5. mapReviewRow */
T.suite('mapReviewRow 表头映射与校验');
const headers = ['店名', '味道', '性价比', '服务', '环境', '推荐', '昵称', '点评', '日期'];
const goodRow = ['张三面馆', '9', '8', '7', '6', '推荐', '小林', '汤头很正，面也筋道，值得再来。', '2026-10-01'];
const good = mapReviewRow(headers, goodRow);
T.eq(good.ok, true, '合法行 → ok = true');
T.eq(good.name, '张三面馆', '店名解析正确');
T.eq(good.author, '小林', '昵称解析正确');
T.eq(good.scores, { taste: 9, value: 8, service: 7, ambience: 6 }, '四项分数解析正确');
T.eq(good.verdict, 'recommend', '推荐 → recommend');

const enHeaders = ['name', 'taste', 'value', 'service', 'ambience', 'verdict', 'author', 'text'];
const en = mapReviewRow(enHeaders, ['A Shop', '8', '8', '8', '8', 'no', 'bob', 'not bad at all']);
T.eq(en.ok, true, '英文表头 → ok = true');
T.eq(en.verdict, 'not_recommend', '英文 no → not_recommend');

const aliasHeaders = ['餐厅', '口味', '价格', '服务', '氛围', '是否推荐', '作者', '内容'];
const aliasRow = ['别名店', '7', '7', '7', '7', '踩雷', 'amy', '真的不太行，别去了'];
const alias = mapReviewRow(aliasHeaders, aliasRow);
T.eq(alias.ok, true, '中文别名表头 → ok = true');
T.eq(alias.verdict, 'not_recommend', '踩雷 → not_recommend');

const oob = mapReviewRow(headers, ['店', '11', '8', '8', '8', '推荐', 'a', '这条点评足够长了吧', '']);
T.eq(oob.ok, false, '分数 11 越界 → ok = false');
T.ok(oob.errors.some((e) => e.includes('taste')), '越界错误信息包含字段名 taste');

const neg = mapReviewRow(headers, ['店', '-1', '8', '8', '8', '推荐', 'a', '这条点评足够长了吧', '']);
T.eq(neg.ok, false, '分数 -1 越界 → ok = false');

const nan = mapReviewRow(headers, ['店', 'abc', '8', '8', '8', '推荐', 'a', '这条点评足够长了吧', '']);
T.eq(nan.ok, false, '分数非数字 → ok = false');

const shortText = mapReviewRow(headers, ['店', '8', '8', '8', '8', '推荐', 'a', '好吃', '']);
T.eq(shortText.ok, false, '正文 < 5 字 → ok = false');

const noName = mapReviewRow(headers, ['', '8', '8', '8', '8', '推荐', 'a', '这条点评足够长了吧', '']);
T.eq(noName.ok, false, '缺店名 → ok = false');

const noNameCol = mapReviewRow(['味道', '性价比', '服务', '环境'], ['8', '8', '8', '8']);
T.eq(noNameCol.ok, false, '表头缺少店名列 → ok = false');
T.ok(noNameCol.errors.some((e) => e.includes('店名')), '缺店名列时给出明确错误');

const fill = mapReviewRow(['店名', '味道', '点评'], ['补分店', '9', '这条点评足够长了没问题']);
T.eq(fill.ok, true, '缺列按 7 分补齐后仍可提交');
T.eq(fill.scores, { taste: 9, value: 7, service: 7, ambience: 7 }, '缺失维度补 7 分');
T.ok(fill.warnings.length >= 3, '补齐时产生 warnings 提示');

const emptyDim = mapReviewRow(headers, ['空格店', '', '8', '8', '8', '推荐', 'a', '这条点评足够长了吧', '']);
T.eq(emptyDim.scores.taste, 7, '空单元格按 7 分补齐');
T.eq(emptyDim.ok, true, '空单元格不算错误');

const scoreWithUnit = mapReviewRow(headers, ['单位店', '8分', '7', '6.5', '8', '推荐', 'a', '这条点评足够长了吧', '']);
T.eq(scoreWithUnit.scores.taste, 8, '"8分" 解析为 8');
T.eq(scoreWithUnit.scores.value, 7, '纯数字 "7" 解析为 7');

/* 回归项（第 1 轮 P2-2）：parseScore 注释声称兼容 "7/10"，第 1 轮实测被拼成 710 判越界；
   第 2 轮已修复为取分子 7，此处锁定修正后的行为，防止回退。 */
const slash = mapReviewRow(headers, ['斜杠店', '7/10', '8', '8', '8', '推荐', 'a', '这条点评足够长了吧', '']);
T.eq(slash.scores.taste, 7, '"7/10" 取分子解析为 7（第 1 轮缺陷已修复）');
T.eq(slash.ok, true, '"7/10" 不再导致整行被判非法');
const bare = mapReviewRow(headers, ['无斜杠店', '8.5', '8', '8', '8', '推荐', 'a', '这条点评足够长了吧', '']);
T.eq(bare.scores.taste, 8.5, '"8.5" 纯小数解析不受 / 截断逻辑影响');

const noVerdict = mapReviewRow(['店名', '味道', '性价比', '服务', '环境', '昵称', '点评'],
  ['无推荐列店', '8', '8', '8', '8', 'a', '这条点评足够长了吧']);
T.eq(noVerdict.verdict, 'recommend', '缺推荐列 → 默认 recommend');

/* ------------------------------------------------------- 6. fmtScore / uid */
T.suite('fmtScore 与 uid');
T.eq(fmtScore(8), '8.0', 'fmtScore(8) → "8.0"');
T.eq(fmtScore(7.875), '7.9', 'fmtScore(7.875) → "7.9"');
T.eq(fmtScore(0), '0.0', 'fmtScore(0) → "0.0"');
T.eq(fmtScore(null), '—', 'fmtScore(null) → "—"');
T.eq(fmtScore(NaN), '—', 'fmtScore(NaN) → "—"');
T.eq(fmtScore(undefined), '—', 'fmtScore(undefined) → "—"');
T.eq(fmtScore('8'), '—', 'fmtScore("8") → "—"（不做隐式转换）');

const ids = new Set();
let dup = 0;
for (let i = 0; i < 2000; i++) {
  const id = uid('rv');
  if (ids.has(id)) dup++;
  ids.add(id);
}
T.eq(dup, 0, 'uid 连续 2000 次无重复');
T.eq(ids.size, 2000, 'uid 2000 个取值互不相同');
T.ok(Array.from(ids).every((x) => typeof x === 'string' && x.startsWith('rv_')), 'uid 带前缀且为字符串');

const r = T.summary('GinkgoCore 独立单测');
process.exitCode = r.failed > 0 ? 1 : 0;
