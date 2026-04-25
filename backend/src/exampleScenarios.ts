import { invoices, receipts } from './mockData.js'
import { previewReconciliation, resolveRules } from './reconciliationEngine.js'
import type { Decision, ExampleScenario, InvoiceCandidate, ReceiptCandidate, RuleCheck } from './types.js'

const receiptIndex = new Map(receipts.map((receipt) => [receipt.id, receipt]))
const invoiceIndex = new Map(invoices.map((invoice) => [invoice.id, invoice]))

export const labRules = resolveRules({
  amountTolerance: 5,
  exactMatchTolerance: 0,
})

export const exampleScenarios: ExampleScenario[] = [
  createScenario({
    id: 'exact-match',
    title: 'Match exacto listo para aplicar',
    summary:
      'El diario de cobro y la factura abierta coinciden en cliente, importe, moneda, cuenta A/R, subsidiaria y periodo.',
    receiptId: 'JE-1001',
    invoiceIds: ['INV-9001'],
    ruleChecks: [
      pass('Cliente', 'El diario y la factura pertenecen al mismo cliente CUST-001.'),
      pass('Moneda y A/R', 'Ambos usan USD y la cuenta A/R 1105.'),
      pass('Importe', 'El monto del diario es exactamente igual al saldo abierto.'),
      pass('Periodo', 'Ambas transacciones viven en Apr 2026.'),
      pass('Referencia', 'La referencia FAC-9001 respalda el cruce propuesto.'),
    ],
  }),
  createScenario({
    id: 'tolerance-review',
    title: 'Diferencia pequena dentro de tolerancia',
    summary:
      'El recibo viene por 99.20 USD contra una factura abierta de 100.00 USD. Usa la tolerancia del laboratorio para ver cuando este caso pasa a revision o se cae a excepcion.',
    receiptId: 'JE-1002',
    invoiceIds: ['INV-9002'],
    ruleChecks: [
      pass('Cliente', 'El cliente CUST-002 coincide.'),
      pass('Moneda y A/R', 'La conciliacion permanece dentro del mismo contexto contable.'),
      watch('Importe', 'Existe una diferencia de 0.80 USD y la salida depende de la tolerancia vigente.'),
      pass('Periodo', 'El diario y la factura pertenecen a Apr 2026.'),
      watch('Siguiente accion', 'Se requiere revisar si conviene crear un diario de ajuste.'),
    ],
  }),
  createScenario({
    id: 'cross-period-review',
    title: 'Coincidencia exacta en distinto periodo',
    summary:
      'El importe coincide, pero la factura esta en Mar 2026 y el recibo en Apr 2026, asi que la decision se bloquea para revision contable.',
    receiptId: 'JE-1003',
    invoiceIds: ['INV-9003'],
    ruleChecks: [
      pass('Cliente', 'El diario y la factura pertenecen al cliente CUST-003.'),
      pass('Importe', 'No existe diferencia en el monto del cobro contra el saldo abierto.'),
      pass('Moneda y A/R', 'La conciliacion se mantiene en USD y la misma cuenta A/R.'),
      watch('Periodo', 'Las transacciones cruzan de Mar 2026 a Apr 2026.'),
      watch('Siguiente accion', 'Hace falta definir el asiento de efecto entre periodos.'),
    ],
  }),
  createScenario({
    id: 'ambiguous-match',
    title: 'Caso ambiguo con dos facturas posibles',
    summary:
      'El diario cumple las reglas base, pero hay dos facturas abiertas igualmente validas y el motor no se atreve a elegir una solo.',
    receiptId: 'JE-1004',
    invoiceIds: ['INV-9004', 'INV-9005'],
    ruleChecks: [
      pass('Cliente', 'Las dos facturas candidatas pertenecen al cliente CUST-004.'),
      pass('Importe', 'Cada factura candidata tiene exactamente el mismo saldo que el diario.'),
      pass('Moneda y A/R', 'No hay conflicto de moneda, subsidiaria ni cuenta A/R.'),
      block('Unicidad', 'El score de las dos propuestas queda demasiado cerca y no permite autoaplicar.'),
      block('Siguiente accion', 'El caso debe ir a la cola de excepciones para seleccion manual.'),
    ],
  }),
]

function createScenario(input: {
  id: string
  title: string
  summary: string
  receiptId: string
  invoiceIds: string[]
  ruleChecks: RuleCheck[]
}): ExampleScenario {
  const receipt = getReceipt(input.receiptId)
  const candidateInvoices = input.invoiceIds.map(getInvoice)
  const decision = getDecision(receipt, candidateInvoices)

  return {
    id: input.id,
    title: input.title,
    summary: input.summary,
    receipt,
    candidateInvoices,
    ruleChecks: input.ruleChecks,
    decision,
  }
}

function getDecision(receipt: ReceiptCandidate, candidateInvoices: InvoiceCandidate[]): Decision {
  const preview = previewReconciliation({
    rules: labRules,
    receipts: [receipt],
    invoices: candidateInvoices,
  })

  const [decision] = preview.decisions
  if (!decision) {
    throw new Error(`No decision generated for receipt ${receipt.id}.`)
  }
  return decision
}

function getReceipt(id: string) {
  const receipt = receiptIndex.get(id)
  if (!receipt) {
    throw new Error(`Unknown receipt ${id}.`)
  }
  return receipt
}

function getInvoice(id: string) {
  const invoice = invoiceIndex.get(id)
  if (!invoice) {
    throw new Error(`Unknown invoice ${id}.`)
  }
  return invoice
}

function pass(label: string, detail: string): RuleCheck {
  return { label, detail, status: 'pass' }
}

function watch(label: string, detail: string): RuleCheck {
  return { label, detail, status: 'watch' }
}

function block(label: string, detail: string): RuleCheck {
  return { label, detail, status: 'block' }
}
