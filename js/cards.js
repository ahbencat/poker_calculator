/* cards.js — 牌编码与输入校验
 *
 * 编码：code = (rank << 2) | suit
 *   rank 0..12 对应 2..A；suit 0..3 对应 ♠♥♦♣
 *   code 恰好落在 0..51，可直接用作牌堆下标。
 */
(function (global) {
  "use strict";

  var RANK_LABELS = ["2", "3", "4", "5", "6", "7", "8", "9", "T", "J", "Q", "K", "A"];
  var SUIT_GLYPHS = ["♠", "♥", "♦", "♣"];
  var SUIT_CHARS = "shdc"; // spade heart diamond club
  var SUIT_INDEX = {};
  for (var si = 0; si < 4; si++) {
    SUIT_INDEX[SUIT_CHARS[si]] = si;
    SUIT_INDEX[SUIT_GLYPHS[si]] = si; // parse 同时接受字母与符号花色
  }
  var MIN_PLAYERS = 2;
  var MAX_PLAYERS = 10;

  var RANK_INDEX = {};
  for (var i = 0; i < 13; i++) {
    RANK_INDEX[RANK_LABELS[i]] = i;
  }
  RANK_INDEX["10"] = 8; // 允许用 "10" 表示 T

  var Cards = {
    RANK_LABELS: RANK_LABELS,
    SUIT_GLYPHS: SUIT_GLYPHS,
    MIN_PLAYERS: MIN_PLAYERS,
    MAX_PLAYERS: MAX_PLAYERS,

    make: function (rank, suit) {
      return (rank << 2) | suit;
    },

    rankOf: function (code) {
      return code >> 2;
    },

    suitOf: function (code) {
      return code & 3;
    },

    label: function (code) {
      return RANK_LABELS[code >> 2] + SUIT_GLYPHS[code & 3];
    },

    /* "As" / "Td" / "10c" / "A♠" → code；非法输入返回 -1 */
    parse: function (str) {
      if (typeof str !== "string" || str.length < 2) return -1;
      var rankChar = str.slice(0, -1).toUpperCase();
      var suitChar = str.slice(-1).toLowerCase();
      var rank = RANK_INDEX[rankChar];
      var suit = SUIT_INDEX[suitChar];
      if (rank === undefined || suit === undefined) return -1;
      return (rank << 2) | suit;
    },

    /* 红色花色（♥ ♦）判定，UI 渲染共用 */
    isRedSuit: function (suit) {
      return suit === 1 || suit === 2;
    },

    /* 校验 players/board/deadCards 结构，非法时抛出带中文信息的 Error。
     * players: [[code|null, code|null], ...]；board: [code|null, ...] 长度 0..5；
     * deadCards: [code, ...] 可选，死牌（不参与计算的玩家已亮出的牌），须与所有已知牌互不重复 */
    validateInputs: function (players, board, deadCards) {
      if (!Array.isArray(players) || players.length < MIN_PLAYERS) {
        throw new Error("至少需要 " + MIN_PLAYERS + " 个玩家");
      }
      if (players.length > MAX_PLAYERS) {
        throw new Error("玩家数不能超过 " + MAX_PLAYERS);
      }
      if (!Array.isArray(board) || board.length > 5) {
        throw new Error("公牌最多 5 张");
      }
      var seen = new Array(52);
      for (var p = 0; p < players.length; p++) {
        var hand = players[p];
        if (!Array.isArray(hand) || hand.length !== 2) {
          throw new Error("玩家 " + (p + 1) + " 的手牌必须是 2 个槽位");
        }
        for (var s = 0; s < 2; s++) {
          mark(seen, hand[s], "玩家 " + (p + 1));
        }
      }
      for (var b = 0; b < board.length; b++) {
        mark(seen, board[b], "公牌");
      }
      if (deadCards) {
        for (var d = 0; d < deadCards.length; d++) {
          mark(seen, deadCards[d], "死牌");
        }
      }
    },
  };

  function mark(seen, code, who) {
    if (code === null || code === undefined) return;
    if (!Number.isInteger(code) || code < 0 || code > 51) {
      throw new Error(who + "包含非法牌编码: " + code);
    }
    if (seen[code]) {
      throw new Error(who + "存在重复的牌: " + Cards.label(code));
    }
    seen[code] = true;
  }

  global.Cards = Cards;
  if (typeof module !== "undefined" && module.exports) module.exports = Cards;
})(typeof window !== "undefined" ? window : globalThis);
