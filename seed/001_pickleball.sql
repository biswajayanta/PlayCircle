-- ============================================================
-- SEED: pickleball sport config for MVP development
-- ============================================================

INSERT INTO core.sports (code, name, indoor_outdoor, min_players, max_players, scoring_config, calorie_coefficient)
VALUES (
    'pickleball',
    'Pickleball',
    'both',
    2,
    4,
    '{
        "win_score": 11,
        "win_by": 2,
        "best_of": 3,
        "serve_rule": "side_out"
    }'::jsonb,
    7.0   -- rough calories/minute multiplier baseline, tune later
)
ON CONFLICT (code) DO NOTHING;
