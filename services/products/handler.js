const mysql = require('mysql2/promise')
const { mysqlConfig, helpers, types, ValidatorException } = require(`${process.env['FILE_ENVIRONMENT']}/globals`)
const storage = require('./storage')
const { handleRead, handleRequest, handleResponse } = helpers
const db = mysqlConfig(mysql)

module.exports.read = async event => {
  try {
    const req = await handleRequest({ event })

    const res = await handleRead(req, { dbQuery: db.query, storage: storage.findAllBy, nestedFieldsKeys: ['product_history'] })
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

module.exports.readProductsStatus = async event => {
  try {
    const req = await handleRequest({ event })

    const res = await handleRead(req, { dbQuery: db.query, storage: storage.findProductsStatus })

    return await handleResponse({ req, res })
  } catch (error) {
    console.log(error)
    return await handleResponse({ error })
  }
}

module.exports.readProductsCategories = async event => {
  try {
    const req = await handleRequest({ event })

    const res = await handleRead(req, { dbQuery: db.query, storage: storage.findProductsCategories })

    return await handleResponse({ req, res })
  } catch (error) {
    console.log(error)
    return await handleResponse({ error })
  }
}

module.exports.readProductTaxes = async event => {
  try {
    const req = await handleRequest({ event })

    const res = await handleRead(req, { dbQuery: db.query, storage: storage.findProductsTaxes })

    return await handleResponse({ req, res })
  } catch (error) {
    console.log(error)
    return await handleResponse({ error })
  }
}

module.exports.readProductsOptions = async event => {
  try {
    const req = await handleRequest({ event })
    
    const res = await handleRead(req, { dbQuery: db.query, storage: storage.findOptionsByDescriptionAndCode })

    return await handleResponse({ req, res })
  } catch (error) {
    console.log(error)
    return await handleResponse({ error })
  }
}

module.exports.create = async event => {
  try {
    const inputType = {
      product_category: { type: { enum: types.productsCategories }, required: true },
      status: { type: { enum: types.productsStatus }, required: true },
      code: { type: 'string', length: 50, required: true, unique: true },
      tax_id: { type: ['number', 'string'], required: true },
      serial_number: { type: 'string', length: 50 },
      description: { type: 'string', length: 255, required: true },
      image_url: { type: 'string' },
      sales_category: { type: { enum: types.salesCategories } },
    }
    const req = await handleRequest({ event, inputType })
    req.hasPermissions([types.permissions.INVENTORY])

    const { product_category, status, code, serial_number, tax_id, description, image_url, sales_category } = req.body
    const product_type = types.productsTypes.PRODUCT
    const errors = []
    const requiredFields = ['product_category', 'status', 'code', 'tax_id', 'description']
    const requiredErrorFields = requiredFields.filter(k => !req.body[k])
    const [codeExists] = await db.query(storage.checkExists({ code, product_category }))
    if (Object.keys(types.productsStatus).every(k => types.productsStatus[k] !== status))
      errors.push(
        `The field status must contain one of these values: ${Object.keys(types.productsStatus)
          .map(k => types.productsStatus[k])
          .join(', ')}`
      )

    if (requiredErrorFields.length > 0) requiredErrorFields.forEach(ef => errors.push(`El campo ${ef} es requerido`))
    if (codeExists) errors.push(`El codigo ya se encuentra registrado`)

    if (errors.length > 0) throw new ValidatorException(errors)

    const res = await db.transaction(async connection => {
      await connection.query(storage.createProduct(), [
        product_type,
        product_category,
        sales_category || null,
        status,
        code,
        serial_number,
        tax_id,
        description,
        image_url,
        req.currentUser.user_id,
      ])

      return { statusCode: 201, data: { id: await connection.geLastInsertId() }, message: 'Producto creado exitosamente' }
    })

    return await handleResponse({ req, res })
  } catch (error) {
    console.log(error)
    return await handleResponse({ error })
  }
}

module.exports.update = async event => {
  try {
    const inputType = {
      id: { type: ['string', 'number'], required: true },
      product_category: { type: { enum: types.productsCategories }, required: true },
      status: { type: { enum: types.productsStatus }, required: true },
      code: { type: 'string', length: 50, required: true, unique: true },
      serial_number: { type: 'string', length: 50 },
      tax_id: { type: ['number', 'string'], required: true },
      description: { type: 'string', length: 255, required: true },
      image_url: { type: 'string' },
      sales_category: { type: { enum: types.salesCategories } },
    }
    const req = await handleRequest({ event, inputType, dbQuery: db.query, storage: storage.findAllBy })
    req.hasPermissions([types.permissions.INVENTORY])

    const { id, product_category, status, code, serial_number, tax_id, description, image_url, sales_category } = req.body
    const errors = []
    const requiredFields = ['id', 'product_category', 'status', 'code', 'tax_id', 'description']
    const requiredErrorFields = requiredFields.filter(k => !req.body[k])
    const [product] =
      req.currentModel && req.currentModel.product_type
        ? await db.query(storage.checkExists({ code, product_type: req.currentModel.product_type }))
        : []

    if (requiredErrorFields.length > 0) requiredErrorFields.forEach(ef => errors.push(`El campo ${ef} es requerido`))
    if (product && Number(id) !== Number(product.id)) errors.push(`El codigo ya se encuentra registrado`)
    if (Object.keys(types.productsStatus).every(k => types.productsStatus[k] !== status))
      errors.push(
        `The field status must contain one of these values: ${Object.keys(types.productsStatus)
          .map(k => types.productsStatus[k])
          .join(', ')}`
      )

    if (errors.length > 0) throw new ValidatorException(errors)

    const res = await db.transaction(async connection => {
      await connection.query(storage.updateProduct(), [
        product_category,
        sales_category || null,
        status,
        code,
        serial_number,
        tax_id,
        description,
        image_url,
        req.currentUser.user_id,
        id,
      ])

      return { statusCode: 200, data: { id }, message: 'Producto actualizado exitosamente' }
    })

    return await handleResponse({ req, res })
  } catch (error) {
    console.log(error)
    return await handleResponse({ error })
  }
}

module.exports.delete = async event => {
  try {
    const inputType = {
      id: { type: ['string', 'number'], required: true },
    }
    const req = await handleRequest({ event, inputType })
    req.hasPermissions([types.permissions.INVENTORY])

    const { id } = req.body
    const errors = []
    const requiredFields = ['id']
    const requiredErrorFields = requiredFields.filter(k => !req.body[k])
    const [productExists] = await db.query(storage.checkExists({ id, product_type: types.productsTypes.PRODUCT }, '1'))

    if (requiredErrorFields.length > 0) requiredErrorFields.forEach(ef => errors.push(`El campo ${ef} es requerido`))
    if (!productExists) errors.push(`El producto con id ${id} no se encuentra registrado`)

    if (errors.length > 0) throw new ValidatorException(errors)

    const res = await db.transaction(async connection => {
      await connection.query(storage.deleteProduct(), [id])

      return { statusCode: 200, data: { id }, message: 'Producto eliminado exitosamente' }
    })

    return await handleResponse({ req, res })
  } catch (error) {
    console.log(error)
    return await handleResponse({ error })
  }
}
