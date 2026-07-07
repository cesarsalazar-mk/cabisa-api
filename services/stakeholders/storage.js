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

const getInitWhereConditionForAlias = (initWhereCondition, alias) =>
  initWhereCondition.replace(/\bp\./g, `${alias}.`)

const findAllBy = (fields = {}, initWhereCondition = `(p.is_active = 1 OR p.is_active IS NULL)`) => {
  const filterFields = stripPaginationFields(fields)
  const paginationSQL = buildPaginationSQL(fields)
  const whereConditions = getWhereConditions({ fields: filterFields, tableAlias: 's' })
  const initConditionSubquery = getInitWhereConditionForAlias(initWhereCondition, 'p2')
  const paginationSubquery = paginationSQL
    ? `
  AND s.id IN (
    SELECT id FROM (
      SELECT DISTINCT s2.id
      FROM stakeholders s2
      LEFT JOIN projects p2 ON p2.stakeholder_id = s2.id
      WHERE ${initConditionSubquery} ${getWhereConditions({ fields: filterFields, tableAlias: 's2' })}
      ORDER BY s2.id DESC
      ${paginationSQL}
    ) AS paginated_stakeholders
  )`
    : ''

  return `
  SELECT 
    s.id,
    s.stakeholder_type,
    s.status,
    s.name,
    s.address,
    s.nit,
    s.email,
    s.phone,
    s.alternative_phone,
    s.business_man,
    s.payments_man,
    s.credit_limit,
    s.total_credit,
    s.paid_credit,
    s.block_reason,
    s.created_at,
    s.created_by,
    s.updated_at,
    s.updated_by,
    p.id AS projects__id,
    p.name AS projects__name,
    p.start_date AS projects__start_date,
    p.end_date AS projects__end_date,
    p.created_at AS projects__created_at
  FROM stakeholders s
  LEFT JOIN projects p ON p.stakeholder_id = s.id
  WHERE ${initWhereCondition} ${whereConditions}
  ${paginationSubquery}
  ORDER BY s.id DESC
`
}

const findAllByCount = (fields = {}, initWhereCondition = `(p.is_active = 1 OR p.is_active IS NULL)`) => {
  const filterFields = stripPaginationFields(fields)

  return `
  SELECT COUNT(DISTINCT s.id) AS total
  FROM stakeholders s
  LEFT JOIN projects p ON p.stakeholder_id = s.id
  WHERE ${initWhereCondition} ${getWhereConditions({ fields: filterFields, tableAlias: 's' })}
`
}

const findStakeholderTypes = () => `DESCRIBE stakeholders stakeholder_type`

const findOptionsBy = (fields = {}, initWhereCondition = `status = 'ACTIVE'`) => `
  SELECT id, stakeholder_type, name, address, phone, business_man, address, email, nit
  FROM stakeholders
  WHERE ${initWhereCondition} ${getWhereConditions({ fields })}
`

const findProjectsOptionsBy = (fields = {}, initWhereCondition = `is_active = 1`) => `
  SELECT id, name FROM projects WHERE ${initWhereCondition} ${getWhereConditions({ fields })}
`

const checkExists = (fields = {}, initWhereCondition = `status = 'ACTIVE'`) => `
  SELECT id, stakeholder_type FROM stakeholders WHERE ${initWhereCondition} ${getWhereConditions({ fields })}
`

const updateStakeholder = () => `
  UPDATE stakeholders
  SET
    stakeholder_type = ?,
    name = ?,
    address = ?,
    nit = ?,
    email = ?,
    phone = ?,
    business_man = ?,
    payments_man = ?,
    credit_limit = ?,
    updated_by = ?
  WHERE id = ?
`

const setStatusStakeholder = () => 'UPDATE stakeholders SET status = ?, block_reason = ?, updated_by = ? WHERE id = ?'

const deleteProjects = projectIds => `
  UPDATE projects SET is_active = 0 WHERE stakeholder_id = ? AND id IN (${projectIds.join(', ')})
`

const crupdateProjects = valuesArray => `
  INSERT INTO projects (id, stakeholder_id, start_date, end_date, name, created_by)
  VALUES ${valuesArray.join(', ')}
  ON DUPLICATE KEY UPDATE
    start_date = VALUES(start_date),
    end_date = VALUES(end_date),
    name = VALUES(name),
    created_by = VALUES(created_by)
`

module.exports = {
  checkExists,
  crupdateProjects,
  deleteProjects,
  findAllBy,
  findAllByCount,
  findOptionsBy,
  findProjectsOptionsBy,
  findStakeholderTypes,
  setStatusStakeholder,
  updateStakeholder,
}
