const {Operation, OperationId, Point} = require('./operation_pb')

function serializeOperation (op) {
  const op_ = new Operation()
  switch (op.type) {
    case 'insert':
      op_.setInsertion(serializeInsertion(op))
      break
    case 'delete':
      op_.setDeletion(serializeDeletion(op))
      break
    case 'undo':
      op_.setUndo(serializeUndo(op))
      break
    default:
      throw new Error('Unknown operation type: ' + op.type)
  }
  return op_.serializeBinary()
}

function serializeInsertion (insertion) {
  const insertion_ = new Operation.Insertion()
  insertion_.setOpId(serializeOpId(insertion.opId))
  insertion_.setText(insertion.text)
  insertion_.setLeftDependencyId(serializeOpId(insertion.leftDependencyId))
  insertion_.setOffsetInLeftDependency(serializePoint(insertion.offsetInLeftDependency))
  insertion_.setRightDependencyId(serializeOpId(insertion.rightDependencyId))
  insertion_.setOffsetInRightDependency(serializePoint(insertion.offsetInRightDependency))
  return insertion_
}

function serializeDeletion (deletion) {
  const deletion_ = new Operation.Deletion()
  deletion_.setOpId(serializeOpId(deletion.opId))
  deletion_.setLeftDependencyId(serializeOpId(deletion.leftDependencyId))
  deletion_.setOffsetInLeftDependency(serializePoint(deletion.offsetInLeftDependency))
  deletion_.setRightDependencyId(serializeOpId(deletion.rightDependencyId))
  deletion_.setOffsetInRightDependency(serializePoint(deletion.offsetInRightDependency))
  const maxSeqsBySite_ = deletion_.getMaxSeqsBySiteMap()
  for (const site in deletion.maxSeqsBySite) {
    maxSeqsBySite_.set(site, deletion.maxSeqsBySite[site])
  }
  return deletion_
}

function serializeUndo (undo) {
  const undo_ = new Operation.Undo()
  undo_.setOpId(serializeOpId(undo.opId))
  undo_.setUndoCount(undo.undoCount)
  return undo_
}

function serializeOpId ({site, seq}) {
  const opId_ = new OperationId()
  opId_.setSite(site)
  opId_.setSeq(seq)
  return opId_
}

function serializePoint ({row, column}) {
  const point_ = new Point()
  point_.setRow(row)
  point_.setColumn(column)
  return point_
}

function deserializeOperation (data) {
  const op_ = Operation.deserializeBinary(data)

  if (op_.hasInsertion()) {
    return deserializeInsertion(op_.getInsertion())
  } else if (op_.hasDeletion()) {
    return deserializeDeletion(op_.getDeletion())
  } else if (op_.hasUndo()) {
    return deserializeUndo(op_.getUndo())
  } else {
    throw new Error('Unknown operation type')
  }
}

function deserializeInsertion (insertion_) {
  return {
    type: 'insert',
    opId: deserializeOpId(insertion_.getOpId()),
    text: insertion_.getText(),
    leftDependencyId: deserializeOpId(insertion_.getLeftDependencyId()),
    offsetInLeftDependency: deserializePoint(insertion_.getOffsetInLeftDependency()),
    rightDependencyId: deserializeOpId(insertion_.getRightDependencyId()),
    offsetInRightDependency: deserializePoint(insertion_.getOffsetInRightDependency())
  }
}

function deserializeDeletion (deletion_) {
  const maxSeqsBySite = {}
  deletion_.getMaxSeqsBySiteMap().forEach((seq, site) => {
    maxSeqsBySite[site] = seq
  })
  return {
    type: 'delete',
    opId: deserializeOpId(deletion_.getOpId()),
    leftDependencyId: deserializeOpId(deletion_.getLeftDependencyId()),
    offsetInLeftDependency: deserializePoint(deletion_.getOffsetInLeftDependency()),
    rightDependencyId: deserializeOpId(deletion_.getRightDependencyId()),
    offsetInRightDependency: deserializePoint(deletion_.getOffsetInRightDependency()),
    maxSeqsBySite
  }
}

function deserializeUndo (undo_) {
  return {
    type: 'undo',
    opId: deserializeOpId(undo_.getOpId()),
    undoCount: undo_.getUndoCount()
  }
}

function deserializeOpId (opId_) {
  return {
    site: opId_.getSite(),
    seq: opId_.getSeq()
  }
}

function deserializePoint (point_) {
  return {
    row: point_.getRow(),
    column: point_.getColumn()
  }
}

module.exports = {serializeOperation, deserializeOperation}
