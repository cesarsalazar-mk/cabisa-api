const mysql = require('mysql2/promise')
const { mysqlConfig, helpers, types, ValidatorException } = require(`${process.env['FILE_ENVIRONMENT']}/globals`)
const storage = require('./storage')
const { handleRead, handleRequest, handleResponse, invoiceAdjustments } = helpers
const db = mysqlConfig(mysql)
const Excel = require('exceljs')

const enrichReportDocuments = (documents, totalField = 'total') =>
  invoiceAdjustments.enrichDocumentsWithAdjustments(documents, db.query, { totalField })

const applyAdjustedExportValues = rows =>
  rows.map(row => {
    const adjustedTotal = Number(row.adjusted_total ?? row.total_amount ?? row.total ?? 0)
    const due = Number(row.due || 0)

    return {
      ...row,
      total: adjustedTotal,
      total_amount: adjustedTotal,
      differenceAmount: adjustedTotal - due,
    }
  })

const EXPORT_IN_CHUNK_SIZE = 500

const chunkArray = (items, size) => {
  const chunks = []

  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size))
  }

  return chunks
}

const getReceiptsProductDescriptions = async documentIds => {
  const uniqueIds = [...new Set((documentIds || []).filter(Boolean))]

  if (!uniqueIds.length) return {}

  const rows = []

  for (const chunk of chunkArray(uniqueIds, EXPORT_IN_CHUNK_SIZE)) {
    const chunkRows = await db.query(storage.getReceiptsExportProductLines(chunk), chunk)
    rows.push(...(chunkRows || []))
  }

  const descriptionsByDocumentId = {}
  const seen = {}

  rows.forEach(row => {
    const key = `${row.document_id}:${row.product_id}:${row.parent_product_id}`

    if (seen[key] || !row.description) return

    seen[key] = true
    const documentId = String(row.document_id)

    descriptionsByDocumentId[documentId] = descriptionsByDocumentId[documentId]
      ? `${descriptionsByDocumentId[documentId]}  ||  ${row.description}`
      : row.description
  })

  return descriptionsByDocumentId
}

const mapCashReceiptsExportRows = async documents => {
  const rows = Array.isArray(documents) ? documents : []
  const descriptionsByDocumentId = await getReceiptsProductDescriptions(
    rows.map(document => document.id)
  )

  return rows.map(document => ({
    ...document,
    due: Number(document.due) || 0,
    document_number:
      document.document_number === null ? 'Factura del sistema' : document.document_number,
    producto_lit: descriptionsByDocumentId[String(document.id)] || '',
  }))
}

const toCashReceiptsExcelRows = rows =>
  rows.map(row => ({
    related_internal_document_id: row.related_internal_document_id,
    document_number: row.document_number,
    created_at: row.created_at,
    stakeholder_name: row.stakeholder_name,
    differenceAmount: row.differenceAmount,
    total_amount: row.total_amount,
    producto_lit: row.producto_lit || '',
  }))

const getServiceOrdersProductsByDocumentIds = async documentIds => {
  const uniqueIds = [...new Set((documentIds || []).filter(Boolean))]

  if (!uniqueIds.length) return {}

  const rows = []

  for (const chunk of chunkArray(uniqueIds, EXPORT_IN_CHUNK_SIZE)) {
    const chunkRows = await db.query(storage.getServiceOrdersExportProductLines(chunk), chunk)
    rows.push(...(chunkRows || []))
  }

  const productsByDocumentId = {}
  const seen = {}

  rows.forEach(row => {
    const key = `${row.document_id}:${row.product_id}:${row.parent_product_id}`

    if (seen[key]) return

    seen[key] = true
    const documentId = String(row.document_id)

    if (!productsByDocumentId[documentId]) productsByDocumentId[documentId] = []

    productsByDocumentId[documentId].push({
      code: row.code,
      description: row.description,
      service_type_spanish: row.service_type_spanish,
      total_product_amount: row.total_product_amount,
      quantity: row.quantity,
    })
  })

  return productsByDocumentId
}

const mapServiceOrdersExportRows = async documents => {
  const rows = Array.isArray(documents) ? documents : []
  const productsByDocumentId = await getServiceOrdersProductsByDocumentIds(
    rows.map(document => document.id)
  )

  return rows.map(document => ({
    ...document,
    products: productsByDocumentId[String(document.id)] || [],
  }))
}

const isAutoProviderExclusion = value => {
  if (!value) return false

  if (typeof value === 'object' && value.$ne) return true

  const normalized = String(value).toUpperCase()

  return normalized.includes('$NE:') && normalized.includes('PROVIDER')
}

const stripClientAccountBillingFilters = (fields = {}) => {
  const billingFilters = { ...storage.stripPaginationFields(fields) }

  // reportsSrc puede inyectar status=ACTIVE y stakeholder_type != PROVIDER.
  // Esos filtros aplican al listado de clientes; el total facturado no debe
  // depender del status del stakeholder (clientes inactivos tambien facturaron).
  delete billingFilters.debt_status
  delete billingFilters.status

  if (isAutoProviderExclusion(billingFilters.stakeholder_type)) {
    delete billingFilters.stakeholder_type
  }

  return billingFilters
}

module.exports.clientsAccountState = async event => {
  try {
    const req = await handleRequest({ event })

    req.hasPermissions([types.permissions.REPORTS])

    const res = await handleRead(req, { dbQuery: db.query, storage: storage.getClientAccountState })
    const filterFields = storage.stripPaginationFields(req.query)
    const billingFilters = stripClientAccountBillingFilters(filterFields)
    const summaryRows = await db.query(storage.getClientAccountStateSummary(filterFields))
    const invoiceSummaryRows = await db.query(
      storage.getInvoiceSummary(billingFilters)
    )
    const countResult = await db.query(storage.getClientAccountStateCount(req.query))

    const toNumber = value => Number(value) || 0

    const mapClient = d => {
      const balance = toNumber(d.balance)
      const aging0To30 = toNumber(d.aging_0_30)
      const aging31To60 = toNumber(d.aging_31_60)
      const aging61To90 = toNumber(d.aging_61_90)
      const agingOver90 = toNumber(d.aging_over_90)
      const maxDaysOverdue = toNumber(d.max_days_overdue)
      const accountStatus = d.account_status || (balance > 0 ? 'POR_VENCER' : 'AL_DIA')

      return {
        ...d,
        credit_limit: toNumber(d.credit_limit),
        balance,
        aging_0_30: aging0To30,
        aging_31_60: aging31To60,
        aging_61_90: aging61To90,
        aging_over_90: agingOver90,
        max_days_overdue: maxDaysOverdue,
        unpaid_invoices_count: toNumber(d.unpaid_invoices_count),
        paid_invoices_count: toNumber(d.paid_invoices_count),
        total_paid: toNumber(d.total_paid),
        last_movement_date: d.last_movement_date || null,
        last_payment_date: d.last_payment_date || null,
        last_payment_document: d.last_payment_document || null,
        account_status: accountStatus,
        has_debt: accountStatus !== 'AL_DIA',
        has_overdue: accountStatus === 'VENCIDO' || accountStatus === 'VENCIDO_90',
        credit_balance: balance,
      }
    }

    const summaryRow = summaryRows[0] || {}
    const invoiceSummaryRow = invoiceSummaryRows[0] || {}
    const approvedInvoicesAmount = toNumber(invoiceSummaryRow.approved_total)
    const cancelledInvoicesAmount = toNumber(invoiceSummaryRow.cancelled_total)

    return await handleResponse({
      req,
      res: {
        statusCode: 200,
        data: {
          items: res.data.map(mapClient),
          summary: {
            total_clients: toNumber(summaryRow.total_clients),
            clients_with_debt: toNumber(summaryRow.clients_with_debt),
            clients_without_debt: toNumber(summaryRow.clients_without_debt),
            clients_overdue: toNumber(summaryRow.clients_overdue),
            clients_overdue_90: toNumber(summaryRow.clients_overdue_90),
            total_balance: toNumber(summaryRow.total_balance),
            total_debt_balance: toNumber(summaryRow.total_debt_balance),
            total_paid: toNumber(summaryRow.total_paid),
            total_unpaid_invoices: toNumber(summaryRow.total_unpaid_invoices),
            total_paid_invoices: toNumber(summaryRow.total_paid_invoices),
            total_aging_0_30: toNumber(summaryRow.total_aging_0_30),
            total_aging_31_60: toNumber(summaryRow.total_aging_31_60),
            total_aging_61_90: toNumber(summaryRow.total_aging_61_90),
            total_aging_over_90: toNumber(summaryRow.total_aging_over_90),
            total_invoices_count: toNumber(invoiceSummaryRow.total_invoices),
            total_invoiced_amount: approvedInvoicesAmount + cancelledInvoicesAmount,
            cancelled_invoices_count: toNumber(invoiceSummaryRow.cancelled_count),
            cancelled_invoices_amount: cancelledInvoicesAmount,
            approved_invoices_count: toNumber(invoiceSummaryRow.approved_count),
            approved_invoices_amount: approvedInvoicesAmount,
          },
          pagination: { total: toNumber(countResult[0]?.total) },
        },
      },
    })
  } catch (error) {
    console.log(error)
    return await handleResponse({ error })
  }
}

