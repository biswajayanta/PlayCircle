-- Seeds the fixed dev user used by app/deps.py's get_current_user_id() stub.
-- Safe to re-run.

--INSERT INTO core.users (id, email, auth_provider, auth_provider_id, display_name)
--VALUES (
--    '00000000-0000-0000-0000-000000000001',
--    'dev@playcircle.local',
--    'dev',
--    'dev-seed-001',
--    'Dev User'
--)
--ON CONFLICT (id) DO NOTHING;

INSERT INTO core.users (id, email, auth_provider, auth_provider_id, display_name)
VALUES (
    '00000000-0000-0000-0000-000000000003',
    'dev@playcircle3.local',
    'dev',
    'dev-seed-003',
    'Dev User3'
)
ON CONFLICT (id) DO NOTHING;

--INSERT INTO social.profiles (user_id, bio, city, is_public)
--VALUES (
--    '00000000-0000-0000-0000-000000000001',
--    'Local development account seeded for testing.',
--    'Bengaluru',
--    true
--)
--ON CONFLICT (user_id) DO NOTHING;

INSERT INTO social.profiles (user_id, bio, city, is_public)
VALUES (
    '00000000-0000-0000-0000-000000000003',
    'Local development account seeded for testing.',
    'Bengaluru',
    true
)
ON CONFLICT (user_id) DO NOTHING;
