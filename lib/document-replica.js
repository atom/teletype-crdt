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

  getNow () {
    return Date.now()
  }

  setTextInRange (start, end, text) {
    const operations = []
    if (compare(end, start) > 0) {
      operations.push(this.delete(start, end))
    }
    if (text && text.length > 0) {
      operations.push(this.insert(start, text))
    }

    this.undoStack.push(new Transaction(this.getNow(), operations))
    this.clearRedoStack()

    return operations
  }

  undo () {
    let spliceIndex = null
    let operationsToUndo = []
    for (let i = this.undoStack.length - 1; i >=0; i--) {
      const stackEntry = this.undoStack[i]
      if (stackEntry instanceof Transaction) {
        operationsToUndo = stackEntry.operations
        spliceIndex = i
        break
      } else if (stackEntry instanceof Checkpoint && stackEntry.isBarrier) {
        return null
      }
    }

    if (spliceIndex != null) {
      this.redoStack.push(...this.undoStack.splice(spliceIndex).reverse())
      return this.undoOrRedoOperations(operationsToUndo)
    } else {
      return null
    }
  }

  redo () {
    let spliceIndex = null
    let operationsToRedo = []
    for (let i = this.redoStack.length - 1; i >= 0; i--) {
      if (this.redoStack[i] instanceof Transaction) {
        operationsToRedo = this.redoStack[i].operations
        spliceIndex = i
        break
      }
    }

    while (this.redoStack[spliceIndex - 1] instanceof Checkpoint) {
      spliceIndex--
    }

    if (spliceIndex != null) {
      this.undoStack.push(...this.redoStack.splice(spliceIndex).reverse())
      return this.undoOrRedoOperations(operationsToRedo)
    } else {
      return false
    }
  }

  clearUndoStack () {
    this.undoStack.length = 0
  }

  clearRedoStack () {
    this.redoStack.length = 0
  }

  applyGroupingInterval (groupingInterval) {
    const topEntry = this.undoStack[this.undoStack.length - 1]
    const previousEntry = this.undoStack[this.undoStack.length - 2]

    if (topEntry instanceof Transaction) {
      topEntry.groupingInterval = groupingInterval
    } else {
      return
    }

    if (previousEntry instanceof Transaction) {
      const timeBetweenEntries = topEntry.timestamp - previousEntry.timestamp
      const minGroupingInterval = Math.min(groupingInterval, previousEntry.groupingInterval || Infinity)
      if (timeBetweenEntries < minGroupingInterval) {
        this.undoStack.pop()
        previousEntry.timestamp = topEntry.timestamp
        previousEntry.operations.push(...topEntry.operations)
        previousEntry.groupingInterval = groupingInterval
      }
    }
  }

  createCheckpoint (options) {
    const checkpoint = new Checkpoint(this.nextCheckpointId++, options && options.isBarrier)
    this.undoStack.push(checkpoint)
    return checkpoint.id
  }

  isBarrierPresentBeforeCheckpoint (checkpointId) {
    for (let i = this.undoStack.length - 1; i >= 0; i--) {
      const stackEntry = this.undoStack[i]
      if (stackEntry instanceof Checkpoint) {
        if (stackEntry.id == checkpointId) return false
        if (stackEntry.isBarrier) return true
      }
    }

    return false
  }

  groupChangesSinceCheckpoint (checkpointId, options) {
    if (this.isBarrierPresentBeforeCheckpoint(checkpointId)) return false

    const operationsSinceCheckpoint = this.collectOperationsSinceCheckpoint(checkpointId, options && options.deleteCheckpoint)
    if (operationsSinceCheckpoint) {
      if (operationsSinceCheckpoint.length > 0) {
        this.undoStack.push(new Transaction(this.getNow(), operationsSinceCheckpoint))
        return this.deltaForOperations(operationsSinceCheckpoint)
      } else {
        return []
      }
    } else {
      return false
    }
  }

  revertToCheckpoint (checkpointId, options) {
    if (this.isBarrierPresentBeforeCheckpoint(checkpointId)) return false

    const operationsSinceCheckpoint = this.collectOperationsSinceCheckpoint(checkpointId, options && options.deleteCheckpoint)
    if (operationsSinceCheckpoint) {
      return this.undoOrRedoOperations(operationsSinceCheckpoint)
    } else {
      return false
    }
  }

  getChangesSinceCheckpoint (checkpointId) {
    const operationsSinceCheckpoint = this.collectOperationsSinceCheckpoint(checkpointId)
    if (operationsSinceCheckpoint) {
      return this.deltaForOperations(operationsSinceCheckpoint)
    } else {
      return false
    }
  }

  collectOperationsSinceCheckpoint (checkpointId, deleteCheckpoint) {
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
      return null
    } else {
      if (!deleteCheckpoint) checkpointIndex++
      this.undoStack.splice(checkpointIndex)
      return operationsSinceCheckpoint
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

  undoOrRedoOperation (operation) {
    const {operations, changes} = this.undoOrRedoOperations([operation])
    return {
      operation: operations[0],
      changes
    }
  }

  undoOrRedoOperations (operationsToUndo) {
    const undoOperations = []
    const oldUndoCounts = new Map()

    for (var i = 0; i < operationsToUndo.length; i++) {
      const opId = operationsToUndo[i].opId
      const newUndoCount = (this.undoCountsByOpId.get(opIdToString(opId)) || 0) + 1
      this.updateUndoCount(opId, newUndoCount, oldUndoCounts)
      undoOperations.push({type: 'undo', opId, undoCount: newUndoCount})
    }

    return {
      operations: undoOperations,
      changes: this.deltaForOperations(undoOperations, oldUndoCounts)
    }
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
    const operationIds = new Set()
    let oldUndoCounts

    if (this.canIntegrateOperation(operation)) {
      const operations = [operation]
      let i = 0

      while (i < operations.length) {
        const operation = operations[i++]
        const operationIdString = opIdToString(operation.opId)
        operationIds.add(operationIdString)
        switch (operation.type) {
          case 'insert':
            this.insertRemote(operation)
            break
          case 'delete':
            this.deleteRemote(operation)
            break
          case 'undo':
            if (!oldUndoCounts) oldUndoCounts = new Map()
            this.undoRemote(operation, oldUndoCounts)
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

      return this.deltaForOperations(operations, oldUndoCounts)
    } else {
      this.deferOperation(operation)
      return []
    }
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

  insertRemote (operation) {
    const {opId, text, leftDependencyId, offsetInLeftDependency, rightDependencyId, offsetInRightDependency} = operation
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

    const left = this.findSegmentStart(leftDependencyId, offsetInLeftDependency)
    const right = this.findSegmentEnd(rightDependencyId, offsetInRightDependency)
    let segment = left
    while (true) {
      const maxSeq = maxSeqsBySite[segment.opId.site] || 0
      if (segment.opId.seq <= maxSeq) {
        this.documentTree.splayNode(segment)
        segment.deletions.add(opIdString)
        this.documentTree.updateSubtreeExtent(segment)
      }

      if (segment === right) break
      segment = this.documentTree.getSuccessor(segment)
    }
  }

  undoRemote ({opId, undoCount}, oldUndoCounts) {
    return this.updateUndoCount(opId, undoCount, oldUndoCounts)
  }

  updateUndoCount (opId, newUndoCount, oldUndoCounts) {
    const opIdString = opIdToString(opId)
    const previousUndoCount = this.undoCountsByOpId.get(opIdString) || 0
    if (newUndoCount <= previousUndoCount) return

    oldUndoCounts.set(opIdString, previousUndoCount)
    this.undoCountsByOpId.set(opIdString, newUndoCount)

    const segmentsToUpdate = new Set()
    this.collectSegments(opIdString, segmentsToUpdate)

    segmentsToUpdate.forEach((segment) => {
      const wasVisible = this.isSegmentVisible(segment, oldUndoCounts)
      const isVisible = this.isSegmentVisible(segment)
      if (isVisible !== wasVisible) {
        this.documentTree.splayNode(segment, oldUndoCounts)
        this.documentTree.updateSubtreeExtent(segment)
      }
    })
  }

  deltaForOperations (operations, oldUndoCounts) {
    const newOperationIds = new Set()
    const segmentStartPositions = new Map()
    const segmentIndices = new Map()

    for (let i = 0; i < operations.length; i++) {
      const operation = operations[i]
      const opIdString = opIdToString(operation.opId)
      if (operation.type !== 'undo') newOperationIds.add(opIdString)
      this.collectSegments(opIdString, null, segmentIndices, segmentStartPositions)
    }

    return this.computeChangesForSegments(segmentIndices, segmentStartPositions, oldUndoCounts, newOperationIds)
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

  collectSegments (opIdString, segments, segmentIndices, segmentStartPositions) {
    const insertionSplitTree = this.splitTreesByOpId.get(opIdString)
    if (insertionSplitTree) {
      let segment = insertionSplitTree.getStart()
      while (segment) {
        if (segments) {
          segments.add(segment)
        } else {
          segmentStartPositions.set(segment, this.documentTree.getSegmentPosition(segment))
          segmentIndices.set(segment, this.documentTree.getSegmentIndex(segment))
        }
        segment = insertionSplitTree.getSuccessor(segment)
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
          if (segments) {
            segments.add(segment)
          } else {
            segmentStartPositions.set(segment, this.documentTree.getSegmentPosition(segment))
            segmentIndices.set(segment, this.documentTree.getSegmentIndex(segment))
          }
        }

        if (segment === right) break
        segment = this.documentTree.getSuccessor(segment)
      }
    }
  }

  computeChangesForSegments (segmentIndices, segmentStartPositions, oldUndoCounts, newOperations) {
    const orderedSegments = Array.from(segmentIndices.keys()).sort((s1, s2) => {
      return segmentIndices.get(s1) - segmentIndices.get(s2)
    })

    const changes = []

    let lastChange
    for (let i = 0; i < orderedSegments.length; i++) {
      const segment = orderedSegments[i]
      const visibleBefore = this.isSegmentVisible(segment, oldUndoCounts, newOperations)
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
  constructor (id, isBarrier) {
    this.id = id
    this.isBarrier = isBarrier
  }
}

class Transaction {
  constructor (timestamp, operations) {
    this.timestamp = timestamp
    this.operations = operations
  }
}
