const { types, getWhereConditions, toGuatemalaDateSql } = require(`${process.env['FILE_ENVIRONMENT']}/globals`)

const buildAdjustmentWhereConditions = (fields = {}) =>
  getWhereConditions({ fields, tableAlias: 'ia', hasPreviousConditions: false })
    .replace(/ia\.start_date/gi, toGuatemalaDateSql('ia.created_at'))
    .replace(/ia\.end_date/gi, toGuatemalaDateSql('ia.created_at'))

const findAllBy = (fields = {}) => `
  SELECT
  im.id,
  im.operation_id,
  im.product_id,
  im.quantity,
  im.unit_cost,
  im.movement_type,
  im.status
  FROM inventory_movements im
  LEFT JOIN inventory_movements_details imd ON imd.inventory_movement_id = im.id
  LEFT JOIN operations o ON o.id = im.operation_id
  LEFT JOIN documents d ON d.operation_id = o.id
  ${getWhereConditions({ fields, tableAlias: 'im', hasPreviousConditions: false })}
  ORDER BY im.id DESC
`

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

const findAllAdjustmentsBy = (fields = {}) => `
  SELECT
  ia.id,
  ia.adjustment_reason,
  ia.created_at,
  ia.created_by,
  p.id AS products__id,
  p.product_type AS products__product_type,
  p.product_category AS products__product_category,
  p.status AS products__status,
  p.description AS products__description,
  p.code AS products__code,
  p.serial_number AS products__serial_number,
  p.stock AS products__current_stock,
  iap.preview_stock AS products__preview_stock,
  iap.next_stock AS products__next_stock
  FROM inventory_adjustments ia
  LEFT JOIN inventory_adjustments_products iap ON iap.inventory_adjustment_id = ia.id
  LEFT JOIN products p ON p.id = iap.product_id
  ${buildAdjustmentWhereConditions(fields)}
  ORDER BY ia.id DESC
`

const findAdjustmentProducts = whereIn => `
  SELECT
    p.id AS product_id,
    p.product_type,
    p.product_category,
    p.status,
    p.description,
    p.code,
    p.inventory_unit_value AS product_price,
    p.inventory_unit_value,
    p.inventory_total_value,
    p.stock,
    p.created_by
  FROM products p
  WHERE p.id IN (${whereIn.join(', ')})
`

const createInventoryAdjustment = () => `INSERT INTO inventory_adjustments (adjustment_reason, operation_id, created_by) VALUES(?, ?, ?)`

const createInventoryAdjustmentsProducts = valuesArray => `
  INSERT INTO inventory_adjustments_products (inventory_adjustment_id, product_id, preview_stock, next_stock)
  VALUES ${valuesArray.join(', ')}
`

module.exports = {
  createInventoryAdjustment,
  createInventoryAdjustmentsProducts,
  checkInventoryMovementsOnApprove,
  findAdjustmentProducts,
  findAllBy,
  findAllAdjustmentsBy,
}