module.exports.clientsAccountMovements = async event => {
  try {
    const req = await handleRequest({ event })

    req.hasPermissions([types.permissions.REPORTS])

    if (!req.query.stakeholder_id) {
      return await handleResponse({
        req,
        res: { statusCode: 400, message: 'stakeholder_id es requerido' },
      })
    }

    const toNumber = value => Number(value) || 0
    const toText = value => (value == null ? '' : String(value))
    const toSortDate = value => {
      if (!value) return 0
      const time = new Date(value).getTime()
      return Number.isNaN(time) ? 0 : time
    }

    const limit = Math.max(1, toNumber(req.query.$limit) || 20)
    const offset = Math.max(0, toNumber(req.query.$offset) || 0)

    const [openingRows, invoiceRows, paymentRows, noteRows] = await Promise.all([
      db.query(storage.getClientAccountOpeningBalance(req.query)),
      db.query(storage.getClientAccountInvoiceMovements(req.query)),
      db.query(storage.getClientAccountPaymentMovements(req.query)),
      db.query(storage.getClientAccountNoteMovements(req.query)),
    ])

    const openingBalance = toNumber(openingRows?.[0]?.opening_balance)
    const rows = [...(invoiceRows || []), ...(paymentRows || []), ...(noteRows || [])].sort(
      (a, b) => {
        const dateDiff = toSortDate(a.movement_date) - toSortDate(b.movement_date)
        if (dateDiff !== 0) return dateDiff
        return toNumber(a.sort_id) - toNumber(b.sort_id)
      }
    )

    let runningBalance = openingBalance
    const allItems = rows.map(row => {
      const chargeAmount = toNumber(row.charge_amount)
      const creditAmount = toNumber(row.credit_amount)
      runningBalance = runningBalance + chargeAmount - creditAmount

      return {
        movement_date: row.movement_date,
        movement_type: toText(row.movement_type),
        document_number: toText(row.document_number),
        reference: toText(row.reference),
        charge_amount: chargeAmount,
        credit_amount: creditAmount,
        running_balance: runningBalance,
      }
    })

    const documentNumber = toText(req.query.document_number).trim().toLowerCase()
    const filteredItems = documentNumber
      ? allItems.filter(item =>
          toText(item.document_number).toLowerCase().includes(documentNumber)
        )
      : allItems

    const items = filteredItems.slice(offset, offset + limit)

    return await handleResponse({
      req,
      res: {
        statusCode: 200,
        data: {
          opening_balance: openingBalance,
          closing_balance: runningBalance,
          items,
          pagination: {
            total: filteredItems.length,
            limit,
            offset,
          },
        },
      },
    })
  } catch (error) {
    console.log(error)
    return await handleResponse({ error })
  }
}

module.exports.clientsAccountUnpaidInvoices = async event => {
  try {
    const req = await handleRequest({ event })

    req.hasPermissions([types.permissions.REPORTS])

    if (!req.query.stakeholder_id) {
      return await handleResponse({
        req,
        res: { statusCode: 400, message: 'stakeholder_id es requerido' },
      })
    }

    const rows = await db.query(
      storage.getClientAccountInvoices({
        ...req.query,
        payment_status: req.query.payment_status || 'UNPAID',
      })
    )
    const toNumber = value => Number(value) || 0

    const invoiceIds = (rows || []).map(row => row.id).filter(Boolean)
    const paymentRows = invoiceIds.length
      ? await db.query(
          storage.getClientAccountInvoicePayments({
            stakeholder_id: req.query.stakeholder_id,
            document_ids: invoiceIds.join(','),
          })
        )
      : []

    const paymentsByDocument = (paymentRows || []).reduce((acc, row) => {
      const key = String(row.document_id)
      if (!acc[key]) acc[key] = []
      acc[key].push({
        payment_id: row.payment_id,
        payment_date: row.payment_date,
        payment_amount: toNumber(row.payment_amount),
        reference: row.reference || '',
        document_number: row.document_number,
      })
      return acc
    }, {})

    const items = (rows || []).map(row => ({
      id: row.id,
      document_number: row.document_number,
      serie: row.serie,
      document_date: row.document_date,
      due_date: row.due_date,
      total_amount: toNumber(row.total_amount),
      paid_amount: toNumber(row.paid_amount),
      unpaid_amount: toNumber(row.unpaid_amount),
      last_payment_date: row.last_payment_date || null,
      days_overdue: toNumber(row.days_overdue),
      payment_status: row.payment_status,
      payments: paymentsByDocument[String(row.id)] || [],
    }))

    return await handleResponse({
      req,
      res: {
        statusCode: 200,
        data: { items },
      },
    })
  } catch (error) {
    console.log(error)
    return await handleResponse({ error })
  }
}

module.exports.clientsAccountInvoices = async event => {
  try {
    const req = await handleRequest({ event })

    req.hasPermissions([types.permissions.REPORTS])

    if (!req.query.stakeholder_id) {
      return await handleResponse({
        req,
        res: { statusCode: 400, message: 'stakeholder_id es requerido' },
      })
    }

    const toNumber = value => Number(value) || 0
    const limit = Math.max(1, toNumber(req.query.$limit) || 20)
    const offset = Math.max(0, toNumber(req.query.$offset) || 0)
    const queryFields = {
      ...req.query,
      $limit: limit,
      $offset: offset,
    }

    const [rows, countRows] = await Promise.all([
      db.query(storage.getClientAccountInvoices(queryFields)),
      db.query(storage.getClientAccountInvoicesCount(queryFields)),
    ])

    const invoiceIds = (rows || []).map(row => row.id).filter(Boolean)
    const paymentRows = invoiceIds.length
      ? await db.query(
          storage.getClientAccountInvoicePayments({
            stakeholder_id: req.query.stakeholder_id,
            document_ids: invoiceIds.join(','),
          })
        )
      : []

    const paymentsByDocument = (paymentRows || []).reduce((acc, row) => {
      const key = String(row.document_id)
      if (!acc[key]) acc[key] = []
      acc[key].push({
        payment_id: row.payment_id,
        payment_date: row.payment_date,
        payment_amount: toNumber(row.payment_amount),
        reference: row.reference || '',
        document_number: row.document_number,
      })
      return acc
    }, {})

    const items = (rows || []).map(row => ({
      id: row.id,
      document_number: row.document_number,
      serie: row.serie,
      document_date: row.document_date,
      due_date: row.due_date,
      total_amount: toNumber(row.total_amount),
      paid_amount: toNumber(row.paid_amount),
      unpaid_amount: toNumber(row.unpaid_amount),
      last_payment_date: row.last_payment_date || null,
      days_overdue: toNumber(row.days_overdue),
      payment_status: row.payment_status,
      payments: paymentsByDocument[String(row.id)] || [],
    }))

    const countRow = countRows?.[0] || {}

    return await handleResponse({
      req,
      res: {
        statusCode: 200,
        data: {
          items,
          summary: {
            total_unpaid_amount: toNumber(countRow.total_unpaid_amount),
            total_paid_amount: toNumber(countRow.total_paid_amount),
          },
          pagination: {
            total: toNumber(countRow.total),
            limit,
            offset,
          },
        },
      },
    })
  } catch (error) {
    console.log(error)
    return await handleResponse({ error })
  }
}

