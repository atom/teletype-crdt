const {Operation} = require('./teletype-crdt_pb')

function serializeOperation (op) {
  const operationMessage = new Operation()
  switch (op.type) {
    case 'splice':
      operationMessage.setSplice(serializeSplice(op))
      break
    case 'undo':
      operationMessage.setUndo(serializeUndo(op))
      break
    case 'markers-update':
      operationMessage.setMarkersUpdate(serializeMarkersUpdate(op))
      break
    default:
      throw new Error('Unknown operation type: ' + op.type)
  }
  return operationMessage
}

function serializeOperationBinary (op) {
  return serializeOperation(op).serializeBinary()
}

function serializeSplice (splice) {
  const spliceMessage = new Operation.Splice()
  spliceMessage.setSpliceId(serializeSpliceId(splice.spliceId))
  if (splice.insertion) {
    spliceMessage.setInsertion(serializeInsertion(splice.insertion))
  }
  if (splice.deletion) {
    spliceMessage.setDeletion(serializeDeletion(splice.deletion))
  }
  return spliceMessage
}

function serializeInsertion (insertion) {
  const insertionMessage = new Operation.Splice.Insertion()
  insertionMessage.setText(insertion.text)
  insertionMessage.setLeftDependencyId(serializeSpliceId(insertion.leftDependencyId))
  insertionMessage.setOffsetInLeftDependency(serializePoint(insertion.offsetInLeftDependency))
  insertionMessage.setRightDependencyId(serializeSpliceId(insertion.rightDependencyId))
  insertionMessage.setOffsetInRightDependency(serializePoint(insertion.offsetInRightDependency))
  return insertionMessage
}

function serializeDeletion (deletion) {
  const deletionMessage = new Operation.Splice.Deletion()
  deletionMessage.setLeftDependencyId(serializeSpliceId(deletion.leftDependencyId))
  deletionMessage.setOffsetInLeftDependency(serializePoint(deletion.offsetInLeftDependency))
  deletionMessage.setRightDependencyId(serializeSpliceId(deletion.rightDependencyId))
  deletionMessage.setOffsetInRightDependency(serializePoint(deletion.offsetInRightDependency))
  const maxSeqsBySiteMessage = deletionMessage.getMaxSeqsBySiteMap()
  for (const site in deletion.maxSeqsBySite) {
    maxSeqsBySiteMessage.set(site, deletion.maxSeqsBySite[site])
  }
  return deletionMessage
}

function serializeUndo (undo) {
  const undoMessage = new Operation.Undo()
  undoMessage.setSpliceId(serializeSpliceId(undo.spliceId))
  undoMessage.setUndoCount(undo.undoCount)
  return undoMessage
}

function serializeMarkersUpdate ({siteId, updates}) {
  const markersUpdateMessage = new Operation.MarkersUpdate()
  markersUpdateMessage.setSiteId(siteId)
  const layerOperationsMessage = markersUpdateMessage.getLayerOperationsMap()
  for (const layerId in updates) {
    const markerUpdates = updates[layerId]
    const layerOperationMessage = new Operation.MarkersUpdate.LayerOperation()
    if (markerUpdates) {
      layerOperationMessage.setIsDeletion(false)
      const markerOperationsMessage = layerOperationMessage.getMarkerOperationsMap()
      for (const markerId in markerUpdates) {
        const markerUpdate = markerUpdates[markerId]
        const markerOperationMessage = new Operation.MarkersUpdate.MarkerOperation()
        if (markerUpdate) {
          markerOperationMessage.setIsDeletion(false)
          const {range, exclusive, reversed, tailed} = markerUpdate
          const markerUpdateMessage = new Operation.MarkersUpdate.MarkerUpdate()
          const logicalRangeMessage = new Operation.MarkersUpdate.LogicalRange()
          logicalRangeMessage.setStartDependencyId(serializeSpliceId(range.startDependencyId))
          logicalRangeMessage.setOffsetInStartDependency(serializePoint(range.offsetInStartDependency))
          logicalRangeMessage.setEndDependencyId(serializeSpliceId(range.endDependencyId))
          logicalRangeMessage.setOffsetInEndDependency(serializePoint(range.offsetInEndDependency))
          markerUpdateMessage.setRange(logicalRangeMessage)
          markerUpdateMessage.setExclusive(exclusive)
          markerUpdateMessage.setReversed(reversed)
          markerUpdateMessage.setTailed(tailed)
          markerOperationMessage.setMarkerUpdate(markerUpdateMessage)
        } else {
          markerOperationMessage.setIsDeletion(true)
        }
        markerOperationsMessage.set(markerId, markerOperationMessage)
      }
    } else {
      layerOperationMessage.setIsDeletion(true)
    }
    layerOperationsMessage.set(layerId, layerOperationMessage)
  }
  return markersUpdateMessage
}

