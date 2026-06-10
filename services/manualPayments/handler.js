const mysql = require('mysql2/promise')
const { types, mysqlConfig, helpers, ValidatorException, groupJoinResult, getFormattedDates } = require(`${process.env['FILE_ENVIRONMENT']}/globals`)
const storage = require('./storage')
const {
  handleRequest,
  handleResponse,
  handleRead,
  handleUpdateStakeholderCredit,
  handleUpdateCreditStatus,
  handleUpdateCreditPaidDate,
  handleUpdateDocumentPaidAmount,
} = helpers
const db = mysqlConfig(mysql)

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

    const res = await handleRead(req, { dbQuery: db.query, storage: storage.findAllBy, nestedFieldsKeys: ['payments'] })
      
    const data = res.data[0]
      ? res.data.map(d => ({
          ...d,                    
          payments:
            d.payments && d.payments[0]
              ? d.payments.reduce((r, p) => {
                  const isDuplicate = r[0] && r.some(rp => Number(rp.payment_id) === Number(p.payment_id))

                  if (isDuplicate || !p.payment_id || p.is_deleted) return r
                  else return [...r, p]
                }, [])
              : [],
        }))
      : []

    return await handleResponse({ req, res: { ...res, data } })
  } catch (error) {
    console.log(error)
    return await handleResponse({ error })
  }
}

module.exports.crupdate = async event => {
  try {
    const inputType = {
      document_id: { type: ['number', 'string'], required: true },
      total_amount: { type: ['number', 'string'], required: true },      
      payments: {
        type: 'array',
        fields: {
          type: 'object',
          fields: {
            payment_id: { type: ['string', 'number'] },
            payment_amount: { type: 'number', min: 1, required: true },
            payment_method: { type: { enum: types.paymentMethods }, required: true },
            payment_date: { type: 'string', required: true },
            related_external_document: { type: 'string' },
            description: { type: 'string' },
            attachment_url: { type: 'string' },
          },
        },
      },
    }
        
    const req = await handleRequest({ event, inputType })
    req.hasPermissions([types.permissions.PAGOS])
    
    const {document_id, payments } = req.body
    const manual_payment = document_id
    const errors = []
    const requiredFields = ['document_id']
    const requiredPaymentFields = ['payment_amount', 'payment_method', 'payment_date']
    const requiredErrorFields = requiredFields.filter(k => !req.body[k])
    const requiredPaymentErrorFields = requiredPaymentFields.some(k => payments.some(p => !p[k] || p[k] <= 0))
    
    
    const rawDocument = await db.query(storage.findDocumentPayments(), [document_id])    
    const [document] = rawDocument ? groupJoinResult({ data: rawDocument, nestedFieldsKeys: ['old_payments'], uniqueKey: ['id'] }) : []
    
    const documentOldPayments =
      document && document.old_payments && document.old_payments[0] ? document.old_payments.flatMap(op => (op.is_deleted ? [] : op)) : []

    const invalidPaymentMethod =
      payments && payments[0] && payments.find(p => Object.keys(types.paymentMethods).every(k => types.paymentMethods[k] !== p.payment_method))

    const paidCreditAmount = payments && payments[0] ? payments.reduce((r, p) => r + Number(p.payment_amount), 0) : 0      
    const documentCreditAmount = document && document.total_amount ? Number(document.total_amount) : 0

    if (requiredErrorFields.length > 0) requiredErrorFields.forEach(ef => errors.push(`El campo ${ef} es requerido`))
    if (requiredPaymentErrorFields) errors.push(`Los campos ${requiredPaymentFields.join(', ')} son obligatorios`)
    
    if (paidCreditAmount > documentCreditAmount) errors.push(`El total de los pagos no puede ser superior al total del credito para este documento`)
    if (invalidPaymentMethod)
      errors.push(
        `The field credit_days must contain one of these values: ${Object.keys(types.creditsPolicy.creditDaysEnum)
          .map(k => types.creditsPolicy.creditDaysEnum[k])
          .join(', ')}`
      )

    if (errors.length > 0) throw new ValidatorException(errors)

    const getCreditStatus = (paidCreditAmount, documentCreditAmount, documentCreditStatus) => {
      if (paidCreditAmount === documentCreditAmount) return types.creditsPolicy.creditStatusEnum.PAID
      if (documentCreditStatus === types.creditsPolicy.creditStatusEnum.DEFAULT) return documentCreditStatus
      return types.creditsPolicy.creditStatusEnum.UNPAID
    }

    
    const credit_status = getCreditStatus(paidCreditAmount, documentCreditAmount, document.status)
    const { res } = await db.transaction(async connection => {      
      await connection.query(storage.updateManualPaymentStatus(document.id,credit_status))
     
      const deletePaymentIds =
        documentOldPayments &&
        documentOldPayments[0] &&
        documentOldPayments.flatMap(op =>
          payments && payments[0] && payments.some(p => Number(p.payment_id) === Number(op.payment_id)) ? [] : op.payment_id
        )

      const crupdatePaymentsValues = payments.map(p => {        
      const createdAt = new Date()
        const { payment_date, created_at } = getFormattedDates({ payment_date: p.payment_date, created_at: createdAt })

        return `(
              ${p.payment_id ? p.payment_id : null},
              ${manual_payment},              
              '${p.payment_method}',
              ${p.payment_amount},
              '${p.payment_date}',
              ${p.related_external_document ? `'${p.related_external_document}'` : null},
              ${p.description ? `'${p.description}'` : null},
              ${p.attachment_url ? `'${p.attachment_url}'` : null},
              '${created_at}',
              ${req.currentUser.user_id}
            )`
      })

      if (deletePaymentIds && deletePaymentIds[0]) await connection.query(storage.deletePayments(deletePaymentIds))
      if (crupdatePaymentsValues && crupdatePaymentsValues[0]) await connection.query(storage.crupdatePayments(crupdatePaymentsValues))
      
      return {
        req,        
        res: { statusCode: 200, data: { }, message: 'Pagos actualizados exitosamente' },
      }
    })

    return await handleResponse({ req, res })
  } catch (error) {
    console.log(error)
    return await handleResponse({ error })
  }
}

