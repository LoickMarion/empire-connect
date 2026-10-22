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

// Returns colorAt(empireId, year). `empires`: [{ id, color }]; `realmLinks`: [{ occupierId, overlordId, start, end, kind }].
export function createColorResolver(empires, realmLinks) {
  const own = new Map(empires.map((e) => [e.id, e.color]))
  const subjectLinks = new Map()
  for (const l of realmLinks) {
    if (l.kind !== 'subject') continue
    if (!subjectLinks.has(l.occupierId)) subjectLinks.set(l.occupierId, [])
    subjectLinks.get(l.occupierId).push(l)
  }
  const active = (id, year) => (subjectLinks.get(id) ?? []).filter((l) => l.start <= year && year <= l.end)
  return (empireId, year) => {
    const links = active(empireId, year)
    if (!links.length) return own.get(empireId)
    // links are closed transitively, so prefer the top overlord: the one that is not itself a subject
    const top = links.find((l) => !active(l.overlordId, year).length) ?? links[0]
    return lighten(own.get(top.overlordId) ?? own.get(empireId))
  }
}
