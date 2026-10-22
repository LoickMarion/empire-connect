// Map colours. A subject (colony, dependency, puppet, occupied zone) is drawn as a lighter shade of
// the realm that held it, for as long as the link applies; everything else keeps its own colour.
export function lighten(hex, amount = 0.5) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex ?? '')
  if (!m) return hex
  const n = parseInt(m[1], 16)
  const mix = (c) => Math.round(c + (255 - c) * amount)
  const out = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(mix)
  return `#${out.map((c) => c.toString(16).padStart(2, '0')).join('')}`
}

// A 'member' link means the occupier is the same state under another name (England -> United Kingdom,
// Angevin Empire -> United Kingdom), so it takes the realm's own colour for as long as the link applies.
// Returns colorAt(empireId, year). `empires`: [{ id, color }]; `realmLinks`: [{ occupierId, overlordId, start, end, kind }].
export function createColorResolver(empires, realmLinks) {
  const own = new Map(empires.map((e) => [e.id, e.color]))
  const subjectLinks = new Map()
  const memberLinks = new Map()
  for (const l of realmLinks) {
    const byOccupier = l.kind === 'subject' ? subjectLinks : memberLinks
    if (!byOccupier.has(l.occupierId)) byOccupier.set(l.occupierId, [])
    byOccupier.get(l.occupierId).push(l)
  }
  const active = (links, id, year) => (links.get(id) ?? []).filter((l) => l.start <= year && year <= l.end)
  // the colour of the realm an occupier is a name of (links are closed transitively, so one hop reaches it)
  const realmColor = (id, year) => own.get(active(memberLinks, id, year)[0]?.overlordId ?? id)
  return (empireId, year) => {
    const links = active(subjectLinks, empireId, year)
    if (!links.length) return realmColor(empireId, year)
    // links are closed transitively, so prefer the top overlord: the one that is not itself a subject
    const top = links.find((l) => !active(subjectLinks, l.overlordId, year).length) ?? links[0]
    return lighten(realmColor(top.overlordId, year) ?? own.get(empireId))
  }
}
