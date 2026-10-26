/* ============================================================================
 * GinkgoCore —— 纯数据逻辑层（无 DOM、无事件、无顶层副作用）
 * 可整块抽出在 Node 中单测：const Core = require('./core.js')
 * 暴露：TIERS / tierOf / overall / aggregate / parseDelimited / mapReviewRow / uid / fmtScore
 * ========================================================================== */
(function (root) {
  'use strict';

  /**
   * 杯型五档定义。
   * min 为进入该档的最低分（包含边界，用 >= 判断），数组按分数从高到低排列，
   * tierOf 命中的第一个即为结果。
   */
  var TIERS = [
    { key: 'bucket', label: '全家桶', min: 8.6, color: '#C0392B', edge: '#E9B949', size: 34, order: 5, slogan: '神店，冲' },
    { key: 'super',  label: '超大杯', min: 7.4, color: '#B5651D', edge: '#FFFFFF', size: 28, order: 4, slogan: '强推' },
    { key: 'large',  label: '大杯',   min: 6.2, color: '#C98A4B', edge: '#FFFFFF', size: 23, order: 3, slogan: '值得一去' },
    { key: 'medium', label: '中杯',   min: 5.0, color: '#D8B98A', edge: '#FFFFFF', size: 19, order: 2, slogan: '中规中矩' },
    { key: 'small',  label: '小杯',   min: -Infinity, color: '#8A94A6', edge: '#FFFFFF', size: 16, order: 1, slogan: '踩雷预警' }
  ];

  var DIM_KEYS = ['taste', 'value', 'service', 'ambience'];

  /**
   * 按总分取杯型。
   * @param {number|null} score 未四舍五入的原始总分
   * @returns {object|null} 无分数时返回 null（页面侧称「待评级」）
   */
  function tierOf(score) {
    if (typeof score !== 'number' || !isFinite(score)) return null;
    for (var i = 0; i < TIERS.length; i++) {
      if (score >= TIERS[i].min) return TIERS[i];
    }
    return TIERS[TIERS.length - 1];
  }

  /**
   * 单条评价总分 = 四项平均值，内部精度保留 2 位小数。
   * 任一项缺失 → 返回 null（四项都必填）。
   */
  function overall(scores) {
    if (!scores || typeof scores !== 'object') return null;
    var sum = 0;
    for (var i = 0; i < DIM_KEYS.length; i++) {
      var v = scores[DIM_KEYS[i]];
      if (typeof v !== 'number' || !isFinite(v)) return null;
      sum += v;
    }
    return Math.round((sum / 4) * 100) / 100;
  }

  /**
   * 聚合某家店（或一组评价）的评分。
   * @param {Array} reviews 评价数组
   * @param {string} [restaurantId] 传入时只统计该店的评价
   * @returns {{count:number, score:(number|null), dims:object, recommendRate:(number|null),
   *            recommendCount:number, tier:(object|null)}}
   * 注意：score 保留原始精度（不先四舍五入），杯型阈值判断必须用它。
   */
  function aggregate(reviews, restaurantId) {
    var empty = {
      count: 0,
      score: null,
      dims: { taste: null, value: null, service: null, ambience: null },
      recommendRate: null,
      recommendCount: 0,
      tier: null
    };
    var list = Array.isArray(reviews) ? reviews : [];
    if (restaurantId) {
      list = list.filter(function (rv) { return rv && rv.restaurantId === restaurantId; });
    }
    var sumTotal = 0;
    var n = 0;
    var rec = 0;
    var sums = { taste: 0, value: 0, service: 0, ambience: 0 };
    for (var i = 0; i < list.length; i++) {
      var rv = list[i];
      if (!rv || !rv.scores) continue;
      var o = overall(rv.scores);
      if (o === null) continue;
      sumTotal += o;
      n += 1;
      for (var d = 0; d < DIM_KEYS.length; d++) {
        sums[DIM_KEYS[d]] += rv.scores[DIM_KEYS[d]];
      }
      if (rv.verdict === 'recommend') rec += 1;
    }
    if (n === 0) return empty;
    var score = sumTotal / n;
    return {
      count: n,
      score: score,
      dims: {
        taste: sums.taste / n,
        value: sums.value / n,
        service: sums.service / n,
        ambience: sums.ambience / n
      },
      recommendRate: rec / n,
      recommendCount: rec,
      tier: tierOf(score)
    };
  }

  /** 只统计某家店有效评价的条数（用于「评价数」展示） */
  function countReviews(reviews, restaurantId) {
    return (Array.isArray(reviews) ? reviews : []).filter(function (rv) {
      return rv && rv.restaurantId === restaurantId && overall(rv.scores) !== null;
    }).length;
  }

  /* ------------------------------------------------------------------ *
   * 轻量 CSV / TSV 解析器
   * 支持：BOM、CRLF/LF/CR、英文双引号包裹、引号内分隔符与换行、"" 转义
   * ------------------------------------------------------------------ */

  function detectDelimiter(text) {
    var firstLine = (text.split(/\r\n|\n|\r/)[0] || '');
    var counts = { '\t': 0, ',': 0, ';': 0, '|': 0 };
    var inQuotes = false;
    for (var i = 0; i < firstLine.length; i++) {
      var ch = firstLine.charAt(i);
      if (ch === '"') { inQuotes = !inQuotes; continue; }
      if (!inQuotes && Object.prototype.hasOwnProperty.call(counts, ch)) counts[ch] += 1;
    }
    var best = ',';
    var bestN = 0;
    ['\t', ',', ';', '|'].forEach(function (d) {
      if (counts[d] > bestN) { bestN = counts[d]; best = d; }
    });
    return bestN === 0 ? ',' : best;
  }

  /**
   * 解析分隔文本为二维数组（已 trim、已丢弃纯空行）。
   * @param {string} text
   * @param {string} [delimiter] 不传则自动识别（tab / 逗号 / 分号 / 竖线）
   */
  function parseDelimited(text, delimiter) {
    if (typeof text !== 'string' || text.length === 0) return [];
    var s = text.replace(/^\uFEFF/, '');
    var sep = delimiter || detectDelimiter(s);
    var rows = [];
    var row = [];
    var cell = '';
    var inQuotes = false;

    for (var i = 0; i < s.length; i++) {
      var ch = s.charAt(i);
      if (inQuotes) {
        if (ch === '"') {
          if (s.charAt(i + 1) === '"') { cell += '"'; i += 1; }
          else { inQuotes = false; }
        } else {
          cell += ch;
        }
        continue;
      }
      if (ch === '"' && cell === '') { inQuotes = true; continue; }
      if (ch === sep) { row.push(cell); cell = ''; continue; }
      if (ch === '\r') {
        if (s.charAt(i + 1) === '\n') i += 1;
        row.push(cell); cell = ''; rows.push(row); row = [];
        continue;
      }
      if (ch === '\n') {
        row.push(cell); cell = ''; rows.push(row); row = [];
        continue;
      }
      cell += ch;
    }
    row.push(cell);
    rows.push(row);

    var out = [];
    for (var r = 0; r < rows.length; r++) {
      var cells = rows[r].map(function (c) { return String(c == null ? '' : c).trim(); });
      var hasContent = false;
      for (var c2 = 0; c2 < cells.length; c2++) {
        if (cells[c2] !== '') { hasContent = true; break; }
      }
      if (hasContent) out.push(cells);
    }
    return out;
  }

  /* 表头别名（中英文都认） */
  var HEADER_ALIASES = {
    name: ['店名', '餐厅', '店铺', '名称', '商家', '店名/餐厅', 'name', 'restaurant', 'shop', 'store'],
    taste: ['味道', '口味', 'taste', 'flavor', 'flavour'],
    value: ['性价比', '价格', '实惠', 'value', 'price', 'cost'],
    service: ['服务', 'service'],
    ambience: ['环境', '氛围', 'ambience', 'ambiance', 'env', 'environment'],
    verdict: ['推荐', '是否推荐', '推荐与否', 'verdict', 'recommend', 'recommended'],
    author: ['昵称', '姓名', '作者', '同学', 'author', 'nickname', 'nick'],
    text: ['点评', '内容', '评价', '点评内容', '评价内容', 'text', 'comment', 'content'],
    date: ['日期', '时间', 'date', 'time']
  };

  function normalizeHeader(h) {
    return String(h == null ? '' : h)
      .replace(/[\s\uFEFF]/g, '')
      .replace(/[（(].*?[)）]/g, '')
      .toLowerCase();
  }

  /** 把表头行映射为 field -> 列号 */
  function indexHeaders(headers) {
    var idx = {};
    var fields = ['name', 'taste', 'value', 'service', 'ambience', 'verdict', 'author', 'text', 'date'];
    (Array.isArray(headers) ? headers : []).forEach(function (h, i) {
      var key = normalizeHeader(h);
      if (!key) return;
      for (var f = 0; f < fields.length; f++) {
        var field = fields[f];
        if (idx[field] !== undefined) continue;
        if (HEADER_ALIASES[field].indexOf(key) >= 0) { idx[field] = i; return; }
      }
    });
    return idx;
  }

  function toText(v) { return String(v == null ? '' : v).trim(); }

  /** 全角数字与全角符号转半角（Excel / 微信里复制出来的常见坑） */
  function toHalfWidth(s) {
    return String(s)
      .replace(/[\uFF10-\uFF19]/g, function (c) {
        return String.fromCharCode(c.charCodeAt(0) - 0xFEE0);
      })
      .replace(/\uFF0E/g, '.')
      .replace(/\uFF0F/g, '/')
      .replace(/\uFF0D/g, '-');
  }

  /**
   * 分数解析。兼容：
   *   "8" / "8.5" / "8分" / "7 / 10" / "７.５"（全角）
   * 形如 "x/10" 的写法取分子；其它情况只保留数字与小数点。
   * @returns {number|null}
   */
  function parseScore(raw) {
    var s = toHalfWidth(toText(raw)).trim();
    if (!s) return null;
    var tenth = /^(\d+(?:\.\d+)?)\s*\/\s*10$/.exec(s);
    if (tenth) {
      var tenthValue = Number(tenth[1]);
      return isFinite(tenthValue) ? tenthValue : null;
    }
    s = s.replace(/[^\d.\-]/g, '');
    if (!s) return null;
    var n = Number(s);
    if (!isFinite(n)) return null;
    return n;
  }

  var RECOMMEND_WORDS = ['推荐', '推荐！', '推荐!', '是', 'yes', 'y', 'true', '1', '好', '好评', '👍', '强推'];
  var REJECT_WORDS = ['不推荐', '不推荐！', '不推荐!', '踩雷', '否', 'no', 'n', 'false', '0', '差评', '避雷', '👎'];

  function parseVerdict(raw) {
    var s = toText(raw).toLowerCase().replace(/\s/g, '');
    if (!s) return { value: 'recommend', empty: true };
    for (var i = 0; i < REJECT_WORDS.length; i++) {
      if (s === REJECT_WORDS[i].toLowerCase() || s.indexOf('不推荐') >= 0 || s.indexOf('踩雷') >= 0 || s.indexOf('避雷') >= 0) {
        return { value: 'not_recommend', empty: false };
      }
    }
    return { value: 'recommend', empty: false };
  }

  /**
   * 把一行收集表数据映射成一条评价草稿。
   * 规则：店名必填；四项分数缺省按 7 分补齐（记 warning）；分数越界 / 正文不足 5 字 → 跳过。
   * @returns {{ok:boolean, errors:string[], warnings:string[], name:string, author:string,
   *            text:string, date:string, verdict:string, scores:object}}
   */
  function mapReviewRow(headers, row) {
    var idx = indexHeaders(headers);
    var out = {
      ok: false,
      errors: [],
      warnings: [],
      name: '',
      author: '',
      text: '',
      date: '',
      verdict: 'recommend',
      scores: { taste: null, value: null, service: null, ambience: null }
    };
    if (idx.name === undefined) {
      out.errors.push('表头缺少「店名」列');
      return out;
    }
    var cells = Array.isArray(row) ? row : [];
    out.name = toText(cells[idx.name]);
    out.author = idx.author === undefined ? '' : toText(cells[idx.author]);
    out.text = idx.text === undefined ? '' : toText(cells[idx.text]);
    out.date = idx.date === undefined ? '' : toText(cells[idx.date]);

    var v = parseVerdict(idx.verdict === undefined ? '' : cells[idx.verdict]);
    out.verdict = v.value;

    var dims = ['taste', 'value', 'service', 'ambience'];
    for (var i = 0; i < dims.length; i++) {
      var dim = dims[i];
      if (idx[dim] === undefined) {
        out.warnings.push(dim + ' 列缺失，按 7 分补齐');
        out.scores[dim] = 7;
        continue;
      }
      var raw = toText(cells[idx[dim]]);
      if (raw === '') {
        out.warnings.push(dim + ' 为空，按 7 分补齐');
        out.scores[dim] = 7;
        continue;
      }
      var n = parseScore(raw);
      if (n === null || n < 0 || n > 10) {
        out.scores[dim] = null;
        out.errors.push(dim + ' 分数「' + raw + '」不在 0–10 之间');
      } else {
        out.scores[dim] = n;
      }
    }

    if (!out.name) out.errors.push('缺少店名');
    if (out.text.length < 5) out.errors.push('点评内容少于 5 字');

    out.ok = out.errors.length === 0;
    return out;
  }

  /* ------------------------------------------------------------------ */

  var uidSeq = 0;

  /** 生成短 id：前缀_时间戳36_序号_随机 */
  function uid(prefix) {
    uidSeq = (uidSeq + 1) % 100000;
    return String(prefix || 'id') + '_' +
      Date.now().toString(36) + '_' +
      uidSeq.toString(36) + '_' +
      Math.random().toString(36).slice(2, 6);
  }

  /** 分数展示：保留 1 位小数；无效值显示破折号 */
  function fmtScore(v) {
    if (typeof v !== 'number' || !isFinite(v)) return '—';
    return (Math.round(v * 10) / 10).toFixed(1);
  }

  var api = {
    TIERS: TIERS,
    tierOf: tierOf,
    overall: overall,
    aggregate: aggregate,
    parseDelimited: parseDelimited,
    mapReviewRow: mapReviewRow,
    uid: uid,
    fmtScore: fmtScore,
    /* 额外的内部工具，页面侧复用，不影响上面 8 个主 API */
    countReviews: countReviews,
    indexHeaders: indexHeaders,
    parseScore: parseScore
  };

  root.GinkgoCore = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
