const isDevelop = false
const emisorFact = isDevelop ? 'CABISA_DEMO' : 'CABISA, SOCIEDAD ANONIMA'
const nit = isDevelop ? '92000000359K' : '53982746'

const buildXml = (data, moment) => {
  //BUILD XML HEADER
  let xml_header = headerInvoice(data, moment)
  let xml_details = ``
  let totalTaxAmount = 0
  let grandTotal = 0

  data.invoice.items.forEach(x => {
    
    let price_ = x.price * x.quantity
    let taxableAmount = (price_ - x.discount) / 1.12
    let taxAmount = taxableAmount * 0.12
    let total = price_ - x.discount

    totalTaxAmount += taxAmount
    grandTotal += total
    console.log("data >> ",x)
    
    let str = `
    <dte:Item BienOServicio="${x.type === "SERVICE" ? "S" : "B" }" NumeroLinea="1">
        <dte:Cantidad>${x.quantity.toFixed(2)}</dte:Cantidad>
        <dte:UnidadMedida>UND</dte:UnidadMedida>
        <dte:Descripcion>${x.code}|${x.description}${data.invoice.observations ? ` - ${data.invoice.observations}` : ''}</dte:Descripcion>
        <dte:PrecioUnitario>${x.price.toFixed(2)}</dte:PrecioUnitario>
        <dte:Precio>${(price_).toFixed(2)}</dte:Precio>
        <dte:Descuento>${x.discount.toFixed(2)}</dte:Descuento>        
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

  let xmlTotales = `
      <dte:Totales>
        <dte:TotalImpuestos>
          <dte:TotalImpuesto NombreCorto="IVA" TotalMontoImpuesto="${totalTaxAmount.toFixed(2)}"></dte:TotalImpuesto>
        </dte:TotalImpuestos>
        <dte:GranTotal>${grandTotal.toFixed(2)}</dte:GranTotal>
      </dte:Totales>
      </dte:DatosEmision>
    </dte:DTE>
  `

  let xmlDescription = `
        <dte:Adenda>
          <Codigo_cliente>C01</Codigo_cliente>
          <Observaciones>${'sin observaciones'}</Observaciones>
        </dte:Adenda>
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
          <dte:DatosGenerales CodigoMoneda="GTQ" FechaHoraEmision="${moment().tz('America/Guatemala').format()}" Tipo="FACT"></dte:DatosGenerales>
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
            <dte:Frase CodigoEscenario="2" TipoFrase="1"></dte:Frase>
          </dte:Frases>
  `

  return headerStructure
}

const replaceAmpersand = (str) => {
  return str.replace(/&/g, '&#38;');
};

module.exports = buildXml
