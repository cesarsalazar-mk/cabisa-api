const mysql = require('mysql2/promise')
const { types, mysqlConfig, helpers, isEmail, ValidatorException } = require(`${process.env['FILE_ENVIRONMENT']}/globals`)
const storage = require('./storage')
const { handleRequest, handleResponse, handleRead } = helpers
const db = mysqlConfig(mysql)

const sellerInputType = {
  name: { type: 'string', length: 100, required: true },
  email: { type: 'string', length: 100 },
  phone: { type: 'string', length: 20 },
  commission_percentage: { type: ['number', 'string'], defaultValue: 5 },
}

const validateSeller = ({ id, name, email, commission_percentage }, requireId = false) => {
  const errors = []
  const commission = Number(commission_percentage)

  if (requireId && !id) errors.push('El campo id es requerido')
  if (!name) errors.push('El campo name es requerido')
  if (email && !isEmail(email)) errors.push('El email es invalido')
  if (Number.isNaN(commission) || commission < 0 || commission > 100) errors.push('El porcentaje de comision debe estar entre 0 y 100')

  if (errors.length > 0) throw new ValidatorException(errors)

  return commission
}

module.exports.read = async event => {
  try {
    const req = await handleRequest({ event })

    const res = await handleRead(req, { dbQuery: db.query, storage: storage.findAllBy })

    if (req.query.$limit) {
      const [{ total }] = await db.query(storage.findAllByCount(req.query))

      return await handleResponse({
        req,
        res: { statusCode: 200, data: { items: res.data, pagination: { total: Number(total) || 0 } } },
      })
    }

    return await handleResponse({ req, res })
  } catch (error) {
    console.log(error)
    return await handleResponse({ error })
  }
}

module.exports.create = async event => {
  try {
    const req = await handleRequest({ event, inputType: sellerInputType })
    req.hasPermissions([types.permissions.SALES])

    const { name, email, phone } = req.body
    const commission = validateSeller(req.body)

    const res = await db.transaction(async connection => {
      await connection.query(storage.createSeller(), [name, email, phone, commission, req.currentUser.user_id])

      return { statusCode: 201, data: { id: await connection.geLastInsertId() }, message: 'Vendedor creado exitosamente' }
    })

    return await handleResponse({ req, res })
  } catch (error) {
    console.log(error)
    return await handleResponse({ error })
  }
}

module.exports.update = async event => {
  try {
    const req = await handleRequest({ event, inputType: { id: { type: ['number', 'string'], required: true }, ...sellerInputType } })
    req.hasPermissions([types.permissions.SALES])

    const { id, name, email, phone } = req.body
    const commission = validateSeller(req.body, true)

    const res = await db.transaction(async connection => {
      await connection.query(storage.updateSeller(), [name, email, phone, commission, req.currentUser.user_id, id])

      return { statusCode: 200, data: { id }, message: 'Vendedor actualizado exitosamente' }
    })

    return await handleResponse({ req, res })
  } catch (error) {
    console.log(error)
    return await handleResponse({ error })
  }
}

module.exports.delete = async event => {
  try {
    const req = await handleRequest({ event, inputType: { id: { type: ['number', 'string'], required: true } } })
    req.hasPermissions([types.permissions.SALES])

    const { id } = req.body

    if (!id) throw new ValidatorException(['El campo id es requerido'])

    const res = await db.transaction(async connection => {
      await connection.query(storage.deleteSeller(), [req.currentUser.user_id, id])

      return { statusCode: 200, data: { id }, message: 'Vendedor eliminado exitosamente' }
    })

    return await handleResponse({ req, res })
  } catch (error) {
    console.log(error)
    return await handleResponse({ error })
  }
}

module.exports.reactivate = async event => {
  try {
    const req = await handleRequest({ event, inputType: { id: { type: ['number', 'string'], required: true } } })
    req.hasPermissions([types.permissions.SALES])

    const { id } = req.body

    if (!id) throw new ValidatorException(['El campo id es requerido'])

    const res = await db.transaction(async connection => {
      await connection.query(storage.reactivateSeller(), [req.currentUser.user_id, id])

      return { statusCode: 200, data: { id }, message: 'Vendedor reactivado exitosamente' }
    })

    return await handleResponse({ req, res })
  } catch (error) {
    console.log(error)
    return await handleResponse({ error })
  }
}
