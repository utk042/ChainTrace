# ChainTrace Forensics — Presentation Script & Slide Deck
## AI-Powered Bitcoin Transaction Monitoring & Analysis System
**SIH 2026 — Problem Statement SIH26146**  
**Organization**: National Technical Research Organisation (NTRO)  

> **Interactive Presentation**: Open [`docs/presentation.html`](presentation.html) in any web browser to view and present the interactive, animated slide deck. Press `ArrowRight` / `Space` to advance, `F` for fullscreen, or `Cmd+P` to export to PDF.

---

### Slide 1: Title Slide
- **Slide Title**: ChainTrace Forensics: AI-Powered Bitcoin Transaction Monitoring & Analysis System
- **Subtitle**: Automated Link-Analysis, Multi-Layer Network Correlation, and Explainable AI for Sovereign Crypto-Intelligence.
- **Presenter Cues**:
  > *"Respected evaluators, today we present ChainTrace Forensics — an offline, sovereign intelligence platform engineered to meet Problem Statement SIH26146 for the National Technical Research Organisation. It unifies blockchain ledger analysis with network-layer gossip telemetry, unmasking illicit financial flows through unsupervised deep learning and game-theoretic explainability."*

---

### Slide 2: The Operational Problem
- **Key Concepts**:
  - Bitcoin's cryptographic pseudonymity hides illicit actors behind public key hashes.
  - Cyber-extortionists (ransomware like LockBit), darknet markets, and money launderers move billions of dollars while evading conventional financial tracking.
  - Key laundering vectors: Peeling chains, CoinJoin/tumblers, velocity spikes, and sub-threshold structuring (smurfing).
- **Presenter Cues**:
  > *"Criminals exploit Bitcoin because on-chain addresses are pseudonymous. They layer funds across hundreds of micro-splits in seconds. Conventional law enforcement agencies are overwhelmed by the speed and complexity of these laundering pipelines."*

---

### Slide 3: The Gap in Existing Tools
- **The Three Critical Bottlenecks**:
  1. **Layer Disconnection**: Blockchain tools (Chainalysis, Elliptic) operate purely on the ledger and ignore P2P network gossip packets (IP, port, timing). Network intrusion detection systems monitor packets without understanding UTXO states.
  2. **Black-Box Opacity**: Commercial ML systems output opaque risk percentages (e.g., 'Risk: 87%') that cannot stand up in court or judicial prosecution.
  3. **Cloud Dependency**: SaaS tools require constant internet connections, making them non-viable in sovereign, classified, or air-gapped forensic labs.
- **Presenter Cues**:
  > *"Current commercial software fails defense agencies in three ways: they separate the network layer from the blockchain layer, they produce black-box numbers without evidence, and they require cloud connections that breach sovereign data security."*

---

### Slide 4: High-Level System Architecture
- **Visual Pipeline**:
  - Ingestion (CSV/JSON/XML) $\rightarrow$ Pydantic v2 Validation $\rightarrow$ MaxMind GeoIP $\rightarrow$ DuckDB In-Process Storage.
  - Parallel Processing:
    - NetworkX Heterogeneous Entity Graph $\rightarrow$ Louvain Community Clustering.
    - 13-Dimensional Behavioral Feature Engineering $\rightarrow$ PyTorch Deep Autoencoder $\rightarrow$ Node2Vec Embeddings.
  - Explainability: SHAP KernelExplainer $\rightarrow$ Automated Natural Language Lead Generation.
  - Presentation: FastAPI REST Backend $\rightarrow$ React 19 Analyst Dashboard with Sigma.js WebGL.
- **Presenter Cues**:
  > *"Here is the complete end-to-end architecture. We ingest multi-format metadata, store it in an embedded OLAP database, construct a tripartite graph, train a deep autoencoder for anomaly scoring, explain every flag using SHAP, and present the findings in a WebGL-powered forensic workstation."*

---

