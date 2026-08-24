const mysql = require('mysql2/promise')
const {
  commonStorage,
  types,
  calculateProductTaxes,
  mysqlConfig,
  helpers,
  validators,
  ValidatorException,
  getDocument,
  groupJoinResult,
} = require(`${process.env['FILE_ENVIRONMENT']}/globals`)
const storage = require('./storage')
const {
  handleRequest,
  handleResponse,
  handleRead,
  handleCreateDocument,
  handleApproveDocument,
  handleCreateInventoryMovements,
  handleApproveInventoryMovements,
  handleCreateStakeholder,
  handleCancelDocument,
  handleCreateOperation,
  handleUpdateStock,
  handleUpdateStakeholderCredit,
  handleUpdateCreditStatus,
  handleUpdateCreditDueDate,
  handleCancelInventoryMovements,
  handleUpdateDocument,
  handleUpdateCreditPaidDate,
  handleUpdateDocumentPaidAmount,
  invoiceAdjustments,
  buildInvoiceFelPayload,
  certifyInvoiceFel,
  validateInvoiceBusinessRules,
  finalizeExistingSellInvoice,
  applyFelCertificationToDocument,
} = helpers
const { parentChildProductsValidator } = validators
const db = mysqlConfig(mysql)

const draftInvoiceInputType = {
  stakeholder_id: { type: ['string', 'number'], required: true },
  payment_method: { type: { enum: types.paymentMethods }, required: true },
  project_id: { type: ['string', 'number'], required: true },
  credit_days: { type: { enum: types.creditsPolicy.creditDaysEnum } },
  subtotal_amount: { type: 'number', min: 1, required: true },
  total_discount_amount: { type: 'number', required: true },
  total_tax_amount: { type: 'number', required: true },
  total_amount: { type: 'number', min: 0, required: true },
  related_external_document_id: { type: ['string', 'number'] },
  description: { type: 'string' },
  products: {
    type: 'array',
    required: true,
    fields: {
      type: 'object',
      fields: {
        product_id: { type: ['string', 'number'], required: true },
        service_type: { type: { enum: types.documentsServiceType }, required: true },
        product_quantity: { type: 'number', min: 0, required: true },
        product_price: { type: 'number', min: 0 },
        product_discount_percentage: { type: 'number', min: 0 },
        product_discount: { type: 'number', min: 0 },
        parent_product_id: { type: ['string', 'number'] },
      },
    },
  },
  created_at: { type: ['string', 'number'], required: false },
}

const loadInvoiceForCertify = async documentId => {
  const rawDocument = await db.query(
    storage.findDocumentForCertify([types.documentsTypes.SELL_INVOICE, types.documentsTypes.RENT_INVOICE]),
    [documentId]
  )
  const [document] = groupJoinResult({
    data: rawDocument,
    nestedFieldsKeys: ['products'],
    uniqueKey: ['document_id'],
  })

  if (!document) return null

  const [stakeholder] = document.stakeholder_id
    ? await db.query(commonStorage.findStakeholder({ id: document.stakeholder_id }))
    : []

  return { document, stakeholder }
}

const buildCertifyRequestBody = (document, products) => ({
  document_id: document.document_id,
  stakeholder_id: document.stakeholder_id,
  project_id: document.project_id,
  payment_method: document.payment_method,
  credit_days: document.credit_days,
  subtotal_amount: document.subtotal_amount,
  total_discount_amount: document.total_discount_amount,
  total_tax_amount: document.total_tax_amount,
  total_amount: document.total_amount,
  description: document.description,
  related_internal_document_id: document.related_internal_document_id,
  related_external_document_id: document.related_external_document_id,
  products,
})

module.exports.readServiceVersion = async () => {
  try {
    const servicePackage = require('./package.json')

    const res = { statusCode: 200, data: { version: servicePackage.version }, message: 'Successful response' }

    return await handleResponse({ req: {}, res })
  } catch (error) {
    console.log(error)
    return await handleResponse({ error })
  }
}

module.exports.read = async event => {
  try {
    const req = await handleRequest({ event })

    const res = await handleRead(req, { dbQuery: db.query, storage: storage.findAllBy, nestedFieldsKeys: ['products'] })
    const countResult = await db.query(storage.findAllByCount(req.query))

    const items = res.data.map(invoice => ({
      ...invoice,
      discount_percentage: invoice.products[0]?.discount_percentage,
    }))
    const enrichedItems = await invoiceAdjustments.enrichDocumentsWithAdjustments(
      items,
      db.query,
      { totalField: 'total' }
    )

    return await handleResponse({
      req,
      res: {
        statusCode: 200,
        data: {
          items: enrichedItems,
          pagination: { total: countResult[0]?.total || 0 },
        },
      },
    })
  } catch (error) {
    console.log(error)
    return await handleResponse({ error })
  }
}

