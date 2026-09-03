// Which holding (if any) was active for each city at a given year. When a
// city has more than one matching holding (shouldn't normally happen, but
// data can be imprecise), the one with the latest start wins as the more
// specific/recent claim.
//
// Synthetic holdings (a city's current country with no real qualified
// sovereignty-change data, used so the connect-the-cities game never hits an
// unreachable city) are excluded here — this function backs actual
// territory-painting, and a synthetic holding is not a real historical claim.
export function ownershipAtYear(holdings, year) {
  const byCity = new Map()
  for (const h of holdings) {
    if (h.synthetic) continue
    if (h.start > year || year > h.end) continue
    const existing = byCity.get(h.city)
    if (!existing || h.start > existing.start) byCity.set(h.city, h)
  }
  return byCity
}