module.exports.cronUpdateCreditStatus = async () => {
  try {
    const creditStatus = types.creditsPolicy.creditStatusEnum.DEFAULT
    const documents = await db.query(storage.findDocumentsWithDefaultCredits())

    if (documents.length > 0) {
      const creditStatusValues = documents.map(d => `(${d.id}, ${d.stakeholder_id}, '${creditStatus}', ${d.created_by}, ${d.updated_by})`)

      await db.query(storage.bulkUpdateCreditStatus(creditStatusValues))
    }

    return await handleResponse({
      req: {},
      res: { statusCode: 200, data: { documents: documents.map(d => d.id) }, message: 'Documento actualizado exitosamente' },
    })
  } catch (error) {
    console.log(error)
    return await handleResponse({ error })
  }
}


module.exports.createManualPayment = async event => {
  try {
    const inputType = {
      project_id: { type: ['number', 'string'], required: true },
      stakeholder_id: { type: ['number', 'string'], required: true },      
      total_amount: { type: ['number', 'string'], required: true },            
    }        
    const req = await handleRequest({ event, inputType })
    req.hasPermissions([types.permissions.PAGOS])    
    const {project_id,stakeholder_id,total_amount } = req.body    
    const { res } = await db.transaction(async connection => {      
      await connection.query(storage.createManualPayment([total_amount,stakeholder_id,project_id]))  
      return {
        req,        
        res: { statusCode: 200, data: { }, message: 'Recibo Creado exitosamente' },
      }
    })

    return await handleResponse({ req, res })
  } catch (error) {
    console.log(error)
    return await handleResponse({ error })
  }
}

module.exports.removeManualPayment = async event => {
  try {
    const inputType = {
      id: { type: ['number', 'string'], required: true }      
    }        
    const req = await handleRequest({ event, inputType })
    req.hasPermissions([types.permissions.PAGOS])    
    const {id} = req.body    
    const { res } = await db.transaction(async connection => {      
      await connection.query(storage.deleteManualPayment(id))  
      return {
        req,        
        res: { statusCode: 200, data: { }, message: 'Recibo Eliminado exitosamente' },
      }
    })

    return await handleResponse({ req, res })
  } catch (error) {
    console.log(error)
    return await handleResponse({ error })
  }
}