const assert = require('assert')
const DocumentTree = require('./document-tree')
const SplitTree = require('./split-tree')
const {ZERO_POINT, compare, traverse, traversal, characterIndexForPosition, extentForText} = require('./point-helpers')

module.exports =
class Document {
  constructor ({siteId, text, history}) {
    assert(siteId !== 0, 'siteId 0 is reserved')
    this.siteId = siteId
    this.nextSequenceNumber = 1
    this.splitTreesBySpliceId = new Map()
    this.deletionsBySpliceId = new Map()
    this.undoCountsBySpliceId = new Map()
    this.markerLayersBySiteId = new Map([[this.siteId, new Map()]])
    this.deferredOperationsByDependencyId = new Map()
    this.deferredResolutionsByDependencyId = new Map()
    this.deferredMarkerUpdates = new Map()
    this.deferredMarkerUpdatesByDependencyId = new Map()
    this.maxSeqsBySite = {}
    this.operations = []
    this.undoStack = []
    this.redoStack = []
    this.nextCheckpointId = 1

    const firstSegment = {spliceId: {site: 0, seq: 0}, offset: ZERO_POINT, text: '', extent: ZERO_POINT, nextSplit: null, deletions: new Set()}
    this.splitTreesBySpliceId.set(spliceIdToString(firstSegment.spliceId), new SplitTree(firstSegment))

    const lastSegment = {spliceId: {site: 0, seq: 1}, offset: ZERO_POINT, text: '', extent: ZERO_POINT, nextSplit: null, deletions: new Set()}
    this.splitTreesBySpliceId.set(spliceIdToString(lastSegment.spliceId), new SplitTree(lastSegment))

    this.documentTree = new DocumentTree(
      firstSegment,
      lastSegment,
      this.isSegmentVisible.bind(this)
    )

    if (text) {
      this.setTextInRange(ZERO_POINT, ZERO_POINT, text)
      this.undoStack.length = 0
    } else if (history) {
      this.populateHistory(history)
    }
  }

  populateHistory ({baseText, nextCheckpointId, undoStack, redoStack}) {
    this.setTextInRange(ZERO_POINT, ZERO_POINT, baseText)
    this.nextCheckpointId = nextCheckpointId

    const newUndoStack = []
    const allEntries = undoStack.concat(redoStack.slice().reverse())
    for (let i = 0; i < allEntries.length; i++) {
      const {type, changes, markersBefore, markersAfter, id, markers} = allEntries[i]
      if (type === 'transaction') {
        const operations = []
        const markersSnapshotBefore = this.snapshotFromMarkers(markersBefore)
        for (let j = changes.length - 1; j >= 0; j--) {
          const {oldStart, oldEnd, newText} = changes[j]
          operations.push(...this.setTextInRange(oldStart, oldEnd, newText))
        }
        const markersSnapshotAfter = this.snapshotFromMarkers(markersAfter)
        newUndoStack.push(new Transaction(0, operations, markersSnapshotBefore, markersSnapshotAfter))
      } else if (type === 'checkpoint') {
        newUndoStack.push(new Checkpoint(id, false, this.snapshotFromMarkers(markers)))
      } else {
        throw new Error(`Unknown entry type '${type}'`)
      }
    }

    this.undoStack = newUndoStack
    for (let i = 0; i < redoStack.length; i++) {
      if (redoStack[i].type === 'transaction') this.undo()
    }
  }

  replicate (siteId) {
    const replica = new Document({siteId})
    replica.integrateOperations(this.getOperations())
    return replica
  }

  getOperations () {
    const markerOperations = []
    this.markerLayersBySiteId.forEach((layersById, siteId) => {
      const siteMarkerLayers = {}
      layersById.forEach((markersById, layerId) => {
        const layer = {}
        markersById.forEach((marker, markerId) => {
          layer[markerId] = marker
        })
        siteMarkerLayers[layerId] = layer
      })

      markerOperations.push({
        type: 'markers-update',
        updates: siteMarkerLayers,
        siteId
      })
    })

    return this.operations.concat(markerOperations)
  }

  setTextInRange (start, end, text, options) {
    const spliceId = {site: this.siteId, seq: this.nextSequenceNumber}
    const operation = {type: 'splice', spliceId}

    if (compare(end, start) > 0) {
      operation.deletion = this.delete(spliceId, start, end)
    }
    if (text && text.length > 0) {
      operation.insertion = this.insert(spliceId, start, text)
    }
    this.updateMaxSeqsBySite(spliceId)

    this.undoStack.push(new Transaction(this.getNow(), [operation]))
    this.clearRedoStack()

    this.operations.push(operation)
    return [operation]
  }

