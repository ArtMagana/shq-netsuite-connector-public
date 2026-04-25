import type { RuleDefinition } from './types.js'

export const ruleDefinitions: RuleDefinition[] = [
  {
    code: 'K',
    title: 'K',
    definition:
      'Factura abierta PPD identificada por cruce Kontempo entre archivos de ordenes y transferencias, la orden de venta o factura abierta de NetSuite, y el diario de desembolso neto con comision, pagable con customer payment al banco puente usando los datos CFDI de Kontempo.',
  },
  {
    code: 'PPD1',
    title: 'PPD1',
    definition:
      'Factura abierta PPD con diario Journal exacto identificado en el mes vigente, con fecha posterior a la factura, homologable a banco puente 100 y customer payment completo listo para timbrado manual.',
  },
  {
    code: 'A1',
    title: 'A1',
    definition:
      'Transaccion de venta pagada en el mismo periodo contable y con el mismo monto exacto, PUE.',
  },
  {
    code: 'A2',
    title: 'A2',
    definition:
      'Transaccion de venta MXN pagable en el mismo periodo contable, PUE, con diferencia absoluta mayor a 0 y hasta $1.00 MXN frente a la factura.',
  },
  {
    code: 'A3',
    title: 'A3',
    definition:
      'Transaccion de venta MXN pagable en el mismo periodo contable, PUE, con diferencia absoluta mayor a $1.00 MXN y hasta $25.00 MXN frente a la factura.',
  },
  {
    code: 'A4',
    title: 'A4',
    definition:
      'Varias facturas PUE de la misma orden de venta, cliente, periodo y moneda, aplicables contra un solo credito vivo por el total del grupo.',
  },
  {
    code: 'A5',
    title: 'A5',
    definition:
      'Una o varias facturas PUE de la misma orden de venta, cliente, periodo y moneda, aplicables contra un solo credito vivo igual o dentro de $1.00 MXN del total de la orden de venta, dejando remanente en el credito.',
  },
  {
    code: 'A6',
    title: 'A6',
    definition:
      'Factura PUE unica del cliente en el mismo periodo y moneda, correspondiente a una orden de venta de una sola factura, aplicable contra un diario vivo mayor al monto de la factura y dejando remanente en el credito.',
  },
  {
    code: 'A7',
    title: 'A7',
    definition:
      'Dos o mas facturas PUE del mismo cliente, periodo y moneda MXN, no necesariamente de la misma orden de venta, aplicables contra un solo diario vivo del mismo periodo que cubre de forma unica todo el grupo y deja remanente en el credito.',
  },
  {
    code: 'A8',
    title: 'A8',
    definition:
      'Una o varias facturas PUE del mismo cliente, periodo y moneda MXN, asignables de forma deterministica contra creditos vivos del mismo periodo de tipo Journal o CustCred, aplicando por factura el credito mas ajustado disponible y dejando remanente cuando corresponda.',
  },
  {
    code: 'B1',
    title: 'B1',
    definition:
      'Factura PUE con credito exacto del mismo cliente y moneda, pero en distinto periodo contable anterior, resuelta mediante banco puente y diario puente para reconocer el cobro en el periodo de la factura.',
  },
  {
    code: 'B2',
    title: 'B2',
    definition:
      'Factura PUE MXN unica del cliente en su periodo y moneda, con un solo diario de periodo anterior mayor al monto de la factura, resuelta mediante banco puente y diario puente para reconocer el cobro en el periodo de la factura y dejar remanente en el credito original.',
  },
  {
    code: 'B3',
    title: 'B3',
    definition:
      'Dos o mas facturas PUE MXN abiertas de la misma orden de venta, todas las abiertas restantes de esa orden, con un solo diario de periodo anterior cuyo monto original coincide con la orden y cuyo disponible coincide exactamente con el grupo abierto, resueltas con puente por factura en la fecha de cada factura.',
  },
  {
    code: 'N1',
    title: 'N1',
    definition:
      'Factura PUE sin cobro A1, A2 o A3, respaldada por una factura de anticipo del mes inmediato anterior ya pagada desde un banco autorizado, para aplicar mediante nota de credito.',
  },
]