module.exports.accountsReceivable = async event => {
  try {
    const req = await handleRequest({ event })

    req.hasPermissions([types.permissions.REPORTS])

    const res = await handleRead(req, { dbQuery: db.query, storage: storage.getAccountsReceivable })

    const items = await enrichReportDocuments(res.data, 'total_amount')
    const enrichedItems = items.map(row => {
      const adjustedTotal = Number(row.adjusted_total ?? row.total_amount ?? 0)
      const paidCredit = Number(row.paid_credit_amount || 0)

      return {
        ...row,
        unpaid_credit_amount: adjustedTotal - paidCredit,
      }
    })

    return await handleResponse({
      req,
      res: {
        ...res,
        data: enrichedItems,
      },
    })
  } catch (error) {
    console.log(error)
    return await handleResponse({ error })
  }
}

module.exports.sales = async event => {
  try {
    const req = await handleRequest({ event })

    req.hasPermissions([types.permissions.REPORTS])

    const res = await handleRead(req, { dbQuery: db.query, storage: storage.getSales })

    const filterFields = storage.stripPaginationFields(req.query)
    const summaryRows = await db.query(storage.getSalesSummary(filterFields))
    const countResult = await db.query(storage.getSalesCount(req.query))

    const summaryRow = summaryRows[0] || {}
    const toNumber = value => Number(value) || 0
    const enrichedItems = await enrichReportDocuments(res.data, 'total_amount')

    return await handleResponse({
      req,
      res: {
        statusCode: 200,
        data: {
          items: enrichedItems,
          summary: {
            total_documents: toNumber(summaryRow.total_documents),
            total_billed: toNumber(summaryRow.total_billed),
          },
          pagination: { total: toNumber(countResult[0]?.total) },
        },
      },
    })
  } catch (error) {
    console.log(error)
    return await handleResponse({ error })
  }
}

module.exports.inventory = async event => {
  try {
    const req = await handleRequest({ event })

    req.hasPermissions([types.permissions.REPORTS])

    const res = await handleRead(req, {
      dbQuery: db.query,
      storage: storage.getInventory,
      nestedFieldsKeys: ['inventory_movements', 'inventory_movements_details'],
      uniqueKey: ['product_id'],
    })

    const filterFields = storage.stripPaginationFields(req.query)
    const summaryRows = await db.query(storage.getInventorySummary(filterFields))
    const countResult = await db.query(storage.getInventoryCount(req.query))

    const mapInventoryProduct = product => {
      const inventoryMovements = product.inventory_movements.reduce((r, im) => {
        const isDuplicateMovement = r.some(
          rim => Number(rim.inventory_movement_id) === Number(im.inventory_movement_id)
        )

        if (isDuplicateMovement) return r
        return [...r, im]
      }, [])

      const inventoryMovementsWithDetais = inventoryMovements.map(im => {
        const inventory_movements_details = product.inventory_movements_details.flatMap(imd =>
          Number(imd.inventory_movement_id) === Number(im.inventory_movement_id) ? imd : []
        )

        return { ...im, inventory_movements_details }
      })

      delete product.inventory_movements_details

      return { ...product, inventory_movements: inventoryMovementsWithDetais }
    }

    const summaryRow = summaryRows[0] || {}
    const toNumber = value => Number(value) || 0

    return await handleResponse({
      req,
      res: {
        statusCode: 200,
        data: {
          items: res.data.map(mapInventoryProduct),
          summary: {
            total_items: toNumber(summaryRow.total_items),
            total_value: toNumber(summaryRow.total_value),
          },
          pagination: { total: toNumber(countResult[0]?.total) },
        },
      },
    })
  } catch (error) {
    console.log(error)
    return await handleResponse({ error })
  }
}

module.exports.getDocumentReport = async (event, context) => {    
  try {
    console.log("---REPORTE FACTURAS---")
    const req = await handleRequest({ event })

    const res = await handleRead(req, { dbQuery: db.query, storage: storage.getInvoice, nestedFieldsKeys: ['products'] })

    const filterFields = storage.stripPaginationFields(req.query)
    const summaryRows = await db.query(storage.getInvoiceSummary(filterFields))
    const countResult = await db.query(storage.getInvoiceCount(req.query))

    const summaryRow = summaryRows[0] || {}
    const toNumber = value => Number(value) || 0

    const items = res.data.map(invoice => ({
      ...invoice,
      discount_percentage: invoice.products[0]?.discount_percentage,
    }))
    const enrichedItems = await enrichReportDocuments(items, 'total')

    return await handleResponse({
      req,
      res: {
        statusCode: 200,
        data: {
          items: enrichedItems,
          summary: {
            total_invoices: toNumber(summaryRow.total_invoices),
            approved_count: toNumber(summaryRow.approved_count),
            cancelled_count: toNumber(summaryRow.cancelled_count),
            approved_total: toNumber(summaryRow.approved_total),
            cancelled_total: toNumber(summaryRow.cancelled_total),
          },
          pagination: { total: toNumber(countResult[0]?.total) },
        },
      },
    })
  } catch (error) {
    console.log(error)
    return await handleResponse({ error })
  }
}

const mapCashReceiptDocument = d => {
  const payments =
    d.payments && d.payments[0]
      ? d.payments.reduce((r, p) => {
          const isDuplicate =
            r[0] && r.some(rp => Number(rp.payment_id) === Number(p.payment_id))

          if (isDuplicate || !p.payment_id || p.is_deleted) return r
          return [...r, p]
        }, [])
      : []

  const due = payments
    .filter(item => item.is_deleted === 0)
    .reduce((sum, { payment_amount }) => sum + payment_amount, 0)

  const products =
    d.products && d.products[0]
      ? d.products.reduce((r, p) => {
          const isDuplicate =
            r[0] &&
            r.some(
              rp =>
                Number(rp.id) === Number(p.id) &&
                Number(rp.parent_product_id) === Number(p.parent_product_id)
            )

          if (isDuplicate) return r
          return [...r, p]
        }, [])
      : []

  return {
    ...d,
    discount_percentage: d.products[0]?.discount_percentage,
    due,
    products,
    payments,
  }
}

const buildReceiptsSummary = summaryRow => {
  const toNumber = value => Number(value) || 0
  const totalBilled = toNumber(summaryRow.total_billed)
  const totalPaid = toNumber(summaryRow.total_paid)
  const electronicBilled = toNumber(summaryRow.electronic_billed)
  const electronicPaid = toNumber(summaryRow.electronic_paid)
  const systemBilled = toNumber(summaryRow.system_billed)
  const systemPaid = toNumber(summaryRow.system_paid)

  return {
    total_invoices: toNumber(summaryRow.total_invoices),
    total_billed: totalBilled,
    total_paid: totalPaid,
    total_balance: totalBilled - totalPaid,
    electronic: {
      count: toNumber(summaryRow.electronic_count),
      billed: electronicBilled,
      paid: electronicPaid,
      balance: electronicBilled - electronicPaid,
    },
    system: {
      count: toNumber(summaryRow.system_count),
      billed: systemBilled,
      paid: systemPaid,
      balance: systemBilled - systemPaid,
    },
  }
}