module.exports.readPaymentMethods = async event => {
  try {
    const req = await handleRequest({ event })

    const res = await handleRead(req, { dbQuery: db.query, storage: storage.findPaymentMethods })

    const data = res.data.map(d => d.name)

    return await handleResponse({ req, res: { ...res, data } })
  } catch (error) {
    console.log(error)
    return await handleResponse({ error })
  }
}

module.exports.readInvoicesStatus = async event => {
  try {
    const req = await handleRequest({ event })

    const res = await handleRead(req, { dbQuery: db.query, storage: storage.findInvoiceStatus })

    return await handleResponse({ req, res })
  } catch (error) {
    console.log(error)
    return await handleResponse({ error })
  }
}

module.exports.readInvoiceServiceType = async event => {
  try {
    const req = await handleRequest({ event })

    const res = await handleRead(req, { dbQuery: db.query, storage: storage.findInvoiceServiceType })

    return await handleResponse({ req, res })
  } catch (error) {
    console.log(error)
    return await handleResponse({ error })
  }
}

module.exports.readCreditDays = async event => {
  try {
    const req = await handleRequest({ event })

    const data = Object.keys(types.creditsPolicy.creditDaysEnum).map(k => types.creditsPolicy.creditDaysEnum[k])

    const res = { statusCode: 200, data }

    return await handleResponse({ req, res })
  } catch (error) {
    console.log(error)
    return await handleResponse({ error })
  }
}

module.exports.readCreditStatus = async event => {
  try {
    const req = await handleRequest({ event })

    const res = await handleRead(req, { dbQuery: db.query, storage: storage.findCreditStatus })

    return await handleResponse({ req, res })
  } catch (error) {
    console.log(error)
    return await handleResponse({ error })
  }
}

