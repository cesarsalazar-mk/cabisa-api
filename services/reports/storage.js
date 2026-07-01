const { types, getWhereConditions } = require(`${process.env['FILE_ENVIRONMENT']}/globals`)

const CLIENT_CHARGES_SUBQUERY = `
  COALESCE((
    SELECT SUM(dc.total_amount)
    FROM documents dc
    WHERE (
      dc.document_type = '${types.documentsTypes.SELL_INVOICE}' OR
      dc.document_type = '${types.documentsTypes.RENT_INVOICE}'
    )
    AND dc.stakeholder_id = s.id
    AND dc.status = '${types.documentsStatus.APPROVED}'
  ), 0)`

const parseClientAccountFilterFields = (fields = {}) => {
  const { $limit, $offset, debt_status, ...filterFields } = fields

  return { filterFields, debt_status: debt_status || '' }
}

const buildClientAccountInnerQuery = (filterFields = {}) => {
  const whereConditions = getWhereConditions({
    fields: filterFields,
    tableAlias: 's',
    hasPreviousConditions: false,
  })

  return `
    SELECT
      s.id,
      s.stakeholder_type,
      CASE
        WHEN s.stakeholder_type = 'CLIENT_INDIVIDUAL' THEN 'CLIENTE INDIVIDUAL'
        WHEN s.stakeholder_type = 'CLIENT_COMPANY' THEN 'EMPRESA'
        ELSE 'NO DISPONIBLE'
      END AS stakeholder_type_spanish,
      s.status,
      s.name,
      s.address,
      s.nit,
      s.email,
      s.phone,
      s.alternative_phone,
      s.business_man,
      s.payments_man,
      CASE WHEN s.credit_limit IS NULL THEN 0 ELSE s.credit_limit END AS credit_limit,
      CASE WHEN s.total_credit IS NULL THEN 0 ELSE s.total_credit END AS total_credit,
      CASE WHEN s.paid_credit IS NULL THEN 0 ELSE s.paid_credit END AS paid_credit,
      s.block_reason,
      s.created_at,
      s.created_by,
      s.updated_at,
      s.updated_by,
      ${CLIENT_CHARGES_SUBQUERY} AS total_charge
    FROM stakeholders s
    ${whereConditions}
  `
}

const buildClientAccountOuterQuery = (fields = {}, { withPagination = true } = {}) => {
  const { filterFields, debt_status } = parseClientAccountFilterFields(
    withPagination ? fields : stripPaginationFields(fields)
  )
  const paginationSQL = withPagination ? buildPaginationSQL(fields) : ''
  const debtFilter = buildClientAccountDebtFilter(debt_status)

  return `
    SELECT
      clients.*,
      (clients.total_charge - clients.paid_credit) AS credit_balance_raw
    FROM (
      ${buildClientAccountInnerQuery(filterFields)}
    ) clients
    WHERE 1=1 ${debtFilter}
    ORDER BY clients.id DESC
    ${paginationSQL}
  `
}

const buildClientAccountDebtFilter = (debtStatus = '') => {
  if (debtStatus === 'WITH_DEBT') {
    return ' AND (clients.total_charge - clients.paid_credit) > 0'
  }

  if (debtStatus === 'WITHOUT_DEBT') {
    return ' AND (clients.total_charge - clients.paid_credit) <= 0'
  }

  return ''
}

const getClientAccountState = (fields = {}) => `${buildClientAccountOuterQuery(fields)};`

const getClientAccountStateCount = (fields = {}) => `
  SELECT COUNT(*) AS total
  FROM (
    ${buildClientAccountOuterQuery(fields, { withPagination: false })}
  ) AS counted_clients;
`

