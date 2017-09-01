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
    this.markerLayersBySiteId = new Map([[this.siteId, new Map()]])
    this.deferredOperationsByDependencyId = new Map()
    this.deferredResolutionsByDependencyId = new Map()
    this.deferredMarkerUpdates = new Map()
    this.deferredMarkerUpdatesByDependencyId = new Map()
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

  updateMarkerLayers (layerUpdatesById) {
    const operation = {
      type: 'marker-layers-update',
      siteId: this.siteId,
      updates: {}
    }

    const layers = this.markerLayersBySiteId.get(this.siteId)
    for (let layerId in layerUpdatesById) {
      const layerUpdate = layerUpdatesById[layerId]
      layerId = parseInt(layerId)
      let layer = layers.get(layerId)

      if (layerUpdate === null) {
        if (layer) {
          layers.delete(layerId)
          operation.updates[layerId] = null
        }
      } else {
        if (!layer) {
          layer = new Map()
          layers.set(layerId, layer)
        }

        operation.updates[layerId] = {}
        for (let markerId in layerUpdate) {
          const markerUpdate = layerUpdate[markerId]
          markerId = parseInt(markerId)
          let marker = layer.get(markerId)

          if (markerUpdate) {
            if (!marker) {
              marker = {exclusive: false, reversed: false, tailed: true}
              layer.set(markerId, marker)
            }

            const updatedExclusivity = marker.exclusive !== markerUpdate.exclusive
            Object.assign(marker, markerUpdate)
            if (markerUpdate.range || updatedExclusivity) {
              marker.range = this.getLogicalRange(markerUpdate.range || marker.range, marker.exclusive)
            }
            operation.updates[layerId][markerId] = Object.assign({}, marker)
          } else {
            layer.delete(markerId)
            operation.updates[layerId][markerId] = null
          }
        }
      }
    }

    return [operation]
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

  groupChangesSinceCheckpoint (checkpointId, options) {
    const operationsSinceCheckpoint = this.collectOperationsSinceCheckpoint(checkpointId, options && options.deleteCheckpoint)
    if (operationsSinceCheckpoint) {
      if (operationsSinceCheckpoint.length > 0) {
        this.undoStack.push(new Transaction(this.getNow(), operationsSinceCheckpoint))
        return this.textUpdatesForOperations(operationsSinceCheckpoint)
      } else {
        return []
      }
    } else {
      return false
    }
  }

  revertToCheckpoint (checkpointId, options) {
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
      return this.textUpdatesForOperations(operationsSinceCheckpoint)
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
      textUpdates: this.textUpdatesForOperations(undoOperations, oldUndoCounts)
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
      case 'marker-layers-update':
        return true
      default:
        throw new Error('Unknown operation type')
    }
  }

  integrateOperations (operations) {
    const integratedOperations = []
    let oldUndoCounts
    let i = 0
    while (i < operations.length) {
      const operation = operations[i++]
      if (this.canIntegrateOperation(operation)) {
        integratedOperations.push(operation)
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
        this.collectDeferredOperations(operation, operations)
      } else {
        this.deferOperation(operation)
      }
    }

    const textUpdates = this.textUpdatesForOperations(integratedOperations, oldUndoCounts)
    const markerUpdates = this.updateMarkersForOperations(integratedOperations)

    return {textUpdates, markerUpdates}
  }

  collectDeferredOperations (operation, operations) {
    if (operation.opId) {
      const opIdString = opIdToString(operation.opId)
      const dependentOps = this.deferredOperationsByDependencyId.get(opIdString)
      if (dependentOps) {
        dependentOps.forEach((dependentOp) => {
          if (this.canIntegrateOperation(dependentOp)) {
            operations.push(dependentOp)
          }
        })
        this.deferredOperationsByDependencyId.delete(opIdString)
      }
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

  getMarkerLayersForSiteId (siteId) {
    let layers = this.markerLayersBySiteId.get(siteId)
    if (!layers) {
      layers = new Map()
      this.markerLayersBySiteId.set(siteId, layers)
    }
    return layers
  }

  deferMarkerUpdate (siteId, layerId, markerId, markerUpdate) {
    const {range} = markerUpdate
    const deferredMarkerUpdate = {siteId, layerId, markerId}
    this.addOperationDependency(this.deferredMarkerUpdatesByDependencyId, range.startDependencyId, deferredMarkerUpdate)
    this.addOperationDependency(this.deferredMarkerUpdatesByDependencyId, range.endDependencyId, deferredMarkerUpdate)

    let deferredUpdatesByLayerId = this.deferredMarkerUpdates.get(siteId)
    if (!deferredUpdatesByLayerId) {
      deferredUpdatesByLayerId = new Map()
      this.deferredMarkerUpdates.set(siteId, deferredUpdatesByLayerId)
    }
    let deferredUpdatesByMarkerId = deferredUpdatesByLayerId.get(layerId)
    if (!deferredUpdatesByMarkerId) {
      deferredUpdatesByMarkerId = new Map()
      deferredUpdatesByLayerId.set(layerId, deferredUpdatesByMarkerId)
    }
    deferredUpdatesByMarkerId.set(markerId, markerUpdate)
  }

  updateMarkersForOperations (operations) {
    const markerUpdates = {}

    for (let i = 0; i < operations.length; i++) {
      const operation = operations[i]

      if (operation.type === 'marker-layers-update') {
        this.integrateMarkerUpdates(markerUpdates, operation)
      } else if (operation.type === 'insert') {
        this.integrateDeferredMarkerUpdates(markerUpdates, operation)
      }
    }

    return markerUpdates
  }

  integrateMarkerUpdates (markerUpdates, {siteId, updates}) {
    const layers = this.getMarkerLayersForSiteId(siteId)
    if (!markerUpdates[siteId]) markerUpdates[siteId] = {}

    for (let layerId in updates) {
      const updatesByMarkerId = updates[layerId]
      layerId = parseInt(layerId)

      let layer = layers.get(layerId)
      if (updatesByMarkerId) {
        if (!layer) {
          layer = new Map()
          layers.set(layerId, layer)
        }

        if (!markerUpdates[siteId][layerId]) markerUpdates[siteId][layerId] = {}

        for (let markerId in updatesByMarkerId) {
          const markerUpdate = updatesByMarkerId[markerId]
          markerId = parseInt(markerId)

          if (markerUpdate) {
            if (markerUpdate.range && !this.canTranslateRemoteRange(markerUpdate.range)) {
              this.deferMarkerUpdate(siteId, layerId, markerId, markerUpdate)
            } else {
              this.integrateMarkerUpdate(markerUpdates, siteId, layerId, markerId, markerUpdate)
            }
          } else {
            if (layer.has(markerId)) {
              layer.delete(markerId)
              markerUpdates[siteId][layerId][markerId] = null
            }

            const deferredUpdatesByLayerId = this.deferredMarkerUpdates.get(siteId)
            if (deferredUpdatesByLayerId) {
              const deferredUpdatesByMarkerId = deferredUpdatesByLayerId.get(layerId)
              if (deferredUpdatesByMarkerId) {
                deferredUpdatesByMarkerId.delete(markerId)
              }
            }
          }
        }
      } else {
        if (layer) {
          markerUpdates[siteId][layerId] = null
          layers.delete(layerId)
        }

        const deferredUpdatesByLayerId = this.deferredMarkerUpdates.get(siteId)
        if (deferredUpdatesByLayerId) {
          deferredUpdatesByLayerId.delete(layerId)
        }
      }
    }
  }

  integrateDeferredMarkerUpdates (markerUpdates, {opId}) {
    const opIdString = opIdToString(opId)
    const dependentMarkerUpdates = this.deferredMarkerUpdatesByDependencyId.get(opIdString)
    if (dependentMarkerUpdates) {
      dependentMarkerUpdates.forEach(({siteId, layerId, markerId}) => {
        const deferredUpdatesByLayerId = this.deferredMarkerUpdates.get(siteId)
        if (deferredUpdatesByLayerId) {
          const deferredUpdatesByMarkerId = deferredUpdatesByLayerId.get(layerId)
          if (deferredUpdatesByMarkerId) {
            const deferredUpdate = deferredUpdatesByMarkerId.get(markerId)
            if (deferredUpdate && this.canTranslateRemoteRange(deferredUpdate.range)) {
              this.integrateMarkerUpdate(markerUpdates, siteId, layerId, markerId, deferredUpdate)
            }
          }
        }
      })
      this.deferredMarkerUpdatesByDependencyId.delete(opIdString)
    }
  }

  integrateMarkerUpdate (markerUpdates, siteId, layerId, markerId, update) {
    let layer = this.markerLayersBySiteId.get(siteId).get(layerId)
    if (!layer) {
      layer = new Map()
      this.markerLayersBySiteId.get(siteId).set(layerId, layer)
    }

    let marker = layer.get(markerId)
    if (!marker) {
      marker = {}
      layer.set(markerId, marker)
    }

    Object.assign(marker, update)

    if (!markerUpdates[siteId]) markerUpdates[siteId] = {}
    if (!markerUpdates[siteId][layerId]) markerUpdates[siteId][layerId] = {}
    markerUpdates[siteId][layerId][markerId] = Object.assign({}, marker)
    markerUpdates[siteId][layerId][markerId].range = this.resolveLogicalRange(marker.range, marker.exclusive)

    const deferredUpdatesByLayerId = this.deferredMarkerUpdates.get(siteId)
    if (deferredUpdatesByLayerId) {
      const deferredUpdatesByMarkerId = deferredUpdatesByLayerId.get(layerId)
      if (deferredUpdatesByMarkerId) {
        if (deferredUpdatesByMarkerId.has(markerId)) {
          deferredUpdatesByMarkerId.delete(markerId)
          if (deferredUpdatesByMarkerId.size === 0) {
            deferredUpdatesByLayerId.delete(layerId)
            if (deferredUpdatesByLayerId.size === 0) {
              this.deferredMarkerUpdates.delete(siteId)
            }
          }
        }
      }
    }
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

  textUpdatesForOperations (operations, oldUndoCounts) {
    const newOperationIds = new Set()
    const segmentStartPositions = new Map()
    const segmentIndices = new Map()

    for (let i = 0; i < operations.length; i++) {
      const operation = operations[i]
      if (operation.type === 'marker-layers-update') continue
      const opIdString = opIdToString(operation.opId)
      if (operation.type !== 'undo') newOperationIds.add(opIdString)
      this.collectSegments(opIdString, null, segmentIndices, segmentStartPositions)
    }

    return this.computeChangesForSegments(segmentIndices, segmentStartPositions, oldUndoCounts, newOperationIds)
  }

  canTranslateRemoteRange ({startDependencyId, endDependencyId}) {
    return (
      this.hasAppliedOperation(startDependencyId) &&
      this.hasAppliedOperation(endDependencyId)
    )
  }

  getLogicalRange ({start, end}, exclusive) {
    const {segment: startDependency, offset: offsetInStartDependency} = this.findSegment(start, exclusive)
    const {segment: endDependency, offset: offsetInEndDependency} = this.findSegment(end, !exclusive || compare(start, end) === 0)

    return {
      startDependencyId: startDependency.opId,
      offsetInStartDependency,
      endDependencyId: endDependency.opId,
      offsetInEndDependency
    }
  }

  resolveLogicalRange (logicalRange, exclusive) {
    const {
      startDependencyId, offsetInStartDependency,
      endDependencyId, offsetInEndDependency
    } = logicalRange
    return {
      start: this.resolveLogicalPosition(startDependencyId, offsetInStartDependency, exclusive),
      end: this.resolveLogicalPosition(endDependencyId, offsetInEndDependency, !exclusive || isEmptyLogicalRange(logicalRange))
    }
  }

  resolveLogicalPosition (opId, offset, preferStart) {
    const splitTree = this.splitTreesByOpId.get(opIdToString(opId))
    let segment = splitTree.findSegmentContainingOffset(offset)
    const nextSegmentOffset = traverse(segment.offset, segment.extent)
    if (preferStart && compare(offset, nextSegmentOffset) === 0) {
      segment = splitTree.getSuccessor(segment) || segment
    }
    const segmentStart = this.documentTree.getSegmentPosition(segment)

    if (this.isSegmentVisible(segment)) {
      return traverse(segmentStart, traversal(offset, segment.offset))
    } else {
      return segmentStart
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

  findSegment (position, preferStart) {
    let {segment, start, end} = this.documentTree.findSegmentContainingPosition(position)
    let offset = traverse(segment.offset, traversal(position, start))
    if (preferStart && compare(position, end) === 0) {
      segment = this.documentTree.getSuccessor(segment)
      offset = segment.offset
    }
    return {segment, offset}
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

function isEmptyLogicalRange ({startDependencyId, offsetInStartDependency, endDependencyId, offsetInEndDependency}) {
  return (
    opIdsEqual(startDependencyId, endDependencyId) &&
    compare(offsetInStartDependency, offsetInEndDependency) === 0
  )
}

function opIdsEqual (a, b) {
  return a.site === b.site && a.seq === b.seq
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
