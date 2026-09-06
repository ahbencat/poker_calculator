#!/usr/bin/env node
/* test/bench.js — 性能基准（手动运行，不作为测试通过判据）
 *
 * 用法：node test/bench.js
 *
 * 场景与口径（固定种子可复现；每场景预热后 3 轮取最优）：
 *   评估器吞吐        10 万手互异 7 张牌 × 5 遍/轮
 *   精确枚举          2 / 5 / 10 人翻牌前全已知（页面唯一计算路径）
 *   蒙特卡洛          2 人半填 20 万次；10 人 1 已知 10 万次（引擎 API 路径）
 *
 * 项目惯例（CLAUDE.md）：改动热路径前先跑一次留底，改完对比。
 */
"use strict";

var path = require("path");

global.Cards = require(path.join(__dirname, "..", "js", "cards.js"));
global.Evaluator = require(path.join(__dirname, "..", "js", "evaluator.js"));
global.Engine = require(path.join(__dirname, "..", "js", "engine.js"));

var ev = global.Evaluator.evaluate7;
var C = global.Cards.parse;
var Engine = global.Engine;

function fmt(n) { return n.toLocaleString("en-US"); }

function bestOf(rounds, fn) {
  var best = Infinity;
  for (var r = 0; r < rounds; r++) {
    var ms = fn();
    if (ms < best) best = ms;
  }
  return best;
}

/* 固定种子生成 10 万手互异的 7 张牌 */
var HANDS = (function () {
  var a = 42 >>> 0;
  var rng = function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    var t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  var deck = new Uint8Array(52);
  var out = [];
  for (var i = 0; i < 100000; i++) {
    for (var c = 0; c < 52; c++) deck[c] = c;
    var h = new Int32Array(7);
    for (var j = 0; j < 7; j++) {
      var k = j + ((rng() * (52 - j)) | 0);
      var t = deck[j]; deck[j] = deck[k]; deck[k] = t;
      h[j] = deck[j];
    }
    out.push(h);
  }
  return out;
})();

var sink = 0; // 累计校验和，防死码消除

function benchEval() {
  function pass() {
    var sum = 0;
    var t0 = performance.now();
    for (var i = 0; i < HANDS.length; i++) {
      var h = HANDS[i];
      sum += ev(h[0], h[1], h[2], h[3], h[4], h[5], h[6]);
    }
    sink ^= sum;
    return performance.now() - t0;
  }
  pass(); pass(); // 预热
  var ms = bestOf(3, function () {
    var total = 0;
    for (var p = 0; p < 5; p++) total += pass();
    return total;
  });
  return (HANDS.length * 5) / ms / 1000; // 百万次/秒
}

function benchExact(label, players) {
  var warm = Engine.createExactTask(players, []);
  while (!warm.runSlice(performance.now() + 1e9)) {}
  var boards = warm.result().totalBoards;
  function once() {
    var task = Engine.createExactTask(players, []);
    var t0 = performance.now();
    while (!task.runSlice(t0 + 1e9)) {}
    return performance.now() - t0;
  }
  var ms = bestOf(3, once);
  var mps = (boards * players.length) / ms / 1000;
  console.log(label + ms.toFixed(0) + " ms  " + fmt(boards) + " 局面  " + mps.toFixed(1) + "M 评估/秒");
}

function benchMc(label, players, iters) {
  function once() {
    var task = Engine.createMcTask(players, [], { seed: 7, minIters: iters, maxIters: iters });
    var t0 = performance.now();
    while (!task.runSlice(t0 + 1e9)) {}
    return performance.now() - t0;
  }
  once(); // 预热
  var ms = bestOf(3, once);
  console.log(label + ms.toFixed(0) + " ms  " + fmt(iters) + " 次  " + (iters / ms).toFixed(0) + "K 次/秒");
}

function hands(list) {
  return list.map(function (h) { return [C(h[0]), C(h[1])]; });
}

function main() {
  console.log("性能基准  Node " + process.versions.node);
  console.log("--------------------------------------------");
  console.log("评估器吞吐           " + benchEval().toFixed(1) + "M 次/秒");
  benchExact("精确枚举 2 人翻牌前   ", hands([["As", "Ah"], ["Kd", "Kc"]]));
  benchExact("精确枚举 5 人翻牌前   ", hands([["As", "Ah"], ["Kd", "Kc"], ["Qs", "Qh"], ["Js", "Jh"], ["Td", "Tc"]]));
  benchExact("精确枚举 10 人翻牌前  ", hands([
    ["As", "Ah"], ["Kd", "Kc"], ["Qs", "Qh"], ["Js", "Jh"], ["Td", "Tc"],
    ["9s", "9h"], ["8d", "8c"], ["7s", "7h"], ["6d", "6c"], ["5s", "5h"],
  ]));
  var mc10 = [[C("As"), C("Ah")]];
  for (var i = 0; i < 9; i++) mc10.push([null, null]);
  benchMc("蒙特卡洛 2 人半填     ", [[C("As"), null], [C("Kd"), C("Kc")]], 200000);
  benchMc("蒙特卡洛 10 人 1 已知 ", mc10, 100000);
  console.log("--------------------------------------------");
  if (sink === -1) console.log(""); // 引用 sink
  console.log("正确性由 node test/run_tests.js 覆盖，本脚本只测性能。");
}

main();