const getClientAccountStateSummary = (fields = {}) => {
  const { filterFields } = parseClientAccountFilterFields(stripPaginationFields(fields))

  return `
  SELECT
    COUNT(*) AS total_clients,
    SUM(CASE WHEN (clients.total_charge - clients.paid_credit) > 0 THEN 1 ELSE 0 END) AS clients_with_debt,
    SUM(CASE WHEN (clients.total_charge - clients.paid_credit) <= 0 THEN 1 ELSE 0 END) AS clients_without_debt,
    SUM(clients.total_charge) AS total_credit,
    SUM(clients.paid_credit) AS total_paid_credit,
    SUM(clients.total_charge - clients.paid_credit) AS total_credit_balance,
    SUM(
      CASE
        WHEN (clients.total_charge - clients.paid_credit) > 0
        THEN (clients.total_charge - clients.paid_credit)
        ELSE 0
      END
    ) AS total_debt_balance,
    SUM(
      CASE
        WHEN (clients.total_charge - clients.paid_credit) > 0
        THEN clients.total_charge
        ELSE 0
      END
    ) AS total_debt_charge,
    SUM(
      CASE
        WHEN (clients.total_charge - clients.paid_credit) > 0
        THEN clients.paid_credit
        ELSE 0
      END
    ) AS total_debt_paid,
    SUM(
      CASE
        WHEN (clients.total_charge - clients.paid_credit) <= 0
        THEN (clients.total_charge - clients.paid_credit)
        ELSE 0
      END
    ) AS total_without_debt_balance,
    SUM(
      CASE
        WHEN (clients.total_charge - clients.paid_credit) <= 0
        THEN clients.total_charge
        ELSE 0
      END
    ) AS total_without_debt_charge,
    SUM(
      CASE
        WHEN (clients.total_charge - clients.paid_credit) <= 0
        THEN clients.paid_credit
        ELSE 0
      END
    ) AS total_without_debt_paid
  FROM (
    ${buildClientAccountInnerQuery(filterFields)}
  ) clients;
  `
}

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

const buildSalesReportQueryParts = (
  fields = {},
  { docAlias = 'd', stakeholderAlias = 's', userAlias = 'u' } = {}
) => {
  const filterFields = stripPaginationFields(fields)
  const rawWhereConditions = getWhereConditions({ fields: filterFields, tableAlias: docAlias })
  const includeInvoices = new RegExp(`${docAlias}\\.document_type = 'INVOICES'`, 'i').test(
    rawWhereConditions
  )
  const includePreInvoices = new RegExp(`${docAlias}\\.document_type = 'PRE_INVOICE'`, 'i').test(
    rawWhereConditions
  )
  const includeBoth = !includeInvoices && !includePreInvoices

  const whereConditions = rawWhereConditions
    .replace(new RegExp(`${docAlias}\\.client_id`, 'gi'), `${stakeholderAlias}.id`)
    .replace(new RegExp(`AND ${docAlias}\\.document_type = 'INVOICES'`, 'gi'), '')
    .replace(new RegExp(`AND ${docAlias}\\.document_type = 'PRE_INVOICE'`, 'gi'), '')
    .replace(/start_date/gi, 'created_at')
    .replace(/end_date/gi, 'created_at')
    .replace(new RegExp(`${docAlias}\\.seller_id`, 'gi'), `${userAlias}.id`)

  const invoicesWhereConditions =
    includeInvoices || includeBoth
      ? `(
      ${docAlias}.document_type = '${types.documentsTypes.SELL_INVOICE}' OR
      ${docAlias}.document_type = '${types.documentsTypes.RENT_INVOICE}'
    )`
      : ''

  const preInvoicesWhereConditions =
    includePreInvoices || includeBoth
      ? `(${docAlias}.document_type = '${types.documentsTypes.RENT_PRE_INVOICE}' AND ${docAlias}.related_internal_document_id IS NULL)`
      : ''

  const documentTypeWhereOperator =
    (includeInvoices && includePreInvoices) || includeBoth ? 'OR' : ''

  const documentTypeWhere = `${includeBoth ? '(' : ''}
        ${invoicesWhereConditions} ${documentTypeWhereOperator} ${preInvoicesWhereConditions}
      ${includeBoth ? ')' : ''}`

  return { documentTypeWhere, whereConditions }
}

const buildSalesReportWhereSql = (fields = {}, aliases = {}) => {
  const { documentTypeWhere, whereConditions } = buildSalesReportQueryParts(fields, aliases)
  const { docAlias = 'd' } = aliases

  return `
    ${documentTypeWhere} AND
    ${docAlias}.status = '${types.documentsStatus.APPROVED}'
    ${whereConditions}
  `
}

