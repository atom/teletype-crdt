const assert = require('assert')

module.exports =
class DocumentReplica {
  constructor (siteId) {
    assert(siteId !== 0, 'siteId 0 is reserved')
    this.siteId = siteId
    this.nextSequenceNumber = 0
    this.insertionStartsByOpId = new Map()
    this.deletionStartsByOpId = new Map()
    this.undoCountsByOpId = new Map()

    this.firstSegment = {opId: {site: 0, seq: 0}, offset: 0, pos: 0, text: '', prev: null, nextSplit: null, deletions: new Set(), deletionEnds: new Set()}
    this.firstSegment.prev = this.firstSegment
    this.insertionStartsByOpId.set(opIdToString(this.firstSegment.opId), this.firstSegment)

    const lastSegment = {opId: {site: 0, seq: 1}, offset: 0, pos: 1, text: '', prev: this.firstSegment, next: null, nextSplit: null, deletions: new Set(), deletionEnds: new Set()}
    this.insertionStartsByOpId.set(opIdToString(lastSegment.opId), lastSegment)
    this.firstSegment.next = lastSegment
  }

  applyLocal (operation) {
    switch (operation.type) {
      case 'insert':
        return this.insertLocal(operation)
      case 'delete':
        return this.deleteLocal(operation)
      default:
        throw new Error('Unknown operation type ' + operation.type)
    }
  }

  insertLocal ({position, text}) {
    const opId = {site: this.siteId, seq: this.nextSequenceNumber++}
    const [left, right] = this.findLocalSegmentBoundary(position)
    const newSegment = {
      opId,
      text,
      offset: 0,
      left: left,
      right: right,
      nextSplit: null
    }
    this.insertBetween(left, right, newSegment)
    this.insertionStartsByOpId.set(opIdToString(opId), newSegment)

    return {
      type: 'insert',
      opId,
      text,
      leftDependencyId: left.opId,
      offsetInLeftDependency: left.offset + left.text.length,
      rightDependencyId: right.opId,
      offsetInRightDependency: right.offset
    }
  }

  deleteLocal ({position, extent}) {
    const opId = {site: this.siteId, seq: this.nextSequenceNumber++}
    const opIdString = opIdToString(opId)

    const leftPrev = this.findLocalSegmentBoundary(position)[0]
    const right = this.findLocalSegmentBoundary(position + extent)[0]
    const left = leftPrev.next

    let node = left
    while (true) {
      node.deletions.add(opIdString)
      if (node === right) break
      node = node.next
    }

    right.deletionEnds.add(opIdString)
    this.deletionStartsByOpId.set(opIdString, left)

    return {
      type: 'delete',
      opId,
      extent,
      leftDependencyId: left.opId,
      offsetInLeftDependency: left.offset,
      rightDependencyId: right.opId,
      offsetInRightDependency: right.offset + right.text.length
    }
  }

  undoLocal (opId) {
    const opIdString = opIdToString(opId)
    const newUndoCount = (this.undoCountsByOpId.get(opIdString) || 0) + 1
    const opToSend = {type: 'undo', opId, undoCount: newUndoCount}
    const opsToApply = this.updateUndoCount(opId, newUndoCount)
    return {opToSend, opsToApply}
  }

  updateUndoCount (opId, newUndoCount) {
    const opIdString = opIdToString(opId)
    const undoCount = this.undoCountsByOpId.get(opIdString) || 0
    if (newUndoCount <= undoCount) return []

    let isDeletion = false
    let startSegment = this.insertionStartsByOpId.get(opIdString)
    if (!startSegment) {
      isDeletion = true
      startSegment = this.deletionStartsByOpId.get(opIdString)
    }

    const previouslyVisibleSegments = new Set()
    let segment = startSegment
    while (segment) {
      if (this.isSegmentVisible(segment)) previouslyVisibleSegments.add(segment)
      if (isDeletion && segment.deletionEnds.has(opIdString)) break
      segment = segment.nextSplit
    }

    this.undoCountsByOpId.set(opIdString, newUndoCount)

    const opsToApply = []
    segment = startSegment
    while (segment) {
      if (previouslyVisibleSegments.has(segment)) {
        if (!this.isSegmentVisible(segment)) {
          opsToApply.push({
            type: 'delete',
            position: this.getSegmentPosition(segment),
            extent: segment.text.length
          })
        }
      } else {
        if (this.isSegmentVisible(segment)) {
          opsToApply.push({
            type: 'insert',
            position: this.getSegmentPosition(segment),
            text: segment.text
          })
        }
      }

      if (isDeletion && segment.deletionEnds.has(opIdString)) break
      segment = segment.nextSplit
    }

    return opsToApply
  }

  canApplyRemote ({leftDependencyId, rightDependencyId}) {
    return (
      this.insertionStartsByOpId.has(opIdToString(leftDependencyId)) &&
      this.insertionStartsByOpId.has(opIdToString(rightDependencyId))
    )
  }

  applyRemote (operation) {
    switch (operation.type) {
      case 'insert':
        return this.insertRemote(operation)
      case 'delete':
        return this.deleteRemote(operation)
      case 'undo':
        return this.undoRemote(operation)
      default:
        throw new Error('Unknown operation type ' + operation.type)
    }
  }

