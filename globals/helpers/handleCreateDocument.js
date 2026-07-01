const { creditsPolicy, documentsTypes } = require('../types')
const { getFormattedDates } = require('../common')
// res.excludeProductOnCreateDetail: product_id
// res.calculateSalesCommission: boolean
// res.saveInventoryUnitValueAsProductPrice: boolean

// IMPORTANTE: especificar en el req.body el document_type del documento a crear
// req.body: {
//   stakeholder_id,
//   project_id,
//   document_type,
//   comments,
//   received_by,
//   dispatched_by,
//   start_date,
//   end_date,
//   payment_method,
//   credit_days,
//   description,
//   products: [
//     {
//       product_id,
//       service_type,
//       inventory_unit_value,
//       product_price,
//       product_quantity,
//       tax_fee,
//       unit_tax_amount,
//       product_discount_percentage,
//       product_discount,
//       parent_product_id,
//     }
//   ]
// }

const handleCreateDocument = async (req, res) => {
  const {
    document_id = null,
    document_type,
    stakeholder_id = null,
    product_id = null,
    project_id = null,
    operation_id = null,
    comments = null,
    received_by = null,
    dispatched_by = null,
    start_date = null,
    end_date = null,
    cancel_reason = null,
    subtotal_amount = null,
    total_discount_amount = null,
    total_tax_amount = null,
    total_amount = null,
    payment_method = null,
    credit_days = null,
    description = null,
    products,
    serie = null,
    document_number = null,
    uuid = null,
    created_at = null
  } = req.body
  
  const related_internal_document_id = document_id
  const salesCommissionPercentage = req.currentUser.sales_commission / 100
  const sales_commission_amount =
    res.calculateSalesCommission && !isNaN(salesCommissionPercentage) ? subtotal_amount * salesCommissionPercentage : null

  const { created_at: resolvedCreatedAt } = getFormattedDates({
    created_at: created_at || new Date().toISOString(),
  })

  const isInvoiceOrPreInvoice = () =>
    document_type === documentsTypes.SELL_INVOICE ||
    document_type === documentsTypes.SELL_PRE_INVOICE ||
    document_type === documentsTypes.RENT_INVOICE ||
    document_type === documentsTypes.RENT_PRE_INVOICE
    
  await res.connection.query({sql:createDocument(), values:[
    document_type,
    stakeholder_id,
    product_id,
    project_id,
    operation_id,
    comments,
    received_by,
    dispatched_by,
    start_date,
    end_date,
    cancel_reason,
    subtotal_amount,
    sales_commission_amount,
    total_discount_amount,
    total_tax_amount,
    total_amount,
    payment_method,
    credit_days,
    // Number(credit_days) > 0 ? creditsPolicy.creditStatusEnum.UNPAID : null,
    isInvoiceOrPreInvoice() ? creditsPolicy.creditStatusEnum.UNPAID : null,
    description,
    req.currentUser.user_id,
    serie,
    document_number,
    uuid,
    resolvedCreatedAt
  ]})
  
  const newDocumentId = await res.connection.geLastInsertId()

  const documentsProductsValues = products.flatMap(p => {
    if (Number(p.product_id) === Number(res.excludeProductOnCreateDetail)) return []

    return `(
      ${newDocumentId},
      ${p.product_id},
      ${p.service_type ? `'${p.service_type}'` : null},
      ${res.saveInventoryUnitValueAsProductPrice ? p.inventory_unit_value : p.product_price},
      ${p.product_quantity},
      ${p.tax_fee || 0},
      ${p.unit_tax_amount || 0},
      ${p.product_discount_percentage || null},
      ${p.product_discount || null},
      ${p.parent_product_id || null}
    )`
  })

  await res.connection.query(createDocumentsProducts(documentsProductsValues))

  return {
    req: { ...req, body: { ...req.body, document_id: newDocumentId, related_internal_document_id } },
    res: { ...res, statusCode: 201, data: { document_id: newDocumentId }, message: 'Documento creado exitosamente' },
  }
}

const createDocument = () => `
  INSERT INTO documents
    (
      document_type,
      stakeholder_id,
      product_id,
      project_id,
      operation_id,
      comments,
      received_by,
      dispatched_by,
      start_date,
      end_date,
      cancel_reason,
      subtotal_amount,
      sales_commission_amount,
      total_discount_amount,
      total_tax_amount,
      total_amount,
      payment_method,
      credit_days,
      credit_status,
      description,
      created_by,
      serie,
      document_number,
      uuid,
      created_at
    )
  VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`
const createDocumentsProducts = valuesArray => `
  INSERT INTO documents_products
    (
      document_id,
      product_id,
      service_type,
      product_price,
      product_quantity,
      tax_fee,
      unit_tax_amount,
      discount_percentage,
      unit_discount_amount,
      parent_product_id
    )
  VALUES ${valuesArray.join(', ')}
`

module.exports = handleCreateDocument
