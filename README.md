# Texas Hold'em Online Equity Calculator

English | [简体中文](README.zh.md)

## 🚀 [Try the Live Demo →](https://ahbencat.github.io/poker_calculator/)

**Poker odds / win-rate calculator for Texas Hold'em (NLHE)** — pick hole cards and
community cards for 2–10 players and get each player's win / tie / lose probabilities
in real time. Win probabilities come from **exact enumeration** (preflop included,
no sampling error); the Monte Carlo search is implemented in the engine but
deactivated on this page. Everything runs 100% in the browser as
**vanilla JavaScript** — zero dependencies, no build step, works offline
(double-click `index.html`). The UI supports both English and Chinese
(toggle in the top bar).

> - Implementation details and flowcharts of the core algorithms (mode selection, 7-card
>   evaluator, exact enumeration, Monte Carlo) — see
>   [docs/algorithm.md](docs/algorithm.md) (Chinese)
> - Dependency inventory and toolchain requirements — see
>   [docs/dependencies.md](docs/dependencies.md) (Chinese)

## Features

- **Add / remove players** (2 min, 10 max); actions that don't change the computation
  inputs — adding or removing non-participating players, picking a new player's first
  card — **do not trigger recalculation** and never interrupt a running computation
- **Calculation gate**: starts once at least 2 players each have both hole cards,
  regardless of table size; only players with complete hole cards participate
- **Exact hole cards**: 52-card picker, used cards are automatically greyed out globally
- **Optional community cards**: works at any street (flop / turn / river);
  undealt cards are auto-completed
- **Exact-only computation on the page** (fully automatic):
  - All participants' hole cards known → **exact enumeration** (including preflop,
    results are exact)
  - Heavy enumerations (preflop) → a 100ms Monte Carlo preview first, then a seamless
    swap to the exact result
  - **Monte Carlo search: implemented but deactivated** — the engine's MC main path
    and uniform-random branch are kept as tested APIs; page interaction (complete
    hole cards only) always classifies as exact
- **Bilingual UI**: Chinese / English toggle in the top bar; the choice is remembered
- **Poker table UI**: authentic card faces (portrait white cards with rank top-left,
    suit bottom-right), green felt table with wood-rail community card area;
    mobile-portrait first (single column, bottom-sheet card picker, ≥44px touch targets)

## Running

```bash
# Option 1: static hosting (recommended; phones can access via LAN)
python3 server.py            # default 0.0.0.0:8000, prints the LAN address
python3 server.py 9000       # custom port
python3 server.py 8000 127.0.0.1   # localhost only

# Option 2: just double-click index.html (works over file://)
```

No build step, no third-party dependencies (server is Python 3.7+ stdlib).

## Testing & Verification

```bash
node test/run_tests.js         # 28 tests: hand self-checks, exact vectors V1–V6, MC determinism, composite tasks, dead cards
python3 test/oracle.py         # Independent naive Python cross-check (fast: checksum + V1/V2)
python3 test/oracle.py --full  # Adds preflop vectors V3–V6 (~1–3 minutes)
python3 test/server_smoke.py   # server.py smoke test: static assets 200 + dotfiles 404
node test/bench.js             # Performance benchmark (before/after hot-path changes)
```

Key verification values (confirmed by dual JS/Python implementations):

- Score sum of the first 5000 lexicographic 7-card combinations = `37575761920`
- Exact vectors (equity = win + tie split; suits must be pinned — AA vs KK varies
  between 81.26% and 82.64% depending on suit overlap):

| Vector | Input | Result |
|---|---|---|
| V1 river | AsAh vs KdKc, board 2c 7h 9d Js | AA **95.4545%** |
| V2 flop | same, board 2c 7h 9d | AA **91.6162%** |
| V3 preflop | AsAh vs KdKc | AA **81.2555%** |
| V4 preflop | AsAh vs KsKh (full suit overlap) | AA **82.6366%** |
| V5 preflop | AsKs vs QdQc | AKs **46.2145%** |
| V6 3-way | AsAh / KdKc / QsQh | **66.5054% / 18.8755% / 14.6191%** |

## Project Structure

```
index.html              page skeleton (classic <script> tags, file:// compatible)
css/style.css           mobile-first styles (poker-table theme, portrait card faces)
js/cards.js             card encoding (rank<<2|suit), input validation (incl. dead cards)
js/evaluator.js         7-card evaluator (branchless state machine + suit lane counting, ~19.5M evals/s)
js/engine.js            equity engine (createTask entry: mode selection, exact / Monte Carlo / preview)
js/app.js               UI state machine, sliced scheduling (MessageChannel), recalc suppression, bilingual strings
server.py               static hosting (stdlib; dotfiles blocked; open to LAN by default)
docs/                   algorithm docs (with flowcharts) + dependency inventory
test/                   28 Node tests + Python cross-check + server smoke + benchmark
```

## Technical Highlights

- **Evaluator**: 4 branchless "seen exactly k times" rank-mask state machines + 4-byte
  suit lane counting (zero mask building without a flush), 3 small 8192-entry tables
  (straight/popcount/top5); zero allocation per call. Uses the invariant that a flush
  cannot coexist with quads or a full house within 7 cards
- **Exact enumeration**: odometer-style combination enumeration (innermost-digit fast
  path), pausable/resumable; time check every 2048 boards
