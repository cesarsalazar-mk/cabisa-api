const crypto = require('crypto-js')
const mysql = require('mysql2/promise')
const { mysqlConfig, helpers, isEmail, ValidatorException, cryptoHelpers, types } = require(`${process.env['FILE_ENVIRONMENT']}/globals`)
const storage = require('./storage')
const { handleRequest, handleResponse, handleRead } = helpers
const db = mysqlConfig(mysql)
const { encrypt, decrypt } = cryptoHelpers(crypto)

module.exports.read = async event => {
  try {
    const req = await handleRequest({ event })

    const res = await handleRead(req, { dbQuery: db.query, storage: storage.findAllBy })

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

module.exports.readRoles = async event => {
  try {
    const req = await handleRequest({ event })

    const res = await handleRead(req, { dbQuery: db.query, storage: storage.findRoles })

    return await handleResponse({ req, res })
  } catch (error) {
    console.log(error)
    return await handleResponse({ error })
  }
}

module.exports.readUsersOptions = async event => {
  try {
    const req = await handleRequest({ event })

    const res = await handleRead(req, { dbQuery: db.query, storage: storage.findOptionsBy })

    return await handleResponse({ req, res })
  } catch (error) {
    console.log(error)
    return await handleResponse({ error })
  }
}

module.exports.create = async event => {
  try {
    const inputType = {
      fullName: { type: 'string', required: true },
      password: { type: 'string', length: 100, required: true },
      email: { type: 'email', required: true },
      rolId: { type: 'string', length: 20, required: true },
      sales_commission: { type: 'number', min: 0, max: 100 },
    }
    const req = await handleRequest({ event, inputType })
    req.hasPermissions([types.permissions.USERS])

    const { fullName, password, email, rolId, sales_commission = null } = req.body
    const errors = []
    const requiredFields = ['fullName', 'password', 'email', 'rolId']
    if (Number(rolId) === 2) requiredFields.push('sales_commission')
    const requiredErrorFields = requiredFields.filter(k => !req.body[k])
    const [userExists] = await db.query(storage.checkExists({ email }))

    if (requiredErrorFields.length > 0) requiredErrorFields.forEach(ef => errors.push(`El campo ${ef} es requerido`))
    if (userExists) errors.push(`El email ya se encuentra registrado`)
    if (email && !isEmail(email)) errors.push(`El email es invalido`)
    if (sales_commission && (sales_commission < 0 || sales_commission > 100))
      errors.push('El porcentaje de comision debe estar en un rango entre 0 y 100')

    if (errors.length > 0) throw new ValidatorException(errors)

    const cipherPassword = encrypt(password, process.env['ENCRYPTION_KEY'])

    const res = await db.transaction(async connection => {
      await connection.query(storage.createUser(), [fullName, cipherPassword, email, sales_commission, rolId, rolId])
      const id = await connection.geLastInsertId()

      return { statusCode: 201, data: { id }, message: 'Usuario creado exitosamente' }
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
      fullName: { type: 'string', required: true },
      email: { type: 'email', required: true },
      sales_commission: { type: 'number', min: 0, max: 100 },
      rolId: { type: 'string', length: 20, required: true },
      previousPassword: { type: 'string' },
      proposedPassword: { type: 'string' },
    }
    // TODO: si se cambia el rolId entonces se deben reescribir los permisos de la tabla users con los del nuevo rol
    const req = await handleRequest({ event, inputType })
    req.hasPermissions([types.permissions.USERS])

    const { id, fullName, email, sales_commission = null, rolId, previousPassword, proposedPassword } = req.body
    const errors = []
    const requiredFields = ['id', 'fullName', 'email', 'rolId']
    // if (previousPassword) requiredFields.push('proposedPassword')
    if (Number(rolId) === 2) requiredFields.push('sales_commission')
    const requiredErrorFields = requiredFields.filter(k => !req.body[k])
    const [userExists] = await db.query(storage.checkExists({ id }))
    const [emailExists] = await db.query(storage.checkExists({ email }))
    // const previousPasswordFromDB = userExists && userExists.password
    // const plainTextPassword = decrypt(previousPasswordFromDB, process.env['ENCRYPTION_KEY'])

    if (requiredErrorFields.length > 0) requiredErrorFields.forEach(ef => errors.push(`El campo ${ef} es requerido`))
    if (!userExists) errors.push(`El usuario con id ${id} no se encuentra registrado`)
    if (emailExists && Number(emailExists.id) !== Number(id)) errors.push(`El email no se encuentra registrado`)
    if (email && !isEmail(email)) errors.push(`El email es invalido`)
    // if (plainTextPassword !== previousPassword) errors.push('La contraseña actual no coincide con la registrada anteriormente')
    if (sales_commission && (sales_commission < 0 || sales_commission > 100))
      errors.push('El porcentaje de comision debe estar en un rango entre 0 y 100')

    if (errors.length > 0) throw new ValidatorException(errors)

    const res = await db.transaction(async connection => {
      await connection.query(storage.updateUser(), [fullName, email, sales_commission, rolId, id])

      // if (previousPassword && proposedPassword) {
      //   await handleCognitoChangePassword(
      //     {
      //       accessToken: req.accessToken,
      //       previousPassword: encrypt(previousPassword, process.env['ENCRYPTION_KEY']),
      //       proposedPassword: encrypt(proposedPassword, process.env['ENCRYPTION_KEY']),
      //     },
      //     connection
      //   )
      // }

      return { statusCode: 200, data: { id }, message: 'Usuario actualizado exitosamente' }
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
    req.hasPermissions([types.permissions.USERS])

    const { id } = req.body
    const errors = []
    const requiredFields = ['id']
    const requiredErrorFields = requiredFields.filter(k => !req.body[k])

    if (requiredErrorFields.length > 0) requiredErrorFields.forEach(ef => errors.push(`El campo ${ef} es requerido`))

    if (errors.length > 0) throw new ValidatorException(errors)

    const res = await db.transaction(async connection => {
      await connection.query(storage.deleteUser(), [id])

      return { statusCode: 200, data: { id }, message: 'Usuario eliminado exitosamente' }
    })

    return await handleResponse({ req, res })
  } catch (error) {
    console.log(error)
    return await handleResponse({ error })
  }
}

module.exports.updatePermissions = async event => {
  try {
    const inputType = {
      id: { type: ['string', 'number'], required: true },
      permissions: {
        type: 'array',
        required: true,
        fields: {
          type: 'object',
          fields: {
            id: { type: ['string', 'number'], required: true },
            name: { type: 'string', required: true },
            edit: { type: 'boolean' },
            view: { type: 'boolean' },
            create: { type: 'boolean' },
            delete: { type: 'boolean' },
          },
        },
      },
    }
    const req = await handleRequest({ event, inputType, dbQuery: db.query, storage: storage.findAllBy })
    req.hasPermissions([types.permissions.USERS])

    const { id, permissions } = req.body
    const errors = []
    const requiredFields = ['id', 'permissions']
    const requiredPermissionsFields = ['id', 'name']
    const requiredErrorFields = requiredFields.filter(k => !req.body[k])
    const requiredPermissionsErrorFields = requiredPermissionsFields.some(k => permissions.some(p => !p[k]))

    if (requiredErrorFields.length > 0) requiredErrorFields.forEach(ef => errors.push(`El campo ${ef} es requerido`))
    if (requiredPermissionsErrorFields) errors.push(`Los campos ${requiredPermissionsFields.join(', ')} son requeridos en todos los permisos`)
    if (!req.currentModel.id) errors.push(`El usuario con id ${id} no se encuentra registrado`)

    if (errors.length > 0) throw new ValidatorException(errors)

    const newPermissions = req.currentModel.permissions.map(oldPerm => {
      const samePermissions = permissions.find(perm => Number(perm.id) === Number(oldPerm.id))

      if (samePermissions) return { ...oldPerm, ...samePermissions }
      else return oldPerm
    })

    const res = await db.transaction(async connection => {
      const newPermissionsStringified = JSON.stringify(newPermissions)
      await connection.query(storage.updatePermissions(newPermissionsStringified, id))

      return { statusCode: 200, data: { id }, message: 'Permisos actualizados exitosamente' }
    })

    return await handleResponse({ req, res })
  } catch (error) {
    console.log(error)
    return await handleResponse({ error })
  }
}

module.exports.changePassword = async event => {
  try {
    const inputType = {
      previousPassword: { type: 'string', required: true },
      proposedPassword: { type: 'string', required: true },
    }
    const req = await handleRequest({ event, inputType })
    req.hasPermissions([types.permissions.USERS])

    // TODO: obtener el accessToken de cognito del event
    const userId = req.accessToken && req.accessToken.userId
    const { previousPassword, proposedPassword } = req.body
    const errors = []
    const requiredFields = ['previousPassword', 'proposedPassword']
    const requiredErrorFields = requiredFields.filter(k => !req.body[k])
    const [previousPasswordFromDB] = await db.query(storage.findPassword(), [userId])
    const plainTextPassword = decrypt(previousPasswordFromDB, process.env['ENCRYPTION_KEY'])

    if (requiredErrorFields.length > 0) requiredErrorFields.forEach(ef => errors.push(`El campo ${ef} es requerido`))
    if (!userId) errors.push('Invalid access token! Requires userId')
    if (plainTextPassword !== previousPassword) errors.push('La contraseña actual no coincide con la registrada anteriormente')

    if (errors.length > 0) throw new ValidatorException(errors)

    const res = await db.transaction(async connection => {
      return await handleCognitoChangePassword(
        {
          accessToken: req.accessToken,
          previousPassword: encrypt(previousPassword, process.env['ENCRYPTION_KEY']),
          proposedPassword: encrypt(proposedPassword, process.env['ENCRYPTION_KEY']),
        },
        connection
      )
    })

    return await handleResponse({ req, res })
  } catch (error) {
    console.log(error)
    return await handleResponse({ error })
  }
}

const handleCognitoChangePassword = async ({ accessToken, previousPassword, proposedPassword }, connection) => {
  if (!accessToken) throw new Error('Invalid access token')
  if (!previousPassword || !proposedPassword) throw new Error('Invalid password')

  const cognitoResponse = await cognitoChangePasswordService({
    AccessToken: accessToken,
    PreviousPassword: previousPassword,
    ProposedPassword: proposedPassword,
  })

  // TODO: verificar si hubo error en cognito.changePassword
  if (!cognitoResponse) throw new Error('Cognito error')

  await connection.query(storage.updatePassword(), [proposedPassword, userId])

  return { statusCode: 200, data: { id: accessToken.userId }, message: 'Contraseña actualizada exitosamente' }
}

const cognitoChangePasswordService = ({ AccessToken, PreviousPassword, ProposedPassword }) => {
  return new Promise((resolve, reject) => {
    const AWS = require('aws-sdk')
    AWS.config.update({
      accessKeyId: process.env['ACCESS_KEY_ID'],
      secretAccessKey: process.env['SECRET_ACCESS_KEY'],
      region: process.env['REGION'],
    })
    const cognito = new AWS.CognitoIdentityServiceProvider()

    cognito.changePassword({ AccessToken, PreviousPassword, ProposedPassword }, (error, data) => {
      if (error) reject(error)
      else resolve(data)
    })
  })
}