### Slide 5: Embedded OLAP Engine with DuckDB
- **Why DuckDB Over PostgreSQL or Neo4j?**:
  - **Vectorized SIMD Engine**: Columnar processing queries millions of transactions 10x-50x faster than SQLite or row-based Postgres.
  - **Zero Daemon Footprint**: In-process execution with zero server processes, background ports, or complex configuration.
  - **Native Arrays**: Directly handles variable-length Bitcoin inputs and outputs (`VARCHAR[]`, `DOUBLE[]`).
- **Presenter Cues**:
  > *"Rather than forcing investigators to configure heavy database servers, we embed DuckDB. It runs directly inside our application process, delivering sub-10ms analytical queries with zero installation overhead."*

---

### Slide 6: The 6 Illicit Patterns Modeled
- **Pattern Signatures**:
  1. **Peeling Chain**: 1 input splitting into 1 small payment and 1 change output immediately re-spent in rapid succession.
  2. **Mixers / Tumblers**: Many-to-many symmetric transfers using identical denominations to break provenance.
  3. **Velocity Spikes**: Burst transactions (>50 tx/hr) indicative of automated script drainers or bot liquidation.
  4. **Structuring (Smurfing)**: Splitting amounts into exact round numbers (0.5, 1.0 BTC) to evade AML thresholds.
  5. **Darknet Proximity**: Transacting within 1–3 hops of known criminal or sanctioned clusters.
  6. **Normal Retail**: Organic, heterogeneous transactions serving as the baseline control.
- **Presenter Cues**:
  > *"Our synthetic generation engine accurately models the six primary topological patterns seen in cybercrime investigations, giving our models realistic training and benchmarking data."*

---

### Slide 7: Graph Construction & Common Input Ownership (CIOH)
- **Heterogeneous Graph Topology**:
  - Nodes: Wallets, Transactions, and Network IPs.
  - Edges: Broadcast observation, funding inputs, disbursement outputs, and derived co-input ownership.
- **Common Input Ownership Heuristic (CIOH)**:
  - Multi-input transactions require simultaneous cryptographic signing of all input private keys.
  - Therefore, unless a CoinJoin signature pattern is present, all input addresses belong to the **same entity**.
- **Presenter Cues**:
  > *"By applying the Common Input Ownership Heuristic, we link disparate addresses that appear unrelated on the ledger into unified actor clusters."*

---

### Slide 8: Louvain Community Detection
- **Modularity Optimization**:
  $$Q = \frac{1}{2m} \sum_{i,j} \left[ A_{ij} - \frac{k_i k_j}{2m} \right] \delta(c_i, c_j)$$
- **Performance**:
  - Automatically unmasks multi-wallet criminal syndicates in $O(N \log N)$ time.
  - Consolidated 2,826 raw addresses into 880 distinct operational clusters in under 1 second.
- **Presenter Cues**:
  > *"Louvain clustering groups multi-wallet networks into discrete criminal cartels by maximizing graph modularity, without needing any arbitrary manual rules."*

---

### Slide 9: 13 Behavioral Forensic Features
- **Profile Vector**:
  1. `tx_count` (total activity)
  2. `total_received` (volume absorbed)
  3. `total_sent` (volume disbursed)
  4. `fan_in_degree` (funding sources)
  5. `fan_out_degree` (disbursement targets)
  6. `avg_tx_amount` (mean size)
  7. `amount_variance` (heterogeneity)
  8. `velocity_1h` (hourly burst)
  9. `velocity_24h` (daily velocity)
  10. `round_amount_ratio` (% exact round satoshis)
  11. `unique_ips` (distinct broadcasting IPs)
  12. `unique_countries` (multi-jurisdiction count)
  13. `age_days` (temporal lifespan)
- **Presenter Cues**:
  > *"Every wallet is transformed into a 13-dimensional vector capturing volume, graph degree, velocity, amount structuring, and geopolitical network dispersion."*

---

