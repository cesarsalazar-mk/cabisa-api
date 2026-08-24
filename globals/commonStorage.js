const types = require('./types')
const { getWhereConditions } = require('./common')

const findProducts = (whereIn, extraWhereConditions = '') => `
  SELECT
    p.id AS product_id,
    p.description,
    p.code,
    p.product_type,
    p.stock,
    p.unit_price AS product_price,
    p.inventory_unit_value,
    p.inventory_total_value,
    t.fee AS tax_fee,
    p.created_by
  FROM products p
  LEFT JOIN taxes t ON t.id = p.tax_id
  WHERE p.id IN (${whereIn.join(', ')}) ${extraWhereConditions}
`

const findStakeholder = (fields = {}, initWhereCondition = `status = '${types.stakeholdersStatus.ACTIVE}'`) => `
  SELECT 
    id,
    id AS stakeholder_id,
    stakeholder_type,
    status,
    name,
    address,
    nit,
    email,
    credit_limit,
    total_credit,
    paid_credit,
    (total_credit - paid_credit) AS current_credit,
    phone,
    alternative_phone,
    business_man,
    payments_man,
    block_reason,
    created_at,
    created_by,
    updated_at,
    updated_by
  FROM stakeholders
  WHERE ${initWhereCondition} ${getWhereConditions({ fields })}
`

const findDocument = documentsType => {
  const documentTypeWhereValues = documentsType.map(dt => `d.document_type = '${dt}'`)

  return `
  SELECT
    d.id AS document_id,
    d.document_type AS document_type,
    d.stakeholder_id AS stakeholder_id,
    d.operation_id AS operation_id,
    o.operation_type AS operation_type,
    d.product_id AS product_id,
    d.project_id AS project_id,
    d.related_internal_document_id AS related_internal_document_id,
    d.related_external_document_id AS related_external_document_id,
    d.status AS status,
    d.status AS document_status,
    d.comments AS comments,
    d.received_by AS received_by,
    d.dispatched_by AS dispatched_by,
    d.start_date AS start_date,
    d.end_date AS end_date,
    d.payment_method AS payment_method,
    d.cancel_reason AS cancel_reason,
    d.subtotal_amount AS subtotal_amount,
    d.total_discount_amount AS total_discount_amount,
    d.total_tax_amount AS total_tax_amount,
    d.total_amount AS total_amount,
    d.credit_days AS credit_days,
    d.credit_status AS credit_status,
    d.paid_credit_amount AS paid_credit_amount,
    d.credit_paid_date AS credit_paid_date,
    d.credit_due_date AS credit_due_date,
    d.created_at AS created_at,
    d.created_by AS created_by,
    d.updated_at AS updated_at,
    d.updated_by AS updated_by,
    s.credit_limit AS stakeholder_credit_limit,
    s.total_credit AS stakeholder_total_credit,
    s.paid_credit AS stakeholder_paid_credit,
    im.id AS old_inventory_movements__inventory_movement_id,
    im.operation_id AS old_inventory_movements__operation_id,
    im.product_id AS old_inventory_movements__product_id,
    im.movement_type AS old_inventory_movements__movement_type,
    im.quantity AS old_inventory_movements__quantity,
    im.quantity AS old_inventory_movements__product_quantity,
    im.unit_cost AS old_inventory_movements__unit_cost,
    im.total_cost AS old_inventory_movements__total_cost,
    im.inventory_unit_cost AS old_inventory_movements__inventory_unit_cost,
    im.inventory_total_cost AS old_inventory_movements__inventory_total_cost,
    im.status AS old_inventory_movements__status,
    p.description AS old_products__description,
    p.code AS old_products__code,
    dp.product_id AS old_products__product_id,
    dp.product_price AS old_products__product_price,
    dp.product_quantity AS old_products__product_quantity,
    dp.tax_fee AS old_products__tax_fee,
    dp.unit_tax_amount AS old_products__unit_tax_amount,
    dp.parent_product_id AS old_products__parent_product_id,
    p.stock AS old_products__stock,
    p.inventory_unit_value AS old_products__inventory_unit_value,
    p.inventory_total_value AS old_products__inventory_total_value,
    p.created_by AS old_products__created_by,
    p.description AS products__description,
    p.code AS products__code,
    dp.product_id AS products__product_id,
    dp.product_price AS products__product_price,
    dp.service_type AS products__service_type,
    dp.product_quantity AS products__product_quantity,
    dp.tax_fee AS products__tax_fee,
    dp.unit_tax_amount AS products__unit_tax_amount,
    dp.parent_product_id AS products__parent_product_id,
    p.stock AS products__stock,
    p.stock AS products__product_stock,
    p.product_type AS products__product_type,
    p.status AS products__product_status,
    p.inventory_unit_value AS products__inventory_unit_value,
    p.inventory_total_value AS products__inventory_total_value,
    p.created_by AS products__created_by
  FROM documents d
  LEFT JOIN documents_products dp ON dp.document_id = d.id
  LEFT JOIN products p ON p.id = dp.product_id
  LEFT JOIN operations o ON o.id = d.operation_id
  LEFT JOIN inventory_movements im ON im.operation_id = o.id
  LEFT JOIN stakeholders s ON s.id = d.stakeholder_id
  WHERE d.id = ? AND (${documentTypeWhereValues.join(' OR ')})
`
}

