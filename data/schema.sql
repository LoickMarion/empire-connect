-- Cities: only lat/lon + existence range are physically stable facts.
CREATE TABLE city (
  id             TEXT PRIMARY KEY,     -- internal slug, derived at import time
  lat            REAL NOT NULL,
  lon            REAL NOT NULL,
  founded_year   INTEGER,              -- signed year, NULL = unknown/prehistoric
  dissolved_year INTEGER,              -- signed year, NULL = still exists today
  wikidata_id    TEXT NOT NULL UNIQUE  -- QID of the most recent item in the merge chain
);

-- Name history: every name a city has carried, time-ranged.
CREATE TABLE city_name (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  city_id       TEXT NOT NULL REFERENCES city(id),
  name          TEXT NOT NULL,
  start_year    INTEGER NOT NULL,     -- inclusive
  end_year      INTEGER,              -- inclusive; NULL = current/ongoing name
  UNIQUE(city_id, start_year)
);
CREATE INDEX idx_city_name_city ON city_name(city_id);

-- Empires: real entities now, not free strings.
CREATE TABLE empire (
  id           TEXT PRIMARY KEY,     -- internal slug
  name         TEXT NOT NULL,
  color        TEXT,                 -- hex, for map/UI; assigned deterministically at import time
  wikidata_id  TEXT NOT NULL UNIQUE
);

-- Holdings: empire held city from start to end (mirrors the old holdings.json shape,
-- just with empire_id FK instead of a free-string nation).
CREATE TABLE holding (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  empire_id   TEXT NOT NULL REFERENCES empire(id),
  city_id     TEXT NOT NULL REFERENCES city(id),
  start_year  INTEGER NOT NULL,
  end_year    INTEGER NOT NULL,
  -- true for holdings synthesized (at import time) from a city's current
  -- country rather than real historical sovereignty-change data — used so
  -- every city stays reachable in the connect-the-cities game even when
  -- Wikidata has no qualified statement for it. Not a real historical claim;
  -- excluded from Paint mode's territory rendering.
  synthetic   INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_holding_city ON holding(city_id);
CREATE INDEX idx_holding_empire ON holding(empire_id);
CREATE INDEX idx_holding_range ON holding(start_year, end_year);

-- Borders: empire's territory as of a time-slice ("era"), pointing at a geometry file
-- rather than embedding GeoJSON in the db (keeps the .sqlite small).
CREATE TABLE border_era (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  era_year  INTEGER NOT NULL,     -- the snapshot year this era file represents
  file      TEXT NOT NULL         -- e.g. 'borders/0476ce.geojson', relative to public/data/
);
CREATE UNIQUE INDEX idx_border_era_year ON border_era(era_year);

-- Which empire, in a given era file, corresponds to which GeoJSON feature.
CREATE TABLE border_empire_map (
  border_era_id  INTEGER NOT NULL REFERENCES border_era(id),
  empire_id      TEXT NOT NULL REFERENCES empire(id),
  feature_name   TEXT NOT NULL,   -- the NAME property value in the source GeoJSON feature
  PRIMARY KEY (border_era_id, empire_id)
);