const getSales = (fields = {}) => {
  const paginationSQL = buildPaginationSQL(fields)
  const paginationSubquery = paginationSQL
    ? `
    AND d.id IN (
      SELECT id FROM (
        SELECT d2.id
        FROM documents d2
        LEFT JOIN stakeholders s2 ON s2.id = d2.stakeholder_id
        LEFT JOIN users u2 ON u2.id = d2.created_by
        WHERE ${buildSalesReportWhereSql(fields, { docAlias: 'd2', stakeholderAlias: 's2', userAlias: 'u2' })}
        ORDER BY d2.id DESC
        ${paginationSQL}
      ) AS paginated_sales
    )`
    : ''

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
    WHERE ${buildSalesReportWhereSql(fields)}
    ${paginationSubquery}
    ORDER BY d.id DESC
  `
}

const getSalesCount = (fields = {}) => `
  SELECT COUNT(*) AS total
  FROM documents d
  LEFT JOIN stakeholders s ON s.id = d.stakeholder_id
  LEFT JOIN users u ON u.id = d.created_by
  WHERE ${buildSalesReportWhereSql(stripPaginationFields(fields))};
`

const getSalesSummary = (fields = {}) => `
  SELECT
    COUNT(*) AS total_documents,
    COALESCE(SUM(d.total_amount), 0) AS total_billed
  FROM documents d
  LEFT JOIN stakeholders s ON s.id = d.stakeholder_id
  LEFT JOIN users u ON u.id = d.created_by
  WHERE ${buildSalesReportWhereSql(stripPaginationFields(fields))};
`

const buildInventoryWhere = (fields = {}, productAlias = 'p') => {
  const filterFields = stripPaginationFields(fields)
  const rawWhereConditions = getWhereConditions({ fields: filterFields, tableAlias: productAlias })

  return rawWhereConditions
    .replace(new RegExp(`${productAlias}\\.start_date`, 'gi'), 'imd.created_at')
    .replace(new RegExp(`${productAlias}\\.end_date`, 'gi'), 'imd.created_at')
    .replace(new RegExp(`${productAlias}\\.product_id`, 'gi'), `${productAlias}.id`)
}

const buildInventoryDistinctProductsSubquery = (fields = {}, { withPagination = false } = {}) => {
  const whereConditions = buildInventoryWhere(stripPaginationFields(fields), 'p2')
  const paginationSQL = withPagination ? buildPaginationSQL(fields) : ''

  return `
    SELECT id FROM (
      SELECT DISTINCT p2.id
      FROM products p2
      LEFT JOIN inventory_movements im ON im.product_id = p2.id
      LEFT JOIN inventory_movements_details imd ON imd.inventory_movement_id = im.id
      WHERE im.status = '${types.inventoryMovementsStatus.APPROVED}'
      ${whereConditions}
      ORDER BY p2.id
      ${paginationSQL}
    ) AS paginated_products
  `
}

const getInventory = (fields = {}) => {
  const whereConditions = buildInventoryWhere(fields, 'p')
  const paginationSQL = buildPaginationSQL(fields)
  const paginationSubquery = paginationSQL
    ? `
      AND p.id IN (${buildInventoryDistinctProductsSubquery(fields, { withPagination: true })})
    `
    : ''

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
      ${paginationSubquery}
      ORDER BY im.operation_id, im.id
    `
}

const getInventoryCount = (fields = {}) => `
  SELECT COUNT(*) AS total
  FROM (
    SELECT DISTINCT p.id
    FROM products p
    LEFT JOIN inventory_movements im ON im.product_id = p.id
    LEFT JOIN inventory_movements_details imd ON imd.inventory_movement_id = im.id
    WHERE im.status = '${types.inventoryMovementsStatus.APPROVED}'
    ${buildInventoryWhere(stripPaginationFields(fields), 'p')}
  ) AS counted_products;
`

const getInventorySummary = (fields = {}) => `
  SELECT
    COALESCE(SUM(p.stock), 0) AS total_items,
    COALESCE(SUM(p.inventory_total_value), 0) AS total_value
  FROM products p
  WHERE p.id IN (
    SELECT DISTINCT p2.id
    FROM products p2
    LEFT JOIN inventory_movements im ON im.product_id = p2.id
    LEFT JOIN inventory_movements_details imd ON imd.inventory_movement_id = im.id
    WHERE im.status = '${types.inventoryMovementsStatus.APPROVED}'
    ${buildInventoryWhere(stripPaginationFields(fields), 'p2')}
  );
`

const getInvoiceTypeCondition = (alias = 'd') =>
  `(${alias}.document_type = '${types.documentsTypes.SELL_INVOICE}' OR ${alias}.document_type = '${types.documentsTypes.RENT_INVOICE}')`

