/* evaluator.js — 7 张牌牌型评估器（掩码方案）
 *
 * 分数布局：(category << 20) | (v1 << 16) | (v2 << 12) | (v3 << 8) | (v4 << 4) | v5
 *   category 0..8：高牌/一对/两对/三条/顺子/同花/葫芦/四条/同花顺
 *   v ∈ 2..14 恰好占 4 位；分数越大牌型越强，可直接比较。
 *
 * 判定顺序：同花最先（7 张内同花不可能与四条/葫芦共存），
 * 之后按 四条 → 葫芦 → 顺子 → 三条 → 两对 → 一对 → 高牌。
 */
(function (global) {
  "use strict";

  var SIZE = 8192; // 2^13，13 位 rank 掩码全空间

  /* STR[m]：掩码 m 中最高顺子的高牌值（5..14，0=无顺子）。
   * 轮子 A2345（掩码位 12 与 0..3）记 5。 */
  var STR = new Int8Array(SIZE);
  /* POP[m]：掩码中 1 的个数 */
  var POP = new Int8Array(SIZE);
  /* TOP5[m]：掩码最高 5 个 rank（值 2..14）打包成 5 个 4 位字段，高位在前 */
  var TOP5 = new Int32Array(SIZE);

  (function buildTables() {
    for (var m = 0; m < SIZE; m++) {
      // popcount
      var n = 0, t = m;
      while (t) { t &= t - 1; n++; }
      POP[m] = n;
      // 最高顺子：hi 从 A(12) 向下扫到 6(4)，检查连续 5 位
      var sv = 0;
      for (var hi = 12; hi >= 4; hi--) {
        var pattern = 31 << (hi - 4);
        if ((m & pattern) === pattern) { sv = hi + 2; break; }
      }
      if (sv === 0 && (m & 0x100F) === 0x100F) sv = 5; // 轮子
      STR[m] = sv;
      // 最高 5 位打包
      var packed = 0, count = 0;
      for (var r = 12; r >= 0 && count < 5; r--) {
        if (m & (1 << r)) { packed = (packed << 4) | (r + 2); count++; }
      }
      while (count < 5) { packed <<= 4; count++; }
      TOP5[m] = packed;
    }
  })();

  /* 掩码最高位与次高位的 rank 下标（调用方保证相应位存在） */
  function topBit(m) { return 31 - Math.clz32(m); }
  function secondBit(m) { return topBit(m & ~(1 << topBit(m))); }

  /* 花色车道增量：把 4 个花色的计数装进一个 int 的 4 个字节（无分支） */
  var INC = new Int32Array([1, 0x100, 0x10000, 0x1000000]);

  /* 返回可比较的整数分数；参数为 7 张牌的编码（0..51），零分配。
   *
   * rank 出现次数状态机用无分支位运算推进（a/b/c = x 当前所在的层）：
   *   x 首次出现 → s1；(s1→s2)、(s2→s3)、(s3→s4) 逐层上移。
   * 分支误预测在随机牌局下不可忽视，实测无分支版比 if 链快约 13%。 */
  function evaluate7(c0, c1, c2, c3, c4, c5, c6) {
    var s1 = 0, s2 = 0, s3 = 0, s4 = 0, sc = 0;
    var x, a, b, c;

    // ---- 逐张处理：rank 状态机（无分支）+ 花色车道计数 ----
    x = 1 << (c0 >> 2);
    a = x & s1; b = x & s2; c = x & s3;
    s1 = (s1 | x) & ~(a | b | c); s2 = (s2 | a) ^ b; s3 = (s3 | b) ^ c; s4 |= c;
    sc += INC[c0 & 3];

    x = 1 << (c1 >> 2);
    a = x & s1; b = x & s2; c = x & s3;
    s1 = (s1 | x) & ~(a | b | c); s2 = (s2 | a) ^ b; s3 = (s3 | b) ^ c; s4 |= c;
    sc += INC[c1 & 3];

    x = 1 << (c2 >> 2);
    a = x & s1; b = x & s2; c = x & s3;
    s1 = (s1 | x) & ~(a | b | c); s2 = (s2 | a) ^ b; s3 = (s3 | b) ^ c; s4 |= c;
    sc += INC[c2 & 3];

    x = 1 << (c3 >> 2);
    a = x & s1; b = x & s2; c = x & s3;
    s1 = (s1 | x) & ~(a | b | c); s2 = (s2 | a) ^ b; s3 = (s3 | b) ^ c; s4 |= c;
    sc += INC[c3 & 3];

    x = 1 << (c4 >> 2);
    a = x & s1; b = x & s2; c = x & s3;
    s1 = (s1 | x) & ~(a | b | c); s2 = (s2 | a) ^ b; s3 = (s3 | b) ^ c; s4 |= c;
    sc += INC[c4 & 3];

    x = 1 << (c5 >> 2);
    a = x & s1; b = x & s2; c = x & s3;
    s1 = (s1 | x) & ~(a | b | c); s2 = (s2 | a) ^ b; s3 = (s3 | b) ^ c; s4 |= c;
    sc += INC[c5 & 3];

    x = 1 << (c6 >> 2);
    a = x & s1; b = x & s2; c = x & s3;
    s1 = (s1 | x) & ~(a | b | c); s2 = (s2 | a) ^ b; s3 = (s3 | b) ^ c; s4 |= c;
    sc += INC[c6 & 3];

    // ---- 同花（含同花顺）----
    // 某花色计数 ≥5 ⇔ 该字节加 3 后 bit3 置位（计数 ≤7，+3=10 无跨字节进位）。
    // 7 张内至多一个花色 ≥5；同花仅约 3%，慢路径重建该花色掩码。
    var f = (sc + 0x03030303) & 0x08080808;
    if (f !== 0) {
      var suit = f === 0x08000000 ? 3 : f === 0x00080000 ? 2 : f === 0x00000800 ? 1 : 0;
      var fm = 0;
      if ((c0 & 3) === suit) fm |= 1 << (c0 >> 2);
      if ((c1 & 3) === suit) fm |= 1 << (c1 >> 2);
      if ((c2 & 3) === suit) fm |= 1 << (c2 >> 2);
      if ((c3 & 3) === suit) fm |= 1 << (c3 >> 2);
      if ((c4 & 3) === suit) fm |= 1 << (c4 >> 2);
      if ((c5 & 3) === suit) fm |= 1 << (c5 >> 2);
      if ((c6 & 3) === suit) fm |= 1 << (c6 >> 2);
      var sf = STR[fm];
      if (sf !== 0) return (8 << 20) | (sf << 16); // 同花顺
      return (5 << 20) | TOP5[fm];                  // 同花
    }

    // 全体 rank 掩码延迟派生（同花早退路径不需要它）
    var rm = s1 | s2 | s3 | s4;

    // ---- 四条 ----
    if (s4 !== 0) {
      var q = topBit(s4);
      var kq = topBit(rm & ~s4);
      return (7 << 20) | ((q + 2) << 16) | ((kq + 2) << 12);
    }

    // ---- 葫芦：三条 + 一对，或两组三条 ----
    if (s3 !== 0 && (s2 !== 0 || POP[s3] > 1)) {
      var tr = topBit(s3), pr;
      if (POP[s3] > 1) {
        pr = secondBit(s3); // 第二组三条当对子
        var pp = s2 !== 0 ? topBit(s2) : 0;
        if (pp > pr) pr = pp;
      } else {
        pr = topBit(s2);
      }
      return (6 << 20) | ((tr + 2) << 16) | ((pr + 2) << 12);
    }

    // ---- 顺子 ----
    var st = STR[rm];
    if (st !== 0) return (4 << 20) | (st << 16);

    // ---- 三条 + 2 踢脚 ----
    if (s3 !== 0) {
      var t3 = topBit(s3);
      var k1 = topBit(s1);
      var k2 = topBit(s1 & ~(1 << k1));
      return (3 << 20) | ((t3 + 2) << 16) | ((k1 + 2) << 12) | ((k2 + 2) << 8);
    }

    // ---- 两对 + 1 踢脚（第三对的 rank 可作踢脚）----
    if (POP[s2] > 1) {
      var p1 = topBit(s2);
      var p2 = secondBit(s2);
      var kick = topBit(rm & ~(1 << p1) & ~(1 << p2));
      return (2 << 20) | ((p1 + 2) << 16) | ((p2 + 2) << 12) | ((kick + 2) << 8);
    }

    // ---- 一对 + 3 踢脚 ----
    if (s2 !== 0) {
      var pair = topBit(s2);
      var a = topBit(s1);
      var b = topBit(s1 & ~(1 << a));
      var c = topBit(s1 & ~(1 << a) & ~(1 << b));
      return (1 << 20) | ((pair + 2) << 16) | ((a + 2) << 12) | ((b + 2) << 8) | ((c + 2) << 4);
    }

    // ---- 高牌：7 张全异，取最高 5 张 ----
    return TOP5[rm];
  }

  function categoryOf(score) {
    return score >>> 20;
  }

  /* 内置自检：已知牌型的类别与关键值、类别排序链、花色无关性。
   * 返回失败描述数组（空数组 = 全部通过）。
   * 编码：(rank<<2)|suit，rank 2=0..A=12，suit ♠0 ♥1 ♦2 ♣3。 */
  function selfTest() {
    var failures = [];
    function expectCat(cards, cat, name) {
      var s = evaluate7.apply(null, cards);
      if (categoryOf(s) !== cat) failures.push(name + ": 期望类别 " + cat + " 实得 " + categoryOf(s));
      return s;
    }
    // 同花顺 A-high：A♠ K♠ Q♠ J♠ T♠ 9♥ 8♦
    expectCat([48, 44, 40, 36, 32, 29, 26], 8, "皇家同花顺");
    // 轮子同花顺：A♠ 2♠ 3♠ 4♠ 5♠ K♥ Q♦
    var wheelSF = expectCat([48, 0, 4, 8, 12, 45, 42], 8, "轮子同花顺");
    if (((wheelSF >> 16) & 15) !== 5) failures.push("轮子同花顺高牌应为 5: " + wheelSF.toString(16));
    // 四条 + 踢脚：A♠ A♥ A♦ A♣ K♠ 9♥ 2♦
    var quads = expectCat([48, 49, 50, 51, 44, 29, 2], 7, "四条");
    if (((quads >> 16) & 15) !== 14 || ((quads >> 12) & 15) !== 13) failures.push("四条踢脚错误: " + quads.toString(16));
    // 葫芦（两条三条）：7♠ 7♥ 7♦ 3♠ 3♥ 3♦ K♣ → 777+33（值 7 与 3）
    var fh = expectCat([20, 21, 22, 4, 5, 6, 47], 6, "双三条葫芦");
    if (((fh >> 16) & 15) !== 7 || ((fh >> 12) & 15) !== 3) failures.push("双三条葫芦取值错误: " + fh.toString(16));
    // 葫芦（三条 + 两对）：7♠ 7♥ 7♦ Q♠ Q♥ 3♠ 3♦ → 对子取 Q（值 12）
    var fh2 = expectCat([20, 21, 22, 40, 41, 4, 6], 6, "三条两对葫芦");
    if (((fh2 >> 16) & 15) !== 7 || ((fh2 >> 12) & 15) !== 12) failures.push("葫芦对子应取 Q: " + fh2.toString(16));
    // 同花：A♠ K♠ 9♠ 5♠ 2♠ J♥ T♦
    var fl = expectCat([48, 44, 28, 12, 0, 37, 34], 5, "同花");
    if (((fl >> 16) & 15) !== 14) failures.push("同花最高牌应为 A: " + fl.toString(16));
    // 轮子顺（杂色）：A♠ 2♥ 3♦ 4♣ 5♠ K♥ Q♦
    var wheel = expectCat([48, 1, 6, 11, 12, 45, 42], 4, "轮子顺");
    if (((wheel >> 16) & 15) !== 5) failures.push("轮子顺高牌应为 5: " + wheel.toString(16));
    // 三条：9♠ 9♥ 9♦ A♠ K♠ Q♥ J♦
    var trips = expectCat([28, 29, 30, 48, 44, 41, 38], 3, "三条");
    if (((trips >> 16) & 15) !== 9) failures.push("三条取值错误");
    // 两对 + 第三对当踢脚：A♠ A♥ K♠ K♥ Q♠ Q♥ 2♦
    var tp = expectCat([48, 49, 44, 45, 40, 41, 2], 2, "三对取两对");
    if (((tp >> 16) & 15) !== 14 || ((tp >> 12) & 15) !== 13 || ((tp >> 8) & 15) !== 12) {
      failures.push("两对 AA KK Q 踢脚错误: " + tp.toString(16));
    }
    // 一对：9♠ 9♥ A♦ K♣ 4♥ 3♦ 2♣（无顺子干扰）
    var pair = expectCat([28, 29, 50, 47, 9, 6, 3], 1, "一对");
    if (((pair >> 16) & 15) !== 9 || ((pair >> 12) & 15) !== 14) failures.push("一对取值错误: " + pair.toString(16));
    // 高牌：A♠ K♠ J♥ 9♦ 7♣ 5♥ 2♦
    expectCat([48, 44, 37, 30, 23, 15, 2], 0, "高牌");

    // 类别排序链：分数严格递增（每类取较弱代表）
    var chain = [
      [48, 44, 37, 30, 23, 15, 2],   // 高牌 A K J 9 7
      [28, 29, 50, 47, 9, 6, 3],     // 一对 9（A K 踢脚）
      [48, 49, 44, 45, 40, 41, 2],   // 两对 AA KK（Q 踢脚）
      [28, 29, 30, 48, 44, 41, 38],  // 三条 9
      [48, 1, 6, 11, 12, 45, 42],    // 顺子（轮子，最弱顺）
      [48, 44, 28, 12, 0, 37, 34],   // 同花
      [20, 21, 22, 4, 5, 6, 47],     // 葫芦 777+33
      [28, 29, 30, 31, 21, 7, 2],    // 四条 9（弱踢脚）
      [48, 0, 4, 8, 12, 45, 42],     // 同花顺（轮子，最弱同花顺）
    ];
    for (var i = 1; i < chain.length; i++) {
      if (evaluate7.apply(null, chain[i - 1]) >= evaluate7.apply(null, chain[i])) {
        failures.push("排序链在位置 " + i + " 不满足严格递增");
      }
    }

    // 花色无关性：点数相同的两手分数必须完全一致
    var h1 = [48, 49, 50, 51, 44, 29, 2]; // A♠A♥A♦A♣ K♠ 9♥ 2♦
    var h2 = [51, 50, 49, 48, 47, 30, 3]; // A♣A♦A♥A♠ K♣ 9♦ 2♣
    if (evaluate7.apply(null, h1) !== evaluate7.apply(null, h2)) failures.push("点数相同花色不同的两手分数不一致");

    return failures;
  }

  var Evaluator = {
    evaluate7: evaluate7,
    selfTest: selfTest,
  };

  global.Evaluator = Evaluator;
  if (typeof module !== "undefined" && module.exports) module.exports = Evaluator;
})(typeof window !== "undefined" ? window : globalThis);
