/**
 * 极简单测框架：不引入第三方依赖，输出可统计的 pass/fail 明细。
 */
'use strict';

const results = [];
let currentSuite = '';

function suite(name) {
  currentSuite = name;
  results.push({ type: 'suite', name });
}

function add(ok, name, detail) {
  results.push({ type: 'case', suite: currentSuite, name, ok, detail: detail || '' });
}

function eq(actual, expected, name) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  add(a === e, name, a === e ? '' : `期望 ${e}，实际 ${a}`);
}

function near(actual, expected, tol, name) {
  const ok = typeof actual === 'number' && Math.abs(actual - expected) <= tol;
  add(ok, name, ok ? '' : `期望 ≈${expected}（容差 ${tol}），实际 ${String(actual)}`);
}

function ok(value, name, detail) {
  add(!!value, name, value ? '' : detail || '期望真值，实际假值');
}

function throwsNot(fn, name) {
  try {
    fn();
    add(true, name);
  } catch (e) {
    add(false, name, '不应抛错，但抛出: ' + e.message);
  }
}

function summary(label) {
  const cases = results.filter((r) => r.type === 'case');
  const passed = cases.filter((r) => r.ok).length;
  const failed = cases.length - passed;
  console.log(`\n===== ${label || '结果'} =====`);
  console.log(`断言总数: ${cases.length} | 通过: ${passed} | 失败: ${failed}`);
  if (failed) {
    console.log('\n--- 失败明细 ---');
    cases
      .filter((r) => !r.ok)
      .forEach((r) => console.log(`FAIL [${r.suite}] ${r.name} :: ${r.detail}`));
  }
  return { total: cases.length, passed, failed, results };
}

module.exports = { suite, eq, near, ok, throwsNot, summary, results, add };
