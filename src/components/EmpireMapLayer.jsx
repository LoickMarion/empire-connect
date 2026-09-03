import { useMemo } from 'react'
import { Polygon } from 'react-leaflet'
import { buildVoronoi, cellPositions } from '../game/voronoi.js'
import { ownershipAtYear } from '../game/ownershipAtYear.js'

// Paints an estimated territory map for `year` by giving each city a Voronoi
// cell (nearest-city region over the full city set) and filling it with the
// color of whichever empire held that city at that year. Cities with no
// active holding that year render no cell (left blank).
export default function EmpireMapLayer({ cities, holdings, empireColorById, year }) {
  const voronoi = useMemo(() => buildVoronoi(cities), [cities])
  const ownership = useMemo(() => ownershipAtYear(holdings, year), [holdings, year])

  return (
    <>
      {cities.map((city, i) => {
        const holding = ownership.get(city.id)
        if (!holding) return null
        const positions = cellPositions(voronoi, i)
        if (!positions) return null
        const color = empireColorById[holding.empireId] ?? '#888888'
        return (
          <Polygon
            key={city.id}
            positions={positions}
            pathOptions={{ color: '#ffffff', weight: 0.5, fillColor: color, fillOpacity: 0.6 }}
          />
        )
      })}
    </>
  )
}
