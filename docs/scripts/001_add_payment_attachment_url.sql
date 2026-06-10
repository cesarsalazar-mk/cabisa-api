-- Agrega columna para URL del comprobante adjunto en pagos (Recibo de caja)
-- Ejecutar manualmente en la base de datos antes del deploy del backend

ALTER TABLE payments
  ADD COLUMN attachment_url TEXT NULL
  COMMENT 'URL publica del comprobante adjunto (S3)'
  AFTER description;

ALTER TABLE manual_payments_detail
  ADD COLUMN attachment_url TEXT NULL
  COMMENT 'URL publica del comprobante adjunto (S3)'
  AFTER description;