  insertRemote ({opId, text, leftDependencyId, offsetInLeftDependency, rightDependencyId, offsetInRightDependency}) {
    const originalRightDependency = this.findSegmentStart(rightDependencyId.site, rightDependencyId.seq, offsetInRightDependency)
    const originalLeftDependency = this.findSegmentEnd(leftDependencyId.site, leftDependencyId.seq, offsetInLeftDependency)

    let currentSegment = originalLeftDependency.next
    let leftDependency = originalLeftDependency
    let rightDependency = originalRightDependency
    while (currentSegment !== rightDependency) {
      if (currentSegment.left.pos <= leftDependency.pos && currentSegment.right.pos >= rightDependency.pos) {
        if (opId.site < currentSegment.opId.site) {
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
      opId,
      offset: 0,
      text,
      left: originalLeftDependency,
      right: originalRightDependency
    }
    this.insertBetween(leftDependency, rightDependency, newSegment)
    this.insertionStartsByOpId.set(opIdToString(opId), newSegment)

    if (newSegment.deletions.size === 0) {
      return [{
        type: 'insert',
        position: this.getSegmentPosition(newSegment),
        text
      }]
    } else {
      return []
    }
  }

  deleteRemote ({opId, leftDependencyId, offsetInLeftDependency, rightDependencyId, offsetInRightDependency}) {
    const opIdString = opIdToString(opId)
    const leftPrev = this.findSegmentStart(leftDependencyId.site, leftDependencyId.seq, offsetInLeftDependency).prev
    const right = this.findSegmentEnd(rightDependencyId.site, rightDependencyId.seq, offsetInRightDependency)
    const left = leftPrev.next

    const position = this.getSegmentPosition(left)
    const extent = this.getSegmentPosition(right.next) - position

    let node = left
    while (true) {
      node.deletions.add(opIdString)
      if (node === right) break
      node = node.next
    }

    right.deletionEnds.add(opIdString)
    this.deletionStartsByOpId.set(opIdString, left)

    return [{
      type: 'delete',
      position,
      extent
    }]
  }

  undoRemote ({opId, undoCount}) {
    return this.updateUndoCount(opId, undoCount)
  }

  findLocalSegmentBoundary (position) {
    let segmentStart = 0
    let segment = this.firstSegment
    while (segment) {
      const segmentLength = segment.deletions.size === 0 ? segment.text.length : 0
      const segmentEnd = segmentStart + segmentLength
      if (segmentStart <= position && position <= segmentEnd) {
        if (position < segmentEnd) {
          return this.splitSegment(segment, position - segmentStart)
        } else {
          return [segment, segment.next]
        }
      }

      segmentStart = segmentEnd
      segment = segment.next
    }

    throw new Error('Control should never reach here')
  }

  splitSegment (segment, offset) {
    const prefix = Object.assign({}, segment)
    prefix.text = segment.text.slice(0, offset)
    prefix.deletionEnds = new Set()
    prefix.deletions = new Set(prefix.deletions)
    prefix.deletions.forEach((opIdString) => {
      if (this.deletionStartsByOpId.get(opIdString) === segment) {
        this.deletionStartsByOpId.set(opIdString, prefix)
      }
    })
    if (prefix.offset === 0) this.insertionStartsByOpId.set(opIdToString(prefix.opId), prefix)

    const suffix = Object.assign({}, segment)
    suffix.text = segment.text.slice(offset)
    suffix.opId = Object.assign({}, segment.opId)
    suffix.offset += offset
    suffix.pos = (segment.pos + segment.next.pos) / 2
    suffix.deletions = new Set(suffix.deletions)
    suffix.deletionEnds = new Set(suffix.deletionEnds)

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
    let segment = this.insertionStartsByOpId.get(opIdToString({site, seq}))
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
    let segment = this.insertionStartsByOpId.get(opIdToString({site, seq}))
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

      if (segment.deletions.size === 0) {
        position += segment.text.length
      }
      segment = segment.next
    }

    assert(false, 'Segment not found')
  }

  insertBetween (prev, next, newSegment) {
    prev.next = newSegment
    newSegment.prev = prev

    newSegment.next = next
    next.prev = newSegment

    newSegment.pos = (prev.pos + next.pos) / 2

    newSegment.deletions = new Set()
    newSegment.deletionEnds = new Set()
    prev.deletions.forEach((opId) => {
      if (!prev.deletionEnds.has(opId)) {
        newSegment.deletions.add(opId)
      }
    })
  }

  getText () {
    let segment = this.firstSegment
    let text = ''
    while (segment) {
      if (segment.deletions.size === 0) text += segment.text
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

  isSegmentVisible (segment) {
    const opIdString = opIdToString(segment.opId)
    const undoCount = this.undoCountsByOpId.get(opIdString) || 0
    return (undoCount & 1) === 0 && !this.isSegmentDeleted(segment)
  }

  isSegmentDeleted (segment) {
    const opIdString = opIdToString(segment.opId)
    for (const opIdString of segment.deletions) {
      const deletionUndoCount = this.undoCountsByOpId.get(opIdString) || 0
      if ((deletionUndoCount & 1) === 0) return true
    }
    return false
  }
}

function opIdToString ({site, seq}) {
  return site + '.' + seq
}
