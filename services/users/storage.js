const { getWhereConditions } = require(`${process.env['FILE_ENVIRONMENT']}/globals`)

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

const findAllBy = (fields = {}, initCondition = `u.is_active = 1`) => {
  const filterFields = stripPaginationFields(fields)
  const paginationSQL = buildPaginationSQL(fields)
  const whereConditions = getWhereConditions({ fields: filterFields, tableAlias: 'u' })
  const initConditionSubquery = initCondition.replace(/\bu\./g, 'u2.')
  const paginationSubquery = paginationSQL
    ? `
  AND u.id IN (
    SELECT id FROM (
      SELECT u2.id
      FROM users u2
      INNER JOIN roles r2 ON r2.id = u2.rol_id
      WHERE ${initConditionSubquery} ${getWhereConditions({ fields: filterFields, tableAlias: 'u2' })}
      ORDER BY u2.id DESC
      ${paginationSQL}
    ) AS paginated_users
  )`
    : ''

  return `
  SELECT
    u.id,
    u.full_name,
    u.email,
    u.sales_commission,
    u.rol_id,
    r.name AS rol_name,
    u.permissions AS permissions
  FROM users u
  INNER JOIN roles r ON r.id = u.rol_id
  WHERE ${initCondition} ${whereConditions}
  ${paginationSubquery}
  ORDER BY u.id DESC
`
}

const findAllByCount = (fields = {}, initCondition = `u.is_active = 1`) => {
  const filterFields = stripPaginationFields(fields)

  return `
  SELECT COUNT(*) AS total
  FROM users u
  INNER JOIN roles r ON r.id = u.rol_id
  WHERE ${initCondition} ${getWhereConditions({ fields: filterFields, tableAlias: 'u' })}
`
}

const findRoles = (fields = {}, initCondition = `is_active = 1`) => `
  SELECT id, name
  FROM roles
  WHERE ${initCondition} ${getWhereConditions({ fields })}
`

const findOptionsBy = (fields = {}, initCondition = `u.is_active = 1`) => `
  SELECT
    u.id,
    u.full_name
  FROM users u
  WHERE ${initCondition} ${getWhereConditions({ fields, tableAlias: 'u' })}
  ORDER BY u.full_name ASC
`

const checkExists = (fields = {}) => `SELECT id, email, password FROM users ${getWhereConditions({ fields, hasPreviousConditions: false })}`

const createUser = () => `
  INSERT INTO users (full_name, password, email, sales_commission, rol_id, is_active, permissions)
  VALUES(?, ?, ?, ?, ?, 1, (SELECT permissions FROM roles WHERE id = ?))
`

const updatePermissions = (newPermissions, id) => `UPDATE users SET permissions = '${newPermissions}' WHERE id = ${id}`

const findPassword = () => `SELECT password FROM users WHERE id = ?`

const updatePassword = () => `UPDATE users SET password = ? WHERE id = ?`

const updateUser = () => `UPDATE users SET full_name = ?, email = ?, sales_commission = ?, rol_id = ? WHERE id = ?`

const deleteUser = () => `UPDATE users SET is_active = 0 WHERE id = ?`

module.exports = {
  createUser,
  deleteUser,
  findAllBy,
  findAllByCount,
  findOptionsBy,
  findPassword,
  findRoles,
  updatePassword,
  updatePermissions,
  updateUser,
  checkExists,
}
