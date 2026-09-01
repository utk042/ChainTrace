"""
ChainTrace Forensics — GeoIP Enricher
Enriches transaction records with country/ASN data from IP addresses.
Uses MaxMind GeoLite2 if available, falls back to synthetic mapping.
"""

import hashlib
from pathlib import Path
from typing import Optional
from app.config import settings
from app.models.transaction import TransactionRecord

# Try to import MaxMind reader
try:
    import geoip2.database
    GEOIP_AVAILABLE = True
except ImportError:
    GEOIP_AVAILABLE = False

# Fallback: deterministic IP → country/ASN mapping (for demo without MaxMind)
FALLBACK_COUNTRIES = [
    "US", "GB", "DE", "FR", "NL", "JP", "KR", "AU", "CA", "BR",
    "IN", "RU", "CN", "SE", "CH", "SG", "IE", "FI", "NO", "DK",
]

FALLBACK_ASNS = [
    "AS15169", "AS13335", "AS16509", "AS8075", "AS14618",
    "AS36351", "AS20473", "AS46489", "AS63949", "AS24940",
    "AS396982", "AS3356", "AS7922", "AS4134", "AS4837",
    "AS9009", "AS44477", "AS61317", "AS51167", "AS39572",
]


class GeoIPEnricher:
    """Enriches IP addresses with geographic and ASN data."""

    def __init__(self):
        self._reader = None
        self._cache: dict[str, dict] = {}

        if GEOIP_AVAILABLE and Path(settings.GEOIP_DB_PATH).exists():
            try:
                self._reader = geoip2.database.Reader(settings.GEOIP_DB_PATH)
                print("✓ MaxMind GeoLite2 database loaded")
            except Exception as e:
                print(f"⚠ Could not load GeoLite2: {e}. Using fallback mapping.")
        else:
            print("ℹ MaxMind GeoLite2 not available. Using deterministic fallback mapping.")

    def lookup(self, ip: str) -> dict:
        """Look up geographic info for an IP address."""
        if ip in self._cache:
            return self._cache[ip]

        result = self._fallback_lookup(ip)

        if self._reader:
            try:
                response = self._reader.city(ip)
                result = {
                    "country": response.country.iso_code or "XX",
                    "city": response.city.name or "Unknown",
                    "asn": f"AS{response.traits.autonomous_system_number or 0}",
                    "org": response.traits.autonomous_system_organization or "Unknown",
                    "latitude": response.location.latitude or 0.0,
                    "longitude": response.location.longitude or 0.0,
                }
            except Exception:
                pass  # Fall through to fallback

        self._cache[ip] = result
        return result

    def _fallback_lookup(self, ip: str) -> dict:
        """Deterministic fallback: hash IP to get consistent country/ASN."""
        h = int(hashlib.md5(ip.encode()).hexdigest(), 16)
        country = FALLBACK_COUNTRIES[h % len(FALLBACK_COUNTRIES)]
        asn = FALLBACK_ASNS[(h >> 8) % len(FALLBACK_ASNS)]

        return {
            "country": country,
            "city": "Unknown",
            "asn": asn,
            "org": f"Org-{asn}",
            "latitude": 0.0,
            "longitude": 0.0,
        }

    def enrich_record(self, record: TransactionRecord) -> TransactionRecord:
        """Add GeoIP data to a transaction record (if not already present)."""
        if not record.geo_country_src:
            src_info = self.lookup(record.src_ip)
            record.geo_country_src = src_info["country"]
            record.asn_src = src_info["asn"]

        if not record.geo_country_dst:
            dst_info = self.lookup(record.dst_ip)
            record.geo_country_dst = dst_info["country"]
            record.asn_dst = dst_info["asn"]

        return record

    def enrich_batch(self, records: list[TransactionRecord]) -> list[TransactionRecord]:
        """Enrich a batch of records."""
        return [self.enrich_record(r) for r in records]

    def close(self):
        """Close the MaxMind reader."""
        if self._reader:
            self._reader.close()


# Module-level singleton
_enricher: Optional[GeoIPEnricher] = None


def get_enricher() -> GeoIPEnricher:
    """Get or create the global GeoIP enricher instance."""
    global _enricher
    if _enricher is None:
        _enricher = GeoIPEnricher()
    return _enricher
