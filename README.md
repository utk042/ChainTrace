# ChainTrace Forensics

**AI-Powered Bitcoin Transaction Monitoring & Analysis System**

> SIH 2026 — Problem Statement SIH26146
> Organization: National Technical Research Organisation (NTRO)

---

## 🔗 Overview

ChainTrace Forensics is a complete offline system that ingests bulk Bitcoin transaction/network metadata (CSV/JSON/XML), correlates network-layer (IP/port/timing) observations with blockchain-layer (wallet/TXID/amount) data, and applies AI/ML to detect anomalies, cluster entities, and generate prioritized, explainable investigative leads.

## 📚 Documentation & Master Presentation

Comprehensive materials for understanding, demonstrating, and defending the project:
- **[Interactive Master Presentation (PPT Deck)](docs/presentation.html)**: 22-slide animated presentation deck viewable in any browser with keyboard navigation (`ArrowRight`/`Space`), fullscreen mode (`F`), and print-to-PDF support (`Cmd+P`). Clone the repo and open the file locally (GitHub doesn't render raw HTML inline).
- **[Presentation Script & Slide Notes](docs/PRESENTATION.md)**: Slide-by-slide speech cues, jury defense strategies, and slide content.
- **[Master Technical Workbook](docs/WORKBOOK.md)**: 40+ page in-depth reference handbook explaining the mathematics (Autoencoder, Louvain, Node2Vec, SHAP), Bitcoin UTXO forensics, system architecture, database schema, and jury Q&A defense.


## 🏗 Architecture

| Layer | Technology | Purpose |
|-------|-----------|---------|
| **Storage** | DuckDB (embedded OLAP) | Analytical queries, no server needed |
| **Validation** | Pydantic v2 | Strict schema validation for ingested data |
| **GeoIP** | MaxMind GeoLite2 | Offline IP → Country/ASN enrichment |
| **Graph** | NetworkX + Louvain | Entity graph construction + common-input-ownership wallet clustering |
| **Pattern Detection** | Custom structural detectors | Peeling-chain, CoinJoin-like mixing, fan-in/fan-out consolidation hubs |
| **Risk Propagation** | BFS + hop-decay | Spreads risk from operator-maintained seed/watchlist wallets |
| **ML** | PyTorch Autoencoder (or a PCA linear autoencoder in light mode) | Unsupervised anomaly detection (reconstruction error) |
| **Embeddings** | Node2Vec (PyG) | 64-dim graph embeddings — refines wallet clusters and powers similar-wallet lookup |
| **Explainability** | SHAP KernelExplainer | Per-feature attribution for each alert |
| **Real Data** | httpx + Blockstream Esplora API | Optional live fetch of real, verifiable on-chain transactions |
| **API** | FastAPI | REST endpoints serving all data |
| **Frontend** | React + Vite | Dark forensic dashboard |
| **Visualization** | Sigma.js + ECharts | Interactive link-analysis graph + charts |
| **Deployment** | Docker Compose | Single-command offline deployment; light profile fits a 512 MB instance |

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

### Does it work offline?

Yes — completely, on localhost with the network unplugged. The frontend makes
no third-party requests at all: IBM Plex is served from `frontend/public/fonts`
rather than Google Fonts, and there are no CDN scripts, analytics or remote
stylesheets anywhere in the build. The backend is DuckDB-embedded with no
external services. GeoIP enrichment uses a local MaxMind database if one is
present and degrades to a deterministic fallback if not.

The only feature that needs a network is **Ingest → Fetch Real Blockchain
Data**, which calls Blockstream's public API by definition. It fails with a
clear message on an air-gapped machine; fetch the data on a connected machine
and upload the file instead.

If you want to show the interface with no backend running at all — a hosted
preview link, a laptop on a plane, a demo before the pipeline has been run —
turn on **Settings → Offline Snapshot Mode**. It serves a stored run of the
full pipeline (4,970 synthetic transactions: real scores, alerts, clusters and
graph structure) from data bundled into the build. It is labelled as a
snapshot throughout, and ingestion and settings writes are refused rather than
faked.

For a copy you can hand to someone as a single attachment:

```bash
cd frontend && npm run build:standalone
# -> dist/chaintrace-standalone.html  (~3.4 MB, one file)
```

Scripts, styles, fonts and the snapshot are all embedded, routing goes through
the hash and snapshot mode is on, so the file opens straight from `file://`
with no server, no install and no network. (The PNG/JSON export buttons need a
real browser context; everything else works.)

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

## 🖥 Dashboard Pages

- **Dashboard** — KPIs, activity timeline, risk distribution, top alerts
- **Alerts** — Filterable alert table with SHAP feature bars and per-detector labels (Peel-Chain, CoinJoin, Mixer-Hub, Risk-Propagation, Autoencoder)
- **Graph Explorer** — Interactive Sigma.js link chart: ranked entity search, node/risk filtering, incremental expansion, shortest-path tracing between two entities, a full entity inspector, client-side force re-layout, PNG/JSON export and keyboard shortcuts (see below)
- **Wallets** — Wallet browser with detail panel: pattern badges (peeling chain / mixer / seed proximity), a risk-score gauge, and a Node2Vec-powered "Similar Wallets" panel
- **Transactions** — Transaction browser with I/O flow
- **Ingest** — File upload, synthetic sample generation, or a live fetch of real Blockstream data, then pipeline execution
- **Settings** — Forensic threshold configuration (all five thresholds are live) + a Seed Watchlist tab for maintaining known-illicit wallets that risk propagation spreads from

### Graph Explorer

| Action | How |
|---|---|
| Find an entity | Type into the search box (`/`). Results are ranked exact → prefix → substring, then by risk and connectivity. |
| Inspect | Click any node. The camera flies to it, its neighbourhood is highlighted and everything else dims; the inspector shows behavioural features, structural findings, alerts and top counterparties. |
| Grow the picture | **Expand** (`E`) merges the node's neighbours into the canvas you already have, rather than replacing it. |
| Trace a connection | **Trace** on any node, then paste a second identifier: the shortest path between the two is computed and highlighted hop by hop. |
| Focus the view | **Fit** (`F`) frames the whole graph; **Centre** (`C`) re-centres the selection; **Reset** (`R`) restores the original graph, clears filters and selection, and re-frames. |
| Reduce clutter | **Filters** toggles node types and sets a minimum anomaly score. Applied instantly client-side — no refetch. |
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
    ├── public/fonts/         # Self-hosted IBM Plex — no Google Fonts request
    └── src/
        ├── pages/            # 7 pages
        ├── components/
        │   ├── Graph/        # Sigma canvas + node inspector
        │   └── Layout/       # Sidebar, top bar, status bar, connection banner
        ├── demo/             # Bundled pipeline snapshot for offline mode
        └── services/         # API client + offline snapshot adapter
```

## 📝 License

Built for Smart India Hackathon 2026.
