DROP INDEX log_documents_cabisa_document_id_IDX ON log_documents;

ALTER TABLE log_documents
  DROP COLUMN cabisa_document_id;

ALTER TABLE documents
  MODIFY COLUMN status ENUM('PENDING', 'APPROVED', 'CANCELLED')
    NOT NULL DEFAULT 'PENDING';
