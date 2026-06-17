const actions = {
  CREATE: 'CREATE',
  READ: 'READ',
  UPDATE: 'UPDATE',
  DELETE: 'DELETE',
  ACTIVE: 'ACTIVATE',
  INACTIVE: 'DEACTIVATE',
  APPROVED: 'APPROVE',
  CANCELLED: 'CANCEL',
}

const paymentMethods = {
  CARD: 'CARD',
  CASH: 'CASH',
  CHECK: 'CHECK',
  DEPOSIT: 'DEPOSIT',
  TRANSFER: 'TRANSFER',
}

const documentsTypes = {
  INVENTORY_ADJUSTMENT: 'INVENTORY_ADJUSTMENT',
  PURCHASE_ORDER: 'PURCHASE_ORDER',
  RENT_INVOICE: 'RENT_INVOICE',
  RENT_PRE_INVOICE: 'RENT_PRE_INVOICE',
  REPAIR_ORDER: 'REPAIR_ORDER',
  SELL_INVOICE: 'SELL_INVOICE',
  SELL_PRE_INVOICE: 'SELL_PRE_INVOICE',
}

const documentsServiceType = {
  PART: 'PART',
  EQUIPMENT: 'EQUIPMENT',
  SERVICE: 'SERVICE',
}

const documentsStatus = {
  PENDING: 'PENDING',
  CANCELLED: 'CANCELLED',
  APPROVED: 'APPROVED',
}

const inventoryMovementsStatus = {
  PENDING: 'PENDING',
  PARTIAL: 'PARTIAL',
  CANCELLED: 'CANCELLED',
  APPROVED: 'APPROVED',
}

const inventoryMovementsTypes = {
  IN: 'IN',
  OUT: 'OUT',
}

const operationsTypes = {
  INVENTORY_ADJUSTMENT: 'INVENTORY_ADJUSTMENT',
  PURCHASE: 'PURCHASE',
  RENT: 'RENT',
  REPAIR: 'REPAIR',
  SELL: 'SELL',
}

const productsCategories = {
  EQUIPMENT: 'EQUIPMENT',
  PART: 'PART',
}

const salesCategories = {
  SC: 'sc',
  SE: 'se',
  SF: 'sf',
  SO: 'so',
}

const productsStatus = {
  ACTIVE: 'ACTIVE',
  INACTIVE: 'INACTIVE',
  BLOCKED: 'BLOCKED',
}

const productsTypes = {
  SERVICE: 'SERVICE',
  PRODUCT: 'PRODUCT',
}

const rolesStatus = {
  ACTIVE: 'ACTIVE',
  INACTIVE: 'INACTIVE',
}

const stakeholdersStatus = {
  ACTIVE: 'ACTIVE',
  INACTIVE: 'INACTIVE',
  BLOCKED: 'BLOCKED',
}

const stakeholdersTypes = {
  CLIENT_INDIVIDUAL: 'CLIENT_INDIVIDUAL',
  CLIENT_COMPANY: 'CLIENT_COMPANY',
  PROVIDER: 'PROVIDER',
}

const usersStatus = {
  ACTIVE: 'ACTIVE',
  INACTIVE: 'INACTIVE',
  BLOCKED: 'BLOCKED',
}

const creditsPolicy = {
  creditDaysEnum: {
    ONE_WEEK: 7,
    TWO_WEEKS: 15,
    ONE_MONTH: 30,
  },
  creditStatusEnum: {
    UNPAID: 'UNPAID', // no pagado pero dentro del limite de dias
    PAID: 'PAID', // pagado
    DEFAULT: 'DEFAULT', // no pagado luego de vencer el limite de dias
  },
}

// PERMISSIONS
const permissions = {
  GENERAL_CONFIG: 1,
  USERS: 2,
  REPORTS: 3,
  INVOICES: 4,
  INVENTORY: 5,
  SALES: 6,
  CLIENTS: 7,
  SUPPLIERS: 8,
  REPAIRS: 9,
  PAGOS: 10,
}

module.exports = {
  actions,
  creditsPolicy,
  paymentMethods,
  documentsServiceType,
  documentsStatus,
  documentsTypes,
  inventoryMovementsStatus,
  inventoryMovementsTypes,
  operationsTypes,
  permissions,
  productsCategories,
  salesCategories,
  productsStatus,
  productsTypes,
  rolesStatus,
  stakeholdersStatus,
  stakeholdersTypes,
  usersStatus,
}
