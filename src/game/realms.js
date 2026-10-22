// Colonies and dependencies roll up to their parent realm for linking provinces: a province held by
// Portuguese Brazil also counts as held by Portugal over the years the link applies, so São Paulo
// connects to Lisbon "via Portugal". Pure logic, no data-source dependency.
//
// holdings: [{ city, empireId, nation, start, end, isNation, ... }]
// links:    [{ occupierId, overlordId, overlordName, start, end }]
// Returns the original holdings plus one extra holding per overlap, marked with `via` (the
// colony's own name) so the game can explain the connection.
export function expandWithRealms(holdings, links) {
  const byOccupier = new Map()
  for (const link of links) {
    if (!byOccupier.has(link.occupierId)) byOccupier.set(link.occupierId, [])
    byOccupier.get(link.occupierId).push(link)
  }
  const out = [...holdings]
  for (const h of holdings) {
    for (const link of byOccupier.get(h.empireId) ?? []) {
      const start = Math.max(h.start, link.start)
      const end = Math.min(h.end, link.end)
      if (start > end) continue
      out.push({
        city: h.city,
        empireId: link.overlordId,
        nation: link.overlordName,
        isNation: true,
        start,
        end,
        via: h.nation,
      })
    }
  }
  return out
}
