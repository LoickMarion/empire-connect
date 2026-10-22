// How the world is divided. Most countries are cut into provinces that never cross their
// borders ("country mode"). A few countries instead use their real internal divisions
// ("admin-1 mode"): one province per state / province / department, with the exceptions below.

// Natural Earth ADMIN name -> policy.
//   minKm2: admin-1 units smaller than this merge into their best neighbour in the same country
//   splitKm2 / maxSplit: big units are cut into round(area / splitKm2) provinces, up to maxSplit
export const ADMIN1_COUNTRIES = {
  'United States of America': { minKm2: 30000, splitKm2: 250000, maxSplit: 4 },
  Canada: { minKm2: 0, splitKm2: 600000, maxSplit: 4 },
  Mexico: { minKm2: 0 },
  Spain: { minKm2: 0 }, // provinces
  Portugal: { minKm2: 0 }, // districts
  France: { minKm2: 0 }, // departments
  // Germany is divided like the Holy Roman Empire (EU4-style): ~90 provinces built from districts
  // around historic seed cities, with free/imperial cities as tiny provinces of their own.
  Germany: { minKm2: 0, source: 'kreise-seeds' },
  Italy: { minKm2: 4000 }, // provinces; the smallest merge into a neighbour (~110 -> about 50)
  Netherlands: { minKm2: 1000 }, // 12 provinces; Caribbean islets drop out
  Belgium: { minKm2: 1000 }, // 10 provinces; Brussels folds into its neighbour
  // Historic counties (pre-1974 / Historic Counties Standard): the 92 for Great Britain and
  // Northern Ireland come from the Historic County Borders Project; the 26 of the Republic of
  // Ireland come from Natural Earth's counties, with its city/district splits merged back.
  'United Kingdom': { minKm2: 0, source: 'historic-counties' },
  Ireland: { minKm2: 0 },
}

// Natural Earth Irish admin-1 names -> the historic county they belong to.
export const IRISH_COUNTY_ALIASES = {
  'Dún Laoghaire–Rathdown': 'Dublin',
  Fingal: 'Dublin',
  'South Dublin': 'Dublin',
  Laoighis: 'Laois',
  'North Tipperary': 'Tipperary',
  'South Tipperary': 'Tipperary',
  // 'Cork', 'Galway', 'Limerick' and 'Waterford' appear twice (county + city); same name merges them
}

// Historic counties of the UK that are not in England. HCBP data has no nation attribute.
export const SCOTLAND = new Set(
  'Aberdeenshire Angus Argyllshire Ayrshire Banffshire Berwickshire Buteshire Caithness Clackmannanshire Cromartyshire Dumfriesshire Dunbartonshire East_Lothian Fife Inverness-shire Kincardineshire Kinross-shire Kirkcudbrightshire Lanarkshire Midlothian Morayshire Nairnshire Orkney Peeblesshire Perthshire Renfrewshire Ross-shire Roxburghshire Selkirkshire Shetland Stirlingshire Sutherland West_Lothian Wigtownshire'
    .split(' ')
    .map((n) => n.replace('_', ' ')),
)
export const WALES = new Set(
  'Anglesey Brecknockshire Caernarfonshire Cardiganshire Carmarthenshire Denbighshire Flintshire Glamorgan Merionethshire Monmouthshire Montgomeryshire Pembrokeshire Radnorshire'.split(' '),
)
export const NORTHERN_IRELAND = new Set('Antrim Armagh Down Fermanagh Londonderry Tyrone'.split(' '))

// Explicit province counts that override the area rule, keyed "Country/Unit".
export const SPLIT_OVERRIDES = {
  'United States of America/California': 3,
  'United States of America/Texas': 3,
  'United States of America/Florida': 2,
  'United States of America/Montana': 2,
}

// Country-mode countries (and microstates) below this are folded into a neighbour or dropped.
export const MIN_COUNTRY_KM2 = 10000
// A tiny land with no neighbour survives as its own province down to this size (islands)...
export const MIN_ISLAND_KM2 = 3000
// ...and otherwise is folded into the nearest zone within this many degrees, or dropped.
export const ISLAND_MERGE_DEG = 2

export const SKIP_ADMIN = new Set(['Antarctica'])
