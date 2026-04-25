from __future__ import annotations

import unittest
from decimal import Decimal

from netsuite_ar_recon.engine import preview_reconciliation
from netsuite_ar_recon.models import InvoiceCandidate, ReceiptCandidate, RuleConfig


class PreviewReconciliationTests(unittest.TestCase):
    def test_exact_match_returns_auto_apply(self) -> None:
        rules = RuleConfig()
        result = preview_reconciliation(
            receipts=[
                ReceiptCandidate.from_payload(
                    {
                        "id": "JE-1",
                        "customer_id": "CUST-1",
                        "subsidiary_id": "SUB-1",
                        "ar_account_id": "AR-1",
                        "currency": "USD",
                        "amount": "100.00",
                        "transaction_date": "2026-04-15",
                        "posting_period": "Apr 2026",
                        "reference": "INV-100",
                    }
                )
            ],
            invoices=[
                InvoiceCandidate.from_payload(
                    {
                        "id": "INV-100",
                        "document_number": "INV-100",
                        "customer_id": "CUST-1",
                        "subsidiary_id": "SUB-1",
                        "ar_account_id": "AR-1",
                        "currency": "USD",
                        "open_amount": "100.00",
                        "transaction_date": "2026-04-01",
                        "posting_period": "Apr 2026",
                    }
                )
            ],
            rules=rules,
        )
        decision = result.decisions[0]
        self.assertEqual(decision.action.value, "AUTO_APPLY")
        self.assertEqual(decision.matched_invoice_ids, ["INV-100"])
        self.assertEqual(decision.amount_difference, Decimal("0.00"))

    def test_tolerance_match_returns_adjustment(self) -> None:
        rules = RuleConfig(amount_tolerance=Decimal("2.00"))
        result = preview_reconciliation(
            receipts=[
                ReceiptCandidate.from_payload(
                    {
                        "id": "JE-2",
                        "customer_id": "CUST-2",
                        "subsidiary_id": "SUB-1",
                        "ar_account_id": "AR-1",
                        "currency": "USD",
                        "amount": "101.25",
                        "transaction_date": "2026-04-15",
                        "posting_period": "Apr 2026",
                    }
                )
            ],
            invoices=[
                InvoiceCandidate.from_payload(
                    {
                        "id": "INV-200",
                        "document_number": "INV-200",
                        "customer_id": "CUST-2",
                        "subsidiary_id": "SUB-1",
                        "ar_account_id": "AR-1",
                        "currency": "USD",
                        "open_amount": "100.00",
                        "transaction_date": "2026-04-10",
                        "posting_period": "Apr 2026",
                    }
                )
            ],
            rules=rules,
        )
        decision = result.decisions[0]
        self.assertEqual(decision.action.value, "AUTO_APPLY_WITH_ADJUSTMENT")
        self.assertTrue(decision.requires_adjustment)
        self.assertEqual(decision.amount_difference, Decimal("1.25"))

    def test_cross_period_without_permission_goes_to_exception(self) -> None:
        rules = RuleConfig()
        result = preview_reconciliation(
            receipts=[
                ReceiptCandidate.from_payload(
                    {
                        "id": "JE-3",
                        "customer_id": "CUST-3",
                        "subsidiary_id": "SUB-1",
                        "ar_account_id": "AR-1",
                        "currency": "USD",
                        "amount": "100.00",
                        "transaction_date": "2026-04-02",
                        "posting_period": "Apr 2026",
                    }
                )
            ],
            invoices=[
                InvoiceCandidate.from_payload(
                    {
                        "id": "INV-300",
                        "document_number": "INV-300",
                        "customer_id": "CUST-3",
                        "subsidiary_id": "SUB-1",
                        "ar_account_id": "AR-1",
                        "currency": "USD",
                        "open_amount": "100.00",
                        "transaction_date": "2026-03-30",
                        "posting_period": "Mar 2026",
                    }
                )
            ],
            rules=rules,
        )
        decision = result.decisions[0]
        self.assertEqual(decision.action.value, "EXCEPTION_CASE")

    def test_ambiguous_match_goes_to_exception(self) -> None:
        rules = RuleConfig(minimum_confidence_gap=25)
        result = preview_reconciliation(
            receipts=[
                ReceiptCandidate.from_payload(
                    {
                        "id": "JE-4",
                        "customer_id": "CUST-4",
                        "subsidiary_id": "SUB-1",
                        "ar_account_id": "AR-1",
                        "currency": "USD",
                        "amount": "100.00",
                        "transaction_date": "2026-04-15",
                        "posting_period": "Apr 2026",
                    }
                )
            ],
            invoices=[
                InvoiceCandidate.from_payload(
                    {
                        "id": "INV-401",
                        "document_number": "INV-401",
                        "customer_id": "CUST-4",
                        "subsidiary_id": "SUB-1",
                        "ar_account_id": "AR-1",
                        "currency": "USD",
                        "open_amount": "100.00",
                        "transaction_date": "2026-04-05",
                        "posting_period": "Apr 2026",
                    }
                ),
                InvoiceCandidate.from_payload(
                    {
                        "id": "INV-402",
                        "document_number": "INV-402",
                        "customer_id": "CUST-4",
                        "subsidiary_id": "SUB-1",
                        "ar_account_id": "AR-1",
                        "currency": "USD",
                        "open_amount": "100.00",
                        "transaction_date": "2026-04-06",
                        "posting_period": "Apr 2026",
                    }
                ),
            ],
            rules=rules,
        )
        decision = result.decisions[0]
        self.assertEqual(decision.action.value, "EXCEPTION_CASE")


if __name__ == "__main__":
    unittest.main()