module.exports.getCashReceipts = async (event, context) => {    
  try {
    const req = await handleRequest({ event })

    const { systemInvoice } = storage.parseReceiptsFilterFields(req.query)

    if (systemInvoice) {
      delete req.query.document_number
    }

    const res = await handleRead(req, {
      dbQuery: db.query,
      storage: storage.getReceipts,
      nestedFieldsKeys: ['products', 'payments'],
    })

    const filterFields = storage.stripPaginationFields(req.query)
    const summaryRows = await db.query(storage.getReceiptsSummary(filterFields))
    const countResult = await db.query(storage.getReceiptsCount(req.query))

    const items = res.data[0] ? res.data.map(mapCashReceiptDocument) : []
    const enrichedItems = await enrichReportDocuments(items, 'total_amount')
    const toNumber = value => Number(value) || 0

    return await handleResponse({
      req,
      res: {
        statusCode: 200,
        data: {
          items: enrichedItems,
          summary: buildReceiptsSummary(summaryRows[0] || {}),
          pagination: { total: toNumber(countResult[0]?.total) },
        },
      },
    })
  } catch (error) {
    console.log(error)
    return await handleResponse({ error })
  }
}

const mapManualReceiptDocument = d => {
  const payments =
    d.payments && d.payments[0]
      ? d.payments.reduce((r, p) => {
          const isDuplicate =
            r[0] && r.some(rp => Number(rp.payment_id) === Number(p.payment_id))

          if (isDuplicate || !p.payment_id || p.is_deleted) return r
          return [...r, p]
        }, [])
      : []

  const due = payments
    .filter(item => item.is_deleted === 0)
    .reduce((sum, { payment_amount }) => sum + payment_amount, 0)

  return {
    ...d,
    due,
    payments,
    differenceAmount: d.total_amount - due,
  }
}

module.exports.getCashManualReceipts = async (event, context) => {    
  try {
    const req = await handleRequest({ event })

    const res = await handleRead(req, {
      dbQuery: db.query,
      storage: storage.getManualReceipts,
      nestedFieldsKeys: ['payments'],
    })

    const filterFields = storage.stripPaginationFields(req.query)
    const summaryRows = await db.query(storage.getManualReceiptsSummary(filterFields))
    const countResult = await db.query(storage.getManualReceiptsCount(req.query))

    const summaryRow = summaryRows[0] || {}
    const toNumber = value => Number(value) || 0
    const totalBilled = toNumber(summaryRow.total_billed)
    const totalPaid = toNumber(summaryRow.total_paid)

    const items = res.data[0] ? res.data.map(mapManualReceiptDocument) : []

    return await handleResponse({
      req,
      res: {
        statusCode: 200,
        data: {
          items,
          summary: {
            total_receipts: toNumber(summaryRow.total_receipts),
            total_billed: totalBilled,
            total_paid: totalPaid,
            total_balance: totalBilled - totalPaid,
          },
          pagination: { total: toNumber(countResult[0]?.total) },
        },
      },
    })
  } catch (error) {
    console.log(error)
    return await handleResponse({ error })
  }
}

module.exports.getServiceOrders = async event => {
  try {
    const req = await handleRequest({ event })
    req.hasPermissions([types.permissions.REPORTS])

    const res = await handleRead(req, {
      dbQuery: db.query,
      storage: storage.getServiceOrders,
      nestedFieldsKeys: ['products'],
    })

    const filterFields = storage.stripPaginationFields(req.query)
    const summaryRows = await db.query(storage.getServiceOrdersSummary(filterFields))
    const countResult = await db.query(storage.getServiceOrdersCount(req.query))

    const summaryRow = summaryRows[0] || {}
    const toNumber = value => Number(value) || 0

    return await handleResponse({
      req,
      res: {
        statusCode: 200,
        data: {
          items: res.data,
          summary: {
            total_orders: toNumber(summaryRow.total_orders),
            approved_count: toNumber(summaryRow.approved_count),
            pending_count: toNumber(summaryRow.pending_count),
            cancelled_count: toNumber(summaryRow.cancelled_count),
          },
          pagination: { total: toNumber(countResult[0]?.total) },
        },
      },
    })
  } catch (error) {
    console.log(error)
    return await handleResponse({ error })
  }
}

module.exports.salesProductReport = async event => {
  try {
    const req = await handleRequest({ event })
    req.hasPermissions([types.permissions.REPORTS])
    const res = await handleRead(req, { dbQuery: db.query, storage: storage.getSalesProductReport })

    const filterFields = storage.stripPaginationFields(req.query)

    const summaryRows = await db.query(storage.getSalesProductReportSummary(filterFields))
    const topProductRows = await db.query(storage.getTopSoldItem(filterFields, types.productsTypes.PRODUCT))
    const topServiceRows = await db.query(storage.getTopSoldItem(filterFields, types.documentsServiceType.SERVICE))
    const topEquipmentRows = await db.query(
      storage.getTopSoldItem(filterFields, types.documentsServiceType.EQUIPMENT)
    )
    const countResult = await db.query(storage.getSalesProductReportCount(req.query))

    const getSummaryByType = itemType =>
      summaryRows.find(row => row.item_type === itemType) || {}

    const summary = {
      top_product: topProductRows[0] || null,
      top_service: topServiceRows[0] || null,
      top_equipment: topEquipmentRows[0] || null,
      products_total_quantity: getSummaryByType(types.productsTypes.PRODUCT).total_quantity || 0,
      services_total_quantity: getSummaryByType(types.documentsServiceType.SERVICE).total_quantity || 0,
      equipment_total_quantity: getSummaryByType(types.documentsServiceType.EQUIPMENT).total_quantity || 0,
      products_total_amount: getSummaryByType(types.productsTypes.PRODUCT).total_amount || 0,
      services_total_amount: getSummaryByType(types.documentsServiceType.SERVICE).total_amount || 0,
      equipment_total_amount: getSummaryByType(types.documentsServiceType.EQUIPMENT).total_amount || 0,
    }

    return await handleResponse({
      req,
      res: {
        statusCode: 200,
        data: {
          items: res.data,
          summary,
          pagination: { total: countResult[0]?.total || 0 },
        },
      },
    })
  } catch (error) {
    console.log(error)
    return await handleResponse({ error })
  }
}
//export excel

