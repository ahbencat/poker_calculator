# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目本质

网页版德州扑克胜率计算器。**零依赖、零构建**的静态站点：HTML + 原生 JS，胜率计算全部在浏览器本地完成；`server.py`（Python 标准库）只做静态托管。

## 常用命令

```bash
node test/run_tests.js          # 全部 JS 测试（25 项，无测试框架，自建 test/assert）
python3 test/oracle.py          # Python 独立朴素实现对拍（快速：校验和 + V1/V2）
python3 test/oracle.py --full   # 追加翻牌前精确向量 V3–V6（约 1–3 分钟）
python3 test/server_smoke.py    # server.py 冒烟：静态资源 200 + 点文件 404
python3 server.py [端口] [地址]   # 静态托管，默认 0.0.0.0:8000（对外提供服务）
```

无 lint、无构建。运行单个测试：`run_tests.js` 无过滤参数，测试按文件组织在 `test/*.test.js` 中，临时注释其他 test() 调用即可。

## 硬性约束（改动前必读）

- **禁用 ES Modules 和 Web Worker**：必须保持经典 `<script src>` + IIFE 全局命名空间。原因：`file://` 协议下 Chrome 对 module 脚本和 Worker 都抛同源错误，本项目要求双击 index.html 直接可用。同理禁用任何 npm 依赖。
- **每个 `js/*.js` 必须双导出**：IIFE 内 `global.X = X` + 文件尾 `if (typeof module !== "undefined") module.exports = X`。Node 测试依赖此模式。
- **`test/run_tests.js` 的 require 顺序有语义**：先设 `global.Cards`/`global.Evaluator`/`global.Engine` 再 require 测试文件，js 模块在 Node 下靠这些全局量互相引用（engine.js 不再回退 require）。

## 架构

**牌编码贯穿全项目**：`code = (rank << 2) | suit`，rank 0..12 = 2..A，suit 0..3 = ♠♥♦♣。

**策略分层**（跨 js/engine.js 与 js/app.js 的核心契约）：
- `Engine.createTask(players, board)` 是唯一入口，内部完成全部计算策略：所有玩家手牌已知 → 精确枚举（含翻牌前）；任一玩家缺牌 → 蒙特卡洛；精确枚举评估次数 ≥ `PREVIEW_EVALS`(50 万) 先跑 100ms MC 预览（result 带 `provisional` 标记）再无缝切换；≥ `EXACT_BUDGET`(600 万) 降级 MC。app.js **不做任何策略决策**，只负责 debounce、代际取消（generation）、按 result() 形状渲染。
- 任务对象接口：`runSlice(deadlineTs)` 可暂停恢复（true=完成）、`result()` 运行中返回部分结果/未开始返回 null、`progress()` 仅在 result() 为 null 时有意义。app.js 用 MessageChannel 泵以 12ms 分片驱动（勿改回 setTimeout——嵌套 4ms 钳制）。
- **全部玩家手牌未指定 ⇒ 玩家可交换，胜率精确等于 1/P**（与公牌无关），引擎直接返回精确值（`uniform: true`），win/tie 仍由模拟估计并取玩家间平均。这是数学事实，不是模拟估计，勿"修复"回模拟值。
- **UI 计算门槛与参与规则**：app.js 在**至少 2 位玩家手牌齐全（2 张）**时启动计算（`completeIndexes()` 门控，不论桌人数）；只对手牌齐全的玩家计算，未齐玩家的已选牌经 `opts.deadCards` 作为**死牌**移出牌堆。因此页面交互只会走精确枚举（MC 仅作重枚举预览），MC 主路径与全随机分支仅作为引擎 API 保留（测试覆盖）。

**7 张牌评估器**（js/evaluator.js）：掩码状态机（s1–s4 = 恰好出现 k 次的 rank 集合）+ 3 张 8192 项表（STR/POP/TOP5），分数 `(cat<<20)|踢脚位` 可直接比较。7 张牌内同花不可能与四条/葫芦共存，故同花最先判定。**7 张参数的手工展开是刻意为之的热路径优化**（实测 2600 万次/秒，循环化慢 14–53%）——改动前先基准测试。测试向量（V1–V6）是 JS 与 Python 双实现对拍的精确值，由 `test/oracle.py` 可独立复核；校验和 `37575761920` 依赖牌编码顺序，改编码必须同步 oracle.py。

**AA vs KK 的胜率随花色重叠度在 81.26%–82.64% 间变化**——新增胜率测试向量必须钉死具体花色，不能用"约 82%"。

## 安全属性

`server.py` 的 `send_head` 覆盖屏蔽所有点文件/点目录（.claude/ 内含 API token）。`test/../.claude/settings.json → 404` 等断言在 server_smoke.py 中，**不可删除或放松**。CPython 的 `translate_path` 已丢弃 `..` 分量，无法越出根目录，无需自行处理穿越。
