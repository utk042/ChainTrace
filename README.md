# ChainTrace Forensics

**AI-Powered Bitcoin Transaction Monitoring & Analysis System**

> SIH 2026 — Problem Statement SIH26146
> Organization: National Technical Research Organisation (NTRO)

---

## 🔗 Overview

ChainTrace Forensics is a complete offline system that ingests bulk Bitcoin transaction/network metadata (CSV/JSON/XML), correlates network-layer (IP/port/timing) observations with blockchain-layer (wallet/TXID/amount) data, and applies AI/ML to detect anomalies, cluster entities, and generate prioritized, explainable investigative leads.

## 🏗 Architecture

Every choice below is constrained by one requirement: the system has to run
**fully offline on a single machine**, with no database server, no cloud
service and no outbound network call. That rules out most of the obvious
answers (Postgres, Neo4j, a hosted vector store, a CDN) and explains almost
every row in this table.

### Backend

| Layer | Technology | What it does | Why this one |
|---|---|---|---|
| **Language** | Python 3.11 | Whole backend | The graph + ML libraries this problem needs (NetworkX, PyTorch, scikit-learn, SHAP) only coexist comfortably in Python |
| **API** | FastAPI + Uvicorn | REST endpoints for every page | Pydantic-native, so the validation layer and the API schema are the same objects; async support for the long-running pipeline |
| **Storage** | DuckDB | Transactions, wallet features, alerts, settings | Embedded OLAP — no server process to install or run offline, but columnar so the aggregate queries the dashboard needs stay fast. SQLite would be embedded but row-oriented; Postgres would be columnar-ish but needs a server |
| **Validation** | Pydantic v2 | Schema enforcement on every ingested record | Evidence data has to be rejected loudly, not coerced silently. v2's Rust core also makes validating 5k+ records cheap |
| **Parsing** | lxml, csv, json (stdlib) | CSV / JSON / XML ingestion | lxml for XML only; the stdlib covers the rest, so this is one dependency instead of three |
| **GeoIP** | geoip2 + MaxMind GeoLite2 | IP → country / ASN enrichment | The only GeoIP option that works from a local `.mmdb` file with no API call. Degrades to a deterministic fallback when the database isn't present |
| **Graph** | NetworkX | Entity graph (wallet / tx / IP nodes) | Pure-Python, no server, and the algorithms needed here (BFS, shortest path, ego subgraphs, connected components) are all built in. Neo4j would mean running a database |
| **Clustering** | python-louvain | Common-input-ownership wallet clustering | Standard Louvain implementation that operates directly on a NetworkX graph |
| **Pattern detection** | Custom SQL + graph traversal | Peeling chains, CoinJoin-like mixing, consolidation hubs | These are structural definitions, not learned ones — writing them explicitly makes them auditable and gives an investigator a reason, not a score |
| **Risk propagation** | BFS + exponential hop decay | Spreads risk from watchlisted wallets | Deterministic and explainable: "3 hops from a known-illicit address" is defensible in a way a model output is not |
| **Live data** | httpx + Blockstream Esplora | Optional fetch of real on-chain transactions | Free, no API key, and every txid it returns is independently verifiable on any block explorer |

### Analysis backends — two profiles

The same pipeline runs under either profile; only the models swap. Selected
automatically by `CT_LIGHT_MODE` or by whether torch is importable.

| Step | Full profile | Light profile | Why two |
|---|---|---|---|
| **Anomaly detection** | PyTorch autoencoder (16→32→16→8→…) | PCA linear autoencoder (NumPy + scikit-learn) | `import torch` alone reserves ~250 MB. On a 512 MB host the process is OOM-killed before scoring a single wallet. PCA is the same method minus the non-linearity: same reconstruction-error semantics, same percentile threshold, same per-feature error vector |
| **Embeddings** | Node2Vec (PyTorch Geometric) | Structural (degree, neighbour degree, clustering coefficient) | Random-walk training is the pipeline's heaviest step. The fallback is weaker but keeps the similar-wallets lookup working instead of failing the run |
| **Explainability** | SHAP KernelExplainer | Per-feature reconstruction error | KernelExplainer re-evaluates the model over thousands of masked coalitions per wallet — unaffordable in 512 MB. The fallback is coarser attribution over the same quantity |
| **Install size** | ~2.5 GB | ~120 MB | |
| **Peak RSS (5k tx)** | ~1.2 GB | ~450 MB | |

