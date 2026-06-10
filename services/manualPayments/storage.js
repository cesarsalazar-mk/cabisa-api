const { types, getWhereConditions } = require(`${process.env['FILE_ENVIRONMENT']}/globals`)

const findAllBy = (fields = {}) => {
  const rawWhereConditions = getWhereConditions({ fields, tableAlias: 'd' })
  const whereConditions = rawWhereConditions.replace(/d.nit/i, 's.nit').replace(/d.name/i, 's.name')

  return `
  SELECT
  d.id,
  d.created_at,
  d.status,
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
  paydetail.attachment_url AS payments__attachment_url,
  paydetail.is_deleted AS payments__is_deleted,
  paydetail.created_at AS payments__created_at,
  paydetail.created_by AS payments__created_by
FROM manual_payments d
LEFT JOIN manual_payments_detail paydetail on d.id = paydetail.manual_payment
LEFT JOIN projects proj ON d.project_id = proj.id
LEFT JOIN stakeholders s ON d.stakeholder_id = s.id
    WHERE 1 = 1      
    ${whereConditions}
    ORDER BY d.id DESC
  `
}

const findDocumentPayments = () => `
SELECT
d.id,
d.created_at,
d.status,
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
paydetail.related_external_document AS old_payments__related_external_document,
paydetail.id AS old_payments__id,
paydetail.id AS old_payments__payment_id,
d.id AS old_payments__document_id,
paydetail.payment_amount AS old_payments__payment_amount,
paydetail.payment_method AS old_payments__payment_method,
paydetail.payment_date AS old_payments__payment_date,
paydetail.description AS old_payments__description,
paydetail.attachment_url AS old_payments__attachment_url,
paydetail.is_deleted AS old_payments__is_deleted,
paydetail.created_at AS old_payments__created_at,
paydetail.created_by AS old_payments__created_by
FROM manual_payments d
LEFT JOIN manual_payments_detail paydetail on d.id = paydetail.manual_payment
LEFT JOIN projects proj ON d.project_id = proj.id
LEFT JOIN stakeholders s ON d.stakeholder_id = s.id
  WHERE
    d.id = ?
`

const deletePayments = paymentsIds => `UPDATE manual_payments_detail SET is_deleted = 1 WHERE id IN (${paymentsIds.join(', ')})`

const updateManualPaymentStatus = (id,status) => `UPDATE manual_payments SET status = '${status}' WHERE id = ${id}`

const crupdatePayments = crupdatePaymentsValues => `
  INSERT INTO manual_payments_detail (id, manual_payment, payment_method, payment_amount, payment_date, related_external_document, description, attachment_url, created_at, created_by)
  VALUES ${crupdatePaymentsValues.join(', ')}
  ON DUPLICATE KEY UPDATE
    id = VALUES(id),
    manual_payment = VALUES(manual_payment),    
    payment_method = VALUES(payment_method),
    payment_amount = VALUES(payment_amount),
    payment_date = VALUES(payment_date),
    related_external_document = VALUES(related_external_document),
    description = VALUES(description),
    attachment_url = VALUES(attachment_url),
    created_at = VALUES(created_at),
    created_by = VALUES(created_by)
`

const createManualPayment = crupdatePaymentsValues => `
  INSERT INTO manual_payments (total_amount,stakeholder_id,project_id)
  VALUES (${crupdatePaymentsValues.join(', ')})  
`

const deleteManualPayment = id => `
delete from manual_payments
where id = ${id};
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
  findDocumentsWithDefaultCredits,
  findDocumentPayments,
  getPaymentsByDocumentId,
  updateManualPaymentStatus,
  createManualPayment,
  deleteManualPayment
}
