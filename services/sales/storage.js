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

const getDocumentTypeCondition = (alias = 'd') =>
  `${alias}.document_type = '${types.documentsTypes.RENT_PRE_INVOICE}'`

const findAllBy = (fields = {}) => {
  const filterFields = stripPaginationFields(fields)
  const paginationSQL = buildPaginationSQL(fields)
  const whereConditions = getWhereConditions({ fields: filterFields, tableAlias: 'd' })
  const paginationSubquery = paginationSQL
    ? `
  AND d.id IN (
    SELECT id FROM (
      SELECT d2.id
      FROM documents d2
      WHERE ${getDocumentTypeCondition('d2')} ${getWhereConditions({
        fields: filterFields,
        tableAlias: 'd2',
      })}
      ORDER BY d2.id DESC
      ${paginationSQL}
    ) AS paginated_documents
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
    d.comments,
    d.received_by,
    d.dispatched_by,
    d.start_date,
    d.end_date,
    d.cancel_reason,
    d.credit_days,
    u.full_name AS creator_name,
    d.created_at,
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
    prod.id AS products__id,
    prod.status AS products__status,
    dp.service_type AS products__service_type,
    dp.product_price AS products__unit_price,
    dp.product_quantity AS products__quantity,
    dp.tax_fee AS products__tax_fee,
    dp.unit_tax_amount AS products__unit_tax_amount,
    dp.parent_product_id AS products__parent_product_id,
    prod.code AS products__code,
    prod.serial_number AS products__serial_number,
    prod.description AS products__description
  FROM documents d
  INNER JOIN users u ON u.id = d.created_by
  INNER JOIN documents_products dp ON dp.document_id = d.id
  INNER JOIN products prod ON prod.id = dp.product_id
  INNER JOIN stakeholders s ON s.id = d.stakeholder_id
  INNER JOIN projects proj ON proj.id = d.project_id
  WHERE ${getDocumentTypeCondition('d')} ${whereConditions}
  ${paginationSubquery}
  ORDER BY d.id DESC
  `
}

const findAllByCount = (fields = {}) => {
  const filterFields = stripPaginationFields(fields)

  return `
  SELECT COUNT(*) AS total
  FROM documents d
  WHERE ${getDocumentTypeCondition('d')} ${getWhereConditions({ fields: filterFields, tableAlias: 'd' })};
  `
}

const findSalesStatus = () => `DESCRIBE documents status`

module.exports = {
  findAllBy,
  findAllByCount,
  findSalesStatus,
}
