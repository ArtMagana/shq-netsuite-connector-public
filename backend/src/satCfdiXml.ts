import { DOMParser, type Element, type Node } from '@xmldom/xmldom'

export type SatCfdiXmlSummary = {
  uuid: string | null
  fecha: string | null
  serie: string | null
  folio: string | null
  tipoComprobante: string | null
  moneda: string | null
  tipoCambio: number | null
  subtotal: number | null
  total: number | null
  emisorNombre: string | null
  emisorRfc: string | null
  receptorNombre: string | null
  receptorRfc: string | null
}

export function parseSatCfdiXmlSummary(content: string): SatCfdiXmlSummary | null {
  const parser = new DOMParser({
    onError: () => undefined,
  })

  const document = parser.parseFromString(sanitizeXmlContent(content), 'application/xml')
  const comprobante = firstDescendantByLocalName(document, 'Comprobante')
  if (!comprobante) {
    return null
  }

  const emisor = firstChildElementByLocalName(comprobante, 'Emisor')
  const receptor = firstChildElementByLocalName(comprobante, 'Receptor')
  const timbre = firstDescendantByLocalName(comprobante, 'TimbreFiscalDigital')

  return {
    uuid: readAttributeValue(timbre, 'UUID'),
    fecha: readAttributeValue(comprobante, 'Fecha'),
    serie: readAttributeValue(comprobante, 'Serie'),
    folio: readAttributeValue(comprobante, 'Folio'),
    tipoComprobante: readAttributeValue(comprobante, 'TipoDeComprobante'),
    moneda: readAttributeValue(comprobante, 'Moneda'),
    tipoCambio: parseOptionalNumber(readAttributeValue(comprobante, 'TipoCambio')),
    subtotal: parseOptionalNumber(readAttributeValue(comprobante, 'SubTotal')),
    total: parseOptionalNumber(readAttributeValue(comprobante, 'Total')),
    emisorNombre: readAttributeValue(emisor, 'Nombre'),
    emisorRfc: readAttributeValue(emisor, 'Rfc'),
    receptorNombre: readAttributeValue(receptor, 'Nombre'),
    receptorRfc: readAttributeValue(receptor, 'Rfc'),
  }
}

function sanitizeXmlContent(content: string) {
  return content.replace(/^\uFEFF/, '').replace(/\u0000/g, '')
}

function firstChildElementByLocalName(node: Element | null, targetLocalName: string) {
  if (!node) {
    return null
  }

  for (let index = 0; index < node.childNodes.length; index += 1) {
    const child = node.childNodes[index]
    if (child.nodeType !== 1) {
      continue
    }

    if (normalizeLocalName((child as Element).localName ?? child.nodeName) === normalizeLocalName(targetLocalName)) {
      return child as Element
    }
  }

  return null
}

function firstDescendantByLocalName(root: Node | null, targetLocalName: string): Element | null {
  if (!root) {
    return null
  }

  if (
    root.nodeType === 1 &&
    normalizeLocalName((root as Element).localName ?? root.nodeName) === normalizeLocalName(targetLocalName)
  ) {
    return root as Element
  }

  for (let index = 0; index < root.childNodes.length; index += 1) {
    const child = root.childNodes[index]
    const descendant = firstDescendantByLocalName(child, targetLocalName)
    if (descendant) {
      return descendant
    }
  }

  return null
}

function readAttributeValue(node: Element | null, attributeName: string) {
  if (!node || !node.attributes) {
    return null
  }

  const normalizedTarget = normalizeLocalName(attributeName)
  for (let index = 0; index < node.attributes.length; index += 1) {
    const attribute = node.attributes.item(index)
    if (!attribute) {
      continue
    }

    if (normalizeLocalName(attribute.localName ?? attribute.nodeName) === normalizedTarget) {
      const value = attribute.nodeValue?.trim()
      return value ? value : null
    }
  }

  return null
}

function normalizeLocalName(value: string) {
  return value.split(':').at(-1)?.trim().toLowerCase() ?? ''
}

function parseOptionalNumber(value: string | null) {
  if (!value) {
    return null
  }

  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}
