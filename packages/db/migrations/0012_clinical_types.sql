-- Clínica en tres categorías: analíticas (lab), pruebas (holter, stress_test, ecg, imaging,
-- other_test) e informes (report: lesión, consulta, alta...). Lo que era 'other' pasa a 'report'.
alter table clinical_documents drop constraint clinical_documents_type_check;
update clinical_documents set type = 'report' where type = 'other';
update clinical_documents
  set extraction = jsonb_set(extraction, '{type}', '"report"')
  where extraction ->> 'type' = 'other';
alter table clinical_documents add constraint clinical_documents_type_check
  check (type in ('lab', 'holter', 'stress_test', 'ecg', 'imaging', 'other_test', 'report'));

-- El día desde el que se subió (Hoy → Registrar): si el informe no trae fecha, se usa este
alter table clinical_documents add column requested_date date;
