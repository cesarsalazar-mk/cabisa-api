const { types, getWhereConditions } = require(`${process.env['FILE_ENVIRONMENT']}/globals`)

const getClientAccountState = (fields = {}) => `
    SELECT
    s.id,
    s.stakeholder_type,
    CASE
    WHEN s.stakeholder_type = 'CLIENT_INDIVIDUAL' THEN 'CLIENTE INDIVIDUAL'
    WHEN s.stakeholder_type = 'CLIENT_COMPANY' THEN 'EMPRESA'
        ELSE 'NO DISPONIBLE' END as stakeholder_type_spanish,
    s.status,
    s.name,
    s.address,
    s.nit,
    s.email,
    s.phone,
    s.alternative_phone,
    s.business_man,
    s.payments_man,
    CASE
      WHEN s.credit_limit IS NULL THEN 0
      ELSE s.credit_limit END AS credit_limit,    
    CASE
      WHEN s.total_credit IS NULL THEN 0
      ELSE s.total_credit END AS total_credit,    
    CASE
      WHEN s.paid_credit IS NULL THEN 0
      ELSE s.paid_credit END AS paid_credit,
    s.block_reason,
    s.created_at,
    s.created_by,
    s.updated_at,
    s.updated_by,
    (SELECT
    SUM(dc.total_amount)
    FROM documents dc
    LEFT JOIN stakeholders sh ON sh.id = dc.stakeholder_id
    WHERE (
      dc.document_type = 'SELL_INVOICE' OR
      dc.document_type = 'RENT_INVOICE'
    )
    AND sh.id = s.id
    AND dc.status = 'APPROVED'
    ORDER BY dc.id DESC) AS total_charge
    FROM stakeholders s
    ${getWhereConditions({ fields, tableAlias: 's', hasPreviousConditions: false })}
    ORDER BY s.id DESC;  
`

const getAccountsReceivable = (fields = {}) => {
  const rawWhereConditions = getWhereConditions({ fields, tableAlias: 'd' })
  const whereConditions = rawWhereConditions.replace(/d.stakeholder_type/i, 's.stakeholder_type').replace(/d.stakeholder_name/i, 's.name')

  return `
    SELECT
      d.id,
      d.document_type,
      d.stakeholder_id,
      s.stakeholder_type,
      s.name AS stakeholder_name,
      d.status,
      d.comments,
      d.description,
      d.subtotal_amount,
      d.total_amount,
      d.credit_status,
      d.paid_credit_amount,
      (d.total_amount - d.paid_credit_amount) AS unpaid_credit_amount,
      d.created_at AS document_date,
      d.credit_due_date,
      d.credit_paid_date
    FROM documents d
    LEFT JOIN stakeholders s ON s.id = d.stakeholder_id
    WHERE (
      (
        d.document_type = '${types.documentsTypes.SELL_INVOICE}' OR
        d.document_type = '${types.documentsTypes.RENT_INVOICE}'
      ) OR (
        (
          d.document_type = '${types.documentsTypes.SELL_PRE_INVOICE}' OR
          d.document_type = '${types.documentsTypes.RENT_PRE_INVOICE}'
        )
        AND d.related_internal_document_id IS NULL
      )
    ) AND d.status <> '${types.documentsStatus.CANCELLED}'
    AND d.credit_status IS NOT NULL ${whereConditions}
    ORDER BY d.id DESC
  `
}

