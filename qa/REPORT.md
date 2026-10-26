# Ginkgo 美食地图 · QA 独立验证报告（第 2 轮 · 最终）

> **2026-10-24 复审补充（团队负责人点名边界项）**：新增 `qa/test-edge.js`（64 条断言）针对
> remap 引用完整性、只污染评价 id、65 字符 / 空串 / 数字 id、孤儿 restaurantId、`clearedAt` 语义与旧格式兼容、
> `parseScore` 全角与 `x/10` 边界、合规与体积做了独立验证，**64/64 通过**。
> 全量合计 **368 条断言 / 368 通过 / 0 失败**（112+20+76+86+10+64）。
> 仅剩 1 项非阻塞 P2：`/10`（缺分子）未被丢弃，见文末「残留项」。

- 验证人：Edward（QA）
- 被测产物：`index.html` **208,156 字节 / 4,973 行**（mtime 2026-10-24T09:39:38Z），回归前后字节数一致，确认测的是同一份最终产物
- 测试代码：`qa/` 下全部由 QA 独立编写，**未复用** `build/test-core.js`、`build/browser-checks/*`
- 运行输出：`qa/out/*.txt`、`qa/browser-results.json`
- 结论：**IS_PASS: YES**（第 1 轮 3 类缺陷全部修复且未回归）

---

## 1. 测试统计（第 2 轮）

| 套件 | 文件 | 断言 | 通过 | 失败 |
|---|---|---|---|---|
| 核心逻辑独立单测 | `qa/test-core.js` | 112 | 112 | 0 |
| 种子数据真实性核验 | `qa/test-seed.js` | 20 | 20 | 0 |
| 静态与安全审查 | `qa/test-static.js` | 76 | 76 | 0 |
| 真实浏览器实测 | `qa/test-browser.js` | 86 | 86 | 0 |
| 浏览器补充（待评级/推荐率） | `qa/test-browser-extra.js` | 10 | 10 | 0 |
| **合计** | | **304** | **304** | **0** |

浏览器实测：**已执行**。Chrome headless + 自建零依赖 CDP 驱动（`qa/lib/cdp.js`，Node 22 内建 `WebSocket`）。
`agent-browser 0.27.0` 在本环境无法启动（`open/tab` 一律 SIGTERM，非沙箱模式同样），`puppeteer`/`playwright` 均未安装。

---

## 2. 第 1 轮缺陷的修复验证

| 编号 | 第 1 轮缺陷 | 修复验证结果 |
|---|---|---|
| P1 | id 未转义拼入 5 处 HTML 属性 → DOM XSS | ✅ **已修复（双层）** |
| P2-1 | 「清空全部数据」后刷新示例数据复活 | ✅ **已修复** |
| P2-2 | `parseScore` 注释与实现不符 | ✅ **已修复** |

### P1 复验证据（同一 payload，比第 1 轮更严格）

第 1 轮 payload：店铺 id = `evil" onmouseover="window.__xss=1" x="`，店名 `<img src=x onerror=...>`，分类 `<script>`，地址 `"><svg onload=...>`，评价 id 同样带逃逸串。

| 探针 | 第 1 轮（缺陷） | 第 2 轮（修复后） |
|---|---|---|
| 卡片 `onmouseover` 属性 | **存在**，值 = `window.__xss=1` | **0 个** |
| 页面 `[onmouseover]` 节点数 | **3**（卡片 + 抽屉删除按钮 + 排行榜） | **0** |
| `[onload]` 节点 / `<img>` / `<script>` | 0 / 0 / 0 | 0 / 0 / 0 |
| `window.__xss` | 0（属性已注入，仅因未触发 hover 而未执行） | 0 |
| localStorage 非法 id | 原样保留（`evil" onmouseover=...`） | **[]**（空，全部合规） |
| DOM 中非法 `data-id` | 5 处 | **[]**（空） |
| 注入店名渲染 | 属性逃逸 | 纯文本显示 `<img src=x onerror="...">`（`payloadShownAsText=true`） |
| 评价正文 `<script>` | — | 纯文本显示，未解析 |
| 数据完整性 | — | 非法 id 被 `Core.uid()` 重建、评价 `restaurantId` 经 `remap` 改写，**未产生孤儿、未丢数据**（1 条评价保留） |

静态层同时确认：5 处模板全部走 `esc(...)`（`data-id` / `data-locate` / `data-del-review` / `<option value>` / `data-rank-id`），且 `normalizeRestaurant()`、`normalizeReview()` 的 `id` 与 `restaurantId` 均过 `ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/`。

### P2-1 复验证据