const buildInvoiceReportWhere = (fields = {}, docAlias = 'd', stakeholderAlias = 's') => {
  const filterFields = stripPaginationFields(fields)
  const rawWhereConditions = getWhereConditions({ fields: filterFields, tableAlias: docAlias })

  return rawWhereConditions
    .replace(new RegExp(`${docAlias}\\.nit`, 'gi'), `${stakeholderAlias}.nit`)
    .replace(new RegExp(`${docAlias}\\.name`, 'gi'), `${stakeholderAlias}.name`)
    .replace(new RegExp(`${docAlias}\\.start_date`, 'gi'), `DATE(${docAlias}.created_at)`)
    .replace(new RegExp(`${docAlias}\\.end_date`, 'gi'), `DATE(${docAlias}.created_at)`)
}

const getInvoice = (fields = {}) => {
  const whereConditions = buildInvoiceReportWhere(fields)
  const paginationSQL = buildPaginationSQL(fields)
  const paginationSubquery = paginationSQL
    ? `
    AND d.id IN (
      SELECT id FROM (
        SELECT d2.id
        FROM documents d2
        LEFT JOIN stakeholders s2 ON s2.id = d2.stakeholder_id
        WHERE ${getInvoiceTypeCondition('d2')} ${buildInvoiceReportWhere(fields, 'd2', 's2')}
        ORDER BY d2.id DESC
        ${paginationSQL}
      ) AS paginated_documents
    )`
    : ''

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
    WHERE ${getInvoiceTypeCondition('d')} ${whereConditions}
    ${paginationSubquery}
    ORDER BY d.id DESC
  `
}

const getInvoiceCount = (fields = {}) => `
  SELECT COUNT(*) AS total
  FROM documents d
  LEFT JOIN stakeholders s ON s.id = d.stakeholder_id
  WHERE ${getInvoiceTypeCondition('d')} ${buildInvoiceReportWhere(stripPaginationFields(fields))};
`

const getInvoiceSummary = (fields = {}) => `
  SELECT
    COUNT(*) AS total_invoices,
    COALESCE(SUM(CASE WHEN d.status = 'APPROVED' THEN 1 ELSE 0 END), 0) AS approved_count,
    COALESCE(SUM(CASE WHEN d.status = 'CANCELLED' THEN 1 ELSE 0 END), 0) AS cancelled_count,
    COALESCE(SUM(CASE WHEN d.status = 'APPROVED' THEN d.total_amount ELSE 0 END), 0) AS approved_total,
    COALESCE(SUM(CASE WHEN d.status = 'CANCELLED' THEN d.total_amount ELSE 0 END), 0) AS cancelled_total
  FROM documents d
  LEFT JOIN stakeholders s ON s.id = d.stakeholder_id
  WHERE ${getInvoiceTypeCondition('d')} ${buildInvoiceReportWhere(stripPaginationFields(fields))};
`

const parseReceiptsFilterFields = (fields = {}) => {
  const filterFields = stripPaginationFields(fields)
  const documentNumberFilter = filterFields.document_number
  const systemInvoice =
    documentNumberFilter &&
    String(documentNumberFilter.$like || '')
      .toLowerCase()
      .includes('factura del sistema')

  if (systemInvoice) {
    delete filterFields.document_number
  }

  return { filterFields, systemInvoice }
}

const buildReceiptsReportWhere = (fields = {}, docAlias = 'd', stakeholderAlias = 's') => {
  const { filterFields, systemInvoice } = parseReceiptsFilterFields(fields)
  const rawWhereConditions = getWhereConditions({ fields: filterFields, tableAlias: docAlias })

  const whereConditions = rawWhereConditions
    .replace(new RegExp(`${docAlias}\\.nit`, 'gi'), `${stakeholderAlias}.nit`)
    .replace(new RegExp(`${docAlias}\\.name`, 'gi'), `${stakeholderAlias}.name`)
    .replace(new RegExp(`${docAlias}\\.start_date`, 'gi'), `DATE(${docAlias}.created_at)`)
    .replace(new RegExp(`${docAlias}\\.end_date`, 'gi'), `DATE(${docAlias}.created_at)`)

  return systemInvoice
    ? `${whereConditions} AND ${docAlias}.document_number IS NULL`
    : whereConditions
}

const getReceipts = (fields = {}) => {
  const whereConditions = buildReceiptsReportWhere(fields)
  const paginationSQL = buildPaginationSQL(fields)
  const paginationSubquery = paginationSQL
    ? `
    AND d.id IN (
      SELECT id FROM (
        SELECT d2.id
        FROM documents d2
        LEFT JOIN stakeholders s2 ON s2.id = d2.stakeholder_id
        WHERE ${getInvoiceTypeCondition('d2')}
        AND d2.status = 'APPROVED'
        ${buildReceiptsReportWhere(fields, 'd2', 's2')}
        ORDER BY d2.id DESC
        ${paginationSQL}
      ) AS paginated_documents
    )`
    : ''

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
    WHERE ${getInvoiceTypeCondition('d')}
    ${whereConditions}
    AND d.status = 'APPROVED'
    ${paginationSubquery}
    ORDER BY d.id DESC
  `
}

