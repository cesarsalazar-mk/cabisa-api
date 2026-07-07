const mysql = require('mysql2/promise')
const { types, mysqlConfig, helpers, isEmail, ValidatorException, getFormattedDates } = require(`${process.env['FILE_ENVIRONMENT']}/globals`)
const { handleRead, handleRequest, handleResponse, handleCreateStakeholder } = helpers
const storage = require('./storage')
const db = mysqlConfig(mysql)

function getStakeholderPermissionType(stakeholder_type) {
  if (stakeholder_type === types.stakeholdersTypes.CLIENT_INDIVIDUAL) return types.permissions.CLIENTS
  if (stakeholder_type === types.stakeholdersTypes.CLIENT_COMPANY) return types.permissions.CLIENTS
  if (stakeholder_type === types.stakeholdersTypes.PROVIDER) return types.permissions.SUPPLIERS
}

module.exports.read = async event => {
  try {
    const req = await handleRequest({ event })

    const res = await handleRead(req, { dbQuery: db.query, storage: storage.findAllBy, nestedFieldsKeys: ['projects'] })

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

module.exports.readStakeholdersOptions = async event => {
  try {
    const req = await handleRequest({ event })

    const res = await handleRead(req, { dbQuery: db.query, storage: storage.findOptionsBy })

    return await handleResponse({ req, res })
  } catch (error) {
    console.log(error)
    return await handleResponse({ error })
  }
}

module.exports.readStakeholdersTypes = async event => {
  try {
    const req = await handleRequest({ event })

    const res = await handleRead(req, { dbQuery: db.query, storage: storage.findStakeholderTypes })

    return await handleResponse({ req, res })
  } catch (error) {
    console.log(error)
    return await handleResponse({ error })
  }
}

module.exports.readProjectsOptions = async event => {
  try {
    const req = await handleRequest({ event })

    const res = await handleRead(req, { dbQuery: db.query, storage: storage.findProjectsOptionsBy })

    return await handleResponse({ req, res })
  } catch (error) {
    console.log(error)
    return await handleResponse({ error })
  }
}

module.exports.create = async event => {
  try {
    const inputType = {
      stakeholder_type: { type: { enum: types.stakeholdersTypes }, required: true },
      name: { type: 'string', length: 100, required: true },
      address: { type: 'string', length: 100, required: true },
      nit: { type: 'string', length: 11, required: true },
      email: { type: 'email' },
      phone: { type: 'string', length: 20, required: true },
      alternative_phone: { type: 'string', length: 20 },
      business_man: { type: 'string', length: 100 },
      payments_man: { type: 'string', length: 100 },
      credit_limit: { type: 'number', min: 0 },
      projects: {
        type: 'array',
        fields: {
          type: 'object',
          fields: {
            id: { type: ['string', 'number'] },
            start_date: { type: 'string', required: true },
            end_date: { type: 'string' },
            name: { type: 'string', required: true },
          },
        },
      },
    }
    const req = await handleRequest({ event, inputType })
    const { stakeholder_type, nit, email, projects, credit_limit } = req.body

    req.hasPermissions([getStakeholderPermissionType(stakeholder_type)])

    const errors = []
    const requiredFields = ['stakeholder_type', 'name', 'address', 'nit', 'phone']
    const requiredErrorFields = requiredFields.filter(k => !req.body[k])
    const [stakeholderExists] = await db.query(storage.checkExists({ nit, stakeholder_type }))
    const projectsMap =
      projects && projects[0]
        ? projects.reduce((r, p) => {
            if (!p.name) return r
            return { ...r, [p.name]: [...(r[p.name] || []), p.name] }
          }, {})
        : {}
    const duplicateProjects = Object.keys(projectsMap)[0] && Object.keys(projectsMap).flatMap(k => (projectsMap[k].length > 1 ? k : []))
    const requiredProjectFields = projects && projects[0] ? ['start_date', 'name'] : []
    const requiredProjectErrorFields = requiredProjectFields.some(k => projects.some(p => !p[k]))

    if (requiredErrorFields.length > 0) requiredErrorFields.forEach(ef => errors.push(`El campo ${ef} es requerido`))
    if (stakeholderExists) errors.push(`El nit ya se encuentra registrado`)
    if (email && !isEmail(email)) errors.push(`El email es invalido`)
    if (Object.keys(types.stakeholdersTypes).every(k => types.stakeholdersTypes[k] !== stakeholder_type))
      errors.push(
        `The field stakeholder_type must contain one of these values: ${Object.keys(types.stakeholdersTypes)
          .map(k => types.stakeholdersTypes[k])
          .join(', ')}`
      )
    if (requiredProjectErrorFields) errors.push(`Los campos ${requiredProjectFields.join(', ')} en proyectos, son requeridos`)
    if (duplicateProjects && duplicateProjects[0]) duplicateProjects.forEach(name => errors.push(`El proyecto ${name} no deben estar duplicados`))
    if (credit_limit && credit_limit < 0) errors.push('El limite de credito debe ser superior a cero')

    if (errors.length > 0) throw new ValidatorException(errors)

    const res = await db.transaction(async connection => {
      const stakeholderCreated = await handleCreateStakeholder(req, { connection })
      const { stakeholder_id } = stakeholderCreated.res.data

      await crupdateProjects({ stakeholderId: stakeholder_id, crupdatedBy: req.currentUser.user_id, projects }, connection)

      return stakeholderCreated.res
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
      stakeholder_type: { type: { enum: types.stakeholdersTypes }, required: true },
      name: { type: 'string', length: 100, required: true },
      address: { type: 'string', length: 100, required: true },
      nit: { type: 'string', length: 11, required: true },
      email: { type: 'email' },
      phone: { type: 'string', length: 20, required: true },
      alternative_phone: { type: 'string', length: 20 },
      business_man: { type: 'string', length: 100 },
      payments_man: { type: 'string', length: 100 },
      credit_limit: { type: 'number', min: 0 },
      projects: {
        type: 'array',
        fields: {
          type: 'object',
          fields: {
            id: { type: ['string', 'number'] },
            start_date: { type: 'string', required: true },
            end_date: { type: 'string' },
            name: { type: 'string', required: true },
          },
        },
      },
    }
    const req = await handleRequest({
      event,
      inputType,
      dbQuery: db.query,
      storage: storage.findAllBy,
      nestedFieldsKeys: ['projects'],
    })
    const { id, stakeholder_type, name, address, nit, email, phone, business_man, payments_man, projects, credit_limit } = req.body

    req.hasPermissions([getStakeholderPermissionType(stakeholder_type)])

    const errors = []
    const projectsMap =
      projects && projects[0]
        ? projects.reduce((r, p) => {
            if (!p.name) return r
            return { ...r, [p.name]: [...(r[p.name] || []), p.name] }
          }, {})
        : {}
    const duplicateProjects = Object.keys(projectsMap)[0] && Object.keys(projectsMap).flatMap(k => (projectsMap[k].length > 1 ? k : []))
    const requiredFields = ['id', 'stakeholder_type', 'name', 'address', 'nit', 'phone']
    const requiredErrorFields = requiredFields.filter(k => !req.body[k])
    const requiredProjectFields = projects && projects[0] ? ['start_date', 'name'] : []
    const requiredProjectErrorFields = requiredProjectFields.some(k => projects.some(p => !p[k]))
    const [stakeholder] = await db.query(storage.checkExists({ nit, stakeholder_type }))

    if (requiredErrorFields.length > 0) requiredErrorFields.forEach(ef => errors.push(`El campo ${ef} es requerido`))
    if (requiredProjectErrorFields) errors.push(`Los campos ${requiredProjectFields.join(', ')} en proyectos, son requeridos`)
    if (!req.currentModel) errors.push(`El stakeholder con id ${id} no se encuentra registrado`)
    if (stakeholder && Number(id) !== Number(stakeholder.id)) errors.push(`El nit ya se encuentra registrado`)
    if (!isEmail(email)) errors.push(`El email es invalido`)
    if (Object.keys(types.stakeholdersTypes).every(k => types.stakeholdersTypes[k] !== stakeholder_type))
      errors.push(
        `The field stakeholder_type must contain one of these values: ${Object.keys(types.stakeholdersTypes)
          .map(k => types.stakeholdersTypes[k])
          .join(', ')}`
      )
    if (duplicateProjects && duplicateProjects[0]) duplicateProjects.forEach(name => errors.push(`El proyecto ${name} no deben estar duplicados`))
    if (credit_limit && credit_limit < 0) errors.push('El limite de credito debe ser superior a cero')

    if (errors.length > 0) throw new ValidatorException(errors)

    const res = await db.transaction(async connection => {
      await connection.query(storage.updateStakeholder(), [
        stakeholder_type,
        name,
        address,
        nit,
        email,
        phone,
        business_man,
        payments_man,
        credit_limit,
        req.currentUser.user_id,
        id,
      ])

      const crupdatedProjects = await crupdateProjects(
        { stakeholderId: id, crupdatedBy: req.currentUser.user_id, oldProjects: req.currentModel.projects, projects },
        connection
      )

      return { statusCode: 200, data: { id, projects: crupdatedProjects }, message: 'Stakeholder actualizado exitosamente' }
    })

    return await handleResponse({ req, res })
  } catch (error) {
    console.log(error)
    return await handleResponse({ error })
  }
}

module.exports.setStatus = async event => {
  try {
    const inputType = {
      id: { type: ['string', 'number'], required: true },
      status: { type: { enum: types.stakeholdersStatus }, required: true, defaultValue: types.stakeholdersStatus.ACTIVE },
      block_reason: { type: 'string' },
    }
    const req = await handleRequest({ event, inputType })
    const { id, status, block_reason } = req.body

    const [stakeholderExists] = id && (await db.query(storage.checkExists({ id }, '1')))
    const stakeholderPermissionType = stakeholderExists && getStakeholderPermissionType(stakeholderExists.stakeholder_type)
    req.hasPermissions([stakeholderPermissionType])

    const errors = []
    const requiredFields = status !== types.stakeholdersStatus.BLOCKED ? ['id', 'status'] : ['id', 'status'] //, 'block_reason'
    const requiredErrorFields = requiredFields.filter(k => !req.body[k])

    if (requiredErrorFields.length > 0) requiredErrorFields.forEach(ef => errors.push(`El campo ${ef} es requerido`))
    if (!stakeholderExists) errors.push(`El stakeholder con id ${id} no se encuentra registrado`)
    if (Object.keys(types.stakeholdersStatus).every(k => types.stakeholdersStatus[k] !== status))
      errors.push(
        `The field status must contain one of these values: ${Object.keys(types.stakeholdersStatus)
          .map(k => types.stakeholdersStatus[k])
          .join(', ')}`
      )

    if (errors.length > 0) throw new ValidatorException(errors)

    const res = await db.transaction(async connection => {
      await connection.query(storage.setStatusStakeholder(), [status, block_reason, req.currentUser.user_id, id])

      return { statusCode: 200, data: { id }, message: 'Status actualizado exitosamente' }
    })

    return await handleResponse({ req, res })
  } catch (error) {
    console.log(error)
    return await handleResponse({ error })
  }
}

const crupdateProjects = async ({ stakeholderId, crupdatedBy, projects, oldProjects }, connection) => {
  if (!stakeholderId || !crupdatedBy) throw new Error('Missing parameter on crupdateProjects')

  const deleteProjectIds =
    oldProjects &&
    oldProjects[0] &&
    oldProjects[0].id &&
    oldProjects.flatMap(op => (projects && projects[0] && projects.some(p => Number(p.id) === Number(op.id)) ? [] : op.id))

  const crupdateProjectsValues =
    projects &&
    projects[0] &&
    projects.map(p => {
      const { start_date, end_date } = getFormattedDates({ start_date: p.start_date, end_date: p.end_date })

      return `(
        ${p.id ? p.id : null},
        ${stakeholderId ? stakeholderId : null},
        ${start_date ? `'${start_date}'` : null},
        ${end_date ? `'${end_date}'` : null},
        ${p.name ? `'${p.name}'` : null},
        ${crupdatedBy}
      )`
    })

  if (deleteProjectIds && deleteProjectIds[0]) await connection.query(storage.deleteProjects(deleteProjectIds), [stakeholderId])
  if (crupdateProjectsValues && crupdateProjectsValues[0]) await connection.query(storage.crupdateProjects(crupdateProjectsValues))
}
