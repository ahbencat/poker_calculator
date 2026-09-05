/* engine.test.js — 胜率引擎测试
 *
 * 精确向量 V1–V6 为 Node/Python 双实现逐位对拍得出的精确枚举值（非记忆值），
 * 由 test/oracle.py 可独立复核。
 */
"use strict";

module.exports = function (ctx) {
  var test = ctx.test, assert = ctx.assert, assertEq = ctx.assertEq, assertClose = ctx.assertClose;
  var Cards = global.Cards, Engine = global.Engine;
  function C(s) { return Cards.parse(s); }

  // 公共测试向量（多次使用，钉死花色）
  var AA_KK = [[C("As"), C("Ah")], [C("Kd"), C("Kc")]];
  var FLOP_279 = [C("2c"), C("7h"), C("9d")];

  /* 把任务跑完（支持分片），返回 result */
  function finish(task, sliceMs) {
    var guard = 1000000;
    while (!task.runSlice(performance.now() + (sliceMs || 5000))) {
      if (--guard === 0) throw new Error("任务未能在 guard 预算内完成");
    }
    var r = task.result();
    if (!r) throw new Error("任务完成后 result() 为 null");
    return r;
  }

  function sumEquity(r) {
    var s = 0;
    for (var i = 0; i < r.players.length; i++) s += r.players[i].equity;
    return s;
  }

  test("nCk 组合数", function () {
    assertEq(Engine.nCk(48, 5), 1712304, "C(48,5)");
    assertEq(Engine.nCk(45, 2), 990, "C(45,2)");
    assertEq(Engine.nCk(44, 1), 44, "C(44,1)");
    assertEq(Engine.nCk(44, 0), 1, "C(44,0)");
  });

  test("nextCombination：字典序推进与末尾返回 -1", function () {
    var idx = [0, 1, 2];
    assertEq(Engine.nextCombination(idx, 5), 2, "首次推进最低位"); // → [0,1,3]
    assertEq(idx.join(","), "0,1,3", "[0,1,3]");
    assertEq(Engine.nextCombination(idx, 5), 2, "[0,1,4]");
    assertEq(Engine.nextCombination(idx, 5), 1, "进位到 [0,2,3]");
    assertEq(idx.join(","), "0,2,3", "[0,2,3]");
    var last = [2, 3, 4], steps = 0;
    while (Engine.nextCombination(last, 5) >= 0) steps++;
    assertEq(steps, 0, "已是最后一个组合，立即耗尽");
  });

  test("模式选择：全已知→exact（含翻牌前），缺牌→mc", function () {
    var c1 = Engine.classify(AA_KK, []); // 翻牌前
    assertEq(c1.mode, "exact", "翻牌前全已知");
    assertEq(c1.exactBoards, 1712304, "翻牌前局面数");
    var c2 = Engine.classify(AA_KK, FLOP_279); // 翻牌
    assertEq(c2.mode, "exact", "翻牌全已知");
    assertEq(c2.exactBoards, 990, "翻牌局面数 C(45,2)");
    var c3 = Engine.classify(AA_KK, [C("2c"), C("7h"), C("9d"), C("Js")]); // 转牌
    assertEq(c3.exactBoards, 44, "转牌局面数 C(44,1)");
    var c4 = Engine.classify([[C("As"), null], [C("Kd"), C("Kc")]], []);
    assertEq(c4.mode, "mc", "半填手牌→mc");
    var c5 = Engine.classify([[null, null], [C("Kd"), C("Kc")]], []);
    assertEq(c5.mode, "mc", "空手牌→mc");
    assertEq(c5.unknownHoles, 2, "空手牌未知张数");
  });

  test("V1 河牌：AsAh vs KdKc，公牌 2c 7h 9d Js → AA = 95.4545%", function () {
    var r = finish(Engine.createExactTask(AA_KK, [C("2c"), C("7h"), C("9d"), C("Js")]));
    assertEq(r.totalBoards, 44, "局面数");
    assertClose(r.players[0].equity, 42 / 44, 1e-6, "AA equity");
    assertClose(r.players[1].equity, 2 / 44, 1e-6, "KK equity");
    assertClose(sumEquity(r), 1, 1e-9, "equity 总和");
  });

  test("V2 翻牌：AsAh vs KdKc，公牌 2c 7h 9d → AA = 91.6162%", function () {
    var r = finish(Engine.createExactTask(AA_KK, FLOP_279));
    assertEq(r.totalBoards, 990, "局面数");
    assertClose(r.players[0].equity, 0.916162, 1e-6, "AA equity");
    assertClose(r.players[1].equity, 0.083838, 1e-6, "KK equity");
  });

  test("V2 精确枚举分片恢复与一次性结果一致", function () {
    var one = finish(Engine.createExactTask(AA_KK, FLOP_279));
    var sliced = finish(Engine.createExactTask(AA_KK, FLOP_279), 0); // deadline 已过期 → 每 2048 局面让出
    for (var i = 0; i < 2; i++) {
      assertClose(sliced.players[i].equity, one.players[i].equity, 1e-12, "玩家 " + (i + 1));
    }
  });

  test("V3 翻牌前：AsAh vs KdKc → AA = 81.2555%（胜 81.0646% 平 0.3818%）", function () {
    var r = finish(Engine.createExactTask(AA_KK, []));
    assertEq(r.totalBoards, 1712304, "局面数");
    assertClose(r.players[0].equity, 0.812555, 1e-6, "AA equity");
    assertClose(r.players[0].win, 0.810646, 1e-6, "AA 胜率");
    assertClose(r.players[0].tie, 0.003818, 1e-6, "AA 平局率");
  });

  test("V4 翻牌前：AsAh vs KsKh（花色全重叠）→ AA = 82.6366%", function () {
    var r = finish(Engine.createExactTask([[C("As"), C("Ah")], [C("Ks"), C("Kh")]], []));
    assertClose(r.players[0].equity, 0.826366, 1e-6, "AA equity");
  });

  test("V5 翻牌前：AsKs vs QdQc → AKs = 46.2145%", function () {
    var r = finish(Engine.createExactTask([[C("As"), C("Ks")], [C("Qd"), C("Qc")]], []));
    assertClose(r.players[0].equity, 0.462145, 1e-6, "AKs equity");
    assertClose(r.players[1].equity, 0.537855, 1e-6, "QQ equity");
  });

  test("V6 三人翻牌前：AsAh / KdKc / QsQh → 66.5054% / 18.8755% / 14.6191%", function () {
    var r = finish(Engine.createExactTask(
      [[C("As"), C("Ah")], [C("Kd"), C("Kc")], [C("Qs"), C("Qh")]], []
    ));
    assertClose(r.players[0].equity, 0.665054, 1e-6, "AA");
    assertClose(r.players[1].equity, 0.188755, 1e-6, "KK");
    assertClose(r.players[2].equity, 0.146191, 1e-6, "QQ");
    assertClose(sumEquity(r), 1, 1e-9, "equity 总和");
  });

  test("MC 确定性：同种子分片与一次性逐位一致（min=max 关闭时间停止）", function () {
    var players = [[C("As"), C("Ah")], [C("Kd"), null]];
    var one = Engine.createMcTask(players, FLOP_279, { seed: 42, minIters: 50000, maxIters: 50000 });
    var a = finish(one);
    var two = Engine.createMcTask(players, FLOP_279, { seed: 42, minIters: 50000, maxIters: 50000 });
    var b = finish(two, 0); // 极小分片强制多次让出
    assertEq(b.iterations, a.iterations, "迭代次数");
    for (var i = 0; i < a.players.length; i++) {
      assertEq(b.players[i].equity, a.players[i].equity, "玩家 " + (i + 1) + " equity 逐位一致");
    }
  });

  test("MC 统计：固定种子 20 万次，AA vs KK 落在精确值 ±4SE 内", function () {
    var r = finish(Engine.createMcTask(AA_KK, [], { seed: 12345, minIters: 200000, maxIters: 200000 }));
    assertEq(r.iterations, 200000, "迭代次数");
    var p0 = r.players[0];
    var se = p0.se || 1;
    assertClose(p0.equity, 0.812555, 4 * se, "AA equity 偏差超出 4SE");
  });

  test("MC 半填手牌：已知 1 张 + 随机 1 张可计算且 equity 总和为 1", function () {
    var r = finish(Engine.createMcTask(
      [[C("As"), null], [C("Kd"), C("Kc")]], FLOP_279,
      { seed: 7, minIters: 20000, maxIters: 20000 }
    ));
    assertClose(sumEquity(r), 1, 1e-9, "equity 总和");
    assert(r.players[0].equity > 0 && r.players[0].equity < 1, "A 半填 equity 在 (0,1) 内");
  });

  test("随机对随机：10 个玩家全随机可计算且 equity 总和为 1", function () {
    var players = [];
    for (var i = 0; i < 10; i++) players.push([null, null]);
    var task = Engine.createMcTask(players, [], { seed: 99, minIters: 20000, maxIters: 20000 });
    var r = finish(task);
    assertClose(sumEquity(r), 1, 1e-9, "equity 总和");
  });

  test("全随机精确均分：equity 严格等于 1/P（与模拟噪声无关）", function () {
    // 2 人
    var r2 = finish(Engine.createMcTask([[null, null], [null, null]], [],
      { seed: 1, minIters: 20000, maxIters: 20000 }));
    assert(r2.uniform === true, "应标记 uniform");
    assertEq(r2.players[0].equity, 0.5, "2 人 equity 精确 50%");
    assertEq(r2.players[1].equity, 0.5, "2 人 equity 精确 50%");
    // 3 人（带部分公牌——可交换性与公牌无关）
    var r3 = finish(Engine.createMcTask(
      [[null, null], [null, null], [null, null]], FLOP_279,
      { seed: 2, minIters: 20000, maxIters: 20000 }
    ));
    assert(r3.uniform === true, "带公牌仍应标记 uniform");
    for (var i = 0; i < 3; i++) {
      assertClose(r3.players[i].equity, 1 / 3, 1e-12, "3 人 equity 精确 1/3");
    }
    // win/tie 在玩家间应一致（取平均后）
    assertEq(r3.players[0].win, r3.players[1].win, "win 一致");
    assertEq(r3.players[0].tie, r3.players[2].tie, "tie 一致");
    assertClose(r3.players[0].win + r3.players[0].tie, 1 / 3, 0.01, "win+tie 接近 equity");
  });

  test("半随机不受均分影响：指定手牌与随机手牌 equity 不等", function () {
    var r = finish(Engine.createMcTask([[C("As"), C("Ah")], [null, null]], [],
      { seed: 3, minIters: 20000, maxIters: 20000 }));
    assert(!r.uniform, "AA 对随机不应标记 uniform");
    assert(r.players[0].equity > 0.75, "AA 对随机 equity 应约 85%，实得 " + r.players[0].equity);
    assert(Math.abs(r.players[0].equity - r.players[1].equity) > 0.1, "双方 equity 应明显不等");
  });

  test("全已知河牌零未知：k=0 走通用枚举路径（V1 的退化情形）", function () {
    var r = finish(Engine.createExactTask(
      AA_KK, [C("2c"), C("7h"), C("9d"), C("Js"), C("4d")]
    ));
    assertEq(r.totalBoards, 1, "唯一局面");
    assertClose(r.players[0].equity, 1, 1e-12, "AA 胜 99 对 77");
  });

  test("createTask：缺牌时直接蒙特卡洛", function () {
    var r = finish(Engine.createTask(
      [[C("As"), null], [C("Kd"), C("Kc")]], [],
      { seed: 5, minIters: 5000, maxIters: 5000 }
    ));
    assertEq(r.mode, "mc", "模式");
    assert(!r.provisional, "非预览");
    assertEq(r.iterations, 5000, "迭代次数");
  });

  test("createTask：轻量精确枚举直接完成（无预览）", function () {
    var r = finish(Engine.createTask(AA_KK, [C("2c"), C("7h"), C("9d"), C("Js")]));
    assertEq(r.mode, "exact", "模式");
    assertEq(r.totalBoards, 44, "局面数");
    assertClose(r.players[0].equity, 42 / 44, 1e-6, "AA equity");
  });

  test("createTask：重枚举先出预览再切换精确，终值即精确值", function () {
    var task = Engine.createTask(AA_KK, []); // 翻牌前全已知 → 3.4M 次评估
    var sawProvisional = false, guard = 100000;
    while (!task.runSlice(performance.now() + 12)) {
      if (guard-- === 0) throw new Error("超时");
      var r = task.result();
      if (r && r.provisional) sawProvisional = true;
    }
    assert(sawProvisional, "应先出现预览结果");
    var res = task.result();
    assertEq(res.mode, "exact", "终值模式");
    assert(!res.provisional, "终值无预览标记");
    assertClose(res.players[0].equity, 0.812555, 1e-6, "AA 精确值");
  });

  test("死牌：从牌堆移除，枚举规模与概率随之改变", function () {
    // V1 河牌场景 + 死牌 Kh：剩余 44 张变 43，KK 只剩 Ks 一张救命牌
    var r = finish(Engine.createExactTask(
      AA_KK, [C("2c"), C("7h"), C("9d"), C("Js")], { deadCards: [C("Kh")] }
    ));
    assertEq(r.totalBoards, 43, "局面数（44 − 1 死牌）");
    assertClose(r.players[0].equity, 42 / 43, 1e-6, "AA equity");
    assertClose(r.players[1].equity, 1 / 43, 1e-6, "KK equity（仅剩 Ks 一张）");
    // 对照：无死牌时 AA = 42/44 ≈ 0.9545，死牌使 AA 升至 42/43 ≈ 0.9767
  });

  test("死牌校验：与已知牌重复或非法编码抛错", function () {
    var threw = 0;
    try { Engine.createExactTask(AA_KK, [], { deadCards: [C("As")] }); } catch (e) { threw++; }
    assertEq(threw, 1, "死牌与手牌重复应抛错");
    try { Engine.createExactTask(AA_KK, [], { deadCards: [C("2c"), C("2c")] }); } catch (e) { threw++; }
    assertEq(threw, 2, "死牌自身重复应抛错");
    try { Engine.createExactTask(AA_KK, [], { deadCards: [99] }); } catch (e) { threw++; }
    assertEq(threw, 3, "死牌非法编码应抛错");
  });

  test("createTask 透传死牌（MC 路径，引擎 API 保留）", function () {
    var r = finish(Engine.createTask(
      [[C("As"), null], [C("Kd"), C("Kc")]], [],
      { seed: 11, minIters: 20000, maxIters: 20000, deadCards: [C("Qs"), C("Qh")] }
    ));
    assertEq(r.mode, "mc", "模式");
    assertClose(sumEquity(r), 1, 1e-9, "equity 总和");
  });
};
