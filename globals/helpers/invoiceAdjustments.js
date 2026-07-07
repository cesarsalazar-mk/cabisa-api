const getNoteAmountFromDetail = requestDetail => {
  if (!requestDetail) return 0

  try {
    const data =
      typeof requestDetail === 'string' ? JSON.parse(requestDetail) : requestDetail

    return (data?.invoice?.items || []).reduce(
      (sum, item) =>
        sum + Number(item.payment_amount || 0) * Number(item.payment_qty || 0),
      0
    )
  } catch (error) {
    return 0
  }
}

const findAdjustmentsByBillUuids = uuids => {
  if (!uuids?.length) return null

  const placeholders = uuids.map(() => '?').join(', ')

  return {
    query: `
      SELECT
        dcn.id,
        dcn.document_type,
        dcn.document_number,
        dcn.serie,
        dcn.related_bill_uuid,
        dcn.created_at,
        dcn.request_detail
      FROM documents_debit_credit_notes dcn
      WHERE dcn.error = 'NO ERRORS'
        AND dcn.related_bill_uuid IN (${placeholders})
      ORDER BY dcn.created_at ASC, dcn.id ASC
    `,
    params: uuids,
  }
}

const getDocumentTotalValue = (document, totalField = 'total') =>
  Number(document?.[totalField] ?? document?.total ?? document?.total_amount ?? 0)

const enrichDocumentsWithAdjustments = async (
  documents = [],
  dbQuery,
  { totalField = 'total' } = {}
) => {
  const uuids = [...new Set(documents.map(document => document.uuid).filter(Boolean))]

  if (!uuids.length) {
    return documents.map(document => ({
      ...document,
      adjustments: [],
      credit_adjustment: 0,
      debit_adjustment: 0,
      net_adjustment: 0,
      adjusted_total: getDocumentTotalValue(document, totalField),
      adjustments_count: 0,
    }))
  }

  const adjustmentsQuery = findAdjustmentsByBillUuids(uuids)
  const adjustmentRows = await dbQuery(adjustmentsQuery.query, adjustmentsQuery.params)
  const adjustmentsByUuid = {}

  adjustmentRows.forEach(row => {
    const amount = getNoteAmountFromDetail(row.request_detail)
    const entry = {
      id: row.id,
      document_type: row.document_type,
      document_number: row.document_number,
      serie: row.serie,
      amount,
      created_at: row.created_at,
    }

    if (!adjustmentsByUuid[row.related_bill_uuid]) {
      adjustmentsByUuid[row.related_bill_uuid] = []
    }

    adjustmentsByUuid[row.related_bill_uuid].push(entry)
  })

  return documents.map(document => {
    const adjustments = adjustmentsByUuid[document.uuid] || []
    const credit_adjustment = adjustments
      .filter(adjustment => adjustment.document_type === 'CREDITO')
      .reduce((sum, adjustment) => sum + adjustment.amount, 0)
    const debit_adjustment = adjustments
      .filter(adjustment => adjustment.document_type === 'DEBITO')
      .reduce((sum, adjustment) => sum + adjustment.amount, 0)
    const net_adjustment = debit_adjustment - credit_adjustment
    const originalTotal = getDocumentTotalValue(document, totalField)

    return {
      ...document,
      adjustments,
      credit_adjustment,
      debit_adjustment,
      net_adjustment,
      adjusted_total: originalTotal + net_adjustment,
      adjustments_count: adjustments.length,
    }
  })
}

const getDocumentNetAdjustmentSql = (docAlias = 'd') => `
  COALESCE((
    SELECT SUM(
      CASE
        WHEN dcn.document_type = 'DEBITO' THEN COALESCE(note_items.note_amount, 0)
        WHEN dcn.document_type = 'CREDITO' THEN -COALESCE(note_items.note_amount, 0)
        ELSE 0
      END
    )
    FROM documents_debit_credit_notes dcn
    LEFT JOIN (
      SELECT
        dcn2.id,
        SUM(
          CAST(JSON_UNQUOTE(JSON_EXTRACT(jt.value, '$.payment_amount')) AS DECIMAL(18, 4)) *
          CAST(JSON_UNQUOTE(JSON_EXTRACT(jt.value, '$.payment_qty')) AS DECIMAL(18, 4))
        ) AS note_amount
      FROM documents_debit_credit_notes dcn2
      JOIN JSON_TABLE(
        JSON_EXTRACT(dcn2.request_detail, '$.invoice.items'),
        '$[*]' COLUMNS (value JSON PATH '$')
      ) AS jt
      WHERE dcn2.error = 'NO ERRORS'
      GROUP BY dcn2.id
    ) note_items ON note_items.id = dcn.id
    WHERE dcn.related_bill_uuid = ${docAlias}.uuid
      AND dcn.error = 'NO ERRORS'
  ), 0)
`

const buildDocumentReportSummary = (rows = []) => {
  const toNumber = value => Number(value) || 0

  return rows.reduce(
    (summary, row) => {
      const adjustedTotal = toNumber(row.adjusted_total ?? row.total_amount ?? row.total)

      summary.total_invoices += 1

      if (row.status === 'APPROVED') {
        summary.approved_count += 1
        summary.approved_total += adjustedTotal
      }

      if (row.status === 'CANCELLED') {
        summary.cancelled_count += 1
        summary.cancelled_total += adjustedTotal
      }

      return summary
    },
    {
      total_invoices: 0,
      approved_count: 0,
      cancelled_count: 0,
      approved_total: 0,
      cancelled_total: 0,
    }
  )
}

const buildReceiptsSummaryFromRows = (rows = []) => {
  const toNumber = value => Number(value) || 0

  return rows.reduce(
    (summary, row) => {
      const billed = toNumber(row.adjusted_total ?? row.total_amount)
      const paid = toNumber(row.paid_amount)
      const isElectronic = Boolean(row.document_number)

      summary.total_invoices += 1
      summary.total_billed += billed
      summary.total_paid += paid

      if (isElectronic) {
        summary.electronic_count += 1
        summary.electronic_billed += billed
        summary.electronic_paid += paid
      } else {
        summary.system_count += 1
        summary.system_billed += billed
        summary.system_paid += paid
      }

      return summary
    },
    {
      total_invoices: 0,
      total_billed: 0,
      total_paid: 0,
      electronic_count: 0,
      system_count: 0,
      electronic_billed: 0,
      system_billed: 0,
      electronic_paid: 0,
      system_paid: 0,
    }
  )
}

const buildSalesReportSummary = (rows = []) =>
  rows.reduce(
    (summary, row) => ({
      total_documents: summary.total_documents + 1,
      total_billed:
        summary.total_billed + Number(row.adjusted_total ?? row.total_amount ?? 0),
    }),
    { total_documents: 0, total_billed: 0 }
  )

module.exports = {
  buildDocumentReportSummary,
  buildReceiptsSummaryFromRows,
  buildSalesReportSummary,
  enrichDocumentsWithAdjustments,
  findAdjustmentsByBillUuids,
  getDocumentNetAdjustmentSql,
  getDocumentTotalValue,
  getNoteAmountFromDetail,
}