  getMarkers () {
    const result = {}
    this.markerLayersBySiteId.forEach((layersById, siteId) => {
      if (layersById.size > 0) {
        result[siteId] = {}
        layersById.forEach((markersById, layerId) => {
          result[siteId][layerId] = {}
          markersById.forEach((marker, markerId) => {
            const resultMarker = Object.assign({}, marker)
            resultMarker.range = this.resolveLogicalRange(marker.range, marker.exclusive)

            result[siteId][layerId][markerId] = resultMarker
          })
        })
      }
    })
    return result
  }

  updateMarkers (layerUpdatesById) {
    const operation = {
      type: 'markers-update',
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
            if (marker) {
              marker = Object.assign({}, marker)
            } else {
              marker = {exclusive: false, reversed: false, tailed: true}
            }

            const updatingExclusive = marker.exclusive !== markerUpdate.exclusive
            Object.assign(marker, markerUpdate)
            if (markerUpdate.range || updatingExclusive) {
              marker.range = this.getLogicalRange(markerUpdate.range || marker.range, marker.exclusive)
            }
            Object.freeze(marker)
            layer.set(markerId, marker)
            operation.updates[layerId][markerId] = marker
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
    let markersSnapshot
    for (let i = this.undoStack.length - 1; i >=0; i--) {
      const stackEntry = this.undoStack[i]
      if (stackEntry instanceof Transaction) {
        operationsToUndo = stackEntry.operations
        markersSnapshot = stackEntry.markersSnapshotBefore
        spliceIndex = i
        break
      } else if (stackEntry instanceof Checkpoint && stackEntry.isBarrier) {
        return null
      }
    }

    if (spliceIndex != null) {
      this.redoStack.push(...this.undoStack.splice(spliceIndex).reverse())
      const {operations, textUpdates} = this.undoOrRedoOperations(operationsToUndo)
      let markers = this.markersFromSnapshot(markersSnapshot)
      return {operations, textUpdates, markers}
    } else {
      return null
    }
  }

  redo () {
    let spliceIndex = null
    let operationsToRedo = []
    let markersSnapshot
    for (let i = this.redoStack.length - 1; i >= 0; i--) {
      const stackEntry = this.redoStack[i]
      if (stackEntry instanceof Transaction) {
        operationsToRedo = stackEntry.operations
        markersSnapshot = stackEntry.markersSnapshotAfter
        spliceIndex = i
        break
      }
    }

    while (this.redoStack[spliceIndex - 1] instanceof Checkpoint) {
      spliceIndex--
    }

    if (spliceIndex != null) {
      this.undoStack.push(...this.redoStack.splice(spliceIndex).reverse())
      const {operations, textUpdates} = this.undoOrRedoOperations(operationsToRedo)
      const markers = markersSnapshot ? this.markersFromSnapshot(markersSnapshot) : null
      return {operations, textUpdates, markers}
    } else {
      return null
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
        previousEntry.groupingInterval = groupingInterval
        previousEntry.operations.push(...topEntry.operations)
        previousEntry.markersSnapshotAfter = topEntry.markersSnapshotAfter
      }
    }
  }

  getNow () {
    return Date.now()
  }

  createCheckpoint (options) {
    const checkpoint = new Checkpoint(
      this.nextCheckpointId++,
      options && options.isBarrier,
      options && this.snapshotFromMarkers(options.markers)
    )
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

    const result = this.collectOperationsSinceCheckpoint(checkpointId, true, options && options.deleteCheckpoint)
    if (result) {
      const {operations, markersSnapshot}  = result
      if (operations.length > 0) {
        this.undoStack.push(new Transaction(
          this.getNow(),
          operations,
          markersSnapshot,
          options && this.snapshotFromMarkers(options.markers)
        ))
        return this.textUpdatesForOperations(operations)
      } else {
        return []
      }
    } else {
      return false
    }
  }

  revertToCheckpoint (checkpointId, options) {
    if (this.isBarrierPresentBeforeCheckpoint(checkpointId)) return false

    const collectResult = this.collectOperationsSinceCheckpoint(checkpointId, true, options && options.deleteCheckpoint)
    if (collectResult) {
      const {operations, textUpdates} = this.undoOrRedoOperations(collectResult.operations)
      const markers = this.markersFromSnapshot(collectResult.markersSnapshot)
      return {operations, textUpdates, markers}
    } else {
      return false
    }
  }