module.exports.create = async event => {
  const inputType = {
    stakeholder_id: { type: ['string', 'number'], required: true },
    payment_method: { type: { enum: types.paymentMethods }, required: true },
    project_id: { type: ['string', 'number'], required: true },
    credit_days: { type: { enum: types.creditsPolicy.creditDaysEnum } },
    subtotal_amount: { type: 'number', min: 1, required: true },
    total_discount_amount: { type: 'number', required: true },
    total_tax_amount: { type: 'number', required: true },
    total_amount: { type: 'number', min: 0, required: true },
    // stakeholder_type: { type: { enum: [types.stakeholdersTypes.CLIENT_INDIVIDUAL, types.stakeholdersTypes.CLIENT_COMPANY] } },
    // stakeholder_name: { type: 'string', length: 100 },
    // stakeholder_address: { type: 'string', length: 100 },
    // stakeholder_nit: { type: 'string', length: 11 },
    // stakeholder_phone: { type: 'string', length: 20 },
    related_external_document_id: { type: ['string', 'number'] },
    description: { type: 'string' },
    products: {
      type: 'array',
      required: true,
      fields: {
        type: 'object',
        fields: {
          product_id: { type: ['string', 'number'], required: true },
          service_type: { type: { enum: types.documentsServiceType }, required: true },
          product_quantity: { type: 'number', min: 0, required: true },
          product_price: { type: 'number', min: 0 },
          product_discount_percentage: { type: 'number', min: 0 },
          product_discount: { type: 'number', min: 0 },
          parent_product_id: { type: ['string', 'number'] },
        },
      },
    },
    serie: { type: ['string', 'number'], required: true },
    document_number: { type: ['string', 'number'], required: true },
    uuid: { type: ['string', 'number'], required: true },
    fact_date: { type: ['string', 'number'], required: false },
    created_at: { type: ['string', 'number'], required: false },
  }

  try {
    const req = await handleRequest({ event, inputType })
    req.hasPermissions([types.permissions.INVOICES])

    const {
      stakeholder_id,
      project_id,
      stakeholder_type,
      stakeholder_nit,
      payment_method,
      credit_days,
      total_discount_amount,
      total_tax_amount,
      subtotal_amount = 0,
      total_amount,
      products,
      serie,
      document_number,
      uuid,
      created_at
    } = req.body
    const operation_type = types.operationsTypes.SELL
    const errors = []
    const productsMap = products.reduce((r, p) => {
      if (p.parent_product_id) return r

      return { ...r, [p.product_id]: [...(r[p.product_id] || []), p.product_id] }
    }, {})
    // const duplicateProducts = Object.keys(productsMap).flatMap(k => (productsMap[k].length > 1 ? k : []))
    const productsIds = products.map(p => p.product_id)
    const productsFromDB = await db.query(commonStorage.findProducts(productsIds))
    const productsExists = products.flatMap(p => (!productsFromDB.some(ps => Number(ps.product_id) === Number(p.product_id)) ? p.product_id : []))
    const requiredFields = ['stakeholder_id', 'products', 'payment_method', 'project_id', 'subtotal_amount', 'total_amount']
    if (Number(total_discount_amount) !== 0) requiredFields.push('total_discount_amount')
    if (Number(total_tax_amount) !== 0) requiredFields.push('total_tax_amount')
    // if (!stakeholder_id) requiredFields.push('stakeholder_type', 'stakeholder_name', 'stakeholder_address', 'stakeholder_nit', 'stakeholder_phone')
    const requiredParentProductFields = ['product_id', 'service_type', 'product_quantity']
    const requiredChildProductFields = ['product_id', 'service_type', 'product_quantity', 'product_price']
    const requiredErrorFields = requiredFields.filter(k => !req.body[k])
    const requiredProductErrorFields = products.some(p => {
      const isParentProduct = !p.parent_product_id && p.parent_product_id !== null
      if (isParentProduct) return requiredParentProductFields.some(k => !p[k] || p[k] <= 0)
      else return requiredChildProductFields.some(k => !p[k] || p[k] <= 0)
    })
    const [stakeholderNitUnique] = stakeholder_nit ? await db.query(commonStorage.findStakeholder({ nit: stakeholder_nit, stakeholder_type })) : []
    const [stakeholderIdExists] = stakeholder_id ? await db.query(commonStorage.findStakeholder({ id: stakeholder_id })) : []
    const [projectExists] = project_id ? await db.query(storage.checkProjectExists(), [project_id]) : []
    // const totalCredit = (Number(stakeholderIdExists.total_credit) || 0) + (credit_days ? total_amount : 0)
    // const currentCredit = (Number(stakeholderIdExists.current_credit) || 0) + (credit_days ? total_amount : 0)
    const totalCredit = (Number(stakeholderIdExists.total_credit) || 0) + total_amount
    const currentCredit = (Number(stakeholderIdExists.current_credit) || 0) + total_amount
    const isInvalidCreditAmount = stakeholderIdExists && stakeholderIdExists.credit_limit && currentCredit > stakeholderIdExists.credit_limit

    if (Object.keys(types.operationsTypes).every(k => types.operationsTypes[k] !== operation_type))
      errors.push(
        `The field operation_type must contain one of these values: ${Object.keys(types.operationsTypes)
          .map(k => types.operationsTypes[k])
          .join(', ')}`
      )
    if (Object.keys(types.paymentMethods).every(k => types.paymentMethods[k] !== payment_method))
      errors.push(
        `The field payment_method must contain one of these values: ${Object.keys(types.paymentMethods)
          .map(k => types.paymentMethods[k])
          .join(', ')}`
      )
    if (credit_days && Object.keys(types.creditsPolicy.creditDaysEnum).every(k => types.creditsPolicy.creditDaysEnum[k] !== credit_days))
      errors.push(
        `The field credit_days must contain one of these values: ${Object.keys(types.creditsPolicy.creditDaysEnum)
          .map(k => types.creditsPolicy.creditDaysEnum[k])
          .join(', ')}`
      )
    if (requiredErrorFields.length > 0) requiredErrorFields.forEach(ef => errors.push(`El campo ${ef} es requerido`))
    if (requiredProductErrorFields)
      errors.push(`Los campos ${requiredParentProductFields.join(', ')} en productos deben contener un numero mayor a cero`)
    if (stakeholderNitUnique) errors.push('El nit ya se encuentra registrado')
    if (stakeholder_id && !stakeholderIdExists) errors.push('El cliente ya se encuentra registrado')
    // if (duplicateProducts.length > 0) duplicateProducts.forEach(id => errors.push(`Los productos con id ${id} no deben estar duplicados`))
    if (productsExists.length > 0) productsExists.forEach(id => errors.push(`El producto con id ${id} no esta registrado`))
    if (project_id && !projectExists) errors.push(`El proyecto no se encuentra registrado`)
    if (subtotal_amount <= 0) errors.push(`El monto subtotal de la factura debe ser mayor a cero`)
    if (total_amount <= 0) errors.push(`El monto total de la factura debe ser mayor a cero`)
    // if (credit_days && (!stakeholderIdExists || !stakeholderIdExists.credit_limit))
    if (!stakeholderIdExists || !stakeholderIdExists.credit_limit)
      errors.push(`Debe asignar un limite de credito al cliente antes de otorgarle un credito`)
    // if (credit_days && isInvalidCreditAmount) errors.push(`Se ha superado el limite de credito del cliente`)
    if (isInvalidCreditAmount) errors.push(`Se ha superado el limite de credito del cliente`)
    products.forEach(p => {
      if (Object.keys(types.documentsServiceType).every(k => types.documentsServiceType[k] !== p.service_type))
        errors.push(
          `The field service_type must contain one of these values: ${Object.keys(types.documentsServiceType)
            .map(k => types.documentsServiceType[k])
            .join(', ')}`
        )

      if (p.service_type === types.documentsServiceType.SERVICE) {
        const parentChildProductsErrors = parentChildProductsValidator(p, products, productsFromDB)
        parentChildProductsErrors[0] && parentChildProductsErrors.forEach(pce => errors.push(pce))
      }
    })

    if (errors.length > 0) throw new ValidatorException(errors)

    const productsWithTaxes = calculateProductTaxes(products, productsFromDB)

    const { res } = await db.transaction(async connection => {
      const stakeholderCreated = await handleCreateStakeholder({ ...req, body: { ...req.body, products: productsWithTaxes } }, { connection })

      const stakeholderCreditUpdated = await handleUpdateStakeholderCredit(
        {
          ...stakeholderCreated.req,
          body: {
            ...stakeholderCreated.req.body,
            total_credit: totalCredit,
            paid_credit: Number(stakeholderIdExists.paid_credit),
          },
        },
        stakeholderCreated.res
      )

      const initDocumentCreated = await handleCreateDocument(
        { ...stakeholderCreditUpdated.req, body: { ...stakeholderCreditUpdated.req.body, document_type: types.documentsTypes.SELL_PRE_INVOICE } },
        stakeholderCreditUpdated.res
      )

      const finishDocumentCreated = await handleCreateDocument(
        { ...initDocumentCreated.req, body: { ...initDocumentCreated.req.body, document_type: types.documentsTypes.SELL_INVOICE } },
        { ...initDocumentCreated.res, calculateSalesCommission: true }
      )

      if (credit_days) {
        const creditDueDateUpdated = await handleUpdateCreditDueDate(
          { ...finishDocumentCreated.req, body: { ...finishDocumentCreated.req.body, credit_days } },
          finishDocumentCreated.res
        )

        await handleUpdateCreditStatus(
          {
            ...creditDueDateUpdated.req,
            body: {
              ...creditDueDateUpdated.req.body,
              credit_status: types.creditsPolicy.creditStatusEnum.UNPAID,
            },
          },
          creditDueDateUpdated.res
        )
      }

      const operationCreated = await handleCreateOperation(
        { ...finishDocumentCreated.req, body: { ...finishDocumentCreated.req.body, operation_type } },
        finishDocumentCreated.res
      )

      const documentApproved = await handleApproveDocument(operationCreated.req, operationCreated.res)

      const inventoryMovementsCreated = await handleCreateInventoryMovements(documentApproved.req, {
        ...documentApproved.res,
        onCreateMovementType: types.inventoryMovementsTypes.OUT,
      })

      const inventoryMovementsApproved = await handleApproveInventoryMovements(inventoryMovementsCreated.req, inventoryMovementsCreated.res)

      return await handleUpdateStock(inventoryMovementsApproved.req, { ...inventoryMovementsApproved.res, updateStockOn: types.actions.APPROVED })
    })

    return await handleResponse({ req, res })
  } catch (error) {
    console.log(error)
    return await handleResponse({ error })
  }
}

