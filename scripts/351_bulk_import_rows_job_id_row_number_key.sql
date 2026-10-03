alter table public.bulk_import_rows
  add constraint bulk_import_rows_job_id_row_number_key unique (job_id, row_number);
