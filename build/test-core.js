/* GinkgoCore 单元测试：node build/test-core.js */
const Core = require('./core.js');
let pass = 0;
let fail = 0;

function eq(actual, expected, label) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a === b) { pass += 1; }
  else { fail += 1; console.log('FAIL ' + label + '\n  got: ' + a + '\n  exp: ' + b); }
}

/* ---- 1. 杯型阈值（>= 边界） ---- */
eq(Core.tierOf(8.6).key, 'bucket', '8.60 -> 全家桶');
eq(Core.tierOf(8.5999).key, 'super', '8.5999 -> 超大杯');
eq(Core.tierOf(9.95).key, 'bucket', '9.95 -> 全家桶');
eq(Core.tierOf(7.4).key, 'super', '7.40 -> 超大杯');
eq(Core.tierOf(7.3999).key, 'large', '7.3999 -> 大杯');
eq(Core.tierOf(6.2).key, 'large', '6.20 -> 大杯');
eq(Core.tierOf(5.0).key, 'medium', '5.00 -> 中杯');
eq(Core.tierOf(4.9999).key, 'small', '4.9999 -> 小杯');
eq(Core.tierOf(0).key, 'small', '0 -> 小杯');
eq(Core.tierOf(null), null, 'null -> 待评级');
eq(Core.tierOf(undefined), null, 'undefined -> 待评级');
eq(Core.tierOf(NaN), null, 'NaN -> 待评级');

/* ---- 2. 单条总分 ---- */
eq(Core.overall({ taste: 7, value: 7, service: 7, ambience: 8 }), 7.25, '7/7/7/8 = 7.25');
eq(Core.overall({ taste: 7.5, value: 8, service: 8, ambience: 8 }), 7.88, '7.5/8/8/8 = 7.875 -> 7.88');
eq(Core.overall({ taste: 8, value: 8, service: 8, ambience: 8 }), 8, '全 8 = 8');
eq(Core.overall({ taste: 8, value: 8, service: 8 }), null, '缺一项 -> null');
eq(Core.overall(null), null, 'null -> null');

/* ---- 3. 聚合 ---- */
const reviews = [
  { id: 'a', restaurantId: 'x', scores: { taste: 9, value: 9, service: 9, ambience: 9 }, verdict: 'recommend' },
  { id: 'b', restaurantId: 'x', scores: { taste: 8, value: 7, service: 9, ambience: 8 }, verdict: 'not_recommend' },
  { id: 'c', restaurantId: 'y', scores: { taste: 3, value: 3, service: 3, ambience: 3 }, verdict: 'not_recommend' }
];
const aggX = Core.aggregate(reviews, 'x');
eq(aggX.count, 2, 'x 评价数 2');
eq(aggX.score, 8.5, 'x 综合分 (9 + 8)/2 = 8.5');
eq(aggX.tier.key, 'super', '8.5 -> 超大杯');
eq(Number(aggX.dims.taste.toFixed(2)), 8.5, 'x 味道均分 8.5');
eq(Number(aggX.dims.value.toFixed(2)), 8, 'x 性价比均分 8');
eq(Number(aggX.recommendRate.toFixed(2)), 0.5, 'x 推荐率 0.5');

const aggEmpty = Core.aggregate([], null);
eq(aggEmpty.count, 0, '空评价 count 0');
eq(aggEmpty.score, null, '空评价 score null');
eq(aggEmpty.tier, null, '空评价 tier null');
eq(aggEmpty.dims.taste, null, '空评价 dims null');

/* 边界：不能被四舍五入提前拔高档位 */
const edge = [
  { id: 'e1', restaurantId: 'z', scores: { taste: 8.6, value: 8.6, service: 8.6, ambience: 8.6 }, verdict: 'recommend' },
  { id: 'e2', restaurantId: 'z', scores: { taste: 8.6, value: 8.6, service: 8.6, ambience: 8.6 }, verdict: 'recommend' }
];
eq(Core.aggregate(edge, 'z').tier.key, 'bucket', '8.6 均分 -> 全家桶');

/* ---- 4. CSV / TSV 解析 ---- */
const csv = '\uFEFF店名,点评\r\n"银桦, 二楼","他说""好吃""，值了"\r\nA,B\n';
const rows = Core.parseDelimited(csv);
eq(rows.length, 3, 'CSV 行数（去掉空尾行）'); // 表头 + 2 行
eq(rows[0], ['店名', '点评'], 'BOM 与表头');
eq(rows[1], ['银桦, 二楼', '他说"好吃"，值了'], '引号内的逗号与转义引号');

const tsv = '店名\t味道\t点评\n银桦餐厅\t8\t好吃';
const trows = Core.parseDelimited(tsv);
eq(trows.length, 2, 'TSV 行数');
eq(trows[1], ['银桦餐厅', '8', '好吃'], 'TSV 自动识别分隔符');