Ingestion, the entity graph, Louvain clustering, all structural detectors,
risk propagation and the entire API surface are **identical** in both — none
of them ever depended on torch. The active profile is reported in the status
bar and in Settings → System, so nobody has to guess which model produced a
score.

### Frontend

| Layer | Technology | What it does | Why this one |
|---|---|---|---|
| **Framework** | React 19 | All seven pages | Team familiarity; the graph explorer's state (selection, filters, path, expansions) is genuinely complex enough to want a component model |
| **Build** | Vite 6 | Dev server, bundling, code-splitting | Fast HMR, and its `manualChunks` / `inlineDynamicImports` control is what makes both the code-split build and the single-file build possible from one config |
| **Routing** | React Router 7 | Client-side routes | `BrowserRouter` normally, `HashRouter` in the standalone build (no server to map paths onto `index.html`) |
| **Graph** | Sigma.js 3 + Graphology | WebGL link-analysis canvas | Canvas/SVG renderers stall in the low thousands of nodes; Sigma is WebGL and handles 1,500+ smoothly. Graphology is its data model and gives the shortest-path and traversal primitives |
| **Layout** | graphology-layout-forceatlas2 | In-browser "Re-layout" | Lets an investigator untangle the current view without a server round-trip |
| **Charts** | ECharts | Timeline and distribution | Canvas-rendered, so it stays smooth with dense time series; lazily loaded so only the Dashboard pays its 1.1 MB |
| **HTTP** | Axios | API client | Its custom-adapter hook is what makes offline snapshot mode a ~200-line file instead of a rewrite of every call site |
| **Fonts** | IBM Plex Sans / Mono, self-hosted | Typography | Self-hosted from `public/fonts` (116 KB). A Google Fonts `@import` blocks first paint on an air-gapped machine and leaks every page load on a connected one |
| **Styling** | Hand-written CSS custom properties | Design system | ~250 tokens in one file. No Tailwind/CSS-in-JS: nothing to configure, nothing extra in the bundle, and the palette can be re-themed by editing one block |
| **Offline** | Hand-written service worker | Precaches the app; caches backend reads | ~300 lines against Workbox's dependency tree, and the caching rules here are unusual enough to want to read: cache-first for the shell, network-first for `/api`, and every cached response stamped with its age so the UI can label it |
| **Icons** | Hand-authored 24×24 SVG set | All UI iconography | No icon font or npm package to fetch; `npm run check:icons` fails the build if a path escapes the viewBox, which is how a mangled glyph shipped looking like a smudge |

### Deployment

| Concern | Technology | Why |
|---|---|---|
| **Offline / on-prem** | Docker Compose | One command, two containers, nginx proxying `/api` — no API URL to configure |
| **Cloud backend** | Docker on Render | `DEPS=light` build arg + `CT_LIGHT_MODE` so it fits a 512 MB free instance |
| **Cloud frontend** | Static build on Vercel | `VITE_API_URL` at build time; the SPA rewrite deliberately excludes `/api` so a missing backend URL fails loudly instead of returning HTML to every API call |
| **Single file** | `npm run build:standalone` | Inlines scripts, styles, fonts and a pipeline snapshot into one HTML file that runs from `file://` with no server, network or backend |
| **Installable app** | Service worker + web manifest | The app installs to the desktop and opens with no network. `sw.js` and `index.html` are served `no-cache` and hashed assets `immutable`, so a deployment reaches everyone on the next load instead of waiting out a cache |

## 🚀 Quick Start

