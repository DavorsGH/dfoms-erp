-- Move-in condition photos per lease (separate from listing/marketing photos).
ALTER TABLE leases
  ADD COLUMN IF NOT EXISTS move_in_condition_photo_urls jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN leases.move_in_condition_photo_urls IS
  'Photo URLs documenting unit condition at lease move-in (Joint Inspection companion).';

-- Staff/landlord completion photos on resolved maintenance requests.
ALTER TABLE maintenance_requests
  ADD COLUMN IF NOT EXISTS completion_photo_urls jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN maintenance_requests.completion_photo_urls IS
  'After photos attached when staff or landlord marks the request completed.';
