import type {
  ActionType,
  Decision,
  InvoiceCandidate,
  MatchProposal,
  PreviewPayload,
  ReconciliationPolicy,
  ReceiptCandidate,
  RuleConfig,
} from './types.js'

export const defaultRules: RuleConfig = {
  amountTolerance: 0,
  percentTolerance: 0,
  exactMatchTolerance: 0,
  daysWindow: 90,
  requireSameSubsidiary: true,
  requireSameArAccount: true,
  allowManyToOne: true,
  maxInvoiceCombinationSize: 3,
  allowCrossPeriodAutoAdjustment: false,
  minimumConfidenceGap: 15,
}

export const firstProductionPolicy: ReconciliationPolicy = {
  name: 'Customer receipt journal to open invoice',
  description:
    'Primera regla productiva: identificar solo facturas PUE con credito vivo del mismo periodo contable y mismo monto exacto.',
  autoApplyCriteria: [
    'Mismo cliente',
    'Misma moneda',
    'Misma cuenta A/R',
    'Importe exacto disponible',
    'Mismo periodo contable',
    'Factura marcada como PUE - Pago en una Sola Exhibicion',
  ],
  reviewCriteria: [
    'Diferencia pequena dentro de tolerancia configurada',
    'Coincidencia exacta pero en distinto periodo',
    'Combinacion valida de varias facturas pendiente de aprobacion',
  ],
  blockedCriteria: [
    'Cliente distinto',
    'Moneda distinta',
    'Cuenta A/R distinta',
    'Subsidiaria distinta cuando es obligatoria',
    'Multiples candidatos empatados',
  ],
}

export function resolveRules(input?: Partial<RuleConfig>): RuleConfig {
  return {
    ...defaultRules,
    ...input,
  }
}

export function previewReconciliation(payload: PreviewPayload) {
  const rules = resolveRules(payload.rules)
  const proposalsByReceipt = new Map(
    payload.receipts.map((receipt) => [receipt.id, buildProposals(receipt, payload.invoices, rules)]),
  )

  const ordered = [...proposalsByReceipt.entries()].sort((left, right) => {
    const a = sortKey(left[1])
    const b = sortKey(right[1])
    return b[0] - a[0] || b[1] - a[1] || b[2] - a[2]
  })

  const usedInvoiceIds = new Set<string>()
  const decisions: Decision[] = []

  for (const [receiptId, proposals] of ordered) {
    const available = proposals.filter(
      (proposal) => !proposal.invoiceIds.some((invoiceId) => usedInvoiceIds.has(invoiceId)),
    )

    if (available.length === 0) {
      decisions.push({
        receiptId,
        action: 'EXCEPTION_CASE',
        stage: 'UNMATCHED',
        matchedInvoiceIds: [],
        confidence: 0,
        amountDifference: 0,
        requiresAdjustment: false,
        requiresPeriodAdjustment: false,
        reasons: ['No unique invoices available after conflict checks.'],
        alternatives: proposals.slice(0, 3),
        nextStep: 'Send case to manual review queue.',
      })
      continue
    }

    const [best, second] = available
    const confidenceGap = second ? best.score - second.score : best.score

    if (second && confidenceGap < rules.minimumConfidenceGap) {
      decisions.push({
        receiptId,
        action: 'EXCEPTION_CASE',
        stage: 'UNMATCHED',
        matchedInvoiceIds: [],
        confidence: best.score,
        amountDifference: best.amountDifference,
        requiresAdjustment: false,
        requiresPeriodAdjustment: false,
        reasons: [
          'Ambiguous match candidates.',
          `Top proposals are separated by only ${confidenceGap} points.`,
        ],
        alternatives: available.slice(0, 3),
        nextStep: 'Finance team should choose the target invoice set manually.',
      })
      continue
    }

    best.invoiceIds.forEach((invoiceId) => usedInvoiceIds.add(invoiceId))
    decisions.push({
      receiptId,
      action: best.action,
      stage: best.stage,
      matchedInvoiceIds: best.invoiceIds,
      confidence: best.score,
      amountDifference: best.amountDifference,
      requiresAdjustment: best.action === 'REVIEW_TOLERANCE',
      requiresPeriodAdjustment: best.action === 'REVIEW_CROSS_PERIOD',
      reasons: best.reasons,
      alternatives: available.slice(1, 3),
      nextStep: nextStepFor(best.action),
    })
  }

  return {
    rules,
    decisions: decisions.sort((left, right) => left.receiptId.localeCompare(right.receiptId)),
  }
}

function buildProposals(
  receipt: ReceiptCandidate,
  invoices: InvoiceCandidate[],
  rules: RuleConfig,
): MatchProposal[] {
  const eligible = invoices.filter((invoice) => isEligible(receipt, invoice, rules))
  const proposals: MatchProposal[] = []

  for (const invoice of eligible) {
    const proposal = buildProposal(receipt, [invoice], rules)
    if (proposal) {
      proposals.push(proposal)
    }
  }

  if (rules.allowManyToOne && eligible.length > 1) {
    const maxSize = Math.min(rules.maxInvoiceCombinationSize, eligible.length)
    for (let size = 2; size <= maxSize; size += 1) {
      for (const group of combinations(eligible, size)) {
        const proposal = buildProposal(receipt, group, rules)
        if (proposal) {
          proposals.push(proposal)
        }
      }
    }
  }

  return proposals.sort((left, right) => right.score - left.score || left.invoiceIds.length - right.invoiceIds.length)
}

function sortKey(proposals: MatchProposal[]) {
  if (proposals.length === 0) {
    return [0, 0, 0]
  }

  const [best, second] = proposals
  const gap = second ? best.score - second.score : best.score
  return [best.score, gap, -proposals.length]
}

