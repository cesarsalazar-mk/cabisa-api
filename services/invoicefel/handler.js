const { mysqlConfig, helpers } = require(`${process.env['FILE_ENVIRONMENT']}/globals`)
const axios = require(`axios`)
const moment = require(`moment-timezone`)
const mysql = require(`mysql2/promise`)
const xml2js = require('xml2js')
const { v4: uuidv4 } = require(`uuid`)
const { buildXml, buildXmlFcam, handleRequest, handleResponse, handleRead, buidCancelXml, buildCreditDebitNote, certifyInvoiceFel, getFelLogTimestamp } = helpers
const { createInvoiceFelLogDocument, findByDocumentId, parseToJson, createDebitCreditLogDocument, getDebitCreditNotes, getDebitCreditNotesCount, getDebitCreditNotesSummary, stripPaginationFields } = require('./storage')
const db = mysqlConfig(mysql)

module.exports.create = async (event, context) => {
  try {
    const { body } = await handleRequest({ event })

    if (!body) throw new Error('Missing body')

    const xml = buildXml(body, moment)

    const response = await axios.post(process.env.CERTIFIER_URL, xml, {
      headers: {
        UsuarioFirma: process.env.SIGNATURE_USER_SAT,
        LlaveFirma: process.env.SIGNATURE_KEY_SAT,
        UsuarioApi: process.env.API_USER_SAT,
        LlaveApi: process.env.API_KEY_SAT,
        identificador: `${process.env.IDENTIFIER_SAT}${uuidv4()}`,
      },
    })

    if (!response && !response.data) throw new Error('The request to the SAT certification service has failed.')

    const { data } = response
    const { cantidad_errores, serie, numero, xml_certificado, descripcion, uuid, fecha } = data
    const hasError = cantidad_errores > 0
    const felTimestamp = getFelLogTimestamp(fecha, hasError)

    const dbValues = [
      hasError ? '' : xml_certificado,
      xml,
      hasError ? 'ERROR' : 'NO ERRORS',
      JSON.stringify(data),
      hasError ? '' : numero,
      hasError ? '' : serie,
      body.invoice.created_by,
      hasError ? '' : uuid,
      body.cabisa_document_id || null,
      felTimestamp,
      felTimestamp,
    ]

    const res = await db.transaction(async connection => {
      await connection.query(createInvoiceFelLogDocument(), dbValues, false)      
      return { statusCode: 201, data, message:  (cantidad_errores > 0 ? descripcion :'SUCCESSFUL') }
    })

    return await handleResponse({ req: {}, res })
  } catch (error) {
    console.log('invoicefel Errors', error)
    return await handleResponse({ error })
  }
}

module.exports.getDocument = async (event, context) => {    
  try{
    let xml_response = null
    const req = await handleRequest({ event })        
    const documentId = req.queryStringParameters.id      
    const res = await db.transaction(async connection => {
      let datadata = await connection.query(findByDocumentId(documentId))
      xml_response = (datadata[0].length > 0 ? datadata[0][0]: {})
      return { statusCode: 200, data: (datadata[0].length > 0 ? datadata[0][0]: {}) , message: 'SUCCESSFUL' }
    })    
    
    //responseto xml certificated to Json
    var encodedStringAtoB = xml_response.response_pdf
    var b = Buffer.from(encodedStringAtoB, 'base64')
    var xml_string = b.toString();
    const json = await parseToJson(xml_string, xml2js)
    res.data.xml_certificado = {
      uuid:json["dte:GTDocumento"]["dte:SAT"][0]["dte:DTE"][0]["dte:Certificacion"][0]["dte:NumeroAutorizacion"][0]["_"],
      fecha_certificacion: json["dte:GTDocumento"]["dte:SAT"][0]["dte:DTE"][0]["dte:Certificacion"][0]["dte:FechaHoraCertificacion"][0]
    }
    return await handleResponse({ req, res })

  }catch(error){
    console.log('invoicefel get document Error', error)
    return await handleResponse({ error })
  }
}

