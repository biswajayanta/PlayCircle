-- ============================================================
-- SEED: sample venues for local dev/testing
-- Adjust city/coordinates to match wherever you'll actually be
-- testing "find a game near me" later.
-- ============================================================

INSERT INTO core.venues (sport_id, name, address, city, latitude, longitude)
SELECT id, 'HSR Layout Pickleball Courts', 'HSR Layout', 'Bengaluru', 12.9116, 77.6389
FROM core.sports WHERE code = 'pickleball'
ON CONFLICT DO NOTHING;

INSERT INTO core.venues (sport_id, name, address, city, latitude, longitude)
SELECT id, 'Kudlu Pickleball Arena', 'Kudlu', 'Bengaluru', 12.8858, 77.6486
FROM core.sports WHERE code = 'pickleball'
ON CONFLICT DO NOTHING;
