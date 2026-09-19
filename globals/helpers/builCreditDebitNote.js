const isDevelop = false

const emisorFact = isDevelop ? 'CABISA_DEMO' : 'CABISA, SOCIEDAD ANONIMA'
const nit = isDevelop ? '92000000359K' : '53982746'

const buildCreditDebitNote = (data, moment) => {
  //BUILD XML HEADER
  let xml_header = headerInvoice(data, moment)
  let xml_details = ``
  let totalTaxAmount = 0
  let grandTotal = 0

  data.invoice.items.forEach(x => {
    let price_ = x.payment_amount * x.payment_qty
    let taxableAmount = (price_ - 0) / 1.12
    let taxAmount = taxableAmount * 0.12
    let total = price_ - 0

    totalTaxAmount += taxAmount
    grandTotal += total

    console.log('DATA DEBIT/CREDIT NOTE >> ', x)

    let str = `
      <dte:Item BienOServicio="B" NumeroLinea="1">
        <dte:Cantidad>${x.payment_qty.toFixed(2)}</dte:Cantidad>
        <dte:UnidadMedida>UND</dte:UnidadMedida>
        <dte:Descripcion>${x.payment_code}|${x.description}</dte:Descripcion>        
        <dte:PrecioUnitario>${x.payment_amount.toFixed(2)}</dte:PrecioUnitario>
        <dte:Precio>${price_.toFixed(2)}</dte:Precio>
        <dte:Descuento>${0}</dte:Descuento>        
        <dte:Impuestos>
          <dte:Impuesto>
            <dte:NombreCorto>IVA</dte:NombreCorto>
            <dte:CodigoUnidadGravable>1</dte:CodigoUnidadGravable>
            <dte:MontoGravable>${taxableAmount.toFixed(2)}</dte:MontoGravable>
            <dte:MontoImpuesto>${taxAmount.toFixed(2)}</dte:MontoImpuesto>
          </dte:Impuesto>
        </dte:Impuestos>
        <dte:Total>${total.toFixed(2)}</dte:Total>        
      </dte:Item>
    `

    xml_details = xml_details + str
  })

  let xmlBody = `<dte:Items>${xml_details}</dte:Items>`
  console.log('')
  let xmlComplemento = `
  <dte:Complementos>
  <dte:Complemento IDComplemento="TEXT" NombreComplemento="TEXT" URIComplemento="TEXT">
  <cno:ReferenciasNota xmlns:cno="http://www.sat.gob.gt/face2/ComplementoReferenciaNota/0.1.0" FechaEmisionDocumentoOrigen="${data.invoice.fechaEmisionDocumentoOrigen}" MotivoAjuste="${data.invoice.motivoAjuste}" NumeroAutorizacionDocumentoOrigen="${data.invoice.numeroAutorizacionDocumentoOrigen}" NumeroDocumentoOrigen="${data.invoice.numeroDocumentoOrigen}" SerieDocumentoOrigen="${data.invoice.serieDocumentoOrigen}" Version="0.0" xsi:schemaLocation="http://www.sat.gob.gt/face2/ComplementoReferenciaNota/0.1.0 C:\Users\User\Desktop\FEL\Esquemas\GT_Complemento_Referencia_Nota-0.1.0.xsd"></cno:ReferenciasNota>
  </dte:Complemento>
</dte:Complementos>
  `

  let xmlTotales = `
      <dte:Totales>
        <dte:TotalImpuestos>
          <dte:TotalImpuesto NombreCorto="IVA" TotalMontoImpuesto="${totalTaxAmount.toFixed(2)}"></dte:TotalImpuesto>
        </dte:TotalImpuestos>
        <dte:GranTotal>${grandTotal.toFixed(2)}</dte:GranTotal>
      </dte:Totales>
      ${xmlComplemento}
      </dte:DatosEmision>
    </dte:DTE>
  `

  let xmlDescription = `        
      </dte:SAT>
    </dte:GTDocumento>
  `

  let xml = xml_header + xmlBody + xmlTotales + xmlDescription
  xml = xml.replace(/\n/g, '')
  return xml
}

const headerInvoice = (data, moment) => {
  let headerStructure = `
  <dte:GTDocumento xmlns:ds="http://www.w3.org/2000/09/xmldsig#" xmlns:dte="http://www.sat.gob.gt/dte/fel/0.2.0" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" Version="0.1" xsi:schemaLocation="http://www.sat.gob.gt/dte/fel/0.2.0">
    <dte:SAT ClaseDocumento="dte">
      <dte:DTE ID="DatosCertificados">
        <dte:DatosEmision ID="DatosEmision">
          <dte:DatosGenerales CodigoMoneda="GTQ" FechaHoraEmision="${moment().tz('America/Guatemala').format()}" Tipo="${data.invoice.documentType}"></dte:DatosGenerales>          
          <dte:Emisor AfiliacionIVA="GEN" CodigoEstablecimiento="1" CorreoEmisor="cabisarent@hotmail.com " NITEmisor="${nit}" NombreComercial="${emisorFact}" NombreEmisor="${emisorFact}">
            <dte:DireccionEmisor>
              <dte:Direccion>CALLE REAL ALDEA CONCEPCION COLMENAS CALLEJON 6, LOTE 06 Y 07</dte:Direccion>
              <dte:CodigoPostal>01051</dte:CodigoPostal>
              <dte:Municipio>Villa Canales</dte:Municipio>
              <dte:Departamento>GUATEMALA</dte:Departamento>
              <dte:Pais>GT</dte:Pais>
            </dte:DireccionEmisor>
          </dte:Emisor>

          <dte:Receptor CorreoReceptor="${data.client.email}" IDReceptor="${data.client.nit}" NombreReceptor="${replaceAmpersand(data.client.name)}">
            <dte:DireccionReceptor>
              <dte:Direccion>${data.client.address}</dte:Direccion>
              <dte:CodigoPostal>01001</dte:CodigoPostal>
              <dte:Municipio>GUATEMALA</dte:Municipio>
              <dte:Departamento>GUATEMALA</dte:Departamento>
              <dte:Pais>GT</dte:Pais>
            </dte:DireccionReceptor>
          </dte:Receptor>

          <dte:Frases> 
            <dte:Frase CodigoEscenario="3" TipoFrase="1" NumeroResolucion="446169202614222735" FechaResolucion="2026-09-16"></dte:Frase>
          </dte:Frases>
  `

  return headerStructure
}

const replaceAmpersand = str => {
  return str.replace(/&/g, '&#38;')
}

module.exports = buildCreditDebitNote
