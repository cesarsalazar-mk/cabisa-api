const buildInvoiceFelPayload = ({ document, stakeholder, products = [] }) => {
  const mappedItems = products.map(product => {
    const price =
      Number(
        product.service_user_price ||
          product.product_user_price ||
          product.product_price
      ) || 0
    const quantity = Number(product.product_quantity) || 0
    const discountPercentage =
      Number(product.product_discount_percentage ?? product.discount_percentage) || 0
    const discount = (discountPercentage / 100) * price * quantity
    const description =
      product.product_description ||
      product.service_description ||
      product.description ||
      ''

    return {
      description,
      price,
      discount,
      quantity,
      code: product.code_product || product.code,
      type: product.service_type,
      parent_product_id: product.parent_product_id,
    }
  })

  const parentItems = mappedItems.filter(
    item => item.parent_product_id === null || item.parent_product_id === undefined
  )
  const felItems = (parentItems.length > 0 ? parentItems : mappedItems).map(
    ({ parent_product_id, ...item }) => item
  )

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
      items: felItems,
      observations: document.description || '',
      created_by: document.created_by,
      credit_days: document.credit_days,
    },
  }
}

module.exports = buildInvoiceFelPayload