const getReceiptsCount = (fields = {}) => `
  SELECT COUNT(*) AS total
  FROM documents d
  LEFT JOIN stakeholders s ON s.id = d.stakeholder_id
  WHERE ${getInvoiceTypeCondition('d')}
  AND d.status = 'APPROVED'
  ${buildReceiptsReportWhere(stripPaginationFields(fields))};
`

const getReceiptsSummary = (fields = {}) => `
  SELECT
    COUNT(*) AS total_invoices,
    COALESCE(SUM(total_amount), 0) AS total_billed,
    COALESCE(SUM(paid_amount), 0) AS total_paid,
    COALESCE(SUM(CASE WHEN document_number IS NOT NULL THEN 1 ELSE 0 END), 0) AS electronic_count,
    COALESCE(SUM(CASE WHEN document_number IS NULL THEN 1 ELSE 0 END), 0) AS system_count,
    COALESCE(SUM(CASE WHEN document_number IS NOT NULL THEN total_amount ELSE 0 END), 0) AS electronic_billed,
    COALESCE(SUM(CASE WHEN document_number IS NULL THEN total_amount ELSE 0 END), 0) AS system_billed,
    COALESCE(SUM(CASE WHEN document_number IS NOT NULL THEN paid_amount ELSE 0 END), 0) AS electronic_paid,
    COALESCE(SUM(CASE WHEN document_number IS NULL THEN paid_amount ELSE 0 END), 0) AS system_paid
  FROM (
    SELECT
      d.id,
      d.document_number,
      d.total_amount,
      COALESCE((
        SELECT SUM(p.payment_amount)
        FROM payments p
        WHERE p.document_id = d.id AND (p.is_deleted = 0 OR p.is_deleted IS NULL)
      ), 0) AS paid_amount
    FROM documents d
    LEFT JOIN stakeholders s ON s.id = d.stakeholder_id
    WHERE ${getInvoiceTypeCondition('d')}
    AND d.status = 'APPROVED'
    ${buildReceiptsReportWhere(stripPaginationFields(fields))}
  ) AS receipt_totals;
`

const buildManualReceiptsReportWhere = (fields = {}, docAlias = 'd', stakeholderAlias = 's') => {
  const filterFields = stripPaginationFields(fields)
  const rawWhereConditions = getWhereConditions({ fields: filterFields, tableAlias: docAlias })

  return rawWhereConditions
    .replace(new RegExp(`${docAlias}\\.nit`, 'gi'), `${stakeholderAlias}.nit`)
    .replace(new RegExp(`${docAlias}\\.name`, 'gi'), `${stakeholderAlias}.name`)
    .replace(new RegExp(`${docAlias}\\.start_date`, 'gi'), `DATE(${docAlias}.created_at)`)
    .replace(new RegExp(`${docAlias}\\.end_date`, 'gi'), `DATE(${docAlias}.created_at)`)
}

