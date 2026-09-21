const { getWhereConditions } = require(`${process.env['FILE_ENVIRONMENT']}/globals`)

// $limit/$offset y include_inactive no son columnas: se quitan antes de armar el WHERE
const stripSpecialFields = (fields = {}) => {
  const { $limit, $offset, include_inactive, ...filterFields } = fields

  return filterFields
}

const getInitWhereCondition = (fields = {}) => (String(fields.include_inactive) === '1' ? '1 = 1' : 'is_active = 1')

const buildPaginationSQL = ({ $limit, $offset } = {}) => ($limit ? `LIMIT ${$limit}${$offset ? ` OFFSET ${$offset}` : ''}` : '')

const findAllBy = (fields = {}) => `
  SELECT id, name, email, phone, commission_percentage, is_active, created_at, created_by, updated_at, updated_by
  FROM sellers
  WHERE ${getInitWhereCondition(fields)} ${getWhereConditions({ fields: stripSpecialFields(fields) })}
  ORDER BY id DESC
  ${buildPaginationSQL(fields)}
`

const findAllByCount = (fields = {}) => `
  SELECT COUNT(*) AS total
  FROM sellers
  WHERE ${getInitWhereCondition(fields)} ${getWhereConditions({ fields: stripSpecialFields(fields) })}
`

const createSeller = () => `
  INSERT INTO sellers (name, email, phone, commission_percentage, created_by) VALUES (?, ?, ?, ?, ?)
`

const updateSeller = () => `
  UPDATE sellers SET name = ?, email = ?, phone = ?, commission_percentage = ?, updated_by = ? WHERE id = ? AND is_active = 1
`

const reactivateSeller = () => `UPDATE sellers SET is_active = 1, updated_by = ? WHERE id = ?`

const deleteSeller = () => `UPDATE sellers SET is_active = 0, updated_by = ? WHERE id = ?`

module.exports = {
  createSeller,
  deleteSeller,
  findAllBy,
  findAllByCount,
  reactivateSeller,
  updateSeller,
}
