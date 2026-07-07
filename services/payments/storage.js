const { types, getWhereConditions } = require(`${process.env['FILE_ENVIRONMENT']}/globals`)

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

const getInvoiceTypeCondition = (alias = 'd') =>
  `(${alias}.document_type = '${types.documentsTypes.SELL_INVOICE}' OR ${alias}.document_type = '${types.documentsTypes.RENT_INVOICE}')`

const buildWhereConditions = (fields = {}, docAlias = 'd', stakeholderAlias = 's') => {
  const rawWhereConditions = getWhereConditions({ fields, tableAlias: docAlias })

  return rawWhereConditions
    .replace(new RegExp(`${docAlias}\\.nit`, 'gi'), `${stakeholderAlias}.nit`)
    .replace(new RegExp(`${docAlias}\\.name`, 'gi'), `${stakeholderAlias}.name`)
}

const findAllBy = (fields = {}) => {
  const filterFields = stripPaginationFields(fields)
  const paginationSQL = buildPaginationSQL(fields)
  const whereConditions = buildWhereConditions(filterFields)
  const paginationSubquery = paginationSQL
    ? `
    AND d.id IN (
      SELECT id FROM (
        SELECT DISTINCT d2.id
        FROM documents d2
        LEFT JOIN stakeholders s2 ON s2.id = d2.stakeholder_id
        WHERE ${getInvoiceTypeCondition('d2')} ${buildWhereConditions(filterFields, 'd2', 's2')}
        ORDER BY d2.id DESC
        ${paginationSQL}
      ) AS paginated_documents
    )`
    : ''

  return `
    SELECT
      d.id,
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
      d.payment_method,
      d.credit_days,
      d.credit_status,
      d.created_at,
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
      dp.parent_product_id AS products__parent_product_id,
      pay.id AS payments__id,
      pay.id AS payments__payment_id,
      pay.document_id AS payments__document_id,
      pay.payment_amount AS payments__payment_amount,
      pay.payment_method AS payments__payment_method,
      pay.payment_date AS payments__payment_date,
      pay.related_external_document AS payments__related_external_document,
      pay.description AS payments__description,
      pay.attachment_url AS payments__attachment_url,
      pay.is_deleted AS payments__is_deleted,
      pay.created_at AS payments__created_at,
      pay.created_by AS payments__created_by
    FROM documents d
    LEFT JOIN projects proj ON proj.id = d.project_id
    LEFT JOIN stakeholders s ON s.id = d.stakeholder_id
    LEFT JOIN documents_products dp ON dp.document_id = d.id
    LEFT JOIN products prod ON prod.id = dp.product_id
    LEFT JOIN payments pay ON pay.document_id = d.id
    WHERE ${getInvoiceTypeCondition('d')} ${whereConditions}
    ${paginationSubquery}
    ORDER BY d.id DESC
  `
}

const findAllByCount = (fields = {}) => {
  const filterFields = stripPaginationFields(fields)
  const whereConditions = buildWhereConditions(filterFields)

  return `
  SELECT COUNT(DISTINCT d.id) AS total
  FROM documents d
  LEFT JOIN stakeholders s ON s.id = d.stakeholder_id
  WHERE ${getInvoiceTypeCondition('d')} ${whereConditions}
`
}

const findDocumentPayments = () => `
  SELECT
    d.id AS document_id,
    d.credit_days,
    d.related_internal_document_id,
    d.subtotal_amount,
    d.total_amount,
    d.paid_credit_amount,
    d.credit_status,
    d.stakeholder_id,
    s.total_credit AS stakeholder_total_credit,
    s.paid_credit AS stakeholder_paid_credit,
    p.id AS old_payments__payment_id,
    p.document_id AS old_payments__document_id,
    p.payment_amount AS old_payments__payment_amount,
    p.payment_method AS old_payments__payment_method,
    p.payment_date AS old_payments__payment_date,
    p.description AS old_payments__description,
    p.attachment_url AS old_payments__attachment_url,
    p.is_deleted AS old_payments__is_deleted,
    p.created_at AS old_payments__created_at,
    p.created_by AS old_payments__created_by
  FROM documents d
  LEFT JOIN stakeholders s ON s.id = d.stakeholder_id
  LEFT JOIN payments p ON p.document_id = d.id
  WHERE
    d.id = ? AND (
      d.document_type = '${types.documentsTypes.SELL_INVOICE}' OR
      d.document_type = '${types.documentsTypes.RENT_INVOICE}'
    )
`

const deletePayments = paymentsIds => `UPDATE payments SET is_deleted = 1 WHERE id IN (${paymentsIds.join(', ')})`

const crupdatePayments = crupdatePaymentsValues => `
  INSERT INTO payments (id, document_id, payment_method, payment_amount, payment_date, related_external_document, description, attachment_url, created_at, created_by)
  VALUES ${crupdatePaymentsValues.join(', ')}
  ON DUPLICATE KEY UPDATE
    id = VALUES(id),
    document_id = VALUES(document_id),
    payment_method = VALUES(payment_method),
    payment_amount = VALUES(payment_amount),
    payment_date = VALUES(payment_date),
    related_external_document = VALUES(related_external_document),
    description = VALUES(description),
    attachment_url = VALUES(attachment_url),
    created_at = VALUES(created_at),
    created_by = VALUES(created_by)
`

const getPaymentsByDocumentId = () => `
  SELECT
    id AS payment_id,
    document_id,
    payment_amount,
    payment_method,
    payment_date,
    related_external_document,
    description,
    attachment_url,
    created_at,
    created_by
  FROM payments
  WHERE document_id = ?
`

const findDocumentsWithDefaultCredits = () => `
  SELECT d.id, d.stakeholder_id, d.created_by, d.updated_by
  FROM documents d
  WHERE (
      d.document_type = '${types.documentsTypes.SELL_INVOICE}' OR
      d.document_type = '${types.documentsTypes.RENT_INVOICE}'
    )
    AND DATEDIFF(NOW(), d.created_at) > d.credit_days
    AND d.credit_status = '${types.creditsPolicy.creditStatusEnum.UNPAID}'
`

const bulkUpdateCreditStatus = creditStatusValues => `
  INSERT INTO documents (id, stakeholder_id, credit_status, created_by, updated_by)
    VALUES ${creditStatusValues.join(',')}
    ON DUPLICATE KEY UPDATE
      credit_status = VALUES(credit_status),
      updated_by = VALUES(updated_by)
`

module.exports = {
  bulkUpdateCreditStatus,
  deletePayments,
  crupdatePayments,
  findAllBy,
  findAllByCount,
  findDocumentsWithDefaultCredits,
  findDocumentPayments,
  getPaymentsByDocumentId,
}
