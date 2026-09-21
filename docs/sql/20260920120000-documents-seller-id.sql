-- Vendedor asociado a la factura (solo filas SELL_INVOICE / RENT_INVOICE). NULL en facturas anteriores.
-- Requiere la tabla sellers (20260919120000-sellers.sql). Ejecutar manualmente en MySQL.
ALTER TABLE documents
  ADD COLUMN seller_id INT NULL AFTER stakeholder_id,
  ADD CONSTRAINT documents_seller_id_fk FOREIGN KEY (seller_id) REFERENCES sellers(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  ADD INDEX documents_seller_id_IDX (seller_id);

-- Rollback:
-- ALTER TABLE documents DROP FOREIGN KEY documents_seller_id_fk, DROP INDEX documents_seller_id_IDX, DROP COLUMN seller_id;