### Development Mode




```bash
# 1. Backend
cd backend
pip install -r requirements.txt   # or requirements-light.txt on a small machine
python scripts/generate_synthetic.py  # Generate 5K test transactions
uvicorn app.main:app --reload --port 8000

# 2. Frontend (in a separate terminal)
cd frontend
npm install
npm run dev
```

Then open http://localhost:5173 and navigate to **Ingest → Generate Sample & Run** to trigger the full pipeline with fabricated demo data, or **Ingest → Fetch Real Blockchain Data & Run** to pull genuine on-chain transactions instead — see below. The first run trains the autoencoder and Node2Vec embeddings from scratch (~1-3 minutes for the default 5K-record demo set); nothing pretrained ships in the repo, since a checkpoint only stays valid for the exact feature schema and dataset it was trained on.

### Using real data instead of the synthetic demo set

`Ingest → Generate Sample & Run` fabricates every field from scratch (random txids, wallets, IPs, timestamps, even pre-labeled "darknet" addresses) purely so the ML pipeline has something to chew on in a demo. For anything beyond a demo, use `Ingest → Fetch Real Blockchain Data & Run` instead: it calls [Blockstream's public Esplora API](https://github.com/Blockstream/esplora) (free, no key) and pulls the most recent confirmed blocks, producing records with **real txids, real wallet addresses, and real amounts** — every txid it returns can be independently checked on any block explorer (blockstream.info, mempool.space, ...). This requires the machine running the backend to have outbound internet access to `blockstream.info`; it will fail cleanly with a clear error if that's unavailable (e.g. inside an air-gapped deployment), in which case fetch the data separately on a connected machine and `Upload File` it instead.

One honest limitation: real on-chain data has no network-layer (source/destination IP or port) component — that P2P relay telemetry isn't public anywhere, for anyone, in bulk (publishing "which IP announced which transaction" is exactly the kind of deanonymization data Bitcoin's network layer is designed not to leak). ChainTrace does not fabricate this to paper over the gap; those fields are simply left blank on real-data records, and GeoIP enrichment, IP graph nodes, and IP-based features degrade gracefully to "unknown" rather than showing invented values. A real investigative deployment would populate that layer by merging in the operator's own node-level capture logs, which is outside what a public blockchain dataset can ever provide.

### Docker Deployment

```bash
docker-compose up --build
```

Access at http://localhost:3000. The Compose frontend proxies `/api` to the
backend container, so no API URL configuration is needed.

### Offline-first

ChainTrace is built to be opened on a machine with no network. There are three
layers to that, and they cover different situations.

**1. The interface installs itself.** A service worker (`frontend/src/sw/`,
emitted to `/sw.js` at build time) precaches the entire app on the first visit
— every route chunk, both chart and graph libraries, the fonts, the icons, the
manifest, and the bundled snapshot. After one connected load, the app opens
cold with the network unplugged. It is also an installable PWA: **Settings →
Offline & Data → Install ChainTrace** puts it in its own window with a desktop
launcher. A new deployment is picked up in the background and offered as a
"Reload now" prompt rather than applied mid-investigation.

**2. Backend results are stored as you read them.** Every `GET` the app makes
is cached, and served back when the backend cannot be reached. Before leaving
a connected network, **Settings → Offline & Data → Save for offline** pulls the
dashboard, graph and the alerts, wallets and transactions *tables* down in one
pass.

Stored responses are keyed by their exact URL, which on its own is too strict
to be useful: opening page 2, sorting a column or ticking a filter is a
different URL, so it missed the cache and the page reported that nothing was
stored — on a device that was holding every row involved. So the tables are
saved whole, and when a read finds no exact match the app re-runs the filter,
sort and pagination locally over the stored rows
(`frontend/src/services/localQuery.js`, shared with snapshot mode so the two
behave identically). When the stored rows cannot cover a view — a table larger
than what was saved — the page says so above the results instead of letting a
short answer read as a complete one.

