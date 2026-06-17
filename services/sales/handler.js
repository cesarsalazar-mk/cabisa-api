const mysql = require('mysql2/promise')
const {
  commonStorage,
  types,
  calculateProductTaxes,
  groupJoinResult,
  mysqlConfig,
  helpers,
  validators,
  ValidatorException,
  getFormattedDates,
  getDocument,
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
  handleUpdateDocument,
  handleCancelInventoryMovements,
  handleUpdateStakeholderCredit,
  handleUpdateCreditStatus,
  handleUpdateCreditPaidDate,
  handleUpdateCreditDueDate,
  handleUpdateDocumentPaidAmount,
} = helpers
const { parentChildProductsValidator } = validators
const db = mysqlConfig(mysql)

const config = {
  [types.operationsTypes.SELL]: {
    // El SELL_PRE_INVOICE solo se crea en el endpoint create invoice pero no no se usa todavia
    // init: { documentType: types.documentsTypes.SELL_PRE_INVOICE },
    finish: { documentType: types.documentsTypes.SELL_INVOICE, movementType: types.inventoryMovementsTypes.OUT },
  },
  [types.operationsTypes.RENT]: {
    init: { documentType: types.documentsTypes.RENT_PRE_INVOICE, movementType: types.inventoryMovementsTypes.OUT },
    finish: { documentType: types.documentsTypes.RENT_INVOICE, movementType: types.inventoryMovementsTypes.IN },
  },
}

module.exports.read = async event => {
  try {
    const req = await handleRequest({ event })

    const res = await handleRead(req, { dbQuery: db.query, storage: storage.findAllBy, nestedFieldsKeys: ['products'] })
    const countResult = await db.query(storage.findAllByCount(req.query))

    return await handleResponse({
      req,
      res: {
        statusCode: 200,
        data: {
          items: res.data,
          pagination: { total: countResult[0]?.total || 0 },
        },
      },
    })
  } catch (error) {
    console.log(error)
    return await handleResponse({ error })
  }
}

module.exports.readSalesStatus = async event => {
  try {
    const req = await handleRequest({ event })

    const res = await handleRead(req, { dbQuery: db.query, storage: storage.findSalesStatus })

    return await handleResponse({ req, res })
  } catch (error) {
    console.log(error)
    return await handleResponse({ error })
  }
}

