INSERT INTO hotspots (name, location, type, moisture_score, tags)
VALUES
  (
    'Northwest Park & Open Space',
    ST_SetSRID(ST_MakePoint(-72.7029813, 41.9054657), 4326)::geography,
    'nature_reserve',
    91,
    '{"natural":"wood","near_water":true,"source":"OpenStreetMap Nominatim"}'::jsonb
  ),
  (
    'Keney Park',
    ST_SetSRID(ST_MakePoint(-72.6841144, 41.7968252), 4326)::geography,
    'nature_reserve',
    84,
    '{"leisure":"park","natural":"wood","source":"OpenStreetMap Nominatim"}'::jsonb
  ),
  (
    'Elizabeth Park',
    ST_SetSRID(ST_MakePoint(-72.7182533, 41.7745278), 4326)::geography,
    'park',
    77,
    '{"leisure":"park","shade":"mixed","source":"OpenStreetMap Nominatim"}'::jsonb
  )
ON CONFLICT DO NOTHING;
