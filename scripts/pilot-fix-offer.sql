UPDATE tenants SET offer_accepted_at = CAST(strftime('%s','now') AS INTEGER) * 1000, offer_version = '2026-07-11', offer_accepted_phone = '+74951000001' WHERE slug = 'sto-1';
UPDATE tenants SET offer_accepted_at = CAST(strftime('%s','now') AS INTEGER) * 1000, offer_version = '2026-07-11', offer_accepted_phone = '+74951000002' WHERE slug = 'sto-2';
UPDATE tenants SET offer_accepted_at = CAST(strftime('%s','now') AS INTEGER) * 1000, offer_version = '2026-07-11', offer_accepted_phone = '+74951000003' WHERE slug = 'sto-3';
SELECT slug, offer_version, offer_accepted_at FROM tenants WHERE slug IN ('sto-1','sto-2','sto-3');
