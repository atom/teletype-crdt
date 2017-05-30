const assert = require('assert')

module.exports =
class DocumentReplica {
  constructor (siteId) {
    assert(siteId !== 0, 'siteId 0 is reserved')
    this.siteId = siteId
    this.nextSequenceNumber = 0
    this.segmentsById = new Map()

    this.firstSegment = {id: {site: 0, seq: 0}, offset: 0, pos: 0, text: '', prev: null, nextSplit: null}
    this.firstSegment.prev = this.firstSegment
    this.segmentsById.set(segmentIdToString(this.firstSegment.id), this.firstSegment)

    const lastSegment = {id: {site: 0, seq: 1}, offset: 0, pos: 1, text: '', prev: this.firstSegment, next: null, nextSplit: null}
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
        const id = {site: this.siteId, seq: this.nextSequenceNumber++}
        const newSegment = {id, text, nextSplit: null, offset: 0}
        this.segmentsById.set(segmentIdToString(id), newSegment)

        if (position < segmentEnd) {
          const [prefix, suffix] = this.splitSegment(segment, position - segmentStart)
          newSegment.left = prefix
          newSegment.right = suffix
          newSegment.pos = (prefix.pos + suffix.pos) / 2
        } else {
          newSegment.left = segment
          newSegment.right = segment.next
          newSegment.pos = (segment.pos + segment.next.pos) / 2
        }

        assert(!Number.isNaN(newSegment.pos))
        newSegment.prev = newSegment.left
        newSegment.next = newSegment.right
        newSegment.prev.next = newSegment
        newSegment.next.prev = newSegment

        return {
          type: 'insert',
          text, id,
          leftDependencyId: newSegment.left.id,
          offsetInLeftDependency: newSegment.left.offset + newSegment.left.text.length,
          rightDependencyId: newSegment.right.id,
          offsetInRightDependency: newSegment.right.offset
        }
      }

      segmentStart = segmentEnd
      segment = segment.next
    }

    assert(false, 'Control should never reach here')
  }

  canApplyRemote ({leftDependencyId, rightDependencyId}) {
    return (
      this.segmentsById.has(segmentIdToString({site: leftDependencyId.site, seq: leftDependencyId.seq})) &&
      this.segmentsById.has(segmentIdToString({site: rightDependencyId.site, seq: rightDependencyId.seq}))
    )
  }

  applyRemote (operation) {
    if (operation.type === 'insert') {
      return this.insertRemote(operation)
    } else {
      throw new Error('implement me')
    }
  }

  insertRemote ({id, text, leftDependencyId, offsetInLeftDependency, rightDependencyId, offsetInRightDependency}) {
    const originalRightDependency = this.findSegmentStart(rightDependencyId.site, rightDependencyId.seq, offsetInRightDependency)
    const originalLeftDependency = this.findSegmentEnd(leftDependencyId.site, leftDependencyId.seq, offsetInLeftDependency)

    let currentSegment = originalLeftDependency.next
    debugger
    let leftDependency = originalLeftDependency
    let rightDependency = originalRightDependency
    while (currentSegment !== rightDependency) {
      if (currentSegment.left.pos <= leftDependency.pos && currentSegment.right.pos >= rightDependency.pos) {
        if (id.site < currentSegment.id.site) {
          rightDependency = currentSegment
        } else {
          leftDependency = currentSegment
        }

        currentSegment = leftDependency.next
      } else {
        currentSegment = currentSegment.next
      }
    }

    const newSegment = {
      id,
      offset: 0,
      text,
      left: originalLeftDependency,
      right: originalRightDependency,
      prev: currentSegment.prev,
      next: currentSegment,
      pos: (currentSegment.prev.pos + currentSegment.pos) / 2
    }
    assert(!Number.isNaN(newSegment.pos))
    currentSegment.prev.next = newSegment
    currentSegment.prev = newSegment

    this.segmentsById.set(segmentIdToString(id), newSegment)

    return {
      type: 'insert',
      position: this.getSegmentPosition(newSegment),
      text
    }
  }

  splitSegment (segment, offset) {
    const prefix = Object.assign({}, segment)
    prefix.text = segment.text.slice(0, offset)
    if (prefix.offset === 0) this.segmentsById.set(segmentIdToString(prefix.id), prefix)

    const suffix = Object.assign({}, segment)
    suffix.text = segment.text.slice(offset)
    suffix.id = Object.assign({}, segment.id)
    suffix.offset += offset
    suffix.pos = (segment.pos + segment.next.pos) / 2
    assert(!Number.isNaN(suffix.pos))

    if (prefix.prevSplit) prefix.prevSplit.nextSplit = prefix
    prefix.nextSplit = suffix
    suffix.prevSplit = prefix
    if (suffix.nextSplit) suffix.nextSplit.prevSplit = suffix

    prefix.prev.next = prefix
    prefix.next = suffix
    suffix.prev = prefix
    suffix.next.prev = suffix

    return [prefix, suffix]
  }

  findSegmentStart (site, seq, offset) {
    let segment = this.segmentsById.get(segmentIdToString({site, seq}))
    while (segment) {
      const segmentEndOffset = segment.offset + segment.text.length
      if (segment.offset === offset) {
        return segment
      } else if (segmentEndOffset > offset) {
        assert(segment.offset < offset)
        const [prefix, suffix] = this.splitSegment(segment, offset - segment.offset)
        return suffix
      }

      segment = segment.nextSplit
    }
  }

  findSegmentEnd (site, seq, offset) {
    let segment = this.segmentsById.get(segmentIdToString({site, seq}))
    while (segment) {
      const segmentEndOffset = segment.offset + segment.text.length
      if (segmentEndOffset === offset) {
        return segment
      } else if (segmentEndOffset > offset) {
        assert(segment.offset < offset)
        const [prefix, suffix] = this.splitSegment(segment, offset - segment.offset)
        return prefix
      }

      segment = segment.nextSplit
    }
  }

  getSegmentPosition (targetSegment) {
    let position = 0
    let segment = this.firstSegment
    while (segment) {
      if (segment === targetSegment) {
        return position
      }

      position += segment.text.length
      segment = segment.next
    }

    assert(false, 'Segment not found')
  }

  getText () {
    let segment = this.firstSegment
    let text = ''
    while (segment) {
      text += segment.text
      segment = segment.next
    }

    return text
  }

  getSegments () {
    let segment = this.firstSegment
    const segments = []
    while (segment) {
      segments.push(segment)
      segment = segment.next
    }

    return segments
  }
}

function segmentIdToString ({site, seq}) {
  return site + '.' + seq
}
