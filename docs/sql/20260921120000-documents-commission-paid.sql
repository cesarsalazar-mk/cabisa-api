-- Marca de comision pagada al vendedor, por factura. NULL = comision no pagada.
-- commission_paid_amount congela el monto pagado (el reporte recalcula con el % actual del vendedor).
-- Ejecutar manualmente en MySQL.
ALTER TABLE documents
  ADD COLUMN commission_paid_at DATETIME NULL,
  ADD COLUMN commission_paid_amount DECIMAL(12,2) NULL,
  ADD COLUMN commission_paid_by INT NULL,
  ADD CONSTRAINT documents_commission_paid_by_fk FOREIGN KEY (commission_paid_by) REFERENCES users(id),
  ADD INDEX documents_commission_paid_at_IDX (commission_paid_at);

-- Rollback:
-- ALTER TABLE documents DROP FOREIGN KEY documents_commission_paid_by_fk, DROP INDEX documents_commission_paid_at_IDX,
--   DROP COLUMN commission_paid_by, DROP COLUMN commission_paid_amount, DROP COLUMN commission_paid_at;