function serializeSpliceId ({site, seq}) {
  const spliceIdMessage = new Operation.SpliceId()
  spliceIdMessage.setSite(site)
  spliceIdMessage.setSeq(seq)
  return spliceIdMessage
}

function serializePoint ({row, column}) {
  const pointMessage = new Operation.Point()
  pointMessage.setRow(row)
  pointMessage.setColumn(column)
  return pointMessage
}

function deserializeOperation (operationMessage) {
  if (operationMessage.hasSplice()) {
    return deserializeSplice(operationMessage.getSplice())
  } else if (operationMessage.hasUndo()) {
    return deserializeUndo(operationMessage.getUndo())
  } else if (operationMessage.hasMarkersUpdate()) {
    return deserializeMarkersUpdate(operationMessage.getMarkersUpdate())
  } else {
    throw new Error('Unknown operation type')
  }
}

function deserializeOperationBinary (data) {
  return deserializeOperation(Operation.deserializeBinary(data))
}

function deserializeSplice (spliceMessage) {
  const insertionMessage = spliceMessage.getInsertion()
  const deletionMessage = spliceMessage.getDeletion()
  return {
    type: 'splice',
    spliceId: deserializeSpliceId(spliceMessage.getSpliceId()),
    insertion: insertionMessage ? deserializeInsertion(insertionMessage) : null,
    deletion: deletionMessage ? deserializeDeletion(deletionMessage) : null
  }
}

function deserializeInsertion (insertionMessage) {
  return {
    text: insertionMessage.getText(),
    leftDependencyId: deserializeSpliceId(insertionMessage.getLeftDependencyId()),
    offsetInLeftDependency: deserializePoint(insertionMessage.getOffsetInLeftDependency()),
    rightDependencyId: deserializeSpliceId(insertionMessage.getRightDependencyId()),
    offsetInRightDependency: deserializePoint(insertionMessage.getOffsetInRightDependency())
  }
}

function deserializeDeletion (deletionMessage) {
  const maxSeqsBySite = {}
  deletionMessage.getMaxSeqsBySiteMap().forEach((seq, site) => {
    maxSeqsBySite[site] = seq
  })
  return {
    leftDependencyId: deserializeSpliceId(deletionMessage.getLeftDependencyId()),
    offsetInLeftDependency: deserializePoint(deletionMessage.getOffsetInLeftDependency()),
    rightDependencyId: deserializeSpliceId(deletionMessage.getRightDependencyId()),
    offsetInRightDependency: deserializePoint(deletionMessage.getOffsetInRightDependency()),
    maxSeqsBySite
  }
}

function deserializeUndo (undoMessage) {
  return {
    type: 'undo',
    spliceId: deserializeSpliceId(undoMessage.getSpliceId()),
    undoCount: undoMessage.getUndoCount()
  }
}

function deserializeMarkersUpdate (markersUpdateMessage) {
  const updates = {}

  markersUpdateMessage.getLayerOperationsMap().forEach((layerOperation, layerId) => {
    if (layerOperation.getIsDeletion()) {
      updates[layerId] = null
    } else {
      const markerUpdates = {}

      layerOperation.getMarkerOperationsMap().forEach((markerOperation, markerId) => {
        if (markerOperation.getIsDeletion()) {
          markerUpdates[markerId] = null
        } else {
          const markerUpdateMessage = markerOperation.getMarkerUpdate()
          const rangeMessage = markerUpdateMessage.getRange()
          const range = {
            startDependencyId: deserializeSpliceId(rangeMessage.getStartDependencyId()),
            offsetInStartDependency: deserializePoint(rangeMessage.getOffsetInStartDependency()),
            endDependencyId: deserializeSpliceId(rangeMessage.getEndDependencyId()),
            offsetInEndDependency: deserializePoint(rangeMessage.getOffsetInEndDependency())
          }

          markerUpdates[markerId] = {
            range,
            exclusive: markerUpdateMessage.getExclusive(),
            reversed: markerUpdateMessage.getReversed(),
            tailed: markerUpdateMessage.getTailed()
          }
        }
      })

      updates[layerId] = markerUpdates
    }
  })

  return {
    type: 'markers-update',
    siteId: markersUpdateMessage.getSiteId(),
    updates
  }
}

function deserializeSpliceId (spliceIdMessage) {
  return {
    site: spliceIdMessage.getSite(),
    seq: spliceIdMessage.getSeq()
  }
}

function deserializePoint (pointMessage) {
  return {
    row: pointMessage.getRow(),
    column: pointMessage.getColumn()
  }
}

module.exports = {
  serializeOperation, deserializeOperation,
  serializeOperationBinary, deserializeOperationBinary,
}
