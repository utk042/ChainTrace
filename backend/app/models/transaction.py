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
    src_ip: str = Field(..., description="Source IP address (observer)")
    dst_ip: str = Field(..., description="Destination IP address")
    src_port: int = Field(..., ge=0, le=65535, description="Source port")
    dst_port: int = Field(..., ge=0, le=65535, description="Destination port")
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


class TransactionResponse(BaseModel):
    """Transaction record as returned by the API."""

    txid: str
    timestamp: datetime
    src_ip: str
    dst_ip: str
    src_port: int
    dst_port: int
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
