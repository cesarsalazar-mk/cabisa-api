const isDevelop = false
const emisorFact = isDevelop ? 'CABISA_DEMO' : 'CABISA, SOCIEDAD ANONIMA'
const nit = isDevelop ? '92000000359K' : '53982746'

const buildXmlFcam = (data, moment) => {
  //BUILD XML HEADER
  let xml_header = headerInvoice(data, moment)
  let xml_details = ``
  let totalTaxAmount = 0
  let grandTotal = 0
  let creditDate = getCreditDays(data.invoice.credit_days,moment)

  data.invoice.items.forEach(x => {
    
    let price_ = x.price * x.quantity
    let taxableAmount = (price_ - x.discount) / 1.12
    let taxAmount = taxableAmount * 0.12
    let total = price_ - x.discount

    totalTaxAmount += taxAmount
    grandTotal += total
    console.log("data fact cam >> ",x)
    
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

  let xmlComplemento = `
  <dte:Complementos>
  <dte:Complemento IDComplemento="TEXT" NombreComplemento="TEXT" URIComplemento="TEXT">
    <cfc:AbonosFacturaCambiaria xmlns:cfc="http://www.sat.gob.gt/dte/fel/CompCambiaria/0.1.0" Version="1" xsi:schemaLocation="http://www.sat.gob.gt/dte/fel/CompCambiaria/0.1.0 C:\Users\Desktop\SAT_FEL_FINAL_V1\Esquemas\GT_Complemento_Cambiaria-0.1.0.xsd">
      <cfc:Abono>
        <cfc:NumeroAbono>1</cfc:NumeroAbono>
        <cfc:FechaVencimiento>${creditDate}</cfc:FechaVencimiento>
        <cfc:MontoAbono>${grandTotal.toFixed(2)}</cfc:MontoAbono>
      </cfc:Abono>
    </cfc:AbonosFacturaCambiaria>
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
          <dte:DatosGenerales CodigoMoneda="GTQ" FechaHoraEmision="${moment().tz('America/Guatemala').format()}" Tipo="FCAM"></dte:DatosGenerales>
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

const getCreditDays = (creditDays,moment) => {
  console.log("creditDays >> ",creditDays)
  switch (creditDays) {
    case 7:
      return moment().add(7, 'days').tz('America/Guatemala').format('YYYY-MM-DD')
    case 15:
      return moment().add(15, 'days').tz('America/Guatemala').format('YYYY-MM-DD')
    default:
      return moment().add(1, 'months').tz('America/Guatemala').format('YYYY-MM-DD')
  }
}

module.exports = buildXmlFcam
