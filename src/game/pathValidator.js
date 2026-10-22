// Pure logic: which nations (if any) connect two cities by having held
// both at overlapping points in time. No React, no data-source dependency.
//
// Peoples and cultures (holdings with isNation === false) never count: they were not nations.

export function findConnections(cityIdA, cityIdB, holdings) {
  if (cityIdA === cityIdB) return []

  const holdingsA = holdings.filter((h) => h.city === cityIdA && h.isNation !== false)
  const holdingsB = holdings.filter((h) => h.city === cityIdB && h.isNation !== false)

  const connections = []
  for (const a of holdingsA) {
    for (const b of holdingsB) {
      if (a.empireId !== b.empireId) continue
      const overlapStart = Math.max(a.start, b.start)
      const overlapEnd = Math.min(a.end, b.end)
      if (overlapStart <= overlapEnd) {
        const connection = { nation: a.nation, empireId: a.empireId, overlapStart, overlapEnd }
        // set when a side was held through a colony/dependency of the nation (see realms.js)
        if (a.via) connection.viaA = a.via
        if (b.via) connection.viaB = b.via
        connections.push(connection)
      }
    }
  }
  return connections
}

export function canConnect(cityIdA, cityIdB, holdings) {
  return findConnections(cityIdA, cityIdB, holdings).length > 0
}
