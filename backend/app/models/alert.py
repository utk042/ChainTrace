"""
ChainTrace Forensics — Alert Pydantic Models
Schema definitions for anomaly alerts and explainability data.
"""

from datetime import datetime
from pydantic import BaseModel, Field
from typing import Optional
from enum import Enum


class RiskTier(str, Enum):
    CRITICAL = "Critical"
    HIGH = "High"
    ELEVATED = "Elevated"


class AlertStatus(str, Enum):
    PENDING = "pending"
    INVESTIGATING = "investigating"
    RESOLVED = "resolved"
    DISMISSED = "dismissed"


class EntityType(str, Enum):
    WALLET = "wallet"
    IP = "ip"
    TRANSACTION = "transaction"


class ShapFeature(BaseModel):
    """Single SHAP feature contribution."""
    feature: str
    value: float
    contribution: float  # positive = pushes towards anomaly


class EvidenceConfidence(str, Enum):
    """How well supported a finding is — not how anomalous it is."""
    HIGH = "HIGH"
    MEDIUM = "MEDIUM"
    LOW = "LOW"


class EvidenceFactor(BaseModel):
    """One thing that was observed, and what it is worth."""
    factor: str
    value: str
    kind: str = Field(description="structural | watchlist | statistical")
    note: str = ""
    weight: Optional[str] = None


class AlertRecord(BaseModel):
    """Alert record as stored in database."""
    alert_id: str
    entity_id: str
    entity_type: EntityType
    risk_tier: RiskTier
    # How far this entity's behaviour sits from the typical one in the
    # dataset. A ranking, never a probability that an offence occurred.
    risk_score: float = Field(ge=0, le=100)
    # Kept as an alias of risk_score so older clients and the bundled
    # snapshot keep working. Do not label it "confidence" in an interface:
    # that is how a distance came to be shown as "95.0% confidence".
    confidence: float = Field(ge=0, le=100, deprecated=True)
    # The separate question: how much independent support the finding has.
    evidence_confidence: Optional[EvidenceConfidence] = None
    evidence_rationale: Optional[str] = None
    evidence_factors: list[EvidenceFactor] = Field(default_factory=list)
    model: str = Field(description="Model that generated this alert")
    description: str
    shap_values: list[ShapFeature] = Field(default_factory=list)
    timestamp: datetime
    status: AlertStatus = AlertStatus.PENDING


class AlertResponse(AlertRecord):
    """Alert record as returned by the API (with extra computed fields)."""
    top_features: list[ShapFeature] = Field(default_factory=list)


class AlertListResponse(BaseModel):
    """Paginated alert list."""
    alerts: list[AlertResponse]
    total: int
    page: int
    page_size: int


class AlertFilters(BaseModel):
    """Query filters for the alerts endpoint."""
    risk_tier: Optional[RiskTier] = None
    entity_type: Optional[EntityType] = None
    model: Optional[str] = None
    min_confidence: float = 0.0
    status: Optional[AlertStatus] = None
    search: Optional[str] = None
    page: int = 1
    page_size: int = 20


class DashboardStats(BaseModel):
    """Aggregated statistics for the dashboard."""
    total_transactions: int = 0
    total_wallets: int = 0
    total_ips: int = 0
    total_alerts: int = 0
    critical_alerts: int = 0
    high_alerts: int = 0
    elevated_alerts: int = 0
    flagged_entities: int = 0
    clusters_detected: int = 0
    last_ingest: Optional[datetime] = None
    model_name: str = "Autoencoder + Node2Vec"
    system_health: str = "Optimal"


class TimelinePoint(BaseModel):
    """Single data point in an activity timeline."""
    timestamp: datetime
    count: int
    anomaly_count: int = 0