module.exports.update = async event => {
  const inputType = {
    document_id: { type: ['string', 'number'], required: true },
    // stakeholder_id: { type: ['string', 'number'], required: true },
    payment_method: { type: { enum: types.paymentMethods }, required: true },
    // project_id: { type: ['string', 'number'], required: true },
    credit_days: { type: { enum: types.creditsPolicy.creditDaysEnum } },
    subtotal_amount: { type: 'number', min: 1, required: true },
    total_discount_amount: { type: 'number', required: true },
    total_tax_amount: { type: 'number', required: true },
    total_amount: { type: 'number', min: 0, required: true },
    // stakeholder_type: { type: { enum: [types.stakeholdersTypes.CLIENT_INDIVIDUAL, types.stakeholdersTypes.CLIENT_COMPANY] } },
    // stakeholder_name: { type: 'string', length: 100 },
    // stakeholder_address: { type: 'string', length: 100 },
    // stakeholder_nit: { type: 'string', length: 11 },
    // stakeholder_phone: { type: 'string', length: 20 },
    related_external_document_id: { type: ['string', 'number'] },
    description: { type: 'string' },
    products: {
      type: 'array',
      required: true,
      fields: {
        type: 'object',
        fields: {
          product_id: { type: ['string', 'number'], required: true },
          service_type: { type: { enum: types.documentsServiceType }, required: true },
          product_quantity: { type: 'number', min: 0, required: true },
          product_price: { type: 'number', min: 0 },
          product_discount_percentage: { type: 'number', min: 0 },
          product_discount: { type: 'number', min: 0 },
          parent_product_id: { type: ['string', 'number'] },
        },
      },
    },
    created_at: { type: ['string', 'number'], required: false },
  }

  try {
    const req = await handleRequest({ event, inputType })
    req.hasPermissions([types.permissions.INVOICES])

    const {
      document_id,
      payment_method,
      credit_days,
      total_discount_amount,
      total_tax_amount,
      subtotal_amount = 0,
      total_amount,
      products,
      created_at
    } = req.body
    const document = await getDocument({
      dbQuery: db.query,
      findDocumentStorage: commonStorage.findDocument,
      inventoryMovementsStatusCancelledType: types.inventoryMovementsStatus.CANCELLED,
      document_id,
      documentsTypes: [types.documentsTypes.SELL_INVOICE, types.documentsTypes.RENT_INVOICE],
      includeDocumentProductMovement: true,
    })

    const errors = []
    const productsMap = products.reduce((r, p) => {
      if (p.parent_product_id) return r

      return { ...r, [p.product_id]: [...(r[p.product_id] || []), p.product_id] }
    }, {})
    const duplicateProducts = Object.keys(productsMap).flatMap(k => (productsMap[k].length > 1 ? k : []))
    const productsIds = products.map(p => p.product_id)
    const productsFromDB = await db.query(commonStorage.findProducts(productsIds))
    const productsExists = products.flatMap(p => (!productsFromDB.some(ps => Number(ps.product_id) === Number(p.product_id)) ? p.product_id : []))
    const requiredFields = ['document_id', 'products', 'payment_method', 'subtotal_amount', 'total_amount']
    if (Number(total_discount_amount) !== 0) requiredFields.push('total_discount_amount')
    if (Number(total_tax_amount) !== 0) requiredFields.push('total_tax_amount')
    const requiredParentProductFields = ['product_id', 'service_type', 'product_quantity']
    const requiredChildProductFields = ['product_id', 'service_type', 'product_quantity', 'product_price']
    const requiredErrorFields = requiredFields.filter(k => !req.body[k])
    const requiredProductErrorFields = products.some(p => {
      const isParentProduct = !p.parent_product_id && p.parent_product_id !== null
      if (isParentProduct) return requiredParentProductFields.some(k => !p[k] || p[k] <= 0)
      else return requiredChildProductFields.some(k => !p[k] || p[k] <= 0)
    })
    const [stakeholderIdExists] =
      document && document.stakeholder_id ? await db.query(commonStorage.findStakeholder({ id: document.stakeholder_id })) : []
    // const totalAmount = document.document_type === types.documentsTypes.RENT_INVOICE || credit_days ? total_amount : 0
    // const documentTotalAmount = document.document_type === types.documentsTypes.RENT_INVOICE || document.credit_days ? document.total_amount : 0
    const totalAmount = total_amount
    const documentTotalAmount = document.total_amount
    const totalCredit = (Number(stakeholderIdExists.total_credit) || 0) + (totalAmount - documentTotalAmount)
    const currentCredit = (Number(stakeholderIdExists.current_credit) || 0) + (totalAmount - documentTotalAmount)
    const isInvalidCreditAmount = stakeholderIdExists && stakeholderIdExists.credit_limit && currentCredit > stakeholderIdExists.credit_limit

    if (Object.keys(types.paymentMethods).every(k => types.paymentMethods[k] !== payment_method))
      errors.push(
        `The field payment_method must contain one of these values: ${Object.keys(types.paymentMethods)
          .map(k => types.paymentMethods[k])
          .join(', ')}`
      )
    if (credit_days && Object.keys(types.creditsPolicy.creditDaysEnum).every(k => types.creditsPolicy.creditDaysEnum[k] !== credit_days))
      errors.push(
        `The field credit_days must contain one of these values: ${Object.keys(types.creditsPolicy.creditDaysEnum)
          .map(k => types.creditsPolicy.creditDaysEnum[k])
          .join(', ')}`
      )
    if (requiredErrorFields.length > 0) requiredErrorFields.forEach(ef => errors.push(`El campo ${ef} es requerido`))
    if (requiredProductErrorFields)
      errors.push(`Los campos ${requiredParentProductFields.join(', ')} en productos deben contener un numero mayor a cero`)
    if (!stakeholderIdExists) errors.push('El cliente ya se encuentra registrado')
    if (duplicateProducts.length > 0) duplicateProducts.forEach(id => errors.push(`Los productos con id ${id} no deben estar duplicados`))
    if (productsExists.length > 0) productsExists.forEach(id => errors.push(`El producto con id ${id} no esta registrado`))
    if (subtotal_amount <= 0) errors.push(`El monto subtotal de la factura debe ser mayor a cero`)
    if (total_amount <= 0) errors.push(`El monto total de la factura debe ser mayor a cero`)
    // if (credit_days && (!stakeholderIdExists || !stakeholderIdExists.credit_limit))
    if (!stakeholderIdExists || !stakeholderIdExists.credit_limit)
      errors.push(`Debe asignar un limite de credito al cliente antes de otorgarle un credito`)
    // if (credit_days && isInvalidCreditAmount) errors.push(`Se ha superado el limite de credito del cliente`)
    if (isInvalidCreditAmount) errors.push(`Se ha superado el limite de credito del cliente`)
    products.forEach(p => {
      if (Object.keys(types.documentsServiceType).every(k => types.documentsServiceType[k] !== p.service_type))
        errors.push(
          `The field service_type must contain one of these values: ${Object.keys(types.documentsServiceType)
            .map(k => types.documentsServiceType[k])
            .join(', ')}`
        )

      if (p.service_type === types.documentsServiceType.SERVICE) {
        const parentChildProductsErrors = parentChildProductsValidator(p, products, productsFromDB)
        parentChildProductsErrors[0] && parentChildProductsErrors.forEach(pce => errors.push(pce))
      }
    })
    if (document.status === types.documentsStatus.CANCELLED) errors.push('No puede editar un documento que se encuentre cancelado')

    if (errors.length > 0) throw new ValidatorException(errors)

    const productsWithTaxes = calculateProductTaxes(products, productsFromDB)
    const salesCommissionPercentage = req.currentUser.sales_commission / 100
    const sales_commission_amount = !isNaN(salesCommissionPercentage) ? subtotal_amount * salesCommissionPercentage : null

    const { res } = await db.transaction(async connection => {
      const documentUpdated = await handleUpdateDocument(
        { ...req, body: { ...document, ...req.body, sales_commission_amount, products: productsWithTaxes } },
        { connection }
      )

      // if (document.document_type === types.documentsTypes.RENT_INVOICE || document.credit_days) {
      // const stakeholderCreditUpdated = await handleUpdateStakeholderCredit(
      //   {
      //     ...documentUpdated.req,
      //     body: {
      //       ...documentUpdated.req.body,
      //       total_credit: totalCredit,
      //       paid_credit: document.credit_days
      //         ? Number(stakeholderIdExists.paid_credit)
      //         : Number(stakeholderIdExists.paid_credit) + totalAmount - documentTotalAmount,
      //     },
      //   },
      //   documentUpdated.res
      // )

      // const creditPaidDateUpdated = await handleUpdateCreditPaidDate(
      //   {
      //     ...stakeholderCreditUpdated.req,
      //     body: {
      //       ...stakeholderCreditUpdated.req.body,
      //       creditPaidDate: document.credit_days ? document.credit_paid_date : new Date().toISOString(),
      //     },
      //   },
      //   stakeholderCreditUpdated.res
      // )

      // await handleUpdateDocumentPaidAmount(
      //   {
      //     ...creditPaidDateUpdated.req,
      //     body: {
      //       ...creditPaidDateUpdated.req.body,
      //       document_id,
      //       paid_credit_amount: document.credit_days ? document.paid_credit_amount : totalAmount,
      //     },
      //   },
      //   creditPaidDateUpdated.res
      // )
      // }

      await handleUpdateStakeholderCredit(
        {
          ...documentUpdated.req,
          body: {
            ...documentUpdated.req.body,
            total_credit: totalCredit,
            paid_credit: Number(stakeholderIdExists.paid_credit), // ahora todos los pagos los ingresan manualmente
          },
        },
        documentUpdated.res
      )

      const inventoryMovementsCancelled = await handleCancelInventoryMovements(documentUpdated.req, documentUpdated.res)

      const inventoryMovementsCreated = await handleCreateInventoryMovements(inventoryMovementsCancelled.req, {
        ...inventoryMovementsCancelled.res,
        onCreateMovementType: types.inventoryMovementsTypes.OUT,
      })

      const inventoryMovementsApproved = await handleApproveInventoryMovements(inventoryMovementsCreated.req, inventoryMovementsCreated.res)

      return await handleUpdateStock(inventoryMovementsApproved.req, { ...inventoryMovementsApproved.res, updateStockOn: types.actions.APPROVED })
    })

    return await handleResponse({ req, res })
  } catch (error) {
    console.log(error)
    return await handleResponse({ error })
  }
}