module.exports.exportReport = async event => {
  
  try {
    let manifestoHeaders
    let manifestoHeadersProducts
    let manifestoHeadersPayments
    let result,report,file

    const req = await handleRequest({ event })
    const reportType  = req.queryStringParameters.reportType      
    delete req.query.reportType    

    let systemInvoice =  req.queryStringParameters.document_number ? (req.queryStringParameters.document_number.toLowerCase() === '$like:%factura del sistema%') : false
    
    if(systemInvoice && reportType === "cashReceipts"){      
      delete req.query.document_number
    }

    switch (reportType) {
      case "documentReport":
        result = await handleRead(req, { dbQuery: db.query, storage: storage.getInvoice, nestedFieldsKeys: ['products'] })    
        manifestoHeaders = [
          { name: 'Nro. Nota de servicio', column: 'related_internal_document_id', width: 18 },
          { name: 'Nro. Documento', column: 'document_number', width: 12 },
          { name: 'UUID', column: 'uuid', width: 36 },
          { name: 'Cliente', column: 'stakeholder_name', width: 48 },
          { name: 'Fecha de Certificacion', column: 'fact_date', width: 18, numFmt: 'dd-mm-yyyy hh:mm:ss'},
          { name: 'Total', column: 'total', width: 14 ,numFmt: '"Q"#,##0.00'},
          { name: 'Metodo de pago', column: 'payment_method_spanish', width: 17 },
          { name: 'Estado', column: 'status_spanish', width: 17 }      
        ]
        break;
      case "cashReceipts":
        result = await handleRead(req, { dbQuery: db.query, storage: storage.getReceiptsExport })
        result.data = await mapCashReceiptsExportRows(result.data)

        manifestoHeaders = [
          { name: 'Nro. Nota de servicio', column: 'related_internal_document_id', width: 18 },
          { name: 'Nro. Documento', column: 'document_number', width: 17 },                    
          { name: 'Fecha de Certificacion', column: 'created_at', width: 18, numFmt: 'dd-mm-yyyy'},
          { name: 'Cliente', column: 'stakeholder_name', width: 48 },          
          { name: 'Monto Pendiente', column: 'differenceAmount', width: 14 ,numFmt: '"Q"#,##0.00'},
          { name: 'Monto Total', column: 'total_amount', width: 14 ,numFmt: '"Q"#,##0.00'},                    
          { name: 'Detalle', column: 'producto_lit', width: 60},                    
        ]
        break;
      case "manualCashReceipts":
        result = await handleRead(req, { dbQuery: db.query, storage: storage.getManualReceipts, nestedFieldsKeys: ['payments'] })
        result.data = result.data[0]
        ? result.data.map(d => 
          {
            let composeData = { 
            ...d,            
            due: d.payments && d.payments[0] ? d.payments.reduce((r, p) => {
              const isDuplicate = r[0] && r.some(rp => Number(rp.payment_id) === Number(p.payment_id))
  
              if (isDuplicate || !p.payment_id || p.is_deleted) return r
              else return [...r, p]
            }, []).filter(item => item.is_deleted === 0).reduce((sum ,{payment_amount}) => sum + payment_amount , 0) : 0,
           
            payments:
            d.payments && d.payments[0]
              ? d.payments.reduce((r, p) => {
                  const isDuplicate = r[0] && r.some(rp => Number(rp.payment_id) === Number(p.payment_id))

                  if (isDuplicate || !p.payment_id || p.is_deleted) return r
                  else return [...r, p]
                }, [])
              : []
          }
  
          composeData.differenceAmount = composeData.total_amount - composeData.due          
          return composeData
        })
        : []  

        
        manifestoHeaders = [          
          { name: 'Nro. Recibo', column: 'id', width: 12 },                    
          { name: 'Fecha de facturacion', column: 'created_at', width: 18, numFmt: 'dd-mm-yyyy hh:mm:ss'},
          { name: 'Cliente', column: 'stakeholder_name', width: 48 },
          { name: 'Monto Pagado', column: 'due', width: 14 ,numFmt: '"Q"#,##0.00'},
          { name: 'Monto Pendiente', column: 'differenceAmount', width: 14 ,numFmt: '"Q"#,##0.00'},
          { name: 'Monto Total', column: 'total_amount', width: 14 ,numFmt: '"Q"#,##0.00'},
          { name: 'Estado', column: 'status_spanish', width: 17 }
        ]
        break;    
      case "clientReport":
          req.hasPermissions([types.permissions.REPORTS])
          result = await handleRead(req, { dbQuery: db.query, storage: storage.getClientAccountState })
          result.data = result.data[0] ? result.data.map(d => {
            const balance = Number(d.balance) || 0

            return {
              ...d,
              credit_limit: Number(d.credit_limit) || 0,
              balance,
              total_paid: Number(d.total_paid) || 0,
              aging_0_30: Number(d.aging_0_30) || 0,
              aging_31_60: Number(d.aging_31_60) || 0,
              aging_61_90: Number(d.aging_61_90) || 0,
              aging_over_90: Number(d.aging_over_90) || 0,
              max_days_overdue: Number(d.max_days_overdue) || 0,
              unpaid_invoices_count: Number(d.unpaid_invoices_count) || 0,
              paid_invoices_count: Number(d.paid_invoices_count) || 0,
              last_movement_date: d.last_movement_date || null,
              last_payment_date: d.last_payment_date || null,
              last_payment_document: d.last_payment_document || null,
              account_status: d.account_status,
              account_status_label:
                d.account_status === 'AL_DIA'
                  ? 'Ya pagado'
                  : d.account_status === 'POR_VENCER'
                    ? 'Pendiente de pago'
                    : d.account_status === 'VENCIDO_90'
                      ? 'Vencido +90'
                      : 'Vencido',
            }
          }) : []

        manifestoHeaders = [
          { name: 'Codigo Cliente', column: 'id', width: 12 },
          { name: 'Nombre o razon social', column: 'name', width: 28 },
          { name: 'Nit', column: 'nit', width: 15 },
          { name: 'Tipo', column: 'stakeholder_type_spanish', width: 18 },
          { name: 'Estado', column: 'account_status_label', width: 16 },
          { name: 'Saldo pendiente', column: 'balance', width: 14, numFmt: '"Q"#,##0.00' },
          { name: 'Total pagado', column: 'total_paid', width: 14, numFmt: '"Q"#,##0.00' },
          { name: 'Dias atraso', column: 'max_days_overdue', width: 12 },
          { name: 'Facturas pendientes', column: 'unpaid_invoices_count', width: 14 },
          { name: 'Facturas pagadas', column: 'paid_invoices_count', width: 14 },
          { name: 'Ultimo movimiento', column: 'last_movement_date', width: 16, numFmt: 'dd-mm-yyyy' },
          { name: 'Ultimo pago', column: 'last_payment_date', width: 16, numFmt: 'dd-mm-yyyy' },
          { name: 'Factura ultimo pago', column: 'last_payment_document', width: 18 },
          { name: 'Proximo vencimiento', column: 'next_due_date', width: 16, numFmt: 'dd-mm-yyyy' },
          { name: '0-30 dias', column: 'aging_0_30', width: 12, numFmt: '"Q"#,##0.00' },
          { name: '31-60 dias', column: 'aging_31_60', width: 12, numFmt: '"Q"#,##0.00' },
          { name: '61-90 dias', column: 'aging_61_90', width: 12, numFmt: '"Q"#,##0.00' },
          { name: '+90 dias', column: 'aging_over_90', width: 12, numFmt: '"Q"#,##0.00' },
        ]
        break;
      case "clientAccountDetailReport": {
        req.hasPermissions([types.permissions.REPORTS])

        if (!req.query.stakeholder_id) {
          return await handleResponse({
            req,
            res: {
              statusCode: 400,
              data: { error: 'stakeholder_id es requerido' },
              message: 'stakeholder_id es requerido',
            },
          })
        }

        const toNumber = value => Number(value) || 0
        const toText = value => (value == null ? '' : String(value))
        const toSortDate = value => {
          if (!value) return 0
          const time = new Date(value).getTime()
          return Number.isNaN(time) ? 0 : time
        }
        const viewMode = String(req.query.view_mode || 'UNPAID').toUpperCase()
        delete req.query.view_mode

        if (viewMode === 'HISTORY') {
          const [openingRows, invoiceRows, paymentRows, noteRows] = await Promise.all([
            db.query(storage.getClientAccountOpeningBalance(req.query)),
            db.query(storage.getClientAccountInvoiceMovements(req.query)),
            db.query(storage.getClientAccountPaymentMovements(req.query)),
            db.query(storage.getClientAccountNoteMovements(req.query)),
          ])

          const openingBalance = toNumber(openingRows?.[0]?.opening_balance)
          const rows = [...(invoiceRows || []), ...(paymentRows || []), ...(noteRows || [])].sort(
            (a, b) => {
              const dateDiff = toSortDate(a.movement_date) - toSortDate(b.movement_date)
              if (dateDiff !== 0) return dateDiff
              return toNumber(a.sort_id) - toNumber(b.sort_id)
            }
          )

          let runningBalance = openingBalance
          let allItems = rows.map(row => {
            const chargeAmount = toNumber(row.charge_amount)
            const creditAmount = toNumber(row.credit_amount)
            runningBalance = runningBalance + chargeAmount - creditAmount

            const movementType = toText(row.movement_type)
            const movementTypeLabel =
              movementType === 'INVOICE'
                ? 'Factura'
                : movementType === 'MANUAL_INVOICE'
                  ? 'Factura manual'
                  : movementType === 'PAYMENT'
                    ? 'Pago'
                    : movementType === 'CREDIT_NOTE'
                      ? 'Nota credito'
                      : movementType === 'DEBIT_NOTE'
                        ? 'Nota debito'
                        : movementType

            return {
              movement_date: row.movement_date,
              movement_type_label: movementTypeLabel,
              document_number: toText(row.document_number),
              reference: toText(row.reference),
              charge_amount: chargeAmount,
              credit_amount: creditAmount,
              running_balance: runningBalance,
            }
          })

          const documentNumber = toText(req.query.document_number).trim().toLowerCase()
          if (documentNumber) {
            allItems = allItems.filter(item =>
              toText(item.document_number).toLowerCase().includes(documentNumber)
            )
          }

          result = { statusCode: 200, data: allItems }
          manifestoHeaders = [
            { name: 'Fecha', column: 'movement_date', width: 16, numFmt: 'dd-mm-yyyy' },
            { name: 'Tipo', column: 'movement_type_label', width: 14 },
            { name: 'Documento', column: 'document_number', width: 16 },
            { name: 'Referencia', column: 'reference', width: 28 },
            { name: 'Cargo', column: 'charge_amount', width: 14, numFmt: '"Q"#,##0.00' },
            { name: 'Abono', column: 'credit_amount', width: 14, numFmt: '"Q"#,##0.00' },
            { name: 'Saldo', column: 'running_balance', width: 14, numFmt: '"Q"#,##0.00' },
          ]
        } else {
          const { $limit, $offset, ...invoiceQuery } = req.query
          const rows = await db.query(
            storage.getClientAccountInvoices({
              ...invoiceQuery,
              payment_status: viewMode,
            })
          )

          result = {
            statusCode: 200,
            data: (rows || []).map(row => ({
              document_number: row.document_number,
              document_date: row.document_date,
              due_date: row.due_date,
              total_amount: toNumber(row.total_amount),
              paid_amount: toNumber(row.paid_amount),
              unpaid_amount: toNumber(row.unpaid_amount),
              last_payment_date: row.last_payment_date || null,
              payment_status_label:
                row.payment_status === 'PAID' ? 'Pagada' : 'Pendiente',
            })),
          }

          manifestoHeaders = [
            { name: 'Factura', column: 'document_number', width: 16 },
            { name: 'Fecha', column: 'document_date', width: 16, numFmt: 'dd-mm-yyyy' },
            { name: 'Vence', column: 'due_date', width: 16, numFmt: 'dd-mm-yyyy' },
            { name: 'Total', column: 'total_amount', width: 14, numFmt: '"Q"#,##0.00' },
            { name: 'Pagado', column: 'paid_amount', width: 14, numFmt: '"Q"#,##0.00' },
            { name: 'Pendiente', column: 'unpaid_amount', width: 14, numFmt: '"Q"#,##0.00' },
            { name: 'Ultimo pago', column: 'last_payment_date', width: 16, numFmt: 'dd-mm-yyyy' },
            { name: 'Estado', column: 'payment_status_label', width: 12 },
          ]
        }
        break
      }
      case "inventoryReport": case "inventoryReportDetail":
        req.hasPermissions([types.permissions.REPORTS])

        result = await handleRead(req, {
          dbQuery: db.query,
          storage: storage.getInventory,
          nestedFieldsKeys: ['inventory_movements', 'inventory_movements_details'],
          uniqueKey: ['product_id'],
        })
                
        result.data = result.data.map(product => {
          const inventoryMovements = product.inventory_movements.reduce((r, im) => {
            const isDuplicateMovement = r.some(rim => Number(rim.inventory_movement_id) === Number(im.inventory_movement_id))
    
            if (isDuplicateMovement) return r
            else return [...r, im]
          }, [])
    
          const inventoryMovementsWithDetais = inventoryMovements.map(im => {
            const inventory_movements_details = product.inventory_movements_details.flatMap(imd =>
              Number(imd.inventory_movement_id) === Number(im.inventory_movement_id) ? imd : []
            ) 
    
            return { ...im, inventory_movements_details, name:product.description }
          })
    
          delete product.inventory_movements_details

          if(reportType === "inventoryReport"){
            return { ...product, inventory_movements: inventoryMovementsWithDetais }
          } else{                 
            return inventoryMovementsWithDetais
          }                   
        })
                              
        if(reportType === "inventoryReport"){

          manifestoHeaders = [          
            { name: 'Codigo', column: 'code', width: 12 },                    
            { name: 'Nombre Producto', column: 'description', width: 28},
            { name: 'Costo Unitario promedio', column: 'inventory_unit_value', width: 28,numFmt: '"Q"#,##0.00'},
            { name: 'Existencias', column: 'stock', width: 18 },
            { name: 'valor total', column: 'inventory_total_value', width: 18 ,numFmt: '"Q"#,##0.00'},
            { name: 'Categoria', column: 'product_category_spanish', width: 18 },
            { name: 'Estado', column: 'status', width: 14}          
          ]
        }else{
          
          result.data = result.data[0]      

          manifestoHeaders = [          
            { name: 'Fecha', column: 'created_at', width: 19,numFmt: 'dd-mm-yyyy hh:mm:ss'},                    
            { name: 'Nombre Producto', column: 'name', width: 30},
            { name: 'Autorizado por', column: 'creator_name', width: 16},
            { name: 'Existencias del movimiento', column: 'quantity', width: 16 },
            { name: 'Valor Unitiario del movimiento', column: 'unit_cost', width: 16 ,numFmt: '"Q"#,##0.00'},
            { name: 'Valor Total del movimiento', column: 'total_cost', width: 16 ,numFmt: '"Q"#,##0.00'},
            { name: 'Existencias actuales', column: 'inventory_quantity', width: 16 },
            { name: 'Valor unitario promedio', column: 'inventory_unit_cost', width: 16,numFmt: '"Q"#,##0.00'},
            { name: 'Valor total actual', column: 'inventory_total_cost', width: 16,numFmt: '"Q"#,##0.00'}          
          ]
        }        
          break; 
      case "salesReport":
        req.hasPermissions([types.permissions.REPORTS])
        result = await handleRead(req, { dbQuery: db.query, storage: storage.getSales })
        manifestoHeaders = [          
          { name: 'Tipo', column: 'document_type_spanish', width: 15 },                    
          { name: '# Nota de servicio', column: 'related_internal_document_id', width: 28},
          { name: '# Documento', column: 'document_number_report', width: 15},
          { name: 'Fecha', column: 'created_at', width: 18,numFmt: 'dd-mm-yyyy hh:mm:ss' },
          { name: 'Metodo de pago', column: 'payment_method_spanish', width: 18 },
          { name: 'Monto', column: 'total_amount', width: 14 ,numFmt: '"Q"#,##0.00'},          
          { name: 'Estado', column: 'credit_status_spanish', width: 18},
          { name: 'Cliente', column: 'stakeholder_name', width: 20},
          { name: 'Email', column: 'email', width: 30},
          { name: 'Telefono', column: 'phone', width: 18},
          { name: 'Direccion', column: 'address', width: 30},
          { name: 'Encargado(Cliente)', column: 'business_man', width: 18},
          { name: 'Quien Entrega', column: 'dispatched_by', width: 18},
          { name: 'Quien Recibe', column: 'received_by', width: 18},
          { name: 'Vendedor', column: 'seller_name', width: 18}
        ]
        break
      case "serviceOrders":
          req.hasPermissions([types.permissions.REPORTS])
          result = await handleRead(req, { dbQuery: db.query, storage: storage.getServiceOrdersExport })
          result.data = await mapServiceOrdersExportRows(result.data)
          manifestoHeaders = [                      
            { name: '# Nota de servicio', column: 'id', width: 28},            
            { name: 'Cliente', column: 'stakeholder_name', width: 20},                                    
            { name: 'Proyecto', column: 'project_name', width: 20},                        
            { name: 'Fecha Inicio', column: 'project_start_date', width: 18,numFmt: 'dd-mm-yyyy' },            
            { name: 'Observaciones', column: 'comments', width: 35}]
          manifestoHeadersProducts = [
            { name: 'Referencia Nota de servicio', column: 'nota_id', width: 18},
            { name: 'Codigo Producto', column: 'code', width: 18},
            { name: 'Producto', column: 'description', width: 45},
            { name: 'Tipo', column: 'service_type_spanish', width: 20},
            { name: 'Precio', column: 'total_product_amount', width: 20,numFmt: '"Q"#,##0.00'},
            { name: 'Cantidad', column: 'quantity', width: 20}]
          break
      case "salesProducts":
        req.hasPermissions([types.permissions.REPORTS])
        result = await handleRead(req, { dbQuery: db.query, storage: storage.getSalesProductReport })
        manifestoHeaders = [
          { name: 'Tipo', column: 'item_type_spanish', width: 15 },
          { name: 'Categoria', column: 'sales_category_spanish', width: 15 },
          { name: 'Codigo', column: 'code', width: 18 },
          { name: 'Nombre / Descripcion', column: 'description', width: 40 },
          { name: 'Cantidad vendida', column: 'product_quantity', width: 15 },
          { name: 'Total vendido', column: 'total_amount', width: 15, numFmt: '"Q"#,##0.00' },
        ]
        break
      case "commissionsReport":
        req.hasPermissions([types.permissions.REPORTS])
        result = await handleRead(req, { dbQuery: db.query, storage: storage.getCommissionReport })
        result.data = result.data.map(row => ({
          ...row,
          commission_percentage: Number(row.commission_percentage) / 100,
          is_paid_spanish: row.invoice_status === 'CANCELLED' ? 'Anulada' : Number(row.is_paid) ? 'Pagada' : 'No pagada',
          commission_paid_spanish: row.commission_paid_at ? 'Pagada' : 'Por pagar',
          commission_paid_amount: row.commission_paid_amount == null ? null : Number(row.commission_paid_amount),
        }))
        manifestoHeaders = [
          { name: '# Documento', column: 'document_number', width: 18 },
          { name: 'Fecha', column: 'document_date', width: 14, numFmt: 'dd-mm-yyyy' },
          { name: 'Nit', column: 'stakeholder_nit', width: 15 },
          { name: 'Cliente', column: 'stakeholder_name', width: 40 },
          { name: 'Vendedor', column: 'seller_name', width: 25 },
          { name: 'Total factura', column: 'total_amount', width: 16, numFmt: '"Q"#,##0.00' },
          { name: 'Base (para comision)', column: 'base_amount', width: 18, numFmt: '"Q"#,##0.00' },
          { name: '% Comision', column: 'commission_percentage', width: 12, numFmt: '0.00%' },
          { name: 'Comision', column: 'commission_amount', width: 16, numFmt: '"Q"#,##0.00' },
          { name: 'Estado factura', column: 'is_paid_spanish', width: 16 },
          { name: 'Comision pagada al vendedor', column: 'commission_paid_spanish', width: 26 },
          { name: 'Fecha pago comision', column: 'commission_paid_at', width: 20, numFmt: 'dd-mm-yyyy hh:mm:ss' },
          { name: 'Monto pagado', column: 'commission_paid_amount', width: 16, numFmt: '"Q"#,##0.00' },
        ]
        break
      case "commissionsSellersReport":
        req.hasPermissions([types.permissions.REPORTS])
        result = await handleRead(req, { dbQuery: db.query, storage: storage.getCommissionSummary })
        result.data = buildCommissionSummary(result.data).by_seller.map(seller => ({
          seller_name: seller.seller_name,
          commission_percentage: seller.commission_percentage / 100,
          to_pay_count: seller.to_pay.invoices_count,
          to_pay_commission: seller.to_pay.commission_amount,
          paid_count: seller.commission_paid.invoices_count,
          paid_commission: seller.commission_paid.commission_amount,
          cancelled_count: seller.cancelled_paid.invoices_count,
          cancelled_commission: seller.cancelled_paid.commission_amount,
          unpaid_count: seller.unpaid.invoices_count,
          unpaid_commission: seller.unpaid.commission_amount,
        }))
        manifestoHeaders = [
          { name: 'Vendedor', column: 'seller_name', width: 28 },
          { name: 'Comision', column: 'commission_percentage', width: 12, numFmt: '0.00%' },
          { name: 'Facturas por pagar comision', column: 'to_pay_count', width: 22 },
          { name: 'Comision por pagar', column: 'to_pay_commission', width: 18, numFmt: '"Q"#,##0.00' },
          { name: 'Facturas comision pagada', column: 'paid_count', width: 22 },
          { name: 'Comision ya pagada', column: 'paid_commission', width: 18, numFmt: '"Q"#,##0.00' },
          { name: 'Facturas anuladas con comision pagada', column: 'cancelled_count', width: 30 },
          { name: 'Comision pagada a facturas anuladas', column: 'cancelled_commission', width: 30, numFmt: '"Q"#,##0.00' },
          { name: 'Facturas no pagadas (cliente)', column: 'unpaid_count', width: 24 },
          { name: 'Comision pendiente', column: 'unpaid_commission', width: 18, numFmt: '"Q"#,##0.00' },
        ]
        break
      default:
        break;
    }

    if (reportType === 'documentReport' && result?.data?.length) {
      result.data = applyAdjustedExportValues(
        await enrichReportDocuments(result.data, 'total')
      )
    }

    if (reportType === 'cashReceipts' && result?.data?.length) {
      result.data = applyAdjustedExportValues(
        await enrichReportDocuments(result.data, 'total_amount')
      )
    }

    if (reportType === 'salesReport' && result?.data?.length) {
      result.data = applyAdjustedExportValues(
        await enrichReportDocuments(result.data, 'total_amount')
      )
    }
                
    const manifestData = result.data ? result.data : []
    
    if(reportType === "cashReceipts"){
      const exportRows = toCashReceiptsExcelRows(manifestData)

      report = await standardReport({
        sheets: [
          {
            name: `RECIBOS`,
            headers: manifestoHeaders,
            data: systemInvoice
              ? exportRows.filter(item => item.document_number === 'Factura del sistema')
              : exportRows,
          }          
        ],
      }) 

    }
    else if(reportType === "serviceOrders"){
      
      const manifestDataProducts = manifestData.flatMap(it =>
        (it.products || []).map(v => ({ ...v, nota_id: it.id }))
      )

      report = await standardReport({
        sheets: [
          {
            name: `NOTA DE SERVICIO`,
            headers: manifestoHeaders,
            data: systemInvoice ? manifestData.filter(item => item.document_number === 'Factura del sistema') : manifestData,
          },
          {
            name: `DETALLE NOTA DE SERVICIO`,
            headers: manifestoHeadersProducts,
            data: manifestDataProducts
          }
        ],
      }) 
    }else{
      report = await standardReport({
        sheets: [
          {
            name: `INFORMACION`,
            headers: manifestoHeaders,
            data: systemInvoice ? manifestData.filter(item => item.document_number === 'Factura del sistema') : manifestData,
          }        
        ],
      })
    }
              
    file = await report.xlsx.writeBuffer()

    let data = {"reportExcel":file.toString('base64')}
    
    return await handleResponse({ req, res: { ...result, data } })
  } catch (error) {
    console.log(error)
    return await handleResponse({ error })    
  }
}