const quotedNewline = '店名,点评\n"第一行\n第二行",好';
const qn = Core.parseDelimited(quotedNewline);
eq(qn.length, 2, '引号内换行不拆行');
eq(qn[1][0], '第一行\n第二行', '引号内换行保留');

eq(Core.parseDelimited(''), [], '空文本 -> []');
eq(Core.parseDelimited(null), [], 'null -> []');

/* ---- 5. 表头映射 ---- */
const headers = ['店名', '味道', '性价比', '服务', '环境', '推荐', '昵称', '点评', '日期'];
const row = ['钟水饺', '9', '8', '8', '7', '推荐', '小林', '红油饺子太好吃了', '2026-10-01'];
const mapped = Core.mapReviewRow(headers, row);
eq(mapped.ok, true, '中文表头映射成功');
eq(mapped.scores, { taste: 9, value: 8, service: 8, ambience: 7 }, '分数映射');
eq(mapped.verdict, 'recommend', '推荐解析');
eq(mapped.author, '小林', '昵称解析');
eq(mapped.date, '2026-10-01', '日期解析');

const enHeaders = ['name', 'taste', 'value', 'service', 'env', 'verdict', 'author', 'text', 'date'];
const enRow = ['McDonald', '8', '7', '9', '8', 'no', 'Alex', 'fries were cold', '2026-10-02'];
const enMapped = Core.mapReviewRow(enHeaders, enRow);
eq(enMapped.ok, true, '英文表头映射成功');
eq(enMapped.verdict, 'not_recommend', 'no -> 不推荐');
eq(enMapped.name, 'McDonald', '英文店名');

const badScore = Core.mapReviewRow(headers, ['某店', '11', '8', '8', '7', '推荐', 'a', '内容够长了', '']);
eq(badScore.ok, false, '分数超范围 -> 跳过');
eq(badScore.errors.length > 0, true, '给出错误原因');

const shortText = Core.mapReviewRow(headers, ['某店', '8', '8', '8', '7', '推荐', 'a', '短', '']);
eq(shortText.ok, false, '正文太短 -> 跳过');

const missingScore = Core.mapReviewRow(headers, ['某店', '', '8', '8', '7', '推荐', 'a', '内容够长了吧', '']);
eq(missingScore.ok, true, '缺分数按 7 补齐');
eq(missingScore.scores.taste, 7, '缺分数补齐值');
eq(missingScore.warnings.length > 0, true, '给出补齐提示');

/* ---- 5b. 分数写法兼容 ---- */
const slashRow = Core.mapReviewRow(headers, ['某店', '7/10', '8', '8', '7', '推荐', 'a', '分数写成 7/10 也要认', '']);
eq(slashRow.ok, true, '"7/10" 能解析');
eq(slashRow.scores.taste, 7, '"7/10" 取分子 7');

const cnRow = Core.mapReviewRow(headers, ['某店', '8分', '8.5', '8', '7', '推荐', 'a', '带单位也能解析', '']);
eq(cnRow.scores.taste, 8, '"8分" 解析为 8');
eq(cnRow.scores.value, 8.5, '"8.5" 解析为 8.5');

const spaced = Core.mapReviewRow(headers, ['某店', '7 / 10', '8', '8', '7', '推荐', 'a', '带空格的十分制也要认', '']);
eq(spaced.ok, true, '"7 / 10" 能解析');
eq(spaced.scores.taste, 7, '"7 / 10" 取分子 7');

const fullWidth = Core.mapReviewRow(headers, ['某店', '７', '８.５', '９', '６', '推荐', 'a', '全角数字也要认', '']);
eq(fullWidth.ok, true, '全角数字行合法');
eq(fullWidth.scores, { taste: 7, value: 8.5, service: 9, ambience: 6 }, '全角数字解析');

const badFraction = Core.mapReviewRow(headers, ['某店', '11/10', '8', '8', '7', '推荐', 'a', '分子越界要判非法', '']);
eq(badFraction.ok, false, '"11/10" 越界被拒');

/* ---- 6. 工具函数 ---- */
eq(Core.fmtScore(7.85), '7.9', 'fmtScore 7.85 -> 7.9');
eq(Core.fmtScore(7.84), '7.8', 'fmtScore 7.84 -> 7.8');
eq(Core.fmtScore(null), '—', 'fmtScore null');
eq(Core.fmtScore(undefined), '—', 'fmtScore undefined');
eq(Core.fmtScore(0), '0.0', 'fmtScore 0');

const ids = new Set();
for (let i = 0; i < 500; i++) ids.add(Core.uid('rv'));
eq(ids.size, 500, 'uid 500 次不重复');
eq(Core.uid('rv').indexOf('rv_'), 0, 'uid 前缀');

/* ---- 汇总 ---- */
console.log('\npass=' + pass + ' fail=' + fail);
process.exit(fail === 0 ? 0 : 1);
