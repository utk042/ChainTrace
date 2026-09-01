"""
ChainTrace Forensics — Graph Pydantic Models
Serialization schemas for entity/transaction graph data sent to the frontend.
"""

from pydantic import BaseModel, Field
from typing import Optional


class GraphNode(BaseModel):
    """Node in the entity graph."""
    id: str
    label: str
    node_type: str  # 'wallet' | 'ip' | 'transaction'
    x: float = 0.0
    y: float = 0.0
    size: float = 5.0
    color: str = "#4D9FFF"
    cluster_id: Optional[int] = None
    risk_tier: Optional[str] = None
    anomaly_score: Optional[float] = None
    metadata: dict = Field(default_factory=dict)


class GraphEdge(BaseModel):
    """Edge in the entity graph."""
    id: str
    source: str
    target: str
    edge_type: str  # 'ip_observed_tx', 'wallet_input', 'wallet_output', 'co_input'
    weight: float = 1.0
    color: str = "#2A2F3A"
    metadata: dict = Field(default_factory=dict)


class GraphData(BaseModel):
    """Complete graph payload for the frontend."""
    nodes: list[GraphNode]
    edges: list[GraphEdge]
    clusters: dict[int, list[str]] = Field(default_factory=dict)
    stats: dict = Field(default_factory=dict)


class SubgraphRequest(BaseModel):
    """Request for a subgraph around a specific entity."""
    entity_id: str
    hops: int = Field(default=2, ge=1, le=5)
    include_types: list[str] = Field(default_factory=lambda: ["wallet", "ip", "transaction"])


class WalletDetail(BaseModel):
    """Detailed wallet information."""
    address: str
    tx_count: int = 0
    total_received: float = 0.0
    total_sent: float = 0.0
    balance: float = 0.0
    fan_in_degree: int = 0
    fan_out_degree: int = 0
    avg_tx_amount: float = 0.0
    amount_variance: float = 0.0
    velocity_1h: float = 0.0
    velocity_24h: float = 0.0
    round_amount_ratio: float = 0.0
    unique_ips: int = 0
    unique_countries: int = 0
    first_seen: Optional[str] = None
    last_seen: Optional[str] = None
    age_days: float = 0.0
    cluster_id: Optional[int] = None
    anomaly_score: float = 0.0
    risk_tier: str = "Normal"
    connected_ips: list[dict] = Field(default_factory=list)
    recent_transactions: list[dict] = Field(default_factory=list)


class WalletListResponse(BaseModel):
    """Paginated wallet list."""
    wallets: list[WalletDetail]
    total: int
    page: int
    page_size: int
