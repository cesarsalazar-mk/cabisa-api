const { types, getWhereConditions, toGuatemalaDateSql, toFactDateSql } = require(`${process.env['FILE_ENVIRONMENT']}/globals`)

const stripPaginationFields = (fields = {}) => {
  const { $limit, $offset, system_invoice, ...filterFields } = fields

  return filterFields
}

const parseInvoiceQueryFields = (fields = {}) => {
  const { $limit, $offset, system_invoice, ...filterFields } = fields
  const systemInvoiceOnly =
    system_invoice === true ||
    system_invoice === 'true' ||
    system_invoice === 1 ||
    system_invoice === '1'

  return { filterFields, systemInvoiceOnly }
}

const getSystemInvoiceSql = (alias = 'd', systemInvoiceOnly = false) =>
  systemInvoiceOnly ? ` AND ${alias}.document_number IS NULL` : ''

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
    .replace(
      new RegExp(`${docAlias}\\.updated_from`, 'gi'),
      toFactDateSql(`${docAlias}.fact_date`)
    )
    .replace(
      new RegExp(`${docAlias}\\.updated_to`, 'gi'),
      toFactDateSql(`${docAlias}.fact_date`)
    )
    .replace(new RegExp(`${docAlias}\\.start_date`, 'gi'), toGuatemalaDateSql(`${docAlias}.created_at`))
    .replace(new RegExp(`${docAlias}\\.end_date`, 'gi'), toGuatemalaDateSql(`${docAlias}.created_at`))
}

const findAllBy = (fields = {}) => {
  const { filterFields, systemInvoiceOnly } = parseInvoiceQueryFields(fields)
  const paginationSQL = buildPaginationSQL(fields)
  const whereConditions = buildWhereConditions(filterFields)
  const systemInvoiceSql = getSystemInvoiceSql('d', systemInvoiceOnly)
  const systemInvoiceSqlInner = getSystemInvoiceSql('d2', systemInvoiceOnly)
  const paginationSubquery = paginationSQL
    ? `
    AND d.id IN (
      SELECT id FROM (
        SELECT d2.id
        FROM documents d2
        LEFT JOIN stakeholders s2 ON s2.id = d2.stakeholder_id
        WHERE ${getInvoiceTypeCondition('d2')} ${buildWhereConditions(filterFields, 'd2', 's2')}${systemInvoiceSqlInner}
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
      d.cancel_reason,
      d.description,
      d.subtotal_amount AS subtotal,
      d.total_discount_amount AS discount,
      d.total_tax_amount AS total_tax,
      d.total_amount AS total,
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
      dp.parent_product_id AS products__parent_product_id
    FROM documents d
    LEFT JOIN projects proj ON proj.id = d.project_id
    LEFT JOIN stakeholders s ON s.id = d.stakeholder_id
    LEFT JOIN documents_products dp ON dp.document_id = d.id
    LEFT JOIN products prod ON prod.id = dp.product_id
    WHERE ${getInvoiceTypeCondition('d')} ${whereConditions}${systemInvoiceSql}
    ${paginationSubquery}
    ORDER BY d.id DESC
  `
}

const findAllByCount = (fields = {}) => {
  const { filterFields, systemInvoiceOnly } = parseInvoiceQueryFields(fields)
  const whereConditions = buildWhereConditions(filterFields)
  const systemInvoiceSql = getSystemInvoiceSql('d', systemInvoiceOnly)

  return `
  SELECT COUNT(*) AS total
  FROM documents d
  LEFT JOIN stakeholders s ON s.id = d.stakeholder_id
  WHERE ${getInvoiceTypeCondition('d')} ${whereConditions}${systemInvoiceSql};
  `
}

const findPaymentMethods = () => `SELECT name, description FROM payment_methods`

const findInvoiceStatus = () => `DESCRIBE documents status`

const findInvoiceServiceType = () => `DESCRIBE documents_products service_type`

const findCreditStatus = () => `DESCRIBE documents credit_status`

const checkProjectExists = () => `SELECT id FROM projects WHERE id = ?`

const checkInventoryMovementsOnApprove = whereIn => `
  SELECT im.id, im.quantity AS total_qty, SUM(imd.quantity) AS approved_qty
  FROM inventory_movements im
  LEFT JOIN inventory_movements_details imd ON imd.inventory_movement_id = im.id
  WHERE
    im.status <> '${types.inventoryMovementsStatus.CANCELLED}' AND
    im.status <> '${types.inventoryMovementsStatus.APPROVED}' AND
    im.id IN (${whereIn.join(', ')})
  GROUP BY im.id, imd.inventory_movement_id
`

const findDocumentForCertify = documentsType => {
  const documentTypeWhereValues = documentsType.map(dt => `d.document_type = '${dt}'`)

  return `
  SELECT
    d.id AS document_id,
    d.document_type AS document_type,
    d.stakeholder_id AS stakeholder_id,
    d.operation_id AS operation_id,
    d.project_id AS project_id,
    d.related_internal_document_id AS related_internal_document_id,
    d.related_external_document_id AS related_external_document_id,
    d.status AS status,
    d.status AS document_status,
    d.payment_method AS payment_method,
    d.subtotal_amount AS subtotal_amount,
    d.total_discount_amount AS total_discount_amount,
    d.total_tax_amount AS total_tax_amount,
    d.total_amount AS total_amount,
    d.credit_days AS credit_days,
    d.description AS description,
    d.serie AS serie,
    d.document_number AS document_number,
    d.uuid AS uuid,
    d.fact_date AS fact_date,
    d.created_by AS created_by,
    s.id AS stakeholder__id,
    s.name AS stakeholder__name,
    s.nit AS stakeholder__nit,
    s.address AS stakeholder__address,
    s.email AS stakeholder__email,
    s.phone AS stakeholder__phone,
    p.description AS products__description,
    p.code AS products__code,
    dp.product_id AS products__product_id,
    dp.product_price AS products__product_price,
    dp.service_type AS products__service_type,
    dp.product_quantity AS products__product_quantity,
    dp.discount_percentage AS products__discount_percentage,
    dp.parent_product_id AS products__parent_product_id
  FROM documents d
  LEFT JOIN documents_products dp ON dp.document_id = d.id
  LEFT JOIN products p ON p.id = dp.product_id
  LEFT JOIN stakeholders s ON s.id = d.stakeholder_id
  WHERE d.id = ? AND (${documentTypeWhereValues.join(' OR ')})
`
}

const checkDocumentByUuid = () => `
  SELECT id, status, uuid
  FROM documents
  WHERE uuid = ? AND uuid IS NOT NULL AND uuid <> ''
  LIMIT 1
`

module.exports = {
  checkInventoryMovementsOnApprove,
  checkProjectExists,
  findAllBy,
  findAllByCount,
  findCreditStatus,
  findInvoiceServiceType,
  findInvoiceStatus,
  findPaymentMethods,
  findDocumentForCertify,
  checkDocumentByUuid,
}
