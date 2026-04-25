from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime
from decimal import Decimal
from enum import StrEnum
from typing import Any


def parse_decimal(value: Any) -> Decimal:
    if isinstance(value, Decimal):
        return value
    return Decimal(str(value))


def parse_date(value: Any) -> date:
    if isinstance(value, date):
        return value
    if isinstance(value, datetime):
        return value.date()
    return date.fromisoformat(str(value))


def decimal_to_text(value: Decimal) -> str:
    return format(value.quantize(Decimal("0.01")), "f")


class ActionType(StrEnum):
    AUTO_APPLY = "AUTO_APPLY"
    AUTO_APPLY_WITH_ADJUSTMENT = "AUTO_APPLY_WITH_ADJUSTMENT"
    AUTO_APPLY_WITH_PERIOD_ADJUSTMENT = "AUTO_APPLY_WITH_PERIOD_ADJUSTMENT"
    EXCEPTION_CASE = "EXCEPTION_CASE"


@dataclass(slots=True)
class ReceiptCandidate:
    id: str
    customer_id: str
    ar_account_id: str
    currency: str
    amount: Decimal
    transaction_date: date
    posting_period: str
    subsidiary_id: str | None = None
    reference: str | None = None
    memo: str | None = None

    @classmethod
    def from_payload(cls, payload: dict[str, Any]) -> "ReceiptCandidate":
        return cls(
            id=str(payload["id"]),
            customer_id=str(payload["customer_id"]),
            subsidiary_id=_optional_text(payload.get("subsidiary_id")),
            ar_account_id=str(payload["ar_account_id"]),
            currency=str(payload["currency"]).upper(),
            amount=parse_decimal(payload["amount"]),
            transaction_date=parse_date(payload["transaction_date"]),
            posting_period=str(payload["posting_period"]),
            reference=_optional_text(payload.get("reference")),
            memo=_optional_text(payload.get("memo")),
        )


@dataclass(slots=True)
class InvoiceCandidate:
    id: str
    customer_id: str
    ar_account_id: str
    currency: str
    open_amount: Decimal
    transaction_date: date
    posting_period: str
    document_number: str | None = None
    subsidiary_id: str | None = None

    @classmethod
    def from_payload(cls, payload: dict[str, Any]) -> "InvoiceCandidate":
        return cls(
            id=str(payload["id"]),
            document_number=_optional_text(payload.get("document_number")),
            customer_id=str(payload["customer_id"]),
            subsidiary_id=_optional_text(payload.get("subsidiary_id")),
            ar_account_id=str(payload["ar_account_id"]),
            currency=str(payload["currency"]).upper(),
            open_amount=parse_decimal(payload["open_amount"]),
            transaction_date=parse_date(payload["transaction_date"]),
            posting_period=str(payload["posting_period"]),
        )


@dataclass(slots=True)
class RuleConfig:
    amount_tolerance: Decimal = Decimal("0.00")
    percent_tolerance: Decimal = Decimal("0.00")
    exact_match_tolerance: Decimal = Decimal("0.00")
    days_window: int = 90
    require_same_subsidiary: bool = True
    require_same_ar_account: bool = True
    allow_many_to_one: bool = True
    max_invoice_combination_size: int = 3
    allow_cross_period_auto_adjustment: bool = False
    minimum_confidence_gap: int = 15

    @classmethod
    def from_payload(cls, payload: dict[str, Any] | None) -> "RuleConfig":
        if not payload:
            return cls()
        return cls(
            amount_tolerance=parse_decimal(payload.get("amount_tolerance", "0.00")),
            percent_tolerance=parse_decimal(payload.get("percent_tolerance", "0.00")),
            exact_match_tolerance=parse_decimal(payload.get("exact_match_tolerance", "0.00")),
            days_window=int(payload.get("days_window", 90)),
            require_same_subsidiary=bool(payload.get("require_same_subsidiary", True)),
            require_same_ar_account=bool(payload.get("require_same_ar_account", True)),
            allow_many_to_one=bool(payload.get("allow_many_to_one", True)),
            max_invoice_combination_size=int(payload.get("max_invoice_combination_size", 3)),
            allow_cross_period_auto_adjustment=bool(payload.get("allow_cross_period_auto_adjustment", False)),
            minimum_confidence_gap=int(payload.get("minimum_confidence_gap", 15)),
        )

    def allowed_difference(self, target_amount: Decimal) -> Decimal:
        percent_difference = (target_amount * self.percent_tolerance) / Decimal("100")
        return max(self.amount_tolerance, percent_difference)

    def to_dict(self) -> dict[str, Any]:
        return {
            "amount_tolerance": decimal_to_text(self.amount_tolerance),
            "percent_tolerance": decimal_to_text(self.percent_tolerance),
            "exact_match_tolerance": decimal_to_text(self.exact_match_tolerance),
            "days_window": self.days_window,
            "require_same_subsidiary": self.require_same_subsidiary,
            "require_same_ar_account": self.require_same_ar_account,
            "allow_many_to_one": self.allow_many_to_one,
            "max_invoice_combination_size": self.max_invoice_combination_size,
            "allow_cross_period_auto_adjustment": self.allow_cross_period_auto_adjustment,
            "minimum_confidence_gap": self.minimum_confidence_gap,
        }


@dataclass(slots=True)
class MatchProposal:
    receipt_id: str
    invoice_ids: tuple[str, ...]
    action: ActionType
    score: int
    amount_difference: Decimal
    same_period: bool
    day_difference: int
    reference_match: bool
    reasons: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "receipt_id": self.receipt_id,
            "invoice_ids": list(self.invoice_ids),
            "action": self.action.value,
            "score": self.score,
            "amount_difference": decimal_to_text(self.amount_difference),
            "same_period": self.same_period,
            "day_difference": self.day_difference,
            "reference_match": self.reference_match,
            "reasons": list(self.reasons),
        }


@dataclass(slots=True)
class Decision:
    receipt_id: str
    action: ActionType
    matched_invoice_ids: list[str]
    confidence: int
    amount_difference: Decimal
    requires_adjustment: bool
    requires_period_adjustment: bool
    reasons: list[str]
    alternatives: list[dict[str, Any]] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "receipt_id": self.receipt_id,
            "action": self.action.value,
            "matched_invoice_ids": list(self.matched_invoice_ids),
            "confidence": self.confidence,
            "amount_difference": decimal_to_text(self.amount_difference),
            "requires_adjustment": self.requires_adjustment,
            "requires_period_adjustment": self.requires_period_adjustment,
            "reasons": list(self.reasons),
            "alternatives": list(self.alternatives),
        }


@dataclass(slots=True)
class BatchResult:
    decisions: list[Decision]
    rules: RuleConfig

    def to_dict(self) -> dict[str, Any]:
        return {
            "rules": self.rules.to_dict(),
            "decisions": [decision.to_dict() for decision in self.decisions],
        }


def _optional_text(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None