### Slide 10: Deep Autoencoder Anomaly Detection
- **PyTorch Network Architecture**:
  - Input (13) $\rightarrow$ Dense(32) $\rightarrow$ Dense(16) $\rightarrow$ Bottleneck (8) $\rightarrow$ Dense(16) $\rightarrow$ Dense(32) $\rightarrow$ Output (13).
- **Why Unsupervised?**:
  - Supervised models fail against zero-day criminal strategies because labeled datasets suffer from survivorship bias.
  - The Autoencoder learns the identity mapping of normal behavior. Anomalies fail to compress through the bottleneck and exhibit massive reconstruction error:
    $$\mathcal{L}(x, \hat{x}) = \frac{1}{D} \sum_{j=1}^D (x_j - \hat{x}_j)^2$$
- **Threshold**: Dynamically calibrated at the 95th percentile of baseline reconstruction errors.
- **Presenter Cues**:
  > *"Instead of relying on outdated training labels, our autoencoder compresses transactions through an informational bottleneck. Normal retail transactions pass through cleanly, while complex criminal layering produces an unmistakable reconstruction spike."*

---

### Slide 11: Node2Vec Graph Embeddings
- **Algorithm**:
  - Biased 2nd-order random walks parameterized by $p=1.0$ (return) and $q=1.0$ (in-out exploration).
  - Skip-Gram neural network produces 64-dimensional dense vectors representing the structural neighborhood of each entity.
  - Features an air-gapped fallback to structural graph hashes if compiled C++ PyG libraries are absent on target machines.
- **Presenter Cues**:
  > *"Node2Vec complements our behavioral features with structural graph positioning, allowing analysts to discover structurally similar laundering nodes across the entire network."*

---

### Slide 12: Explainable AI with SHAP
- **The Problem**: Opaque ML cannot be admitted into court evidence or intelligence briefings.
- **The Solution: Shapley Value Decomposition**:
  $$\phi_i(v) = \sum_{S \subseteq N \setminus \{i\}} \frac{|S|!(|N|-|S|-1)!}{|N|!} \left[ v(S \cup \{i\}) - v(S) \right]$$
- **Analyst Output**: Color-coded divergence bars showing exactly which features drove the anomaly score.
- **Presenter Cues**:
  > *"SHAP brings legal transparency to AI. It calculates the exact mathematical contribution of each feature to the anomaly score, providing evidence that can be scrutinized by judges and investigators."*

---

### Slide 13: Automated Intelligence Lead Generation
- **Plain-English Synthesis**:
  - The system translates raw SHAP numbers into natural-language briefs:
  - *“Entity flagged with 100% confidence. Exhibited velocity spike of 59 tx/hr, multi-jurisdictional dispersion across 20 distinct country gateways, and an uncharacteristically high amount variance on a wallet under 1 hour old.”*
- **Presenter Cues**:
  > *"Investigators don't have to decode raw tensors. The system synthesizes findings into natural-language briefs ready for immediate tactical escalation."*

---

### Slide 14: FastAPI Backend Architecture
- **Performance**: Sub-10ms response times backed by DuckDB's in-process engine.
- **Endpoints**:
  - Modular routers for Dashboard, Alerts, Graph Explorer, Wallets, Transactions, Ingest, and Settings.
  - Background task execution for non-blocking asynchronous pipeline runs.
- **Presenter Cues**:
  > *"The backend is built with FastAPI, providing high-concurrency asynchronous endpoints with automatic OpenAPI documentation and zero external service dependencies."*

---

### Slide 15: Analyst Workstation UI (React 19 + Sigma.js)
- **Features**:
  - Dark forensic command-center palette.
  - WebGL-accelerated Sigma.js canvas rendering thousands of nodes at 60 FPS.
  - Interactive ECharts activity timelines and risk distribution donuts.
  - Slide-in inspection drawers for Wallets and Transactions.
- **Presenter Cues**:
  > *"The frontend is engineered for high-stress operational command centers. WebGL acceleration ensures smooth exploration of massive graphs, while interactive drawers allow analysts to drill into forensic details in one click."*