| 步骤 | 第 1 轮 | 第 2 轮 |
|---|---|---|
| 应用内「清空全部数据」+ 二次确认 | 0 家 / 存储 0 家 | 0 家 / 存储 0 家 |
| **刷新后** | **25 家复活** + toast「数据为空或格式异常」 | **0 家**、`stored: 0`、统计 `已收录 0 家累计 0 条评价 全站平均 — 分`、**无 toast**、`#listEmpty` 显示引导 |
| 首次访问（无 storage） | 25 家 75 条 | 25 家 75 条（未被误伤） |

### P2-2 复验证据

`"7/10"` → 7（取分子）、`"8分"` → 8、`"8.5"` → 8.5（小数不受 `/` 截断影响）、该行不再被判非法。已把该用例从「已知偏差」改为**回归锁定**，防止回退。

---

## 3. 全量回归明细（304 条断言）

### 3.1 核心逻辑（112/112）

`tierOf` 双侧边界 8.6/8.5999/7.4/7.3999/6.2/6.1999/5.0/4.9999 + 0/10/10.01/-1/null/undefined/NaN/`"8.6"`/Infinity；
`overall` 7.875→7.88、四项10→10、缺项/字符串/NaN→null、浮点 (0.1+0.2+0.3)/4→0.15；
`aggregate` 空数组不抛错、单条 8.0→超大杯、**[8.5,8.7]→8.6→全家桶**、**[8.5,8.6]→8.55→超大杯**、8.575→超大杯、三条 5.0→中杯不掉档、按店过滤、残缺评价跳过、推荐率 3/4=0.75、四维均值；
`parseDelimited` 12 项（引号内逗号 / `""` 转义 / 引号内换行 / BOM / CRLF / CR / 空行 / 纯 TSV / 分号 / 竖线 / 空输入 / 仅表头 / trim / 显式分隔符）；
`mapReviewRow` 中英表头别名、越界 -1/11/非数字、正文 <5 字、缺店名、缺店名列、缺分补 7、`"8分"`、`"7/10"`、`"8.5"`；
`fmtScore` 8→"8.0"、7.875→"7.9"、null/NaN/字符串→"—"；`uid` 2000 次无重复。

### 3.2 种子数据（20/20，未发现造假）

25 店 / 75 评价（每店 3 条）；id 唯一；无孤儿评价、无零评价店铺；
**用 QA 自实现平均值算法重算 = 全家桶 3 / 超大杯 6 / 大杯 8 / 中杯 5 / 小杯 3，与宣称完全一致**；
店铺对象未存静态 `score`/`tier`（0 个，运行时重算，无造假空间）；
坐标 25/25 落在 lat 30.4–31.2 / lng 103.6–104.5，无 0/NaN/字符串；
300 个分值全部为 0–10 且 0.5 整数倍；无「原始分档位与 1 位小数展示分档位冲突」的店铺。

### 3.3 静态与安全（76/76）

- 地图红线：无 leaflet / openstreetmap / mapbox / webapi.amap.com / googleapis / mapapi.qq.com / mapStyleId；
  `serviceHost` 逐字符保持 `http://127.0.0.1:__WB_HTTP_PORT__/_TMapService/_wbt/__WB_TMAP_SECRET__`，两占位符各出现 1 次；
  SDK 为 `https://map.qq.com/api/gljs?v=1.exp&libraries=service`，全文无 `?key=`/`&key=`，无硬编码 Key 形态。
- 外部资源：唯一外链 = `L1663` 腾讯地图 SDK；无 `<link>`、无 `@import`、无远程 `<img>`、无第三方字体/图标/统计；
  `fetch(` 仅 2 处（`4494`/`4539`），均在 Sync 模块且 `mode:'local'` 时不启用；无 XMLHttpRequest、无 WebSocket。
- XSS：21 处 HTML sink 已逐一核对；店名/昵称/正文/地址/标签/导入预览表格全部 `esc()`；**id 5 处已加 `esc()` + 入口白名单**；
  `esc()` 实测覆盖 `& < > " '`（`<img onerror>`、`"><svg onload=>`、`<script>` 三类均被转义）。
- 存储：`getItem`/`setItem` 均在 try/catch；`JSON.parse` 失败 → 提示 + `seedState()`；写失败 toast「保存失败：本机存储空间可能已满」；
  IndexedDB 全链路 `.catch()` → 内存 `Map` 降级。
- 浅色主题：`#FBF7EF` 背景 + `#2B2A26` 文字 = **13.44:1**；次级 `#57534B` = **7.16:1**；弱化 `#8B8478` = **3.47:1**；`color-scheme: light`，无深色覆盖、无近黑底色。
- 基础项：DOCTYPE / `lang="zh-CN"` / viewport / title / `charset=utf-8` 齐全；无 `console.error`/`console.log`/`debugger`/TODO/FIXME。

### 3.4 真实浏览器（86/86）

