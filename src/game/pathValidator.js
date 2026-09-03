// Pure logic: which nations (if any) connect two cities by having held
// both at overlapping points in time. No React, no data-source dependency.

export function findConnections(cityIdA, cityIdB, holdings) {
  if (cityIdA === cityIdB) return []

  const holdingsA = holdings.filter((h) => h.city === cityIdA)
  const holdingsB = holdings.filter((h) => h.city === cityIdB)

  const connections = []
  for (const a of holdingsA) {
    for (const b of holdingsB) {
      if (a.empireId !== b.empireId) continue
      const overlapStart = Math.max(a.start, b.start)
      const overlapEnd = Math.min(a.end, b.end)
      if (overlapStart <= overlapEnd) {
        connections.push({ nation: a.nation, empireId: a.empireId, overlapStart, overlapEnd })
      }
    }
  }
  return connections
}

export function canConnect(cityIdA, cityIdB, holdings) {
  return findConnections(cityIdA, cityIdB, holdings).length > 0
}