const findDocumentMovements = documentsType => {
  const documentTypeWhereValues = documentsType.map(dt => `d.document_type = '${dt}'`)

  return `
    SELECT
      d.id AS document_id,
      d.product_id AS repair_product_id,
      d.related_internal_document_id AS related_internal_document_id,
      d.document_type AS document_type,
      d.end_date AS end_date,
      d.status AS document_status,
      d.operation_id AS operation_id,
      im.id AS inventory_movements__inventory_movement_id,
      im.movement_type AS inventory_movements__movement_type,
      im.product_id AS inventory_movements__product_id,
      im.quantity AS inventory_movements__quantity,
      im.quantity AS inventory_movements__product_quantity,
      p.stock AS inventory_movements__stock,
      p.status AS inventory_movements__product_status,
      p.product_type AS inventory_movements__product_type,
      p.unit_price AS inventory_movements__product_price
    FROM documents d
    LEFT JOIN operations o ON o.id = d.operation_id
    LEFT JOIN inventory_movements im ON im.operation_id = o.id
    LEFT JOIN products p ON p.id = im.product_id
    WHERE
      d.id = ? AND
      im.status <> '${types.inventoryMovementsStatus.CANCELLED}' AND
      (${documentTypeWhereValues.join(' OR ')})
  `
}

const updateProductsInventoryCosts = productsInventoryValues => `
  INSERT INTO products (id, inventory_unit_value, inventory_total_value, description, code, created_by, updated_by)
  VALUES ${productsInventoryValues.join(', ')}
  ON DUPLICATE KEY UPDATE
    inventory_unit_value = VALUES(inventory_unit_value),
    inventory_total_value = VALUES(inventory_total_value),
    description = VALUES(description),
    code = VALUES(code),
    created_by = VALUES(created_by),
    updated_by = VALUES(updated_by)
    
`

const findDocumentProduct = () => `
  SELECT
    d.id,
    d.product_id,
    p.description,
    p.code,
    p.inventory_unit_value AS product_price,
    p.stock,
    p.inventory_unit_value,
    p.inventory_total_value,
    p.created_by
  FROM documents d
  INNER JOIN products p ON p.id = d.product_id
  WHERE d.id = ?
`

const createFelLogDocument = () => `
  INSERT INTO log_documents (
    response_pdf,
    request,
    error,
    response_json,
    document_id,
    serie,
    created_by,
    uuid,
    cabisa_document_id,
    create_at,
    update_at
  )
  VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`

const updateDocumentStatus = () => `
  UPDATE documents
  SET status = ?, updated_by = ?
  WHERE id = ?
`

const updateDocumentFelCertification = () => `
  UPDATE documents
  SET
    serie = ?,
    document_number = ?,
    uuid = ?,
    fact_date = ?,
    status = ?,
    updated_by = ?
  WHERE id = ?
`

module.exports = {
  findProducts,
  findStakeholder,
  findDocument,
  findDocumentMovements,
  findDocumentProduct,
  updateProductsInventoryCosts,
  createFelLogDocument,
  updateDocumentStatus,
  updateDocumentFelCertification,
}