| 项 | 实测 |
|---|---|
| 首屏 | 卡片 **25**、chip **7**（全部+5档+待评级）、图例 **6**、`已收录 25 家 累计 75 条评价 全站平均 6.6 分`、状态条「已保存到本机」、body `rgb(251,247,239)` |
| marker | **25**；点图例「全家桶」→ **3**，取消 → **25** |
| 写评价 9/8/7/6 + 推荐 | 本条总分 **7.5**；r01 3→**4** 条、全站 75→**76**；店铺分 5.583→**6.1**（QA 独立重算 6.0625 的四舍五入，档位 **中杯**，卡片 `6.1分` 与 Core 一致） |
| 添加店铺 | 卡片 25→**26**，marker 25→**26**，`source:'user'`，弹层自动关闭 |
| 筛选 | 火锅 **4** 家 / 只看踩雷 **3** 家 / 大杯及以上 **17** 家（8+6+3）/ 大杯 chip **8** 家 / 清空筛选恢复 **26** / 无结果空态正常 |
| 390×844 | `documentElement.scrollWidth = 390`、`body.scrollWidth = 390`、卡片宽 366px；「添加餐厅」命中 `BUTTON#btnAddRestaurant`，弹层开/关正常 |
| 待评级 | 新店卡片 `—` + 徽标「待评级」+「待评级 1」chip；抽屉 `— / — / 0` + 「还没有评价」引导 |
| 推荐率 | 1 条不推荐 → 抽屉 `0%` |
| 断网 | 状态条→「离线模式，改动已暂存，联网后自动合并」+ `is-offline`；离线写入成功；恢复后回到「已保存到本机 · 17:47」 |
| 清空数据 | 应用内清空 → 0 家 / 存储 0 家；**刷新后仍 0 家**、无 toast、有空态引导 |
| SDK 加载失败 | `Fetch.failRequest` 真实拦截 gljs → `window.TMap === undefined` → 8s 超时后 `#mapFallback` 可见、`#map` `display:none`、控件隐藏、**列表 2 卡正常渲染、正文 564 字、未白屏** |
| 控制台 | 全程 22 条 raw 消息，过滤 `serviceHost` 占位符致 SDK 鉴权失败 / favicon 404 / 本测试主动拦截 gljs 后，**应用级 pageerror + console.error = 0**；首屏加载阶段同样 0 条应用级异常 |

### 3.5 降级逻辑（静态阅读 + 运行时双证）

`MapCtl.init()` 检测 `!window.TMap` 返回 false → `bootMap` 每 250ms 轮询、超 8s 调 `showMapFallback()`；构造异常 `catch` 返回 false。
运行时用真实网络拦截复现，降级文案「地图需要联网才能加载…」可读，`#mapFallback` 显示、`#map` 隐藏、列表/评价/导入导出完全可用。

---

## 4. 本轮我修正的测试自身问题（非源码问题，已消解）

1. `"[记录] 7/10 未被识别"` → 上一轮把旧缺陷固化成断言，改为锁定修复后行为（`7` + 不再判非法 + `8.5` 不受 `/` 截断影响）。
2. SDK 降级段在「清空数据」之后运行，列表本就为空 → 改为先注入 2 家合法店铺再断言。
3. XSS 断言原为「evil 卡必须不存在」→ 实测实现是**重建 id 而非丢数据**，改断言为「storage/DOM 中无非法 id、payload 以纯文本呈现、评价被 remap 保留」。
4. 首屏 SDK 未在 2.6s 内就绪时，原断言在「加载中」中间态不成立 → 改为等 12s 后二选一判定（就绪则校 marker=25，否则校降级卡可见）。
5. `test-static.js` 的正则匹配 `normalizeRestaurant(raw)` 因签名新增 `remap` 参数失配 → 改为签名无关匹配，并新增 `normalizeReview` 白名单断言。

---

## 5. 路由判定

**NoOne**（全通过）。

- 304 条断言全部通过，第 1 轮 1 个 P1 + 2 个 P2 均经复验确认修复且无回归；
- 修复方案比要求更稳（非法 id 重建 + 评价 remap，既堵 XSS 又不丢数据），未引入新的外部依赖，地图占位符一字未改；
- 遗留可改进项（不构成缺陷，供后续排期）：
  1. `saveState` 不区分 `QuotaExceededError`，仅统一 catch 提示——体验可细化（提示语区分「已满 / 其他」）。
  2. 弱化文字 `#8B8478` 对比度 3.47:1，仅满足 AA 大字号；若用于正文小字建议加深到 ≥4.5:1。
  3. `seedState()` 返回的 `meta` 用 `clearedAt`，而 `loadState` 判据用 `meta.initialized`，两个字段并存略冗余，建议统一。

---

## 6. 复审补充：边界与 remap 专项（`qa/test-edge.js`，64/64）

