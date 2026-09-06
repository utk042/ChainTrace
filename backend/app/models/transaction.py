"""
ChainTrace Forensics — Transaction Pydantic Models
Schema definitions for ingested Bitcoin transaction records.
"""

from datetime import datetime
from pydantic import BaseModel, Field, field_validator, model_validator
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

    # Attribution as supplied with the record.
    #
    # The required input schema carries one country and one ASN per
    # transaction, not a source/destination pair. These are the operator's own
    # values and are never overwritten: they are evidence supplied with the
    # capture, whereas geo_country_src and the rest are inferred from a GeoIP
    # database, and a forensic record has to keep the two apart. Until these
    # existed the two columns were accepted by the parser, ignored by this
    # model, and lost without a word — the ingest reported no errors while
    # dropping them.
    geo_country: Optional[str] = Field(default=None, description="Country supplied with the record")
    asn: Optional[str] = Field(default=None, description="ASN supplied with the record")

    # Resolved per endpoint: the supplied value when there is one, otherwise
    # whatever GeoIP could infer (see ingestion/enricher.py).
    geo_country_src: Optional[str] = Field(default=None, description="Source IP country code")
    geo_country_dst: Optional[str] = Field(default=None, description="Destination IP country code")
    asn_src: Optional[str] = Field(default=None, description="Source IP ASN")
    asn_dst: Optional[str] = Field(default=None, description="Destination IP ASN")

    # Hidden ground-truth label for validation (not exposed in API)
    _label: Optional[str] = None

    @model_validator(mode="after")
    def seed_endpoint_attribution(self):
        """
        A single supplied country/ASN describes the observed source endpoint.

        The record has one of each and two endpoints, so something has to say
        which it belongs to. It is the source: a flow record's attribution
        annotates where the traffic was seen coming from. Only the source is
        filled, and only when it is empty — the destination is left for GeoIP
        to infer rather than assumed to match.
        """
        if self.geo_country and not self.geo_country_src:
            self.geo_country_src = self.geo_country
        if self.asn and not self.asn_src:
            self.asn_src = self.asn
        return self

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
    geo_country: Optional[str] = None
    asn: Optional[str] = None
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
