const { getWhereConditions } = require(`${process.env['FILE_ENVIRONMENT']}/globals`)

const stripPaginationFields = (fields = {}) => {
  const { $limit, $offset, ...filterFields } = fields

  return filterFields
}

const buildPaginationSQL = ({ $limit, $offset } = {}) => ($limit ? `LIMIT ${$limit}${$offset ? ` OFFSET ${$offset}` : ''}` : '')

const findAllBy = (fields = {}, initWhereCondition = `is_active = 1`) => `
  SELECT id, name, email, phone, commission_percentage, created_at, created_by, updated_at, updated_by
  FROM sellers
  WHERE ${initWhereCondition} ${getWhereConditions({ fields: stripPaginationFields(fields) })}
  ORDER BY id DESC
  ${buildPaginationSQL(fields)}
`

const findAllByCount = (fields = {}, initWhereCondition = `is_active = 1`) => `
  SELECT COUNT(*) AS total
  FROM sellers
  WHERE ${initWhereCondition} ${getWhereConditions({ fields: stripPaginationFields(fields) })}
`

const createSeller = () => `
  INSERT INTO sellers (name, email, phone, commission_percentage, created_by) VALUES (?, ?, ?, ?, ?)
`

const updateSeller = () => `
  UPDATE sellers SET name = ?, email = ?, phone = ?, commission_percentage = ?, updated_by = ? WHERE id = ? AND is_active = 1
`

const deleteSeller = () => `UPDATE sellers SET is_active = 0, updated_by = ? WHERE id = ?`

module.exports = {
  createSeller,
  deleteSeller,
  findAllBy,
  findAllByCount,
  updateSeller,
}
