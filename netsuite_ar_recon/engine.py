from __future__ import annotations

from collections.abc import Iterable
from decimal import Decimal
from itertools import combinations

from .models import (
    ActionType,
    BatchResult,
    Decision,
    InvoiceCandidate,
    MatchProposal,
    ReceiptCandidate,
    RuleConfig,
)


def preview_reconciliation(
    receipts: Iterable[ReceiptCandidate],
    invoices: Iterable[InvoiceCandidate],
    rules: RuleConfig,
) -> BatchResult:
    all_invoices = list(invoices)
    proposals_by_receipt = {
        receipt.id: build_proposals(receipt, all_invoices, rules) for receipt in receipts
    }
    ordering = sorted(
        proposals_by_receipt.items(),
        key=lambda item: _sort_key(item[1]),
        reverse=True,
    )

    used_invoice_ids: set[str] = set()
    decisions: list[Decision] = []

    for receipt_id, proposals in ordering:
        available = [
            proposal
            for proposal in proposals
            if not any(invoice_id in used_invoice_ids for invoice_id in proposal.invoice_ids)
        ]

        if not available:
            decisions.append(
                Decision(
                    receipt_id=receipt_id,
                    action=ActionType.EXCEPTION_CASE,
                    matched_invoice_ids=[],
                    confidence=0,
                    amount_difference=Decimal("0.00"),
                    requires_adjustment=False,
                    requires_period_adjustment=False,
                    reasons=["No unique invoices available after conflict checks."],
                    alternatives=[proposal.to_dict() for proposal in proposals[:3]],
                )
            )
            continue

        best = available[0]
        second = available[1] if len(available) > 1 else None
        confidence_gap = best.score - second.score if second else best.score

        if second and confidence_gap < rules.minimum_confidence_gap:
            decisions.append(
                Decision(
                    receipt_id=receipt_id,
                    action=ActionType.EXCEPTION_CASE,
                    matched_invoice_ids=[],
                    confidence=best.score,
                    amount_difference=best.amount_difference,
                    requires_adjustment=False,
                    requires_period_adjustment=False,
                    reasons=[
                        "Ambiguous match candidates.",
                        f"Top proposals are separated by only {confidence_gap} points.",
                    ],
                    alternatives=[proposal.to_dict() for proposal in available[:3]],
                )
            )
            continue

        used_invoice_ids.update(best.invoice_ids)
        decisions.append(
            Decision(
                receipt_id=receipt_id,
                action=best.action,
                matched_invoice_ids=list(best.invoice_ids),
                confidence=best.score,
                amount_difference=best.amount_difference,
                requires_adjustment=best.amount_difference != Decimal("0.00"),
                requires_period_adjustment=not best.same_period,
                reasons=list(best.reasons),
                alternatives=[proposal.to_dict() for proposal in available[1:3]],
            )
        )

    return BatchResult(decisions=sorted(decisions, key=lambda decision: decision.receipt_id), rules=rules)


def build_proposals(
    receipt: ReceiptCandidate,
    invoices: list[InvoiceCandidate],
    rules: RuleConfig,
) -> list[MatchProposal]:
    eligible = [invoice for invoice in invoices if _is_eligible(receipt, invoice, rules)]
    proposals: list[MatchProposal] = []

    for invoice in eligible:
        proposal = _build_proposal(receipt, [invoice], rules)
        if proposal:
            proposals.append(proposal)

    if rules.allow_many_to_one and len(eligible) > 1:
        max_size = min(rules.max_invoice_combination_size, len(eligible))
        for size in range(2, max_size + 1):
            for group in combinations(eligible, size):
                proposal = _build_proposal(receipt, list(group), rules)
                if proposal:
                    proposals.append(proposal)

    proposals.sort(key=lambda proposal: (proposal.score, -len(proposal.invoice_ids)), reverse=True)
    return proposals


def _sort_key(proposals: list[MatchProposal]) -> tuple[int, int, int]:
    if not proposals:
        return (0, 0, 0)
    best = proposals[0]
    second = proposals[1] if len(proposals) > 1 else None
    gap = best.score - second.score if second else best.score
    return (best.score, gap, -len(proposals))


def _is_eligible(receipt: ReceiptCandidate, invoice: InvoiceCandidate, rules: RuleConfig) -> bool:
    if receipt.customer_id != invoice.customer_id:
        return False
    if receipt.currency != invoice.currency:
        return False
    if rules.require_same_ar_account and receipt.ar_account_id != invoice.ar_account_id:
        return False
    if rules.require_same_subsidiary and receipt.subsidiary_id != invoice.subsidiary_id:
        return False
    day_difference = abs((receipt.transaction_date - invoice.transaction_date).days)
    return day_difference <= rules.days_window


def _build_proposal(
    receipt: ReceiptCandidate,
    invoices: list[InvoiceCandidate],
    rules: RuleConfig,
) -> MatchProposal | None:
    total_open = sum((invoice.open_amount for invoice in invoices), start=Decimal("0.00"))
    difference = abs(receipt.amount - total_open)
    allowed_difference = rules.allowed_difference(total_open)

    if difference > allowed_difference and difference > rules.exact_match_tolerance:
        return None

    same_period = all(invoice.posting_period == receipt.posting_period for invoice in invoices)
    action = _determine_action(difference, same_period, rules)
    if action is None:
        return None

    reference_match = any(
        receipt.reference
        and invoice.document_number
        and receipt.reference.casefold() in invoice.document_number.casefold()
        for invoice in invoices
    )
    day_difference = min(abs((receipt.transaction_date - invoice.transaction_date).days) for invoice in invoices)

    score = 100
    score -= int(difference * 10)
    score -= max(0, day_difference // 10)
    score -= (len(invoices) - 1) * 5
    if reference_match:
        score += 20
    if same_period:
        score += 10
    score = max(1, min(score, 150))

    reasons = [
        f"Matched customer {receipt.customer_id} and currency {receipt.currency}.",
        f"Total invoice amount {total_open} vs receipt amount {receipt.amount}.",
    ]
    if difference == Decimal("0.00"):
        reasons.append("Exact amount match.")
    else:
        reasons.append(f"Difference {difference} is within tolerance {allowed_difference}.")
    if reference_match:
        reasons.append("Receipt reference matches invoice number.")
    if same_period:
        reasons.append("Receipt and invoices are in the same posting period.")
    else:
        reasons.append("Receipt and invoices span different posting periods.")

    return MatchProposal(
        receipt_id=receipt.id,
        invoice_ids=tuple(invoice.id for invoice in invoices),
        action=action,
        score=score,
        amount_difference=difference,
        same_period=same_period,
        day_difference=day_difference,
        reference_match=reference_match,
        reasons=reasons,
    )


def _determine_action(
    difference: Decimal,
    same_period: bool,
    rules: RuleConfig,
) -> ActionType | None:
    if difference == Decimal("0.00") and same_period:
        return ActionType.AUTO_APPLY
    if difference != Decimal("0.00") and same_period:
        return ActionType.AUTO_APPLY_WITH_ADJUSTMENT
    if rules.allow_cross_period_auto_adjustment:
        return ActionType.AUTO_APPLY_WITH_PERIOD_ADJUSTMENT
    return None