const getManualReceipts = (fields = {}) => {
  const whereConditions = buildManualReceiptsReportWhere(fields)
  const paginationSQL = buildPaginationSQL(fields)
  const paginationSubquery = paginationSQL
    ? `
    AND d.id IN (
      SELECT id FROM (
        SELECT d2.id
        FROM manual_payments d2
        LEFT JOIN stakeholders s2 ON d2.stakeholder_id = s2.id
        WHERE 1 = 1
        ${buildManualReceiptsReportWhere(fields, 'd2', 's2')}
        ORDER BY d2.id DESC
        ${paginationSQL}
      ) AS paginated_manual_payments
    )`
    : ''

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
    ${paginationSubquery}
    ORDER BY d.id DESC
  `
}

const getManualReceiptsCount = (fields = {}) => `
  SELECT COUNT(*) AS total
  FROM manual_payments d
  LEFT JOIN stakeholders s ON d.stakeholder_id = s.id
  WHERE 1 = 1
  ${buildManualReceiptsReportWhere(stripPaginationFields(fields))};
`

const getManualReceiptsSummary = (fields = {}) => `
  SELECT
    COUNT(*) AS total_receipts,
    COALESCE(SUM(total_amount), 0) AS total_billed,
    COALESCE(SUM(paid_amount), 0) AS total_paid
  FROM (
    SELECT
      d.id,
      d.total_amount,
      COALESCE((
        SELECT SUM(pd.payment_amount)
        FROM manual_payments_detail pd
        WHERE pd.manual_payment = d.id AND (pd.is_deleted = 0 OR pd.is_deleted IS NULL)
      ), 0) AS paid_amount
    FROM manual_payments d
    LEFT JOIN stakeholders s ON d.stakeholder_id = s.id
    WHERE 1 = 1
    ${buildManualReceiptsReportWhere(stripPaginationFields(fields))}
  ) AS manual_receipt_totals;
`

const buildServiceOrdersReportWhere = (fields = {}, docAlias = 'd', stakeholderAlias = 's') => {
  const filterFields = stripPaginationFields(fields)
  const rawWhereConditions = getWhereConditions({ fields: filterFields, tableAlias: docAlias })

  return rawWhereConditions
    .replace(new RegExp(`${docAlias}\\.name`, 'gi'), `${stakeholderAlias}.name`)
    .replace(new RegExp(`${docAlias}\\.start_date`, 'gi'), `DATE(${docAlias}.start_date)`)
}

const getServiceOrders = (fields = {}) => {
  const whereConditions = buildServiceOrdersReportWhere(fields)
  const paginationSQL = buildPaginationSQL(fields)
  const paginationSubquery = paginationSQL
    ? `
    AND d.id IN (
      SELECT id FROM (
        SELECT d2.id
        FROM documents d2
        INNER JOIN stakeholders s2 ON s2.id = d2.stakeholder_id
        WHERE d2.document_type = '${types.documentsTypes.RENT_PRE_INVOICE}'
        ${buildServiceOrdersReportWhere(fields, 'd2', 's2')}
        ORDER BY d2.id DESC
        ${paginationSQL}
      ) AS paginated_service_orders
    )`
    : ''

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
  ${paginationSubquery}
  ORDER BY d.id DESC
  `
}

const getServiceOrdersCount = (fields = {}) => `
  SELECT COUNT(*) AS total
  FROM documents d
  INNER JOIN stakeholders s ON s.id = d.stakeholder_id
  WHERE d.document_type = '${types.documentsTypes.RENT_PRE_INVOICE}'
  ${buildServiceOrdersReportWhere(stripPaginationFields(fields))};
`

const getServiceOrdersSummary = (fields = {}) => `
  SELECT
    COUNT(*) AS total_orders,
    COALESCE(SUM(CASE WHEN d.status = 'APPROVED' THEN 1 ELSE 0 END), 0) AS approved_count,
    COALESCE(SUM(CASE WHEN d.status = 'PENDING' THEN 1 ELSE 0 END), 0) AS pending_count,
    COALESCE(SUM(CASE WHEN d.status = 'CANCELLED' THEN 1 ELSE 0 END), 0) AS cancelled_count
  FROM documents d
  INNER JOIN stakeholders s ON s.id = d.stakeholder_id
  WHERE d.document_type = '${types.documentsTypes.RENT_PRE_INVOICE}'
  ${buildServiceOrdersReportWhere(stripPaginationFields(fields))};
`

const LINE_ITEM_TOTAL = '(dp.product_price + dp.unit_tax_amount - IFNULL(dp.unit_discount_amount, 0)) * dp.product_quantity'

const SALES_ITEM_TYPE_SQL = `
  CASE
    WHEN prod.product_type = '${types.productsTypes.SERVICE}' OR dp.service_type = '${types.documentsServiceType.SERVICE}' THEN 'SERVICE'
    WHEN prod.product_category = '${types.productsCategories.EQUIPMENT}' OR dp.service_type = '${types.documentsServiceType.EQUIPMENT}' THEN 'EQUIPMENT'
    ELSE 'PRODUCT'
  END`

