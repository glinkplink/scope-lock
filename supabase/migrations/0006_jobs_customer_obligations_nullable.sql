-- App-required fields (validated in AgreementPreview): customer_name, job_location,
-- asset_or_item_description, requested_work, job_type, price, price_type.
-- user_id stays NOT NULL (FK / RLS). Everything else on jobs is optional at DB level.

ALTER TABLE jobs ALTER COLUMN customer_obligations DROP NOT NULL;

ALTER TABLE jobs ALTER COLUMN customer_phone DROP NOT NULL;

ALTER TABLE jobs ALTER COLUMN materials_provided_by DROP NOT NULL;

ALTER TABLE jobs ALTER COLUMN installation_included DROP NOT NULL;
ALTER TABLE jobs ALTER COLUMN grinding_included DROP NOT NULL;
ALTER TABLE jobs ALTER COLUMN paint_or_coating_included DROP NOT NULL;
ALTER TABLE jobs ALTER COLUMN removal_or_disassembly_included DROP NOT NULL;
ALTER TABLE jobs ALTER COLUMN hidden_damage_possible DROP NOT NULL;
ALTER TABLE jobs ALTER COLUMN deposit_required DROP NOT NULL;
ALTER TABLE jobs ALTER COLUMN change_order_required DROP NOT NULL;
