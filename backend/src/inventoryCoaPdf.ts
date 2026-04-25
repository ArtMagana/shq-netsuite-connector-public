import zlib from 'node:zlib'

import { PDFDocument, PDFName, PDFRawStream } from 'pdf-lib'

type CloneInventoryCoaPdfRequest = {
  sourcePdfBuffer: Buffer
  sourceFileName: string
  currentLot: string
  currentProductionDate: string
  currentExpirationDate: string
  newLot: string
  newProductionDate: string
  newExpirationDate: string
}

const LOT_TEXT_COORDINATE = '426.67 603.45 Td'
const EXPIRATION_TEXT_COORDINATE = '0 Tw 426.67 568.67 Td'
const PRODUCTION_TEXT_COORDINATE = '0 Tc 193.067 553.796 Td'

export class InventoryCoaPdfError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InventoryCoaPdfError'
  }
}

export async function cloneInventoryCoaPdf(request: CloneInventoryCoaPdfRequest) {
  const sourceLot = normalizeRequiredLot(request.currentLot, 'El lote actual del CoA no es valido.')
  const newLot = normalizeRequiredLot(request.newLot, 'El lote nuevo del CoA no es valido.')
  const currentProductionDate = normalizeRequiredDate(
    request.currentProductionDate,
    'La fecha de produccion actual del CoA no es valida.',
  )
  const currentExpirationDate = normalizeRequiredDate(
    request.currentExpirationDate,
    'La fecha de caducidad actual del CoA no es valida.',
  )
  const newProductionDate = normalizeRequiredDate(
    request.newProductionDate,
    'La nueva fecha de produccion no es valida.',
  )
  const newExpirationDate = normalizeRequiredDate(
    request.newExpirationDate,
    'La nueva fecha de caducidad no es valida.',
  )

  const pdfDocument = await PDFDocument.load(request.sourcePdfBuffer)
  const [page] = pdfDocument.getPages()
  if (!page) {
    throw new InventoryCoaPdfError('El CoA origen no contiene ninguna pagina para clonar.')
  }

  const contentObject = page.node.get(PDFName.of('Contents'))
  const contentStream = contentObject
    ? (page.node.context.lookup(contentObject as never) as unknown)
    : null
  if (!(contentStream instanceof PDFRawStream)) {
    throw new InventoryCoaPdfError('El CoA origen no expone un stream de contenido editable.')
  }

  const inflatedContent = zlib.inflateSync(contentStream.contents).toString('latin1')
  const replacedContent = replaceTemplateFields(inflatedContent, {
    currentLot: sourceLot,
    newLot,
    currentProductionDate,
    currentExpirationDate,
    newProductionDate,
    newExpirationDate,
  })

  const nextContentStream = pdfDocument.context.flateStream(
    Buffer.from(replacedContent, 'latin1'),
    contentStream.dict as never,
  )
  const nextContentRef = pdfDocument.context.register(nextContentStream)
  page.node.set(PDFName.of('Contents'), nextContentRef)

  const fileName = replaceLotTokenInFileName(request.sourceFileName, sourceLot, newLot)
  const pdfBytes = await pdfDocument.save({ useObjectStreams: false })

  return {
    fileName,
    pdfBuffer: Buffer.from(pdfBytes),
  }
}

function replaceTemplateFields(
  content: string,
  params: {
    currentLot: string
    newLot: string
    currentProductionDate: string
    currentExpirationDate: string
    newProductionDate: string
    newExpirationDate: string
  },
) {
  let nextContent = content

  const currentLotSnippet = `${LOT_TEXT_COORDINATE}\n${buildLotTj(params.currentLot)}`
  const newLotSnippet = `${LOT_TEXT_COORDINATE}\n${buildLotTj(params.newLot)}`
  nextContent = replaceExactOnce(
    nextContent,
    currentLotSnippet,
    newLotSnippet,
    `No encontre el lote ${params.currentLot} en el PDF base del CoA.`,
  )

  nextContent = replaceExactOnce(
    nextContent,
    [
      {
        from: buildDateBlock(EXPIRATION_TEXT_COORDINATE, params.currentExpirationDate, true),
        to: buildDateBlock(EXPIRATION_TEXT_COORDINATE, params.newExpirationDate, true),
      },
      {
        from: buildDateBlock(EXPIRATION_TEXT_COORDINATE, params.currentExpirationDate, false),
        to: buildDateBlock(EXPIRATION_TEXT_COORDINATE, params.newExpirationDate, false),
      },
    ],
    `No encontre la fecha de caducidad ${formatDisplayDate(params.currentExpirationDate)} en el PDF base del CoA.`,
  )

  nextContent = replaceExactOnce(
    nextContent,
    buildDateBlock(PRODUCTION_TEXT_COORDINATE, params.currentProductionDate, false),
    buildDateBlock(PRODUCTION_TEXT_COORDINATE, params.newProductionDate, false),
    `No encontre la fecha de produccion ${formatDisplayDate(params.currentProductionDate)} en el PDF base del CoA.`,
  )

  return nextContent
}

