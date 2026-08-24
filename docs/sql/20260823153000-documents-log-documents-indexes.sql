-- =============================================================================
-- Índices para cruce documents <-> log_documents
-- Ejecutar manualmente en MySQL (Guatemala / prod o staging)
--
-- Relación correcta:
--   documents.uuid = log_documents.uuid
--   documents.serie = log_documents.serie
--     AND documents.document_number = log_documents.document_id
--
-- NOTA: log_documents.document_id guarda el numero FEL, NO documents.id
-- =============================================================================

-- log_documents
CREATE INDEX log_documents_uuid_IDX
  ON log_documents (uuid);

CREATE INDEX log_documents_serie_document_id_IDX
  ON log_documents (serie, document_id);

CREATE INDEX log_documents_create_at_IDX
  ON log_documents (create_at);

-- documents
CREATE INDEX documents_uuid_IDX
  ON documents (uuid);

CREATE INDEX documents_serie_document_number_IDX
  ON documents (serie, document_number(100));

CREATE INDEX documents_type_updated_IDX
  ON documents (document_type, updated_at);

-- =============================================================================
-- Rollback (ejecutar solo si necesitas revertir)
-- =============================================================================
-- DROP INDEX documents_type_updated_IDX ON documents;
-- DROP INDEX documents_serie_document_number_IDX ON documents;
-- DROP INDEX documents_uuid_IDX ON documents;
-- DROP INDEX log_documents_create_at_IDX ON log_documents;
-- DROP INDEX log_documents_serie_document_id_IDX ON log_documents;
-- DROP INDEX log_documents_uuid_IDX ON log_documents;
