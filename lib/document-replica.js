const assert = require('assert')

module.exports =
class DocumentReplica {
  constructor (siteId) {
    assert(siteId !== 0, 'siteId 0 is reserved')
    this.siteId = siteId
    this.nextSequenceNumber = 0
    this.segmentsById = new Map()

    this.firstSegment = {id: {site: 0, seq: 0, offset: 0}, pos: 0, text: '', prev: null, nextSplit: null}
    this.segmentsById.set(segmentIdToString(firstSegment.id), this.firstSegment)

    const lastSegment = {id: {site: 0, seq: 1, offset: 0}, pos: 1, text: '', prev: this.firstSegment, next: null, nextSplit: null}
    this.segmentsById.set(segmentIdToString(lastSegment.id), lastSegment)
    this.firstSegment.next = lastSegment
  }

  applyLocal (operation) {
    if (operation.type === 'insert') {
      return this.insertLocal(operation)
    } else {
      throw new Error('implement me')
    }
  }

  insertLocal ({position, text}) {
    let segmentStart = 0
    let segment = this.firstSegment
    while (segment) {
      const segmentEnd = segmentStart + segment.text.length
      if (segmentStart <= position && position <= segmentEnd) {
        const id = {site: this.siteId, seq: this.nextSequenceNumber++, offset: 0}
        const newSegment = {id, text, nextSplit: null}
        this.segmentsById.set(segmentIdToString(id), newSegment)

        if (position < segmentEnd) {
          const [prefix, suffix] = this.splitSegment(segment, position - segmentStart)
          newSegment.left = prefix
          newSegment.right = suffix
          newSegment.pos = (suffix.pos - prefix.pos) / 2
        } else {
          newSegment.left = segment
          newSegment.right = this.segments[i + 1]
          newSegment.pos = (this.segments[i + 1].pos - segment.pos) / 2
          this.segments.splice(i + 1, 0, newSegment)
        }

        newSegment.left.next = newSegment
        newSegment.prev = newSegment.left
        newSegment.next = newSegment.right
        newSegment.right.prev = newSegment

        return {
          type: 'insert',
          text, id,
          leftId: newSegment.left.id,
          rightId: newSegment.right.id
        }
      }

      segmentStart = segmentEnd
      segment = segment.next
    }

    assert(false, 'Control should never reach here')
  }

  canApplyRemote ({leftId, rightId}) {
    return (
      this.segmentsById.has(segmentIdToString({site: leftId.site, seq: leftId.seq, offset: 0})) &&
      this.segmentsById.has(segmentIdToString({site: rightId.site, seq: rightId.seq, offset: 0}))
    )
  }

  applyRemote (operation) {
    if (operation.type === 'insert') {
      return this.insertRemote(operation)
    } else {
      throw new Error('implement me')
    }
  }

  insertRemote ({id, text, leftId, rightId}) {
    let {segment: leftSegment, position} = this.locateSegment(leftId)
    let {segment: rightSegment} = this.locateSegment(rightId)

    while (rightIndex - leftIndex > 1) {
      for (let i = leftIndex + 1; i < rightIndex; i++) {
        const segment = this.segments[i]
        if (segment.left.pos <= )
      }

    }

    // return {type: 'insert', position: visibleEnd, text}
  }

  splitSegment (segment, offset) {
    const left = Object.assign({}, segment)
    left.text = segment.text.slice(0, offset - segment.offset)
    this.segmentsById.set(segmentIdToString(left.id), left)

    const right = Object.assign({}, segment)
    right.text = segment.text.slice(offset - segment.offset)
    right.id = Object.assign({}, segment.id)
    right.id.offset = offset
    this.segmentsById.set(segmentIdToString(right.id), right)

    left.nextSplit = right
    left.right = right
    right.left = left

    return [left, right]
  }

  locateSegment (id) {
    let targetSegment = this.segmentsById.get(segmentIdToString(id))

    if (!targetSegment) {
      let segment = this.segmentsById.get(segmentIdToString({site: id.site, seq: id.seq, offset: 0}))
      let segmentStartOffset = 0
      while (segment) {
        if (segmentStartOffset <= offset && offset < (segmentStartOffset + segment.text.length)) {
          assert(segmentStartOffset < offset)
          const [prefix, suffix] = this.splitSegment(segment, offset)
          targetSegment = suffix
          break
        }
      }
    }

    let position = 0
    let segment = this.firstSegment
    while (segment) {
      if (segment === targetSegment) {
        return {segment, position}
      }
      position += segment.text.length
    }
  }
}

function segmentIdToString ({site, seq, offset}) {
  return site + '.' + seq + '.' + offset
}