Stored data is never passed off as live. Each cached response carries the time
it was fetched, and while the app is serving one, the banner reads *"showing
stored results from 20 min ago"*, the header pill reads `OFFLINE · STORED
DATA`, and the status bar reads `DATA STORED · AS OF …`. A forensic tool that
lets an investigator mistake a stale figure for a current one is worse than one
that simply fails, so the provenance is on screen at all times, and writes
(ingestion, settings, pipeline runs) are refused rather than queued.

**3. Snapshot mode needs no backend at all.** For a machine that has never
reached one — a hosted preview link, a demo before the pipeline has been run —
**Settings → Offline & Data → Offline Snapshot Mode** serves a stored run of
the full pipeline (4,970 synthetic transactions: real scores, alerts, clusters
and graph structure) from data bundled into the build itself.

Nothing in the frontend talks to a third party: IBM Plex is served from
`frontend/public/fonts` rather than Google Fonts, and there are no CDN scripts,
analytics or remote stylesheets anywhere in the build. The backend is
DuckDB-embedded with no external services. GeoIP enrichment uses a local
MaxMind database if one is present and degrades to a deterministic fallback
if not.

The only feature that needs a network is **Ingest → Fetch Real Blockchain
Data**, which calls Blockstream's public API by definition. It fails with a
clear message on an air-gapped machine; fetch the data on a connected machine
and upload the file instead.

> Service workers are only allowed on HTTPS or `localhost`. Served over plain
> HTTP from another host, layers 1 and 2 are unavailable — the Settings panel
> says so rather than silently doing nothing — and snapshot mode or the
> single-file build below is the way to work offline.

For a copy you can hand to someone as a single attachment:

```bash
cd frontend && npm run build:standalone
# -> dist/chaintrace-standalone.html  (~3.4 MB, one file)
```

Scripts, styles, fonts and the snapshot are all embedded, routing goes through
the hash and snapshot mode is on, so the file opens straight from `file://`
with no server, no install and no network. It carries no service worker —
`file://` cannot register one, and a single self-contained file has nothing
left to cache. (The PNG/JSON export buttons need a real browser context;
everything else works.)

### Checks

```bash
cd frontend
npm run check:icons     # icon geometry — runs as part of `npm run build`
npm run test:unit       # the local filter/sort/paging rules, no browser needed
npm run build
npm run test:offline    # the offline-first acceptance test, in a real browser
```

`test:unit` checks `services/localQuery.js` against the routers it mirrors:
that the filters mean what the SQL means, and that a view cut locally never
claims to describe more rows than the device is holding.

`test:offline` drives Chromium through the whole promise: it loads the app,
waits for the service worker to take control, stores data through
**Settings → Offline & Data**, **kills the server**, then re-loads all seven
routes and asserts they render from storage, are labelled as stored rather
than live, and go back to live when the server returns. It also pages and
filters the wallets table while offline, which is the case exact-URL cache
keys used to turn into an error page.

The server is killed rather than using Playwright's `context.setOffline()`,
which only cuts the page's own network and not the fetches the service worker
makes on its behalf — with the server still up, an "offline" page keeps
receiving live data and the test passes while proving nothing.

It needs a Chromium for Playwright (`npx playwright install chromium` once),
or `CHROMIUM_EXECUTABLE=/path/to/chrome` if the machine already has one.
Pass `--backend http://127.0.0.1:8000` to run it against a real backend
instead of the bundled snapshot.

### Cloud deployment (Vercel + Render)

Two things have to be right or the frontend comes up with no data:

**1. The frontend needs to know where the backend is.** Vite inlines
`VITE_API_URL` at *build* time, so set it in the Vercel project settings and
redeploy — changing it does not affect an existing deployment. See
`frontend/.env.example`. A build with it unset now says so in a banner instead
of rendering empty pages, and Settings → Backend API Connection can point a
running build at a backend without rebuilding.

