/* app.js — UI 状态机、调度器、底部弹层选择器
 *
 * 调度：输入变更 → debounce 120ms → Engine.createTask（引擎内部决定
 * 精确枚举/蒙特卡洛/预览策略）→ 12ms 分片运行（MessageChannel 让出
 * 主线程），每片后增量渲染。
 */
(function (global) {
  "use strict";

  var Cards = global.Cards;
  var Engine = global.Engine;
  var MIN_PLAYERS = Cards.MIN_PLAYERS;
  var MAX_PLAYERS = Cards.MAX_PLAYERS;

  var state = {
    players: [],   // [{ cards: [code|null, code|null] }]
    board: [null, null, null, null, null],
    picker: null,  // { type: "hole", player, slot } | { type: "board", slot }
    generation: 0,
    task: null,    // { gen, task }
  };

  /* ---------- DOM 引用 ---------- */

  var els = {};
  function $(id) { return document.getElementById(id); }

  /* ---------- 初始化 ---------- */

  function init() {
    els.badge = $("modeBadge");
    els.boardRow = $("boardRow");
    els.playerList = $("playerList");
    els.addPlayer = $("addPlayer");
    els.clearBoard = $("clearBoard");
    els.overlay = $("pickerOverlay");
    els.sheet = $("pickerSheet");
    els.pickerTitle = $("pickerTitle");
    els.pickerGrid = $("pickerGrid");
    els.pickerClose = $("pickerClose");
    els.pickerClear = $("pickerClear");

    state.players = [{ cards: [null, null] }, { cards: [null, null] }];

    els.addPlayer.addEventListener("click", addPlayer);
    els.clearBoard.addEventListener("click", function () {
      for (var i = 0; i < 5; i++) state.board[i] = null;
      renderBoard();
      scheduleRecalc();
    });
    els.playerList.addEventListener("click", onPlayerListClick);
    els.boardRow.addEventListener("click", onBoardRowClick);
    els.pickerGrid.addEventListener("click", onPickerGridClick);
    els.pickerClose.addEventListener("click", closePicker);
    els.pickerClear.addEventListener("click", clearPickedSlot);
    els.overlay.addEventListener("click", function (e) {
      if (e.target === els.overlay) closePicker();
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && state.picker) closePicker();
    });

    renderAll();
    scheduleRecalc();
  }

  /* ---------- 渲染 ---------- */

  function renderAll() {
    renderBoard();
    renderPlayers();
    updateAddButton();
  }

  /* 牌槽按钮：有牌（code 非 null）时填入点数/花色并标记 filled */
  function makeSlotButton(attrs, code) {
    var b = document.createElement("button");
    b.type = "button";
    b.className = "card-slot";
    for (var k in attrs) b.setAttribute(k, attrs[k]);
    if (code !== null && code !== undefined) {
      b.classList.add("filled");
      var rank = document.createElement("span");
      rank.className = "card-rank";
      rank.textContent = Cards.RANK_LABELS[Cards.rankOf(code)];
      var suit = document.createElement("span");
      suit.className = "card-suit" + (Cards.isRedSuit(Cards.suitOf(code)) ? " red" : "");
      suit.textContent = Cards.SUIT_GLYPHS[Cards.suitOf(code)];
      b.appendChild(rank);
      b.appendChild(suit);
    }
    return b;
  }

  var BOARD_STREETS = ["翻牌 1", "翻牌 2", "翻牌 3", "转牌", "河牌"];

  function renderBoard() {
    els.boardRow.textContent = "";
    for (var i = 0; i < 5; i++) {
      var btn = makeSlotButton(
        { "data-board": i, "aria-label": "选择公牌·" + BOARD_STREETS[i] },
        state.board[i]
      );
      if (i === 2 || i === 3) btn.classList.add("street-gap");
      els.boardRow.appendChild(btn);
    }
  }

  /* renderPlayers 重建 DOM 的同时缓存每行的结果元素引用，
   * 供分片渲染直接索引（避免每片 3×P 次 querySelector） */
  var playerEls = [];

  function renderPlayers() {
    els.playerList.textContent = "";
    playerEls = [];
    state.players.forEach(function (p, i) {
      var row = document.createElement("div");
      row.className = "player";
      row.setAttribute("data-idx", i);

      var head = document.createElement("div");
      head.className = "player-head";

      var name = document.createElement("span");
      name.className = "player-name";
      name.textContent = "玩家 " + (i + 1);
      head.appendChild(name);

      var holeWrap = document.createElement("div");
      holeWrap.className = "hole-cards";
      for (var s = 0; s < 2; s++) {
        var code = p.cards[s];
        var btn = makeSlotButton(
          { "data-player": i, "data-slot": s, "aria-label": "玩家 " + (i + 1) + " 第 " + (s + 1) + " 张手牌" },
          code
        );
        if (code === null) {
          btn.classList.add("placeholder");
          btn.textContent = "随机";
        }
        holeWrap.appendChild(btn);
      }
      head.appendChild(holeWrap);

      var remove = document.createElement("button");
      remove.type = "button";
      remove.className = "remove-btn";
      remove.setAttribute("data-remove", i);
      remove.setAttribute("aria-label", "删除玩家 " + (i + 1));
      remove.textContent = "×";
      if (state.players.length <= MIN_PLAYERS) remove.disabled = true;
      head.appendChild(remove);

      row.appendChild(head);

      var bar = document.createElement("div");
      bar.className = "bar";
      var fill = document.createElement("div");
      fill.className = "bar-fill";
      fill.style.width = "0%";
      bar.appendChild(fill);
      row.appendChild(bar);

      var nums = document.createElement("div");
      nums.className = "nums";
      var equity = document.createElement("span");
      equity.className = "equity";
      equity.textContent = "—";
      var detail = document.createElement("span");
      detail.className = "detail";
      nums.appendChild(equity);
      nums.appendChild(detail);
      row.appendChild(nums);

      playerEls[i] = { fill: fill, equity: equity, detail: detail };
      els.playerList.appendChild(row);
    });
  }

  function updateAddButton() {
    var full = state.players.length >= MAX_PLAYERS;
    els.addPlayer.disabled = full;
    els.addPlayer.textContent = full ? "已达上限（" + MAX_PLAYERS + " 位玩家）" : "＋ 添加玩家";
  }

  function resetResults() {
    for (var i = 0; i < playerEls.length; i++) {
      playerEls[i].fill.style.width = "0%";
      playerEls[i].equity.textContent = "—";
      playerEls[i].detail.textContent = "";
    }
  }

  function setBadge(text) { els.badge.textContent = text; }

  function fmtInt(n) {
    return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  }

  function applyResult(res) {
    for (var i = 0; i < res.players.length; i++) {
      var p = res.players[i];
      var el = playerEls[i];
      if (!el) continue;
      el.fill.style.width = (p.equity * 100).toFixed(1) + "%";
      el.equity.textContent = (p.equity * 100).toFixed(1) + "%";
      el.detail.textContent = "胜 " + (p.win * 100).toFixed(1) + "% · 平 " + (p.tie * 100).toFixed(1) + "%";
    }
  }

  /* ---------- 调度 ---------- */

  var debounceTimer = 0;
  function scheduleRecalc() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(startCalc, 120);
  }

  function playersState() {
    return state.players.map(function (p) { return p.cards; });
  }

  function startCalc() {
    state.generation++;
    state.task = null;
    resetResults();
    var task;
    try {
      task = Engine.createTask(playersState(), state.board);
    } catch (e) {
      setBadge("输入有误：" + e.message);
      return;
    }
    state.task = { gen: state.generation, task: task };
    setBadge("计算中…");
    ensureChannel();
    postPump();
  }

  /* MessageChannel 驱动的分片泵（无 setTimeout 4ms 钳制）。
   * pumpPending 防止快速输入变更时消息双队列连续占满主线程。 */
  var channel = null;
  var pumpPending = false;
  function ensureChannel() {
    if (channel) return;
    channel = new MessageChannel();
    channel.port1.onmessage = onPump;
  }

  function onPump() {
    pumpPending = false;
    var t = state.task;
    if (!t) return;
    if (t.gen !== state.generation) { state.task = null; return; } // 已被新输入取消
    var done;
    try {
      done = t.task.runSlice(performance.now() + 12);
    } catch (e) {
      state.task = null;
      setBadge("计算出错：" + e.message);
      return;
    }
    if (!done) {
      renderProgress(t.task);
      postPump();
      return;
    }
    state.task = null;
    var res = t.task.result();
    if (!res) { setBadge("计算未完成"); return; }
    applyResult(res);
    setBadge(badgeFor(res, false));
  }

  function postPump() {
    if (pumpPending) return;
    pumpPending = true;
    channel.port2.postMessage(0);
  }

  /* 片间渲染：有部分结果（蒙特卡洛/预览）就刷数字，否则显示枚举进度 */
  function renderProgress(task) {
    var res = task.result();
    if (res) {
      applyResult(res);
      setBadge(badgeFor(res, true));
    } else {
      setBadge("精确枚举 · " + Math.round(task.progress() * 100) + "%");
    }
  }

  /* 徽标文案的唯一出口：running 区分进行中与最终 */
  function badgeFor(res, running) {
    if (res.mode === "exact") return "精确枚举 · " + fmtInt(res.totalBoards) + " 个局面";
    if (res.uniform) return "随机对局 · 胜率精确均分 · " + fmtInt(res.iterations) + " 次模拟";
    if (running) {
      return (res.provisional ? "快速预估 · " : "蒙特卡洛 · ") + fmtInt(res.iterations) + " 次模拟…";
    }
    var maxSe = 0;
    for (var i = 0; i < res.players.length; i++) {
      if (res.players[i].se > maxSe) maxSe = res.players[i].se;
    }
    return "蒙特卡洛 · " + fmtInt(res.iterations) + " 次模拟 · ±" + (maxSe * 196).toFixed(1) + "%";
  }

  /* ---------- 玩家增减 ---------- */

  function addPlayer() {
    if (state.players.length >= MAX_PLAYERS) return;
    state.players.push({ cards: [null, null] });
    renderPlayers();
    updateAddButton();
    scheduleRecalc();
  }

  function removePlayer(idx) {
    if (state.players.length <= MIN_PLAYERS) return;
    state.players.splice(idx, 1);
    renderPlayers();
    updateAddButton();
    scheduleRecalc();
  }

  /* ---------- 事件 ---------- */

  function onPlayerListClick(e) {
    var removeBtn = e.target.closest("[data-remove]");
    if (removeBtn) {
      removePlayer(Number(removeBtn.getAttribute("data-remove")));
      return;
    }
    var slot = e.target.closest("[data-player]");
    if (slot) {
      openPicker({
        type: "hole",
        player: Number(slot.getAttribute("data-player")),
        slot: Number(slot.getAttribute("data-slot")),
      });
    }
  }

  function onBoardRowClick(e) {
    var slot = e.target.closest("[data-board]");
    if (slot) openPicker({ type: "board", slot: Number(slot.getAttribute("data-board")) });
  }

  /* ---------- 牌面选择器（底部弹层） ---------- */

  var openerSlot = null; // 关闭后归还焦点

  function currentSlotCard(t) {
    return t.type === "hole" ? state.players[t.player].cards[t.slot] : state.board[t.slot];
  }

  function assignSlot(t, code) {
    if (t.type === "hole") state.players[t.player].cards[t.slot] = code;
    else state.board[t.slot] = code;
  }

  function usedCardsExcept(t) {
    var used = {};
    state.players.forEach(function (p) {
      p.cards.forEach(function (c) { if (c !== null) used[c] = true; });
    });
    for (var i = 0; i < 5; i++) {
      if (state.board[i] !== null) used[state.board[i]] = true;
    }
    var own = currentSlotCard(t);
    if (own !== null && own !== undefined) delete used[own]; // 本槽位已有的牌保持可选（可重选回原位）
    return used;
  }

  /* 弹层定位到某个槽位：更新标题、重建网格、聚焦首个可用牌 */
  function showPicker(target) {
    state.picker = target;
    updatePickerTitle();
    renderPickerGrid();
    var first = els.pickerGrid.querySelector("button:not(:disabled)");
    if (first) first.focus();
  }

  function openPicker(target) {
    openerSlot = document.activeElement;
    els.overlay.hidden = false;
    lockScroll();
    showPicker(target);
  }

  function closePicker() {
    els.overlay.hidden = true;
    state.picker = null;
    unlockScroll();
    if (openerSlot && openerSlot.focus) openerSlot.focus();
    openerSlot = null;
  }

  function updatePickerTitle() {
    var t = state.picker;
    if (!t) return;
    els.pickerTitle.textContent = t.type === "hole"
      ? "为玩家 " + (t.player + 1) + " 选择第 " + (t.slot + 1) + " 张牌"
      : "选择公牌 · " + BOARD_STREETS[t.slot];
  }

  function renderPickerGrid() {
    var t = state.picker;
    if (!t) return;
    var used = usedCardsExcept(t);
    var own = currentSlotCard(t);
    els.pickerGrid.textContent = "";
    for (var rank = 12; rank >= 0; rank--) {
      for (var suit = 0; suit < 4; suit++) {
        var code = Cards.make(rank, suit);
        var label = Cards.label(code);
        var btn = document.createElement("button");
        btn.type = "button";
        btn.className = "picker-card" + (Cards.isRedSuit(suit) ? " red" : "");
        btn.setAttribute("data-code", code);
        btn.setAttribute("aria-label", label);
        btn.textContent = label;
        if (used[code]) {
          btn.disabled = true;
          btn.classList.add("used");
        }
        if (own === code) btn.classList.add("selected");
        els.pickerGrid.appendChild(btn);
      }
    }
  }

  function onPickerGridClick(e) {
    var card = e.target.closest("[data-code]");
    if (!card || card.disabled) return;
    var t = state.picker;
    if (!t) return;
    assignSlot(t, Number(card.getAttribute("data-code")));
    renderAll();               // 手牌槽/公牌槽即时反映新牌
    scheduleRecalc();
    var next = nextEmptySlot(t);
    if (next) showPicker(next);
    else closePicker();
  }

  /* 选完一张后前进到同组下一个空槽；全满则关闭 */
  function nextEmptySlot(t) {
    if (t.type === "hole") {
      var cards = state.players[t.player].cards;
      for (var s = 0; s < 2; s++) {
        if (cards[s] === null) return { type: "hole", player: t.player, slot: s };
      }
      return null;
    }
    for (var i = 0; i < 5; i++) {
      if (state.board[i] === null) return { type: "board", slot: i };
    }
    return null;
  }

  function clearPickedSlot() {
    var t = state.picker;
    if (!t) return;
    assignSlot(t, null);
    renderAll();
    scheduleRecalc();
    closePicker();
  }

  /* ---------- iOS 弹层滚动锁 ---------- */

  var scrollLockY = 0;
  function lockScroll() {
    scrollLockY = global.scrollY || global.pageYOffset || 0;
    document.body.style.position = "fixed";
    document.body.style.top = -scrollLockY + "px";
    document.body.style.left = "0";
    document.body.style.right = "0";
    document.body.style.width = "100%";
  }
  function unlockScroll() {
    document.body.style.position = "";
    document.body.style.top = "";
    document.body.style.left = "";
    document.body.style.right = "";
    document.body.style.width = "";
    global.scrollTo(0, scrollLockY);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})(typeof window !== "undefined" ? window : globalThis);
