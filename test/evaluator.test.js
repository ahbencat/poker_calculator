/* evaluator.test.js — 评估器测试 */
"use strict";

module.exports = function (ctx) {
  var test = ctx.test, assert = ctx.assert, assertEq = ctx.assertEq;
  var Cards = global.Cards, Evaluator = global.Evaluator;
  var ev = Evaluator.evaluate7;

  test("评估器内置自检（9 类牌型 / 排序链 / 轮子 / 踢脚 / 花色无关）", function () {
    var failures = Evaluator.selfTest();
    assertEq(failures.length, 0, "自检失败: " + failures.join("; "));
  });

  test("校验和：前 5000 个字典序 7 张组合评分总和 === 37575761920（与 test/oracle.py 朴素实现对拍一致）", function () {
    var c = [0, 1, 2, 3, 4, 5, 6];
    var sum = 0, n = 0, target = 5000;
    while (n < target) {
      sum += ev(c[0], c[1], c[2], c[3], c[4], c[5], c[6]);
      n++;
      if (global.Engine.nextCombination(c, 52) < 0) break;
    }
    assertEq(n, target, "枚举数量");
    assertEq(sum, 37575761920, "校验和");
  });

  test("踢脚比较：AA K Q J > AA K Q T；同点数异花色分数一致", function () {
    var a = ev(Cards.parse("As"), Cards.parse("Ah"), Cards.parse("Kd"), Cards.parse("Qc"), Cards.parse("Js"), Cards.parse("7h"), Cards.parse("2d"));
    var b = ev(Cards.parse("As"), Cards.parse("Ah"), Cards.parse("Kd"), Cards.parse("Qc"), Cards.parse("Ts"), Cards.parse("7h"), Cards.parse("2d"));
    assert(a > b, "AAKQJ 应大于 AAKQT");
    var s1 = ev(Cards.parse("As"), Cards.parse("Ah"), Cards.parse("Kd"), Cards.parse("Qc"), Cards.parse("Js"), Cards.parse("7h"), Cards.parse("2d"));
    var s2 = ev(Cards.parse("Ac"), Cards.parse("Ad"), Cards.parse("Kh"), Cards.parse("Qs"), Cards.parse("Jh"), Cards.parse("7c"), Cards.parse("2s"));
    assertEq(s1, s2, "同点数异花色应同分");
  });

  test("parse/label 往返一致，非法输入返回 -1", function () {
    for (var r = 0; r < 13; r++) {
      for (var s = 0; s < 4; s++) {
        var code = Cards.make(r, s);
        var lab = Cards.label(code);
        assertEq(Cards.parse(lab), code, "往返 " + lab);
      }
    }
    assertEq(Cards.parse("As"), Cards.make(12, 0));
    assertEq(Cards.parse("10c"), Cards.make(8, 3), "10 应映射 T");
    assertEq(Cards.parse("zz"), -1, "非法 rank");
    assertEq(Cards.parse("Ax"), -1, "非法 suit");
  });

  test("validateInputs 拦截：重复牌 / 手牌槽位错 / 公牌超 5 / 玩家不足", function () {
    var As = Cards.parse("As"), Ah = Cards.parse("Ah"), Kd = Cards.parse("Kd");
    var threw = 0;
    function expectThrow(fn, name) {
      try { fn(); } catch (e) { threw++; return; }
      throw new Error(name + " 未按预期抛错");
    }
    expectThrow(function () { Cards.validateInputs([[As, Ah], [As, Kd]], []); }, "重复牌");
    expectThrow(function () { Cards.validateInputs([[As], [Kd, Ah]], []); }, "单张手牌");
    expectThrow(function () { Cards.validateInputs([[As, Ah]], []); }, "玩家不足");
    expectThrow(function () {
      Cards.validateInputs([[As, Ah], [Kd, Ah]], [0, 1, 2, 3, 4, 5].map(function (c) { return c; }));
    }, "公牌 6 张");
    expectThrow(function () { Cards.validateInputs([[As, 99], [Kd, Ah]], []); }, "非法编码");
    Cards.validateInputs([[As, Ah], [Kd, null]], [0, 1, 2]); // 合法情形不应抛错
  });
};
