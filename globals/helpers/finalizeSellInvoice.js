const types = require('../types')
const { formatFelFecha } = require('../common')
const handleUpdateStakeholderCredit = require('./handleUpdateStakeholderCredit')
const handleUpdateCreditDueDate = require('./handleUpdateCreditDueDate')
const handleUpdateCreditStatus = require('./handleUpdateCreditStatus')
const handleCreateOperation = require('./handleCreateOperation')
const handleApproveDocument = require('./handleApproveDocument')
const handleCreateInventoryMovements = require('./handleCreateInventoryMovements')
const handleApproveInventoryMovements = require('./handleApproveInventoryMovements')
const handleUpdateStock = require('./handleUpdateStock')

const finalizeExistingSellInvoice = async ({
  req,
  body,
  connection,
  stakeholderIdExists,
  totalCredit,
}) => {
  const { credit_days } = body
  const operation_type = types.operationsTypes.SELL

  const stakeholderCreditUpdated = await handleUpdateStakeholderCredit(
    {
      ...req,
      body: {
        ...body,
        total_credit: totalCredit,
        paid_credit: Number(stakeholderIdExists.paid_credit),
      },
    },
    { connection }
  )

  let currentReq = stakeholderCreditUpdated.req
  let currentRes = stakeholderCreditUpdated.res

  if (credit_days) {
    const creditDueDateUpdated = await handleUpdateCreditDueDate(
      { ...currentReq, body: { ...currentReq.body, credit_days } },
      currentRes
    )

    await handleUpdateCreditStatus(
      {
        ...creditDueDateUpdated.req,
        body: {
          ...creditDueDateUpdated.req.body,
          credit_status: types.creditsPolicy.creditStatusEnum.UNPAID,
        },
      },
      creditDueDateUpdated.res
    )

    currentReq = creditDueDateUpdated.req
    currentRes = creditDueDateUpdated.res
  }

  const operationCreated = await handleCreateOperation(
    { ...currentReq, body: { ...currentReq.body, operation_type } },
    currentRes
  )

  const documentApproved = await handleApproveDocument(operationCreated.req, operationCreated.res)

  const inventoryMovementsCreated = await handleCreateInventoryMovements(documentApproved.req, {
    ...documentApproved.res,
    onCreateMovementType: types.inventoryMovementsTypes.OUT,
  })

  const inventoryMovementsApproved = await handleApproveInventoryMovements(
    inventoryMovementsCreated.req,
    inventoryMovementsCreated.res
  )

  return handleUpdateStock(inventoryMovementsApproved.req, {
    ...inventoryMovementsApproved.res,
    updateStockOn: types.actions.APPROVED,
  })
}

const applyFelCertificationToDocument = async ({
  connection,
  documentId,
  felData,
  updatedBy,
  status = types.documentsStatus.PENDING,
}) => {
  const { updateDocumentFelCertification } = require('../commonStorage')
  const { serie, numero, uuid, fecha } = felData
  const factDate = formatFelFecha(fecha)

  await connection.query(updateDocumentFelCertification(), [
    serie,
    numero,
    uuid,
    factDate,
    status,
    updatedBy,
    documentId,
  ])

  return { serie, document_number: numero, uuid, fact_date: factDate }
}

module.exports = {
  finalizeExistingSellInvoice,
  applyFelCertificationToDocument,
}