module.exports.draft = async event => {
  try {
    const req = await handleRequest({ event, inputType: draftInvoiceInputType })
    req.hasPermissions([types.permissions.INVOICES])

    const { products, total_amount } = req.body
    const { productsFromDB } = await validateInvoiceBusinessRules({
      body: req.body,
      dbQuery: db.query,
      commonStorage,
      storage,
    })

    const productsWithTaxes = calculateProductTaxes(products, productsFromDB)

    const res = await db.transaction(async connection => {
      const stakeholderCreated = await handleCreateStakeholder(
        { ...req, body: { ...req.body, products: productsWithTaxes } },
        { connection }
      )

      const initDocumentCreated = await handleCreateDocument(
        {
          ...stakeholderCreated.req,
          body: {
            ...stakeholderCreated.req.body,
            document_type: types.documentsTypes.SELL_PRE_INVOICE,
          },
        },
        stakeholderCreated.res
      )

      const finishDocumentCreated = await handleCreateDocument(
        {
          ...initDocumentCreated.req,
          body: {
            ...initDocumentCreated.req.body,
            document_type: types.documentsTypes.SELL_INVOICE,
          },
        },
        { ...initDocumentCreated.res, calculateSalesCommission: true }
      )

      return {
        statusCode: 201,
        data: {
          document_id: finishDocumentCreated.res.data.document_id,
          status: types.documentsStatus.PENDING,
          total_amount,
        },
        message: 'Borrador de factura creado exitosamente',
      }
    })

    return await handleResponse({ req, res })
  } catch (error) {
    console.log(error)
    return await handleResponse({ error })
  }
}

