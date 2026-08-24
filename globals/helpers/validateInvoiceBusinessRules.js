const types = require('../types')
const { ValidatorException } = require('../common')
const { parentChildProductsValidator } = require('../validators')

const validateInvoiceBusinessRules = async ({
  body,
  dbQuery,
  commonStorage,
  storage,
  operation_type = types.operationsTypes.SELL,
}) => {
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
  } = body

  const errors = []
  const productsIds = products.map(p => p.product_id)
  const productsFromDB = await dbQuery(commonStorage.findProducts(productsIds))
  const productsExists = products.flatMap(p =>
    !productsFromDB.some(ps => Number(ps.product_id) === Number(p.product_id)) ? p.product_id : []
  )
  const requiredFields = ['stakeholder_id', 'products', 'payment_method', 'project_id', 'subtotal_amount', 'total_amount']
  if (Number(total_discount_amount) !== 0) requiredFields.push('total_discount_amount')
  if (Number(total_tax_amount) !== 0) requiredFields.push('total_tax_amount')
  const requiredParentProductFields = ['product_id', 'service_type', 'product_quantity']
  const requiredChildProductFields = ['product_id', 'service_type', 'product_quantity', 'product_price']
  const requiredErrorFields = requiredFields.filter(k => !body[k])
  const requiredProductErrorFields = products.some(p => {
    const isParentProduct = !p.parent_product_id && p.parent_product_id !== null
    if (isParentProduct) return requiredParentProductFields.some(k => !p[k] || p[k] <= 0)
    else return requiredChildProductFields.some(k => !p[k] || p[k] <= 0)
  })
  const [stakeholderNitUnique] = stakeholder_nit
    ? await dbQuery(commonStorage.findStakeholder({ nit: stakeholder_nit, stakeholder_type }))
    : []
  const [stakeholderIdExists] = stakeholder_id
    ? await dbQuery(commonStorage.findStakeholder({ id: stakeholder_id }))
    : []
  const [projectExists] = project_id ? await dbQuery(storage.checkProjectExists(), [project_id]) : []
  const totalCredit = (Number(stakeholderIdExists?.total_credit) || 0) + total_amount
  const currentCredit = (Number(stakeholderIdExists?.current_credit) || 0) + total_amount
  const isInvalidCreditAmount =
    stakeholderIdExists && stakeholderIdExists.credit_limit && currentCredit > stakeholderIdExists.credit_limit

  if (Object.keys(types.operationsTypes).every(k => types.operationsTypes[k] !== operation_type)) {
    errors.push(
      `The field operation_type must contain one of these values: ${Object.keys(types.operationsTypes)
        .map(k => types.operationsTypes[k])
        .join(', ')}`
    )
  }
  if (Object.keys(types.paymentMethods).every(k => types.paymentMethods[k] !== payment_method)) {
    errors.push(
      `The field payment_method must contain one of these values: ${Object.keys(types.paymentMethods)
        .map(k => types.paymentMethods[k])
        .join(', ')}`
    )
  }
  if (
    credit_days &&
    Object.keys(types.creditsPolicy.creditDaysEnum).every(
      k => types.creditsPolicy.creditDaysEnum[k] !== credit_days
    )
  ) {
    errors.push(
      `The field credit_days must contain one of these values: ${Object.keys(types.creditsPolicy.creditDaysEnum)
        .map(k => types.creditsPolicy.creditDaysEnum[k])
        .join(', ')}`
    )
  }
  if (requiredErrorFields.length > 0) requiredErrorFields.forEach(ef => errors.push(`El campo ${ef} es requerido`))
  if (requiredProductErrorFields) {
    errors.push(
      `Los campos ${requiredParentProductFields.join(', ')} en productos deben contener un numero mayor a cero`
    )
  }
  if (stakeholderNitUnique) errors.push('El nit ya se encuentra registrado')
  if (stakeholder_id && !stakeholderIdExists) errors.push('El cliente ya se encuentra registrado')
  if (productsExists.length > 0) productsExists.forEach(id => errors.push(`El producto con id ${id} no esta registrado`))
  if (project_id && !projectExists) errors.push(`El proyecto no se encuentra registrado`)
  if (subtotal_amount <= 0) errors.push(`El monto subtotal de la factura debe ser mayor a cero`)
  if (total_amount <= 0) errors.push(`El monto total de la factura debe ser mayor a cero`)
  if (!stakeholderIdExists || !stakeholderIdExists.credit_limit) {
    errors.push(`Debe asignar un limite de credito al cliente antes de otorgarle un credito`)
  }
  if (isInvalidCreditAmount) errors.push(`Se ha superado el limite de credito del cliente`)

  products.forEach(p => {
    if (Object.keys(types.documentsServiceType).every(k => types.documentsServiceType[k] !== p.service_type)) {
      errors.push(
        `The field service_type must contain one of these values: ${Object.keys(types.documentsServiceType)
          .map(k => types.documentsServiceType[k])
          .join(', ')}`
      )
    }

    if (p.service_type === types.documentsServiceType.SERVICE) {
      const parentChildProductsErrors = parentChildProductsValidator(p, products, productsFromDB)
      parentChildProductsErrors[0] && parentChildProductsErrors.forEach(pce => errors.push(pce))
    }
  })

  if (errors.length > 0) throw new ValidatorException(errors)

  return {
    productsFromDB,
    stakeholderIdExists,
    totalCredit,
  }
}

module.exports = validateInvoiceBusinessRules
