-- Collectible redeems (POST /api/member-portal/collectibles/redeem) insert
-- avatars with acquisition_source 'entitlement', as wallpapers do. The avatar
-- check never listed it, so every avatar redeem rolled back with a 500.
ALTER TABLE crm.crm_member_avatar_inventory
    DROP CONSTRAINT IF EXISTS crm_member_avatar_inventory_source_check;

ALTER TABLE crm.crm_member_avatar_inventory
    ADD CONSTRAINT crm_member_avatar_inventory_source_check
    CHECK (acquisition_source = ANY (ARRAY['redemption', 'campaign', 'manual', 'migration', 'partner', 'entitlement']));
