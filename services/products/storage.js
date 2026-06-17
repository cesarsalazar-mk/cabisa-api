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

const getInitWhereConditionForAlias = (initWhereCondition, alias) =>
  initWhereCondition.replace(/\bp\./g, `${alias}.`)

const findAllBy = (fields = {}, initWhereCondition = `p.product_type = '${types.productsTypes.PRODUCT}'`) => {
  const filterFields = stripPaginationFields(fields)
  const paginationSQL = buildPaginationSQL(fields)
  const whereConditions = getWhereConditions({ fields: filterFields, tableAlias: 'p' })
  const paginationSubquery = paginationSQL
    ? `
  AND p.id IN (
    SELECT id FROM (
      SELECT p2.id
      FROM products p2
      WHERE ${getInitWhereConditionForAlias(initWhereCondition, 'p2')} ${getWhereConditions({
        fields: filterFields,
        tableAlias: 'p2',
      })}
      ORDER BY p2.id DESC
      ${paginationSQL}
    ) AS paginated_products
  )`
    : ''

  return `
  SELECT
    p.id,
    p.product_category,
    p.sales_category,
    p.status,
    p.code,
    p.serial_number,
    p.tax_id,
    t.fee AS tax_fee,
    t.name AS tax_name,
    p.stock,
    p.description,
    p.image_url,
    p.created_at,
    p.created_by,
    p.updated_at,
    p.updated_by,
    im.id AS product_history__inventory_movement_id,
    imd.created_at AS product_history__created_at,
    im.quantity AS product_history__quantity,
    im.unit_cost AS product_history__unit_cost,
    im.movement_type AS product_history__movement_type,
    im.status AS product_history__status,
    o.operation_type AS product_history__operation_type
  FROM products p
  LEFT JOIN taxes t ON t.id = p.tax_id
  LEFT JOIN inventory_movements im ON im.product_id = p.id
  LEFT JOIN inventory_movements_details imd ON imd.inventory_movement_id = im.id
  LEFT JOIN operations o ON o.id = im.operation_id
  WHERE ${initWhereCondition} ${whereConditions}
  ${paginationSubquery}
  ORDER BY p.id DESC
  `
}

const findAllByCount = (fields = {}, initWhereCondition = `p.product_type = '${types.productsTypes.PRODUCT}'`) => {
  const filterFields = stripPaginationFields(fields)

  return `
  SELECT COUNT(*) AS total
  FROM products p
  WHERE ${initWhereCondition} ${getWhereConditions({ fields: filterFields, tableAlias: 'p' })};
  `
}

const findProductsCategories = () => `DESCRIBE products product_category`

const findProductsStatus = () => `DESCRIBE products status`

const findProductsTaxes = () => `SELECT id, name, description, fee FROM taxes`

const checkExists = (fields = {}, initWhereCondition = `p.product_type = '${types.productsTypes.PRODUCT}'`) => `
  SELECT id FROM products p WHERE ${initWhereCondition} ${getWhereConditions({ fields })}
`

const createProduct = () => `
  INSERT INTO products (product_type, product_category, sales_category, status, code, serial_number, tax_id, description, image_url, created_by)
  VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`

const updateProduct = () => `
  UPDATE products SET product_category = ?, sales_category = ?, status = ?, code = ?, serial_number = ?, tax_id = ?, description = ?, image_url = ?, updated_by = ? WHERE id = ?
`

const deleteProduct = () => `DELETE FROM products WHERE product_type = '${types.productsTypes.PRODUCT}' AND id = ?`

// apply for services too
const findOptionsBy = (fields = {}) => `
  SELECT
    p.id,
    p.code,
    p.serial_number,
    p.description,
    t.fee AS tax_fee,
    t.name AS tax_name,
    p.stock,
    p.inventory_unit_value
  FROM products p
  LEFT JOIN taxes t ON t.id = p.tax_id
  ${getWhereConditions({ fields, tableAlias: 'p', hasPreviousConditions: false })}
`
const findOptionsByDescriptionAndCode = (fields = {},initWhereCondition = `(1 = 1)`) => 
{
  const rawWhereConditions = getWhereConditions({ fields, tableAlias: 'p' })
  const whereConditions = rawWhereConditions.replace(/p.nit/i, 'p.code')
  return `
  SELECT
    p.id,
    p.code,
    p.serial_number,
    p.description,
    t.fee AS tax_fee,
    t.name AS tax_name,
    p.stock,
    p.inventory_unit_value
  FROM products p
  LEFT JOIN taxes t ON t.id = p.tax_id
  WHERE ${initWhereCondition} ${whereConditions}
`
}

module.exports = {
  checkExists,
  createProduct,
  deleteProduct,
  findAllBy,
  findAllByCount,
  findOptionsBy,
  findProductsCategories,
  findProductsStatus,
  findProductsTaxes,
  updateProduct,
  findOptionsByDescriptionAndCode
}