const getSales = (fields = {}) => {
  const rawWhereConditions = getWhereConditions({ fields, tableAlias: 'd' })
  const includeInvoices = /d.document_type = 'INVOICES'/i.test(rawWhereConditions)
  const includePreInvoices = /d.document_type = 'PRE_INVOICE'/i.test(rawWhereConditions)
  const includeBoth = !includeInvoices && !includePreInvoices
  const whereConditions = rawWhereConditions
    .replace(/d.client_id/i, 's.id')
    .replace(/AND d.document_type = 'INVOICES'/i, '')
    .replace(/AND d.document_type = 'PRE_INVOICE'/i, '')
    .replace(/start_date/i, 'created_at')
    .replace(/end_date/i, 'created_at')
    .replace(/d.seller_id/i, 'u.id')

  const invoicesWhereConditions =
    includeInvoices || includeBoth
      ? `(
      d.document_type = '${types.documentsTypes.SELL_INVOICE}' OR      
      d.document_type = '${types.documentsTypes.RENT_INVOICE}'
    )`
      : ''

  const preInvoicesWhereConditions =
    includePreInvoices || includeBoth
      ? `(d.document_type = '${types.documentsTypes.RENT_PRE_INVOICE}' AND d.related_internal_document_id IS NULL)`
      : ''

  const documentTypeWhereOperator = (includeInvoices && includePreInvoices) || includeBoth ? 'OR' : ''

  return `
    SELECT
      d.id,
      d.dispatched_by,
      d.received_by,      
      d.related_internal_document_id,
      d.credit_status,
      CASE
        WHEN d.credit_status = 'UNPAID' THEN 'PAGO PENDIENTE'
        WHEN d.credit_status = 'PAID' THEN 'PAGADO'
        WHEN d.credit_status = 'DEFAULT' THEN 'EN MORA'
        ELSE 'NO DISPONIBLE' END as credit_status_spanish,
      d.document_number,
      CASE
      WHEN d.document_number IS NULL THEN 'Factura Sistema'
      ELSE d.document_number END AS document_number_report,
      d.document_type,
      CASE
        WHEN d.document_type = 'SELL_INVOICE' THEN 'Factura manual'
        WHEN d.document_type = 'RENT_INVOICE' THEN 'Nota de servicio'        
        ELSE 'NO DISPONIBLE' END as document_type_spanish,
      d.stakeholder_id,
      s.stakeholder_type,
      s.name AS stakeholder_name,
      s.business_man,
      s.payments_man,
      s.address,
      s.phone,
      s.email,
      d.payment_method,
      CASE
        WHEN d.payment_method = 'CASH' THEN 'EFECTIVO'
        WHEN d.payment_method = 'CARD' THEN 'CREDITO'
        WHEN d.payment_method = 'CHECK' THEN 'CHEQUE'
        WHEN d.payment_method = 'DEPOSIT' THEN 'DEPOSITO'
        WHEN d.payment_method = 'TRANSFER' THEN 'TRANSFERENCIA'
            ELSE 'NO DISPONIBLE' END as payment_method_spanish,
      d.status,
      d.sales_commission_amount,
      d.total_amount,
      d.paid_credit_amount,
      d.created_at,
      u.sales_commission,
      d.created_by AS seller_id,
      u.full_name AS seller_name
    FROM documents d
    LEFT JOIN stakeholders s ON s.id = d.stakeholder_id
    LEFT JOIN users u ON u.id = d.created_by
    WHERE ${includeBoth ? '(' : ''}
        ${invoicesWhereConditions} ${documentTypeWhereOperator} ${preInvoicesWhereConditions}
      ${includeBoth ? ')' : ''} AND
      d.status = '${types.documentsStatus.APPROVED}'
      ${whereConditions}
    ORDER BY d.id DESC
  `
}

const getInventory = (fields = {}) => {
  const rawWhereConditions = getWhereConditions({ fields, tableAlias: 'p' })
  const whereConditions = rawWhereConditions.replace(/p.start_date/i, 'imd.created_at').replace(/p.end_date/i, 'imd.created_at').replace(/p.product_id/i, 'p.id')

  // Las siguientes dos lineas se agregaron a la query asumiendo que no existen movimientos parciales de inventario
  // De llegar a existir se debe presentar la informacion de otra manera
  //    imd.created_at AS inventory_movements__created_at,
  //    u.full_name AS inventory_movements__creator_name,

  return `
      SELECT
        p.id AS product_id,
        p.description,
        p.code,
        p.serial_number,
        p.product_type,
        CASE
      WHEN p.product_category = 'EQUIPMENT' THEN 'EQUIPO'
      WHEN p.product_category = 'SERVICE' THEN 'SERVICIO'
      WHEN p.product_category = 'PART' THEN 'REPUESTO'
      ELSE 'NO DISPONIBLE' END as product_category_spanish,
        p.product_category,
        p.status,
        p.stock,
        p.inventory_unit_value,
        p.inventory_total_value,
        im.id AS inventory_movements__inventory_movement_id,
        im.product_id AS inventory_movements__product_id,
        im.quantity AS inventory_movements__quantity,
        im.unit_cost AS inventory_movements__unit_cost,
        im.total_cost AS inventory_movements__total_cost,
        im.inventory_quantity AS inventory_movements__inventory_quantity,
        im.inventory_unit_cost AS inventory_movements__inventory_unit_cost,
        im.inventory_total_cost AS inventory_movements__inventory_total_cost,
        o.operation_type AS inventory_movements__operation_type,
        im.movement_type AS inventory_movements__movement_type,
        im.status AS inventory_movements__status,
        imd.created_at AS inventory_movements__created_at,
        u.full_name AS inventory_movements__creator_name,
        imd.inventory_movement_id AS inventory_movements_details__inventory_movement_id,
        im.product_id AS inventory_movements_details__product_id,
        imd.quantity AS inventory_movements_details__quantity,
        imd.storage_location AS inventory_movements_details__storage_location,
        imd.comments AS inventory_movements_details__comments,
        imd.created_at AS inventory_movements_details__created_at,
        imd.created_by AS inventory_movements_details__creator_id,
        u.full_name AS inventory_movements_details__creator_name
      FROM products p
      LEFT JOIN inventory_movements im ON im.product_id = p.id
      LEFT JOIN operations o ON o.id = im.operation_id
      LEFT JOIN inventory_movements_details imd ON imd.inventory_movement_id = im.id
      LEFT JOIN users u ON u.id = imd.created_by
      WHERE (        
        im.status = '${types.inventoryMovementsStatus.APPROVED}'
      ) ${whereConditions}
      ORDER BY im.operation_id, im.id
    `
}

