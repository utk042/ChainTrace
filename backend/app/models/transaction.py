"""
ChainTrace Forensics — Transaction Pydantic Models
Schema definitions for ingested Bitcoin transaction records.
"""

from datetime import datetime
from pydantic import BaseModel, Field, field_validator
from typing import Optional


class TransactionRecord(BaseModel):
    """Raw transaction record as ingested from CSV/JSON/XML."""

    txid: str = Field(..., description="Transaction ID (hex hash)")
    timestamp: datetime = Field(..., description="UTC timestamp of observation")
    # Network-layer fields are optional: real on-chain data (e.g. pulled from a
    # block explorer) has no IP/port association — that's peer-to-peer
    # telemetry nobody publishes in bulk. Only synthetic/lab data or a feed
    # merged with real node-level captures will have these populated.
    src_ip: Optional[str] = Field(default=None, description="Source IP address (observer), if known")
    dst_ip: Optional[str] = Field(default=None, description="Destination IP address, if known")
    src_port: Optional[int] = Field(default=None, ge=0, le=65535, description="Source port, if known")
    dst_port: Optional[int] = Field(default=None, ge=0, le=65535, description="Destination port, if known")
    input_addresses: list[str] = Field(default_factory=list, description="Input wallet addresses")
    output_addresses: list[str] = Field(default_factory=list, description="Output wallet addresses")
    input_amounts: list[float] = Field(default_factory=list, description="Input amounts (BTC)")
    output_amounts: list[float] = Field(default_factory=list, description="Output amounts (BTC)")
    fee: float = Field(default=0.0, ge=0, description="Transaction fee (BTC)")
    script_type: str = Field(default="P2PKH", description="Script type (P2PKH, P2SH, P2WPKH, etc.)")

    # Enriched fields (added after ingestion)
    geo_country_src: Optional[str] = Field(default=None, description="Source IP country code")
    geo_country_dst: Optional[str] = Field(default=None, description="Destination IP country code")
    asn_src: Optional[str] = Field(default=None, description="Source IP ASN")
    asn_dst: Optional[str] = Field(default=None, description="Destination IP ASN")

    # Hidden ground-truth label for validation (not exposed in API)
    _label: Optional[str] = None

    @field_validator("txid")
    @classmethod
    def validate_txid(cls, v: str) -> str:
        if len(v) < 8:
            raise ValueError("TXID must be at least 8 characters")
        return v.lower().strip()

    @field_validator("input_addresses", "output_addresses")
    @classmethod
    def validate_addresses(cls, v: list[str]) -> list[str]:
        return [addr.strip() for addr in v if addr.strip()]

    @field_validator("src_ip", "dst_ip", mode="before")
    @classmethod
    def blank_ip_to_none(cls, v):
        if isinstance(v, str) and not v.strip():
            return None
        return v

    @field_validator("src_port", "dst_port", mode="before")
    @classmethod
    def blank_port_to_none(cls, v):
        if v is None or v == "" or (isinstance(v, str) and not v.strip()):
            return None
        return v


class TransactionResponse(BaseModel):
    """Transaction record as returned by the API."""

    txid: str
    timestamp: datetime
    src_ip: Optional[str] = None
    dst_ip: Optional[str] = None
    src_port: Optional[int] = None
    dst_port: Optional[int] = None
    input_addresses: list[str]
    output_addresses: list[str]
    input_amounts: list[float]
    output_amounts: list[float]
    fee: float
    script_type: str
    geo_country_src: Optional[str] = None
    geo_country_dst: Optional[str] = None
    asn_src: Optional[str] = None
    asn_dst: Optional[str] = None
    total_input: float = 0.0
    total_output: float = 0.0


class TransactionListResponse(BaseModel):
    """Paginated transaction list."""

    transactions: list[TransactionResponse]
    total: int
    page: int
    page_size: int


class TransactionDetail(TransactionResponse):
    """Extended transaction detail with analysis data."""

    behavioral_flags: list[str] = Field(default_factory=list)
    heuristic_analysis: Optional[dict] = None
    connected_alerts: list[str] = Field(default_factory=list)
