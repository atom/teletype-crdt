const assert = require('assert')
const DocumentTree = require('./document-tree')
const SplitTree = require('./split-tree')

module.exports =
class DocumentReplica {
  constructor (siteId) {
    assert(siteId !== 0, 'siteId 0 is reserved')
    this.siteId = siteId
    this.nextSequenceNumber = 0
    this.splitTreesByOpId = new Map()
    this.deletedOffsetRangesByOpId = new Map()
    this.undoCountsByOpId = new Map()

    const firstSegment = {opId: {site: 0, seq: 0}, offset: 0, pos: 0, text: '', nextSplit: null, deletions: new Set()}
    this.splitTreesByOpId.set(opIdToString(firstSegment.opId), new SplitTree(firstSegment))

    const lastSegment = {opId: {site: 0, seq: 1}, offset: 0, pos: 1, text: '', nextSplit: null, deletions: new Set()}
    this.splitTreesByOpId.set(opIdToString(lastSegment.opId), new SplitTree(lastSegment))

    this.documentTree = new DocumentTree(
      firstSegment,
      lastSegment,
      this.isSegmentVisible.bind(this)
    )
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
      leftDependency: left,
      rightDependency: right,
      nextSplit: null,
      deletions: new Set()
    }
    this.documentTree.insertBetween(left, right, newSegment)
    this.splitTreesByOpId.set(opIdToString(opId), new SplitTree(newSegment))

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

    const left = this.findLocalSegmentBoundary(position)[1]
    const right = this.findLocalSegmentBoundary(position + extent)[0]

    const offsetRanges = []
    const offsetRangesByInsertionId = new Map()
    let segment = left
    while (true) {
      const segmentOpIdString = opIdToString(segment.opId)
      let segmentRange = offsetRangesByInsertionId.get(segmentOpIdString)
      if (!segmentRange) {
        segmentRange = {opId: segment.opId, startOffset: segment.offset}
        offsetRangesByInsertionId.set(segmentOpIdString, segmentRange)
        offsetRanges.push(segmentRange)
      }
      segmentRange.endOffset = segment.offset + segment.text.length

      segment.deletions.add(opIdString)
      this.documentTree.splayNode(segment)
      this.documentTree.updateSubtreeExtent(segment)
      if (segment === right) break
      segment = this.documentTree.getSuccessor(segment)
    }

    this.deletedOffsetRangesByOpId.set(opIdString, offsetRanges)

    return {type: 'delete', opId, offsetRanges}
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

    let segmentRangesToUpdate
    let insertionSplitTree = this.splitTreesByOpId.get(opIdString)
    if (insertionSplitTree) {
      segmentRangesToUpdate = [{startSegment: insertionSplitTree.getStart(), endSegment: null}]
    } else {
      segmentRangesToUpdate = []
      const deletedOffsetRanges = this.deletedOffsetRangesByOpId.get(opIdString)
      for (let i = 0; i < deletedOffsetRanges.length; i++) {
        const {opId: insertionOpId, startOffset, endOffset} = deletedOffsetRanges[i]
        segmentRangesToUpdate.push({
          startSegment: this.findSegmentStart(insertionOpId, startOffset),
          endSegment: this.findSegmentEnd(insertionOpId, endOffset).nextSplit
        })
      }
    }

    const opsToApply = []
    const segmentsToUpdate = []

    for (let i = 0; i < segmentRangesToUpdate.length; i++) {
      const {startSegment, endSegment} = segmentRangesToUpdate[i]
      let segment = startSegment
      while (segment !== endSegment) {
        const wasVisible = this.isSegmentVisible(segment)
        const isVisible = this.isSegmentVisible(segment, opId, newUndoCount)
        if (wasVisible) {
          if (!isVisible) {
            opsToApply.push({
              type: 'delete',
              position: this.documentTree.getSegmentPosition(segment),
              extent: segment.text.length,
              pos: segment.pos
            })
          }
        } else {
          if (isVisible) {
            opsToApply.push({
              type: 'insert',
              position: this.documentTree.getSegmentPosition(segment),
              text: segment.text,
              pos: segment.pos
            })
          }
        }
        if (isVisible !== wasVisible) {
          segmentsToUpdate.push(segment)
        }
        segment = segment.nextSplit
      }
    }