const getInvoice = (fields = {}) => {
  const rawWhereConditions = getWhereConditions({ fields, tableAlias: 'd' })  
  const whereConditions = rawWhereConditions.replace(/d.nit/i, 's.nit').replace(/d.name/i, 's.name').replace(/d.start_date/i, 'DATE(d.created_at)').replace(/d.end_date/i, 'DATE(d.created_at)')
  return `
    SELECT
      d.id,
      d.serie,
      d.document_number,
      d.related_internal_document_id,
      d.uuid,
      d.document_type,
      d.stakeholder_id,
      s.name AS stakeholder_name,
      s.nit AS stakeholder_nit,
      s.stakeholder_type AS stakeholder_type,
      s.email AS stakeholder_email,
      s.phone AS stakeholder_phone,
      s.address AS stakeholder_address,
      d.operation_id,
      d.status,
      CASE
        WHEN d.status = 'APPROVED' THEN 'APROBADO'
        WHEN d.status = 'CANCELLED' THEN 'ANULADO'
            ELSE 'NO DISPONIBLE' END as status_spanish,
      d.cancel_reason,
      d.description,
      d.subtotal_amount AS subtotal,
      d.total_discount_amount AS discount,
      d.total_tax_amount AS total_tax,
      d.total_amount AS total,
      d.payment_method,
      CASE
        WHEN d.payment_method = 'CASH' THEN 'EFECTIVO'
        WHEN d.payment_method = 'CARD' THEN 'CREDITO'
            ELSE 'NO DISPONIBLE' END as payment_method_spanish,
      d.credit_days,
      d.credit_status,
      d.created_at,
      d.created_by,
      d.updated_at,
      d.updated_by,
      proj.id AS project_id,
      proj.name AS project_name,
      prod.id AS products__id,
      prod.product_type AS products__product_type,
      prod.status AS products__status,
      prod.code AS products__code,
      prod.serial_number AS products__serial_number,
      prod.description AS products__description,
      prod.image_url AS products__image_url,
      prod.created_at AS products__created_at,
      prod.created_by AS products__created_by,
      dp.service_type AS products__service_type,
      dp.document_id AS products__document_id,
      dp.product_price AS products__product_price,
      dp.product_quantity AS products__product_quantity,
      dp.tax_fee AS products__tax_fee,
      dp.unit_tax_amount AS products__unit_tax_amount,
      dp.discount_percentage AS products__discount_percentage,
      dp.unit_discount_amount AS products__unit_discount_amount,
      dp.parent_product_id AS products__parent_product_id
    FROM documents d
    LEFT JOIN projects proj ON proj.id = d.project_id
    LEFT JOIN stakeholders s ON s.id = d.stakeholder_id
    LEFT JOIN documents_products dp ON dp.document_id = d.id
    LEFT JOIN products prod ON prod.id = dp.product_id
    WHERE (
      d.document_type = '${types.documentsTypes.SELL_INVOICE}' OR
      d.document_type = '${types.documentsTypes.RENT_INVOICE}'
    ) ${whereConditions}
    ORDER BY d.id DESC
  `
}