const standardReport = data =>
  new Promise((resolve, reject) => {
    
    let workbook = new Excel.Workbook()
    workbook.creator = 'Cabisa'
    workbook.created = new Date()

    let auxCol = null

    if (data && data.sheets && data.sheets.length > 0) {
      
      data.sheets.forEach((sheet, i) => {
        let newSheet = workbook.addWorksheet(sheet.name, {
          headerFooter: {
            firstHeader: 'Hello Exceljs',
            firstFooter: 'Hello World',
          },
        })

        newSheet.columns = sheet.headers.map(header => ({
          header: header.name,
          key: header.column,
          width: header.width || 15,
        }))

        newSheet.getRow(1).font = { bold: true, color: { argb: 'ffffff' } }

        newSheet.getRow(1).alignment = { wrapText: true }

        newSheet.getRow(1).fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: '053E81' },
        }

        newSheet.autoFilter = {
          from: {
            row: 1,
            column: 1
          },
          to: {
            row: 1,
            column: newSheet.columns.length
          }
        };

        newSheet.addRows(sheet.data.map(d => d))

        sheet.headers.forEach((h, c) => {
          if (h.formula) {
            auxCol = newSheet.getColumn(h.column)
            auxCol.eachCell((cell, i) => {
              if (i > 1) {
                cell.value = { formula: h.formula.replace(/#/g, i) }
              }
            })
          }

          if (h.numFmt) {
            newSheet.getColumn(h.column).numFmt = h.numFmt
          }
        })

        if (sheet.totals && sheet.totals.length > 0) {
          sheet.totals.forEach(t => {
            newSheet.getCell(`${t}${sheet.data.length + 2}`).value = {
              formula: `SUM(${t}2:${t}${sheet.data.length + 1})`,
            }
            newSheet.getCell(`${t}${sheet.data.length + 2}`).font = {
              bold: true,
            }
          })
        }
        if (sheet.individualCells && sheet.individualCells.length > 0) {
          sheet.individualCells.forEach(cell => {
            newSheet.getCell(`${cell.name}`).value = cell.value ? cell.value : { formula: `${cell.formula}` }
            newSheet.getCell(`${cell.name}`).font = { bold: cell.bold }
          })
        }
      })
    }

    resolve(workbook)
  })
