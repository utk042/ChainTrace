# ChainTrace Forensics — Master Technical Workbook
## AI-Powered Bitcoin Transaction Monitoring & Analysis System
**SIH 2026 Problem Statement**: SIH26146  
**Organization**: National Technical Research Organisation (NTRO)  
**Classification**: Technical Reference Handbook & System Blueprint  

---

## Table of Contents
1. [Executive Overview & Problem Formulation](#1-executive-overview--problem-formulation)
2. [Bitcoin Blockchain & Network Forensics Foundations](#2-bitcoin-blockchain--network-forensics-foundations)
3. [Illicit Transaction Topology & Attack Vectors](#3-illicit-transaction-topology--attack-vectors)
4. [Complete System Architecture](#4-complete-system-architecture)
5. [Data Ingestion & Embedded OLAP Engine](#5-data-ingestion--embedded-olap-engine)
6. [Graph Construction & Entity Clustering](#6-graph-construction--entity-clustering)
7. [Machine Learning & Anomaly Detection Pipeline](#7-machine-learning--anomaly-detection-pipeline)
8. [Explainable AI (XAI) via SHAP](#8-explainable-ai-xai-via-shap)
9. [FastAPI Backend & API Contract](#9-fastapi-backend--api-contract)
10. [Frontend Architecture & Link-Analysis Visualization](#10-frontend-architecture--link-analysis-visualization)
11. [Offline Air-Gapped Deployment Guide](#11-offline-air-gapped-deployment-guide)
12. [SIH Hackathon Defense & Jury Q&A Master Sheet](#12-sih-hackathon-defense--jury-qa-master-sheet)

---

## 1. Executive Overview & Problem Formulation

### 1.1 The Challenge (NTRO SIH26146)
Bitcoin is architected around pseudonymous cryptographic public keys. While blockchain ledger records are immutable and globally public, the physical identity of transaction initiators remains hidden behind cryptographic hashes (`1...`, `3...`, `bc1...`). Illicit actors—including cyber-extortionists, ransomware operators, darknet marketplaces, and money launderers—exploit this pseudonymity through sophisticated layering techniques:
- Breaking transaction trails into microscopic splits (*Peeling Chains*).
- Obfuscating provenance through CoinJoin and centralized mixing pools (*Mixers/Tumblers*).
- Evading regulatory AML reporting through sub-threshold fragmentation (*Structuring/Smurfing*).
- Exploiting rapid multi-hop transfers to outpace manual forensic tracing (*Velocity Spikes*).

### 1.2 The Technological Void
Traditional surveillance systems suffer from three critical bottlenecks:
1. **Layer Disconnection**: Blockchain analytics tools (e.g., Chainalysis, Elliptic) operate purely on the ledger layer, ignoring the peer-to-peer gossip network metadata (IP, port, propagation timing). Conversely, network intrusion detection systems (NIDS) analyze packets without semantic understanding of UTXO ledger state.
2. **Black-Box Opacity**: Many existing ML systems output opaque risk scores (e.g., "Risk: 0.89") without evidentiary explanations admissible in legal prosecutions or intelligence briefings.
3. **Cloud Dependency**: Commercial tools require internet connectivity and SaaS backends, making them unusable in sovereign, classified, or air-gapped forensic environments demanded by defense and intelligence agencies like NTRO.

### 1.3 The ChainTrace Solution
**ChainTrace Forensics** is a sovereign, 100% offline, AI-powered intelligence platform that:
- Ingests bulk multi-format metadata (CSV, JSON, XML) capturing both blockchain transactions and P2P network telemetry.
- Correlates network observations (source/destination IP, port, timestamp) with on-chain UTXO transfers.
- Constructs multi-layered heterogeneous entity graphs and applies Louvain community clustering to unmask multi-wallet actor footprints.
- Extracts 13 forensic behavioral metrics and executes PyTorch unsupervised Autoencoders and Node2Vec embeddings.
- Produces game-theoretic SHAP feature attribution explaining mathematically *why* an entity is flagged.
- Delivers an analyst workstation featuring GPU/WebGL link-analysis graph exploration, automated alert triage, and sub-second querying powered by an embedded DuckDB OLAP engine.

---

## 2. Bitcoin Blockchain & Network Forensics Foundations

### 2.1 The UTXO (Unspent Transaction Output) Model
Unlike Ethereum or traditional banking (which use stateful account balances), Bitcoin operates on an acyclic, directed graph of Unspent Transaction Outputs (UTXO).

```
   [Transaction A]                         [Transaction B]
 ┌─────────────────┐                     ┌─────────────────┐
 │ Inputs:         │                     │ Inputs:         │
 │   - PrevUTXO_0  ├────────────────────►│   - UTXO_B0     ├──► ...
 ├─────────────────┤                     ├─────────────────┤
 │ Outputs:        │                     │ Outputs:        │
 │   - UTXO_B0 (0.8)                     │   - UTXO_C0 (0.1)
 │   - UTXO_B1 (0.2)                     │   - UTXO_C1 (0.7)
 └─────────────────┘                     └─────────────────┘
```

#### Key Ledger Principles:
1. **Atomic Consumption**: A UTXO cannot be partially spent. If an address holds 1.0 BTC and wishes to pay 0.05 BTC, the entire 1.0 BTC output must be consumed as an input, creating:
   - Recipient Output: 0.05 BTC
   - Change Output: 0.949 BTC (returned to the sender)
   - Miner Fee: 0.001 BTC ($\sum Inputs - \sum Outputs$)
2. **Script Types & Signature Standards**:
   - `P2PKH` (Legacy, starts with `1`): Pay-to-PubKey-Hash.
   - `P2SH` (Script Hash, starts with `3`): Pay-to-Script-Hash, commonly used for Multi-Sig.
   - `P2WPKH` (Native SegWit, starts with `bc1q`): Witness public key hash, discounted vByte weight.
   - `P2WSH` (Native SegWit Script): Complex witness scripts.
   - `P2TR` (Taproot, starts with `bc1p`): Schnorr signatures, Merkelized Alternative Script Trees (MAST), offering script privacy.

### 2.2 Network-Layer Propagation (P2P Gossip Telemetry)
When a wallet broadcasts a transaction, it does not write directly to the blockchain. It sends an `inv` (inventory) packet to its immediate peers on the Bitcoin P2P network (default port `8333`).

```
  [Initiating Node] ──(inv)──► [Peer 1 (ASN 15169)] ──► [Peer 3] ──► [Miner]
         │
         └────────────(inv)──► [Peer 2 (ASN 13335)] ──► [Peer 4] ──► [Mempool]
```

#### The Forensics of First-Seen IP:
- **Diffusion & Trickle**: Nodes introduce independent random exponential delays before relaying transactions to peers to prevent trivial IP deanonymization.
- **Network Metadata Correlation**: By capturing the earliest timestamps, source IPs, destination IPs, and ephemeral source ports of the initial propagation wave, our platform correlates physical IP geography and Autonomous System Numbers (ASN) with the initiator address.
- **Cross-Jurisdiction Telemetry**: When a transaction with input address $W_A$ is repeatedly observed originating from an autonomous system associated with a known bulletproof host or VPN gateway while destination nodes reside in adversarial jurisdictions, correlation weight increases.

---

## 3. Illicit Transaction Topology & Attack Vectors

The platform detects six primary transaction patterns through behavioral analysis:

```
1. PEELING CHAIN                   2. MIXER / TUMBLER (CoinJoin)
   [Input 10 BTC]                     [In 1] [In 2] [In 3] [In 4]
        │                                  │      │      │      │
   ┌────┴────────────┐                     └──────┬──────┘      │
   ▼                 ▼                            ▼             │
[Pay 0.5 BTC]  [Change 9.5 BTC]              [Pool / Join]      │
                     │                            │             │
                ┌────┴────────────┐        ┌──────┴──────┐      │
                ▼                 ▼        ▼      ▼      ▼      ▼
          [Pay 0.5 BTC]  [Change 9.0 BTC] [0.1]  [0.1]  [0.1]  [0.1]

3. VELOCITY SPIKE                  4. STRUCTURING (Smurfing)
    TX 1 ──(12 sec)──► TX 2           [Source 10 BTC]
    TX 2 ──(18 sec)──► TX 3            ├──► 0.99 BTC  (Under AML limit)
    TX 3 ──(09 sec)──► TX 4            ├──► 0.99 BTC
    (>50 TX / hour from 1 wallet)      ├──► 0.99 BTC
```

### Detailed Heuristic Signatures

| Pattern | Topology / Structural Traits | Heuristic & Feature Triggers | Forensic Significance |
| :--- | :--- | :--- | :--- |
| **Peeling Chain** | 1 Input $\rightarrow$ 2 Outputs; one output is small (payment), second output is large (change) and immediately spent in a subsequent 1-to-2 transaction. | High `fan_out_degree`, low `amount_variance`, consistent output ratio ($Ratio < 0.1$). | Used to launder large ransomware payouts through automated payment gateways without drawing immediate exchange alerts. |
| **Mixer / Tumbler** | Many inputs from unrelated wallets aggregated into a single transaction; equalized output amounts (e.g., 0.1 BTC, 1.0 BTC); high entropy. | High `fan_in_degree` ($>10$), high `fan_out_degree` ($>10$), `round_amount_ratio` $\rightarrow 1.0$, low amount variance. | Designed to break the link between depositors and withdrawers (e.g., Wasabi CoinJoin, Whirlpool, ChipMixer). |
| **Velocity Spike** | High frequency of transactions originating from an address within a narrow temporal window ($<1\text{ hour}$). | `velocity_1h` $> 50$, low inter-transaction interval, short `age_days`. | Automated script drainers, flash bot liquidation, or panic-movement following wallet compromise. |
| **Structuring (Smurfing)** | Breaking large funds into clean round fractions just below reporting thresholds ($9,999 or exact BTC fractions). | `round_amount_ratio` $> 0.5$, repetitive output amounts with zero satoshi fractions. | Intentional circumvention of Anti-Money Laundering (AML) reporting limits. |
| **Darknet Proximity** | Wallets transacting within 1 to 3 hops of known seized illicit nodes (Silk Road, Hydra, LockBit). | Graph shortest path $\le 3$ hops from illicit seeds, multi-jurisdiction IP spread. | Direct or indirect financial exposure to sanctioned terrorist financing or darknet commerce. |
| **Normal Retail** | Low to moderate velocity, heterogeneous amounts, typical input-to-output ratios, organic time distribution. | Low velocity, moderate variance, baseline fan-in/fan-out. | Benchmark control group preventing false positive analyst fatigue. |

---

## 4. Complete System Architecture

```
                    ┌────────────────────────────────────────────────────────┐
                    │               INGESTION LAYER (Offline)                │
                    │   CSV / JSON / XML Bulk Metadata Parser (Streaming)    │
                    └───────────────────────────┬────────────────────────────┘
                                                │
                                                ▼
                    ┌────────────────────────────────────────────────────────┐
                    │               VALIDATION & ENRICHMENT                  │
                    │   - Pydantic v2 Schema Enforcement                     │
                    │   - MaxMind GeoLite2 City/ASN Resolver (Offline MMDB)  │
                    │   - Deterministic Geo-Fallback Engine                  │
                    └───────────────────────────┬────────────────────────────┘
                                                │
                                                ▼
                    ┌────────────────────────────────────────────────────────┐
                    │              STORAGE LAYER (DuckDB Embedded)           │
                    │   - transactions (Raw Telemetry + Ledger)              │
                    │   - wallet_features (13-D Behavioral Vector)           │
                    │   - alerts (Prioritized Forensic Findings)             │
                    │   - ip_metadata (Geographical & ASN Registry)          │
                    └───────────────┬────────────────────────┬───────────────┘
                                    │                        │
            ┌───────────────────────┘                        └───────────────────────┐
            ▼                                                                        ▼
┌──────────────────────────────────────┐                         ┌──────────────────────────────────────┐
│       GRAPH COMPUTATION ENGINE       │                         │       MACHINE LEARNING PIPELINE      │
│  - NetworkX Heterogeneous Graph      │                         │  - Feature Extraction (13-D Matrix)  │
│  - Multi-Input Co-Spending Heuristic │                         │  - PyTorch Deep Autoencoder          │
│  - Louvain Community Clustering      │                         │  - Node2Vec 64-D Embeddings          │
│  - Subgraph Extraction & Layout      │                         │  - Calibrated Percentile Scoring     │
└──────────────────┬───────────────────┘                         └──────────────────┬───────────────────┘
                   │                                                                │
                   └────────────────────────────┬───────────────────────────────────┘
                                                │
                                                ▼
                    ┌────────────────────────────────────────────────────────┐
                    │            EXPLAINABLE AI (XAI) LAYER                  │
                    │   - SHAP KernelExplainer (Local Feature Attribution)   │
                    │   - Automated Natural Language Lead Generation         │
                    │   - Risk Tier Calibration (Critical / High / Elevated) │
                    └───────────────────────────┬────────────────────────────┘
                                                │
                                                ▼
                    ┌────────────────────────────────────────────────────────┐
                    │               REST API (FastAPI Backend)               │
                    │   Port 8000: /api/{dashboard, alerts, graph, wallets}  │
                    └───────────────────────────┬────────────────────────────┘
                                                │
                                                ▼
                    ┌────────────────────────────────────────────────────────┐
                    │            ANALYST WORKSTATION (React + Vite)          │
                    │   Port 5173 / Port 3000: Dark Forensic Visual Suite    │
                    │   - Sigma.js (WebGL Graph)   - ECharts (Analytics)     │
                    │   - SHAP Attribution Bars    - Dynamic Case Manager    │
                    └────────────────────────────────────────────────────────┘
```

---

## 5. Data Ingestion & Embedded OLAP Engine

### 5.1 Why DuckDB Over PostgreSQL or SQLite?
For an offline forensic application processing 10,000 to 1,000,000 transactions:
1. **Columnar Vectorized Execution**: DuckDB evaluates analytical queries ($\text{AVG}$, $\text{SUM}$, group-bys over millions of rows) using SIMD instructions, achieving $10\times$ to $50\times$ the speed of row-based SQLite or Postgres.
2. **Zero Daemon / Embedded Footprint**: Operates in-process via a single file (`chaintrace.duckdb`). No background database daemon, root privileges, or port conflicts exist.
3. **Native List & Array Types**: Bitcoin transactions have dynamic $N$-inputs and $M$-outputs. DuckDB supports native `VARCHAR[]` and `DOUBLE[]` arrays, allowing direct queries like:
   ```sql
   SELECT txid, unnest(input_addresses) AS input_addr FROM transactions;
   ```

### 5.2 Schema Design
```sql
-- Raw Transactions & Network Telemetry
CREATE TABLE IF NOT EXISTS transactions (
    txid VARCHAR PRIMARY KEY,
    timestamp TIMESTAMP NOT NULL,
    src_ip VARCHAR NOT NULL,
    dst_ip VARCHAR NOT NULL,
    src_port INTEGER,
    dst_port INTEGER,
    input_addresses VARCHAR[],
    output_addresses VARCHAR[],
    input_amounts DOUBLE[],
    output_amounts DOUBLE[],
    fee DOUBLE,
    script_type VARCHAR,
    geo_country_src VARCHAR,
    geo_country_dst VARCHAR,
    asn_src VARCHAR,
    asn_dst VARCHAR,
    label VARCHAR DEFAULT 'unknown'
);

-- Engineered Behavioral Feature Store
CREATE TABLE IF NOT EXISTS wallet_features (
    address VARCHAR PRIMARY KEY,
    tx_count INTEGER,
    total_received DOUBLE,
    total_sent DOUBLE,
    fan_in_degree INTEGER,
    fan_out_degree INTEGER,
    avg_tx_amount DOUBLE,
    amount_variance DOUBLE,
    velocity_1h DOUBLE,
    velocity_24h DOUBLE,
    round_amount_ratio DOUBLE,
    unique_ips INTEGER,
    unique_countries INTEGER,
    first_seen TIMESTAMP,
    last_seen TIMESTAMP,
    age_days DOUBLE,
    cluster_id INTEGER,
    anomaly_score DOUBLE,
    risk_tier VARCHAR DEFAULT 'Normal'
);

-- Prioritized Forensic Alerts
CREATE TABLE IF NOT EXISTS alerts (
    alert_id VARCHAR PRIMARY KEY,
    entity_id VARCHAR NOT NULL,
    entity_type VARCHAR NOT NULL,
    risk_tier VARCHAR NOT NULL,
    confidence DOUBLE NOT NULL,
    model VARCHAR NOT NULL,
    description VARCHAR NOT NULL,
    shap_values JSON,
    timestamp TIMESTAMP NOT NULL,
    status VARCHAR DEFAULT 'pending'
);
```

---

## 6. Graph Construction & Entity Clustering

### 6.1 Heterogeneous Graph Topology
The entity graph $G = (V, E)$ consists of three node partitions and four directed edge types:
- **Node Partitions $V$**:
  - $V_{wallet}$: Bitcoin addresses.
  - $V_{tx}$: Transaction identifiers.
  - $V_{ip}$: Observed network IP addresses.
- **Edge Relations $E$**:
  - $(IP \xrightarrow{\text{observed\_tx}} TX)$: Captures the network peer that announced the transaction.
  - $(Wallet \xrightarrow{\text{wallet\_input}} TX)$: Funds flowing from wallet into a transaction.
  - $(TX \xrightarrow{\text{wallet\_output}} Wallet)$: Funds disbursed to recipient or change addresses.
  - $(Wallet_A \xleftrightarrow{\text{co\_input}} Wallet_B)$: Derived common ownership edge.

### 6.2 Common Input Ownership Heuristic (CIOH)
```
       [Input Address 1] ───┐
       [Input Address 2] ───┼──► [Transaction TX_99]
       [Input Address 3] ───┘
```
**Forensic Theorem**: In standard Bitcoin transactions, all private keys corresponding to all input UTXOs must be signed simultaneously to create a valid transaction. Therefore, unless an explicit CoinJoin script structure is detected, all input addresses ($W_1, W_2, W_3$) are controlled by the **same entity**.
- In [builder.py](../backend/app/graph/builder.py), every pair of inputs $(W_i, W_j)$ for $|Inputs| > 1$ generates a bidirectional `co_input` edge with weight incrementation.

### 6.3 Louvain Community Detection Algorithm
To collapse hundreds of thousands of pseudonymous addresses into discrete criminal syndicates, we apply the Louvain algorithm on the wallet-to-wallet projected subgraph.

The algorithm optimizes **Modularity $Q$**:
$$Q = \frac{1}{2m} \sum_{i,j} \left[ A_{ij} - \frac{k_i k_j}{2m} \right] \delta(c_i, c_j)$$
Where:
- $A_{ij}$ is the edge weight between wallet $i$ and wallet $j$.
- $k_i = \sum_j A_{ij}$ is the sum of weights of edges attached to wallet $i$.
- $m = \frac{1}{2}\sum_{ij} A_{ij}$ is the total graph edge weight.
- $c_i$ is the community assigned to wallet $i$.
- $\delta(u, v)$ is the Kronecker delta ($\delta=1$ if $u=v$, else $0$).

**Two-Phase Iteration**:
1. **Local Modularity Optimization**: Each node is placed in its own community. For each node $i$, the algorithm calculates the modularity gain $\Delta Q$ of moving $i$ into neighbor community $C$:
   $$\Delta Q = \left[ \frac{\Sigma_{in} + 2k_{i,in}}{2m} - \left( \frac{\Sigma_{tot} + k_i}{2m} \right)^2 \right] - \left[ \frac{\Sigma_{in}}{2m} - \left( \frac{\Sigma_{tot}}{2m} \right)^2 - \left( \frac{k_i}{2m} \right)^2 \right]$$
2. **Community Aggregation**: Communities are contracted into super-nodes, and edges between communities become weighted super-edges. The process repeats until no further modularity increase is achievable.

---

## 7. Machine Learning & Anomaly Detection Pipeline

```
[Wallet Feature Vector: 13 Dimensions]
                  │
                  ▼
         ┌─────────────────┐
         │     Encoder     │  Linear(13 -> 32) + BatchNorm + ReLU
         └────────┬────────┘
                  ▼
         ┌─────────────────┐
         │     Encoder     │  Linear(32 -> 16) + BatchNorm + ReLU
         └────────┬────────┘
                  ▼
         ┌─────────────────┐
         │     Encoder     │  Linear(16 -> 8) [Latent Bottleneck]
         └────────┬────────┘
                  │
         ┌────────┴────────┐
         │     Decoder     │  Linear(8 -> 16) + BatchNorm + ReLU
         └────────┬────────┘
                  ▼
         ┌─────────────────┐
         │     Decoder     │  Linear(16 -> 32) + BatchNorm + ReLU
         └────────┬────────┘
                  ▼
         ┌─────────────────┐
         │     Decoder     │  Linear(32 -> 13) [Reconstruction Output]
         └────────┬────────┘
                  │
                  ▼
   MSE Loss = || x - x_hat ||^2  ──► If Error > 95th Percentile ──► ANOMALY ALERT
```

### 7.1 The 13 Behavioral Features
In [features.py](../backend/app/ml/features.py), every address is transformed into a standardized 13-dimensional vector:

```python
FEATURE_NAMES = [
    "tx_count",            # 1. Total transaction frequency
    "total_received",      # 2. Cumulative BTC volume absorbed
    "total_sent",          # 3. Cumulative BTC volume disbursed
    "fan_in_degree",       # 4. Number of unique funding parent addresses
    "fan_out_degree",      # 5. Number of unique recipient addresses
    "avg_tx_amount",       # 6. Mean BTC per transaction
    "amount_variance",     # 7. Variance of transaction sizes
    "velocity_1h",         # 8. Maximum transactions within any 1-hour window
    "velocity_24h",        # 9. Maximum transactions within any 24-hour window
    "round_amount_ratio",  # 10. Fraction of outputs with zero satoshi dust
    "unique_ips",          # 11. Distinct source/dest IPs associated
    "unique_countries",    # 12. Distinct country jurisdictions involved
    "age_days",            # 13. Lifespan between first and last observed tx
]
```

### 7.2 Deep Autoencoder Mathematical Formulation
Traditional supervised models require labelled datasets of criminal wallets. In real-world intelligence, criminals invent novel obfuscation methods daily. Supervised models fail on zero-day patterns.

The **Autoencoder** trains strictly on the baseline distribution of the dataset to learn the identity function $f_{\theta}(x) \approx x$ through an informational bottleneck.

#### Objective Function:
$$\mathcal{L}_{MSE}(x, \hat{x}) = \frac{1}{D} \sum_{j=1}^{D} (x_j - \hat{x}_j)^2$$
Where:
- $x \in \mathbb{R}^{13}$ is the robustly scaled input vector: $x_j = \frac{v_j - \mu_j}{\sigma_j + \epsilon}$.
- $\hat{x} \in \mathbb{R}^{13}$ is the reconstructed vector.
- Because criminal patterns (e.g., massive velocity spikes, multi-jurisdiction IP dispersion, peeling chains) constitute extreme topological outliers, the bottleneck cannot compress them efficiently. Their reconstruction error $\mathcal{L}_{MSE}$ surges exponentially.

#### Threshold Calibration:
The anomaly threshold $\tau$ is dynamically calibrated using the 95th empirical percentile of training reconstruction errors:
$$\tau = \text{Percentile}_{95}(\{\mathcal{L}^{(i)}\}_{i=1}^N)$$
$$\text{Anomaly Score}(x) = \min\left(100.0, \, \frac{\mathcal{L}(x, \hat{x})}{\tau} \times 50.0\right)$$

### 7.3 Node2Vec Graph Embeddings
To complement behavioral features with macro-structural network positioning, we implement Node2Vec random walks:
$$\pi_{vx} = \alpha_{pq}(t, x) \cdot w_{vx}$$
Where bias factor $\alpha_{pq}(t, x)$ between previous node $t$ and candidate node $x$ is governed by:
- Return parameter $p = 1.0$ (controls likelihood of revisiting immediate predecessor).
- In-out parameter $q = 1.0$ (balances breadth-first local exploration vs depth-first outward walk).

The resulting sequences are passed through a Skip-Gram neural network optimizing:
$$\max_f \sum_{u \in V} \log \Pr(N_S(u) \mid f(u))$$
Generating dense 64-dimensional vectors embedding neighborhood topology for clustering and similarity discovery.

---

## 8. Explainable AI (XAI) via SHAP

### 8.1 Why Explainability is Mandatory for NTRO
Under criminal evidence laws, an investigator cannot present a neural network's internal weights to a court magistrate. The court requires concrete reasons: *"Why was Wallet A flagged?"*
- *Illegal Explanation*: "The PyTorch model flagged it with probability 0.94."
- *Admissible Explanation*: "The wallet was flagged because its 1-hour transaction velocity was 59 tx/hr (98th percentile), its funds dispersed across 20 foreign jurisdictions, and it exhibited a zero-satoshi round amount ratio of 85%."

### 8.2 Shapley Values Mathematical Foundation
Derived from cooperative game theory, Shapley values distribute the total payout (reconstruction error) among players (the 13 features) according to their marginal contributions across all possible feature subsets:

$$\phi_i(v) = \sum_{S \subseteq N \setminus \{i\}} \frac{|S|! \, (|N| - |S| - 1)!}{|N|!} \left[ v(S \cup \{i\}) - v(S) \right]$$
Where:
- $N$ is the set of all 13 features.
- $S$ is a subset of features excluding feature $i$.
- $v(S)$ is the model's expected reconstruction error when only features in $S$ are known.
- $\phi_i(v)$ represents the exact positive or negative contribution of feature $i$ toward pushing the reconstruction error over threshold $\tau$.

### 8.3 Automated Investigative Lead Generation
In [explainer.py](../backend/app/ml/explainer.py), the platform takes the top positive SHAP attributions and generates natural language intelligence briefs:

```python
# Sample Generated Brief:
"Unusual amount variance: 0.0309. Multi-jurisdiction: 20 countries. New wallet (age: 0.0 days)."
```

In the analyst UI, this is displayed as color-coded dynamic divergence bars:
- **Red Bars (+ Contribution)**: Features that actively drove the anomaly score up.
- **Green Bars (- Contribution)**: Features that exhibited normal behavior, reducing suspicion.

---

## 9. FastAPI Backend & API Contract

### Complete Endpoint Registry

| Route | Method | Purpose | Key Parameters / Body | Response Payload |
| :--- | :--- | :--- | :--- | :--- |
| `/api/health` | `GET` | Service liveness probe | None | `{"status": "healthy", "service": "ChainTrace"}` |
| `/api/dashboard/stats` | `GET` | Aggregated dashboard telemetry | None | `DashboardStats` (total txs, wallets, alerts by tier, clusters) |
| `/api/dashboard/timeline`| `GET` | Time-series activity & anomalies| `interval` (hour, day) | Array of `{"timestamp", "count", "anomaly_count"}` |
| `/api/dashboard/risk-distribution` | `GET` | Donut chart risk counts | None | Array of `{"tier": "Critical", "count": 12}` |
| `/api/dashboard/top-alerts` | `GET` | Prioritized lead deck | `limit` (default 5) | Array of top alerts with inline SHAP arrays |
| `/api/alerts` | `GET` | Filterable alert master list | `risk_tier`, `min_confidence`, `search`, `page`, `page_size` | Paginated alert records with total count |
| `/api/alerts/export` | `GET` | Download forensic CSV | None | Streaming `text/csv` attachment file |
| `/api/alerts/{id}/status`| `PUT` | Case management state change | `new_status` (`pending`, `investigating`, `resolved`) | Updated alert record |
| `/api/graph/data` | `GET` | Full Sigma.js link graph | `layout`, `max_nodes`, `node_type` | `{nodes: [...], edges: [...], stats: {...}}` |
| `/api/graph/subgraph/{id}`| `GET` | N-hop entity ego network | `entity_id`, `hops` (default 2) | Filtered local graph centered on entity |
| `/api/graph/search` | `GET` | Auto-complete node search | `q` (search prefix) | Matched entity ID, type, and risk tier |
| `/api/wallets` | `GET` | Searchable wallet registry | `search`, `risk_tier`, `page` | Paginated wallet records with behavioral stats |
| `/api/wallets/{address}` | `GET` | Deep wallet investigation | `address` | Full balance, connected IPs, recent TXs, alerts |
| `/api/transactions` | `GET` | Transaction registry | `search`, `page` | Paginated transactions with I/O amounts |
| `/api/transactions/{txid}`| `GET` | Transaction inspector | `txid` | Asset flow, behavioral flags (peel/round), alerts |
| `/api/ingest/upload` | `POST`| Multipart file upload | `file` (.csv, .json, .xml) | Saved file path and byte count |
| `/api/ingest/run` | `POST`| Trigger asynchronous pipeline | `file_path`, `clear_existing` | `{"run_id", "status": "running"}` |
| `/api/ingest/status` | `GET` | Polling pipeline progress | None | Progress percentage (0-100), current step, summary |
| `/api/ingest/generate-sample` | `POST`| Generate synthetic data | `count` (default 5000) | CSV/JSON paths of generated dataset |
| `/api/settings` | `GET/PUT` | Read/write forensic thresholds | JSON key-value threshold map | Updated threshold state |
| `/api/settings/purge-cache` | `POST`| Clear local models & graph | None | Cache invalidation confirmation |

---

## 10. Frontend Architecture & Link-Analysis Visualization

### 10.1 Technology Choices
- **React 19 + Vite 8**: Ultra-fast hot module replacement, zero-latency build times.
- **Sigma.js v3 + Graphology**: WebGL-accelerated canvas rendering capable of fluidly displaying graphs with tens of thousands of nodes at 60 FPS without DOM overhead.
- **Apache ECharts**: GPU-accelerated canvas charts for time-series activity histograms and risk tier distributions.
- **Pure Modern CSS System ([index.css](../frontend/src/index.css))**: Dark forensic palette inspired by intelligence command centers (`#0A0C10` Void Black, `#141820` Card Black, `#FF4D5A` Critical Red, `#4D9FFF` Electric Blue, JetBrains Mono font).

### 10.2 Page Walkthrough

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ CHAINTRACE FORENSICS                        [Total TX: 5,000] [Alerts: 142] │
├───────────────┬─────────────────────────────────────────────────────────────┤
│ ◈ Dashboard   │ [ Total Transactions ]  [ Unique Wallets ]  [ Active Alerts]│
│ ⚠ Alerts      │        5,000                  2,826              142        │
│ ◎ Graph       ├──────────────────────────────┬──────────────────────────────┤
│ ◆ Wallets     │ Activity Timeline (ECharts)  │ Risk Distribution (Donut)    │
│ ⇄ Transactions│ █ ▄ █ ▄ █ ▄ █ ▄ █ ▄ █        │    Critical / High / Low     │
│ ↓ Ingest      ├──────────────────────────────┴──────────────────────────────┤
│ ⚙ Settings    │ Prioritized Forensic Alerts (with Live SHAP Bars)           │
│               │ ⚠ 1Vel74da...  Confidence: 100% | Multi-Jurisdiction: 20 IP │
│               │   amount_variance  [=========================] +1352.2      │
│               │   unique_countries [==============           ] +731.5       │
└───────────────┴─────────────────────────────────────────────────────────────┘
```

1. **Dashboard**: Immediate tactical situational awareness. Displays key performance indicators, anomalous activity volume over time, risk segmentation, and top prioritized alerts.
2. **Alerts**: Triage master table. Analysts filter by confidence thresholds (0-100%), risk tiers (Critical, High, Elevated), or entity hash. Features single-click CSV intelligence export.
3. **Graph Explorer**: Full WebGL link-analysis. Analysts can click any node (Wallet, IP, Transaction) to display the slide-out inspector, click *"Investigate"* to calculate an on-the-fly 2-hop ego subgraph, or search addresses via the top-left command bar.
4. **Wallets**: Detailed audit registry. Displays calculated BTC balance ($\sum Recv - \sum Sent$), fan-in/fan-out ratios, and automatically links to associated IP addresses and geographical origins.
5. **Transactions**: Visual ledger inspector. Breaks down multi-input and multi-output distributions, highlights satoshi fee rates, and displays automatic heuristic tags (e.g., `⚑ Peel Chain Pattern Detected`).
6. **Ingest**: Operational ingestion bay. Allows drag-and-drop ingestion of bulk CSV/JSON/XML evidence files, real-time pipeline monitoring across all 7 stages, or instant generation of synthetic test corpuses.
7. **Settings**: Dynamic calibration. Analysts adjust mixer confidence thresholds, darknet proximity hop boundaries, velocity sensitivity, and execute cache purges.

---

## 11. Offline Air-Gapped Deployment Guide

The system requires **zero internet access** once containerized.

### 11.1 Directory Structure
```
Prototype/
├── docker-compose.yml           # Unified offline container orchestrator
├── backend/
│   ├── Dockerfile               # Python 3.11 slim runtime
│   ├── requirements.txt         # Pinned offline wheel dependencies
│   ├── app/
│   │   ├── main.py              # FastAPI server
│   │   ├── config.py            # Path & threshold configs
│   │   ├── database.py          # Embedded DuckDB manager
│   │   ├── models/              # Pydantic schemas
│   │   ├── ingestion/           # Parser, validator, enricher, loader
│   │   ├── graph/               # Builder, clustering, serializer
│   │   ├── ml/                  # Features, autoencoder, embeddings, explainer
│   │   └── routers/             # API endpoints
│   ├── data/
│   │   ├── chaintrace.duckdb    # Embedded database file
│   │   ├── GeoLite2-City.mmdb   # MaxMind offline geolocation database
│   │   └── models/              # Serialized PyTorch weights & scalers
│   └── scripts/
│       └── generate_synthetic.py# Forensic data generator
└── frontend/
    ├── Dockerfile               # Multi-stage Node.js build -> Nginx Alpine
    ├── nginx.conf               # SPA routing & API reverse proxy
    ├── package.json             # NPM dependencies
    └── src/
        ├── index.css            # Dark forensic design tokens
        ├── App.jsx              # Main router
        ├── pages/               # 7 forensic views
        └── services/api.js      # REST client
```

### 11.2 Single-Command Deployment
```bash
# Clone or transfer repository to offline machine
cd Prototype

# Launch both frontend and backend in isolated network bridge
docker-compose up --build -d
```
- The backend initializes DuckDB at `/app/data/chaintrace.duckdb`.
- The frontend is served via Nginx on port `3000`.
- All requests to `http://localhost:3000/api/*` are reverse-proxied internally to `http://backend:8000/*`.

---

## 12. SIH Hackathon Defense & Jury Q&A Master Sheet

### 12.1 The 5-Minute Pitch Structure
1. **Minute 1: The Problem & The Gap**: Introduce Bitcoin's pseudonymity problem. Explain why existing tools fail because they separate blockchain UTXO data from network gossip layer IP telemetry.
2. **Minute 2: The Core Innovation**: Present the heterogeneous graph correlating IP, transaction, and wallet nodes, combined with the Louvain clustering algorithm unmasking multi-wallet syndicates.
3. **Minute 3: The AI / ML Engine**: Explain why supervised models fail on novel criminal behavior and how our unsupervised PyTorch Autoencoder detects zero-day anomalies via reconstruction error bottlenecks.
4. **Minute 4: The Legal Standard (SHAP)**: Showcase the SHAP feature attribution bars. Emphasize that every alert is backed by mathematical evidentiary explanations ready for legal prosecution.
5. **Minute 5: Live UI Demonstration**: Demonstrate the WebGL Sigma.js graph explorer, zoom into a peeling chain, click an alert, inspect its SHAP bars, and show the sub-second response time of embedded DuckDB.

---

### 12.2 Critical Technical Questions & Winning Answers

#### Q1: "Criminals use VPNs and Tor. How does network IP correlation help if the IP is masked?"
> **Answer**:  
> *"That is precisely why ChainTrace Forensics correlates network metadata with blockchain-layer topology rather than relying on IP alone. When a criminal routes transactions through Tor or VPN exit nodes, our enricher detects the hosting ASN (e.g., known data center or proxy service). Furthermore, while the IP identifies the broadcast gateway, the multi-input ownership heuristic and behavioral features track the movement of funds regardless of IP. Most importantly, criminals often make operational security mistakes—such as depositing from a residential IP while withdrawing through a proxy. Our heterogeneous graph captures both observations and clusters the underlying wallet entity across multiple transactions."*

#### Q2: "Why did you choose an unsupervised Autoencoder instead of a supervised classifier like Random Forest or XGBoost?"
> **Answer**:  
> *"Supervised learning requires ground-truth labels of criminal transactions. In financial cyber-intelligence, labeled datasets suffer from extreme survivorship bias: you only have labels for criminals who were caught. Furthermore, cybercriminals constantly invent new laundering topologies. A supervised classifier trained on historical patterns fails against novel zero-day layering schemes. Our Autoencoder learns the manifold of normal transaction behavior; any topological deviation—whether a high-velocity automated drain, an artificial peeling split, or multi-jurisdictional smurfing—produces a large reconstruction loss, guaranteeing detection of previously unseen attack vectors."*

#### Q3: "Why did you use DuckDB instead of a graph database like Neo4j?"
> **Answer**:  
> *"Neo4j requires a heavy Java Virtual Machine (JVM) daemon, consumes significant RAM, and introduces network socket overhead for analytical queries. NTRO's problem statement explicitly calls for an efficient, lightweight offline solution. DuckDB is an embedded columnar OLAP engine that runs in-process with zero configuration, executing SIMD-vectorized SQL queries on millions of rows in milliseconds. For graph algorithms (Louvain clustering, N-hop shortest paths, Node2Vec), we load the graph into NetworkX in memory, while DuckDB stores and filters the underlying tabular attributes. This hybrid architecture delivers higher throughput with a fraction of the memory footprint."*

#### Q4: "How do you guarantee that SHAP explanations are accurate and not hallucinated?"
> **Answer**:  
> *"SHAP (SHapley Additive exPlanations) is not an LLM and does not generate synthetic text. It is rooted in cooperative game theory (Lloyd Shapley, Nobel Prize 1953). It mathematically computes the exact marginal contribution $\phi_i$ of each behavioral feature toward the neural network's reconstruction error across all possible feature coalitions. Because Shapley values satisfy the four fundamental axioms of Efficiency, Symmetry, Dummy Player, and Additivity, the explanation is a mathematically rigorous attribution of the model's decision, making it reliable for forensic documentation."*

#### Q5: "How does your system scale if we ingest 10 million transactions?"
> **Answer**:  
> *"Our architecture scales along three distinct dimensions:
> 1. **Ingestion**: Our multi-format parser uses streaming generators (`yield`), processing bulk CSV/JSON/XML records in memory-bounded batches without loading the entire file into RAM.
> 2. **Storage**: DuckDB uses columnar storage with automatic zone-map indexing and dictionary compression, comfortably managing multi-gigabyte ledgers on standard laptop NVMe drives.
> 3. **Graph & ML**: For massive enterprise-scale graphs exceeding RAM limits, the PyTorch Geometric (PyG) and Node2Vec modules support mini-batch neighbor sampling (`NeighborLoader`), enabling scalable representation learning over arbitrarily large subgraphs."*

---

*Authored for SIH 2026 — Smart India Hackathon Prototype Submission*  
*National Technical Research Organisation (NTRO) — Problem SIH26146*
