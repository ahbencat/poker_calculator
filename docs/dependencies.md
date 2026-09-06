# 依赖清单

本项目**零第三方依赖**——无 npm 包、无 pip 包、无构建工具、无外部资源。
以下为完整的依赖事实清单与工具链要求。

## 运行时（浏览器端）

**依赖：无。** 页面只使用浏览器原生能力，计算全部在本地完成。

| 使用的能力 | 说明 | 兼容基线 |
|---|---|---|
| 经典 `<script>` + IIFE 全局命名空间 | 刻意不用 ES Modules（`file://` 下被同源策略拦截） | 全部现代浏览器 |
| `performance.now()` | 计算分片与蒙特卡洛预算计时 | 全部现代浏览器 |
| `MessageChannel` | 计算分片泵（避开 setTimeout 4ms 钳制） | 全部现代浏览器 |
| `Element.closest()` | 玩家列表/公牌/选牌网格的事件委托 | 全部现代浏览器（不含 IE） |
| `Math.imul` / `Math.clz32` | PRNG 与掩码位运算 | 全部现代浏览器 |
| CSS `dvh`（含 `vh` 回退）、`env(safe-area-inset-*)` | 手机竖屏弹层与刘海屏安全区 | iOS Safari 15+ / Chrome 108+ |
| Unicode 花色字符 ♠♥♦♣、系统字体栈 | 零图片、零外部字体 | 全部现代浏览器 |

**显式不使用**（均为刻意决策，改动前须确认 `file://` 双击可用这一前提）：
npm 依赖 / 构建打包、ES Modules、Web Worker、CDN 资源、外部字体与图标、
Cookie 与 localStorage（无任何持久化）。

## 服务端（对外提供静态托管）

**依赖：Python 3.7+ 标准库。** 任何装有 Python 3 的机器可直接运行，无 pip install。

| 标准库模块 | 用途 | 版本要求 |
|---|---|---|
| `http.server` | 静态文件托管；`ThreadingHTTPServer`（3.7+）；`directory=` 参数（3.7+） | Python ≥ 3.7 |
| `socket` / `socketserver` | 局域网地址探测 / 线程化 TCP 服务 | Python ≥ 3.0 |

安全属性：`send_head` 覆盖屏蔽点文件/点目录（`.claude/` 等含敏感配置），由
`test/server_smoke.py` 断言保护，不可删除。

## 开发 / 测试工具链（非运行时依赖，跑测试才需要）

| 工具 | 用途 | 版本要求 |
|---|---|---|
| Node.js | `node test/run_tests.js`（28 项测试）；`node test/bench.js`（性能基准） | ≥ 16（依赖全局 `performance`） |
| Python 3 | `test/oracle.py` 独立对拍（仅 `itertools`/`sys`）；`test/server_smoke.py` | ≥ 3.7 |

## 依赖变更纪律

1. 任何引入第三方依赖的提议默认拒绝；确有必要时须同步更新本清单与 CLAUDE.md。
2. JS 侧新增浏览器 API 前，先确认其不破坏 `file://` 协议直开与目标移动端基线。
3. 服务端保持标准库；新增模块须在 server_smoke.py 补冒烟覆盖。