**2. The backend needs to fit its instance.** Render's free tier gives 512 MB
of RAM, and the full dependency set cannot run in that — `import torch` alone
reserves ~250 MB and Node2Vec training peaks far past the rest, so the
container is OOM-killed mid-pipeline. `render.yaml` therefore builds with
`DEPS=light` and runs with `CT_LIGHT_MODE=true`:

| | Full profile | Light profile |
|---|---|---|
| Anomaly detection | PyTorch autoencoder (non-linear) | PCA linear autoencoder |
| Embeddings | Node2Vec (PyTorch Geometric) | Structural (degree / clustering) |
| Explainability | SHAP KernelExplainer | Per-feature reconstruction error |
| Installed size | ~2.5 GB | ~120 MB |
| Peak RSS, 5k transactions | ~1.2 GB | ~450 MB |
| Needs | 2 GB+ instance | 512 MB instance |

Ingestion, the entity graph, Louvain clustering, every structural detector
(peel chains, CoinJoin, consolidation hubs), risk propagation and the entire
API surface are identical in both — none of them ever depended on torch. The
active profile is shown in the status bar and in Settings → System, so nobody
has to guess which model produced a score.

Light mode also engages automatically if torch simply isn't installed, so
`pip install -r backend/requirements-light.txt` is a complete, working install
on its own.

**A note on free-tier storage:** Render's free instances have no persistent
disk. The filesystem is reset on every deploy and every wake from sleep, so an
ingested dataset does not survive a cold start — the app detects the empty
database and says so rather than showing blank pages. Attach a disk at
`/app/data` on a paid plan (commented into `render.yaml`) to keep data between
restarts.

## 📊 ML Pipeline

1. **Ingest** CSV/JSON/XML → Pydantic validation → DuckDB
2. **Graph** Build NetworkX entity graph (IP–Wallet–TX edges)
3. **Cluster** Louvain community detection on wallet subgraph (common-input-ownership heuristic)
4. **Detect** Structural pattern detectors (peeling chains, CoinJoin-like mixing, consolidation hubs) + BFS risk propagation from seed/watchlist wallets
5. **Features** 16 behavioral + structural features per wallet (13 behavioral + peel-chain depth + mixer-interaction count + seed-proximity score)
6. **Train** PyTorch Autoencoder (16→32→16→8→16→32→16)
7. **Embed** Node2Vec 64-dim embeddings → refines Louvain clusters by similarity, powers a "similar wallets" lookup
8. **Score** Reconstruction error → anomaly scores
9. **Explain** SHAP KernelExplainer → per-feature attribution
10. **Alert** Union of autoencoder-flagged wallets and every structural-detector hit, each ranked and explained; a textbook peeling chain gets flagged even if its generic behavioral stats don't clear the anomaly percentile

### Detected Patterns

| Pattern | Detection Method | How it's surfaced |
|---------|-----------------|-----------------|
| Peeling Chains | Consecutive peel-shaped transactions (large "change" output forwarded onward, small amount split off), chained forward through time to a real hop depth | Dedicated alert category, per-wallet chain depth |
| CoinJoin-like Mixing | Single transaction with several equal-value outputs from multiple distinct inputs, gated by the Mixer Confidence threshold | Dedicated alert category |
| Consolidation/Mixing Hubs | Wallet with high fan-in *and* fan-out that passes received value through rather than accumulating it — the on-chain shape of a hosted mixing service | Dedicated alert category |
| Risk (Seed) Propagation | BFS hop-distance with exponential decay from operator-maintained seed/watchlist wallets (Settings → Seed Watchlist), bounded by the Darknet Proximity Hops setting | Dedicated alert category, per-wallet hop count |
| Velocity Spikes | TX/hour exceeding the Velocity Spike Threshold setting | SHAP-surfaced explanation on autoencoder alerts |
| Round-Amount Structuring | Round-number output ratio exceeding the Round-Amount Threshold setting | SHAP-surfaced explanation on autoencoder alerts |