  getChangesSinceCheckpoint (checkpointId) {
    const result = this.collectOperationsSinceCheckpoint(checkpointId, false, false)
    if (result) {
      return this.textUpdatesForOperations(result.operations)
    } else {
      return false
    }
  }

  collectOperationsSinceCheckpoint (checkpointId, deleteOperations, deleteCheckpoint) {
    let checkpointIndex = -1
    const operations = []
    for (let i = this.undoStack.length - 1; i >= 0; i--) {
      const stackEntry = this.undoStack[i]
      if (stackEntry instanceof Checkpoint) {
        if (stackEntry.id === checkpointId) {
          checkpointIndex = i
          break
        }
      } else if (stackEntry instanceof Transaction) {
        operations.push(...stackEntry.operations)
      } else {
        throw new Error('Unknown stack entry ' + stackEntry.constructor.name)
      }
    }

    if (checkpointIndex === -1) {
      return null
    } else {
      const {markersSnapshot} = this.undoStack[checkpointIndex]
      if (deleteOperations) {
        if (!deleteCheckpoint) checkpointIndex++
        this.undoStack.splice(checkpointIndex)
      }
      return {operations, markersSnapshot}
    }
  }

  getHistory (maxEntries) {
    const originalUndoCounts = new Map(this.undoCountsBySpliceId)

    const redoStack = []
    for (let i = this.redoStack.length - 1; i >= 0; i--) {
      const entry = this.redoStack[i]
      if (entry instanceof Transaction) {
        const markersBefore = this.markersFromSnapshot(entry.markersSnapshotBefore)
        const changes = this.undoOrRedoOperations(entry.operations).textUpdates
        const markersAfter = this.markersFromSnapshot(entry.markersSnapshotAfter)
        redoStack.push({type: 'transaction', changes, markersBefore, markersAfter})
      } else {
        redoStack.push({
          type: 'checkpoint',
          id: entry.id,
          markers: this.markersFromSnapshot(entry.markersSnapshot)
        })
      }
      if (redoStack.length === maxEntries) break
    }
    redoStack.reverse()

    // Undo operations we redid above while computing changes
    for (let i = this.redoStack.length - 1; i >= this.redoStack.length - redoStack.length; i--) {
      const entry = this.redoStack[i]
      if (entry instanceof Transaction) {
        this.undoOrRedoOperations(entry.operations)
      }
    }

    const undoStack = []
    for (let i = this.undoStack.length - 1; i >= 0; i--) {
      const entry = this.undoStack[i]
      if (entry instanceof Transaction) {
        const markersAfter = this.markersFromSnapshot(entry.markersSnapshotAfter)
        const changes = invertTextUpdates(this.undoOrRedoOperations(entry.operations).textUpdates)
        const markersBefore = this.markersFromSnapshot(entry.markersSnapshotBefore)
        undoStack.push({type: 'transaction', changes, markersBefore, markersAfter})
      } else {
        undoStack.push({
          type: 'checkpoint',
          id: entry.id,
          markers: this.markersFromSnapshot(entry.markersSnapshot)
        })
      }
      if (undoStack.length === maxEntries) break
    }
    undoStack.reverse()

    // Redo operations we undid above while computing changes
    for (let i = this.undoStack.length - 1; i >= this.undoStack.length - undoStack.length; i--) {
      const entry = this.undoStack[i]
      if (entry instanceof Transaction) {
        this.undoOrRedoOperations(entry.operations)
      }
    }

    this.undoCountsBySpliceId = originalUndoCounts

    return {
      nextCheckpointId: this.nextCheckpointId,
      undoStack,
      redoStack
    }
  }

