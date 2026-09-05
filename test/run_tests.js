#!/usr/bin/env node
/* 测试入口：node test/run_tests.js
 * 零依赖，直接 require js/ 模块（module.exports 双导出模式）。 */
"use strict";

var path = require("path");

global.Cards = require(path.join(__dirname, "..", "js", "cards.js"));
global.Evaluator = require(path.join(__dirname, "..", "js", "evaluator.js"));
global.Engine = require(path.join(__dirname, "..", "js", "engine.js"));

var tests = [];
function test(name, fn) { tests.push({ name: name, fn: fn }); }
function assert(cond, msg) { if (!cond) throw new Error(msg || "断言失败"); }
function assertEq(actual, expected, msg) {
  if (actual !== expected) throw new Error((msg || "不相等") + " — 期望 " + expected + " 实得 " + actual);
}
function assertClose(actual, expected, eps, msg) {
  if (Math.abs(actual - expected) > eps) {
    throw new Error((msg || "不接近") + " — 期望 " + expected + "±" + eps + " 实得 " + actual);
  }
}

require("./evaluator.test.js")({
  test: test, assert: assert, assertEq: assertEq, assertClose: assertClose,
});
require("./engine.test.js")({
  test: test, assert: assert, assertEq: assertEq, assertClose: assertClose,
});

var failed = 0;
for (var i = 0; i < tests.length; i++) {
  try {
    tests[i].fn();
    console.log("  ✓ " + tests[i].name);
  } catch (e) {
    failed++;
    console.log("  ✗ " + tests[i].name);
    console.log("      " + e.message);
  }
}
console.log("");
if (failed) {
  console.log(failed + " 个测试失败");
  process.exit(1);
} else {
  console.log("全部 " + tests.length + " 个测试通过");
}