- **Monte Carlo** (implemented, deactivated as a main mode): partial Fisher–Yates,
  seedable mulberry32, sample-variance confidence interval, 650ms budget / early stop
  at SE<0.15%; retained as a tested engine API and used only for the 100ms preview
- **Recalc suppression**: keyed on an input signature (participants' hole cards + board);
  signature-preserving actions cost zero recomputation; the last rendered result is
  replayed when player-row DOM is rebuilt
- **Responsive UI**: computation runs in 12ms slices yielded via MessageChannel
  (avoids the setTimeout 4ms clamp); heavy preflop enumerations keep showing the preview
  value until the exact result is ready
- **file:// compatible**: deliberately avoids ES Modules, Workers and any third-party
  dependencies (blocked by same-origin policy over file://)

## Monte Carlo: search logic & deactivation

### Search logic (engine `createMcTask`)

When the MC task runs, each iteration is one randomly sampled deal:

1. **RNG** — `mulberry32`, seedable via `opts.seed` (tests pin a seed for
   determinism); the default seed mixes `Date.now()` with `Math.random()`.
2. **Partial Fisher–Yates shuffle** — only the first
   `need = unknown hole cards + unknown board cards` entries of the available deck
   are shuffled (known and dead cards are already excluded), which samples exactly
   the missing cards uniformly from the remaining multiset. Unknown hole slots are
   filled first, then unknown board slots.
3. **Settle the deal** — evaluate all P players' 7 cards, find the best score and
   the number `w` of winners; each winner accumulates `1/w` equity (division via
   lookup table) and bumps the `win`/`tie` counters. `eq²` is accumulated alongside
   for the sample variance.
4. **Stopping rules** — `maxIters` is checked every iteration; the rest are checked
   every 1024 iterations:
   - hard floor `minIters` = 10,000;
   - hard cap `maxIters` = 400,000;
   - time budget `budgetMs` = 650ms;
   - precision: max standard error across players < 0.15%
     (SE computed from the sample variance of `eq`).
5. **Result** — per-player `equity / win / tie / se`; the badge reads
   `Monte Carlo · N sims · ±X%`.

Two special cases:

- **Fully random table** (no hole cards specified): players are exchangeable, so
  equity is *exactly* `1/P` — a mathematical fact, not an estimate — reported as
  `uniform: true`; win/tie are averaged across players to reduce noise. The task
  stops right after `minIters`.
- **100ms preview** — the only MC path the page actually runs: a heavy exact
  enumeration (≥ 500K evaluations, e.g. preflop) first runs the same routine with
  `budgetMs: 100, minIters: 5000, maxIters: 60000` (SE target disabled — capped by
  iteration count and time only), then hands over to exact enumeration. The preview stays visible
  (`provisional` flag → "Quick preview") until the exact value replaces it.

### Deactivation logic (why the page never runs MC as its main mode)

The mode decision in `Engine.createTask` / `classify`:

```
mode = unknownHoles === 0 && exactEvals <= 6,000,000 ? "exact" : "mc"
```

The page can only reach the `"mc"` branch if one of two doors opens — both are
closed by design:

1. **Missing hole cards cannot occur**: the UI calculation gate
   (`completeIndexes()` in app.js) only admits players who have already picked
   *both* hole cards, so `unknownHoles` is always 0.
2. **The exact budget cannot be exceeded**: the heaviest page-reachable input is
   4 players preflop — `C(44,5) × 4 = 4,344,032` evaluations, the maximum over all
   2–10 players × all streets — comfortably below the 6,000,000 fuse
   (`EXACT_BUDGET`).

Therefore `classify` returns `"exact"` for every page interaction: the MC **main
path** and the uniform-random branch are unreachable from the UI. Both are kept as
**tested engine APIs** — MC determinism, uniform `1/P`, and the budget/SE stopping
rules are covered by the 28-test suite — so the capability exists for future
scenarios (partial hands, larger budgets) without code changes.

**Why it was turned off**: Monte Carlo needs enormous iteration counts to approach
the precision that exact enumeration delivers outright, so its **compute cost is
too high while the results remain inherently uncertain** (statistical sampling
error that no fixed iteration count can eliminate). Given that the page always
has complete hands and exact enumeration fits the budget with **zero sampling
error**, the MC main mode was disabled — it survives only as the 100ms preview
(plus test coverage). **Roadmap**: the algorithm implementation will be optimized
and Monte Carlo fully re-enabled as a main mode in a future iteration.

**What the preview estimate is conditioned on**: even the provisional numbers are
grounded in the actual table state — the picked hole cards and the community cards
on the table are *fixed* inputs. Each preview iteration keeps them and only samples
the remaining undealt cards from the deck (on the page that means the not-yet-dealt
board slots, since all hole cards are known). So the preview answers exactly the
same conditional question the exact enumeration later settles — "given these hole
cards and this board, who wins?" — only by sampling a subset of runouts instead of
enumerating all of them. It is a fast estimate of the same quantity, not a
different one.

## License

Released under the [MIT License](LICENSE).

---

**Keywords**: Texas Hold'em · NLHE · poker odds calculator · poker equity calculator ·
win rate / win probability · hand ranking · 德州扑克 · 德克萨斯扑克 · 胜率计算器 ·
胜率 概率 计算 · Monte Carlo simulation · exact enumeration · vanilla JavaScript ·
no-build static site · offline web app
