const assert = require('assert')
const {
  ZERO_POINT, characterIndexForPosition, extentForText, compare, traverse, traversal
} = require('../../lib/point-helpers')

module.exports =
class LocalDocument {
  constructor (text) {
    this.text = text
    this.markers = {}
  }

  updateText (changes) {
    for (let i = changes.length - 1; i >= 0; i--) {
      const {oldStart, oldEnd, newText} = changes[i]
      this.setTextInRange(oldStart, oldEnd, newText)
    }
  }

  updateMarkers (updatesBySiteId) {
    for (const siteId in updatesBySiteId) {
      let layersById = this.markers[siteId]
      if (!layersById) {
        layersById = {}
        this.markers[siteId] = layersById
      }

      const updatesByLayerId = updatesBySiteId[siteId]
      for (const layerId in updatesByLayerId) {
        const updatesByMarkerId = updatesByLayerId[layerId]

        if (updatesByMarkerId === null) {
          assert(layersById[layerId], 'Layer should exist')
          delete layersById[layerId]
        } else {
          let markersById = layersById[layerId]
          if (!markersById) {
            markersById = {}
            layersById[layerId] = markersById
          }

          for (const markerId in updatesByMarkerId) {
            const markerUpdate = updatesByMarkerId[markerId]
            if (markerUpdate === null) {
              assert(markersById[markerId], 'Marker should exist')
              delete markersById[markerId]
            } else {
              const marker = Object.assign({}, markerUpdate)
              marker.range = Object.assign({}, marker.range)
              markersById[markerId] = marker
            }
          }
        }
      }
    }
  }

  setTextInRange (oldStart, oldEnd, text) {
    if (compare(oldEnd, oldStart) > 0) {
      this.delete(oldStart, oldEnd)
    }

    if (text.length > 0) {
      this.insert(oldStart, text)
    }

    this.spliceMarkers(oldStart, oldEnd, traverse(oldStart, extentForText(text)))
  }

  spliceMarkers (oldStart, oldEnd, newEnd) {
    const isInsertion = compare(oldStart, oldEnd) === 0


    for (const siteId in this.markers) {
      const layersById = this.markers[siteId]
      for (const layerId in layersById) {
        const markersById = layersById[layerId]
        for (const markerId in markersById) {
          const {range, exclusive} = markersById[markerId]
          const rangeIsEmpty = compare(range.start, range.end) === 0

          const moveMarkerStart = (
            compare(oldStart, range.start) < 0 ||
            (
              exclusive &&
              (!rangeIsEmpty || isInsertion) &&
              compare(oldStart, range.start) === 0
            )
          )

          const moveMarkerEnd = (
            moveMarkerStart ||
            (compare(oldStart, range.end) < 0) ||
            (!exclusive && compare(oldEnd, range.end) === 0)
          )

          if (moveMarkerStart) {
            if (compare(oldEnd, range.start) <= 0) { // splice precedes marker start
              range.start = traverse(newEnd, traversal(range.start, oldEnd))
            } else { // splice surrounds marker start
              range.start = newEnd
            }
          }

          if (moveMarkerEnd) {
            if (compare(oldEnd, range.end) <= 0) { // splice precedes marker end
              range.end = traverse(newEnd, traversal(range.end, oldEnd))
            } else { // splice surrounds marker end
              range.end = newEnd
            }
          }
        }
      }
    }
  }

  insert (position, text) {
    const index = characterIndexForPosition(this.text, position)
    this.text = this.text.slice(0, index) + text + this.text.slice(index)
  }

  delete (startPosition, endPosition) {
    const textExtent = extentForText(this.text)
    assert(compare(startPosition, textExtent) < 0)
    assert(compare(endPosition, textExtent) <= 0)
    const startIndex = characterIndexForPosition(this.text, startPosition)
    const endIndex = characterIndexForPosition(this.text, endPosition)
    this.text = this.text.slice(0, startIndex) + this.text.slice(endIndex)
  }

  lineForRow (row) {
    const startIndex = characterIndexForPosition(this.text, {row, column: 0})
    const endIndex = characterIndexForPosition(this.text, {row: row + 1, column: 0}) - 1
    return this.text.slice(startIndex, endIndex)
  }

  getLineCount () {
    return extentForText(this.text).row + 1
  }

  getTextInRange (start, end) {
    const startIndex = characterIndexForPosition(this.text, start)
    const endIndex = characterIndexForPosition(this.text, end)
    return this.text.slice(startIndex, endIndex)
  }
}