module.exports.certify = async event => {
  try {
    const req = await handleRequest({ event })
    req.hasPermissions([types.permissions.INVOICES])

    const documentId = req.pathParameters?.document_id || req.body?.document_id
    const errors = []

    if (!documentId) errors.push('El campo document_id es requerido')

    if (errors.length > 0) throw new ValidatorException(errors)

    const loaded = await loadInvoiceForCertify(documentId)

    if (!loaded?.document) throw new ValidatorException(['La factura no se encuentra registrada'])

    const { document, stakeholder } = loaded

    if (document.status === types.documentsStatus.CANCELLED) {
      throw new ValidatorException(['No se puede certificar una factura cancelada'])
    }

    if (document.status === types.documentsStatus.APPROVED) {
      return await handleResponse({
        req,
        res: {
          statusCode: 200,
          data: {
            document_id: document.document_id,
            status: document.status,
            uuid: document.uuid,
            serie: document.serie,
            document_number: document.document_number,
            fact_date: document.fact_date,
            already_certified: true,
          },
          message: 'La factura ya se encuentra certificada',
        },
      })
    }

    if (
      document.status !== types.documentsStatus.PENDING &&
      document.status !== types.documentsStatus.SAT_FAILED
    ) {
      throw new ValidatorException([`La factura no puede certificarse en estado ${document.status}`])
    }

    const certifyBody = buildCertifyRequestBody(document, document.products)
    const { stakeholderIdExists, totalCredit, productsFromDB } = await validateInvoiceBusinessRules({
      body: certifyBody,
      dbQuery: db.query,
      commonStorage,
      storage,
    })

    // Inventory movements need product_type, stock and inventory costs, which the
    // document query does not return.
    certifyBody.products = calculateProductTaxes(document.products, productsFromDB)

    const hasFelData = Boolean(document.uuid && document.document_number && document.serie)
    let felResult = null
    let certifyBodyWithFel = { ...certifyBody }

    if (!hasFelData) {
      const billData = buildInvoiceFelPayload({
        document,
        stakeholder,
        products: document.products,
      })

      try {
        felResult = await db.transaction(async connection =>
          certifyInvoiceFel({
            connection,
            cabisaDocumentId: document.document_id,
            billData,
            createdBy: document.created_by || req.currentUser.userName || 'system',
          })
        )
      } catch (felError) {
        await db.transaction(async connection => {
          await connection.query(commonStorage.updateDocumentStatus(), [
            types.documentsStatus.SAT_FAILED,
            req.currentUser.user_id,
            document.document_id,
          ])
        })

        return await handleResponse({
          req,
          res: {
            statusCode: 400,
            data: {
              document_id: document.document_id,
              status: types.documentsStatus.SAT_FAILED,
            },
            message: felError.message || 'Error al certificar con SAT',
          },
        })
      }

      if (!felResult.success) {
        await db.transaction(async connection => {
          await connection.query(commonStorage.updateDocumentStatus(), [
            types.documentsStatus.SAT_FAILED,
            req.currentUser.user_id,
            document.document_id,
          ])
        })

        return await handleResponse({
          req,
          res: {
            statusCode: 400,
            data: {
              document_id: document.document_id,
              status: types.documentsStatus.SAT_FAILED,
              fel: felResult.data,
            },
            message: felResult.message,
          },
        })
      }

      await db.transaction(async connection => {
        await applyFelCertificationToDocument({
          connection,
          documentId: document.document_id,
          felData: felResult.data,
          updatedBy: req.currentUser.user_id,
          status: types.documentsStatus.PENDING,
        })
      })

      certifyBodyWithFel = {
        ...certifyBody,
        serie: felResult.data.serie,
        document_number: felResult.data.numero,
        uuid: felResult.data.uuid,
        fact_date: felResult.data.fecha,
      }
    }

    try {
      const res = await db.transaction(async connection => {
        const finalized = await finalizeExistingSellInvoice({
          req: { ...req, body: certifyBodyWithFel },
          body: certifyBodyWithFel,
          connection,
          stakeholderIdExists,
          totalCredit,
        })

        return {
          statusCode: 200,
          data: {
            document_id: document.document_id,
            status: types.documentsStatus.APPROVED,
            uuid: certifyBodyWithFel.uuid || document.uuid,
            serie: certifyBodyWithFel.serie || document.serie,
            document_number: certifyBodyWithFel.document_number || document.document_number,
            fact_date: certifyBodyWithFel.fact_date || document.fact_date,
            fel: felResult?.data || null,
            operation_id: finalized.res.data,
          },
          message: 'Factura certificada exitosamente',
        }
      })

      return await handleResponse({ req, res })
    } catch (finalizeError) {
      await db.transaction(async connection => {
        await connection.query(commonStorage.updateDocumentStatus(), [
          types.documentsStatus.SAT_FAILED,
          req.currentUser.user_id,
          document.document_id,
        ])
      })

      return await handleResponse({
        req,
        res: {
          statusCode: 400,
          data: {
            document_id: document.document_id,
            status: types.documentsStatus.SAT_FAILED,
            uuid: certifyBodyWithFel.uuid || document.uuid,
            serie: certifyBodyWithFel.serie || document.serie,
            document_number: certifyBodyWithFel.document_number || document.document_number,
            fel_certified: Boolean(certifyBodyWithFel.uuid || document.uuid),
          },
          message:
            finalizeError.message ||
            'La factura fue certificada en SAT pero no se pudo completar el registro en Cabisa. Reintente la certificacion.',
        },
      })
    }
  } catch (error) {
    console.log(error)
    return await handleResponse({ error })
  }
}