module.exports.create = async event => {
  const inputType = {
    stakeholder_id: { type: ['string', 'number'], required: true },
    // stakeholder_type: { type: { enum: types.stakeholdersTypes } },
    // stakeholder_name: { type: 'string', length: 100 },
    // stakeholder_address: { type: 'string', length: 100 },
    // stakeholder_nit: { type: 'string', length: 11 },
    // stakeholder_phone: { type: 'string', length: 20 },
    related_external_document_id: { type: ['string', 'number'] },
    comments: { type: 'string' },
    received_by: { type: 'string' },
    dispatched_by: { type: 'string' },
    // operation_type: {
    //   type: { enum: types.operationsTypes },
    //   required: true,
    // },
    project_id: { type: ['string', 'number'], required: true },
    start_date: { type: 'string' },
    end_date: { type: 'string' },
    subtotal_amount: { type: 'number', min: 1, required: true },
    total_discount_amount: { type: 'number', required: true },
    total_tax_amount: { type: 'number', required: true },
    total_amount: { type: 'number', min: 0, required: true },
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
          parent_product_id: { type: ['string', 'number'] },
        },
      },
    },
  }

  try {
    const req = await handleRequest({ event, inputType })
    const operation_type = types.operationsTypes.RENT
    const { stakeholder_id, total_discount_amount, total_tax_amount, subtotal_amount = 0, total_amount, products } = req.body

    req.hasPermissions([types.permissions.SALES])

    const errors = []
    const productsMap = products.reduce((r, p) => {
      if (p.parent_product_id) return r

      return { ...r, [p.product_id]: [...(r[p.product_id] || []), p.product_id] }
    }, {})
    // const duplicateProducts = Object.keys(productsMap).flatMap(k => (productsMap[k].length > 1 ? k : []))
    const productsIds = products.map(p => p.product_id)
    const productsFromDB = await db.query(commonStorage.findProducts(productsIds))
    const productsExists = products.flatMap(p => (!productsFromDB.some(ps => Number(ps.product_id) === Number(p.product_id)) ? p.product_id : []))
    const requiredFields = ['stakeholder_id', 'project_id', 'products', 'subtotal_amount', 'total_amount']
    if (Number(total_discount_amount) !== 0) requiredFields.push('total_discount_amount')
    if (Number(total_tax_amount) !== 0) requiredFields.push('total_tax_amount')
    const requiredParentProductFields = ['product_id', 'service_type', 'product_quantity']
    const requiredChildProductFields = ['product_id', 'service_type', 'product_quantity', 'product_price']
    // if (!stakeholder_id) requiredFields.push('stakeholder_type', 'stakeholder_name', 'stakeholder_address', 'stakeholder_nit', 'stakeholder_phone')
    if (operation_type === types.operationsTypes.RENT) requiredFields.push('start_date', 'end_date')
    const requiredErrorFields = requiredFields.filter(k => !req.body[k])
    const requiredProductErrorFields = products.some(p => {
      const isParentProduct = !p.parent_product_id && p.parent_product_id !== null
      if (isParentProduct) return requiredParentProductFields.some(k => !p[k] || p[k] <= 0)
      else return requiredChildProductFields.some(k => !p[k] || p[k] <= 0)
    })
    const [stakeholderIdExists] = stakeholder_id ? await db.query(commonStorage.findStakeholder({ id: stakeholder_id })) : []
    const totalCredit = (Number(stakeholderIdExists.total_credit) || 0) + total_amount
    const currentCredit = (Number(stakeholderIdExists.current_credit) || 0) + total_amount
    const isInvalidCreditAmount = stakeholderIdExists && stakeholderIdExists.credit_limit && currentCredit > stakeholderIdExists.credit_limit

    if (Object.keys(types.operationsTypes).every(k => types.operationsTypes[k] !== operation_type))
      errors.push(
        `The field operation_type must contain one of these values: ${Object.keys(types.operationsTypes)
          .map(k => types.operationsTypes[k])
          .join(', ')}`
      )
    if (requiredErrorFields.length > 0) requiredErrorFields.forEach(ef => errors.push(`El campo ${ef} es requerido`))
    if (requiredProductErrorFields)
      errors.push(`Los campos ${requiredParentProductFields.join(', ')} en productos deben contener un numero mayor a cero`)
    if (stakeholder_id && !stakeholderIdExists) errors.push('El cliente no se encuentra registrado')
    // if (duplicateProducts.length > 0) duplicateProducts.forEach(id => errors.push(`Los productos con id ${id} no deben estar duplicados`))
    if (productsExists.length > 0) productsExists.forEach(id => errors.push(`El producto con id ${id} no se encuentra registrado`))
    if (subtotal_amount <= 0) errors.push(`El monto subtotal de la nota de servicio debe ser mayor a cero`)
    if (total_amount <= 0) errors.push(`El monto total de la nota de servicio debe ser mayor a cero`)
    if (!stakeholderIdExists || !stakeholderIdExists.credit_limit)
      errors.push(`Debe asignar un limite de credito al cliente antes de otorgarle un credito`)
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
      const stakeholderCreated = await handleCreateStakeholder(
        { ...req, body: { ...req.body, operation_type, products: productsWithTaxes } },
        { connection }
      )

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

      const documentCreated = await handleCreateDocument(
        { ...stakeholderCreditUpdated.req, body: { ...stakeholderCreditUpdated.req.body, document_type: config[operation_type].init.documentType } },
        stakeholderCreditUpdated.res
      )

      const creditStatusUpdated = await handleUpdateCreditStatus(
        { ...documentCreated.req, body: { ...documentCreated.req.body, credit_status: types.creditsPolicy.creditStatusEnum.UNPAID } },
        documentCreated.res
      )

      const operationCreated = await handleCreateOperation(
        { ...creditStatusUpdated.req, body: { ...creditStatusUpdated.req.body, operation_type } },
        creditStatusUpdated.res
      )

      const documentApproved = await handleApproveDocument(operationCreated.req, {
        ...operationCreated.res,
        keepStatus: types.documentsStatus.PENDING,
      })

      const inventoryMovementsCreated = await handleCreateInventoryMovements(documentApproved.req, {
        ...documentApproved.res,
        onCreateMovementType: config[operation_type].init.movementType,
      })

      const inventoryMovementsApproved = await handleApproveInventoryMovements(inventoryMovementsCreated.req, inventoryMovementsCreated.res)

      return await handleUpdateStock(inventoryMovementsApproved.req, { ...inventoryMovementsApproved.res, updateStockOn: types.actions.APPROVED })
    })

    return await handleResponse({ req, res })
  } catch (error) {
    console.log('XX', error)
    return await handleResponse({ error })
  }
}

