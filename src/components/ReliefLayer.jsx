import { useEffect } from 'react'
import { useMap } from 'react-leaflet'
import L from 'leaflet'

// Esri's shaded-relief ocean is flat blue, but in deep water at zoom 11 and beyond the service sends a
// flat grey "Map data not yet available" tile instead. This tile layer spots that tile and paints the
// ocean colour in its place, so the sea just carries on.
export const OCEAN = '#9ebcd8'
const MISSING_GREY = 204

// The grey tile carries a line of text, so a few sampled pixels can land on a letter: call it missing
// when nearly all of a grid of samples are the flat grey.
function isMissingDataTile(ctx, size) {
  const steps = 8
  let grey = 0
  for (let i = 0; i < steps; i += 1) {
    for (let j = 0; j < steps; j += 1) {
      const [r, g, b] = ctx.getImageData(Math.floor(((i + 0.5) * size) / steps), Math.floor(((j + 0.5) * size) / steps), 1, 1).data
      if (Math.abs(r - MISSING_GREY) <= 4 && Math.abs(g - MISSING_GREY) <= 4 && Math.abs(b - MISSING_GREY) <= 4) grey += 1
    }
  }
  return grey >= steps * steps * 0.85
}

const OceanFillingTileLayer = L.TileLayer.extend({
  createTile(coords, done) {
    const size = this.getTileSize()
    const tile = document.createElement('canvas')
    tile.width = size.x
    tile.height = size.y
    const ctx = tile.getContext('2d', { willReadFrequently: true })
    const img = new Image()
    img.crossOrigin = 'anonymous'
    const rows = 2 ** coords.z
    if (coords.y < 0 || coords.y >= rows) {
      // above or below the Mercator world: no such tile
      ctx.fillStyle = OCEAN
      ctx.fillRect(0, 0, size.x, size.y)
      setTimeout(() => done(null, tile))
      return tile
    }
    img.onload = () => {
      ctx.drawImage(img, 0, 0, size.x, size.y)
      try {
        if (isMissingDataTile(ctx, size.x)) {
          ctx.fillStyle = OCEAN
          ctx.fillRect(0, 0, size.x, size.y)
        }
      } catch {
        // a tile the browser won't let us read: show it as it came
      }
      done(null, tile)
    }
    img.onerror = () => {
      ctx.fillStyle = OCEAN // no tile at all (offline, or none for this spot): ocean-coloured
      ctx.fillRect(0, 0, size.x, size.y)
      done(null, tile)
    }
    img.src = this.getTileUrl(coords)
    return tile
  },
})

export default function ReliefLayer({ url, attribution, maxNativeZoom, noWrap }) {
  const map = useMap()
  useEffect(() => {
    const layer = new OceanFillingTileLayer(url, { attribution, maxNativeZoom, noWrap })
    layer.addTo(map)
    return () => {
      map.removeLayer(layer)
    }
  }, [map, url, attribution, maxNativeZoom, noWrap])
  return null
}
