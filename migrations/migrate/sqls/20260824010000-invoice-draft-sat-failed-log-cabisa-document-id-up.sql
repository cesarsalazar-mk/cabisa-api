ALTER TABLE documents
  MODIFY COLUMN status ENUM('PENDING', 'APPROVED', 'CANCELLED', 'SAT_FAILED')
    NOT NULL DEFAULT 'PENDING';

ALTER TABLE log_documents
  ADD COLUMN cabisa_document_id INT NULL AFTER uuid,
  ADD INDEX log_documents_cabisa_document_id_IDX (cabisa_document_id);
