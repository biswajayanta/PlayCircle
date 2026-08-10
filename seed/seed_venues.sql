-- Run against playcircle_dev. Safe to re-run — checks for existing rows
-- before inserting rather than relying on a unique constraint, since
-- core.sports.name isn't actually declared unique.

INSERT INTO core.sports (name)
SELECT 'pickleball'
WHERE NOT EXISTS (SELECT 1 FROM core.sports WHERE name = 'pickleball');

INSERT INTO core.venues (sport_id, name, address, city, latitude, longitude)
SELECT s.id, v.name, v.address, v.city, v.latitude, v.longitude
FROM core.sports s
CROSS JOIN (
    VALUES
        ('HSR Layout Pickleball Courts', 'HSR Layout Sector 2', 'Bengaluru', 12.9116, 77.6389),
        ('Koramangala Sports Complex', '80 Feet Road', 'Bengaluru', 12.9352, 77.6245),
        ('Indiranagar Pickleball Club', '100 Feet Road', 'Bengaluru', 12.9719, 77.6412)
) AS v(name, address, city, latitude, longitude)
WHERE s.name = 'pickleball'
  AND NOT EXISTS (
      SELECT 1 FROM core.venues existing WHERE existing.name = v.name
  );

-- Verify:
SELECT v.id, v.name, v.city, s.name AS sport
FROM core.venues v
JOIN core.sports s ON s.id = v.sport_id;