function isEligible(receipt: ReceiptCandidate, invoice: InvoiceCandidate, rules: RuleConfig) {
  if (receipt.customerId !== invoice.customerId) {
    return false
  }

  if (receipt.currency !== invoice.currency) {
    return false
  }

  if (rules.requireSameArAccount && receipt.arAccountId !== invoice.arAccountId) {
    return false
  }

  if (rules.requireSameSubsidiary && receipt.subsidiaryId !== invoice.subsidiaryId) {
    return false
  }

  return differenceInDays(receipt.transactionDate, invoice.transactionDate) <= rules.daysWindow
}

function buildProposal(
  receipt: ReceiptCandidate,
  invoices: InvoiceCandidate[],
  rules: RuleConfig,
): MatchProposal | null {
  const totalOpen = round2(invoices.reduce((sum, invoice) => sum + invoice.openAmount, 0))
  const difference = round2(Math.abs(receipt.amount - totalOpen))
  const allowedDifference = allowedDifferenceFor(totalOpen, rules)

  if (difference > allowedDifference && difference > rules.exactMatchTolerance) {
    return null
  }

  const samePeriod = invoices.every((invoice) => invoice.postingPeriod === receipt.postingPeriod)
  const action = determineAction(difference, allowedDifference, samePeriod)
  if (!action) {
    return null
  }
  const stage = determineStage(action)

  const referenceMatch = invoices.some(
    (invoice) =>
      Boolean(receipt.reference) &&
      Boolean(invoice.documentNumber) &&
      invoice.documentNumber!.toLowerCase().includes(receipt.reference!.toLowerCase()),
  )
  const dayDifference = Math.min(
    ...invoices.map((invoice) => differenceInDays(receipt.transactionDate, invoice.transactionDate)),
  )

  let score = 100
  score -= Math.trunc(difference * 10)
  score -= Math.max(0, Math.trunc(dayDifference / 10))
  score -= (invoices.length - 1) * 5
  if (referenceMatch) {
    score += 20
  }
  if (samePeriod) {
    score += 10
  }
  if (action === 'AUTO_APPLY') {
    score += 10
  }
  score = Math.max(1, Math.min(score, 150))

  const reasons = [
    `Matched customer ${receipt.customerId} and currency ${receipt.currency}.`,
    `Total invoice amount ${totalOpen.toFixed(2)} vs receipt amount ${receipt.amount.toFixed(2)}.`,
    difference === 0
      ? 'Exact amount match.'
      : `Difference ${difference.toFixed(2)} is within tolerance ${allowedDifference.toFixed(2)}.`,
    referenceMatch ? 'Receipt reference matches invoice number.' : 'No direct invoice reference match.',
    samePeriod
      ? 'Receipt and invoices are in the same posting period.'
      : 'Receipt and invoices span different posting periods.',
    action === 'AUTO_APPLY'
      ? 'Eligible for direct application under the strict exact-match rule.'
      : action === 'REVIEW_TOLERANCE'
        ? 'Keep in review until tolerance and adjustment policy is confirmed.'
        : 'Keep in review until cross-period accounting policy is confirmed.',
  ]

  return {
    receiptId: receipt.id,
    invoiceIds: invoices.map((invoice) => invoice.id),
    action,
    stage,
    score,
    amountDifference: difference,
    samePeriod,
    dayDifference,
    referenceMatch,
    reasons,
  }
}

function determineAction(
  difference: number,
  allowedDifference: number,
  samePeriod: boolean,
): ActionType | null {
  if (difference === 0 && samePeriod) {
    return 'AUTO_APPLY'
  }
  if (difference !== 0 && samePeriod && difference <= allowedDifference) {
    return 'REVIEW_TOLERANCE'
  }
  if (!samePeriod && (difference === 0 || difference <= allowedDifference)) {
    return 'REVIEW_CROSS_PERIOD'
  }
  return null
}

function determineStage(action: ActionType) {
  switch (action) {
    case 'AUTO_APPLY':
      return 'STRICT_EXACT' as const
    case 'REVIEW_TOLERANCE':
      return 'TOLERANCE_REVIEW' as const
    case 'REVIEW_CROSS_PERIOD':
      return 'CROSS_PERIOD_REVIEW' as const
    default:
      return 'UNMATCHED' as const
  }
}

function nextStepFor(action: ActionType) {
  switch (action) {
    case 'AUTO_APPLY':
      return 'Ready for auto-apply execution once execution mode is enabled.'
    case 'REVIEW_TOLERANCE':
      return 'Review difference and decide whether to generate an adjustment journal.'
    case 'REVIEW_CROSS_PERIOD':
      return 'Review posting periods and define the required period adjustment entry.'
    default:
      return 'Manual review required.'
  }
}

function allowedDifferenceFor(amount: number, rules: RuleConfig) {
  const percentDifference = (amount * rules.percentTolerance) / 100
  return Math.max(rules.amountTolerance, percentDifference)
}

function round2(value: number) {
  return Math.round(value * 100) / 100
}

function differenceInDays(left: string, right: string) {
  const a = new Date(left).getTime()
  const b = new Date(right).getTime()
  return Math.abs(Math.round((a - b) / 86400000))
}

function combinations<T>(items: T[], size: number): T[][] {
  if (size === 1) {
    return items.map((item) => [item])
  }

  const result: T[][] = []
  items.forEach((item, index) => {
    const tail = items.slice(index + 1)
    for (const combination of combinations(tail, size - 1)) {
      result.push([item, ...combination])
    }
  })
  return result
}