// Agrupa las filas (vendedor x bucket) de storage.getCommissionSummary
const buildCommissionSummary = summaryRows => {
  const toNumber = value => Number(value) || 0
  const emptyTotals = () => ({ invoices_count: 0, total_amount: 0, base_amount: 0, commission_amount: 0 })
  const addTotals = (totals, row) => ({
    invoices_count: totals.invoices_count + toNumber(row.invoices_count),
    total_amount: totals.total_amount + toNumber(row.total_amount),
    base_amount: totals.base_amount + toNumber(row.base_amount),
    commission_amount: totals.commission_amount + toNumber(row.commission_amount),
  })
  const bucketKeys = { TO_PAY: 'to_pay', COMMISSION_PAID: 'commission_paid', CANCELLED_PAID: 'cancelled_paid', UNPAID: 'unpaid' }
  const bySeller = {}
  const summary = { to_pay: emptyTotals(), commission_paid: emptyTotals(), cancelled_paid: emptyTotals(), unpaid: emptyTotals() }

  summaryRows.forEach(row => {
    const key = bucketKeys[row.bucket]
    const seller = (bySeller[row.seller_id] = bySeller[row.seller_id] || {
      seller_id: row.seller_id,
      seller_name: row.seller_name,
      commission_percentage: toNumber(row.commission_percentage),
      to_pay: emptyTotals(),
      commission_paid: emptyTotals(),
      cancelled_paid: emptyTotals(),
      unpaid: emptyTotals(),
    })

    seller[key] = addTotals(seller[key], row)
    summary[key] = addTotals(summary[key], row)
  })

  return { ...summary, by_seller: Object.values(bySeller) }
}

