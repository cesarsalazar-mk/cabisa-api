const { types, getWhereConditions, helpers, toGuatemalaDateSql, toFactDateSql } = require(`${process.env['FILE_ENVIRONMENT']}/globals`)
const { invoiceAdjustments } = helpers
const { getDocumentNetAdjustmentSql } = invoiceAdjustments

const CLIENT_INVOICE_TYPES_SQL = alias => `
  (
    ${alias}.document_type = '${types.documentsTypes.SELL_INVOICE}' OR
    ${alias}.document_type = '${types.documentsTypes.RENT_INVOICE}'
  )`

const CLIENT_APPROVED_INVOICE_SQL = alias => `
  ${CLIENT_INVOICE_TYPES_SQL(alias)}
  AND ${alias}.status = '${types.documentsStatus.APPROVED}'`

// Facturación Sistema: sin # documento FEL y a veces sin fact_date.
// Usamos created_at como fallback para no excluirlas del estado de cuenta.
const CLIENT_INVOICE_DATE_SQL = alias =>
  `COALESCE(${toFactDateSql(`${alias}.fact_date`)}, ${toGuatemalaDateSql(`${alias}.created_at`)})`

const CLIENT_DOCUMENT_NUMBER_SQL = alias => `
  CASE
    WHEN ${alias}.document_number IS NOT NULL AND ${alias}.document_number <> ''
      THEN CONVERT(${alias}.document_number USING utf8mb4) COLLATE utf8mb4_unicode_ci
    WHEN ${alias}.related_internal_document_id IS NOT NULL
      THEN CONVERT(CAST(${alias}.related_internal_document_id AS CHAR) USING utf8mb4) COLLATE utf8mb4_unicode_ci
    ELSE CONVERT('Factura del sistema' USING utf8mb4) COLLATE utf8mb4_unicode_ci
  END`

const CLIENT_IS_SYSTEM_INVOICE_SQL = alias =>
  `(${alias}.document_number IS NULL OR ${alias}.document_number = '')`

const CLIENT_PAYMENT_ACTIVE_SQL = alias => `
  (${alias}.is_deleted IS NULL OR ${alias}.is_deleted = 0)`

const CLIENT_NOTE_AMOUNT_SQL = `
  SUM(
    CAST(JSON_UNQUOTE(JSON_EXTRACT(jt.value, '$.payment_amount')) AS DECIMAL(18, 4)) *
    CAST(JSON_UNQUOTE(JSON_EXTRACT(jt.value, '$.payment_qty')) AS DECIMAL(18, 4))
  )`

const CLIENT_DUE_DATE_SQL = alias => `
  COALESCE(
    DATE(${alias}.credit_due_date),
    DATE_ADD(${CLIENT_INVOICE_DATE_SQL(alias)}, INTERVAL COALESCE(${alias}.credit_days, 0) DAY)
  )`

const CLIENT_PAYMENTS_TO_DATE_SQL = (docAlias, asOfDateSql) => `
  COALESCE((
    SELECT SUM(p.payment_amount)
    FROM payments p
    WHERE p.document_id = ${docAlias}.id
      AND ${CLIENT_PAYMENT_ACTIVE_SQL('p')}
      AND ${toGuatemalaDateSql('p.payment_date')} <= ${asOfDateSql}
  ), 0)`

const CLIENT_UNPAID_SQL = (docAlias, asOfDateSql) => `
  (
    ${docAlias}.total_amount
    + ${getDocumentNetAdjustmentSql(docAlias)}
    - ${CLIENT_PAYMENTS_TO_DATE_SQL(docAlias, asOfDateSql)}
  )`

