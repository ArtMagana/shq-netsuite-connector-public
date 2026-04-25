from __future__ import annotations

from dataclasses import dataclass
import os


@dataclass(frozen=True, slots=True)
class ServiceConfig:
    host: str = "127.0.0.1"
    port: int = 8080

    @classmethod
    def from_env(cls) -> "ServiceConfig":
        host = os.getenv("RECON_API_HOST", "127.0.0.1")
        port_text = os.getenv("RECON_API_PORT", "8080")
        return cls(host=host, port=int(port_text))


@dataclass(frozen=True, slots=True)
class NetSuiteCredentials:
    account_id: str
    base_url: str
    consumer_key: str
    consumer_secret: str
    token_id: str
    token_secret: str

    @classmethod
    def from_env(cls) -> "NetSuiteCredentials":
        values = {
            "account_id": os.getenv("NETSUITE_ACCOUNT_ID", "").strip(),
            "base_url": os.getenv("NETSUITE_BASE_URL", "").strip(),
            "consumer_key": os.getenv("NETSUITE_CONSUMER_KEY", "").strip(),
            "consumer_secret": os.getenv("NETSUITE_CONSUMER_SECRET", "").strip(),
            "token_id": os.getenv("NETSUITE_TOKEN_ID", "").strip(),
            "token_secret": os.getenv("NETSUITE_TOKEN_SECRET", "").strip(),
        }
        missing = [name for name, value in values.items() if not value]
        if missing:
            joined = ", ".join(sorted(missing))
            raise ValueError(f"Missing NetSuite credentials: {joined}")
        return cls(**values)
