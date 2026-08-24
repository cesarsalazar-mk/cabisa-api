const { types, getWhereConditions, toGuatemalaDateSql } = require(`${process.env['FILE_ENVIRONMENT']}/globals`)

module.exports.createInvoiceFelLogDocument = () => `
  INSERT INTO log_documents (response_pdf, request, error, response_json, document_id, serie, created_by, uuid, cabisa_document_id, create_at, update_at)
  VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`

module.exports.findByDocumentId = (id) => {    
  return`
  select response_pdf from log_documents
  where document_id = '${id}';
  `
}


module.exports.parseToJson = async (xml, xml2js) =>
  await new Promise(((resolve, reject) => {
    xml2js.parseString(xml, { mergeAttrs: true }, (err, result) => {
      if (err) {
        reject(err);
      }
      const json = JSON.parse(JSON.stringify(result, null, 2));
      resolve(json)
    });
  }))

  module.exports.createDebitCreditLogDocument = () => `
  INSERT INTO documents_debit_credit_notes (document_type,
    stakeholder_id,
    related_bill_document_number,
    related_bill_uuid,
    related_bill_serie,
    adjustment_reason,
    response_pdf,
    request,
    error,
    response_json,
    serie,
    uuid,
    document_number,
    created_by,request_detail)
  VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
`

const stripPaginationFields = (fields = {}) => {
  const { $limit, $offset, ...filterFields } = fields

  return filterFields
}

const buildPaginationSQL = (fields = {}) => {
  const limit = fields.$limit
  const offset = fields.$offset

  if (!limit) return ''

  const offsetSQL = offset ? ` OFFSET ${offset}` : ''

  return `LIMIT ${limit}${offsetSQL}`
}

const buildDebitCreditNotesWhere = (fields = {}, noteAlias = 'dcn', stakeholderAlias = 's') => {
  const filterFields = stripPaginationFields(fields)
  const rawWhereConditions = getWhereConditions({ fields: filterFields, tableAlias: 'd' })

  return rawWhereConditions
    .replace(/d\.nit/gi, `${stakeholderAlias}.nit`)
    .replace(/d\.name/gi, `${stakeholderAlias}.name`)
    .replace(/d\.start_date/gi, toGuatemalaDateSql(`${noteAlias}.created_at`))
    .replace(/d\.end_date/gi, toGuatemalaDateSql(`${noteAlias}.created_at`))
    .replace(/d\.related_bill_document_number/gi, `${noteAlias}.related_bill_document_number`)
    .replace(/d\.document_type/gi, `${noteAlias}.document_type`)
}

module.exports.getDebitCreditNotes = (fields = {}) => {
  const whereConditions = buildDebitCreditNotesWhere(fields)
  const paginationSQL = buildPaginationSQL(fields)
  const paginationSubquery = paginationSQL
    ? `
    AND dcn.id IN (
      SELECT id FROM (
        SELECT dcn2.id
        FROM documents_debit_credit_notes dcn2
        JOIN stakeholders s2 ON s2.id = dcn2.stakeholder_id
        WHERE dcn2.error = 'NO ERRORS'
        ${buildDebitCreditNotesWhere(fields, 'dcn2', 's2')}
        ORDER BY dcn2.id DESC
        ${paginationSQL}
      ) AS paginated_notes
    )`
    : ''

  return `
  select
      s.id,
      s.name AS stakeholder_name,
      s.nit AS stakeholder_nit,
      s.email AS stakeholder_email,
      s.phone AS stakeholder_phone,
      s.address AS stakeholder_address,
      dcn.id,
      dcn.document_type,
      dcn.related_bill_document_number,
      dcn.related_bill_serie,
      dcn.related_bill_uuid,
      dcn.adjustment_reason,
      dcn.document_number,
      dcn.serie,
      dcn.uuid,
      dcn.created_by,
      dcn.created_at
from documents_debit_credit_notes dcn
JOIN stakeholders s ON s.id = dcn.stakeholder_id
    WHERE dcn.error = 'NO ERRORS'
    ${whereConditions}
    ${paginationSubquery}
    ORDER BY dcn.id DESC
  `
}

module.exports.getDebitCreditNotesCount = (fields = {}) => `
  SELECT COUNT(*) AS total
  FROM documents_debit_credit_notes dcn
  JOIN stakeholders s ON s.id = dcn.stakeholder_id
  WHERE dcn.error = 'NO ERRORS'
  ${buildDebitCreditNotesWhere(stripPaginationFields(fields))};
`

module.exports.getDebitCreditNotesSummary = (fields = {}) => `
  SELECT
    COUNT(*) AS total_notes,
    COALESCE(SUM(CASE WHEN dcn.document_type = 'DEBITO' THEN 1 ELSE 0 END), 0) AS debit_count,
    COALESCE(SUM(CASE WHEN dcn.document_type = 'CREDITO' THEN 1 ELSE 0 END), 0) AS credit_count
  FROM documents_debit_credit_notes dcn
  JOIN stakeholders s ON s.id = dcn.stakeholder_id
  WHERE dcn.error = 'NO ERRORS'
  ${buildDebitCreditNotesWhere(stripPaginationFields(fields))};
`

module.exports.stripPaginationFields = stripPaginationFields
