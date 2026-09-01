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
| **ML** | PyTorch Autoencoder | Unsupervised anomaly detection (reconstruction error) |
| **Embeddings** | Node2Vec (PyG) | 64-dim graph embeddings — refines wallet clusters and powers similar-wallet lookup |
| **Explainability** | SHAP KernelExplainer | Per-feature attribution for each alert |
| **Real Data** | httpx + Blockstream Esplora API | Optional live fetch of real, verifiable on-chain transactions |
| **API** | FastAPI | REST endpoints serving all data |
| **Frontend** | React + Vite | Dark forensic dashboard |
| **Visualization** | Sigma.js + ECharts | Interactive link-analysis graph + charts |
| **Deployment** | Docker Compose | Single-command offline deployment |

## 🚀 Quick Start

### Development Mode

```bash
# 1. Backend
cd backend
pip install -r requirements.txt
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

Access at http://localhost:3000

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
- **Graph Explorer** — Interactive Sigma.js graph with node search
- **Wallets** — Wallet browser with detail panel: pattern badges (peeling chain / mixer / seed proximity), a risk-score gauge, and a Node2Vec-powered "Similar Wallets" panel
- **Transactions** — Transaction browser with I/O flow
- **Ingest** — File upload, synthetic sample generation, or a live fetch of real Blockstream data, then pipeline execution
- **Settings** — Forensic threshold configuration (all five thresholds are live) + a Seed Watchlist tab for maintaining known-illicit wallets that risk propagation spreads from

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
│   │   ├── ml/                  # Autoencoder + Node2Vec + SHAP
│   │   └── routers/             # FastAPI endpoints
│   └── scripts/
│       └── generate_synthetic.py
└── frontend/
    └── src/
        ├── pages/            # 7 pages
        ├── components/       # Reusable UI
        └── services/         # API client
```

## 📝 License

Built for Smart India Hackathon 2026.
