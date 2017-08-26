const assert = require('assert')
const DocumentTree = require('./document-tree')
const SplitTree = require('./split-tree')
const {ZERO_POINT, compare, traverse, traversal, characterIndexForPosition, extentForText} = require('./point-helpers')

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
    this.deferredResolutionsByDependencyId = new Map()
    this.maxSeqsBySite = {}

    const firstSegment = {opId: {site: 0, seq: 0}, offset: ZERO_POINT, text: '', extent: ZERO_POINT, nextSplit: null, deletions: new Set()}
    this.splitTreesByOpId.set(opIdToString(firstSegment.opId), new SplitTree(firstSegment))

    const lastSegment = {opId: {site: 0, seq: 1}, offset: ZERO_POINT, text: '', extent: ZERO_POINT, nextSplit: null, deletions: new Set()}
    this.splitTreesByOpId.set(opIdToString(lastSegment.opId), new SplitTree(lastSegment))

    this.documentTree = new DocumentTree(
      firstSegment,
      lastSegment,
      this.isSegmentVisible.bind(this)
    )

    this.undoStack = []
    this.redoStack = []
    this.nextCheckpointId = 1
  }

  setTextInRange (start, end, text) {
    const operations = []
    if (compare(end, start) > 0) {
      operations.push(this.delete(start, end))
    }
    if (text && text.length > 0) {
      operations.push(this.insert(start, text))
    }

    this.undoStack.push(new Transaction(operations))
    return operations
  }

  undo () {
    const stackEntry = this.undoStack.pop()
    const operationsToUndo = stackEntry.operations
    const operationsToApply = []
    const operationsToSend = []
    for (var i = 0; i < operationsToUndo.length; i++) {
      const operation = operationsToUndo[i]
      const {opsToApply, opToSend} = this.undoOrRedoOperation(operation.opId)
      operationsToApply.push(...opsToApply)
      operationsToSend.push(opToSend)
    }

    this.redoStack.push(stackEntry)
    return {opsToApply: operationsToApply, opsToSend: operationsToSend}
  }

  redo () {
    const stackEntry = this.redoStack.pop()
    const operationsToRedo = stackEntry.operations
    const operationsToApply = []
    const operationsToSend = []
    for (var i = 0; i < operationsToRedo.length; i++) {
      const operation = operationsToRedo[i]
      const {opsToApply, opToSend} = this.undoOrRedoOperation(operation.opId)
      operationsToApply.push(...opsToApply)
      operationsToSend.push(opToSend)
    }

    this.undoStack.push(stackEntry)
    return {opsToApply: operationsToApply, opsToSend: operationsToSend}
  }

  createCheckpoint () {
    const checkpoint = new Checkpoint(this.nextCheckpointId++)
    this.undoStack.push(checkpoint)
    return checkpoint.id
  }

  groupChangesSinceCheckpoint (checkpointId) {
    let checkpointIndex = -1
    const operationsSinceCheckpoint = []
    for (let i = this.undoStack.length - 1; i >= 0; i--) {
      const stackEntry = this.undoStack[i]
      if (stackEntry instanceof Checkpoint) {
        if (stackEntry.id === checkpointId) {
          checkpointIndex = i
          break
        }
      } else if (stackEntry instanceof Transaction) {
        operationsSinceCheckpoint.push(...stackEntry.operations)
      } else {
        throw new Error('Unknown stack entry ' + stackEntry.constructor.name)
      }
    }

    if (checkpointIndex === -1) {
      return false
    } else {
      this.undoStack.splice(checkpointIndex + 1)
      this.undoStack.push(new Transaction(operationsSinceCheckpoint))
      return this.deltaForOperations(operationsSinceCheckpoint)
    }
  }

  insert (position, text) {
    const opId = {site: this.siteId, seq: this.nextSequenceNumber}
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

  delete (start, end) {
    const opId = {site: this.siteId, seq: this.nextSequenceNumber}
    const opIdString = opIdToString(opId)

    const left = this.findLocalSegmentBoundary(start)[1]
    const right = this.findLocalSegmentBoundary(end)[0]

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

  undoOrRedoOperation (opId) {
    const opIdString = opIdToString(opId)
    const newUndoCount = (this.undoCountsByOpId.get(opIdString) || 0) + 1
    const opToSend = {type: 'undo', opId, undoCount: newUndoCount}
    const opsToApply = this.updateUndoCount(opId, newUndoCount)
    return {opToSend, opsToApply}
  }

  isOperationUndone (opId) {
    const undoCount = this.undoCountsByOpId.get(opIdToString(opId))
    return undoCount != null && (undoCount & 1 === 1)
  }

  canIntegrateOperation (op) {
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

  integrateOperation (operation) {
    const changesToApply = []
    if (this.canIntegrateOperation(operation)) {
      const operations = [operation]
      while (operations.length > 0) {
        const operation = operations.shift()
        const operationIdString = opIdToString(operation.opId)
        switch (operation.type) {
          case 'insert':
            changesToApply.push(...this.insertRemote(operation))
            break
          case 'delete':
            changesToApply.push(...this.deleteRemote(operation))
            break
          case 'undo':
            changesToApply.push(...this.undoRemote(operation))
            break
        }
        const dependentOps = this.deferredOperationsByDependencyId.get(operationIdString)
        if (dependentOps) {
          dependentOps.forEach((dependentOp) => {
            if (this.canIntegrateOperation(dependentOp)) {
              operations.push(dependentOp)
            }
          })
          this.deferredOperationsByDependencyId.delete(operationIdString)
        }

        const dependentResolutions = this.deferredResolutionsByDependencyId.get(operationIdString)
        if (dependentResolutions) {
          dependentResolutions.forEach((resolve) => resolve())
          this.deferredResolutionsByDependencyId.delete(operationIdString)
        }
      }
    } else {
      this.deferOperation(operation)
    }

    return changesToApply
  }

  deferOperation (op) {
    if (op.type === 'insert') {
      this.addOperationDependency(this.deferredOperationsByDependencyId, {site: op.opId.site, seq: op.opId.seq - 1}, op)
      this.addOperationDependency(this.deferredOperationsByDependencyId, op.leftDependencyId, op)
      this.addOperationDependency(this.deferredOperationsByDependencyId, op.rightDependencyId, op)
    } else if (op.type === 'delete') {
      this.addOperationDependency(this.deferredOperationsByDependencyId, {site: op.opId.site, seq: op.opId.seq - 1}, op)
      this.addOperationDependency(this.deferredOperationsByDependencyId, op.leftDependencyId, op)
      this.addOperationDependency(this.deferredOperationsByDependencyId, op.rightDependencyId, op)
      for (const site in op.maxSeqsBySite) {
        const seq = op.maxSeqsBySite[site]
        this.addOperationDependency(this.deferredOperationsByDependencyId, {site, seq}, op)
      }
    } else if (op.type === 'undo') {
      this.addOperationDependency(this.deferredOperationsByDependencyId, op.opId, op)
    } else {
      throw new Error('Unknown operation type: ' + op.type)
    }
  }

  addOperationDependency (map, dependencyId, op) {
    const dependencyIdString = opIdToString(dependencyId)
    if (!this.hasAppliedOperation(dependencyId)) {
      let deferredOps = map.get(dependencyIdString)
      if (!deferredOps) {
        deferredOps = new Set()
        map.set(dependencyIdString, deferredOps)
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

    this.documentTree.splayNode(originalLeftDependency)
    this.documentTree.splayNode(originalRightDependency)

    let currentSegment = this.documentTree.getSuccessor(originalLeftDependency)
    let leftDependency = originalLeftDependency
    let rightDependency = originalRightDependency
    while (currentSegment !== rightDependency) {
      const leftDependencyIndex = this.documentTree.getSegmentIndex(leftDependency)
      const rightDependencyIndex = this.documentTree.getSegmentIndex(rightDependency)
      const currentSegmentLeftDependencyIndex = this.documentTree.getSegmentIndex(currentSegment.leftDependency)
      const currentSegmentRightDependencyIndex = this.documentTree.getSegmentIndex(currentSegment.rightDependency)

      if (currentSegmentLeftDependencyIndex <= leftDependencyIndex && currentSegmentRightDependencyIndex >= rightDependencyIndex) {
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
        extent: newSegment.extent,
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

        const {extent, text} = segment
        if (this.isSegmentVisible(segment) && compare(extent, ZERO_POINT) > 0) {
          const position = this.documentTree.getSegmentPosition(segment)
          const lastOp = opsToApply[opsToApply.length - 1]
          if (lastOp && compare(position, traverse(lastOp.position, lastOp.extent)) === 0) {
            lastOp.extent = traverse(lastOp.extent, extent)
            lastOp.text += text
          } else {
            opsToApply.push({type: 'delete', position, extent, text})
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
    const undoCountOverrides = new Map([[opIdString, newUndoCount]])

    for (let i = segmentsToUpdate.length - 1; i >= 0; i--) {
      const segment = segmentsToUpdate[i]
      const wasVisible = this.isSegmentVisible(segment)
      const isVisible = this.isSegmentVisible(segment, undoCountOverrides)
      if (wasVisible) {
        if (!isVisible) {
          opsToApply.push({
            type: 'delete',
            position: this.documentTree.getSegmentPosition(segment),
            extent: segment.extent,
            text: segment.text
          })
        }
      } else {
        if (isVisible) {
          opsToApply.push({
            type: 'insert',
            position: this.documentTree.getSegmentPosition(segment),
            extent: segment.extent,
            text: segment.text
          })
        }
      }

      if (isVisible !== wasVisible) {
        this.documentTree.splayNode(segmentsToUpdate[i])
        this.documentTree.updateSubtreeExtent(segmentsToUpdate[i], undoCountOverrides)
      }
    }

    this.undoCountsByOpId.set(opIdString, newUndoCount)

    return opsToApply
  }

  deltaForOperations (operations) {
    const operationIds = new Set()
    const segmentStartPositions = new Map()
    const segmentIndices = new Map()

    for (let i = 0; i < operations.length; i++) {
      const operation = operations[i]
      const opIdString = opIdToString(operation.opId)
      operationIds.add(opIdString)
      this.collectSegments(opIdString, segmentIndices, segmentStartPositions)
    }

    return this.computeChangesForSegments(segmentIndices, segmentStartPositions, null, operationIds)
  }

  canTranslateRemotePosition (remotePosition) {
    return (
      this.hasAppliedOperation(remotePosition.leftDependencyId) &&
      this.hasAppliedOperation(remotePosition.rightDependencyId)
    )
  }

  getRemotePosition (localPosition) {
    const {segment: leftDependency, start, end} = this.documentTree.findSegmentContainingPosition(localPosition)
    const offsetInLeftDependency = traverse(leftDependency.offset, traversal(localPosition, start))
    let rightDependency, offsetInRightDependency
    if (compare(localPosition, end) === 0) {
      rightDependency = this.documentTree.getSuccessor(leftDependency)
      offsetInRightDependency = rightDependency.offset
    } else {
      rightDependency = leftDependency
      offsetInRightDependency = offsetInLeftDependency
    }

    return {
      site: this.siteId,
      leftDependencyId: leftDependency.opId,
      offsetInLeftDependency,
      rightDependencyId: rightDependency.opId,
      offsetInRightDependency
    }
  }

  getLocalPosition (remotePosition) {
    if (this.canTranslateRemotePosition(remotePosition)) {
      return Promise.resolve(this.getLocalPositionSync(remotePosition))
    } else {
      return new Promise((resolve) => {
        const resolveWithLocalPosition = () => {
          if (this.canTranslateRemotePosition(remotePosition)) {
            resolve(this.getLocalPositionSync(remotePosition))
          }
        }

        this.addOperationDependency(this.deferredResolutionsByDependencyId, remotePosition.leftDependencyId, resolveWithLocalPosition)
        this.addOperationDependency(this.deferredResolutionsByDependencyId, remotePosition.rightDependencyId, resolveWithLocalPosition)
      })
    }
  }

  getLocalPositionSync ({site, leftDependencyId, offsetInLeftDependency, rightDependencyId, offsetInRightDependency}) {
    const leftDependencySplitTree = this.splitTreesByOpId.get(opIdToString(leftDependencyId))
    const originalLeftDependency = leftDependencySplitTree.findSegmentContainingOffset(offsetInLeftDependency)
    const originalLeftDependencyEndOffset = traverse(
      originalLeftDependency.offset,
      originalLeftDependency.extent
    )
    if (compare(offsetInLeftDependency, originalLeftDependencyEndOffset) < 0) {
      const originalLeftDependencyStart = this.documentTree.getSegmentPosition(originalLeftDependency)
      if (this.isSegmentVisible(originalLeftDependency)) {
        return traverse(originalLeftDependencyStart, traversal(offsetInLeftDependency, originalLeftDependency.offset))
      } else {
        return originalLeftDependencyStart
      }
    } else {
      const rightDependencySplitTree = this.splitTreesByOpId.get(opIdToString(rightDependencyId))
      let originalRightDependency = rightDependencySplitTree.findSegmentContainingOffset(offsetInRightDependency)
      if (compare(offsetInRightDependency, originalRightDependency.offset) > 0) {
        originalRightDependency = originalRightDependency.nextSplit
      }

      this.documentTree.splayNode(originalLeftDependency)
      this.documentTree.splayNode(originalRightDependency)

      let currentSegment = this.documentTree.getSuccessor(originalLeftDependency)
      let leftDependency = originalLeftDependency
      let rightDependency = originalRightDependency
      while (currentSegment !== rightDependency) {
        const leftDependencyIndex = this.documentTree.getSegmentIndex(leftDependency)
        const rightDependencyIndex = this.documentTree.getSegmentIndex(rightDependency)
        const currentSegmentLeftDependencyIndex = this.documentTree.getSegmentIndex(currentSegment.leftDependency)
        const currentSegmentRightDependencyIndex = this.documentTree.getSegmentIndex(currentSegment.rightDependency)

        if (currentSegmentLeftDependencyIndex <= leftDependencyIndex && currentSegmentRightDependencyIndex >= rightDependencyIndex) {
          if (site < currentSegment.opId.site) {
            rightDependency = currentSegment
          } else {
            leftDependency = currentSegment
          }

          currentSegment = this.documentTree.getSuccessor(leftDependency)
        } else {
          currentSegment = this.documentTree.getSuccessor(currentSegment)
        }
      }

      return this.documentTree.getSegmentPosition(currentSegment)
    }
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

  collectSegments (opIdString, segmentIndices, segmentStartPositions) {
    const insertionSplitTree = this.splitTreesByOpId.get(opIdString)
    if (insertionSplitTree) {
      const segments = insertionSplitTree.getSegments()
      for (let i = 0; i < segments.length; i++) {
        const segment = segments[i]
        segmentStartPositions.set(segment, this.documentTree.getSegmentPosition(segment))
        segmentIndices.set(segment, this.documentTree.getSegmentIndex(segment))
      }
    } else {
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
          segmentStartPositions.set(segment, this.documentTree.getSegmentPosition(segment))
          segmentIndices.set(segment, this.documentTree.getSegmentIndex(segment))
        }

        if (segment === right) break
        segment = this.documentTree.getSuccessor(segment)
      }
    }
  }

  computeChangesForSegments (segmentIndices, segmentStartPositions, previousUndoCounts, newOperations) {
    const orderedSegments = Array.from(segmentIndices.keys()).sort((s1, s2) => {
      return segmentIndices.get(s1) - segmentIndices.get(s2)
    })

    const changes = []

    let lastChange
    for (let i = 0; i < orderedSegments.length; i++) {
      const segment = orderedSegments[i]
      const visibleBefore = this.isSegmentVisible(segment, previousUndoCounts, newOperations)
      const visibleAfter = this.isSegmentVisible(segment)

      if (visibleBefore !== visibleAfter) {
        const segmentNewStart = segmentStartPositions.get(segment)
        const segmentOldStart =
          lastChange
          ? traverse(lastChange.oldEnd, traversal(segmentNewStart, lastChange.newEnd))
          : segmentNewStart

        if (visibleBefore) {
          if (changes.length > 0 && compare(lastChange.newEnd, segmentNewStart) === 0) {
            lastChange.oldEnd = traverse(lastChange.oldEnd, segment.extent)
            lastChange.oldText += segment.text
          } else {
            lastChange = {
              oldStart: segmentOldStart,
              oldEnd: traverse(segmentOldStart, segment.extent),
              oldText: segment.text,
              newStart: segmentNewStart,
              newEnd: segmentNewStart,
              newText: ''
            }
            changes.push(lastChange)
          }
        } else {
          if (lastChange && compare(lastChange.newEnd, segmentNewStart) === 0) {
            lastChange.newEnd = traverse(lastChange.newEnd, segment.extent)
            lastChange.newText += segment.text
          } else {
            lastChange = {
              oldStart: segmentOldStart,
              oldEnd: segmentOldStart,
              oldText: '',
              newStart: segmentNewStart,
              newEnd: traverse(segmentNewStart, segment.extent),
              newText: segment.text
            }
            changes.push(lastChange)
          }
        }
      }
    }

    return changes
  }

  isSegmentVisible (segment, undoCountOverrides, operationsToIgnore) {
    const opIdString = opIdToString(segment.opId)

    if (operationsToIgnore && operationsToIgnore.has(opIdString)) {
      return false
    }

    let undoCount
    if (undoCountOverrides) {
      undoCount = undoCountOverrides.get(opIdString)
    }
    if (undoCount == null) {
      undoCount = this.undoCountsByOpId.get(opIdString) || 0
    }

    return (
      (undoCount & 1) === 0 &&
      !this.isSegmentDeleted(segment, undoCountOverrides, operationsToIgnore)
    )
  }

  isSegmentDeleted (segment, undoCountOverrides, operationsToIgnore) {
    for (const deletionOpIdString of segment.deletions) {
      if (operationsToIgnore && operationsToIgnore.has(deletionOpIdString)) {
        continue
      }

      let deletionUndoCount
      if (undoCountOverrides) {
        deletionUndoCount = undoCountOverrides.get(deletionOpIdString)
      }
      if (deletionUndoCount == null) {
        deletionUndoCount = this.undoCountsByOpId.get(deletionOpIdString) || 0
      }

      if ((deletionUndoCount & 1) === 0) return true
    }
    return false
  }

  updateMaxSeqsBySite ({site, seq}) {
    const previousSeq = this.maxSeqsBySite[site] || 0
    assert.equal(previousSeq, seq - 1, 'Operations from a given site must be applied in order.')
    this.maxSeqsBySite[site] = seq
    if (this.siteId === site) this.nextSequenceNumber = seq + 1
  }
}

function opIdToString ({site, seq}) {
  return site + '.' + seq
}


class Checkpoint {
  constructor (id) {
    this.id = id
  }
}

class Transaction {
  constructor (operations) {
    this.operations = operations
  }
}
