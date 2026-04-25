from __future__ import annotations

from datetime import UTC, datetime
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from typing import Any
from urllib.parse import parse_qs, urlparse

from .config import NetSuiteCredentials, ServiceConfig
from .engine import preview_reconciliation
from .models import InvoiceCandidate, ReceiptCandidate, RuleConfig
from .netsuite import NetSuiteClient


def run_server() -> None:
    service_config = ServiceConfig.from_env()
    server = ThreadingHTTPServer((service_config.host, service_config.port), _build_handler())
    print(f"NetSuite AR reconciliation API listening on http://{service_config.host}:{service_config.port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("Shutting down API server.")
    finally:
        server.server_close()


def _build_handler() -> type[BaseHTTPRequestHandler]:
    class Handler(BaseHTTPRequestHandler):
        server_version = "NetSuiteARRecon/0.1"

        def do_GET(self) -> None:  # noqa: N802
            parsed = urlparse(self.path)
            try:
                if parsed.path == "/health":
                    self._send_json(
                        HTTPStatus.OK,
                        {
                            "status": "ok",
                            "service": "netsuite-ar-recon",
                            "timestamp_utc": datetime.now(tz=UTC).isoformat(),
                        },
                    )
                    return

                if parsed.path == "/rules/default":
                    self._send_json(HTTPStatus.OK, {"rules": RuleConfig().to_dict()})
                    return

                if parsed.path == "/netsuite/ping":
                    params = parse_qs(parsed.query)
                    record_type = params.get("recordType", ["contact"])[0]
                    client = NetSuiteClient(NetSuiteCredentials.from_env())
                    result = client.ping(record_type=record_type)
                    self._send_json(HTTPStatus.OK, result)
                    return

                self._send_json(HTTPStatus.NOT_FOUND, {"error": "Route not found"})
            except ValueError as error:
                self._send_json(HTTPStatus.BAD_REQUEST, {"error": str(error)})
            except RuntimeError as error:
                self._send_json(HTTPStatus.BAD_GATEWAY, {"error": str(error)})
            except Exception as error:  # pragma: no cover
                self._send_json(HTTPStatus.INTERNAL_SERVER_ERROR, {"error": str(error)})

        def do_POST(self) -> None:  # noqa: N802
            parsed = urlparse(self.path)
            try:
                payload = self._read_json_body()

                if parsed.path == "/reconcile/preview":
                    rules = RuleConfig.from_payload(payload.get("rules"))
                    receipts = [ReceiptCandidate.from_payload(item) for item in payload.get("receipts", [])]
                    invoices = [InvoiceCandidate.from_payload(item) for item in payload.get("invoices", [])]
                    result = preview_reconciliation(receipts=receipts, invoices=invoices, rules=rules)
                    self._send_json(HTTPStatus.OK, result.to_dict())
                    return

                if parsed.path == "/netsuite/suiteql":
                    client = NetSuiteClient(NetSuiteCredentials.from_env())
                    query = str(payload["query"])
                    limit = int(payload.get("limit", 5))
                    offset = int(payload.get("offset", 0))
                    result = client.suiteql(query=query, limit=limit, offset=offset)
                    self._send_json(HTTPStatus.OK, result)
                    return

                self._send_json(HTTPStatus.NOT_FOUND, {"error": "Route not found"})
            except KeyError as error:
                self._send_json(HTTPStatus.BAD_REQUEST, {"error": f"Missing field: {error.args[0]}"})
            except ValueError as error:
                self._send_json(HTTPStatus.BAD_REQUEST, {"error": str(error)})
            except RuntimeError as error:
                self._send_json(HTTPStatus.BAD_GATEWAY, {"error": str(error)})
            except Exception as error:  # pragma: no cover
                self._send_json(HTTPStatus.INTERNAL_SERVER_ERROR, {"error": str(error)})

        def log_message(self, format: str, *args: Any) -> None:  # noqa: A003
            return

        def _read_json_body(self) -> dict[str, Any]:
            content_length = int(self.headers.get("Content-Length", "0"))
            if content_length <= 0:
                return {}
            raw = self.rfile.read(content_length).decode("utf-8")
            if not raw.strip():
                return {}
            return json.loads(raw)

        def _send_json(self, status: HTTPStatus, payload: dict[str, Any]) -> None:
            body = json.dumps(payload, ensure_ascii=True, indent=2).encode("utf-8")
            self.send_response(status.value)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

    return Handler