All five forensic thresholds on the Settings page (Mixer Confidence, Darknet Proximity Hops, Velocity Spike Threshold, Round-Amount Threshold, Anomaly Percentile) are read live by the detectors above — editing one and re-running the pipeline changes real detection behavior, not just a stored value.

## 🖥 The workstation

The interface is laid out as an analyst workstation rather than a web
dashboard: a fixed title bar carrying global search and one tab per open
view, an application menu bar whose items are enabled only where the current
view implements them, an icon rail down the left edge, and a status bar
along the bottom carrying the connection state, the dataset counters and a
UTC clock. Only the workspace between them ever scrolls.

Most views use the same three-pane arrangement — **filters**, **results**,
**detail** — with the detail pane draggable and its width remembered per
view. Side panels fold into overlays on a narrow window rather than
squeezing the table.

- **Overview** — KPI tiles, activity timeline, wallet-risk make-up, prioritised alerts, and a histogram panel whose rows link through to the filtered view they describe
- **Alerts** — Three-pane triage: server-side filters (tier, disposition, confidence floor, entity type, model), sortable columns, and a detail pane with the model's SHAP explanation and a disposition control that writes straight to the backend
- **Graph Explorer** — Interactive Sigma.js link chart: ranked entity search, node/risk filtering, incremental expansion, shortest-path tracing between two entities, a full entity inspector, client-side force re-layout, PNG/JSON export and keyboard shortcuts (see below)
- **Wallets** — Wallet browser with a tabbed detail pane (Overview / Features / Links / Transactions): pattern badges (peeling chain / mixer / seed proximity), an anomaly-score meter, and a Node2Vec-powered "Similar wallets" list. The address under review lives in the URL, so it survives a reload and can be linked to
- **Transactions** — Ledger browser with a tabbed detail pane (Overview / Inputs / Outputs / Network) and a summary panel over the loaded page
- **Ingest** — File upload, synthetic sample generation, or a live fetch of real Blockstream data, then pipeline execution
- **Settings** — Forensic threshold configuration (all five thresholds are live) behind a pinned action bar, a Seed watchlist section for maintaining known-illicit wallets that risk propagation spreads from, and an **Offline & data** section for installing the app, storing data for offline use and inspecting what is stored

Figures drawn from the page currently loaded — the facet histograms beside a
result list — are labelled *this page*, never presented as a census of the
whole table.

### Graph Explorer

| Action | How |
|---|---|
| Find an entity | Type into the search box (`/`). Results are ranked exact → prefix → substring, then by risk and connectivity. |
| Inspect | Click any node. The camera flies to it, its neighbourhood is highlighted and everything else dims; the inspector shows behavioural features, structural findings, alerts and top counterparties. |
| Grow the picture | **Expand** (`E`) merges the node's neighbours into the canvas you already have, rather than replacing it. |
| Trace a connection | **Trace** on any node, then paste a second identifier: the shortest path between the two is computed and highlighted hop by hop. |
| Focus the view | **Fit** (`F`) frames the whole graph; **Centre** (`C`) re-centres the selection; **Reset** (`R`) restores the original graph, clears filters and selection, and re-frames. |
| Reduce clutter | **Filters** toggles node types and sets a minimum anomaly score. Applied instantly client-side — no refetch. |
| Read the make-up | The **Histogram** panel counts what is actually on the canvas by object type and risk tier; clicking an object-type row toggles it, so the figure beside a type is always the number you are looking at. |

Nodes are drawn as square pictogram tiles with the label centred underneath,
the way the Gotham graph application draws its objects: the tile carries a
glyph for the entity type, so what you are looking at is legible before you
read a single identifier. The tile is filled with the node's risk colour, and
identifiers are middle-elided in the label — a canvas of 60-character
addresses printed in full is unreadable at any zoom.
| Untangle | **Re-layout** (`L`) runs ForceAtlas2 over the current view in the browser. The layout dropdown re-runs a server-side layout instead. |
| Take it with you | Export the view as PNG or JSON. |

