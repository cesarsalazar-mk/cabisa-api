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

const findAllBy = (fields = {}, initWhereCondition = `p.product_type = '${types.productsTypes.SERVICE}'`) => {
  const filterFields = stripPaginationFields(fields)
  const paginationSQL = buildPaginationSQL(fields)

  return `
  SELECT
    p.id,
    p.status,
    p.code,
    p.sales_category,
    p.description,
    p.created_at,
    p.created_by,
    p.updated_at,
    p.updated_by
  FROM products p
  WHERE ${initWhereCondition} ${getWhereConditions({ fields: filterFields, tableAlias: 'p' })}
  ORDER BY p.id DESC
  ${paginationSQL};
  `
}

const findAllByCount = (fields = {}, initWhereCondition = `p.product_type = '${types.productsTypes.SERVICE}'`) => {
  const filterFields = stripPaginationFields(fields)

  return `
  SELECT COUNT(*) AS total
  FROM products p
  WHERE ${initWhereCondition} ${getWhereConditions({ fields: filterFields, tableAlias: 'p' })};
  `
}

const findServicesStatus = () => `DESCRIBE products status`

const checkExists = (
  fields = {},
  initWhereCondition = `p.status = '${types.productsStatus.ACTIVE}' AND p.product_type = '${types.productsTypes.SERVICE}'`
) => `
  SELECT id FROM products p WHERE ${initWhereCondition} ${getWhereConditions({ fields })}
`

const findTaxIdExento = () => `SELECT id FROM taxes WHERE name = 'EXENTO'`

const createService = () => `
  INSERT INTO products (product_type, status, code, description, tax_id, sales_category, created_by, stock)
  VALUES('SERVICE', ?, ?, ?, ?, ?, ?, 1)
`

const updateService = () => `
  UPDATE products SET status = ?, code = ?, description = ?, sales_category = ?, updated_by = ? WHERE id = ?
`

const deleteService = () => `DELETE FROM products WHERE product_type = '${types.productsTypes.SERVICE}' AND id = ?`

module.exports = {
  checkExists,
  createService,
  deleteService,
  findAllBy,
  findAllByCount,
  findServicesStatus,
  findTaxIdExento,
  updateService,
}
