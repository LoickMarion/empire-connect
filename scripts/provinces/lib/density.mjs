// How large a province should be at a given place, relative to a "typical" one (1).
// Higher = bigger provinces. Regions with a lot of border churn (Europe, the Middle
// East, Persia) are small; the Americas, Australia and empty interiors are big.
// Boxes are [lonMin, lonMax, latMin, latMax, factor]; later boxes override earlier
// ones, so order broad -> specific.
const BOXES = [
  // empty / thinly-settled expanses
  [-180, -30, -60, 85, 2.2], // the Americas
  [-170, -50, 60, 85, 5], // arctic Canada / Alaska north
  [-75, -10, 59, 84, 7], // Greenland
  [60, 180, 55, 80, 3], // Siberia
  [110, 155, -45, -10, 3], // Australia
  [-17, 35, 12, 28, 2.5], // Sahara
  [-20, 55, -35, 12, 1.3], // sub-Saharan Africa
  [80, 120, 35, 50, 1.6], // Mongolia / Tibet / Gobi
  [165, 180, -48, -33, 1.5], // New Zealand

  // moderately churned
  [-110, -65, -20, 25, 1.4], // Mesoamerica + Andes
  [92, 125, -10, 25, 1.0], // Southeast Asia
  [60, 90, 5, 45, 0.7], // Central Asia / South Asia
  [100, 125, 20, 42, 0.8], // China
  [125, 146, 30, 45, 0.7], // Korea / Japan
  [-10, 35, 20, 37, 0.8], // North Africa coast

  // high churn
  [-12, 45, 34, 72, 0.7], // Europe incl. Scandinavia
  [-12, 45, 34, 60, 0.45], // Europe core
  [25, 70, 12, 45, 0.45], // Anatolia, Levant, Mesopotamia, Persia, Caucasus
  [36, 55, 16, 28, 1.6], // Arabian interior (overrides the box above)
  [28, 36, 22, 32, 0.4], // Nile valley
]

export function densityFactor(lon, lat) {
  let f = 1
  for (const [lo0, lo1, la0, la1, factor] of BOXES) {
    if (lon >= lo0 && lon <= lo1 && lat >= la0 && lat <= la1) f = factor
  }
  return f
}
