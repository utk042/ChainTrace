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
| **Graph** | NetworkX + Louvain | Entity graph construction + wallet clustering |
| **ML** | PyTorch Autoencoder | Unsupervised anomaly detection (reconstruction error) |
| **Embeddings** | Node2Vec (PyG) | 64-dim graph embeddings per node |
| **Explainability** | SHAP KernelExplainer | Per-feature attribution for each alert |
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
3. **Cluster** Louvain community detection on wallet subgraph
4. **Features** 13 behavioral features per wallet
5. **Train** PyTorch Autoencoder (13→32→16→8→16→32→13)
6. **Embed** Node2Vec 64-dim embeddings
7. **Score** Reconstruction error → anomaly scores
8. **Explain** SHAP KernelExplainer → per-feature attribution
9. **Alert** Generate ranked, explainable alert list

### Detected Patterns

| Pattern | Detection Method |
|---------|-----------------|
| Peeling Chains | Sequential 1→2 splits, high fan-out |
| Mixer/Tumbler | Fan-in anomaly + temporal clustering |
| Velocity Spikes | TX/hour exceeding threshold |
| Round-Amount Structuring | Round-number output ratio |
| Darknet Proximity | N-hop distance to flagged entities |

## 🖥 Dashboard Pages

- **Dashboard** — KPIs, activity timeline, risk distribution, top alerts
- **Alerts** — Filterable alert table with SHAP feature bars
- **Graph Explorer** — Interactive Sigma.js graph with node search
- **Wallets** — Wallet browser with detail panel
- **Transactions** — Transaction browser with I/O flow
- **Ingest** — File upload + pipeline execution
- **Settings** — Forensic threshold configuration

## 📁 Project Structure

```
Prototype/
├── docker-compose.yml
├── backend/
│   ├── app/
│   │   ├── main.py          # FastAPI entry
│   │   ├── config.py        # Settings
│   │   ├── database.py      # DuckDB manager
│   │   ├── models/          # Pydantic schemas
│   │   ├── ingestion/       # CSV/JSON/XML parser + loader
│   │   ├── graph/           # NetworkX + Louvain
│   │   ├── ml/              # Autoencoder + Node2Vec + SHAP
│   │   └── routers/         # FastAPI endpoints
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