  delete (spliceId, start, end) {
    const spliceIdString = spliceIdToString(spliceId)

    const left = this.findLocalSegmentBoundary(start)[1]
    const right = this.findLocalSegmentBoundary(end)[0]

    const maxSeqsBySite = {}
    let segment = left
    while (true) {
      const maxSeq = maxSeqsBySite[segment.spliceId.site]
      if (maxSeq == null || segment.spliceId.seq > maxSeq) {
        maxSeqsBySite[segment.spliceId.site] = segment.spliceId.seq
      }

      segment.deletions.add(spliceIdString)
      this.documentTree.splayNode(segment)
      this.documentTree.updateSubtreeExtent(segment)
      if (segment === right) break
      segment = this.documentTree.getSuccessor(segment)
    }

    const deletion = {
      spliceId,
      leftDependencyId: left.spliceId,
      offsetInLeftDependency: left.offset,
      rightDependencyId: right.spliceId,
      offsetInRightDependency: traverse(right.offset, right.extent),
      maxSeqsBySite
    }
    this.deletionsBySpliceId.set(spliceIdString, deletion)
    return deletion
  }

  insert (spliceId, position, text) {
    const [left, right] = this.findLocalSegmentBoundary(position)
    const newSegment = {
      spliceId,
      text,
      extent: extentForText(text),
      offset: ZERO_POINT,
      leftDependency: left,
      rightDependency: right,
      nextSplit: null,
      deletions: new Set()
    }
    this.documentTree.insertBetween(left, right, newSegment)
    this.splitTreesBySpliceId.set(spliceIdToString(spliceId), new SplitTree(newSegment))

    return {
      text,
      leftDependencyId: left.spliceId,
      offsetInLeftDependency: traverse(left.offset, left.extent),
      rightDependencyId: right.spliceId,
      offsetInRightDependency: right.offset
    }
  }

  undoOrRedoOperations (operationsToUndo) {
    const undoOperations = []
    const oldUndoCounts = new Map()

    for (var i = 0; i < operationsToUndo.length; i++) {
      const {spliceId} = operationsToUndo[i]
      const newUndoCount = (this.undoCountsBySpliceId.get(spliceIdToString(spliceId)) || 0) + 1
      this.updateUndoCount(spliceId, newUndoCount, oldUndoCounts)
      const operation = {type: 'undo', spliceId, undoCount: newUndoCount}
      undoOperations.push(operation)
      this.operations.push(operation)
    }

    return {
      operations: undoOperations,
      textUpdates: this.textUpdatesForOperations(undoOperations, oldUndoCounts)
    }
  }

  isSpliceUndone ({spliceId}) {
    const undoCount = this.undoCountsBySpliceId.get(spliceIdToString(spliceId))
    return undoCount != null && (undoCount & 1 === 1)
  }

