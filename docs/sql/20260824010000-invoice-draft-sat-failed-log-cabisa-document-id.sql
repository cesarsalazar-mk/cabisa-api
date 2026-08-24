-- Estado SAT_FAILED para facturas con fallo de certificacion
-- Enlace log_documents -> documents.id (evita logs huerfanos)

ALTER TABLE documents
  MODIFY COLUMN status ENUM('PENDING', 'APPROVED', 'CANCELLED', 'SAT_FAILED')
    NOT NULL DEFAULT 'PENDING';

ALTER TABLE log_documents
  ADD COLUMN cabisa_document_id INT NULL AFTER uuid,
  ADD INDEX log_documents_cabisa_document_id_IDX (cabisa_document_id);

-- Opcional: backfill cabisa_document_id en logs existentes con match uuid
-- UPDATE log_documents ld
-- INNER JOIN documents d ON d.uuid = ld.uuid AND ld.uuid <> ''
-- SET ld.cabisa_document_id = d.id
-- WHERE ld.cabisa_document_id IS NULL;
