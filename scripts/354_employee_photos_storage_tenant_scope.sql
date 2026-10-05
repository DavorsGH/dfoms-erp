UPDATE storage.buckets
SET public = false
WHERE id = 'employee-photos';

DROP POLICY IF EXISTS public_read_employee_photos ON storage.objects;

DROP POLICY IF EXISTS authenticated_upload_employee_photos ON storage.objects;
CREATE POLICY authenticated_upload_employee_photos
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'employee-photos'
    AND (storage.foldername(name))[1] = (SELECT current_user_tenant_id()::text)
  );

DROP POLICY IF EXISTS authenticated_update_employee_photos ON storage.objects;
CREATE POLICY authenticated_update_employee_photos
  ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'employee-photos'
    AND (storage.foldername(name))[1] = (SELECT current_user_tenant_id()::text)
  )
  WITH CHECK (
    bucket_id = 'employee-photos'
    AND (storage.foldername(name))[1] = (SELECT current_user_tenant_id()::text)
  );

DROP POLICY IF EXISTS authenticated_read_employee_photos ON storage.objects;
CREATE POLICY authenticated_read_employee_photos
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'employee-photos'
    AND (storage.foldername(name))[1] = (SELECT current_user_tenant_id()::text)
  );

DROP POLICY IF EXISTS authenticated_delete_employee_photos ON storage.objects;
CREATE POLICY authenticated_delete_employee_photos
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'employee-photos'
    AND (storage.foldername(name))[1] = (SELECT current_user_tenant_id()::text)
  );