    this.undoCountsByOpId.set(opIdString, newUndoCount)
    for (let i = segmentsToUpdate.length - 1; i >= 0; i--) {
      this.documentTree.splayNode(segmentsToUpdate[i])
      this.documentTree.updateSubtreeExtent(segmentsToUpdate[i])
    }

    return opsToApply.sort((a, b) => a.pos - b.pos)
  }

  canApplyRemote (op) {
    switch (op.type) {
      case 'insert':
        return (
          this.splitTreesByOpId.has(opIdToString(op.leftDependencyId)) &&
          this.splitTreesByOpId.has(opIdToString(op.rightDependencyId))
        )
      case 'delete':
        for (let i = 0; i < op.offsetRanges.length; i++) {
          const insertionIdString = opIdToString(op.offsetRanges[i].opId)
          if (!this.splitTreesByOpId.has(insertionIdString)) {
            return false
          }
        }
        return true
      case 'undo':
        const opIdString = opIdToString(op.opId)
        return (
          this.splitTreesByOpId.has(opIdString) ||
          this.deletedOffsetRangesByOpId.has(opIdString)
        )
      default:
        throw new Error('Unknown operation type')
    }
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
    const originalRightDependency = this.findSegmentStart(rightDependencyId, offsetInRightDependency)
    const originalLeftDependency = this.findSegmentEnd(leftDependencyId, offsetInLeftDependency)

    let currentSegment = this.documentTree.getSuccessor(originalLeftDependency)
    let leftDependency = originalLeftDependency
    let rightDependency = originalRightDependency
    while (currentSegment !== rightDependency) {
      if (currentSegment.leftDependency.pos <= leftDependency.pos && currentSegment.rightDependency.pos >= rightDependency.pos) {
        if (opId.site < currentSegment.opId.site) {
          rightDependency = currentSegment
        } else {
          leftDependency = currentSegment
        }

        currentSegment = this.documentTree.getSuccessor(leftDependency)
      } else {
        currentSegment = this.documentTree.getSuccessor(currentSegment)
      }
    }

    const newSegment = {
      opId,
      offset: 0,
      text,
      leftDependency: originalLeftDependency,
      rightDependency: originalRightDependency,
      nextSplit: null,
      deletions: new Set()
    }
    this.documentTree.insertBetween(leftDependency, rightDependency, newSegment)
    this.splitTreesByOpId.set(opIdToString(opId), new SplitTree(newSegment))

    if (this.isSegmentVisible(newSegment)) {
      return [{
        type: 'insert',
        position: this.documentTree.getSegmentPosition(newSegment),
        text
      }]
    } else {
      return []
    }
  }

  deleteRemote ({opId: deletionOpId, offsetRanges}) {
    const deletionOpIdString = opIdToString(deletionOpId)
    this.deletedOffsetRangesByOpId.set(deletionOpIdString, offsetRanges)

    const opsToApply = []
    for (let i = 0; i < offsetRanges.length; i++) {
      const {opId: insertionId, startOffset, endOffset} = offsetRanges[i]
      const insertionIdString = opIdToString(insertionId)

      const left = this.findSegmentStart(insertionId, startOffset)
      const right = this.findSegmentEnd(insertionId, endOffset)

      let segment = left
      while (true) {
        const extent = segment.text.length
        if (this.isSegmentVisible(segment) && extent > 0) {
          const position = this.documentTree.getSegmentPosition(segment)
          const lastOp = opsToApply[opsToApply.length - 1]
          if (lastOp && position === lastOp.position + lastOp.extent) {
            lastOp.extent += extent
          } else {
            opsToApply.push({type: 'delete', position, extent, pos: segment.pos})
          }
        }

        if (segment === right) break
        segment = segment.nextSplit
      }
    }

    for (let i = offsetRanges.length - 1; i >= 0; i--) {
      const {opId: insertionId, startOffset, endOffset} = offsetRanges[i]
      const insertionIdString = opIdToString(insertionId)

      const left = this.findSegmentStart(insertionId, startOffset)
      const right = this.findSegmentEnd(insertionId, endOffset)

      let node = left
      while (true) {
        node.deletions.add(deletionOpIdString)
        this.documentTree.splayNode(node)
        this.documentTree.updateSubtreeExtent(node)
        if (node === right) break
        node = node.nextSplit
      }
    }

    return opsToApply.sort((a, b) => a.pos - b.pos)
  }

  undoRemote ({opId, undoCount}) {
    return this.updateUndoCount(opId, undoCount)
  }

  findLocalSegmentBoundary (position) {
    const {segment, start, end} = this.documentTree.findSegmentContainingPosition(position)
    if (position < end) {
      const splitTree = this.splitTreesByOpId.get(opIdToString(segment.opId))
      return this.splitSegment(splitTree, segment, position - start)
    } else {
      return [segment, this.documentTree.getSuccessor(segment)]
    }
  }

  splitSegment (splitTree, segment, offset) {
    const suffix = splitTree.splitSegment(segment, offset)
    suffix.pos = (segment.pos + this.documentTree.getSuccessor(segment).pos) / 2
    this.documentTree.splitSegment(segment, suffix)
    return [segment, suffix]
  }

  findSegmentStart (opId, offset) {
    const splitTree = this.splitTreesByOpId.get(opIdToString(opId))
    const segment = splitTree.findSegmentContainingOffset(offset)
    const segmentEndOffset = segment.offset + segment.text.length
    if (segment.offset === offset) {
      return segment
    } else if (segmentEndOffset === offset) {
      return segment.nextSplit
    } else {
      const [prefix, suffix] = this.splitSegment(splitTree, segment, offset - segment.offset)
      return suffix
    }
  }

  findSegmentEnd (opId, offset) {
    const splitTree = this.splitTreesByOpId.get(opIdToString(opId))
    const segment = splitTree.findSegmentContainingOffset(offset)
    const segmentEndOffset = segment.offset + segment.text.length
    if (segmentEndOffset === offset) {
      return segment
    } else {
      const [prefix, suffix] = this.splitSegment(splitTree, segment, offset - segment.offset)
      return prefix
    }
  }

  getText () {
    let text = ''
    const segments = this.documentTree.getSegments()
    for (var i = 0; i < segments.length; i++) {
      const segment = segments[i]
      if (this.isSegmentVisible(segment)) text += segment.text
    }
    return text
  }

  isSegmentVisible (segment, opId, newUndoCount) {
    const segmentOpIdString = opIdToString(segment.opId)
    let opIdString = opId ? opIdToString(opId) : null
    let undoCount
    if (newUndoCount != null && segmentOpIdString == opIdString) {
      undoCount = newUndoCount
    } else {
      undoCount = this.undoCountsByOpId.get(segmentOpIdString) || 0
    }
    return (undoCount & 1) === 0 && !this.isSegmentDeleted(segment, opId, newUndoCount)
  }

  isSegmentDeleted (segment, opId, undoCount) {
    const opIdString = opId ? opIdToString(opId) : null
    for (const deletionOpIdString of segment.deletions) {
      let deletionUndoCount
      if (deletionOpIdString === opIdString) {
        deletionUndoCount = undoCount
      } else {
        deletionUndoCount = this.undoCountsByOpId.get(deletionOpIdString) || 0
      }
      if ((deletionUndoCount & 1) === 0) return true
    }
    return false
  }
}

function opIdToString ({site, seq}) {
  return site + '.' + seq
}