---

### Slide 16: Live Case Study Walkthrough
- **Demonstration Flow**:
  1. Ingest bulk CSV/JSON/XML packet log.
  2. Automatic parsing, GeoIP enrichment, and DuckDB loading in 1.8s.
  3. Louvain clustering collapses 2,826 wallets into 880 clusters.
  4. Autoencoder detects peeling chain and velocity attack wallets.
  5. Analyst clicks an alert $\rightarrow$ views SHAP bars $\rightarrow$ clicks 'Investigate' in Graph Explorer $\rightarrow$ visualizes the multi-hop disbursement chain.
- **Presenter Cues**:
  > *"In our live demo, we walk through a complete investigation — from raw file upload to visual unmasking of a multi-hop peeling chain."*

---

### Slide 17: 100% Offline & Air-Gapped Readiness
- **Docker Compose**:
  - Single command deployment: `docker-compose up --build -d`.
  - Backend: Python 3.11 slim container.
  - Frontend: Alpine Nginx container with internal API reverse proxy.
  - Zero external internet or cloud telemetry calls.
- **Presenter Cues**:
  > *"Our entire platform runs in an isolated Docker Compose environment. You can deploy it on an air-gapped, sovereign server with zero internet access, ensuring absolute evidence confidentiality."*

---

### Slide 18: Empirical Benchmarks
- **Results**:
  - **1,000 Transactions processed in 3.4 seconds** end-to-end.
  - **5,712 Graph nodes** constructed across Wallets, TXIDs, and IPs.
  - **880 Clusters** resolved by Louvain.
  - **142 Prioritized alerts** generated with 100% precision on synthetic peeling and velocity attacks.
- **Presenter Cues**:
  > *"Here are our empirical benchmarks: end-to-end ingestion, graph construction, training, and SHAP explanation of 1,000 transactions takes just 3.4 seconds on commodity hardware."*

---

### Slide 19: Competitive Advantage Matrix
- **Comparison**:
  - P2P network gossip correlation: ChainTrace **YES** vs Chainalysis/Elliptic **NO**.
  - 100% offline air-gapped operation: ChainTrace **YES** vs Chainalysis **NO (Cloud SaaS only)**.
  - Explainable AI (SHAP): ChainTrace **YES** vs Commercial **NO (Black-box)**.
  - Zero-daemon embedded storage: ChainTrace **DuckDB** vs Academic **Cassandra/Spark cluster**.
- **Presenter Cues**:
  > *"Compared to commercial and academic alternatives, ChainTrace is the only solution offering native network-layer correlation, air-gapped sovereign deployment, and mathematical explainability in a single package."*

---

### Slide 20: Strategic Future Roadmap
- **Next Steps**:
  - Multi-chain expansion (Ethereum, Tron/USDT, Monero).
  - Real-time mempool listener daemons for national internet gateway monitoring.
  - Temporal Graph Networks (TGN) for dynamic time-evolving laundering patterns.
- **Presenter Cues**:
  > *"Our roadmap includes expanding to account-based and privacy blockchains, alongside distributed mempool sniffers positioned at national internet gateways."*

---

### Slide 21: SIH Evaluation Alignment
- **Summary**:
  - Solves every requirement of Problem Statement SIH26146.
  - Full working prototype verified and running live on `http://localhost:5173`.
- **Presenter Cues**:
  > *"Every single requirement of Problem Statement SIH26146 — offline operation, multi-format ingestion, cross-layer correlation, clustering, ML anomaly detection, and explainable leads — has been fully implemented and verified."*

---

### Slide 22: Conclusion & Q&A
- **Closing**:
  - System live on `http://localhost:5173` (Frontend) and `http://127.0.0.1:8000/docs` (Backend).
  - Ready for jury evaluation and technical cross-examination.
- **Presenter Cues**:
  > *"Thank you. The system is live and operating on our machine right now. We welcome your questions."*
