DROP INDEX documents_type_updated_IDX ON documents;
DROP INDEX documents_serie_document_number_IDX ON documents;
DROP INDEX documents_uuid_IDX ON documents;

DROP INDEX log_documents_create_at_IDX ON log_documents;
DROP INDEX log_documents_serie_document_id_IDX ON log_documents;
DROP INDEX log_documents_uuid_IDX ON log_documents;