const getReceipts = (fields = {}) => {
  const rawWhereConditions = getWhereConditions({ fields, tableAlias: 'd' })
  const whereConditions = rawWhereConditions.replace(/d.nit/i, 's.nit').replace(/d.name/i, 's.name').replace(/d.start_date/i, 'DATE(d.created_at)').replace(/d.end_date/i, 'DATE(d.created_at)')

  return `
    SELECT
      d.id,
      d.document_number,
      d.related_internal_document_id,
      d.document_type,
      d.stakeholder_id,
      s.name AS stakeholder_name,
      s.nit AS stakeholder_nit,
      s.stakeholder_type AS stakeholder_type,
      s.email AS stakeholder_email,
      s.phone AS stakeholder_phone,
      s.address AS stakeholder_address,
      d.operation_id,
      d.status,
      d.cancel_reason,
      d.description,
      d.subtotal_amount,
      d.total_discount_amount,
      d.total_tax_amount,
      d.total_amount,
      CASE
        WHEN d.payment_method = 'CASH' THEN 'EFECTIVO'
        WHEN d.payment_method = 'CARD' THEN 'CREDITO'
        WHEN d.payment_method = 'CHECK' THEN 'CHEQUE'
        WHEN d.payment_method = 'DEPOSIT' THEN 'DEPOSITO'
        WHEN d.payment_method = 'TRANSFER' THEN 'TRANSFERENCIA'
            ELSE 'NO DISPONIBLE' END as payment_method_spanish,
      d.payment_method,
      d.credit_days,
      d.credit_status,
      CASE
        WHEN d.credit_status = 'UNPAID' THEN 'PAGO PENDIENTE'
        WHEN d.credit_status = 'PAID' THEN 'PAGADO'
        WHEN d.credit_status = 'DEFAULT' THEN 'EN MORA'
          ELSE 'NO DISPONIBLE' END as credit_status_spanish,
      d.created_at,
      d.created_by,
      d.updated_at,
      d.updated_by,
      proj.id AS project_id,
      proj.name AS project_name,
      prod.id AS products__id,
      prod.product_type AS products__product_type,
      prod.status AS products__status,
      prod.code AS products__code,
      prod.serial_number AS products__serial_number,
      prod.description AS products__description,
      prod.image_url AS products__image_url,
      prod.created_at AS products__created_at,
      prod.created_by AS products__created_by,
      dp.service_type AS products__service_type,      
    CASE
      WHEN dp.service_type = 'EQUIPMENT' THEN 'EQUIPO'
      WHEN dp.service_type = 'SERVICE' THEN 'SERVICIO'
      WHEN dp.service_type = 'PART' THEN 'REPUESTO'
      ELSE 'NO DISPONIBLE' END as products__service_type_spanish,
      dp.document_id AS products__document_id,
      dp.product_price AS products__product_price,
      dp.product_quantity AS products__product_quantity,
      dp.tax_fee AS products__tax_fee,
      dp.unit_tax_amount AS products__unit_tax_amount,
      dp.discount_percentage AS products__discount_percentage,
      dp.unit_discount_amount AS products__unit_discount_amount,
      dp.parent_product_id AS products__parent_product_id,
      (dp.unit_tax_amount + dp.product_price) as products__total_product_amount,
      pay.id AS payments__id,
      pay.id AS payments__payment_id,
      pay.document_id AS payments__document_id,
      pay.payment_amount AS payments__payment_amount,
      pay.payment_method AS payments__payment_method,
      CASE
        WHEN pay.payment_method = 'CASH' THEN 'EFECTIVO'
        WHEN pay.payment_method = 'CARD' THEN 'CREDITO'
        WHEN pay.payment_method = 'CHECK' THEN 'CHEQUE'
        WHEN pay.payment_method = 'DEPOSIT' THEN 'DEPOSITO'
        WHEN pay.payment_method = 'TRANSFER' THEN 'TRANSFERENCIA'
            ELSE 'NO DISPONIBLE' END as payments__payment_method_spanish,
      pay.payment_date AS payments__payment_date,
      pay.related_external_document AS payments__related_external_document,
      pay.description AS payments__description,
      pay.is_deleted AS payments__is_deleted,
      pay.created_at AS payments__created_at,
      pay.created_by AS payments__created_by
    FROM documents d
    LEFT JOIN projects proj ON proj.id = d.project_id
    LEFT JOIN stakeholders s ON s.id = d.stakeholder_id
    LEFT JOIN documents_products dp ON dp.document_id = d.id
    LEFT JOIN products prod ON prod.id = dp.product_id
    LEFT JOIN payments pay ON pay.document_id = d.id
    WHERE (
      d.document_type = '${types.documentsTypes.SELL_INVOICE}' OR
      d.document_type = '${types.documentsTypes.RENT_INVOICE}'
    ) ${whereConditions}
    AND d.status = 'APPROVED'
    ORDER BY d.id DESC
  `
}

