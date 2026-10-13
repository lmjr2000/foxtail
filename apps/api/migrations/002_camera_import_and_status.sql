-- Real store/camera inventory from the EZCloud "Channel Management" export (the same file Eye of
-- Omni imports as "Foxtail / <store>" locations), plus per-camera online/offline status.

-- The recorder (EZCloud "Device") a store was imported from, so a later export updates it in place.
ALTER TABLE stores ADD COLUMN source_device_name TEXT;
ALTER TABLE stores ADD COLUMN recorder_model TEXT;
CREATE UNIQUE INDEX stores_source_device_key ON stores (lower(source_device_name)) WHERE source_device_name IS NOT NULL;

ALTER TABLE cameras ADD COLUMN source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'ezcloud'));
ALTER TABLE cameras ADD COLUMN external_id TEXT;
ALTER TABLE cameras ADD COLUMN model TEXT;
ALTER TABLE cameras ADD COLUMN serial_no TEXT;
-- Last known status: from the EZCloud export, or from Foxtail itself when it pulls a picture / video.
ALTER TABLE cameras ADD COLUMN status TEXT NOT NULL DEFAULT 'unknown' CHECK (status IN ('online', 'offline', 'unknown'));
ALTER TABLE cameras ADD COLUMN status_at TIMESTAMPTZ;
ALTER TABLE cameras ADD COLUMN status_source TEXT;
CREATE UNIQUE INDEX cameras_external_key ON cameras (external_id) WHERE external_id IS NOT NULL;