const SALES_ITEM_TYPE_SPANISH_SQL = `
  CASE
    WHEN prod.product_type = '${types.productsTypes.SERVICE}' OR dp.service_type = '${types.documentsServiceType.SERVICE}' THEN 'Servicio'
    WHEN prod.product_category = '${types.productsCategories.EQUIPMENT}' OR dp.service_type = '${types.documentsServiceType.EQUIPMENT}' THEN 'Equipo'
    ELSE 'Producto'
  END`

const SALES_CATEGORY_SPANISH_SQL = `
  CASE prod.sales_category
    WHEN '${types.salesCategories.SC}' THEN 'Cabina'
    WHEN '${types.salesCategories.SE}' THEN 'Equipo'
    WHEN '${types.salesCategories.SF}' THEN 'Fosa'
    WHEN '${types.salesCategories.SO}' THEN 'Otros'
    ELSE ''
  END`

const SALES_PRODUCT_REPORT_BASE_FROM = `
    FROM products prod
    INNER JOIN documents_products dp ON prod.id = dp.product_id
    INNER JOIN documents d ON dp.document_id = d.id AND d.status = 'APPROVED'
    WHERE (d.document_type = 'SELL_INVOICE' OR d.document_type = 'RENT_INVOICE')`

const parseReportFilterFields = (fields = {}) => {
  const { $limit, $offset, item_type, product_type, ...filterFields } = fields

  return {
    filterFields,
    itemType: item_type || product_type,
  }
}

const buildItemTypeFilter = itemType => {
  if (!itemType) return ''

  return ` AND ${SALES_ITEM_TYPE_SQL} = '${itemType}'`
}

const buildSalesProductReportWhere = (fields = {}, itemType = null) => {
  const { filterFields, itemType: itemTypeFromFields } = parseReportFilterFields(fields)
  const resolvedItemType = itemType !== null ? itemType : itemTypeFromFields
  const rawWhereConditions = getWhereConditions({ fields: filterFields, tableAlias: 'd' })

  return `${rawWhereConditions
    .replace(/d\.code/gi, 'prod.code')
    .replace(/d\.description/gi, 'prod.description')
    .replace(/d\.start_date/gi, 'DATE(d.created_at)')
    .replace(/d\.end_date/gi, 'DATE(d.created_at)')
    .replace(/d\.product_type/gi, 'prod.product_type')
    .replace(/d\.item_type/gi, SALES_ITEM_TYPE_SQL)
    .replace(/d\.sales_category/gi, 'prod.sales_category')}${buildItemTypeFilter(resolvedItemType)}`
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
        ${SALES_ITEM_TYPE_SQL} AS item_type,
        ${SALES_ITEM_TYPE_SPANISH_SQL} AS item_type_spanish,
        prod.sales_category AS sales_category,
        ${SALES_CATEGORY_SPANISH_SQL} AS sales_category_spanish,
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
    ${SALES_ITEM_TYPE_SQL} AS item_type,
    SUM(dp.product_quantity) AS total_quantity,
    SUM(${LINE_ITEM_TOTAL}) AS total_amount
  ${SALES_PRODUCT_REPORT_BASE_FROM}
  ${whereConditions}
  GROUP BY 1;
  `
}

const getTopSoldItem = (fields = {}, itemType) => {
  const whereConditions = buildSalesProductReportWhere(fields, itemType)

  return `
  SELECT
    prod.code AS code,
    prod.description AS description,
    SUM(dp.product_quantity) AS product_quantity,
    SUM(${LINE_ITEM_TOTAL}) AS total_amount
  ${SALES_PRODUCT_REPORT_BASE_FROM}
  ${whereConditions}
  GROUP BY prod.id
  ORDER BY product_quantity DESC
  LIMIT 1;
  `
}

module.exports = {
  getAccountsReceivable,
  getClientAccountState,
  getClientAccountStateCount,
  getClientAccountStateSummary,
  getInventory,
  getInventoryCount,
  getInventorySummary,
  getSales,
  getSalesCount,
  getSalesSummary,
  getInvoice,
  getInvoiceCount,
  getInvoiceSummary,
  getReceipts,
  getReceiptsCount,
  getReceiptsSummary,
  parseReceiptsFilterFields,
  getManualReceipts,
  getManualReceiptsCount,
  getManualReceiptsSummary,
  getServiceOrders,
  getServiceOrdersCount,
  getServiceOrdersSummary,
  getSalesProductReport,
  getSalesProductReportCount,
  getSalesProductReportSummary,
  getTopSoldItem,
  stripPaginationFields,
}