Node size means something: it scales with the square root of a node's degree
(so area, not radius, tracks connectivity), saturates at 40 links so one hub
cannot flatten everything else to dots, and grows up to 25% more for a
risk-scored wallet. Wallets get the widest size range, transactions and IPs
stay small so they read as connective tissue.

## 📁 Project Structure

```
Prototype/
├── docker-compose.yml
├── backend/
│   ├── app/
│   │   ├── main.py             # FastAPI entry
│   │   ├── config.py           # Static env-based settings
│   │   ├── runtime_settings.py # Effective settings (env defaults + live Settings-page overrides)
│   │   ├── database.py         # DuckDB manager + schema/migrations
│   │   ├── models/              # Pydantic schemas
│   │   ├── ingestion/            # parser / validator / enricher / loader
│   │   │   └── real_fetcher.py   # Real Bitcoin data via Blockstream's Esplora API
│   │   ├── graph/
│   │   │   ├── builder.py           # Entity graph construction
│   │   │   ├── clustering.py        # Louvain + Node2Vec-based cluster refinement
│   │   │   ├── patterns.py          # Peeling-chain / CoinJoin / consolidation-hub detectors
│   │   │   └── risk_propagation.py  # BFS risk propagation from seed wallets
│   │   ├── ml/
│   │   │   ├── autoencoder.py    # Picks the backend below for this deployment
│   │   │   ├── torch_backend.py  # PyTorch autoencoder (full profile)
│   │   │   ├── light.py          # PCA linear autoencoder (light profile)
│   │   │   ├── embeddings.py     # Node2Vec, with a structural fallback
│   │   │   └── explainer.py      # SHAP, with a reconstruction-error fallback
│   │   └── routers/             # FastAPI endpoints
│   ├── requirements.txt         # Full dependency set
│   ├── requirements-light.txt   # Without torch / PyG / SHAP (~120 MB)
│   └── scripts/
│       └── generate_synthetic.py
└── frontend/
    ├── public/
    │   ├── fonts/            # Self-hosted IBM Plex — no Google Fonts request
    │   ├── icons/            # PWA app icons
    │   └── manifest.webmanifest
    ├── scripts/
    │   ├── build-standalone.mjs  # Folds a build into one self-contained HTML file
    │   └── check-icons.mjs       # Fails the build on icon geometry outside the viewBox
    ├── tests/
    │   └── offline.spec.mjs      # Kills the server, asserts every route still renders
    └── src/
        ├── pages/            # 7 pages
        ├── components/
        │   ├── Graph/        # Sigma canvas + node inspector
        │   ├── Layout/       # Title bar, menu bar, rail, status bar, browser layout
        │   ├── ui/           # Panel, Tabs, Menu, Histogram, Collapse, states
        │   ├── Icon.jsx      # Hand-authored 24x24 icon set
        │   ├── OfflinePanel.jsx  # Install, store-for-offline and cache controls
        │   └── ErrorBoundary.jsx # Keeps one page's crash out of the whole app
        ├── sw/
        │   └── service-worker.js # Precache + API caching; emitted to /sw.js at build
        ├── state/            # Session provider (one health poll) and the view table
        ├── hooks/            # useBackendStatus, useOnline, useDebouncedValue,
        │                     # useResizablePane, useMediaQuery
        ├── demo/             # Bundled pipeline snapshot for snapshot mode
        └── services/
            ├── api.js        # API client + cache-provenance tracking
            ├── commands.js   # Menu-bar command registry (pages register what they can do)
            ├── format.js     # One definition each for identifier, figure and date display
            ├── demoAdapter.js  # Serves the bundled snapshot through axios
            ├── localQuery.js # Filter/sort/page rules mirroring the routers,
            │                 # shared by snapshot mode and the offline path
            ├── offlineFallback.js # Re-cuts a view from stored rows when a
            │                      # read cannot reach the backend
            └── offline.js    # Service-worker lifecycle and cache controls
```

## 📝 License

Built for Smart India Hackathon 2026.
