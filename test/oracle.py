#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""oracle.py — 独立 Python 对拍脚本

用「显然正确」的朴素实现独立复核 js 实现的两类事实：
  1. 校验和：前 5000 个字典序 7 张组合（code 0..51）的打包评分总和
  2. 精确向量 V1–V6 的 equity（纯元组比较，与 JS 的位打包完全无关）

评估器：对 7 张牌枚举全部 C(7,5)=21 个五张子集，每张五张按
「点数计数 + 花色计数」直接判类取最大。慢但显然正确，只用于对拍。

牌编码与 js/cards.js 一致：code = (rank << 2) | suit，
rank 0..12 = 2..A，suit 0..3 = ♠♥♦♣。

用法：
  python3 test/oracle.py          # 快速：校验和 + V1/V2（秒级）
  python3 test/oracle.py --full   # 追加翻牌前向量 V3–V6（约 1–3 分钟）
"""
import itertools
import sys

RANK_NAMES = "23456789TJQKA"


def parse(s):
    """'As' → code；与 js/Cards.parse 的字母花色一致"""
    rank = RANK_NAMES.index(s[:-1].upper())
    suit = "shdc".index(s[-1].lower())
    return (rank << 2) | suit


def score5(cards):
    """5 张牌 → 类别元组 (category, tiebreakers...)，越大越强"""
    ranks = sorted((c >> 2) + 2 for c in cards)  # 牌值 2..14
    flush = len({c & 3 for c in cards}) == 1
    cnt = {}
    for v in ranks:
        cnt[v] = cnt.get(v, 0) + 1
    groups = sorted(cnt.items(), key=lambda kv: (kv[1], kv[0]), reverse=True)

    straight_high = 0
    if len(cnt) == 5:
        vs = sorted(cnt)
        if vs[-1] - vs[0] == 4:
            straight_high = vs[-1]
        elif vs == [2, 3, 4, 5, 14]:  # 轮子 A2345
            straight_high = 5

    if flush and straight_high:
        return (8, straight_high)
    if groups[0][1] == 4:
        return (7, groups[0][0], groups[1][0])
    if groups[0][1] == 3 and groups[1][1] == 2:
        return (6, groups[0][0], groups[1][0])
    if flush:
        return (5,) + tuple(reversed(ranks))
    if straight_high:
        return (4, straight_high)
    if groups[0][1] == 3:
        kicks = tuple(v for v, c in groups if c == 1)
        return (3, groups[0][0]) + kicks
    if groups[0][1] == 2 and groups[1][1] == 2:
        kick = next(v for v, c in groups if c == 1)
        return (2, groups[0][0], groups[1][0], kick)
    if groups[0][1] == 2:
        kicks = tuple(v for v, c in groups if c == 1)
        return (1, groups[0][0]) + kicks
    return (0,) + tuple(reversed(ranks))


def packed7(cards):
    """7 张牌 → 与 js/evaluator.js 相同布局的打包整数：
    (cat<<20)|(v1<<16)|(v2<<12)|(v3<<8)|(v4<<4)|v5"""
    t = max(score5(list(sub)) for sub in itertools.combinations(cards, 5))
    vals = list(t[1:])
    while len(vals) < 5:
        vals.append(0)
    s = t[0] << 20
    for i, v in enumerate(vals):
        s |= v << (16 - 4 * i)
    return s


def exact_equity(players, board):
    """全已知手牌的精确 equity（含平局均分）。返回 ([equity...], 局面数)"""
    known = {c for h in players for c in h} | set(board)
    deck = [c for c in range(52) if c not in known]
    k = 5 - len(board)
    eq = [0.0] * len(players)
    total = 0
    for combo in itertools.combinations(deck, k):
        full = list(board) + list(combo)
        scores = [max(score5(list(sub)) for sub in itertools.combinations(h + full, 5))
                  for h in players]
        best = max(scores)
        winners = [i for i, s in enumerate(scores) if s == best]
        share = 1.0 / len(winners)
        for i in winners:
            eq[i] += share
        total += 1
    return [e / total for e in eq], total


def checksum_5000():
    """前 5000 个字典序 7 张组合的打包评分总和（与 js 测试同一枚举顺序）"""
    c = [0, 1, 2, 3, 4, 5, 6]
    total = 0
    n = 0
    while n < 5000:
        total += packed7(c)
        n += 1
        i = 6
        while i >= 0 and c[i] == 51 - (6 - i):
            i -= 1
        if i < 0:
            break
        c[i] += 1
        for j in range(i + 1, 7):
            c[j] = c[j - 1] + 1
    return total


VECTORS = [
    ("V1 河牌", [["As", "Ah"], ["Kd", "Kc"]], ["2c", "7h", "9d", "Js"],
     [42 / 44, 2 / 44]),
    ("V2 翻牌", [["As", "Ah"], ["Kd", "Kc"]], ["2c", "7h", "9d"],
     [0.916162, 0.083838]),
]

VECTORS_FULL = [
    ("V3 翻牌前", [["As", "Ah"], ["Kd", "Kc"]], [], [0.812555, 0.187445]),
    ("V4 翻牌前花色重叠", [["As", "Ah"], ["Ks", "Kh"]], [], [0.826366, 0.173634]),
    ("V5 翻牌前 AKs vs QQ", [["As", "Ks"], ["Qd", "Qc"]], [], [0.462145, 0.537855]),
    ("V6 三人翻牌前", [["As", "Ah"], ["Kd", "Kc"], ["Qs", "Qh"]], [],
     [0.665054, 0.188755, 0.146191]),
]

EXPECTED_CHECKSUM = 37575761920  # 由本脚本与 js 实现共同确认（对拍值）


def run_vectors(vectors):
    failures = 0
    for name, players, board, expected in vectors:
        eq, total = exact_equity([[parse(x) for x in h] for h in players],
                                 [parse(x) for x in board])
        got = ["%.6f" % e for e in eq]
        want = ["%.6f" % e for e in expected]
        ok = all(abs(a - b) < 1e-6 for a, b in zip(eq, expected))
        print("  %s %s  equity=%s  (%d 局面)" % ("✓" if ok else "✗", name, got, total))
        if not ok:
            print("      期望 %s" % want)
            failures += 1
    return failures


def main():
    full = "--full" in sys.argv
    failures = 0

    cs = checksum_5000()
    ok = cs == EXPECTED_CHECKSUM
    print("  %s 校验和 = %d（期望 %d）" % ("✓" if ok else "✗", cs, EXPECTED_CHECKSUM))
    failures += 0 if ok else 1

    failures += run_vectors(VECTORS)
    if full:
        failures += run_vectors(VECTORS_FULL)

    print("")
    if failures:
        print("%d 项对拍失败" % failures)
        sys.exit(1)
    print("oracle 对拍全部通过%s" % ("（含翻牌前向量）" if full else "（快速模式，--full 可加测翻牌前）"))


if __name__ == "__main__":
    main()