module.exports.cancel = async event => {
  try {
    const inputType = {
      document_id: { type: ['number', 'string'], required: true },
      cancel_reason: { type: 'string' },
    }
    const req = await handleRequest({ event, inputType })
    req.hasPermissions([types.permissions.INVOICES])

    const { document_id } = req.body
    const errors = []
    const requiredFields = ['document_id']
    const requiredErrorFields = requiredFields.filter(k => !req.body[k])
    const documentProduct = document_id ? await db.query(commonStorage.findDocumentProduct(), [document_id]) : []
    const document = await getDocument({
      dbQuery: db.query,
      findDocumentStorage: commonStorage.findDocument,
      document_id,
      documentsTypes: [types.documentsTypes.SELL_INVOICE, types.documentsTypes.RENT_INVOICE],
      inventoryMovementsStatusCancelledType: types.inventoryMovementsStatus.CANCELLED,
      documentProduct,
      includeDocumentProductMovement: true,
      includeInventoryMovements: true,
    })

    if (requiredErrorFields.length > 0) requiredErrorFields.forEach(ef => errors.push(`El campo ${ef} es requerido`))
    if (!document || !document.document_id) errors.push('No existen facturas registradas con la informacion recibida')
    if (document && document.document_status === types.documentsStatus.CANCELLED) errors.push('El documento ya se encuentra cancelado')

    if (errors.length > 0) throw new ValidatorException(errors)

    const { res } = await db.transaction(async connection => {
      const documentCancelled = await handleCancelDocument({ ...req, body: { ...document, ...req.body } }, { connection })

      const inventoryMovementsCancelled = await handleCancelInventoryMovements(documentCancelled.req, documentCancelled.res)

      // if (
      //   document.document_type === types.documentsTypes.RENT_INVOICE ||
      //   (document.document_type === types.documentsTypes.SELL_INVOICE && document.credit_days)
      // ) {
      await handleUpdateStakeholderCredit(
        {
          ...inventoryMovementsCancelled.req,
          body: {
            ...inventoryMovementsCancelled.req.body,
            total_credit: Number(document.stakeholder_total_credit) - Number(document.total_amount),
            paid_credit: Number(document.stakeholder_paid_credit) - Number(document.paid_credit_amount),
          },
        },
        inventoryMovementsCancelled.res
      )
      // }

      return await handleUpdateStock(
        { ...inventoryMovementsCancelled.req, body: { ...inventoryMovementsCancelled.req.body, old_inventory_movements: [] } },
        { ...inventoryMovementsCancelled.res, updateStockOn: types.actions.CANCELLED }
      )
    })

    return await handleResponse({ req, res })
  } catch (error) {
    console.log(error)
    return await handleResponse({ error })
  }
}
