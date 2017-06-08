const assert = require('assert')
const DocumentTree = require('./document-tree')
const SplitTree = require('./split-tree')
const {ZERO_POINT, compare, traverse, traversal, characterIndexForPosition, extentForText} = require('./point-helpers')
const BigRational = require('big-rational')

module.exports =
class DocumentReplica {
  constructor (siteId) {
    assert(siteId !== 0, 'siteId 0 is reserved')
    this.siteId = siteId
    this.nextSequenceNumber = 1
    this.splitTreesByOpId = new Map()
    this.deletionsByOpId = new Map()
    this.undoCountsByOpId = new Map()
    this.deferredOperationsByDependencyId = new Map()
    this.maxSeqsBySite = {}

    const firstSegment = {opId: {site: 0, seq: 0}, offset: ZERO_POINT, pos: BigRational(0), text: '', extent: ZERO_POINT, nextSplit: null, deletions: new Set()}
    this.splitTreesByOpId.set(opIdToString(firstSegment.opId), new SplitTree(firstSegment))

    const lastSegment = {opId: {site: 0, seq: 1}, offset: ZERO_POINT, pos: BigRational(1), text: '', extent: ZERO_POINT, nextSplit: null, deletions: new Set()}
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
      extent: extentForText(text),
      offset: ZERO_POINT,
      leftDependency: left,
      rightDependency: right,
      nextSplit: null,
      deletions: new Set()
    }
    this.documentTree.insertBetween(left, right, newSegment)
    this.splitTreesByOpId.set(opIdToString(opId), new SplitTree(newSegment))
    this.updateMaxSeqsBySite(opId)

