const mysql = require('mysql2/promise')
const {
  commonStorage,
  types,
  calculateProductTaxes,
  getFormattedDates,
  mysqlConfig,
  helpers,
  ValidatorException,
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
} = helpers
const db = mysqlConfig(mysql)

module.exports.read = async event => {
  try {
    const req = await handleRequest({ event })

    const res = await handleRead(req, { dbQuery: db.query, storage: storage.findAllBy, nestedFieldsKeys: ['products'] })

    if (req.query.$limit) {
      const countResult = await db.query(storage.findAllByCount(req.query))

      return await handleResponse({
        req,
        res: {
          statusCode: 200,
          data: {
            items: res.data,
            pagination: { total: Number(countResult[0]?.total) || 0 },
          },
        },
      })
    }

    return await handleResponse({ req, res })
  } catch (error) {
    console.log(error)
    return await handleResponse({ error })
  }
}

module.exports.create = async event => {
  const inputType = {
    stakeholder_id: { type: ['string', 'number'], required: true },
    // stakeholder_name: { type: 'string', length: 100 },
    // stakeholder_address: { type: 'string', length: 100 },
    // stakeholder_nit: { type: 'string', length: 11 },
    // stakeholder_phone: { type: 'string', length: 20 },
    start_date: { type: 'string', required: true },
    related_external_document_id: { type: ['string', 'number'], required: true },
    comments: { type: 'string' },
    products: {
      type: 'array',
      required: true,
      fields: {
        type: 'object',
        fields: {
          product_id: { type: ['string', 'number'], required: true },
          product_quantity: { type: 'number', min: 0, required: true },
          product_price: { type: 'number', min: 0 },
        },
      },
    },
  }

  try {
    const req = await handleRequest({ event, inputType })
    req.hasPermissions([types.permissions.INVENTORY])

    const { stakeholder_id, stakeholder_nit, products, start_date } = req.body
    const stakeholder_type = types.stakeholdersTypes.PROVIDER
    const operation_type = types.operationsTypes.PURCHASE
    const errors = []
    const productsMap = products.reduce((r, p) => ({ ...r, [p.product_id]: [...(r[p.product_id] || []), p.product_id] }), {})
    const duplicateProducts = Object.keys(productsMap).flatMap(k => (productsMap[k].length > 1 ? k : []))
    const productsIds = products.map(p => p.product_id)
    const productsFromDB = await db.query(commonStorage.findProducts(productsIds))
    const productsExists = products.flatMap(p => (!productsFromDB.some(ps => Number(ps.product_id) === Number(p.product_id)) ? p.product_id : []))
    const requiredFields = ['stakeholder_id', 'products', 'related_external_document_id']
    // if (!stakeholder_id) requiredFields.push('stakeholder_name', 'stakeholder_address', 'stakeholder_nit', 'stakeholder_phone')
    const requiredProductFields = ['product_id', 'product_quantity']
    const requiredErrorFields = requiredFields.filter(k => !req.body[k])
    const requiredProductErrorFields = requiredProductFields.some(k => products.some(p => !p[k] || p[k] <= 0))
    const [stakeholderNitUnique] = stakeholder_nit ? await db.query(commonStorage.findStakeholder({ nit: stakeholder_nit, stakeholder_type })) : []
    const [stakeholderIdExists] = stakeholder_id ? await db.query(commonStorage.findStakeholder({ id: stakeholder_id })) : []

    if (Object.keys(types.operationsTypes).every(k => types.operationsTypes[k] !== operation_type))
      errors.push(
        `The field operation_type must contain one of these values: ${Object.keys(types.operationsTypes)
          .map(k => types.operationsTypes[k])
          .join(', ')}`
      )
    if (requiredErrorFields.length > 0) requiredErrorFields.forEach(ef => errors.push(`El campo ${ef} es requerido`))
    if (requiredProductErrorFields) errors.push(`Los campos ${requiredProductFields.join(', ')} en productos deben contener un numero mayor a cero`)
    if (stakeholderNitUnique) errors.push('El nit ya se encuentra registrado')
    if (stakeholder_id && !stakeholderIdExists) errors.push('El proveedor no se encuentra registrado')
    if (duplicateProducts.length > 0) duplicateProducts.forEach(id => errors.push(`El producto con id ${id} se encuentra duplicado`))
    if (productsExists.length > 0) productsExists.forEach(id => errors.push(`El producto con id ${id} no se encuentra registrado`))
    if (productsFromDB && productsFromDB.some(pdb => pdb.product_type === types.productsTypes.SERVICE))
      errors.push('Una compra no puede incluir servicios')

    if (errors.length > 0) throw new ValidatorException(errors)

    const productsWithTaxes = calculateProductTaxes(products, productsFromDB)
    const formattedDates = getFormattedDates({ start_date })

    const { res } = await db.transaction(async connection => {
      const stakeholderCreated = await handleCreateStakeholder(
        { ...req, body: { ...req.body, ...formattedDates, products: productsWithTaxes } },
        { connection }
      )

      const documentCreated = await handleCreateDocument(
        { ...stakeholderCreated.req, body: { ...stakeholderCreated.req.body, document_type: types.documentsTypes.PURCHASE_ORDER } },
        stakeholderCreated.res
      )

      const operationCreated = await handleCreateOperation(
        { ...documentCreated.req, body: { ...documentCreated.req.body, operation_type } },
        documentCreated.res
      )

      const documentApproved = await handleApproveDocument(operationCreated.req, operationCreated.res)

      const inventoryMovementsCreated = await handleCreateInventoryMovements(documentApproved.req, {
        ...documentApproved.res,
        onCreateMovementType: types.inventoryMovementsTypes.IN,
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
    stakeholder_id: { type: ['string', 'number'], required: true },
    // stakeholder_name: { type: 'string', length: 100 },
    // stakeholder_address: { type: 'string', length: 100 },
    // stakeholder_nit: { type: 'string', length: 11 },
    // stakeholder_phone: { type: 'string', length: 20 },
    start_date: { type: 'string', required: true },
    related_external_document_id: { type: ['string', 'number'], required: true },
    comments: { type: 'string' },
    products: {
      type: 'array',
      required: true,
      fields: {
        type: 'object',
        fields: {
          product_id: { type: ['string', 'number'], required: true },
          product_quantity: { type: 'number', min: 0, required: true },
          product_price: { type: 'number', min: 0 },
        },
      },
    },
  }

  try {
    const req = await handleRequest({ event, inputType })
    req.hasPermissions([types.permissions.INVENTORY])

    const { document_id, stakeholder_id, stakeholder_nit, products, start_date } = req.body
    const stakeholder_type = types.stakeholdersTypes.PROVIDER
    const operation_type = types.operationsTypes.PURCHASE
    const document = await getDocument({
      dbQuery: db.query,
      findDocumentStorage: commonStorage.findDocument,
      inventoryMovementsStatusCancelledType: types.inventoryMovementsStatus.CANCELLED,
      document_id,
      documentsTypes: [types.documentsTypes.PURCHASE_ORDER],
      includeDocumentProductMovement: true,
    })

    const errors = []
    const productsMap = products.reduce((r, p) => ({ ...r, [p.product_id]: [...(r[p.product_id] || []), p.product_id] }), {})
    const duplicateProducts = Object.keys(productsMap).flatMap(k => (productsMap[k].length > 1 ? k : []))
    const productsIds = products.map(p => p.product_id)
    const productsFromDB = await db.query(commonStorage.findProducts(productsIds))
    const productsExists = products.flatMap(p => (!productsFromDB.some(ps => Number(ps.product_id) === Number(p.product_id)) ? p.product_id : []))
    const requiredFields = ['document_id', 'stakeholder_id', 'products', 'related_external_document_id']
    // if (!stakeholder_id) requiredFields.push('stakeholder_name', 'stakeholder_address', 'stakeholder_nit', 'stakeholder_phone')
    const requiredProductFields = ['product_id', 'product_quantity']
    const requiredErrorFields = requiredFields.filter(k => !req.body[k])
    const requiredProductErrorFields = requiredProductFields.some(k => products.some(p => !p[k] || p[k] <= 0))
    const [stakeholderNitUnique] = stakeholder_nit ? await db.query(commonStorage.findStakeholder({ nit: stakeholder_nit, stakeholder_type })) : []
    const [stakeholderIdExists] = stakeholder_id ? await db.query(commonStorage.findStakeholder({ id: stakeholder_id })) : []

    if (Object.keys(types.operationsTypes).every(k => types.operationsTypes[k] !== operation_type))
      errors.push(
        `The field operation_type must contain one of these values: ${Object.keys(types.operationsTypes)
          .map(k => types.operationsTypes[k])
          .join(', ')}`
      )
    if (requiredErrorFields.length > 0) requiredErrorFields.forEach(ef => errors.push(`El campo ${ef} es requerido`))
    if (requiredProductErrorFields) errors.push(`Los campos ${requiredProductFields.join(', ')} en productos deben contener un numero mayor a cero`)
    if (stakeholderNitUnique) errors.push('El nit ya se encuentra registrado')
    if (stakeholder_id && !stakeholderIdExists) errors.push('El proveedor no se encuentra registrado')
    if (duplicateProducts.length > 0) duplicateProducts.forEach(id => errors.push(`El producto con id ${id} se encuentra duplicado`))
    if (productsExists.length > 0) productsExists.forEach(id => errors.push(`El producto con id ${id} no se encuentra registrado`))
    if (productsFromDB && productsFromDB.some(pdb => pdb.product_type === types.productsTypes.SERVICE))
      errors.push('Una compra no puede incluir servicios')
    if (!document || !document.document_id) errors.push(`El documento con id ${document_id} no se encuentra registrado`)
    if (document && document.status === types.documentsStatus.CANCELLED)
      errors.push(`Los documentos con status ${types.documentsStatus.CANCELLED} no pueden ser modificados`)

    if (errors.length > 0) throw new ValidatorException(errors)

    const productsWithTaxes = calculateProductTaxes(products, productsFromDB)
    const formattedDates = getFormattedDates({ start_date })

    const { res } = await db.transaction(async connection => {
      const stakeholderCreated = await handleCreateStakeholder(
        { ...req, body: { ...document, ...req.body, ...formattedDates, products: productsWithTaxes, operation_type } },
        { connection }
      )

      const documentUpdated = await handleUpdateDocument(stakeholderCreated.req, stakeholderCreated.res)

      const inventoryMovementsCancelled = await handleCancelInventoryMovements(documentUpdated.req, documentUpdated.res)

      const inventoryMovementsCreated = await handleCreateInventoryMovements(inventoryMovementsCancelled.req, {
        ...inventoryMovementsCancelled.res,
        onCreateMovementType: types.inventoryMovementsTypes.IN,
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
    req.hasPermissions([types.permissions.INVENTORY])

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
      documentsTypes: [types.documentsTypes.PURCHASE_ORDER],
      documentProduct,
      includeDocumentProductMovement: true,
      includeInventoryMovements: true,
    })

    if (requiredErrorFields.length > 0) requiredErrorFields.forEach(ef => errors.push(`El campo ${ef} es requerido`))
    if (!document || !document.document_id) errors.push('No existen compras registradas con la informacion recibida')
    if (document && document.document_status === types.documentsStatus.CANCELLED) errors.push('El documento ya se encuentra cancelado')

    if (errors.length > 0) throw new ValidatorException(errors)

    const { res } = await db.transaction(async connection => {
      const documentCancelled = await handleCancelDocument({ ...req, body: { ...document, ...req.body } }, { connection })

      const inventoryMovementsCancelled = await handleCancelInventoryMovements(documentCancelled.req, documentCancelled.res)

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