const getManualReceipts = (fields = {}) => {
  const rawWhereConditions = getWhereConditions({ fields, tableAlias: 'd' })
  const whereConditions = rawWhereConditions.replace(/d.nit/i, 's.nit').replace(/d.name/i, 's.name').replace(/d.start_date/i, 'DATE(d.created_at)').replace(/d.end_date/i, 'DATE(d.created_at)')

  return `
  SELECT
  d.id,
  d.created_at,
  d.status,
  CASE
  WHEN d.status = 'UNPAID' THEN 'PAGO PENDIENTE'
  WHEN d.status = 'PAID' THEN 'PAGADO'
  WHEN d.status = 'DEFAULT' THEN 'EN MORA'
    ELSE 'NO DISPONIBLE' END as status_spanish,
  d.total_amount,
  d.stakeholder_id,
  s.name AS stakeholder_name,
  s.nit AS stakeholder_nit,
  s.stakeholder_type AS stakeholder_type,
  s.email AS stakeholder_email,
  s.phone AS stakeholder_phone,
  s.address AS stakeholder_address,
  proj.id AS project_id,
  proj.name AS project_name,
  paydetail.related_external_document AS payments__related_external_document,
  paydetail.id AS payments__id,
  paydetail.id AS payments__payment_id,
  d.id AS payments__document_id,
  paydetail.payment_amount AS payments__payment_amount,
  paydetail.payment_method AS payments__payment_method,
  paydetail.payment_date AS payments__payment_date,
  paydetail.description AS payments__description,
  paydetail.is_deleted AS payments__is_deleted,
  paydetail.created_at AS payments__created_at,
  paydetail.created_by AS payments__created_by
FROM manual_payments d
LEFT JOIN manual_payments_detail paydetail on d.id = paydetail.manual_payment
LEFT JOIN projects proj ON d.project_id = proj.id
LEFT JOIN stakeholders s ON d.stakeholder_id = s.id
    WHERE 1 = 1      
    ${whereConditions}
    ORDER BY d.id DESC
  `
}

const getServiceOrders = (fields = {}) => {
const rawWhereConditions = getWhereConditions({ fields, tableAlias: 'd' })
const whereConditions = rawWhereConditions.replace(/d.name/i, 's.name').replace(/d.start_date/i, 'DATE(d.start_date)')
return `
  SELECT
    d.id,
    d.document_type,
    d.stakeholder_id,
    d.operation_id,
    d.related_internal_document_id,
    d.related_external_document_id,
    d.status,
    CASE
        WHEN d.status = 'PENDING' THEN 'PENDIENTE'
        WHEN d.status = 'CANCELLED' THEN 'ANULADO'
        WHEN d.status = 'APPROVED' THEN 'APROBADO'
        ELSE 'NO DISPONIBLE' END as status_spanish,
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
    proj.start_date as project_start_date,
    proj.end_date as project_end_date,
    prod.id AS products__id,
    prod.status AS products__status,
    dp.service_type AS products__service_type,
    CASE
      WHEN dp.service_type = 'EQUIPMENT' THEN 'EQUIPO'
      WHEN dp.service_type = 'SERVICE' THEN 'SERVICIO'
      WHEN dp.service_type = 'PART' THEN 'REPUESTO'
      ELSE 'NO DISPONIBLE' END as products__service_type_spanish,
    dp.product_price AS products__unit_price,
    dp.product_quantity AS products__quantity,
    dp.tax_fee AS products__tax_fee,
    dp.unit_tax_amount AS products__unit_tax_amount,
    dp.parent_product_id AS products__parent_product_id,
    (dp.unit_tax_amount + dp.product_price) as products__total_product_amount,
    prod.code AS products__code,
    prod.serial_number AS products__serial_number,
    prod.description AS products__description
  FROM documents d
  INNER JOIN users u ON u.id = d.created_by
  INNER JOIN documents_products dp ON dp.document_id = d.id
  INNER JOIN products prod ON prod.id = dp.product_id
  INNER JOIN stakeholders s ON s.id = d.stakeholder_id
  INNER JOIN projects proj ON proj.id = d.project_id
  WHERE d.document_type = '${types.documentsTypes.RENT_PRE_INVOICE}' 
  ${whereConditions}
  ORDER BY d.id DESC
  LIMIT 200
`
}

