-- Indexes to speed up joins between documents and log_documents.
-- log_documents.document_id stores the FEL document number (numero), not documents.id.
-- Preferred join: documents.uuid = log_documents.uuid
-- Alternative: documents.serie = log_documents.serie AND documents.document_number = log_documents.document_id

CREATE INDEX log_documents_uuid_IDX
  ON log_documents (uuid);

CREATE INDEX log_documents_serie_document_id_IDX
  ON log_documents (serie, document_id);

CREATE INDEX log_documents_create_at_IDX
  ON log_documents (create_at);

CREATE INDEX documents_uuid_IDX
  ON documents (uuid);

CREATE INDEX documents_serie_document_number_IDX
  ON documents (serie, document_number(100));

CREATE INDEX documents_type_updated_IDX
  ON documents (document_type, updated_at);