module.exports.update = async event => {
  const inputType = {
    document_id: { type: ['string', 'number'], required: true },
    project_id: { type: ['string', 'number'], required: true },
    related_external_document_id: { type: 'string' },
    comments: { type: 'string' },
    received_by: { type: 'string' },
    dispatched_by: { type: 'string' },
    start_date: { type: 'string' },
    end_date: { type: 'string' },
    subtotal_amount: { type: 'number', min: 1, required: true },
    total_discount_amount: { type: 'number', required: true },
    total_tax_amount: { type: 'number', required: true },
    total_amount: { type: 'number', min: 0, required: true },
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
          parent_product_id: { type: ['string', 'number'] },
        },
      },
    },
  }

  try {
    const req = await handleRequest({ event, inputType })
    req.hasPermissions([types.permissions.SALES])

    const { document_id, products, start_date, end_date, total_discount_amount, total_tax_amount, subtotal_amount = 0, total_amount } = req.body
    const document = await getDocument({
      dbQuery: db.query,
      findDocumentStorage: commonStorage.findDocument,
      inventoryMovementsStatusCancelledType: types.inventoryMovementsStatus.CANCELLED,
      document_id,
      documentsTypes: [types.documentsTypes.SELL_PRE_INVOICE, types.documentsTypes.RENT_PRE_INVOICE],
      includeDocumentProductMovement: true,
    })

    const errors = []
    const productsMap = products.reduce((r, p) => {
      if (p.parent_product_id) return r

      return { ...r, [p.product_id]: [...(r[p.product_id] || []), p.product_id] }
    }, {})
    // const duplicateProducts = Object.keys(productsMap).flatMap(k => (productsMap[k].length > 1 ? k : []))
    const productsIds = products.map(p => p.product_id)
    const productsFromDB = await db.query(commonStorage.findProducts(productsIds))
    const productsExists = products.flatMap(p =>
      !productsFromDB || !productsFromDB.some(ps => Number(ps.product_id) === Number(p.product_id)) ? p.product_id : []
    )
    const requiredFields = ['document_id', 'project_id', 'products', , 'subtotal_amount', 'total_amount']
    if (Number(total_discount_amount) !== 0) requiredFields.push('total_discount_amount')
    if (Number(total_tax_amount) !== 0) requiredFields.push('total_tax_amount')
    const requiredParentProductFields = ['product_id', 'service_type', 'product_quantity']
    const requiredChildProductFields = ['product_id', 'service_type', 'product_quantity', 'product_price']
    if (document && document.operation_type === types.operationsTypes.RENT) requiredFields.push('start_date', 'end_date')
    const requiredErrorFields = requiredFields.filter(k => !req.body[k])
    const requiredProductErrorFields = products.some(p => {
      const isParentProduct = !p.parent_product_id && p.parent_product_id !== null
      if (isParentProduct) return requiredParentProductFields.some(k => !p[k] || p[k] <= 0)
      else return requiredChildProductFields.some(k => !p[k] || p[k] <= 0)
    })
    const [stakeholderIdExists] =
      document && document.stakeholder_id ? await db.query(commonStorage.findStakeholder({ id: document.stakeholder_id })) : []
    const totalCredit = (Number(stakeholderIdExists.total_credit) || 0) + (total_amount - document.total_amount)
    const currentCredit = (Number(stakeholderIdExists.current_credit) || 0) + (total_amount - document.total_amount)
    const isInvalidCreditAmount = stakeholderIdExists && stakeholderIdExists.credit_limit && currentCredit > stakeholderIdExists.credit_limit

    if (requiredErrorFields.length > 0) requiredErrorFields.forEach(ef => errors.push(`El campo ${ef} es requerido`))
    if (requiredProductErrorFields)
      errors.push(`Los campos ${requiredParentProductFields.join(', ')} en productos deben contener un numero mayor a cero`)
    // if (duplicateProducts.length > 0) duplicateProducts.forEach(id => errors.push(`Los productos con id ${id} no deben estar duplicados`))
    if (productsExists.length > 0) productsExists.forEach(id => errors.push(`El producto con id ${id} no se encuentra registrado`))
    if (!document || !document.document_id) errors.push(`El documento con id ${document_id} no se encuentra registrado`)
    if (document && document.status !== types.documentsStatus.PENDING)
      errors.push(`La edicion solo es permitida en documentos con status ${types.documentsStatus.PENDING}`)
    if (subtotal_amount <= 0) errors.push(`El monto subtotal de la nota de servicio debe ser mayor a cero`)
    if (total_amount <= 0) errors.push(`El monto total de la nota de servicio debe ser mayor a cero`)
    if (!stakeholderIdExists || !stakeholderIdExists.credit_limit)
      errors.push(`Debe asignar un limite de credito al cliente antes de otorgarle un credito`)
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

    const formattedDates = getFormattedDates({ start_date, end_date })

    const { res } = await db.transaction(async connection => {
      const documentUpdated = await handleUpdateDocument(
        { ...req, body: { ...document, ...req.body, ...formattedDates, products: productsWithTaxes } },
        { connection }
      )

      const stakeholderCreditUpdated = await handleUpdateStakeholderCredit(
        {
          ...documentUpdated.req,
          body: {
            ...documentUpdated.req.body,
            total_credit: totalCredit,
            paid_credit: Number(stakeholderIdExists.paid_credit),
          },
        },
        documentUpdated.res
      )

      const inventoryMovementsCancelled = await handleCancelInventoryMovements(stakeholderCreditUpdated.req, stakeholderCreditUpdated.res)

      const inventoryMovementsCreated = await handleCreateInventoryMovements(inventoryMovementsCancelled.req, {
        ...inventoryMovementsCancelled.res,
        onCreateMovementType: config[document.operation_type].init.movementType,
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

module.exports.invoice = async event => {
  const inputType = {
    document_id: { type: ['number', 'string'], required: true },
    payment_method: { type: { enum: types.paymentMethods }, required: true },
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
  }

  try {
    const req = await handleRequest({ event, inputType })
    req.hasPermissions([types.permissions.SALES])

    const {
      document_id,
      payment_method,
      credit_days,
      subtotal_amount = 0,
      total_discount_amount,
      total_tax_amount,
      total_amount,
      products,
      serie,
      document_number,
      uuid,
    } = req.body
    const errors = []
    const productsMap = products.reduce((r, p) => {
      if (p.parent_product_id) return r

      return { ...r, [p.product_id]: [...(r[p.product_id] || []), p.product_id] }
    }, {})
    // const duplicateProducts = Object.keys(productsMap).flatMap(k => (productsMap[k].length > 1 ? k : []))
    const productsIds = products.map(p => p.product_id)
    const productsFromDB = await db.query(commonStorage.findProducts(productsIds))
    const requiredFields = ['document_id', 'payment_method', 'subtotal_amount', 'total_amount']
    if (Number(total_discount_amount) !== 0) requiredFields.push('total_discount_amount')
    if (Number(total_tax_amount) !== 0) requiredFields.push('total_tax_amount')
    const requiredErrorFields = requiredFields.filter(k => !req.body[k])
    const requiredParentProductFields = ['product_id', 'service_type', 'product_quantity']
    const requiredChildProductFields = ['product_id', 'service_type', 'product_quantity', 'product_price']
    const requiredProductErrorFields = products.some(p => {
      const isParentProduct = !p.parent_product_id && p.parent_product_id !== null
      if (isParentProduct) return requiredParentProductFields.some(k => !p[k] || p[k] <= 0)
      else return requiredChildProductFields.some(k => !p[k] || p[k] <= 0)
    })
    const documentDetails = document_id
      ? await db.query(commonStorage.findDocument([types.documentsTypes.SELL_PRE_INVOICE, types.documentsTypes.RENT_PRE_INVOICE]), [document_id])
      : []
    const invalidStatusProducts = documentDetails.flatMap(pm =>
      pm.products__product_status !== types.productsStatus.ACTIVE ? pm.products__product_id : []
    )

    if (requiredErrorFields.length > 0) requiredErrorFields.forEach(ef => errors.push(`El campo ${ef} es requerido`))
    if (requiredProductErrorFields)
      errors.push(`Los campos ${requiredParentProductFields.join(', ')} en productos deben contener un numero mayor a cero`)
    // if (duplicateProducts.length > 0) duplicateProducts.forEach(id => errors.push(`Los productos con id ${id} no deben estar duplicados`))
    if (!documentDetails || !documentDetails[0]) errors.push('El documento recibido no se encuentra registrado')
    if (invalidStatusProducts && invalidStatusProducts[0])
      invalidStatusProducts.forEach(id => errors.push(`El producto con id ${id} debe tener status ${types.productsStatus.ACTIVE}`))
    if (documentDetails[0] && documentDetails[0].document_status === types.documentsStatus.CANCELLED)
      errors.push('El documento ya se encuentra cancelado')
    if (documentDetails[0] && documentDetails[0].related_internal_document_id)
      errors.push(`El documento ya esta relacionado a una factura con id ${documentDetails[0].related_internal_document_id}`)
    if (subtotal_amount <= 0) errors.push(`El monto subtotal de la factura debe ser mayor a cero`)
    if (total_amount <= 0) errors.push(`El monto total de la factura debe ser mayor a cero`)
    if (Object.keys(types.paymentMethods).every(k => types.paymentMethods[k] !== payment_method))
      errors.push(
        `The field payment_method must contain one of these values: ${Object.keys(types.paymentMethods)
          .map(k => types.paymentMethods[k])
          .join(', ')}`
      )

    const [groupedDocumentDetails] = groupJoinResult({
      data: documentDetails,
      nestedFieldsKeys: ['products'],
      uniqueKey: ['document_id'],
    })

    const invalidProducts =
      groupedDocumentDetails &&
      products &&
      products[0] &&
      products.flatMap(p => {
        const isValid = groupedDocumentDetails.products.some(
          sale => Number(sale.product_id) === Number(p.product_id) && Number(sale.product_quantity) === Number(p.product_quantity)
        )

        if (isValid) return []
        else return p
      })

    const [stakeholderIdExists] =
      groupedDocumentDetails && groupedDocumentDetails.stakeholder_id
        ? await db.query(commonStorage.findStakeholder({ id: groupedDocumentDetails.stakeholder_id }))
        : []

    if (invalidProducts && invalidProducts[0]) errors.push(`La cantidad de productos no coincide con los registrados en la nota de servicio`)
    if (credit_days && Object.keys(types.creditsPolicy.creditDaysEnum).every(k => types.creditsPolicy.creditDaysEnum[k] !== credit_days))
      errors.push(
        `The field credit_days must contain one of these values: ${Object.keys(types.creditsPolicy.creditDaysEnum)
          .map(k => types.creditsPolicy.creditDaysEnum[k])
          .join(', ')}`
      )
    // if (credit_days && (!stakeholderIdExists || !stakeholderIdExists.credit_limit))
    if (!stakeholderIdExists || !stakeholderIdExists.credit_limit)
      errors.push(`Debe asignar un limite de credito al cliente antes de otorgarle un credito`)

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

    const productsWithTaxes = calculateProductTaxes(products, groupedDocumentDetails.products)
    const operation_type = groupedDocumentDetails.operation_type
    const document_type = config[operation_type].finish.documentType
    const related_internal_document_id = document_id

    const { res } = await db.transaction(async connection => {
      const documentCreated = await handleCreateDocument(
        {
          ...req,
          body: { ...groupedDocumentDetails, ...req.body, products: productsWithTaxes, document_type, operation_type },
        },
        { connection, calculateSalesCommission: true }
      )

      // const creditDueDateUpdated = await handleUpdateCreditDueDate(
      //   { ...documentCreated.req, body: { ...documentCreated.req.body, credit_days } },
      //   documentCreated.res
      // )

      // const creditPaidDateUpdated = await handleUpdateCreditPaidDate(
      //   { ...creditDueDateUpdated.req, body: { ...creditDueDateUpdated.req.body, creditPaidDate: credit_days ? null : new Date().toISOString() } },
      //   creditDueDateUpdated.res
      // )

      // const creditStatusUpdated = await handleUpdateCreditStatus(
      //   {
      //     ...creditPaidDateUpdated.req,
      //     body: {
      //       ...creditPaidDateUpdated.req.body,
      //       credit_status: credit_days ? types.creditsPolicy.creditStatusEnum.UNPAID : types.creditsPolicy.creditStatusEnum.PAID,
      //       related_internal_document_id,
      //     },
      //   },
      //   creditPaidDateUpdated.res
      // )

      // const stakeholderCreditUpdated = await handleUpdateStakeholderCredit(
      //   {
      //     ...creditStatusUpdated.req,
      //     body: {
      //       ...creditStatusUpdated.req.body,
      //       total_credit: Number(stakeholderIdExists.total_credit) - Number(groupedDocumentDetails.total_amount) + Number(total_amount),
      //       paid_credit: Number(stakeholderIdExists.paid_credit) + (credit_days ? 0 : total_amount),
      //     },
      //   },
      //   creditStatusUpdated.res
      // )

      // const documentPaidAmountUpdated = await handleUpdateDocumentPaidAmount(
      //   {
      //     ...stakeholderCreditUpdated.req,
      //     body: {
      //       ...stakeholderCreditUpdated.req.body,
      //       paid_credit_amount: credit_days ? 0 : total_amount,
      //     },
      //   },
      //   stakeholderCreditUpdated.res
      // )

      // const documentApproved = await handleApproveDocument(documentPaidAmountUpdated.req, documentPaidAmountUpdated.res)

      if (credit_days)
        await handleUpdateCreditDueDate({ ...documentCreated.req, body: { ...documentCreated.req.body, credit_days } }, documentCreated.res)

      const stakeholderCreditUpdated = await handleUpdateStakeholderCredit(
        {
          ...documentCreated.req,
          body: {
            ...documentCreated.req.body,
            total_credit: Number(stakeholderIdExists.total_credit) - Number(groupedDocumentDetails.total_amount) + Number(total_amount),
            paid_credit: Number(stakeholderIdExists.paid_credit),
          },
        },
        documentCreated.res
      )

      const documentApproved = await handleApproveDocument(stakeholderCreditUpdated.req, stakeholderCreditUpdated.res)

      const inventoryMovementsCreated = await handleCreateInventoryMovements(documentApproved.req, {
        ...documentApproved.res,
        onCreateMovementType: config[operation_type].finish.movementType,
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

module.exports.cancel = async event => {
  try {
    const inputType = {
      document_id: { type: ['number', 'string'], required: true },
      cancel_reason: { type: 'string' },
    }
    const req = await handleRequest({ event, inputType })
    req.hasPermissions([types.permissions.SALES])

    const { document_id } = req.body
    const errors = []
    const requiredFields = ['document_id']
    const requiredErrorFields = requiredFields.filter(k => !req.body[k])
    const documentProduct = document_id ? await db.query(commonStorage.findDocumentProduct(), [document_id]) : []
    const document = await getDocument({
      dbQuery: db.query,
      findDocumentStorage: commonStorage.findDocument,
      inventoryMovementsStatusCancelledType: types.inventoryMovementsStatus.CANCELLED,
      document_id,
      documentsTypes: [types.documentsTypes.SELL_PRE_INVOICE, types.documentsTypes.RENT_PRE_INVOICE],
      documentProduct,
      includeDocumentProductMovement: true,
      includeInventoryMovements: true,
    })

    if (requiredErrorFields.length > 0) requiredErrorFields.forEach(ef => errors.push(`El campo ${ef} es requerido`))
    if (!document || !document.document_id) errors.push('No existen una venta registrada con la informacion recibida')
    if (document && document.document_status === types.documentsStatus.CANCELLED) errors.push('El documento ya se encuentra cancelado')
    if (document && document.related_internal_document_id) errors.push(`No puede cancelar una venta con factura asociada`)

    if (errors.length > 0) throw new ValidatorException(errors)

    const { res } = await db.transaction(async connection => {
      const documentCancelled = await handleCancelDocument({ ...req, body: { ...document, ...req.body } }, { connection })

      const inventoryMovementsCancelled = await handleCancelInventoryMovements(documentCancelled.req, documentCancelled.res)

      const stakeholderCreditUpdated = await handleUpdateStakeholderCredit(
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

      return await handleUpdateStock(
        { ...stakeholderCreditUpdated.req, body: { ...stakeholderCreditUpdated.req.body, old_inventory_movements: [] } },
        { ...stakeholderCreditUpdated.res, updateStockOn: types.actions.CANCELLED }
      )
    })

    return await handleResponse({ req, res })
  } catch (error) {
    console.log(error)
    return await handleResponse({ error })
  }
}
