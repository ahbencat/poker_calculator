/* engine.js — 胜率引擎
 *
 * 统一入口 Engine.createTask(players, board)：内部完成模式选择与调度策略，
 * UI 只需按 runSlice 分片驱动、按 result() 的形状渲染：
 *   - 任一玩家手牌缺失 → 蒙特卡洛（时间预算/标准误提前停止）
 *   - 全已知且较轻 → 直接精确枚举（含翻牌前，结果精确）
 *   - 全已知且较重（翻牌前等）→ 先跑 100ms 蒙特卡洛预览（result 带
 *     provisional 标记），完成后无缝切换到精确枚举
 *
 * 任务对象接口（供主线程分块驱动，未来可平移到 Worker）：
 *   task.runSlice(deadlineTs) → true 已完成 / false 未完成（状态保留，可续跑）
 *   task.progress()           → 0..1 粗略进度（仅 result() 为 null 时有意义）
 *   task.result()             → 运行中返回部分结果（蒙特卡洛/预览），
 *                               完成后返回最终结果；未开始返回 null
 */
(function (global) {
  "use strict";

  var ev = global.Evaluator.evaluate7;

  /* 精确枚举的评估次数保险丝：实测最坏约 440 万次（4-5 人翻牌前），
   * 超过该预算降级为蒙特卡洛。 */
  var EXACT_BUDGET = 6000000;
  /* 精确枚举评估次数超过该值时，先跑蒙特卡洛预览再切换精确值 */
  var PREVIEW_EVALS = 500000;

  /* ---------- 内部工具 ---------- */

  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function nCk(n, k) {
    if (k < 0 || k > n) return 0;
    if (k > n - k) k = n - k;
    var r = 1;
    for (var i = 1; i <= k; i++) r = (r * (n - k + i)) / i;
    return r;
  }

  /* 就地推进到下一个组合（字典序）。返回最低变化位的下标，已到末尾返回 -1。 */
  function nextCombination(idx, n) {
    var k = idx.length, i = k - 1;
    while (i >= 0 && idx[i] === n - k + i) i--;
    if (i < 0) return -1;
    var v = ++idx[i];
    for (var j = i + 1; j < k; j++) idx[j] = v + (j - i);
    return i;
  }

  /* 校验并展开输入：
   * holes: Int32Array(2P) 玩家手牌（-1 = 未知）
   * b:     Int32Array(5) 公牌（-1 = 未知；board 不足 5 张的部分视为未知）
   * deadCards: 可选，死牌（不参与计算的玩家已亮出的牌）——标记为已知，从牌堆移除
   * holeUnknown/boardUnknown: 待填槽位下标；avail: 未见过的牌 */
  function prepare(players, board, deadCards) {
    global.Cards.validateInputs(players, board, deadCards);
    var P = players.length;
    var holes = new Int32Array(2 * P);
    var b = new Int32Array(5);
    var known = new Array(52);
    var holeUnknown = [], boardUnknown = [];
    for (var p = 0; p < P; p++) {
      for (var s = 0; s < 2; s++) {
        var c = players[p][s];
        if (c === null || c === undefined) {
          holes[2 * p + s] = -1;
          holeUnknown.push(2 * p + s);
        } else {
          holes[2 * p + s] = c;
          known[c] = true;
        }
      }
    }
    for (var i = 0; i < 5; i++) {
      var bc = board[i];
      if (bc === null || bc === undefined) {
        b[i] = -1;
        boardUnknown.push(i);
      } else {
        b[i] = bc;
        known[bc] = true;
      }
    }
    if (deadCards) {
      for (var d = 0; d < deadCards.length; d++) known[deadCards[d]] = true;
    }
    var avail = [];
    for (var c2 = 0; c2 < 52; c2++) if (!known[c2]) avail.push(c2);
    return { P: P, holes: holes, b: b, holeUnknown: holeUnknown, boardUnknown: boardUnknown, avail: avail };
  }

  function optsDead(opts) {
    return opts && opts.deadCards ? opts.deadCards : undefined;
  }

  /* 1/w 查表：w ∈ 1..10，免去每局面一次除法 */
  var INV = new Float64Array(11);
  (function () { for (var w = 1; w <= 10; w++) INV[w] = 1 / w; })();

  /* 单局结算：更新累计量（exact 与 MC 共用逻辑） */
  function tally(scores, P, eq, eq2, win, tie) {
    var best = -1, w = 0;
    for (var i = 0; i < P; i++) {
      var s = scores[i];
      if (s > best) { best = s; w = 1; }
      else if (s === best) w++;
    }
    var share = INV[w];
    for (i = 0; i < P; i++) {
      if (scores[i] === best) {
        eq[i] += share;
        if (eq2) eq2[i] += share * share;
        if (w === 1) win[i]++; else tie[i]++;
      }
    }
  }

  /* ---------- 模式选择 ---------- */

  function classify(players, board, opts) {
    var p = prepare(players, board, optsDead(opts));
    var unknownHoles = p.holeUnknown.length;
    var exactBoards = nCk(p.avail.length, p.boardUnknown.length);
    var exactEvals = exactBoards * p.P;
    var mode = unknownHoles === 0 && exactEvals <= EXACT_BUDGET ? "exact" : "mc";
    return {
      mode: mode,
      unknownHoles: unknownHoles,
      exactBoards: exactBoards,
      exactEvals: exactEvals,
    };
  }

  /* ---------- 精确枚举任务 ---------- */

  function createExactTask(players, board, opts) {
    var p = prepare(players, board, optsDead(opts));
    if (p.holeUnknown.length !== 0) throw new Error("精确枚举要求所有玩家手牌已知");
    var P = p.P, holes = p.holes, b = p.b;
    var avail = p.avail, slots = p.boardUnknown;
    var n = avail.length, k = slots.length;
    var total = nCk(n, k);
    var eq = new Float64Array(P), win = new Float64Array(P), tie = new Float64Array(P);
    var scores = new Int32Array(P);
    var done = 0;
    var idx = new Int32Array(k);
    for (var i = 0; i < k; i++) idx[i] = i;

    function evalBoard(b0, b1, b2, b3, b4) {
      for (var q = 0; q < P; q++) {
        scores[q] = ev(holes[2 * q], holes[2 * q + 1], b0, b1, b2, b3, b4);
      }
      tally(scores, P, eq, null, win, tie);
    }

    /* 里程计式枚举：状态即 idx，天然可暂停恢复。
     * 不变量：进入外层循环时 b[slots[0..k-2]] 与 idx[0..k-2] 同步；
     * 最末轮（变化最快的位）走快路径——每步仅 1 次牌槽写入 + 1 次评估，
     * 耗尽后进位重置并重写高位变化的槽位。 */
    function runSlice(deadlineTs) {
      if (k === 0) {
        if (done === 0) { evalBoard(b[0], b[1], b[2], b[3], b[4]); done = 1; }
        return true;
      }
      if (done === 0) {
        for (var j0 = 0; j0 < k - 1; j0++) b[slots[j0]] = avail[idx[j0]];
      }
      var last = slots[k - 1];
      for (;;) {
        while (idx[k - 1] < n) {
          b[last] = avail[idx[k - 1]];
          evalBoard(b[0], b[1], b[2], b[3], b[4]);
          done++;
          idx[k - 1]++;
          if ((done & 2047) === 0 && performance.now() >= deadlineTs) return false;
        }
        // 最末轮耗尽 → 高位进位；全部组合完成则返回 true
        var i = k - 2;
        while (i >= 0 && idx[i] === n - k + i) i--;
        if (i < 0) return true;
        idx[i]++;
        var v = idx[i];
        for (var j = i + 1; j < k; j++) idx[j] = v + (j - i);
        for (j = i; j < k - 1; j++) b[slots[j]] = avail[idx[j]]; // 重写变化的高位槽
      }
    }

    return {
      runSlice: runSlice,
      progress: function () { return total === 0 ? 1 : done / total; },
      result: function () {
        if (done !== total) return null;
        var out = [];
        for (var q = 0; q < P; q++) {
          out.push({ equity: eq[q] / total, win: win[q] / total, tie: tie[q] / total });
        }
        return { mode: "exact", totalBoards: total, players: out };
      },
    };
  }

  /* ---------- 蒙特卡洛任务 ---------- */

  function createMcTask(players, board, opts) {
    opts = opts || {};
    var p = prepare(players, board, optsDead(opts));
    var P = p.P, holes = p.holes, b = p.b;
    var avail = p.avail, holeSlots = p.holeUnknown, boardSlots = p.boardUnknown;
    var L = avail.length;
    var holeN = holeSlots.length, boardN = boardSlots.length;
    var need = holeN + boardN;

    /* 全部玩家手牌未指定 ⇒ 玩家间完全可交换，胜率精确等于 1/P，
     * 与公牌无关。win/tie 仍由模拟估计（对玩家取平均以降噪）。 */
    var fullyRandom = p.holeUnknown.length === 2 * P;

    var seed = opts.seed != null ? opts.seed >>> 0 : (Date.now() ^ (Math.random() * 0xFFFFFFFF)) >>> 0;
    var rng = mulberry32(seed);
    var minIters = opts.minIters != null ? opts.minIters : 10000;
    var maxIters = opts.maxIters != null ? opts.maxIters : 400000;
    var budgetMs = opts.budgetMs != null ? opts.budgetMs : 650;
    var seTarget = opts.seTarget != null ? opts.seTarget : 0.0015;

    var iters = 0;
    var eq = new Float64Array(P), eq2 = new Float64Array(P);
    var win = new Float64Array(P), tie = new Float64Array(P);
    var scores = new Int32Array(P);
    var startedAt = 0;

    function iteration() {
      // 部分偏置 Fisher–Yates：只洗出需要的 need 张，牌堆多重集保持不变
      for (var i = 0; i < need; i++) {
        var j = i + ((rng() * (L - i)) | 0);
        var t = avail[i]; avail[i] = avail[j]; avail[j] = t;
      }
      var d = 0, i2;
      for (i2 = 0; i2 < holeN; i2++) holes[holeSlots[i2]] = avail[d++];
      for (i2 = 0; i2 < boardN; i2++) b[boardSlots[i2]] = avail[d++];
      var b0 = b[0], b1 = b[1], b2 = b[2], b3 = b[3], b4 = b[4]; // 每迭代读一次而非每玩家
      for (var q = 0; q < P; q++) {
        scores[q] = ev(holes[2 * q], holes[2 * q + 1], b0, b1, b2, b3, b4);
      }
      iters++;
      tally(scores, P, eq, eq2, win, tie);
    }

    function seOf(q) {
      var n = iters;
      if (n < 2) return Infinity;
      var mean = eq[q] / n;
      var variance = (eq2[q] - eq[q] * mean) / (n - 1);
      if (variance < 0) variance = 0;
      return Math.sqrt(variance / n);
    }

    function shouldStop(nowTs) {
      if (iters < minIters) return false;
      if (fullyRandom) return true; // equity 已精确（1/P），win/tie 到展示精度即可
      if (nowTs - startedAt >= budgetMs) return true;
      var maxSe = 0;
      for (var q = 0; q < P; q++) {
        var s = seOf(q);
        if (s > maxSe) maxSe = s;
      }
      return maxSe < seTarget;
    }

    function runSlice(deadlineTs) {
      if (startedAt === 0) startedAt = performance.now();
      for (;;) {
        iteration();
        if (iters >= maxIters) return true; // 精确到达上限（不受批量检查粒度影响）
        if ((iters & 1023) === 0) {
          var t = performance.now();
          if (shouldStop(t)) return true;
          if (t >= deadlineTs) return false;
        }
      }
    }

    return {
      runSlice: runSlice,
      result: function () {
        if (iters === 0) return null;
        var out = [];
        if (fullyRandom) {
          // 胜率精确均分 1/P；win/tie 取玩家间平均（可交换性下降噪）
          var sumWin = 0, sumTie = 0;
          for (var q1 = 0; q1 < P; q1++) { sumWin += win[q1]; sumTie += tie[q1]; }
          for (var q2 = 0; q2 < P; q2++) {
            out.push({
              equity: 1 / P,
              win: sumWin / (P * iters),
              tie: sumTie / (P * iters),
              se: seOf(q2),
            });
          }
          return { mode: "mc", uniform: true, iterations: iters, players: out };
        }
        for (var q = 0; q < P; q++) {
          out.push({
            equity: eq[q] / iters,
            win: win[q] / iters,
            tie: tie[q] / iters,
            se: seOf(q),
          });
        }
        return { mode: "mc", iterations: iters, players: out };
      },
    };
  }

  /* ---------- 组合任务（对外的统一入口） ---------- */

  function createTask(players, board, opts) {
    var cls = classify(players, board, opts);
    if (cls.mode === "mc") return createMcTask(players, board, opts);
    if (cls.exactEvals < PREVIEW_EVALS) return createExactTask(players, board, opts);
    // 重枚举：先出 100ms 蒙特卡洛预览，随后无缝切换到精确枚举
    var preview = createMcTask(players, board, {
      budgetMs: 100, minIters: 5000, maxIters: 60000, seTarget: 0,
      deadCards: optsDead(opts),
    });
    var main = null;
    return {
      runSlice: function (deadlineTs) {
        if (!main) {
          if (!preview.runSlice(deadlineTs)) return false;
          main = createExactTask(players, board, opts);
          return false; // 本片收手：让 UI 先渲染预览结果，下一片再开始枚举
        }
        return main.runSlice(deadlineTs);
      },
      progress: function () { return main ? main.progress() : 0; },
      /* 精确枚举期间持续返回预览结果（provisional）——数字全程可见，
       * 枚举完成后被精确值无缝替换 */
      result: function () {
        if (!main) {
          var rp = preview.result();
          if (rp) rp.provisional = true;
          return rp;
        }
        var r = main.result();
        if (r) return r;
        var pp = preview.result();
        if (pp) pp.provisional = true;
        return pp;
      },
    };
  }

  var Engine = {
    classify: classify,
    createTask: createTask,
    createExactTask: createExactTask,
    createMcTask: createMcTask,
    nCk: nCk,
    nextCombination: nextCombination,
  };

  global.Engine = Engine;
  if (typeof module !== "undefined" && module.exports) module.exports = Engine;
})(typeof window !== "undefined" ? window : globalThis);