function buildLotTj(lot: string) {
  const characters = lot.split('')
  const tokens: string[] = []

  for (let index = 0; index < characters.length; index += 1) {
    const character = characters[index]
    const spacing = resolveLotSpacing(index, character)
    tokens.push(
      spacing !== null
        ? `(${escapePdfText(character)})${spacing}`
        : `(${escapePdfText(character)})`,
    )
  }

  return `[${tokens.join(' ')}]TJ`
}

function resolveLotSpacing(index: number, character: string) {
  if (index === 0 || index === 1) {
    return 11
  }

  if (index === 2) {
    return -14
  }

  if (index === 3) {
    return 9
  }

  if (index < 9 && /^[0-9]$/.test(character)) {
    return 3
  }

  return null
}

function buildDateBlock(coordinate: string, normalizedDate: string, useSpecialSixGlyph: boolean) {
  const [year, month, day] = normalizedDate.split('-')
  const prefix = `/${month}/${year.slice(0, 3)}`
  const secondDayDigit = day[1] ?? ''
  const lastYearDigit = year[3] ?? ''
  const secondDigitFont = secondDayDigit === '0' ? '/C2_2' : '/TT2'
  const lastDigitFont = useSpecialSixGlyph && lastYearDigit === '6' ? '/C2_2' : '/TT2'
  const secondDigitValue =
    secondDayDigit === '0' ? '<0013>' : `(${escapePdfText(secondDayDigit)})`
  const lastDigitValue =
    useSpecialSixGlyph && lastYearDigit === '6' ? '<0019>' : `(${escapePdfText(lastYearDigit)})`

  return `${coordinate}
(${escapePdfText(day[0] ?? '')})Tj
${secondDigitFont} 9.5 Tf
${secondDigitValue}Tj
/TT2 9.5 Tf
(${escapePdfText(prefix)})Tj
${useSpecialSixGlyph ? `${lastDigitFont} 9.5 Tf\n` : ''}-0.032 Tc 42.231 0 Td
${lastDigitValue}Tj`
}

function replaceExactOnce(
  content: string,
  replacement:
    | string
    | {
        from: string
        to: string
      }[],
  toOrErrorMessage: string,
  errorMessage?: string,
) {
  if (typeof replacement === 'string') {
    if (!content.includes(replacement)) {
      throw new InventoryCoaPdfError(errorMessage ?? toOrErrorMessage)
    }

    return content.replace(replacement, toOrErrorMessage)
  }

  for (const candidate of replacement) {
    if (content.includes(candidate.from)) {
      return content.replace(candidate.from, candidate.to)
    }
  }

  throw new InventoryCoaPdfError(errorMessage ?? toOrErrorMessage)
}

function replaceLotTokenInFileName(fileName: string, currentLot: string, newLot: string) {
  const escapedLot = escapeRegExp(currentLot)
  const replaced = fileName.replace(new RegExp(escapedLot, 'gi'), newLot)
  return replaced === fileName ? `${fileName.replace(/\.pdf$/i, '')} ${newLot}.pdf` : replaced
}

function normalizeRequiredLot(value: string, errorMessage: string) {
  const normalized = value.replace(/\s+/g, '').toUpperCase()
  if (!normalized || !/^[A-Z0-9._/-]+$/.test(normalized)) {
    throw new InventoryCoaPdfError(errorMessage)
  }

  return normalized
}

function normalizeRequiredDate(value: string, errorMessage: string) {
  const normalized = normalizeDateOnly(value)
  if (!normalized) {
    throw new InventoryCoaPdfError(errorMessage)
  }

  return normalized
}

function normalizeDateOnly(value: string) {
  const parts = value.split(/[./-]/).map((segment) => segment.trim())
  if (parts.length !== 3) {
    return null
  }

  let year = 0
  let month = 0
  let day = 0

  if (parts[0].length === 4) {
    year = Number.parseInt(parts[0], 10)
    month = Number.parseInt(parts[1], 10)
    day = Number.parseInt(parts[2], 10)
  } else {
    day = Number.parseInt(parts[0], 10)
    month = Number.parseInt(parts[1], 10)
    year = Number.parseInt(parts[2], 10)
    if (parts[2].length === 2) {
      year += year >= 70 ? 1900 : 2000
    }
  }

  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
    return null
  }

  const candidateDate = new Date(Date.UTC(year, month - 1, day))
  if (
    candidateDate.getUTCFullYear() !== year ||
    candidateDate.getUTCMonth() !== month - 1 ||
    candidateDate.getUTCDate() !== day
  ) {
    return null
  }

  return `${year.toString().padStart(4, '0')}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`
}

function formatDisplayDate(value: string) {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) {
    return value
  }

  return `${match[3]}/${match[2]}/${match[1]}`
}

function escapePdfText(value: string) {
  return value.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)')
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
