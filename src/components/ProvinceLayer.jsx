import { useEffect, useMemo, useRef, useState } from 'react'
import { GeoJSON } from 'react-leaflet'
import { getProvinceBoundaries } from '../data/dataSource.js'
import { ownershipAtYear } from '../game/ownershipAtYear.js'
import { formatYear } from '../game/formatYear.js'
import { PRESENT_YEAR } from '../data/dataSource.js'

const BORDER_WEIGHT = 1.6
const OUTLINE = { color: '#888', weight: BORDER_WEIGHT, fillOpacity: 0 }

// Province boundaries. In paint mode each province is filled with the colour of whoever
// occupied it in `year`; otherwise they are plain outlines. Clicking a province selects it.
export default function ProvinceLayer({ paint, year, holdings, cities, colorAt, historyByCity, onProvinceClick }) {
  const [boundaries, setBoundaries] = useState(null)
  const layerRef = useRef(null)
  const clickRef = useRef(onProvinceClick)
  clickRef.current = onProvinceClick

  useEffect(() => {
    getProvinceBoundaries().then(setBoundaries)
  }, [])

  const ownership = useMemo(() => (paint ? ownershipAtYear(holdings, year) : null), [paint, holdings, year])
  const cityNameById = useMemo(() => Object.fromEntries(cities.map((c) => [c.id, c.name])), [cities])

  // Hover text for Paint mode: who held the province, and its city. Read through a ref so the
  // handlers attached once to each province always see the current year.
  const tipRef = useRef(() => null)
  tipRef.current = (id) => {
    if (!ownership) {
      if (!historyByCity) return null
      const list = historyByCity.get(id) ?? []
      const box = document.createElement('div')
      const name = document.createElement('strong')
      name.textContent = cityNameById[id] ?? id
      box.append(name)
      const title = document.createElement('div')
      title.textContent = list.length ? 'Held by:' : 'No recorded occupiers'
      box.append(title)
      for (const h of list) {
        const row = document.createElement('div')
        row.textContent = `${h.nation} · ${formatYear(h.start)}–${h.end >= PRESENT_YEAR ? 'present' : formatYear(h.end)}`
        box.append(row)
      }
      return box
    }
    const holding = ownership.get(id)
    const box = document.createElement('div')
    const title = document.createElement('strong')
    title.textContent = holding ? holding.nation : 'Unclaimed'
    box.append(title)
    const detail = document.createElement('div')
    const span = holding
      ? ` · ${formatYear(holding.start)}–${holding.end >= PRESENT_YEAR ? 'present' : formatYear(holding.end)}`
      : ''
    detail.textContent = `${cityNameById[id] ?? id}${span}`
    box.append(detail)
    if (holding?.isNation === false) {
      const note = document.createElement('em')
      note.textContent = 'a people/culture, not a nation'
      box.append(note)
    }
    return box
  }

  const styleFor = useMemo(
    () => (feature) => {
      const holding = ownership?.get(feature.properties.id)
      if (!holding) return OUTLINE
      return {
        color: '#fff',
        weight: BORDER_WEIGHT,
        fillColor: colorAt(holding.empireId, year) ?? '#888',
        fillOpacity: 0.6,
      }
    },
    [ownership, colorAt, year],
  )

  // Restyle in place rather than re-mounting 1000 paths on every slider tick.
  useEffect(() => {
    layerRef.current?.setStyle(styleFor)
  }, [styleFor, boundaries])

  if (!boundaries) return null
  return (
    <GeoJSON
      ref={layerRef}
      data={boundaries}
      style={styleFor}
      onEachFeature={(feature, layer) => {
        layer.on('click', () => clickRef.current?.(feature.properties.id))
        layer.on('mouseover', (e) => {
          const tip = tipRef.current(feature.properties.id)
          if (!tip) return
          layer.unbindTooltip()
          layer.bindTooltip(tip, { sticky: true }).openTooltip(e.latlng)
        })
        layer.on('mouseout', () => layer.closeTooltip())
      }}
    />
  )
}
