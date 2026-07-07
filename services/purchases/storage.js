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
  `${alias}.document_type = '${types.documentsTypes.PURCHASE_ORDER}'`

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
    d.stakeholder_id,
    s.name AS stakeholder_name,
    s.business_man AS stakeholder_business_man,
    s.address AS stakeholder_address,
    s.phone AS stakeholder_phone,
    d.related_external_document_id,
    d.comments,
    d.status,
    d.start_date,
    d.created_at,
    d.created_by,
    d.updated_at,
    d.updated_by,
    p.id AS products__id,
    p.product_type AS products__product_type,
    p.status AS products__status,
    dp.product_price AS products__product_price,
    dp.product_quantity AS products__product_quantity,
    dp.tax_fee AS products__tax_fee,
    dp.unit_tax_amount AS products__unit_tax_amount,
    p.code AS products__code,
    p.serial_number AS products__serial_number,
    p.description AS products__description,
    p.image_url AS products__image_url,
    p.created_at AS products__created_at,
    p.created_by AS products__created_by
  FROM documents d
  LEFT JOIN stakeholders s ON s.id = d.stakeholder_id
  LEFT JOIN documents_products dp ON dp.document_id = d.id
  LEFT JOIN products p ON p.id = dp.product_id
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
  WHERE ${getDocumentTypeCondition('d')} ${getWhereConditions({ fields: filterFields, tableAlias: 'd' })}
`
}

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

module.exports = {
  checkInventoryMovementsOnApprove,
  findAllBy,
  findAllByCount,
}