const LINE_ITEM_TOTAL = '(dp.product_price + dp.unit_tax_amount - IFNULL(dp.unit_discount_amount, 0)) * dp.product_quantity'

const SALES_PRODUCT_REPORT_BASE_FROM = `
    FROM products prod
    INNER JOIN documents_products dp ON prod.id = dp.product_id
    INNER JOIN documents d ON dp.document_id = d.id AND d.status = 'APPROVED'
    WHERE (d.document_type = 'SELL_INVOICE' OR d.document_type = 'RENT_INVOICE')`

const buildSalesProductReportWhere = (fields = {}) => {
  const rawWhereConditions = getWhereConditions({ fields, tableAlias: 'd' })

  return rawWhereConditions
    .replace(/d\.code/gi, 'prod.code')
    .replace(/d\.description/gi, 'prod.description')
    .replace(/d\.start_date/gi, 'DATE(d.created_at)')
    .replace(/d\.end_date/gi, 'DATE(d.created_at)')
    .replace(/d\.product_type/gi, 'prod.product_type')
}

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

const getSalesProductReport = (fields = {}) => {
  const whereConditions = buildSalesProductReportWhere(stripPaginationFields(fields))
  const paginationSQL = buildPaginationSQL(fields)

  return `
  SELECT
        prod.id AS id,
        prod.code AS code,
        prod.description AS description,
        prod.product_type AS product_type,
        SUM(dp.product_quantity) AS product_quantity,
        SUM(${LINE_ITEM_TOTAL}) AS total_amount
    ${SALES_PRODUCT_REPORT_BASE_FROM}
    ${whereConditions}
    GROUP BY prod.id
    ORDER BY product_quantity DESC
    ${paginationSQL};
  `
}

const getSalesProductReportCount = (fields = {}) => {
  const whereConditions = buildSalesProductReportWhere(stripPaginationFields(fields))

  return `
  SELECT COUNT(*) AS total
  FROM (
    SELECT prod.id
    ${SALES_PRODUCT_REPORT_BASE_FROM}
    ${whereConditions}
    GROUP BY prod.id
  ) AS grouped_items;
  `
}

const getSalesProductReportSummary = (fields = {}) => {
  const whereConditions = buildSalesProductReportWhere(fields)

  return `
  SELECT
    prod.product_type AS product_type,
    SUM(dp.product_quantity) AS total_quantity,
    SUM(${LINE_ITEM_TOTAL}) AS total_amount
  ${SALES_PRODUCT_REPORT_BASE_FROM}
  ${whereConditions}
  GROUP BY prod.product_type;
  `
}

const getTopSoldItem = (fields = {}, productType) => {
  const whereConditions = buildSalesProductReportWhere(fields)

  return `
  SELECT
    prod.code AS code,
    prod.description AS description,
    SUM(dp.product_quantity) AS product_quantity,
    SUM(${LINE_ITEM_TOTAL}) AS total_amount
  ${SALES_PRODUCT_REPORT_BASE_FROM}
  AND prod.product_type = '${productType}'
  ${whereConditions}
  GROUP BY prod.id
  ORDER BY product_quantity DESC
  LIMIT 1;
  `
}

module.exports = {
  getAccountsReceivable,
  getClientAccountState,
  getInventory,
  getSales,
  getInvoice,
  getReceipts,
  getManualReceipts,
  getServiceOrders,
  getSalesProductReport,
  getSalesProductReportCount,
  getSalesProductReportSummary,
  getTopSoldItem,
  stripPaginationFields,
}