| 项 | 实测证据 |
|---|---|
| **remap 引用完整性**（最易漏点） | 店铺 id 为 `evil" onmouseover=...`、其下挂 1 条评价（评价 id 同样带逃逸串）→ 刷新后：**店铺保留 2 家**（改名店 + 正常店）、**评价保留 1 条**、**孤儿数 0**、storage 中 `badIds: []`、`[onmouseover] = 0`、卡片 2 张。证明「改名 + remap 改写 restaurantId」链路闭合，评价没有变孤儿也没被静默删。 |
| 只污染评价 id（`data-del-review` 在抽屉） | 店铺 id 合法、仅 2 条评价 id 带逃逸串 → 打开详情：抽屉正常打开、**删除按钮 2 个**、`data-del-review` 取值**全部合规**（`badDelIds: []`）、抽屉内 `[onmouseover] = 0`、`[onload] = 0`、**2 条评价均正常渲染**（未静默删除）。 |
| 65 字符超长 id | `'a'.repeat(65)` → 被重建为合法 id，记录保留 |
| 空字符串 id | `''` → 被重建，记录保留 |
| 数字类型 id | `12345` → 被重建，记录保留；4 条记录全部在（`restCount: 4`、卡片 4 张、`badIds: []`） |
| 孤儿 `restaurantId`（指向不存在店铺） | 内存态：hero `累计 1 条`、抽屉只渲染 1 条评价 → **孤儿被过滤且不影响展示/统计**。注：`localStorage` 原始记录仍留着该孤儿（本次无 id 需修复故未触发回写），每次加载都会再次过滤，不产生用户可见问题（记为可改进项）。 |
| 旧格式兼容（无 `clearedAt` 字段） | 加载 1 张卡、`restCount: 1` → 正常加载，**未被当成「已清空」** |
| `clearedAt` 存在但店铺非空 | 1 张卡正常加载，不回落种子 |
| 空数据 + 无 `clearedAt` | 回落示例 **25 家** + toast「已载入示例数据」（新用户路径正确） |
| 空数据 + 有 `clearedAt` | **0 家**、空态引导可见、**无**「已载入示例数据」toast |
| 只清空评价、保留店铺 | 刷新后店铺仍在（`cards: 1`），未被误判为空态回种子 |
| 应用内清空 → 刷新 | 清空时写入 `meta.clearedAt`、0 家；**刷新后仍 0 家**、`stored: 0`、空态引导、无 toast、hero `已收录 0 家…— 分` |
| 「恢复示例数据」 | 恢复后 **25 家**、`clearedAt` 归 `null` |
| `parseScore` 边界 | `7/10`→7、`7 / 10`→7、全角 `７.５`→7.5、`8分`→8、`8.5`→8.5、`10/10`→10、`11/10`→判非法丢弃；**`/10`→被解析成 10（残留项）** |
| 合规与体积 | 208,156 B / **203.3 KB < 900 KB**；`serviceHost` 占位符逐字符未变、两占位符各 1 次；SDK URL 逐字符一致且无 `key`；无违禁地图源、无新增第三方资源；**4 个内联非空 script 块 `node --check` 全过** |
| 回归不退化 | 25 家 / 75 条 / 均分 **6.6** / 杯型 `3-6-8-5-3`（chip 文案逐项核对）/ 火锅 **4** / 踩雷 **3** / 大杯及以上 **17**；marker 25 见 `test-browser.js`（同一份 208,156 B 产物）；应用级 pageerror **0**（52 条 raw 消息全为 SDK 占位符鉴权失败等环境噪声） |

### 残留项（非阻塞）

- **[P2] `parseScore('/10')` 未丢弃，被数字提取成 10**（`index.html` 约 1516 行）。
  期望：缺分子应判非法丢弃；实测：该维度得 10 分、整行判合法。
  影响面小（仅在用户按 `x/10` 模板填写但漏填分子时发生，且是「高估分数」而非崩溃/安全问题），
  **不阻塞交付**，建议下版把 `/` 分支改为「正则不匹配即返回 null，不再回落到数字提取」。
- `localStorage` 中孤儿评价未即时回写（仅在 id 修复触发回写时才清理），属存储整洁度问题，不影响展示与统计。

---

## 附：如何复跑

```bash
cd E:/2026-10-24-16-22-22/ginkgo-food-map
node qa/test-core.js          # 112 断言
node qa/test-seed.js          # 20 断言
node qa/test-static.js        # 76 断言
node qa/test-browser.js       # 86 断言（自动起本地 http + Chrome headless）
node qa/test-browser-extra.js # 10 断言
node qa/test-edge.js          # 64 断言（边界 / remap / clearedAt / 合规体积）
```
全部退出码 0 即通过。产物：`qa/out/*.txt`、`qa/browser-results.json`。