module.exports.cancelDocument = async (event,context) => {
  
  try {
    
    const { body } = await handleRequest({ event })
    if (!body) throw new Error('Missing body')
        
    const xml = buidCancelXml(body, moment)   
    
    const response = await axios.post(process.env.CERTIFIER_URL, xml, {
      headers: {
        UsuarioFirma: process.env.SIGNATURE_USER_SAT,
        LlaveFirma: process.env.SIGNATURE_KEY_SAT,
        UsuarioApi: process.env.API_USER_SAT,
        LlaveApi: process.env.API_KEY_SAT        
      },
    })
    
    if (!response && !response.data) throw new Error('The request to cancel the SAT certification service has failed.')

    const { data } = response
    const { cantidad_errores, serie, numero, xml_certificado, descripcion, uuid, fecha } = data
    const hasError = cantidad_errores > 0
    const felTimestamp = getFelLogTimestamp(fecha, hasError)

    const dbValues = [
      hasError ? '' : xml_certificado,
      xml,
      hasError ? 'ERROR' : 'CORRECT CANCELLATION',
      JSON.stringify(data),
      hasError ? '' : numero,
      hasError ? '' : serie,
      body.created_by,
      hasError ? '' : uuid,
      body.cabisa_document_id || null,
      felTimestamp,
      felTimestamp,
    ]

    const res = await db.transaction(async connection => {
      await connection.query(createInvoiceFelLogDocument(), dbValues, false)      
      return { statusCode: 201, data, message:  (cantidad_errores > 0 ? descripcion :'SUCCESSFUL') }
    })

    return await handleResponse({ req: {}, res })

  } catch (error) {
    console.log('invoicefel Errors', error)
    return await handleResponse({ error })
  }

}

module.exports.createFactCam = async (event, context) => {
  try {
    const { body } = await handleRequest({ event })

    if (!body) throw new Error('Missing body')

    const res = await db.transaction(async connection => {
      const result = await certifyInvoiceFel({
        connection,
        cabisaDocumentId: body.cabisa_document_id || null,
        billData: body,
        createdBy: body.invoice.created_by,
      })

      return {
        statusCode: result.success ? 201 : 400,
        data: result.data,
        message: result.message,
      }
    })

    return await handleResponse({ req: {}, res })
  } catch (error) {
    console.log('invoicefel Errors', error)
    return await handleResponse({ error })
  }
}

module.exports.createDebitCreditNote = async (event, context) => {
  try {
    const { body } = await handleRequest({ event })

    if (!body) throw new Error('Missing body')

    const xml = buildCreditDebitNote(body, moment)
        
    const response = await axios.post(process.env.CERTIFIER_URL, xml, {
      headers: {
        UsuarioFirma: process.env.SIGNATURE_USER_SAT,
        LlaveFirma: process.env.SIGNATURE_KEY_SAT,
        UsuarioApi: process.env.API_USER_SAT,
        LlaveApi: process.env.API_KEY_SAT,
        identificador: `${process.env.IDENTIFIER_SAT}${uuidv4()}`,
      },
    })

    if (!response && !response.data) throw new Error('The request to the SAT certification service has failed.')

    const { data } = response
    const { cantidad_errores, serie, numero, xml_certificado,descripcion,uuid } = data
    
    const dbValues = [
      body.invoice.documentType === "NDEB" ? "DEBITO" : "CREDITO",
      body.client.id,
      body.invoice.numeroDocumentoOrigen,
      body.invoice.numeroAutorizacionDocumentoOrigen,
      body.invoice.serieDocumentoOrigen,
      body.invoice.motivoAjuste,
      cantidad_errores > 0 ? '' : xml_certificado,
      xml,
      cantidad_errores > 0 ? 'ERROR' : 'NO ERRORS',
      JSON.stringify(data),      
      cantidad_errores > 0 ? '' : serie,
      cantidad_errores > 0 ? '' : uuid,
      cantidad_errores > 0 ? '' : numero,
      body.invoice.created_by,
      JSON.stringify(body),
    ]

    const res = await db.transaction(async connection => {
      
      await connection.query(createDebitCreditLogDocument(), dbValues, false)      
      
      return { statusCode: 201, data, message:  (cantidad_errores > 0 ? descripcion :'SUCCESSFUL') }
    })

    return await handleResponse({ req: {}, res })
  } catch (error) {
    console.log('creditDebitNote Errors', error)
    return await handleResponse({ error })
  }
}

module.exports.getDocumentDebitCreditNote = async (event, context) => {    
  try {        
    const req = await handleRequest({ event })
    const res = await handleRead(req, { dbQuery: db.query, storage: getDebitCreditNotes })

    const filterFields = stripPaginationFields(req.query)
    const summaryRows = await db.query(getDebitCreditNotesSummary(filterFields))
    const countResult = await db.query(getDebitCreditNotesCount(req.query))

    const summaryRow = summaryRows[0] || {}
    const toNumber = value => Number(value) || 0

    return await handleResponse({
      req,
      res: {
        statusCode: 200,
        data: {
          items: res.data,
          summary: {
            total_notes: toNumber(summaryRow.total_notes),
            debit_count: toNumber(summaryRow.debit_count),
            credit_count: toNumber(summaryRow.credit_count),
          },
          pagination: { total: toNumber(countResult[0]?.total) },
        },
      },
    })
  } catch (error) {
    console.log(error)
    return await handleResponse({ error })
  }
}