// body: { document_ids: [..], paid: true|false, exclude_iva: '1'|'0' }
// Al marcar, congela la comision mostrada (segun exclude_iva). Solo facturas 100% pagadas por el cliente.
module.exports.markCommissionsPaid = async event => {
  try {
    const req = await handleRequest({ event })

    req.hasPermissions([types.permissions.REPORTS])

    const { document_ids, paid, exclude_iva } = req.body || {}
    const ids = [...new Set((document_ids || []).map(Number).filter(Boolean))]

    if (!ids.length) throw new ValidatorException(['Debe seleccionar al menos una factura'])

    const res = await db.transaction(async connection => {
      if (paid === false) {
        await connection.query(storage.unmarkCommissionsPaid(ids))

        return { statusCode: 200, data: { document_ids: ids }, message: 'Comisiones desmarcadas exitosamente' }
      }

      const rows = await db.query(storage.getCommissionReport({ document_ids: ids, exclude_iva }))
      const rowsById = rows.reduce((r, row) => ({ ...r, [row.id]: row }), {})
      const errors = []
      const label = id => rowsById[id]?.document_number || `#${id}`

      ids.forEach(id => {
        const row = rowsById[id]

        if (!row) errors.push(`La factura ${label(id)} no existe, no esta aprobada o no tiene vendedor`)
        else if (!row.is_paid) errors.push(`La factura ${label(id)} no esta 100% pagada por el cliente`)
        else if (row.commission_paid_at) errors.push(`La comision de la factura ${label(id)} ya esta marcada como pagada`)
      })

      if (errors.length > 0) throw new ValidatorException(errors)

      for (const id of ids) {
        await connection.query(storage.markCommissionsPaid(), [rowsById[id].commission_amount, req.currentUser.user_id, id])
      }

      return { statusCode: 200, data: { document_ids: ids }, message: 'Comisiones marcadas como pagadas exitosamente' }
    })

    return await handleResponse({ req, res })
  } catch (error) {
    console.log(error)
    return await handleResponse({ error })
  }
}

module.exports.commissions = async event => {
  try {
    const req = await handleRequest({ event })

    req.hasPermissions([types.permissions.REPORTS])

    const toNumber = value => Number(value) || 0

    const [rows, countRows, summaryRows] = await Promise.all([
      db.query(storage.getCommissionReport(req.query)),
      db.query(storage.getCommissionReportCount(req.query)),
      db.query(storage.getCommissionSummary(req.query)),
    ])

    const items = rows.map(row => ({
      ...row,
      is_paid: Boolean(row.is_paid),
      is_cancelled: row.invoice_status === 'CANCELLED',
      is_commission_paid: Boolean(row.commission_paid_at),
      commission_paid_amount: row.commission_paid_amount == null ? null : toNumber(row.commission_paid_amount),
      total_amount: toNumber(row.total_amount),
      paid_amount: toNumber(row.paid_amount),
      base_amount: toNumber(row.base_amount),
      commission_percentage: toNumber(row.commission_percentage),
      commission_amount: toNumber(row.commission_amount),
    }))

    return await handleResponse({
      req,
      res: {
        statusCode: 200,
        data: {
          items,
          summary: buildCommissionSummary(summaryRows),
          pagination: { total: toNumber(countRows[0]?.total) },
        },
      },
    })
  } catch (error) {
    console.log(error)
    return await handleResponse({ error })
  }
}
