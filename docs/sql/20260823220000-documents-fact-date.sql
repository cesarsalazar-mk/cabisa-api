-- =============================================================================
-- documents.fact_date = fecha real de facturacion electronica (FEL)
-- Misma fecha que se guarda en log_documents.create_at (campo "fecha" del FEL)
-- Ejemplo FEL: 2026-08-23T21:54:09-06:00 → BD: 2026-08-23 21:54:09
-- Ejecutar manualmente en MySQL
-- =============================================================================

ALTER TABLE documents
  ADD COLUMN fact_date DATETIME NULL
  AFTER uuid;

-- Opcional: indice para filtrar por fecha FEL
CREATE INDEX documents_fact_date_IDX
  ON documents (fact_date);

-- =============================================================================
-- Rollback
-- =============================================================================
-- DROP INDEX documents_fact_date_IDX ON documents;
-- ALTER TABLE documents DROP COLUMN fact_date;
