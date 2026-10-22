-- The world is divided into provinces. Each province has exactly one city and a record of
-- which country/tribe/empire occupied it during which years.

CREATE TABLE province (
  id              TEXT PRIMARY KEY,     -- 'p0001'... ordered north->south, west->east
  city_name       TEXT NOT NULL,        -- the province's one city (current name)
  city_lat        REAL NOT NULL,
  city_lon        REAL NOT NULL,
  city_wikidata_id TEXT,                -- QID when known
  -- 'inside' = a populated place within the province; 'listed' = hand-listed capital/county town
  -- (historic counties of Britain and Ireland, Dutch and Belgian provinces); 'capital' = the division's administrative capital from Wikidata;
  -- 'nearest' = the province had no town (arctic,
  -- desert, remote ocean) so it borrows the closest unclaimed place.
  city_source     TEXT NOT NULL CHECK (city_source IN ('inside', 'listed', 'capital', 'nearest')),
  seed_lat        REAL NOT NULL,        -- Voronoi seed the province boundary grew from
  seed_lon        REAL NOT NULL,
  area_km2        INTEGER NOT NULL,     -- land area
  country         TEXT NOT NULL,        -- present-day country the province lies in
  continent       TEXT NOT NULL,        -- Africa, Asia, Europe, North America, South America or Oceania
  region          TEXT NOT NULL         -- present-day state/province/department it follows (the country name where the country is divided freely)
);

-- Anything that can occupy a province: an empire, a state, a tribe or culture. Names are as
-- they appear in the historical-basemaps border data.
CREATE TABLE occupier (
  id    TEXT PRIMARY KEY,               -- slug
  name  TEXT NOT NULL UNIQUE,
  color TEXT NOT NULL,                  -- hex, deterministic from the name
  -- 0 for peoples, cultures and generic labels ("Bantu", "Thai", "hunter-gatherers", "Hindu
  -- kingdoms"): they paint on the map but were not nations, so the game can't link through them.
  -- Classified by scripts/provinces/non-nations.json.
  is_nation INTEGER NOT NULL DEFAULT 1
);

-- occupier held province from start_year to end_year (inclusive; NULL = still ongoing).
-- Derived from border snapshots: a snapshot at year Y holds until the next snapshot, so
-- boundaries are only as precise as the snapshot spacing (see eras.mjs).
CREATE TABLE occupation (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  province_id TEXT NOT NULL REFERENCES province(id),
  occupier_id TEXT NOT NULL REFERENCES occupier(id),
  start_year  INTEGER NOT NULL,
  end_year    INTEGER,
  CHECK (end_year IS NULL OR start_year <= end_year)
);
CREATE INDEX idx_occupation_province ON occupation(province_id);
CREATE INDEX idx_occupation_occupier ON occupation(occupier_id);
CREATE INDEX idx_occupation_range ON occupation(start_year, end_year);

-- Colonies and dependencies roll up to their parent realm, for linking provinces in the game only:
-- while overlord_id's realm held occupier_id as a colony/dependency (start..end, inclusive), a
-- province held by occupier_id also counts as held by overlord_id. Also joins a realm's names
-- (England -> United Kingdom). Computed from scripts/provinces/overlords.json, chained transitively.
CREATE TABLE realm_link (
  occupier_id TEXT NOT NULL REFERENCES occupier(id),
  overlord_id TEXT NOT NULL REFERENCES occupier(id),
  start_year  INTEGER NOT NULL,
  end_year    INTEGER NOT NULL,
  -- 'subject' = colony / dependency / puppet / occupied zone; 'member' = the same state under another
  -- name (England -> United Kingdom). Subjects are drawn as a lighter shade of their overlord.
  kind        TEXT NOT NULL DEFAULT 'subject' CHECK (kind IN ('subject', 'member'))
);
CREATE INDEX idx_realm_link_occupier ON realm_link(occupier_id);