const extractClientAccountDateValue = fieldValue => {
  if (!fieldValue) return null

  const str = String(fieldValue)
  const colonIdx = str.indexOf(':')

  if (colonIdx > -1) {
    const datePart = str
      .substring(colonIdx + 1)
      .replace(/['"]/g, '')
      .trim()

    if (/^\d{4}-\d{2}-\d{2}$/.test(datePart)) return datePart
  }

  const trimmed = str.replace(/['"]/g, '').trim()

  return /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? trimmed : null
}

const buildClientAccountDateFilter = (dateExpr, { startDate, endDate, beforeDate } = {}) => {
  if (beforeDate) return ` AND ${dateExpr} < '${beforeDate}'`

  let filter = ''

  if (startDate) filter += ` AND ${dateExpr} >= '${startDate}'`
  if (endDate) filter += ` AND ${dateExpr} <= '${endDate}'`

  return filter
}

const buildClientAccountNotesSumSql = (stakeholderExpr, noteType, { startDate, endDate, beforeDate } = {}) => `
  COALESCE((
    SELECT SUM(COALESCE(note_items.note_amount, 0))
    FROM documents_debit_credit_notes dcn
    LEFT JOIN (
      SELECT
        dcn2.id,
        ${CLIENT_NOTE_AMOUNT_SQL} AS note_amount
      FROM documents_debit_credit_notes dcn2
      JOIN JSON_TABLE(
        JSON_EXTRACT(dcn2.request_detail, '$.invoice.items'),
        '$[*]' COLUMNS (value JSON PATH '$')
      ) AS jt
      WHERE dcn2.error = 'NO ERRORS'
      GROUP BY dcn2.id
    ) note_items ON note_items.id = dcn.id
    WHERE dcn.stakeholder_id = ${stakeholderExpr}
      AND dcn.error = 'NO ERRORS'
      AND dcn.document_type = '${noteType}'
      ${buildClientAccountDateFilter(toGuatemalaDateSql('dcn.created_at'), { startDate, endDate, beforeDate })}
  ), 0)`

const buildClientAccountInvoicesSumSql = (stakeholderExpr, { startDate, endDate, beforeDate } = {}) => `
  COALESCE((
    SELECT SUM(dc.total_amount)
    FROM documents dc
    WHERE dc.stakeholder_id = ${stakeholderExpr}
      AND ${CLIENT_APPROVED_INVOICE_SQL('dc')}
      ${buildClientAccountDateFilter(CLIENT_INVOICE_DATE_SQL('dc'), { startDate, endDate, beforeDate })}
  ), 0)`

const buildClientAccountPaymentsSumSql = (stakeholderExpr, { startDate, endDate, beforeDate } = {}) => `
  COALESCE((
    SELECT SUM(p.payment_amount)
    FROM payments p
    JOIN documents dc ON dc.id = p.document_id
    WHERE dc.stakeholder_id = ${stakeholderExpr}
      AND ${CLIENT_APPROVED_INVOICE_SQL('dc')}
      AND ${CLIENT_PAYMENT_ACTIVE_SQL('p')}
      ${buildClientAccountDateFilter(toGuatemalaDateSql('p.payment_date'), { startDate, endDate, beforeDate })}
  ), 0)`

const buildClientAccountNotesAgg = (asOfDateSql = 'CURDATE()') => `
  SELECT
    dcn.stakeholder_id,
    COALESCE(
      SUM(
        CASE
          WHEN dcn.document_type = 'DEBITO' THEN COALESCE(note_items.note_amount, 0)
          ELSE 0
        END
      ),
      0
    ) AS debit_total,
    COALESCE(
      SUM(
        CASE
          WHEN dcn.document_type = 'CREDITO' THEN COALESCE(note_items.note_amount, 0)
          ELSE 0
        END
      ),
      0
    ) AS credit_total
  FROM documents_debit_credit_notes dcn
  LEFT JOIN (
    SELECT
      dcn2.id,
      ${CLIENT_NOTE_AMOUNT_SQL} AS note_amount
    FROM documents_debit_credit_notes dcn2
    JOIN JSON_TABLE(
      JSON_EXTRACT(dcn2.request_detail, '$.invoice.items'),
      '$[*]' COLUMNS (value JSON PATH '$')
    ) AS jt
    WHERE dcn2.error = 'NO ERRORS'
    GROUP BY dcn2.id
  ) note_items ON note_items.id = dcn.id
  WHERE dcn.error = 'NO ERRORS'
    AND ${toGuatemalaDateSql('dcn.created_at')} <= ${asOfDateSql}
  GROUP BY dcn.stakeholder_id`

const buildClientAccountBalanceAgg = (asOfDateSql = 'CURDATE()') => `
  SELECT
    base.stakeholder_id,
    (
      COALESCE(base.invoice_total, 0)
      + COALESCE(notes.debit_total, 0)
      - COALESCE(notes.credit_total, 0)
      - COALESCE(base.paid_amount, 0)
    ) AS balance,
    COALESCE(base.aging_0_30, 0) AS aging_0_30,
    COALESCE(base.aging_31_60, 0) AS aging_31_60,
    COALESCE(base.aging_61_90, 0) AS aging_61_90,
    COALESCE(base.aging_over_90, 0) AS aging_over_90,
    COALESCE(base.max_days_overdue, 0) AS max_days_overdue,
    base.next_due_date,
    COALESCE(base.unpaid_invoices_count, 0) AS unpaid_invoices_count,
    COALESCE(base.paid_invoices_count, 0) AS paid_invoices_count,
    COALESCE(base.paid_amount, 0) AS total_paid
  FROM (
    SELECT
      aged.stakeholder_id,
      COALESCE(SUM(aged.invoice_total), 0) AS invoice_total,
      COALESCE(SUM(aged.paid_amount), 0) AS paid_amount,
      COALESCE(SUM(CASE WHEN aged.unpaid > 0.009 AND aged.age_days <= 30 THEN aged.unpaid ELSE 0 END), 0) AS aging_0_30,
      COALESCE(SUM(CASE WHEN aged.unpaid > 0.009 AND aged.age_days > 30 AND aged.age_days <= 60 THEN aged.unpaid ELSE 0 END), 0) AS aging_31_60,
      COALESCE(SUM(CASE WHEN aged.unpaid > 0.009 AND aged.age_days > 60 AND aged.age_days <= 90 THEN aged.unpaid ELSE 0 END), 0) AS aging_61_90,
      COALESCE(SUM(CASE WHEN aged.unpaid > 0.009 AND aged.age_days > 90 THEN aged.unpaid ELSE 0 END), 0) AS aging_over_90,
      COALESCE(MAX(CASE WHEN aged.unpaid > 0.009 THEN aged.age_days ELSE NULL END), 0) AS max_days_overdue,
      MIN(CASE WHEN aged.unpaid > 0.009 THEN aged.due_date ELSE NULL END) AS next_due_date,
      COUNT(CASE WHEN aged.unpaid > 0.009 THEN 1 ELSE NULL END) AS unpaid_invoices_count,
      COUNT(CASE WHEN aged.unpaid <= 0.009 THEN 1 ELSE NULL END) AS paid_invoices_count
    FROM (
      SELECT
        dc.stakeholder_id,
        dc.total_amount AS invoice_total,
        ${CLIENT_UNPAID_SQL('dc', asOfDateSql)} AS unpaid,
        ${CLIENT_PAYMENTS_TO_DATE_SQL('dc', asOfDateSql)} AS paid_amount,
        ${CLIENT_DUE_DATE_SQL('dc')} AS due_date,
        DATEDIFF(${asOfDateSql}, ${CLIENT_DUE_DATE_SQL('dc')}) AS age_days
      FROM documents dc
      WHERE ${CLIENT_APPROVED_INVOICE_SQL('dc')}
        AND ${CLIENT_INVOICE_DATE_SQL('dc')} <= ${asOfDateSql}
    ) aged
    GROUP BY aged.stakeholder_id
  ) base
  LEFT JOIN (${buildClientAccountNotesAgg(asOfDateSql)}) notes
    ON notes.stakeholder_id = base.stakeholder_id`

const buildClientAccountLastInvoiceAgg = () => `
  SELECT
    dc.stakeholder_id,
    MAX(${CLIENT_INVOICE_DATE_SQL('dc')}) AS last_invoice_date
  FROM documents dc
  WHERE ${CLIENT_APPROVED_INVOICE_SQL('dc')}
  GROUP BY dc.stakeholder_id`

const buildClientAccountLastNoteAgg = () => `
  SELECT
    dcn.stakeholder_id,
    MAX(${toGuatemalaDateSql('dcn.created_at')}) AS last_note_date
  FROM documents_debit_credit_notes dcn
  WHERE dcn.error = 'NO ERRORS'
  GROUP BY dcn.stakeholder_id`

const buildClientAccountLastPaymentAgg = () => `
  SELECT
    ranked.stakeholder_id,
    ranked.payment_date AS last_payment_date,
    ranked.document_number AS last_payment_document
  FROM (
    SELECT
      dc.stakeholder_id,
      ${toGuatemalaDateSql('p.payment_date')} AS payment_date,
      ${CLIENT_DOCUMENT_NUMBER_SQL('dc')} AS document_number,
      ROW_NUMBER() OVER (
        PARTITION BY dc.stakeholder_id
        ORDER BY ${toGuatemalaDateSql('p.payment_date')} DESC, p.id DESC
      ) AS rn
    FROM payments p
    JOIN documents dc ON dc.id = p.document_id
    WHERE ${CLIENT_APPROVED_INVOICE_SQL('dc')}
      AND ${CLIENT_PAYMENT_ACTIVE_SQL('p')}
  ) ranked
  WHERE ranked.rn = 1`

const parseClientAccountFilterFields = (fields = {}) => {
  const { $limit, $offset, debt_status, start_date, end_date, as_of_date, ...filterFields } = fields
  const asOfDate =
    extractClientAccountDateValue(as_of_date) ||
    extractClientAccountDateValue(end_date) ||
    null

  return {
    filterFields,
    debt_status: debt_status || '',
    startDate: extractClientAccountDateValue(start_date),
    endDate: extractClientAccountDateValue(end_date),
    asOfDate,
  }
}

const buildClientAccountInnerQuery = (filterFields = {}, asOfDate = null) => {
  const whereConditions = getWhereConditions({
    fields: filterFields,
    tableAlias: 's',
    hasPreviousConditions: false,
  })
  const asOfDateSql = asOfDate ? `'${asOfDate}'` : 'CURDATE()'

  return `
    SELECT
      s.id,
      s.stakeholder_type,
      CASE
        WHEN s.stakeholder_type = 'CLIENT_INDIVIDUAL' THEN 'CLIENTE INDIVIDUAL'
        WHEN s.stakeholder_type = 'CLIENT_COMPANY' THEN 'EMPRESA'
        ELSE 'NO DISPONIBLE'
      END AS stakeholder_type_spanish,
      s.status,
      s.name,
      s.address,
      s.nit,
      s.email,
      s.phone,
      s.alternative_phone,
      s.business_man,
      s.payments_man,
      CASE WHEN s.credit_limit IS NULL THEN 0 ELSE s.credit_limit END AS credit_limit,
      s.block_reason,
      s.created_at,
      s.created_by,
      s.updated_at,
      s.updated_by,
      COALESCE(bal.balance, 0) AS balance,
      COALESCE(bal.aging_0_30, 0) AS aging_0_30,
      COALESCE(bal.aging_31_60, 0) AS aging_31_60,
      COALESCE(bal.aging_61_90, 0) AS aging_61_90,
      COALESCE(bal.aging_over_90, 0) AS aging_over_90,
      COALESCE(bal.max_days_overdue, 0) AS max_days_overdue,
      bal.next_due_date,
      COALESCE(bal.unpaid_invoices_count, 0) AS unpaid_invoices_count,
      COALESCE(bal.paid_invoices_count, 0) AS paid_invoices_count,
      COALESCE(bal.total_paid, 0) AS total_paid,
      last_pay.last_payment_date,
      last_pay.last_payment_document,
      (
        SELECT MAX(movement_date)
        FROM (
          SELECT last_inv.last_invoice_date AS movement_date
          UNION ALL
          SELECT last_pay.last_payment_date
          UNION ALL
          SELECT last_note.last_note_date
        ) movement_dates
      ) AS last_movement_date,
      CASE
        WHEN COALESCE(bal.balance, 0) <= 0 THEN 'AL_DIA'
        WHEN COALESCE(bal.max_days_overdue, 0) > 90 THEN 'VENCIDO_90'
        WHEN COALESCE(bal.max_days_overdue, 0) > 0 THEN 'VENCIDO'
        ELSE 'POR_VENCER'
      END AS account_status
    FROM stakeholders s
    LEFT JOIN (${buildClientAccountBalanceAgg(asOfDateSql)}) bal ON bal.stakeholder_id = s.id
    LEFT JOIN (${buildClientAccountLastInvoiceAgg()}) last_inv ON last_inv.stakeholder_id = s.id
    LEFT JOIN (${buildClientAccountLastPaymentAgg()}) last_pay ON last_pay.stakeholder_id = s.id
    LEFT JOIN (${buildClientAccountLastNoteAgg()}) last_note ON last_note.stakeholder_id = s.id
    ${whereConditions}
  `
}

// account_status: AL_DIA (saldo <= 0) | POR_VENCER (saldo, ninguna factura vencida) | VENCIDO (1-90 dias de atraso) | VENCIDO_90 (mas de 90)
// Cada filtro devuelve un solo estado. WITH_DEBT es el unico que agrupa todo lo diferente a pagado.
const buildClientAccountDebtFilter = (debtStatus = '') => {
  if (debtStatus === 'WITH_DEBT') {
    return " AND clients.account_status <> 'AL_DIA'"
  }

  if (debtStatus === 'UNPAID' || debtStatus === 'PENDING' || debtStatus === 'POR_VENCER') {
    return " AND clients.account_status = 'POR_VENCER'"
  }

  if (debtStatus === 'OVERDUE' || debtStatus === 'VENCIDO') {
    return " AND clients.account_status = 'VENCIDO'"
  }

  if (debtStatus === 'WITH_DEBT_OVER_90' || debtStatus === 'VENCIDO_90') {
    return " AND clients.account_status = 'VENCIDO_90'"
  }

  if (
    debtStatus === 'WITHOUT_DEBT' ||
    debtStatus === 'AL_DIA' ||
    debtStatus === 'PAID'
  ) {
    return " AND clients.account_status = 'AL_DIA'"
  }

  return ''
}

const buildClientAccountFilteredClientsSubquery = (fields = {}) => {
  const { filterFields, debt_status, asOfDate } = parseClientAccountFilterFields(
    stripPaginationFields(fields)
  )
  const debtFilter = buildClientAccountDebtFilter(debt_status)

  return `
    SELECT
      clients.*
    FROM (
      ${buildClientAccountInnerQuery(filterFields, asOfDate)}
    ) clients
    WHERE 1=1 ${debtFilter}
  `
}

const buildClientAccountOuterQuery = (fields = {}, { withPagination = true } = {}) => {
  const paginationSQL = withPagination ? buildPaginationSQL(fields) : ''

  return `
    SELECT
      filtered_clients.*
    FROM (
      ${buildClientAccountFilteredClientsSubquery(fields)}
    ) filtered_clients
    ORDER BY
      CASE filtered_clients.account_status
        WHEN 'VENCIDO_90' THEN 1
        WHEN 'VENCIDO' THEN 2
        WHEN 'POR_VENCER' THEN 3
        ELSE 4
      END,
      filtered_clients.max_days_overdue DESC,
      filtered_clients.balance DESC,
      filtered_clients.name ASC
    ${paginationSQL}
  `
}

const getClientAccountState = (fields = {}) => `${buildClientAccountOuterQuery(fields)};`

const getClientAccountStateCount = (fields = {}) => `
  SELECT COUNT(*) AS total
  FROM (
    ${buildClientAccountOuterQuery(fields, { withPagination: false })}
  ) AS counted_clients;
`

const buildClientAccountInvoiceSummaryStakeholderWhere = (filterFields = {}) => {
  const allowedFields = {}

  if (filterFields.name) allowedFields.name = filterFields.name
  if (filterFields.nit) allowedFields.nit = filterFields.nit
  if (filterFields.stakeholder_type) {
    allowedFields.stakeholder_type = filterFields.stakeholder_type
  }
  if (filterFields.status) allowedFields.status = filterFields.status

  const rawWhereConditions = getWhereConditions({
    fields: allowedFields,
    tableAlias: 'd',
    hasPreviousConditions: true,
  })

  return rawWhereConditions
    .replace(/d\.nit/gi, 's.nit')
    .replace(/d\.name/gi, 's.name')
    .replace(/d\.stakeholder_type/gi, 's.stakeholder_type')
    .replace(/d\.status/gi, 's.status')
}

const getClientAccountStateSummary = (fields = {}) => {
  const { filterFields } = parseClientAccountFilterFields(
    stripPaginationFields(fields)
  )

  // Total facturado / anulado: misma base que Factura Electronica.
  // El filtro de deuda (Pendiente/Vencido/etc.) solo afecta la tarjeta de clientes,
  // no el universo de facturas.
  return `
  SELECT
    client_summary.total_clients,
    client_summary.clients_with_debt,
    client_summary.clients_without_debt,
    client_summary.clients_overdue,
    client_summary.clients_overdue_90,
    client_summary.total_balance,
    client_summary.total_debt_balance,
    client_summary.total_paid,
    client_summary.total_unpaid_invoices,
    client_summary.total_paid_invoices,
    client_summary.total_aging_0_30,
    client_summary.total_aging_31_60,
    client_summary.total_aging_61_90,
    client_summary.total_aging_over_90,
    invoice_summary.total_invoices_count,
    invoice_summary.total_invoiced_amount,
    invoice_summary.cancelled_invoices_count,
    invoice_summary.cancelled_invoices_amount,
    invoice_summary.approved_invoices_count,
    invoice_summary.approved_invoices_amount
  FROM (
    SELECT
      COUNT(*) AS total_clients,
      SUM(CASE WHEN filtered_clients.account_status <> 'AL_DIA' THEN 1 ELSE 0 END) AS clients_with_debt,
      SUM(CASE WHEN filtered_clients.account_status = 'AL_DIA' THEN 1 ELSE 0 END) AS clients_without_debt,
      SUM(CASE WHEN filtered_clients.account_status IN ('VENCIDO', 'VENCIDO_90') THEN 1 ELSE 0 END) AS clients_overdue,
      SUM(CASE WHEN filtered_clients.account_status = 'VENCIDO_90' THEN 1 ELSE 0 END) AS clients_overdue_90,
      SUM(filtered_clients.balance) AS total_balance,
      SUM(
        CASE
          WHEN filtered_clients.balance > 0 THEN filtered_clients.balance
          ELSE 0
        END
      ) AS total_debt_balance,
      SUM(filtered_clients.total_paid) AS total_paid,
      SUM(filtered_clients.unpaid_invoices_count) AS total_unpaid_invoices,
      SUM(filtered_clients.paid_invoices_count) AS total_paid_invoices,
      SUM(filtered_clients.aging_0_30) AS total_aging_0_30,
      SUM(filtered_clients.aging_31_60) AS total_aging_31_60,
      SUM(filtered_clients.aging_61_90) AS total_aging_61_90,
      SUM(filtered_clients.aging_over_90) AS total_aging_over_90
    FROM (
      ${buildClientAccountFilteredClientsSubquery(fields)}
    ) filtered_clients
  ) client_summary
  CROSS JOIN (
    SELECT
      COUNT(*) AS total_invoices_count,
      COALESCE(
        SUM(d.total_amount + ${getDocumentNetAdjustmentSql('d')}),
        0
      ) AS total_invoiced_amount,
      COALESCE(
        SUM(CASE WHEN d.status = '${types.documentsStatus.CANCELLED}' THEN 1 ELSE 0 END),
        0
      ) AS cancelled_invoices_count,
      COALESCE(
        SUM(
          CASE
            WHEN d.status = '${types.documentsStatus.CANCELLED}'
            THEN d.total_amount + ${getDocumentNetAdjustmentSql('d')}
            ELSE 0
          END
        ),
        0
      ) AS cancelled_invoices_amount,
      COALESCE(
        SUM(CASE WHEN d.status = '${types.documentsStatus.APPROVED}' THEN 1 ELSE 0 END),
        0
      ) AS approved_invoices_count,
      COALESCE(
        SUM(
          CASE
            WHEN d.status = '${types.documentsStatus.APPROVED}'
            THEN d.total_amount + ${getDocumentNetAdjustmentSql('d')}
            ELSE 0
          END
        ),
        0
      ) AS approved_invoices_amount
    FROM documents d
    LEFT JOIN stakeholders s ON s.id = d.stakeholder_id
    WHERE ${CLIENT_INVOICE_TYPES_SQL('d')}
    ${buildClientAccountInvoiceSummaryStakeholderWhere(filterFields)}
  ) invoice_summary;
`
}

const buildClientAccountInvoicesBase = (fields = {}) => {
  const stakeholderId = String(fields.stakeholder_id || '').replace(/[^\d]/g, '')
  const paymentStatus = String(fields.payment_status || 'ALL').toUpperCase()
  const documentNumber = String(fields.document_number || '')
    .trim()
    .replace(/'/g, "''")
  const asOfDate =
    extractClientAccountDateValue(fields.as_of_date) ||
    extractClientAccountDateValue(fields.end_date)
  const asOfDateSql = asOfDate ? `'${asOfDate}'` : 'CURDATE()'

  let paymentFilter = ''
  if (paymentStatus === 'UNPAID' || paymentStatus === 'PENDING') {
    paymentFilter = 'WHERE invoice.unpaid_amount > 0.009'
  } else if (paymentStatus === 'PAID') {
    paymentFilter = 'WHERE invoice.unpaid_amount <= 0.009'
  }

  const documentNumberFilter = documentNumber
    ? `${
        paymentFilter ? 'AND' : 'WHERE'
      } CONVERT(invoice.document_number USING utf8mb4) COLLATE utf8mb4_unicode_ci LIKE CONCAT('%', CONVERT('${documentNumber}' USING utf8mb4) COLLATE utf8mb4_unicode_ci, '%')`
    : ''

  const fromSql = `
    FROM (
      SELECT
        dc.id,
        dc.related_internal_document_id,
        CASE
          WHEN dc.document_number IS NOT NULL AND dc.document_number <> ''
            THEN CONVERT(dc.document_number USING utf8mb4) COLLATE utf8mb4_unicode_ci
          WHEN dc.related_internal_document_id IS NOT NULL
            THEN CONVERT(CAST(dc.related_internal_document_id AS CHAR) USING utf8mb4) COLLATE utf8mb4_unicode_ci
          ELSE CONVERT('Factura del sistema' USING utf8mb4) COLLATE utf8mb4_unicode_ci
        END AS document_number,
        dc.serie,
        ${CLIENT_INVOICE_DATE_SQL('dc')} AS document_date,
        ${CLIENT_DUE_DATE_SQL('dc')} AS due_date,
        (dc.total_amount + ${getDocumentNetAdjustmentSql('dc')}) AS total_amount,
        ${CLIENT_PAYMENTS_TO_DATE_SQL('dc', asOfDateSql)} AS paid_amount,
        ${CLIENT_UNPAID_SQL('dc', asOfDateSql)} AS unpaid_amount,
        (
          SELECT MAX(${toGuatemalaDateSql('p.payment_date')})
          FROM payments p
          WHERE p.document_id = dc.id
            AND ${CLIENT_PAYMENT_ACTIVE_SQL('p')}
            AND ${toGuatemalaDateSql('p.payment_date')} <= ${asOfDateSql}
        ) AS last_payment_date,
        DATEDIFF(${asOfDateSql}, ${CLIENT_DUE_DATE_SQL('dc')}) AS days_overdue
      FROM documents dc
      WHERE dc.stakeholder_id = ${stakeholderId || 0}
        AND ${CLIENT_APPROVED_INVOICE_SQL('dc')}
        AND ${CLIENT_INVOICE_DATE_SQL('dc')} <= ${asOfDateSql}
    ) invoice
    ${paymentFilter}
    ${documentNumberFilter}
  `

  return { stakeholderId, fromSql }
}

const getClientAccountInvoices = (fields = {}) => {
  const { stakeholderId, fromSql } = buildClientAccountInvoicesBase(fields)
  const paginationSQL = buildPaginationSQL(fields)

  if (!stakeholderId) {
    return `
      SELECT
        NULL AS id,
        NULL AS related_internal_document_id,
        NULL AS document_number,
        NULL AS serie,
        NULL AS document_date,
        NULL AS due_date,
        0 AS total_amount,
        0 AS paid_amount,
        0 AS unpaid_amount,
        NULL AS last_payment_date,
        0 AS days_overdue,
        'UNPAID' AS payment_status
      WHERE 1 = 0;`
  }

  return `
    SELECT
      invoice.id,
      invoice.related_internal_document_id,
      invoice.document_number,
      invoice.serie,
      invoice.document_date,
      invoice.due_date,
      invoice.total_amount,
      invoice.paid_amount,
      invoice.unpaid_amount,
      invoice.last_payment_date,
      invoice.days_overdue,
      CASE
        WHEN invoice.unpaid_amount > 0.009 THEN 'UNPAID'
        ELSE 'PAID'
      END AS payment_status
    ${fromSql}
    ORDER BY
      CASE WHEN invoice.unpaid_amount > 0.009 THEN 0 ELSE 1 END,
      invoice.due_date ASC,
      invoice.id ASC
    ${paginationSQL};
  `
}

const getClientAccountInvoicesCount = (fields = {}) => {
  const { stakeholderId, fromSql } = buildClientAccountInvoicesBase(fields)

  if (!stakeholderId) {
    return `
      SELECT
        0 AS total,
        0 AS total_unpaid_amount,
        0 AS total_paid_amount;`
  }

  return `
    SELECT
      COUNT(*) AS total,
      COALESCE(SUM(invoice.unpaid_amount), 0) AS total_unpaid_amount,
      COALESCE(SUM(invoice.paid_amount), 0) AS total_paid_amount
    ${fromSql};
  `
}

const getClientAccountUnpaidInvoices = (fields = {}) =>
  getClientAccountInvoices({ ...fields, payment_status: 'UNPAID' })

const getClientAccountInvoicePayments = (fields = {}) => {
  const stakeholderId = String(fields.stakeholder_id || '').replace(/[^\d]/g, '')
  const rawIds = fields.document_ids || fields.document_id || ''
  const documentIds = String(rawIds)
    .split(',')
    .map(id => id.replace(/[^\d]/g, ''))
    .filter(Boolean)

  if (!stakeholderId) {
    return `
      SELECT
        NULL AS payment_id,
        NULL AS document_id,
        NULL AS document_number,
        NULL AS payment_date,
        0 AS payment_amount,
        NULL AS reference
      WHERE 1 = 0;`
  }

  const documentFilter = documentIds.length
    ? `AND dc.id IN (${documentIds.join(', ')})`
    : ''

  return `
    SELECT
      p.id AS payment_id,
      dc.id AS document_id,
      ${CLIENT_DOCUMENT_NUMBER_SQL('dc')} AS document_number,
      p.payment_date,
      p.payment_amount,
      CASE
        WHEN p.related_external_document IS NOT NULL AND p.related_external_document <> ''
          THEN CAST(p.related_external_document AS CHAR)
        WHEN p.description IS NOT NULL AND p.description <> ''
          THEN CAST(p.description AS CHAR)
        WHEN p.payment_method IS NOT NULL
          THEN CAST(p.payment_method AS CHAR)
        ELSE ''
      END AS reference
    FROM payments p
    JOIN documents dc ON dc.id = p.document_id
    WHERE dc.stakeholder_id = ${stakeholderId}
      AND ${CLIENT_APPROVED_INVOICE_SQL('dc')}
      AND ${CLIENT_PAYMENT_ACTIVE_SQL('p')}
      ${documentFilter}
    ORDER BY ${toGuatemalaDateSql('p.payment_date')} ASC, p.id ASC;
  `
}

const getClientAccountOpeningBalance = (fields = {}) => {
  const stakeholderId = String(fields.stakeholder_id || '').replace(/[^\d]/g, '')
  const startDate = extractClientAccountDateValue(fields.start_date)

  if (!stakeholderId || !startDate) {
    return 'SELECT 0 AS opening_balance;'
  }

  const beforeFilter = { beforeDate: startDate }

  return `
    SELECT
      (
        ${buildClientAccountInvoicesSumSql(stakeholderId, beforeFilter)}
        + ${buildClientAccountNotesSumSql(stakeholderId, 'DEBITO', beforeFilter)}
        - ${buildClientAccountNotesSumSql(stakeholderId, 'CREDITO', beforeFilter)}
        - ${buildClientAccountPaymentsSumSql(stakeholderId, beforeFilter)}
      ) AS opening_balance;
  `
}

const getClientAccountInvoiceMovements = (fields = {}) => {
  const stakeholderId = String(fields.stakeholder_id || '').replace(/[^\d]/g, '')
  const startDate = extractClientAccountDateValue(fields.start_date)
  const endDate = extractClientAccountDateValue(fields.end_date)
  const periodFilter = { startDate, endDate }

  if (!stakeholderId) {
    return `
      SELECT
        NULL AS movement_date,
        'INVOICE' AS movement_type,
        NULL AS document_number,
        NULL AS reference,
        0 AS charge_amount,
        0 AS credit_amount,
        0 AS sort_id
      WHERE 1 = 0;`
  }

  return `
    SELECT
      ${CLIENT_INVOICE_DATE_SQL('dc')} AS movement_date,
      CASE
        WHEN ${CLIENT_IS_SYSTEM_INVOICE_SQL('dc')} THEN 'MANUAL_INVOICE'
        ELSE 'INVOICE'
      END AS movement_type,
      ${CLIENT_DOCUMENT_NUMBER_SQL('dc')} AS document_number,
      CASE
        WHEN dc.serie IS NOT NULL AND dc.serie <> '' THEN CAST(dc.serie AS CHAR)
        WHEN dc.description IS NOT NULL AND dc.description <> '' THEN CAST(dc.description AS CHAR)
        ELSE ''
      END AS reference,
      dc.total_amount AS charge_amount,
      0 AS credit_amount,
      dc.id AS sort_id
    FROM documents dc
    WHERE dc.stakeholder_id = ${stakeholderId}
      AND ${CLIENT_APPROVED_INVOICE_SQL('dc')}
      ${buildClientAccountDateFilter(CLIENT_INVOICE_DATE_SQL('dc'), periodFilter)}
    ORDER BY ${CLIENT_INVOICE_DATE_SQL('dc')} ASC, dc.id ASC;
  `
}

const getClientAccountPaymentMovements = (fields = {}) => {
  const stakeholderId = String(fields.stakeholder_id || '').replace(/[^\d]/g, '')
  const startDate = extractClientAccountDateValue(fields.start_date)
  const endDate = extractClientAccountDateValue(fields.end_date)
  const periodFilter = { startDate, endDate }

  if (!stakeholderId) {
    return `
      SELECT
        NULL AS movement_date,
        'PAYMENT' AS movement_type,
        NULL AS document_number,
        NULL AS reference,
        0 AS charge_amount,
        0 AS credit_amount,
        0 AS sort_id
      WHERE 1 = 0;`
  }

  return `
    SELECT
      p.payment_date AS movement_date,
      'PAYMENT' AS movement_type,
      ${CLIENT_DOCUMENT_NUMBER_SQL('dc')} AS document_number,
      CASE
        WHEN p.related_external_document IS NOT NULL AND p.related_external_document <> ''
          THEN CAST(p.related_external_document AS CHAR)
        WHEN p.description IS NOT NULL AND p.description <> ''
          THEN CAST(p.description AS CHAR)
        WHEN p.payment_method IS NOT NULL
          THEN CAST(p.payment_method AS CHAR)
        ELSE ''
      END AS reference,
      0 AS charge_amount,
      p.payment_amount AS credit_amount,
      p.id AS sort_id
    FROM payments p
    JOIN documents dc ON dc.id = p.document_id
    WHERE dc.stakeholder_id = ${stakeholderId}
      AND ${CLIENT_APPROVED_INVOICE_SQL('dc')}
      AND ${CLIENT_PAYMENT_ACTIVE_SQL('p')}
      ${buildClientAccountDateFilter(toGuatemalaDateSql('p.payment_date'), periodFilter)}
    ORDER BY ${toGuatemalaDateSql('p.payment_date')} ASC, p.id ASC;
  `
}

const getClientAccountNoteMovements = (fields = {}) => {
  const stakeholderId = String(fields.stakeholder_id || '').replace(/[^\d]/g, '')
  const startDate = extractClientAccountDateValue(fields.start_date)
  const endDate = extractClientAccountDateValue(fields.end_date)
  const periodFilter = { startDate, endDate }

  if (!stakeholderId) {
    return `
      SELECT
        NULL AS movement_date,
        'CREDIT_NOTE' AS movement_type,
        NULL AS document_number,
        NULL AS reference,
        0 AS charge_amount,
        0 AS credit_amount,
        0 AS sort_id
      WHERE 1 = 0;`
  }

  return `
    SELECT
      dcn.created_at AS movement_date,
      CASE
        WHEN dcn.document_type = 'CREDITO' THEN 'CREDIT_NOTE'
        ELSE 'DEBIT_NOTE'
      END AS movement_type,
      CASE
        WHEN dcn.document_number IS NOT NULL AND dcn.document_number <> '' THEN dcn.document_number
        ELSE CAST(dcn.id AS CHAR)
      END AS document_number,
      CASE
        WHEN dcn.related_bill_document_number IS NOT NULL AND dcn.related_bill_document_number <> ''
          THEN CAST(dcn.related_bill_document_number AS CHAR)
        WHEN dcn.serie IS NOT NULL AND dcn.serie <> ''
          THEN CAST(dcn.serie AS CHAR)
        WHEN dcn.adjustment_reason IS NOT NULL AND dcn.adjustment_reason <> ''
          THEN CAST(dcn.adjustment_reason AS CHAR)
        ELSE ''
      END AS reference,
      CASE
        WHEN dcn.document_type = 'DEBITO' THEN COALESCE(note_items.note_amount, 0)
        ELSE 0
      END AS charge_amount,
      CASE
        WHEN dcn.document_type = 'CREDITO' THEN COALESCE(note_items.note_amount, 0)
        ELSE 0
      END AS credit_amount,
      dcn.id AS sort_id
    FROM documents_debit_credit_notes dcn
    LEFT JOIN (
      SELECT
        dcn2.id,
        ${CLIENT_NOTE_AMOUNT_SQL} AS note_amount
      FROM documents_debit_credit_notes dcn2
      JOIN JSON_TABLE(
        JSON_EXTRACT(dcn2.request_detail, '$.invoice.items'),
        '$[*]' COLUMNS (value JSON PATH '$')
      ) AS jt
      WHERE dcn2.error = 'NO ERRORS'
      GROUP BY dcn2.id
    ) note_items ON note_items.id = dcn.id
    WHERE dcn.stakeholder_id = ${stakeholderId}
      AND dcn.error = 'NO ERRORS'
      ${buildClientAccountDateFilter(toGuatemalaDateSql('dcn.created_at'), periodFilter)}
    ORDER BY ${toGuatemalaDateSql('dcn.created_at')} ASC, dcn.id ASC;
  `
}

const getClientAccountMovements = fields => getClientAccountInvoiceMovements(fields)

const getAccountsReceivable = (fields = {}) => {
  const rawWhereConditions = getWhereConditions({ fields, tableAlias: 'd' })
  const whereConditions = rawWhereConditions
    .replace(/d.stakeholder_type/i, 's.stakeholder_type')
    .replace(/d.stakeholder_name/i, 's.name')
    .replace(/d\.start_date/gi, toFactDateSql('d.fact_date'))
    .replace(/d\.end_date/gi, toFactDateSql('d.fact_date'))
    .replace(/d\.credit_due_from/gi, toGuatemalaDateSql('d.credit_due_date'))
    .replace(/d\.credit_due_to/gi, toGuatemalaDateSql('d.credit_due_date'))
    .replace(/d\.credit_paid_from/gi, toGuatemalaDateSql('d.credit_paid_date'))
    .replace(/d\.credit_paid_to/gi, toGuatemalaDateSql('d.credit_paid_date'))

  return `
    SELECT
      d.id,
      d.document_type,
      d.uuid,
      d.document_number,
      d.stakeholder_id,
      s.stakeholder_type,
      s.name AS stakeholder_name,
      d.status,
      d.comments,
      d.description,
      d.subtotal_amount,
      d.total_amount,
      d.credit_status,
      d.paid_credit_amount,
      (d.total_amount - d.paid_credit_amount) AS unpaid_credit_amount,
      d.fact_date AS document_date,
      d.credit_due_date,
      d.credit_paid_date
    FROM documents d
    LEFT JOIN stakeholders s ON s.id = d.stakeholder_id
    WHERE (
      (
        d.document_type = '${types.documentsTypes.SELL_INVOICE}' OR
        d.document_type = '${types.documentsTypes.RENT_INVOICE}'
      ) OR (
        (
          d.document_type = '${types.documentsTypes.SELL_PRE_INVOICE}' OR
          d.document_type = '${types.documentsTypes.RENT_PRE_INVOICE}'
        )
        AND d.related_internal_document_id IS NULL
      )
    ) AND d.status <> '${types.documentsStatus.CANCELLED}'
    AND d.credit_status IS NOT NULL ${whereConditions}
    ORDER BY d.id DESC
  `
}

const buildSalesReportQueryParts = (
  fields = {},
  { docAlias = 'd', stakeholderAlias = 's', userAlias = 'u' } = {}
) => {
  const filterFields = stripPaginationFields(fields)
  const rawWhereConditions = getWhereConditions({ fields: filterFields, tableAlias: docAlias })
  const includeInvoices = new RegExp(`${docAlias}\\.document_type = 'INVOICES'`, 'i').test(
    rawWhereConditions
  )
  const includePreInvoices = new RegExp(`${docAlias}\\.document_type = 'PRE_INVOICE'`, 'i').test(
    rawWhereConditions
  )
  const includeBoth = !includeInvoices && !includePreInvoices

  const whereConditions = rawWhereConditions
    .replace(new RegExp(`${docAlias}\\.client_id`, 'gi'), `${stakeholderAlias}.id`)
    .replace(new RegExp(`AND ${docAlias}\\.document_type = 'INVOICES'`, 'gi'), '')
    .replace(new RegExp(`AND ${docAlias}\\.document_type = 'PRE_INVOICE'`, 'gi'), '')
    .replace(new RegExp(`${docAlias}\\.start_date`, 'gi'), toFactDateSql(`${docAlias}.fact_date`))
    .replace(new RegExp(`${docAlias}\\.end_date`, 'gi'), toFactDateSql(`${docAlias}.fact_date`))
    .replace(new RegExp(`${docAlias}\\.seller_id`, 'gi'), `${userAlias}.id`)

  const invoicesWhereConditions =
    includeInvoices || includeBoth
      ? `(
      ${docAlias}.document_type = '${types.documentsTypes.SELL_INVOICE}' OR
      ${docAlias}.document_type = '${types.documentsTypes.RENT_INVOICE}'
    )`
      : ''

  const preInvoicesWhereConditions =
    includePreInvoices || includeBoth
      ? `(${docAlias}.document_type = '${types.documentsTypes.RENT_PRE_INVOICE}' AND ${docAlias}.related_internal_document_id IS NULL)`
      : ''

  const documentTypeWhereOperator =
    (includeInvoices && includePreInvoices) || includeBoth ? 'OR' : ''

  const documentTypeWhere = `${includeBoth ? '(' : ''}
        ${invoicesWhereConditions} ${documentTypeWhereOperator} ${preInvoicesWhereConditions}
      ${includeBoth ? ')' : ''}`

  return { documentTypeWhere, whereConditions }
}

const buildSalesReportWhereSql = (fields = {}, aliases = {}) => {
  const { documentTypeWhere, whereConditions } = buildSalesReportQueryParts(fields, aliases)
  const { docAlias = 'd' } = aliases

  return `
    ${documentTypeWhere} AND
    ${docAlias}.status = '${types.documentsStatus.APPROVED}'
    ${whereConditions}
  `
}

const getSales = (fields = {}) => {
  const paginationSQL = buildPaginationSQL(fields)
  const paginationSubquery = paginationSQL
    ? `
    AND d.id IN (
      SELECT id FROM (
        SELECT d2.id
        FROM documents d2
        LEFT JOIN stakeholders s2 ON s2.id = d2.stakeholder_id
        LEFT JOIN users u2 ON u2.id = d2.created_by
        WHERE ${buildSalesReportWhereSql(fields, { docAlias: 'd2', stakeholderAlias: 's2', userAlias: 'u2' })}
        ORDER BY d2.id DESC
        ${paginationSQL}
      ) AS paginated_sales
    )`
    : ''

  return `
    SELECT
      d.id,
      d.dispatched_by,
      d.received_by,
      d.related_internal_document_id,
      d.credit_status,
      CASE
        WHEN d.credit_status = 'UNPAID' THEN 'PAGO PENDIENTE'
        WHEN d.credit_status = 'PAID' THEN 'PAGADO'
        WHEN d.credit_status = 'DEFAULT' THEN 'EN MORA'
        ELSE 'NO DISPONIBLE' END as credit_status_spanish,
      d.document_number,
      CASE
      WHEN d.document_number IS NULL THEN 'Factura Sistema'
      ELSE d.document_number END AS document_number_report,
      d.document_type,
      CASE
        WHEN d.document_type = 'SELL_INVOICE' THEN 'Factura manual'
        WHEN d.document_type = 'RENT_INVOICE' THEN 'Nota de servicio'
        ELSE 'NO DISPONIBLE' END as document_type_spanish,
      d.stakeholder_id,
      s.stakeholder_type,
      s.name AS stakeholder_name,
      s.business_man,
      s.payments_man,
      s.address,
      s.phone,
      s.email,
      d.payment_method,
      CASE
        WHEN d.payment_method = 'CASH' THEN 'EFECTIVO'
        WHEN d.payment_method = 'CARD' THEN 'CREDITO'
        WHEN d.payment_method = 'CHECK' THEN 'CHEQUE'
        WHEN d.payment_method = 'DEPOSIT' THEN 'DEPOSITO'
        WHEN d.payment_method = 'TRANSFER' THEN 'TRANSFERENCIA'
            ELSE 'NO DISPONIBLE' END as payment_method_spanish,
      d.status,
      d.sales_commission_amount,
      d.total_amount,
      d.uuid,
      d.paid_credit_amount,
      d.fact_date AS created_at,
      u.sales_commission,
      d.created_by AS seller_id,
      u.full_name AS seller_name
    FROM documents d
    LEFT JOIN stakeholders s ON s.id = d.stakeholder_id
    LEFT JOIN users u ON u.id = d.created_by
    WHERE ${buildSalesReportWhereSql(fields)}
    ${paginationSubquery}
    ORDER BY d.id DESC
  `
}

const getSalesCount = (fields = {}) => `
  SELECT COUNT(*) AS total
  FROM documents d
  LEFT JOIN stakeholders s ON s.id = d.stakeholder_id
  LEFT JOIN users u ON u.id = d.created_by
  WHERE ${buildSalesReportWhereSql(stripPaginationFields(fields))};
`

const getSalesSummaryRows = (fields = {}) => `
  SELECT
    d.uuid,
    d.total_amount
  FROM documents d
  LEFT JOIN stakeholders s ON s.id = d.stakeholder_id
  LEFT JOIN users u ON u.id = d.created_by
  WHERE ${buildSalesReportWhereSql(stripPaginationFields(fields))};
`

const getSalesSummary = (fields = {}) => `
  SELECT
    COUNT(*) AS total_documents,
    COALESCE(SUM(d.total_amount + ${getDocumentNetAdjustmentSql('d')}), 0) AS total_billed
  FROM documents d
  LEFT JOIN stakeholders s ON s.id = d.stakeholder_id
  LEFT JOIN users u ON u.id = d.created_by
  WHERE ${buildSalesReportWhereSql(stripPaginationFields(fields))};
`

const buildInventoryWhere = (fields = {}, productAlias = 'p') => {
  const filterFields = stripPaginationFields(fields)
  const rawWhereConditions = getWhereConditions({ fields: filterFields, tableAlias: productAlias })

  return rawWhereConditions
    .replace(new RegExp(`${productAlias}\\.start_date`, 'gi'), toGuatemalaDateSql('imd.created_at'))
    .replace(new RegExp(`${productAlias}\\.end_date`, 'gi'), toGuatemalaDateSql('imd.created_at'))
    .replace(new RegExp(`${productAlias}\\.product_id`, 'gi'), `${productAlias}.id`)
}

const buildInventoryDistinctProductsSubquery = (fields = {}, { withPagination = false } = {}) => {
  const whereConditions = buildInventoryWhere(stripPaginationFields(fields), 'p2')
  const paginationSQL = withPagination ? buildPaginationSQL(fields) : ''

  return `
    SELECT id FROM (
      SELECT DISTINCT p2.id
      FROM products p2
      LEFT JOIN inventory_movements im ON im.product_id = p2.id
      LEFT JOIN inventory_movements_details imd ON imd.inventory_movement_id = im.id
      WHERE im.status = '${types.inventoryMovementsStatus.APPROVED}'
      ${whereConditions}
      ORDER BY p2.id
      ${paginationSQL}
    ) AS paginated_products
  `
}

const getInventory = (fields = {}) => {
  const whereConditions = buildInventoryWhere(fields, 'p')
  const paginationSQL = buildPaginationSQL(fields)
  const paginationSubquery = paginationSQL
    ? `
      AND p.id IN (${buildInventoryDistinctProductsSubquery(fields, { withPagination: true })})
    `
    : ''

  return `
      SELECT
        p.id AS product_id,
        p.description,
        p.code,
        p.serial_number,
        p.product_type,
        CASE
      WHEN p.product_category = 'EQUIPMENT' THEN 'EQUIPO'
      WHEN p.product_category = 'SERVICE' THEN 'SERVICIO'
      WHEN p.product_category = 'PART' THEN 'REPUESTO'
      ELSE 'NO DISPONIBLE' END as product_category_spanish,
        p.product_category,
        p.status,
        p.stock,
        p.inventory_unit_value,
        p.inventory_total_value,
        im.id AS inventory_movements__inventory_movement_id,
        im.product_id AS inventory_movements__product_id,
        im.quantity AS inventory_movements__quantity,
        im.unit_cost AS inventory_movements__unit_cost,
        im.total_cost AS inventory_movements__total_cost,
        im.inventory_quantity AS inventory_movements__inventory_quantity,
        im.inventory_unit_cost AS inventory_movements__inventory_unit_cost,
        im.inventory_total_cost AS inventory_movements__inventory_total_cost,
        o.operation_type AS inventory_movements__operation_type,
        im.movement_type AS inventory_movements__movement_type,
        im.status AS inventory_movements__status,
        imd.created_at AS inventory_movements__created_at,
        u.full_name AS inventory_movements__creator_name,
        imd.inventory_movement_id AS inventory_movements_details__inventory_movement_id,
        im.product_id AS inventory_movements_details__product_id,
        imd.quantity AS inventory_movements_details__quantity,
        imd.storage_location AS inventory_movements_details__storage_location,
        imd.comments AS inventory_movements_details__comments,
        imd.created_at AS inventory_movements_details__created_at,
        imd.created_by AS inventory_movements_details__creator_id,
        u.full_name AS inventory_movements_details__creator_name
      FROM products p
      LEFT JOIN inventory_movements im ON im.product_id = p.id
      LEFT JOIN operations o ON o.id = im.operation_id
      LEFT JOIN inventory_movements_details imd ON imd.inventory_movement_id = im.id
      LEFT JOIN users u ON u.id = imd.created_by
      WHERE (
        im.status = '${types.inventoryMovementsStatus.APPROVED}'
      ) ${whereConditions}
      ${paginationSubquery}
      ORDER BY im.operation_id, im.id
    `
}

const getInventoryCount = (fields = {}) => `
  SELECT COUNT(*) AS total
  FROM (
    SELECT DISTINCT p.id
    FROM products p
    LEFT JOIN inventory_movements im ON im.product_id = p.id
    LEFT JOIN inventory_movements_details imd ON imd.inventory_movement_id = im.id
    WHERE im.status = '${types.inventoryMovementsStatus.APPROVED}'
    ${buildInventoryWhere(stripPaginationFields(fields), 'p')}
  ) AS counted_products;
`

const getInventorySummary = (fields = {}) => `
  SELECT
    COALESCE(SUM(p.stock), 0) AS total_items,
    COALESCE(SUM(p.inventory_total_value), 0) AS total_value
  FROM products p
  WHERE p.id IN (
    SELECT DISTINCT p2.id
    FROM products p2
    LEFT JOIN inventory_movements im ON im.product_id = p2.id
    LEFT JOIN inventory_movements_details imd ON imd.inventory_movement_id = im.id
    WHERE im.status = '${types.inventoryMovementsStatus.APPROVED}'
    ${buildInventoryWhere(stripPaginationFields(fields), 'p2')}
  );
`

const getInvoiceTypeCondition = (alias = 'd') =>
  `(${alias}.document_type = '${types.documentsTypes.SELL_INVOICE}' OR ${alias}.document_type = '${types.documentsTypes.RENT_INVOICE}')`

// payment_status (PAID | UNPAID) no es columna: se filtra por saldo = total ajustado (notas credito/debito) - pagos.
// Mismo criterio del estado de cuenta de clientes; solo aplica a facturas aprobadas.
const buildInvoicePaymentStatusWhere = (paymentStatus, docAlias) => {
  const status = String(paymentStatus || '').toUpperCase()

  if (status !== 'PAID' && status !== 'UNPAID') return ''

  return ` AND ${docAlias}.status = '${types.documentsStatus.APPROVED}' AND (
    ${docAlias}.total_amount
    + ${getDocumentNetAdjustmentSql(docAlias)}
    - ${CLIENT_PAYMENTS_TO_DATE_SQL(docAlias, 'CURDATE()')}
  ) ${status === 'PAID' ? '<=' : '>'} 0.009`
}

const buildInvoiceReportWhere = (fields = {}, docAlias = 'd', stakeholderAlias = 's') => {
  const { payment_status, ...filterFields } = stripPaginationFields(fields)
  const rawWhereConditions = getWhereConditions({ fields: filterFields, tableAlias: docAlias })

  const mappedConditions = rawWhereConditions
    .replace(new RegExp(`${docAlias}\\.nit`, 'gi'), `${stakeholderAlias}.nit`)
    .replace(new RegExp(`${docAlias}\\.name`, 'gi'), `${stakeholderAlias}.name`)
    .replace(
      new RegExp(`${docAlias}\\.stakeholder_type`, 'gi'),
      `${stakeholderAlias}.stakeholder_type`
    )
    .replace(
      new RegExp(`${docAlias}\\.updated_from`, 'gi'),
      toFactDateSql(`${docAlias}.fact_date`)
    )
    .replace(
      new RegExp(`${docAlias}\\.updated_to`, 'gi'),
      toFactDateSql(`${docAlias}.fact_date`)
    )
    .replace(
      new RegExp(`${docAlias}\\.start_date`, 'gi'),
      toFactDateSql(`${docAlias}.fact_date`)
    )
    .replace(
      new RegExp(`${docAlias}\\.end_date`, 'gi'),
      toFactDateSql(`${docAlias}.fact_date`)
    )

  // La condicion de pago va despues de los reemplazos para que no los afecten
  return `${mappedConditions}${buildInvoicePaymentStatusWhere(payment_status, docAlias)}`
}

const getInvoice = (fields = {}) => {
  const whereConditions = buildInvoiceReportWhere(fields)
  const paginationSQL = buildPaginationSQL(fields)
  const paginationSubquery = paginationSQL
    ? `
    AND d.id IN (
      SELECT id FROM (
        SELECT d2.id
        FROM documents d2
        LEFT JOIN stakeholders s2 ON s2.id = d2.stakeholder_id
        WHERE ${getInvoiceTypeCondition('d2')} ${buildInvoiceReportWhere(fields, 'd2', 's2')}
        ORDER BY d2.id DESC
        ${paginationSQL}
      ) AS paginated_documents
    )`
    : ''

  return `
    SELECT
      d.id,
      d.serie,
      d.document_number,
      d.related_internal_document_id,
      d.uuid,
      d.fact_date,
      d.document_type,
      d.stakeholder_id,
      s.name AS stakeholder_name,
      s.nit AS stakeholder_nit,
      s.stakeholder_type AS stakeholder_type,
      s.email AS stakeholder_email,
      s.phone AS stakeholder_phone,
      s.address AS stakeholder_address,
      d.operation_id,
      d.status,
      CASE
        WHEN d.status = 'APPROVED' THEN 'APROBADO'
        WHEN d.status = 'CANCELLED' THEN 'ANULADO'
        WHEN d.status = 'SAT_FAILED' THEN 'FALLO SAT'
            ELSE 'NO DISPONIBLE' END as status_spanish,
      d.cancel_reason,
      d.description,
      d.subtotal_amount AS subtotal,
      d.total_discount_amount AS discount,
      d.total_tax_amount AS total_tax,
      d.total_amount AS total,
      d.payment_method,
      CASE
        WHEN d.payment_method = 'CASH' THEN 'EFECTIVO'
        WHEN d.payment_method = 'CARD' THEN 'CREDITO'
            ELSE 'NO DISPONIBLE' END as payment_method_spanish,
      d.credit_days,
      d.credit_status,
      ${CLIENT_PAYMENTS_TO_DATE_SQL('d', 'CURDATE()')} AS paid_amount,
      d.created_by,
      d.updated_at,
      d.updated_by,
      proj.id AS project_id,
      proj.name AS project_name,
      prod.id AS products__id,
      prod.product_type AS products__product_type,
      prod.status AS products__status,
      prod.code AS products__code,
      prod.serial_number AS products__serial_number,
      prod.description AS products__description,
      prod.image_url AS products__image_url,
      prod.created_at AS products__created_at,
      prod.created_by AS products__created_by,
      dp.service_type AS products__service_type,
      dp.document_id AS products__document_id,
      dp.product_price AS products__product_price,
      dp.product_quantity AS products__product_quantity,
      dp.tax_fee AS products__tax_fee,
      dp.unit_tax_amount AS products__unit_tax_amount,
      dp.discount_percentage AS products__discount_percentage,
      dp.unit_discount_amount AS products__unit_discount_amount,
      dp.parent_product_id AS products__parent_product_id
    FROM documents d
    LEFT JOIN projects proj ON proj.id = d.project_id
    LEFT JOIN stakeholders s ON s.id = d.stakeholder_id
    LEFT JOIN documents_products dp ON dp.document_id = d.id
    LEFT JOIN products prod ON prod.id = dp.product_id
    WHERE ${getInvoiceTypeCondition('d')} ${whereConditions}
    ${paginationSubquery}
    ORDER BY d.id DESC
  `
}

const getInvoiceCount = (fields = {}) => `
  SELECT COUNT(*) AS total
  FROM documents d
  LEFT JOIN stakeholders s ON s.id = d.stakeholder_id
  WHERE ${getInvoiceTypeCondition('d')} ${buildInvoiceReportWhere(stripPaginationFields(fields))};
`

const getInvoiceSummaryRows = (fields = {}) => `
  SELECT
    d.uuid,
    d.status,
    d.total_amount
  FROM documents d
  LEFT JOIN stakeholders s ON s.id = d.stakeholder_id
  WHERE ${getInvoiceTypeCondition('d')} ${buildInvoiceReportWhere(stripPaginationFields(fields))};
`

const getInvoiceSummary = (fields = {}) => `
  SELECT
    COUNT(*) AS total_invoices,
    COALESCE(SUM(CASE WHEN d.status = 'APPROVED' THEN 1 ELSE 0 END), 0) AS approved_count,
    COALESCE(SUM(CASE WHEN d.status = 'CANCELLED' THEN 1 ELSE 0 END), 0) AS cancelled_count,
    COALESCE(SUM(CASE WHEN d.status = 'APPROVED' THEN d.total_amount + ${getDocumentNetAdjustmentSql('d')} ELSE 0 END), 0) AS approved_total,
    COALESCE(SUM(CASE WHEN d.status = 'CANCELLED' THEN d.total_amount + ${getDocumentNetAdjustmentSql('d')} ELSE 0 END), 0) AS cancelled_total
  FROM documents d
  LEFT JOIN stakeholders s ON s.id = d.stakeholder_id
  WHERE ${getInvoiceTypeCondition('d')} ${buildInvoiceReportWhere(stripPaginationFields(fields))};
`

const parseReceiptsFilterFields = (fields = {}) => {
  const filterFields = stripPaginationFields(fields)
  const documentNumberFilter = filterFields.document_number
  const systemInvoice =
    documentNumberFilter &&
    String(documentNumberFilter.$like || '')
      .toLowerCase()
      .includes('factura del sistema')

  if (systemInvoice) {
    delete filterFields.document_number
  }

  return { filterFields, systemInvoice }
}

const buildReceiptsReportWhere = (fields = {}, docAlias = 'd', stakeholderAlias = 's') => {
  const { filterFields, systemInvoice } = parseReceiptsFilterFields(fields)
  const rawWhereConditions = getWhereConditions({ fields: filterFields, tableAlias: docAlias })

  const whereConditions = rawWhereConditions
    .replace(new RegExp(`${docAlias}\\.nit`, 'gi'), `${stakeholderAlias}.nit`)
    .replace(new RegExp(`${docAlias}\\.name`, 'gi'), `${stakeholderAlias}.name`)
    .replace(new RegExp(`${docAlias}\\.start_date`, 'gi'), toFactDateSql(`${docAlias}.fact_date`))
    .replace(new RegExp(`${docAlias}\\.end_date`, 'gi'), toFactDateSql(`${docAlias}.fact_date`))

  return systemInvoice
    ? `${whereConditions} AND ${docAlias}.document_number IS NULL`
    : whereConditions
}

const getReceipts = (fields = {}) => {
  const whereConditions = buildReceiptsReportWhere(fields)
  const paginationSQL = buildPaginationSQL(fields)
  const paginationSubquery = paginationSQL
    ? `
    AND d.id IN (
      SELECT id FROM (
        SELECT d2.id
        FROM documents d2
        LEFT JOIN stakeholders s2 ON s2.id = d2.stakeholder_id
        WHERE ${getInvoiceTypeCondition('d2')}
        AND d2.status = 'APPROVED'
        ${buildReceiptsReportWhere(fields, 'd2', 's2')}
        ORDER BY d2.id DESC
        ${paginationSQL}
      ) AS paginated_documents
    )`
    : ''

  return `
    SELECT
      d.id,
      d.uuid,
      d.document_number,
      d.related_internal_document_id,
      d.document_type,
      d.stakeholder_id,
      s.name AS stakeholder_name,
      s.nit AS stakeholder_nit,
      s.stakeholder_type AS stakeholder_type,
      s.email AS stakeholder_email,
      s.phone AS stakeholder_phone,
      s.address AS stakeholder_address,
      d.operation_id,
      d.status,
      d.cancel_reason,
      d.description,
      d.subtotal_amount,
      d.total_discount_amount,
      d.total_tax_amount,
      d.total_amount,
      CASE
        WHEN d.payment_method = 'CASH' THEN 'EFECTIVO'
        WHEN d.payment_method = 'CARD' THEN 'CREDITO'
        WHEN d.payment_method = 'CHECK' THEN 'CHEQUE'
        WHEN d.payment_method = 'DEPOSIT' THEN 'DEPOSITO'
        WHEN d.payment_method = 'TRANSFER' THEN 'TRANSFERENCIA'
            ELSE 'NO DISPONIBLE' END as payment_method_spanish,
      d.payment_method,
      d.credit_days,
      d.credit_status,
      CASE
        WHEN d.credit_status = 'UNPAID' THEN 'PAGO PENDIENTE'
        WHEN d.credit_status = 'PAID' THEN 'PAGADO'
        WHEN d.credit_status = 'DEFAULT' THEN 'EN MORA'
          ELSE 'NO DISPONIBLE' END as credit_status_spanish,
      d.fact_date AS created_at,
      d.created_by,
      d.updated_at,
      d.updated_by,
      proj.id AS project_id,
      proj.name AS project_name,
      prod.id AS products__id,
      prod.product_type AS products__product_type,
      prod.status AS products__status,
      prod.code AS products__code,
      prod.serial_number AS products__serial_number,
      prod.description AS products__description,
      prod.image_url AS products__image_url,
      prod.created_at AS products__created_at,
      prod.created_by AS products__created_by,
      dp.service_type AS products__service_type,      
    CASE
      WHEN dp.service_type = 'EQUIPMENT' THEN 'EQUIPO'
      WHEN dp.service_type = 'SERVICE' THEN 'SERVICIO'
      WHEN dp.service_type = 'PART' THEN 'REPUESTO'
      ELSE 'NO DISPONIBLE' END as products__service_type_spanish,
      dp.document_id AS products__document_id,
      dp.product_price AS products__product_price,
      dp.product_quantity AS products__product_quantity,
      dp.tax_fee AS products__tax_fee,
      dp.unit_tax_amount AS products__unit_tax_amount,
      dp.discount_percentage AS products__discount_percentage,
      dp.unit_discount_amount AS products__unit_discount_amount,
      dp.parent_product_id AS products__parent_product_id,
      (dp.unit_tax_amount + dp.product_price) as products__total_product_amount,
      pay.id AS payments__id,
      pay.id AS payments__payment_id,
      pay.document_id AS payments__document_id,
      pay.payment_amount AS payments__payment_amount,
      pay.payment_method AS payments__payment_method,
      CASE
        WHEN pay.payment_method = 'CASH' THEN 'EFECTIVO'
        WHEN pay.payment_method = 'CARD' THEN 'CREDITO'
        WHEN pay.payment_method = 'CHECK' THEN 'CHEQUE'
        WHEN pay.payment_method = 'DEPOSIT' THEN 'DEPOSITO'
        WHEN pay.payment_method = 'TRANSFER' THEN 'TRANSFERENCIA'
            ELSE 'NO DISPONIBLE' END as payments__payment_method_spanish,
      pay.payment_date AS payments__payment_date,
      pay.related_external_document AS payments__related_external_document,
      pay.description AS payments__description,
      pay.is_deleted AS payments__is_deleted,
      pay.created_at AS payments__created_at,
      pay.created_by AS payments__created_by
    FROM documents d
    LEFT JOIN projects proj ON proj.id = d.project_id
    LEFT JOIN stakeholders s ON s.id = d.stakeholder_id
    LEFT JOIN documents_products dp ON dp.document_id = d.id
    LEFT JOIN products prod ON prod.id = dp.product_id
    LEFT JOIN payments pay ON pay.document_id = d.id
    WHERE ${getInvoiceTypeCondition('d')}
    ${whereConditions}
    AND d.status = 'APPROVED'
    ${paginationSubquery}
    ORDER BY d.id DESC
  `
}

const getReceiptsExport = (fields = {}) => {
  const whereConditions = buildReceiptsReportWhere(fields)
  const paginationSQL = buildPaginationSQL(fields)
  const paginationSubquery = paginationSQL
    ? `
    AND d.id IN (
      SELECT id FROM (
        SELECT d2.id
        FROM documents d2
        LEFT JOIN stakeholders s2 ON s2.id = d2.stakeholder_id
        WHERE ${getInvoiceTypeCondition('d2')}
        AND d2.status = 'APPROVED'
        ${buildReceiptsReportWhere(fields, 'd2', 's2')}
        ORDER BY d2.id DESC
        ${paginationSQL}
      ) AS paginated_documents
    )`
    : ''

  return `
    SELECT
      d.id,
      d.uuid,
      d.document_number,
      d.related_internal_document_id,
      s.name AS stakeholder_name,
      d.total_amount,
      d.fact_date AS created_at,
      COALESCE((
        SELECT SUM(p.payment_amount)
        FROM payments p
        WHERE p.document_id = d.id AND (p.is_deleted = 0 OR p.is_deleted IS NULL)
      ), 0) AS due
    FROM documents d
    LEFT JOIN stakeholders s ON s.id = d.stakeholder_id
    WHERE ${getInvoiceTypeCondition('d')}
    ${whereConditions}
    AND d.status = 'APPROVED'
    ${paginationSubquery}
    ORDER BY d.id DESC
  `
}

const getReceiptsExportProductLines = (documentIds = []) => {
  const placeholders = documentIds.map(() => '?').join(', ')

  return `
    SELECT
      dp.document_id,
      prod.id AS product_id,
      dp.parent_product_id,
      prod.description
    FROM documents_products dp
    LEFT JOIN products prod ON prod.id = dp.product_id
    WHERE dp.document_id IN (${placeholders})
    ORDER BY dp.document_id, dp.id
  `
}

const getReceiptsCount = (fields = {}) => `
  SELECT COUNT(*) AS total
  FROM documents d
  LEFT JOIN stakeholders s ON s.id = d.stakeholder_id
  WHERE ${getInvoiceTypeCondition('d')}
  AND d.status = 'APPROVED'
  ${buildReceiptsReportWhere(stripPaginationFields(fields))};
`

const getReceiptSummaryRows = (fields = {}) => `
  SELECT
    d.uuid,
    d.document_number,
    d.total_amount,
    COALESCE((
      SELECT SUM(p.payment_amount)
      FROM payments p
      WHERE p.document_id = d.id AND (p.is_deleted = 0 OR p.is_deleted IS NULL)
    ), 0) AS paid_amount
  FROM documents d
  LEFT JOIN stakeholders s ON s.id = d.stakeholder_id
  WHERE ${getInvoiceTypeCondition('d')}
  AND d.status = 'APPROVED'
  ${buildReceiptsReportWhere(stripPaginationFields(fields))};
`

const getReceiptsSummary = (fields = {}) => `
  SELECT
    COUNT(*) AS total_invoices,
    COALESCE(SUM(adjusted_total_amount), 0) AS total_billed,
    COALESCE(SUM(paid_amount), 0) AS total_paid,
    COALESCE(SUM(CASE WHEN document_number IS NOT NULL THEN 1 ELSE 0 END), 0) AS electronic_count,
    COALESCE(SUM(CASE WHEN document_number IS NULL THEN 1 ELSE 0 END), 0) AS system_count,
    COALESCE(SUM(CASE WHEN document_number IS NOT NULL THEN adjusted_total_amount ELSE 0 END), 0) AS electronic_billed,
    COALESCE(SUM(CASE WHEN document_number IS NULL THEN adjusted_total_amount ELSE 0 END), 0) AS system_billed,
    COALESCE(SUM(CASE WHEN document_number IS NOT NULL THEN paid_amount ELSE 0 END), 0) AS electronic_paid,
    COALESCE(SUM(CASE WHEN document_number IS NULL THEN paid_amount ELSE 0 END), 0) AS system_paid
  FROM (
    SELECT
      d.id,
      d.document_number,
      d.total_amount + ${getDocumentNetAdjustmentSql('d')} AS adjusted_total_amount,
      COALESCE((
        SELECT SUM(p.payment_amount)
        FROM payments p
        WHERE p.document_id = d.id AND (p.is_deleted = 0 OR p.is_deleted IS NULL)
      ), 0) AS paid_amount
    FROM documents d
    LEFT JOIN stakeholders s ON s.id = d.stakeholder_id
    WHERE ${getInvoiceTypeCondition('d')}
    AND d.status = 'APPROVED'
    ${buildReceiptsReportWhere(stripPaginationFields(fields))}
  ) AS receipt_totals;
`

const buildManualReceiptsReportWhere = (fields = {}, docAlias = 'd', stakeholderAlias = 's') => {
  const filterFields = stripPaginationFields(fields)
  const rawWhereConditions = getWhereConditions({ fields: filterFields, tableAlias: docAlias })

  return rawWhereConditions
    .replace(new RegExp(`${docAlias}\\.nit`, 'gi'), `${stakeholderAlias}.nit`)
    .replace(new RegExp(`${docAlias}\\.name`, 'gi'), `${stakeholderAlias}.name`)
    .replace(new RegExp(`${docAlias}\\.start_date`, 'gi'), toGuatemalaDateSql(`${docAlias}.created_at`))
    .replace(new RegExp(`${docAlias}\\.end_date`, 'gi'), toGuatemalaDateSql(`${docAlias}.created_at`))
}

const getManualReceipts = (fields = {}) => {
  const whereConditions = buildManualReceiptsReportWhere(fields)
  const paginationSQL = buildPaginationSQL(fields)
  const paginationSubquery = paginationSQL
    ? `
    AND d.id IN (
      SELECT id FROM (
        SELECT d2.id
        FROM manual_payments d2
        LEFT JOIN stakeholders s2 ON d2.stakeholder_id = s2.id
        WHERE 1 = 1
        ${buildManualReceiptsReportWhere(fields, 'd2', 's2')}
        ORDER BY d2.id DESC
        ${paginationSQL}
      ) AS paginated_manual_payments
    )`
    : ''

  return `
  SELECT
  d.id,
  d.created_at,
  d.status,
  CASE
  WHEN d.status = 'UNPAID' THEN 'PAGO PENDIENTE'
  WHEN d.status = 'PAID' THEN 'PAGADO'
  WHEN d.status = 'DEFAULT' THEN 'EN MORA'
    ELSE 'NO DISPONIBLE' END as status_spanish,
  d.total_amount,
  d.stakeholder_id,
  s.name AS stakeholder_name,
  s.nit AS stakeholder_nit,
  s.stakeholder_type AS stakeholder_type,
  s.email AS stakeholder_email,
  s.phone AS stakeholder_phone,
  s.address AS stakeholder_address,
  proj.id AS project_id,
  proj.name AS project_name,
  paydetail.related_external_document AS payments__related_external_document,
  paydetail.id AS payments__id,
  paydetail.id AS payments__payment_id,
  d.id AS payments__document_id,
  paydetail.payment_amount AS payments__payment_amount,
  paydetail.payment_method AS payments__payment_method,
  paydetail.payment_date AS payments__payment_date,
  paydetail.description AS payments__description,
  paydetail.is_deleted AS payments__is_deleted,
  paydetail.created_at AS payments__created_at,
  paydetail.created_by AS payments__created_by
FROM manual_payments d
LEFT JOIN manual_payments_detail paydetail on d.id = paydetail.manual_payment
LEFT JOIN projects proj ON d.project_id = proj.id
LEFT JOIN stakeholders s ON d.stakeholder_id = s.id
    WHERE 1 = 1
    ${whereConditions}
    ${paginationSubquery}
    ORDER BY d.id DESC
  `
}

const getManualReceiptsCount = (fields = {}) => `
  SELECT COUNT(*) AS total
  FROM manual_payments d
  LEFT JOIN stakeholders s ON d.stakeholder_id = s.id
  WHERE 1 = 1
  ${buildManualReceiptsReportWhere(stripPaginationFields(fields))};
`

const getManualReceiptsSummary = (fields = {}) => `
  SELECT
    COUNT(*) AS total_receipts,
    COALESCE(SUM(total_amount), 0) AS total_billed,
    COALESCE(SUM(paid_amount), 0) AS total_paid
  FROM (
    SELECT
      d.id,
      d.total_amount,
      COALESCE((
        SELECT SUM(pd.payment_amount)
        FROM manual_payments_detail pd
        WHERE pd.manual_payment = d.id AND (pd.is_deleted = 0 OR pd.is_deleted IS NULL)
      ), 0) AS paid_amount
    FROM manual_payments d
    LEFT JOIN stakeholders s ON d.stakeholder_id = s.id
    WHERE 1 = 1
    ${buildManualReceiptsReportWhere(stripPaginationFields(fields))}
  ) AS manual_receipt_totals;
`

const buildServiceOrdersReportWhere = (fields = {}, docAlias = 'd', stakeholderAlias = 's') => {
  const filterFields = stripPaginationFields(fields)
  const rawWhereConditions = getWhereConditions({ fields: filterFields, tableAlias: docAlias })

  return rawWhereConditions
    .replace(new RegExp(`${docAlias}\\.name`, 'gi'), `${stakeholderAlias}.name`)
    .replace(new RegExp(`${docAlias}\\.start_date`, 'gi'), `DATE(${docAlias}.start_date)`)
    .replace(new RegExp(`${docAlias}\\.end_date`, 'gi'), `DATE(${docAlias}.start_date)`)
}

const getServiceOrders = (fields = {}) => {
  const whereConditions = buildServiceOrdersReportWhere(fields)
  const paginationSQL = buildPaginationSQL(fields)
  const paginationSubquery = paginationSQL
    ? `
    AND d.id IN (
      SELECT id FROM (
        SELECT d2.id
        FROM documents d2
        INNER JOIN stakeholders s2 ON s2.id = d2.stakeholder_id
        WHERE d2.document_type = '${types.documentsTypes.RENT_PRE_INVOICE}'
        ${buildServiceOrdersReportWhere(fields, 'd2', 's2')}
        ORDER BY d2.id DESC
        ${paginationSQL}
      ) AS paginated_service_orders
    )`
    : ''

  return `
  SELECT
    d.id,
    d.document_type,
    d.stakeholder_id,
    d.operation_id,
    d.related_internal_document_id,
    d.related_external_document_id,
    d.status,
    CASE
        WHEN d.status = 'PENDING' THEN 'PENDIENTE'
        WHEN d.status = 'CANCELLED' THEN 'ANULADO'
        WHEN d.status = 'SAT_FAILED' THEN 'FALLO SAT'
        WHEN d.status = 'APPROVED' THEN 'APROBADO'
        ELSE 'NO DISPONIBLE' END as status_spanish,
    d.comments,
    d.received_by,
    d.dispatched_by,
    d.start_date,
    d.end_date,
    d.cancel_reason,
    d.credit_days,
    u.full_name AS creator_name,
    d.updated_at AS created_at,
    d.created_by,
    d.updated_at,
    d.updated_by,
    (CASE
      WHEN 
        (d.related_internal_document_id IS NOT NULL AND d.operation_id IS NOT NULL) OR
        d.status = '${types.documentsStatus.CANCELLED}'
      THEN 1
      ELSE 0
    END) AS has_related_invoice,
    s.id AS stakeholder_id,
    s.stakeholder_type AS stakeholder_type,
    s.name AS stakeholder_name,
    s.nit AS stakeholder_nit,
    s.email AS stakeholder_email,
    s.business_man AS stakeholder_business_man,
    s.address AS stakeholder_address,
    s.phone AS stakeholder_phone,
    proj.id AS project_id,
    proj.name AS project_name,
    proj.start_date as project_start_date,
    proj.end_date as project_end_date,
    prod.id AS products__id,
    prod.status AS products__status,
    dp.service_type AS products__service_type,
    CASE
      WHEN dp.service_type = 'EQUIPMENT' THEN 'EQUIPO'
      WHEN dp.service_type = 'SERVICE' THEN 'SERVICIO'
      WHEN dp.service_type = 'PART' THEN 'REPUESTO'
      ELSE 'NO DISPONIBLE' END as products__service_type_spanish,
    dp.product_price AS products__unit_price,
    dp.product_quantity AS products__quantity,
    dp.tax_fee AS products__tax_fee,
    dp.unit_tax_amount AS products__unit_tax_amount,
    dp.parent_product_id AS products__parent_product_id,
    (dp.unit_tax_amount + dp.product_price) as products__total_product_amount,
    prod.code AS products__code,
    prod.serial_number AS products__serial_number,
    prod.description AS products__description
  FROM documents d
  INNER JOIN users u ON u.id = d.created_by
  INNER JOIN documents_products dp ON dp.document_id = d.id
  INNER JOIN products prod ON prod.id = dp.product_id
  INNER JOIN stakeholders s ON s.id = d.stakeholder_id
  INNER JOIN projects proj ON proj.id = d.project_id
  WHERE d.document_type = '${types.documentsTypes.RENT_PRE_INVOICE}'
  ${whereConditions}
  ${paginationSubquery}
  ORDER BY d.id DESC
  `
}

const getServiceOrdersExport = (fields = {}) => {
  const whereConditions = buildServiceOrdersReportWhere(fields)
  const paginationSQL = buildPaginationSQL(fields)
  const paginationSubquery = paginationSQL
    ? `
    AND d.id IN (
      SELECT id FROM (
        SELECT d2.id
        FROM documents d2
        INNER JOIN stakeholders s2 ON s2.id = d2.stakeholder_id
        WHERE d2.document_type = '${types.documentsTypes.RENT_PRE_INVOICE}'
        ${buildServiceOrdersReportWhere(fields, 'd2', 's2')}
        ORDER BY d2.id DESC
        ${paginationSQL}
      ) AS paginated_service_orders
    )`
    : ''

  return `
  SELECT
    d.id,
    d.comments,
    s.name AS stakeholder_name,
    proj.name AS project_name,
    proj.start_date AS project_start_date
  FROM documents d
  INNER JOIN users u ON u.id = d.created_by
  INNER JOIN stakeholders s ON s.id = d.stakeholder_id
  INNER JOIN projects proj ON proj.id = d.project_id
  WHERE d.document_type = '${types.documentsTypes.RENT_PRE_INVOICE}'
  AND EXISTS (
    SELECT 1 FROM documents_products dp WHERE dp.document_id = d.id
  )
  ${whereConditions}
  ${paginationSubquery}
  ORDER BY d.id DESC
  `
}

const getServiceOrdersExportProductLines = (documentIds = []) => {
  const placeholders = documentIds.map(() => '?').join(', ')

  return `
    SELECT
      dp.document_id,
      prod.id AS product_id,
      dp.parent_product_id,
      prod.code,
      prod.description,
      CASE
        WHEN dp.service_type = 'EQUIPMENT' THEN 'EQUIPO'
        WHEN dp.service_type = 'SERVICE' THEN 'SERVICIO'
        WHEN dp.service_type = 'PART' THEN 'REPUESTO'
        ELSE 'NO DISPONIBLE'
      END AS service_type_spanish,
      (dp.unit_tax_amount + dp.product_price) AS total_product_amount,
      dp.product_quantity AS quantity
    FROM documents_products dp
    INNER JOIN products prod ON prod.id = dp.product_id
    WHERE dp.document_id IN (${placeholders})
    ORDER BY dp.document_id, dp.id
  `
}

const getServiceOrdersCount = (fields = {}) => `
  SELECT COUNT(*) AS total
  FROM documents d
  INNER JOIN stakeholders s ON s.id = d.stakeholder_id
  WHERE d.document_type = '${types.documentsTypes.RENT_PRE_INVOICE}'
  ${buildServiceOrdersReportWhere(stripPaginationFields(fields))};
`

const getServiceOrdersSummary = (fields = {}) => `
  SELECT
    COUNT(*) AS total_orders,
    COALESCE(SUM(CASE WHEN d.status = 'APPROVED' THEN 1 ELSE 0 END), 0) AS approved_count,
    COALESCE(SUM(CASE WHEN d.status = 'PENDING' THEN 1 ELSE 0 END), 0) AS pending_count,
    COALESCE(SUM(CASE WHEN d.status = 'CANCELLED' THEN 1 ELSE 0 END), 0) AS cancelled_count
  FROM documents d
  INNER JOIN stakeholders s ON s.id = d.stakeholder_id
  WHERE d.document_type = '${types.documentsTypes.RENT_PRE_INVOICE}'
  ${buildServiceOrdersReportWhere(stripPaginationFields(fields))};
`

const LINE_ITEM_TOTAL = '(dp.product_price + dp.unit_tax_amount - IFNULL(dp.unit_discount_amount, 0)) * dp.product_quantity'

const SALES_ITEM_TYPE_SQL = `
  CASE
    WHEN prod.product_type = '${types.productsTypes.SERVICE}' OR dp.service_type = '${types.documentsServiceType.SERVICE}' THEN 'SERVICE'
    WHEN prod.product_category = '${types.productsCategories.EQUIPMENT}' OR dp.service_type = '${types.documentsServiceType.EQUIPMENT}' THEN 'EQUIPMENT'
    ELSE 'PRODUCT'
  END`

const SALES_ITEM_TYPE_SPANISH_SQL = `
  CASE
    WHEN prod.product_type = '${types.productsTypes.SERVICE}' OR dp.service_type = '${types.documentsServiceType.SERVICE}' THEN 'Servicio'
    WHEN prod.product_category = '${types.productsCategories.EQUIPMENT}' OR dp.service_type = '${types.documentsServiceType.EQUIPMENT}' THEN 'Equipo'
    ELSE 'Producto'
  END`

const SALES_CATEGORY_SPANISH_SQL = `
  CASE prod.sales_category
    WHEN '${types.salesCategories.SC}' THEN 'Cabina'
    WHEN '${types.salesCategories.SE}' THEN 'Equipo'
    WHEN '${types.salesCategories.SF}' THEN 'Fosa'
    WHEN '${types.salesCategories.SO}' THEN 'Otros'
    ELSE ''
  END`

const SALES_PRODUCT_REPORT_BASE_FROM = `
    FROM products prod
    INNER JOIN documents_products dp ON prod.id = dp.product_id
    INNER JOIN documents d ON dp.document_id = d.id AND d.status = 'APPROVED'
    WHERE (d.document_type = 'SELL_INVOICE' OR d.document_type = 'RENT_INVOICE')`

const parseReportFilterFields = (fields = {}) => {
  const { $limit, $offset, item_type, product_type, ...filterFields } = fields

  return {
    filterFields,
    itemType: item_type || product_type,
  }
}

const buildItemTypeFilter = itemType => {
  if (!itemType) return ''

  return ` AND ${SALES_ITEM_TYPE_SQL} = '${itemType}'`
}

const buildSalesProductReportWhere = (fields = {}, itemType = null) => {
  const { filterFields, itemType: itemTypeFromFields } = parseReportFilterFields(fields)
  const resolvedItemType = itemType !== null ? itemType : itemTypeFromFields
  const rawWhereConditions = getWhereConditions({ fields: filterFields, tableAlias: 'd' })

  return `${rawWhereConditions
    .replace(/d\.code/gi, 'prod.code')
    .replace(/d\.description/gi, 'prod.description')
    .replace(/d\.start_date/gi, toFactDateSql('d.fact_date'))
    .replace(/d\.end_date/gi, toFactDateSql('d.fact_date'))
    .replace(/d\.product_type/gi, 'prod.product_type')
    .replace(/d\.item_type/gi, SALES_ITEM_TYPE_SQL)
    .replace(/d\.sales_category/gi, 'prod.sales_category')}${buildItemTypeFilter(resolvedItemType)}`
}

const stripPaginationFields = (fields = {}) => {
  const { $limit, $offset, ...filterFields } = fields

  return filterFields
}

const buildPaginationSQL = (fields = {}) => {
  const limit = fields.$limit
  const offset = fields.$offset

  if (!limit) return ''

  const offsetSQL = offset ? ` OFFSET ${offset}` : ''

  return `LIMIT ${limit}${offsetSQL}`
}

const getSalesProductReport = (fields = {}) => {
  const whereConditions = buildSalesProductReportWhere(stripPaginationFields(fields))
  const paginationSQL = buildPaginationSQL(fields)

  return `
  SELECT
        prod.id AS id,
        prod.code AS code,
        prod.description AS description,
        ${SALES_ITEM_TYPE_SQL} AS item_type,
        ${SALES_ITEM_TYPE_SPANISH_SQL} AS item_type_spanish,
        prod.sales_category AS sales_category,
        ${SALES_CATEGORY_SPANISH_SQL} AS sales_category_spanish,
        SUM(dp.product_quantity) AS product_quantity,
        SUM(${LINE_ITEM_TOTAL}) AS total_amount
    ${SALES_PRODUCT_REPORT_BASE_FROM}
    ${whereConditions}
    GROUP BY prod.id
    ORDER BY product_quantity DESC
    ${paginationSQL};
  `
}

const getSalesProductReportCount = (fields = {}) => {
  const whereConditions = buildSalesProductReportWhere(stripPaginationFields(fields))

  return `
  SELECT COUNT(*) AS total
  FROM (
    SELECT prod.id
    ${SALES_PRODUCT_REPORT_BASE_FROM}
    ${whereConditions}
    GROUP BY prod.id
  ) AS grouped_items;
  `
}

const getSalesProductReportSummary = (fields = {}) => {
  const whereConditions = buildSalesProductReportWhere(fields)

  return `
  SELECT
    ${SALES_ITEM_TYPE_SQL} AS item_type,
    SUM(dp.product_quantity) AS total_quantity,
    SUM(${LINE_ITEM_TOTAL}) AS total_amount
  ${SALES_PRODUCT_REPORT_BASE_FROM}
  ${whereConditions}
  GROUP BY 1;
  `
}

const getTopSoldItem = (fields = {}, itemType) => {
  const whereConditions = buildSalesProductReportWhere(fields, itemType)

  return `
  SELECT
    prod.code AS code,
    prod.description AS description,
    SUM(dp.product_quantity) AS product_quantity,
    SUM(${LINE_ITEM_TOTAL}) AS total_amount
  ${SALES_PRODUCT_REPORT_BASE_FROM}
  ${whereConditions}
  GROUP BY prod.id
  ORDER BY product_quantity DESC
  LIMIT 1;
  `
}

// ---- Reporte de comisiones de vendedores ----
// Factura pagada = saldo (total + notas credito/debito - pagos) <= 0.009 (mismo criterio que estado de cuenta de clientes).
// Comision = (total ajustado / 1.12) * sellers.commission_percentage / 100. El 1.12 quita el IVA (12%);
// con exclude_iva=0 la comision se calcula sobre el total sin quitar IVA (default: se quita).
const COMMISSION_IVA_DIVISOR = 1.12

const buildCommissionRowsSql = (fields = {}, { applyPaymentFilter = true } = {}) => {
  const digits = value => String(value || '').replace(/[^\d]/g, '')
  const stakeholderId = digits(fields.stakeholder_id)
  const sellerId = digits(fields.seller_id)
  const paymentStatus = String(fields.payment_status || 'ALL').toUpperCase()
  const divisor = String(fields.exclude_iva) === '0' ? 1 : COMMISSION_IVA_DIVISOR
  const commissionStatus = String(fields.commission_status || 'ALL').toUpperCase()
  const documentIds = [].concat(fields.document_ids || []).map(digits).filter(Boolean)
  const dateSql = CLIENT_INVOICE_DATE_SQL('d')
  // payment_status y commission_status filtran solo la lista; el resumen los ignora
  const outerFilters = []

  if (applyPaymentFilter && paymentStatus !== 'ALL')
    outerFilters.push(`inv.invoice_status = 'APPROVED' AND inv.total_amount - inv.paid_amount ${paymentStatus === 'PAID' ? '<=' : '>'} 0.009`)
  if (applyPaymentFilter && commissionStatus !== 'ALL')
    outerFilters.push(`inv.commission_paid_at IS ${commissionStatus === 'PAID' ? 'NOT ' : ''}NULL`)

  const paymentFilter = outerFilters.length ? `WHERE ${outerFilters.join(' AND ')}` : ''

  return `
    SELECT
      inv.*,
      CASE WHEN inv.invoice_status = 'APPROVED' AND inv.total_amount - inv.paid_amount <= 0.009 THEN 1 ELSE 0 END AS is_paid,
      ROUND(inv.total_amount / ${divisor}, 2) AS base_amount,
      ROUND(ROUND(inv.total_amount / ${divisor}, 2) * inv.commission_percentage / 100, 2) AS commission_amount
    FROM (
      SELECT
        d.id,
        ${CLIENT_DOCUMENT_NUMBER_SQL('d')} AS document_number,
        d.serie,
        ${dateSql} AS document_date,
        d.stakeholder_id,
        s.name AS stakeholder_name,
        s.nit AS stakeholder_nit,
        d.seller_id,
        sl.name AS seller_name,
        sl.commission_percentage,
        d.status AS invoice_status,
        d.commission_paid_at,
        d.commission_paid_amount,
        (d.total_amount + ${getDocumentNetAdjustmentSql('d')}) AS total_amount,
        ${CLIENT_PAYMENTS_TO_DATE_SQL('d', 'CURDATE()')} AS paid_amount
      FROM documents d
      JOIN sellers sl ON sl.id = d.seller_id
      LEFT JOIN stakeholders s ON s.id = d.stakeholder_id
      WHERE ${CLIENT_INVOICE_TYPES_SQL('d')}
        AND (
          d.status = '${types.documentsStatus.APPROVED}'
          OR (d.status = '${types.documentsStatus.CANCELLED}' AND d.commission_paid_at IS NOT NULL)
        )
        ${stakeholderId ? `AND d.stakeholder_id = ${stakeholderId}` : ''}
        ${sellerId ? `AND d.seller_id = ${sellerId}` : ''}
        ${documentIds.length ? `AND d.id IN (${documentIds.join(',')})` : ''}
        ${buildClientAccountDateFilter(dateSql, {
          startDate: extractClientAccountDateValue(fields.start_date),
          endDate: extractClientAccountDateValue(fields.end_date),
        })}
    ) inv
    ${paymentFilter}
  `
}

const getCommissionReport = (fields = {}) => `
  SELECT * FROM (${buildCommissionRowsSql(fields)}) r
  ORDER BY r.document_date DESC, r.id DESC
  ${buildPaginationSQL(fields)};
`

const getCommissionReportCount = (fields = {}) => `
  SELECT COUNT(*) AS total FROM (${buildCommissionRowsSql(fields)}) r;
`

// El resumen ignora payment_status y commission_status. Cada factura cae en un solo bucket:
// CANCELLED_PAID (factura anulada con comision ya pagada), COMMISSION_PAID (comision ya marcada, usa el monto congelado),
// TO_PAY (factura pagada, comision sin pagar) o UNPAID (factura sin pagar)
const getCommissionSummary = (fields = {}) => `
  SELECT
    r.seller_id,
    r.seller_name,
    r.commission_percentage,
    CASE
      WHEN r.invoice_status = 'CANCELLED' THEN 'CANCELLED_PAID'
      WHEN r.commission_paid_at IS NOT NULL THEN 'COMMISSION_PAID'
      WHEN r.is_paid = 1 THEN 'TO_PAY'
      ELSE 'UNPAID'
    END AS bucket,
    COUNT(*) AS invoices_count,
    COALESCE(SUM(r.total_amount), 0) AS total_amount,
    COALESCE(SUM(r.base_amount), 0) AS base_amount,
    COALESCE(SUM(CASE WHEN r.commission_paid_at IS NOT NULL THEN r.commission_paid_amount ELSE r.commission_amount END), 0) AS commission_amount
  FROM (${buildCommissionRowsSql(fields, { applyPaymentFilter: false })}) r
  GROUP BY r.seller_id, r.seller_name, r.commission_percentage, bucket
  ORDER BY r.seller_name;
`

const markCommissionsPaid = () => `
  UPDATE documents
  SET commission_paid_at = NOW(), commission_paid_amount = ?, commission_paid_by = ?, updated_at = updated_at
  WHERE id = ? AND commission_paid_at IS NULL
`

// updated_at = updated_at evita alterar la fecha que usan otros reportes
const unmarkCommissionsPaid = ids => `
  UPDATE documents
  SET commission_paid_at = NULL, commission_paid_amount = NULL, commission_paid_by = NULL, updated_at = updated_at
  WHERE id IN (${ids.map(id => Number(id)).join(',')}) AND ${CLIENT_INVOICE_TYPES_SQL('documents')}
`

module.exports = {
  getCommissionReport,
  getCommissionReportCount,
  getCommissionSummary,
  markCommissionsPaid,
  unmarkCommissionsPaid,
  getAccountsReceivable,
  getClientAccountState,
  getClientAccountStateCount,
  getClientAccountStateSummary,
  getClientAccountUnpaidInvoices,
  getClientAccountInvoices,
  getClientAccountInvoicesCount,
  getClientAccountInvoicePayments,
  getClientAccountOpeningBalance,
  getClientAccountInvoiceMovements,
  getClientAccountPaymentMovements,
  getClientAccountNoteMovements,
  getClientAccountMovements,
  getInventory,
  getInventoryCount,
  getInventorySummary,
  getSales,
  getSalesCount,
  getSalesSummary,
  getSalesSummaryRows,
  getInvoice,
  getInvoiceCount,
  getInvoiceSummary,
  getInvoiceSummaryRows,
  getReceipts,
  getReceiptsExport,
  getReceiptsExportProductLines,
  getReceiptsCount,
  getReceiptsSummary,
  getReceiptSummaryRows,
  parseReceiptsFilterFields,
  getManualReceipts,
  getManualReceiptsCount,
  getManualReceiptsSummary,
  getServiceOrders,
  getServiceOrdersExport,
  getServiceOrdersExportProductLines,
  getServiceOrdersCount,
  getServiceOrdersSummary,
  getSalesProductReport,
  getSalesProductReportCount,
  getSalesProductReportSummary,
  getTopSoldItem,
  stripPaginationFields,
}
