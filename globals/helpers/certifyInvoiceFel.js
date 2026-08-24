const axios = require('axios')
const moment = require('moment-timezone')
const { v4: uuidv4 } = require('uuid')
const { formatFelFecha } = require('../common')
const { createFelLogDocument } = require('../commonStorage')
const buildXmlFcam = require('./buildInvoiceFcamXml')

const getFelLogTimestamp = (fecha, hasError) => {
  if (hasError) return ''

  return formatFelFecha(fecha) || ''
}

const certifyInvoiceFel = async ({ connection, cabisaDocumentId = null, billData, createdBy }) => {
  const xml = buildXmlFcam(billData, moment)

  const response = await axios.post(process.env.CERTIFIER_URL, xml, {
    headers: {
      UsuarioFirma: process.env.SIGNATURE_USER_SAT,
      LlaveFirma: process.env.SIGNATURE_KEY_SAT,
      UsuarioApi: process.env.API_USER_SAT,
      LlaveApi: process.env.API_KEY_SAT,
      identificador: `${process.env.IDENTIFIER_SAT}${uuidv4()}`,
    },
  })

  if (!response || !response.data) {
    throw new Error('The request to the SAT certification service has failed.')
  }

  const { data } = response
  const { cantidad_errores, serie, numero, xml_certificado, descripcion, uuid, fecha } = data
  const hasError = cantidad_errores > 0
  const felTimestamp = getFelLogTimestamp(fecha, hasError)

  await connection.query(createFelLogDocument(), [
    hasError ? '' : xml_certificado,
    xml,
    hasError ? 'ERROR' : 'NO ERRORS',
    JSON.stringify(data),
    hasError ? '' : numero,
    hasError ? '' : serie,
    createdBy,
    hasError ? '' : uuid,
    cabisaDocumentId,
    felTimestamp,
    felTimestamp,
  ])

  return {
    success: !hasError,
    data,
    message: hasError ? descripcion : 'SUCCESSFUL',
  }
}

module.exports = {
  certifyInvoiceFel,
  getFelLogTimestamp,
}
