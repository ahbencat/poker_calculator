# Texas Hold'em Online Equity Calculator

A web-based Texas Hold'em (Texas Hold'em) equity calculator: pick hole cards and community
cards for 2–10 players and get each player's win probability in real time. All computation
runs locally in the browser; the server only serves static files.

> - Implementation details and flowcharts of the core algorithms (mode selection, 7-card
>   evaluator, exact enumeration, Monte Carlo) — see
>   [docs/algorithm.md](docs/algorithm.md) (Chinese)
> - Dependency inventory and toolchain requirements — see
>   [docs/dependencies.md](docs/dependencies.md) (Chinese)

[简体中文](README.md) | English

## Features

- **Add / remove players** (2 min, 10 max); actions that don't change the computation
  inputs — adding or removing non-participating players, picking a new player's first
  card — **do not trigger recalculation** and never interrupt a running computation
- **Calculation gate**: starts once at least 2 players each have both hole cards,
  regardless of table size; only players with complete hole cards participate
- **Exact hole cards**: 52-card picker, used cards are automatically greyed out globally
- **Optional community cards**: works at any street (flop / turn / river);
  undealt cards are auto-completed
- **Exact-first computation strategy** (fully automatic):
  - All participants' hole cards known → **exact enumeration** (including preflop,
    results are exact)
  - Heavy enumerations (preflop) → a 100ms Monte Carlo preview first, then a seamless
    swap to the exact result
  - Unknown hole cards fall back to Monte Carlo (engine capability; not triggered by
    page interaction)
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
js/app.js               UI state machine, sliced scheduling (MessageChannel), recalc suppression, bottom-sheet picker
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
- **Monte Carlo**: partial Fisher–Yates, seedable mulberry32, sample-variance confidence
  interval, 650ms budget / early stop at SE<0.15%
- **Recalc suppression**: keyed on an input signature (participants' hole cards + board);
  signature-preserving actions cost zero recomputation; the last rendered result is
  replayed when player-row DOM is rebuilt
- **Responsive UI**: computation runs in 12ms slices yielded via MessageChannel
  (avoids the setTimeout 4ms clamp); heavy preflop enumerations keep showing the preview
  value until the exact result is ready
- **file:// compatible**: deliberately avoids ES Modules, Workers and any third-party
  dependencies (blocked by same-origin policy over file://)
