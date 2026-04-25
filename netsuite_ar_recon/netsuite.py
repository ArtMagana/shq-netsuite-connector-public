from __future__ import annotations

from base64 import b64encode
from dataclasses import dataclass
from datetime import UTC, datetime
from hashlib import sha256
from hmac import new as hmac_new
import json
from random import choice
from string import ascii_letters, digits
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlencode, urljoin
from urllib.request import Request, urlopen

from .config import NetSuiteCredentials


def _rfc3986_encode(value: str) -> str:
    return quote(value, safe="~")


def _oauth_nonce(length: int = 24) -> str:
    charset = ascii_letters + digits
    return "".join(choice(charset) for _ in range(length))


@dataclass(slots=True)
class NetSuiteClient:
    credentials: NetSuiteCredentials
    timeout_seconds: int = 30

    def ping(self, record_type: str = "contact") -> dict[str, Any]:
        return self.request_json(
            method="GET",
            path="/services/rest/record/v1/metadata-catalog",
            query={"select": record_type},
        )

    def suiteql(self, query: str, limit: int = 5, offset: int = 0) -> dict[str, Any]:
        return self.request_json(
            method="POST",
            path="/services/rest/query/v1/suiteql",
            query={"limit": limit, "offset": offset},
            body={"q": query},
            headers={"Prefer": "transient"},
        )

    def request_json(
        self,
        method: str,
        path: str,
        query: dict[str, Any] | None = None,
        body: dict[str, Any] | None = None,
        headers: dict[str, str] | None = None,
    ) -> dict[str, Any]:
        request_url = self._build_url(path, query)
        request_headers = {
            "Authorization": self._authorization_header(method, request_url),
            "Accept": "application/json",
        }
        if headers:
            request_headers.update(headers)

        payload: bytes | None = None
        if body is not None:
            payload = json.dumps(body).encode("utf-8")
            request_headers["Content-Type"] = "application/json"

        request = Request(
            url=request_url,
            data=payload,
            headers=request_headers,
            method=method.upper(),
        )

        try:
            with urlopen(request, timeout=self.timeout_seconds) as response:
                raw_body = response.read().decode("utf-8")
                return {
                    "status_code": response.status,
                    "url": request_url,
                    "headers": dict(response.headers.items()),
                    "json": json.loads(raw_body) if raw_body else {},
                }
        except HTTPError as error:
            body_text = error.read().decode("utf-8", errors="replace")
            raise RuntimeError(
                f"NetSuite HTTP {error.code} on {request_url}: {body_text}"
            ) from error
        except URLError as error:
            raise RuntimeError(f"NetSuite network error on {request_url}: {error.reason}") from error

    def _build_url(self, path: str, query: dict[str, Any] | None) -> str:
        base = self.credentials.base_url.rstrip("/")
        target = urljoin(f"{base}/", path.lstrip("/"))
        if not query:
            return target
        normalized = urlencode({key: str(value) for key, value in query.items()})
        return f"{target}?{normalized}"

    def _authorization_header(self, method: str, request_url: str) -> str:
        timestamp = str(int(datetime.now(tz=UTC).timestamp()))
        oauth_values = {
            "realm": self.credentials.account_id,
            "oauth_token": self.credentials.token_id,
            "oauth_consumer_key": self.credentials.consumer_key,
            "oauth_nonce": _oauth_nonce(),
            "oauth_timestamp": timestamp,
            "oauth_signature_method": "HMAC-SHA256",
            "oauth_version": "1.0",
        }
        oauth_values["oauth_signature"] = self._signature(method, request_url, oauth_values)
        ordered_keys = (
            "realm",
            "oauth_token",
            "oauth_consumer_key",
            "oauth_nonce",
            "oauth_timestamp",
            "oauth_signature_method",
            "oauth_version",
            "oauth_signature",
        )
        parts = [
            f'{key}="{_rfc3986_encode(oauth_values[key])}"'
            for key in ordered_keys
        ]
        return f"OAuth {', '.join(parts)}"

    def _signature(self, method: str, request_url: str, oauth_values: dict[str, str]) -> str:
        base_url, _, query_string = request_url.partition("?")
        parameter_pairs: list[tuple[str, str]] = []
        if query_string:
            for pair in query_string.split("&"):
                key, _, value = pair.partition("=")
                parameter_pairs.append((key, value))
        for key, value in oauth_values.items():
            if key in {"realm", "oauth_signature"}:
                continue
            parameter_pairs.append((key, value))

        normalized = "&".join(
            f"{_rfc3986_encode(key)}={_rfc3986_encode(value)}"
            for key, value in sorted(parameter_pairs)
        )
        base_string = "&".join(
            [
                method.upper(),
                _rfc3986_encode(base_url),
                _rfc3986_encode(normalized),
            ]
        )
        signing_key = "&".join(
            [
                _rfc3986_encode(self.credentials.consumer_secret),
                _rfc3986_encode(self.credentials.token_secret),
            ]
        )
        digest = hmac_new(signing_key.encode("utf-8"), base_string.encode("utf-8"), sha256).digest()
        return b64encode(digest).decode("ascii")