  canIntegrateOperation (op) {
    switch (op.type) {
      case 'splice': {
        const {spliceId, deletion, insertion} = op

        if ((this.maxSeqsBySite[spliceId.site] || 0) !== spliceId.seq - 1) {
          return false
        }

        if (deletion) {
          const hasLeftAndRightDependencies = (
            this.splitTreesBySpliceId.has(spliceIdToString(deletion.leftDependencyId)) &&
            this.splitTreesBySpliceId.has(spliceIdToString(deletion.rightDependencyId))
          )
          if (!hasLeftAndRightDependencies) return false

          for (const site in deletion.maxSeqsBySite) {
            if (deletion.maxSeqsBySite[site] > (this.maxSeqsBySite[site] || 0)) {
              return false
            }
          }
        }

        if (insertion) {
          const hasLeftAndRightDependencies = (
            this.splitTreesBySpliceId.has(spliceIdToString(insertion.leftDependencyId)) &&
            this.splitTreesBySpliceId.has(spliceIdToString(insertion.rightDependencyId))
          )
          if (!hasLeftAndRightDependencies) return false
        }

        return true
      }
      case 'undo': {
        const spliceIdString = spliceIdToString(op.spliceId)
        return (
          this.splitTreesBySpliceId.has(spliceIdString) ||
          this.deletionsBySpliceId.has(spliceIdString)
        )
      }
      case 'markers-update':
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
      if (operation.type !== 'markers-update') this.operations.push(operation)

      if (this.canIntegrateOperation(operation)) {
        integratedOperations.push(operation)
        switch (operation.type) {
          case 'splice':
            if (operation.deletion) this.integrateDeletion(operation.spliceId, operation.deletion)
            if (operation.insertion) this.integrateInsertion(operation.spliceId, operation.insertion)
            this.updateMaxSeqsBySite(operation.spliceId)
            break
          case 'undo':
            if (!oldUndoCounts) oldUndoCounts = new Map()
            this.integrateUndo(operation, oldUndoCounts)
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

  collectDeferredOperations ({spliceId}, operations) {
    if (spliceId) {
      const spliceIdString = spliceIdToString(spliceId)
      const dependentOps = this.deferredOperationsByDependencyId.get(spliceIdString)
      if (dependentOps) {
        dependentOps.forEach((dependentOp) => {
          if (this.canIntegrateOperation(dependentOp)) {
            operations.push(dependentOp)
          }
        })
        this.deferredOperationsByDependencyId.delete(spliceIdString)
      }
    }
  }

  deferOperation (op) {
    if (op.type === 'splice') {
      const {spliceId, deletion, insertion} = op
      this.addOperationDependency(this.deferredOperationsByDependencyId, {site: spliceId.site, seq: spliceId.seq - 1}, op)

      if (deletion) {
        this.addOperationDependency(this.deferredOperationsByDependencyId, deletion.leftDependencyId, op)
        this.addOperationDependency(this.deferredOperationsByDependencyId, deletion.rightDependencyId, op)
        for (const site in deletion.maxSeqsBySite) {
          const seq = deletion.maxSeqsBySite[site]
          this.addOperationDependency(this.deferredOperationsByDependencyId, {site, seq}, op)
        }
      }

      if (insertion) {
        this.addOperationDependency(this.deferredOperationsByDependencyId, insertion.leftDependencyId, op)
        this.addOperationDependency(this.deferredOperationsByDependencyId, insertion.rightDependencyId, op)
      }
    } else if (op.type === 'undo') {
      this.addOperationDependency(this.deferredOperationsByDependencyId, op.spliceId, op)
    } else {
      throw new Error('Unknown operation type: ' + op.type)
    }
  }

  addOperationDependency (map, dependencyId, op) {
    const dependencyIdString = spliceIdToString(dependencyId)
    if (!this.hasAppliedSplice(dependencyId)) {
      let deferredOps = map.get(dependencyIdString)
      if (!deferredOps) {
        deferredOps = new Set()
        map.set(dependencyIdString, deferredOps)
      }
      deferredOps.add(op)
    }
  }

  hasAppliedSplice (spliceId) {
    const spliceIdString = spliceIdToString(spliceId)
    return (
      this.splitTreesBySpliceId.has(spliceIdString) ||
      this.deletionsBySpliceId.has(spliceIdString)
    )
  }

  integrateInsertion (spliceId, operation) {
    const {text, leftDependencyId, offsetInLeftDependency, rightDependencyId, offsetInRightDependency} = operation

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
        if (spliceId.site < currentSegment.spliceId.site) {
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
      spliceId,
      offset: ZERO_POINT,
      text,
      extent: extentForText(text),
      leftDependency: originalLeftDependency,
      rightDependency: originalRightDependency,
      nextSplit: null,
      deletions: new Set()
    }
    this.documentTree.insertBetween(leftDependency, rightDependency, newSegment)
    this.splitTreesBySpliceId.set(spliceIdToString(spliceId), new SplitTree(newSegment))
  }

  integrateDeletion (spliceId, deletion) {
    const {
      leftDependencyId, offsetInLeftDependency,
      rightDependencyId, offsetInRightDependency,
      maxSeqsBySite
    } = deletion

    const spliceIdString = spliceIdToString(spliceId)
    this.deletionsBySpliceId.set(spliceIdString, deletion)

    const left = this.findSegmentStart(leftDependencyId, offsetInLeftDependency)
    const right = this.findSegmentEnd(rightDependencyId, offsetInRightDependency)
    let segment = left
    while (true) {
      const maxSeq = maxSeqsBySite[segment.spliceId.site] || 0
      if (segment.spliceId.seq <= maxSeq) {
        this.documentTree.splayNode(segment)
        segment.deletions.add(spliceIdString)
        this.documentTree.updateSubtreeExtent(segment)
      }

      if (segment === right) break
      segment = this.documentTree.getSuccessor(segment)
    }
  }

  integrateUndo ({spliceId, undoCount}, oldUndoCounts) {
    return this.updateUndoCount(spliceId, undoCount, oldUndoCounts)
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
      if (operation.type === 'markers-update') {
        this.integrateMarkerUpdates(markerUpdates, operation)
      } else if (operation.type === 'splice') {
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
            if (markerUpdate.range && !this.canResolveLogicalRange(markerUpdate.range)) {
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

  integrateDeferredMarkerUpdates (markerUpdates, {spliceId}) {
    const spliceIdString = spliceIdToString(spliceId)
    const dependentMarkerUpdates = this.deferredMarkerUpdatesByDependencyId.get(spliceIdString)
    if (dependentMarkerUpdates) {
      dependentMarkerUpdates.forEach(({siteId, layerId, markerId}) => {
        const deferredUpdatesByLayerId = this.deferredMarkerUpdates.get(siteId)
        if (deferredUpdatesByLayerId) {
          const deferredUpdatesByMarkerId = deferredUpdatesByLayerId.get(layerId)
          if (deferredUpdatesByMarkerId) {
            const deferredUpdate = deferredUpdatesByMarkerId.get(markerId)
            if (deferredUpdate && this.canResolveLogicalRange(deferredUpdate.range)) {
              this.integrateMarkerUpdate(markerUpdates, siteId, layerId, markerId, deferredUpdate)
            }
          }
        }
      })
      this.deferredMarkerUpdatesByDependencyId.delete(spliceIdString)
    }
  }

  integrateMarkerUpdate (markerUpdates, siteId, layerId, markerId, update) {
    let layer = this.markerLayersBySiteId.get(siteId).get(layerId)
    if (!layer) {
      layer = new Map()
      this.markerLayersBySiteId.get(siteId).set(layerId, layer)
    }

    let marker = layer.get(markerId)
    marker = marker ? Object.assign({}, marker) : {}
    Object.assign(marker, update)
    Object.freeze(marker)
    layer.set(markerId, marker)

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

  snapshotFromMarkers (layersById) {
    if (!layersById) return layersById

    const snapshot = {}
    for (const layerId in layersById) {
      const layerSnapshot = {}
      const markersById = layersById[layerId]
      for (const markerId in markersById) {
        const markerSnapshot = Object.assign({}, markersById[markerId])
        markerSnapshot.range = this.getLogicalRange(markerSnapshot.range, markerSnapshot.exclusive)
        layerSnapshot[markerId] = markerSnapshot
      }
      snapshot[layerId] = layerSnapshot
    }
    return snapshot
  }

  markersFromSnapshot (snapshot) {
    if (!snapshot) return snapshot

    const layersById = {}
    for (const layerId in snapshot) {
      const markersById = {}
      const layerSnapshot = snapshot[layerId]
      for (const markerId in layerSnapshot) {
        const marker = Object.assign({}, layerSnapshot[markerId])
        marker.range = this.resolveLogicalRange(marker.range)
        markersById[markerId] = marker
      }
      layersById[layerId] = markersById
    }
    return layersById
  }

  updateUndoCount (spliceId, newUndoCount, oldUndoCounts) {
    const spliceIdString = spliceIdToString(spliceId)
    const previousUndoCount = this.undoCountsBySpliceId.get(spliceIdString) || 0
    if (newUndoCount <= previousUndoCount) return

    oldUndoCounts.set(spliceIdString, previousUndoCount)
    this.undoCountsBySpliceId.set(spliceIdString, newUndoCount)

    const segmentsToUpdate = new Set()
    this.collectSegments(spliceIdString, segmentsToUpdate)

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
    const newSpliceIds = new Set()
    const segmentStartPositions = new Map()
    const segmentIndices = new Map()

    for (let i = 0; i < operations.length; i++) {
      const operation = operations[i]
      const {type, spliceId, deletion, insertion} = operation
      if (spliceId) {
        const spliceIdString = spliceIdToString(spliceId)
        if (type === 'splice') newSpliceIds.add(spliceIdString)
        this.collectSegments(spliceIdString, null, segmentIndices, segmentStartPositions)
      }
    }

    return this.computeChangesForSegments(segmentIndices, segmentStartPositions, oldUndoCounts, newSpliceIds)
  }

  canResolveLogicalRange ({startDependencyId, endDependencyId}) {
    return (
      this.hasAppliedSplice(startDependencyId) &&
      this.hasAppliedSplice(endDependencyId)
    )
  }

  getLogicalRange ({start, end}, exclusive) {
    const {segment: startDependency, offset: offsetInStartDependency} = this.findSegment(start, exclusive)
    const {segment: endDependency, offset: offsetInEndDependency} = this.findSegment(end, !exclusive || compare(start, end) === 0)

    return {
      startDependencyId: startDependency.spliceId,
      offsetInStartDependency,
      endDependencyId: endDependency.spliceId,
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

  resolveLogicalPosition (spliceId, offset, preferStart) {
    const splitTree = this.splitTreesBySpliceId.get(spliceIdToString(spliceId))
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
      const splitTree = this.splitTreesBySpliceId.get(spliceIdToString(segment.spliceId))
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

  findSegmentStart (spliceId, offset) {
    const splitTree = this.splitTreesBySpliceId.get(spliceIdToString(spliceId))
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

  findSegmentEnd (spliceId, offset) {
    const splitTree = this.splitTreesBySpliceId.get(spliceIdToString(spliceId))
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

  collectSegments (spliceIdString, segments, segmentIndices, segmentStartPositions) {
    const insertionSplitTree = this.splitTreesBySpliceId.get(spliceIdString)
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
    }

    const deletion = this.deletionsBySpliceId.get(spliceIdString)
    if (deletion) {
      const {
        leftDependencyId, offsetInLeftDependency,
        rightDependencyId, offsetInRightDependency,
        maxSeqsBySite
      } = deletion

      const left = this.findSegmentStart(leftDependencyId, offsetInLeftDependency)
      const right = this.findSegmentEnd(rightDependencyId, offsetInRightDependency)
      let segment = left
      while (true) {
        const maxSeq = maxSeqsBySite[segment.spliceId.site] || 0
        if (segment.spliceId.seq <= maxSeq) {
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
    const spliceIdString = spliceIdToString(segment.spliceId)

    if (operationsToIgnore && operationsToIgnore.has(spliceIdString)) {
      return false
    }

    let undoCount
    if (undoCountOverrides) {
      undoCount = undoCountOverrides.get(spliceIdString)
    }
    if (undoCount == null) {
      undoCount = this.undoCountsBySpliceId.get(spliceIdString) || 0
    }

    return (
      (undoCount & 1) === 0 &&
      !this.isSegmentDeleted(segment, undoCountOverrides, operationsToIgnore)
    )
  }

  isSegmentDeleted (segment, undoCountOverrides, operationsToIgnore) {
    for (const deletionSpliceIdString of segment.deletions) {
      if (operationsToIgnore && operationsToIgnore.has(deletionSpliceIdString)) {
        continue
      }

      let deletionUndoCount
      if (undoCountOverrides) {
        deletionUndoCount = undoCountOverrides.get(deletionSpliceIdString)
      }
      if (deletionUndoCount == null) {
        deletionUndoCount = this.undoCountsBySpliceId.get(deletionSpliceIdString) || 0
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

function spliceIdToString ({site, seq}) {
  return site + '.' + seq
}

function isEmptyLogicalRange ({startDependencyId, offsetInStartDependency, endDependencyId, offsetInEndDependency}) {
  return (
    spliceIdsEqual(startDependencyId, endDependencyId) &&
    compare(offsetInStartDependency, offsetInEndDependency) === 0
  )
}

function markersEqual (a, b) {
  return (
    logicalRangesEqual(a.range, b.range) &&
    a.exclusive === b.exclusive &&
    a.reversed === b.reversed &&
    a.tailed === b.tailed
  )
}

function logicalRangesEqual (a, b) {
  return (
    spliceIdsEqual(a.startDependencyId, b.startDependencyId) &&
    compare(a.offsetInStartDependency, b.offsetInStartDependency) === 0 &&
    spliceIdsEqual(a.endDependencyId, b.endDependencyId) &&
    compare(a.offsetInEndDependency, b.offsetInEndDependency) === 0
  )
}

function spliceIdsEqual (a, b) {
  return a.site === b.site && a.seq === b.seq
}

function invertTextUpdates (textUpdates) {
  const invertedTextUpdates = []
  for (let i = 0; i < textUpdates.length; i++) {
    const {oldStart, oldEnd, oldText, newStart, newEnd, newText} = textUpdates[i]
    invertedTextUpdates.push({
      oldStart: newStart,
      oldEnd: newEnd,
      oldText: newText,
      newStart: oldStart,
      newEnd: oldEnd,
      newText: oldText
    })
  }
  return invertedTextUpdates
}

class Checkpoint {
  constructor (id, isBarrier, markersSnapshot) {
    this.id = id
    this.isBarrier = isBarrier
    this.markersSnapshot = markersSnapshot
  }
}

class Transaction {
  constructor (timestamp, operations, markersSnapshotBefore, markersSnapshotAfter) {
    this.timestamp = timestamp
    this.operations = operations
    this.markersSnapshotBefore = markersSnapshotBefore
    this.markersSnapshotAfter = markersSnapshotAfter
  }
}
