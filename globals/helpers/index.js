const handleApproveDocument = require('./handleApproveDocument')
const handleApproveInventoryMovements = require('./handleApproveInventoryMovements')
const handleCancelDocument = require('./handleCancelDocument')
const handleCancelInventoryMovements = require('./handleCancelInventoryMovements')
const handleCreateDocument = require('./handleCreateDocument')
const handleCreateInventoryMovements = require('./handleCreateInventoryMovements')
const handleCreateOperation = require('./handleCreateOperation')
const handleCreateStakeholder = require('./handleCreateStakeholder')
const handleRead = require('./handleRead')
const handleRequest = require('./handleRequest')
const handleResponse = require('./handleResponse')
const handleUpdateCreditDueDate = require('./handleUpdateCreditDueDate')
const handleUpdateCreditPaidDate = require('./handleUpdateCreditPaidDate')
const handleUpdateCreditStatus = require('./handleUpdateCreditStatus')
const handleUpdateDocument = require('./handleUpdateDocument')
const handleUpdateDocumentPaidAmount = require('./handleUpdateDocumentPaidAmount')
const handleUpdateStakeholderCredit = require('./handleUpdateStakeholderCredit')
const handleUpdateStock = require('./handleUpdateStock')
const buildXml = require('./buildInvoiceXml')
const buildXmlFcam = require('./buildInvoiceFcamXml')
const buidCancelXml = require('./buildCancelXml')
const buildCreditDebitNote = require('./builCreditDebitNote')
const invoiceAdjustments = require('./invoiceAdjustments')
const buildInvoiceFelPayload = require('./buildInvoiceFelPayload')
const { certifyInvoiceFel, getFelLogTimestamp } = require('./certifyInvoiceFel')
const validateInvoiceBusinessRules = require('./validateInvoiceBusinessRules')
const {
  finalizeExistingSellInvoice,
  applyFelCertificationToDocument,
} = require('./finalizeSellInvoice')

module.exports = {
  handleApproveDocument,
  handleApproveInventoryMovements,
  handleCancelDocument,
  handleCancelInventoryMovements,
  handleCreateDocument,
  handleCreateInventoryMovements,
  handleCreateOperation,
  handleCreateStakeholder,
  handleRead,
  handleRequest,
  handleResponse,
  handleUpdateCreditDueDate,
  handleUpdateCreditPaidDate,
  handleUpdateCreditStatus,
  handleUpdateDocument,
  handleUpdateDocumentPaidAmount,
  handleUpdateStakeholderCredit,
  handleUpdateStock,
  buildXml,
  buildXmlFcam,
  buidCancelXml,
  buildCreditDebitNote,
  invoiceAdjustments,
  buildInvoiceFelPayload,
  certifyInvoiceFel,
  getFelLogTimestamp,
  validateInvoiceBusinessRules,
  finalizeExistingSellInvoice,
  applyFelCertificationToDocument,
}
