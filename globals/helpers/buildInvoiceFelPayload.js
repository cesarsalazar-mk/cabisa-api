const { formatFelFecha } = require('../common')

const buildInvoiceFelPayload = ({ document, stakeholder, products = [] }) => {
  const parentProducts = products.filter(
    p => p.parent_product_id === null || p.parent_product_id === undefined
  )

  const items = parentProducts.map(product => {
    const price = Number(product.product_price) || 0
    const quantity = Number(product.product_quantity) || 0
    const discountPercentage = Number(product.discount_percentage) || 0
    const discount = (discountPercentage / 100) * price * quantity

    return {
      description: product.description,
      price,
      discount,
      quantity,
      code: product.code,
      type: product.service_type,
    }
  })

  return {
    client: {
      id: stakeholder.id,
      name: stakeholder.name,
      nit: stakeholder.nit,
      address: stakeholder.address,
      email: stakeholder.email,
      phone: stakeholder.phone,
    },
    invoice: {
      items,
      observations: document.description || '',
      created_by: document.created_by,
      credit_days: document.credit_days,
    },
  }
}

module.exports = buildInvoiceFelPayload