    return {
      type: 'insert',
      opId,
      text,
      leftDependencyId: left.opId,
      offsetInLeftDependency: traverse(left.offset, left.extent),
      rightDependencyId: right.opId,
      offsetInRightDependency: right.offset
    }
  }

  deleteLocal ({position, extent}) {
    const opId = {site: this.siteId, seq: this.nextSequenceNumber++}
    const opIdString = opIdToString(opId)

    const left = this.findLocalSegmentBoundary(position)[1]
    const right = this.findLocalSegmentBoundary(traverse(position, extent))[0]

    const maxSeqsBySite = {}
    let segment = left
    while (true) {
      const maxSeq = maxSeqsBySite[segment.opId.site]
      if (maxSeq == null || segment.opId.seq > maxSeq) {
        maxSeqsBySite[segment.opId.site] = segment.opId.seq
      }

      segment.deletions.add(opIdString)
      this.documentTree.splayNode(segment)
      this.documentTree.updateSubtreeExtent(segment)
      if (segment === right) break
      segment = this.documentTree.getSuccessor(segment)
    }

    const deletion = {
      type: 'delete',
      opId,
      leftDependencyId: left.opId,
      offsetInLeftDependency: left.offset,
      rightDependencyId: right.opId,
      offsetInRightDependency: traverse(right.offset, right.extent),
      maxSeqsBySite
    }
    this.deletionsByOpId.set(opIdString, deletion)
    this.updateMaxSeqsBySite(opId)
    return deletion
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

    let segmentsToUpdate
    let insertionSplitTree = this.splitTreesByOpId.get(opIdString)
    if (insertionSplitTree) {
      segmentsToUpdate = insertionSplitTree.getSegments()
    } else {
      segmentsToUpdate = []

      const {
        leftDependencyId, offsetInLeftDependency,
        rightDependencyId, offsetInRightDependency,
        maxSeqsBySite
      } = this.deletionsByOpId.get(opIdString)
      const left = this.findSegmentStart(leftDependencyId, offsetInLeftDependency)
      const right = this.findSegmentEnd(rightDependencyId, offsetInRightDependency)
      let segment = left
      while (true) {
        const maxSeq = maxSeqsBySite[segment.opId.site] || 0
        if (segment.opId.seq <= maxSeq) {
          segmentsToUpdate.push(segment)
        }

        if (segment === right) break
        segment = this.documentTree.getSuccessor(segment)
      }
    }

    const opsToApply = []

    for (let i = segmentsToUpdate.length - 1; i >= 0; i--) {
      const segment = segmentsToUpdate[i]
      const wasVisible = this.isSegmentVisible(segment)
      const isVisible = this.isSegmentVisible(segment, opId, newUndoCount)
      if (wasVisible) {
        if (!isVisible) {
          opsToApply.push({
            type: 'delete',
            position: this.documentTree.getSegmentPosition(segment),
            extent: segment.extent,
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
        this.documentTree.splayNode(segmentsToUpdate[i])
        this.documentTree.updateSubtreeExtent(segmentsToUpdate[i], opId, newUndoCount)
      }
    }

    this.undoCountsByOpId.set(opIdString, newUndoCount)

    return opsToApply
  }

  canApplyRemote (op) {
    switch (op.type) {
      case 'insert':
        return (
          this.splitTreesByOpId.has(opIdToString(op.leftDependencyId)) &&
          this.splitTreesByOpId.has(opIdToString(op.rightDependencyId)) &&
          (this.maxSeqsBySite[op.opId.site] || 0) === op.opId.seq - 1
        )
      case 'delete':
        const hasLeftAndRightDependencies = (
          this.splitTreesByOpId.has(opIdToString(op.leftDependencyId)) &&
          this.splitTreesByOpId.has(opIdToString(op.rightDependencyId)) &&
          (this.maxSeqsBySite[op.opId.site] || 0) === op.opId.seq - 1
        )
        if (hasLeftAndRightDependencies) {
          for (const site in op.maxSeqsBySite) {
            if (op.maxSeqsBySite[site] > (this.maxSeqsBySite[site] || 0)) {
              return false
            }
          }
          return true
        } else {
          return false
        }
      case 'undo':
        const opIdString = opIdToString(op.opId)
        return (
          this.splitTreesByOpId.has(opIdString) ||
          this.deletionsByOpId.has(opIdString)
        )
      default:
        throw new Error('Unknown operation type')
    }
  }

  applyRemote (operation) {
    const localOpsToApply = []
    if (this.canApplyRemote(operation)) {
      const remoteOpsToApply = [operation]
      while (remoteOpsToApply.length > 0) {
        const remoteOpToApply = remoteOpsToApply.shift()
        const remoteOpToApplyIdString = opIdToString(remoteOpToApply.opId)
        switch (remoteOpToApply.type) {
          case 'insert':
            localOpsToApply.push(...this.insertRemote(remoteOpToApply))
            break
          case 'delete':
            localOpsToApply.push(...this.deleteRemote(remoteOpToApply))
            break
          case 'undo':
            localOpsToApply.push(...this.undoRemote(remoteOpToApply))
            break
        }
        const dependentOps = this.deferredOperationsByDependencyId.get(remoteOpToApplyIdString)
        if (dependentOps) {
          dependentOps.forEach((dependentOp) => {
            if (this.canApplyRemote(dependentOp)) {
              remoteOpsToApply.push(dependentOp)
            }
          })
          this.deferredOperationsByDependencyId.delete(remoteOpToApplyIdString)
        }
      }
    } else {
      this.deferRemote(operation)
    }

    return localOpsToApply
  }

  deferRemote (op) {
    if (op.type === 'insert') {
      this.addRemoteOpDependency({site: op.opId.site, seq: op.opId.seq - 1}, op)
      this.addRemoteOpDependency(op.leftDependencyId, op)
      this.addRemoteOpDependency(op.rightDependencyId, op)
    } else if (op.type === 'delete') {
      this.addRemoteOpDependency({site: op.opId.site, seq: op.opId.seq - 1}, op)
      this.addRemoteOpDependency(op.leftDependencyId, op)
      this.addRemoteOpDependency(op.rightDependencyId, op)
      for (const site in op.maxSeqsBySite) {
        const seq = op.maxSeqsBySite[site]
        this.addRemoteOpDependency({site, seq}, op)
      }
    } else if (op.type === 'undo') {
      this.addRemoteOpDependency(op.opId, op)
    } else {
      throw new Error('Unknown operation type: ' + op.type)
    }
  }

  addRemoteOpDependency (dependencyId, op) {
    const dependencyIdString = opIdToString(dependencyId)
    if (!this.hasAppliedOperation(dependencyId)) {
      let deferredOps = this.deferredOperationsByDependencyId.get(dependencyIdString)
      if (!deferredOps) {
        deferredOps = new Set()
        this.deferredOperationsByDependencyId.set(dependencyIdString, deferredOps)
      }
      deferredOps.add(op)
    }
  }

  hasAppliedOperation (opId) {
    const opIdString = opIdToString(opId)
    return (
      this.splitTreesByOpId.has(opIdString) ||
      this.deletionsByOpId.has(opIdString)
    )
  }

  insertRemote ({opId, text, leftDependencyId, offsetInLeftDependency, rightDependencyId, offsetInRightDependency}) {
    this.updateMaxSeqsBySite(opId)

    const originalRightDependency = this.findSegmentStart(rightDependencyId, offsetInRightDependency)
    const originalLeftDependency = this.findSegmentEnd(leftDependencyId, offsetInLeftDependency)

    let currentSegment = this.documentTree.getSuccessor(originalLeftDependency)
    let leftDependency = originalLeftDependency
    let rightDependency = originalRightDependency
    while (currentSegment !== rightDependency) {
      if (currentSegment.leftDependency.pos.compare(leftDependency.pos) <= 0 && currentSegment.rightDependency.pos.compare(rightDependency.pos) >= 0) {
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
      offset: ZERO_POINT,
      text,
      extent: extentForText(text),
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

  deleteRemote (deletion) {
    const {
      opId,
      leftDependencyId, offsetInLeftDependency,
      rightDependencyId, offsetInRightDependency,
      maxSeqsBySite
    } = deletion

    this.updateMaxSeqsBySite(opId)
    const opIdString = opIdToString(opId)
    this.deletionsByOpId.set(opIdString, deletion)

    const opsToApply = []
    const segmentsToUpdate = []
    const left = this.findSegmentStart(leftDependencyId, offsetInLeftDependency)
    const right = this.findSegmentEnd(rightDependencyId, offsetInRightDependency)
    let segment = left
    while (true) {
      const maxSeq = maxSeqsBySite[segment.opId.site] || 0
      if (segment.opId.seq <= maxSeq) {
        segmentsToUpdate.push(segment)

        const {extent} = segment
        if (this.isSegmentVisible(segment) && compare(extent, ZERO_POINT) > 0) {
          const position = this.documentTree.getSegmentPosition(segment)
          const lastOp = opsToApply[opsToApply.length - 1]
          if (lastOp && compare(position, traverse(lastOp.position, lastOp.extent)) === 0) {
            lastOp.extent = traverse(lastOp.extent, extent)
          } else {
            opsToApply.push({type: 'delete', position, extent, pos: segment.pos})
          }
        }
      }

      if (segment === right) break
      segment = this.documentTree.getSuccessor(segment)
    }

    for (let i = segmentsToUpdate.length - 1; i >= 0; i--) {
      const segment = segmentsToUpdate[i]
      segment.deletions.add(opIdString)
      this.documentTree.splayNode(segment)
      this.documentTree.updateSubtreeExtent(segment)
    }

    return opsToApply.reverse()
  }

  undoRemote ({opId, undoCount}) {
    return this.updateUndoCount(opId, undoCount)
  }

  findLocalSegmentBoundary (position) {
    const {segment, start, end} = this.documentTree.findSegmentContainingPosition(position)
    if (compare(position, end) < 0) {
      const splitTree = this.splitTreesByOpId.get(opIdToString(segment.opId))
      return this.splitSegment(splitTree, segment, traversal(position, start))
    } else {
      return [segment, this.documentTree.getSuccessor(segment)]
    }
  }

  splitSegment (splitTree, segment, offset) {
    const suffix = splitTree.splitSegment(segment, offset)
    suffix.pos = segment.pos.add(this.documentTree.getSuccessor(segment).pos).divide(2)
    this.documentTree.splitSegment(segment, suffix)
    return [segment, suffix]
  }

  findSegmentStart (opId, offset) {
    const splitTree = this.splitTreesByOpId.get(opIdToString(opId))
    const segment = splitTree.findSegmentContainingOffset(offset)
    const segmentEndOffset = traverse(segment.offset, segment.extent)
    if (compare(segment.offset, offset) === 0) {
      return segment
    } else if (compare(segmentEndOffset, offset) === 0) {
      return segment.nextSplit
    } else {
      const [prefix, suffix] = this.splitSegment(splitTree, segment, traversal(offset, segment.offset))
      return suffix
    }
  }

  findSegmentEnd (opId, offset) {
    const splitTree = this.splitTreesByOpId.get(opIdToString(opId))
    const segment = splitTree.findSegmentContainingOffset(offset)
    const segmentEndOffset = traverse(segment.offset, segment.extent)
    if (compare(segmentEndOffset, offset) === 0) {
      return segment
    } else {
      const [prefix, suffix] = this.splitSegment(splitTree, segment, traversal(offset, segment.offset))
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

  updateMaxSeqsBySite ({site, seq}) {
    const previousSeq = this.maxSeqsBySite[site] || 0
    assert.equal(previousSeq, seq - 1, 'Operations from a given site must be applied in order.')
    this.maxSeqsBySite[site] = Math.max(seq, this.maxSeqsBySite[site] || 0)
  }
}

function opIdToString ({site, seq}) {
  return site + '.' + seq
}
