const {compare, traverse, traversal} = require('./point-helpers')
const {DeleteOperation, InsertOperation, NullOperation} = require('./operations')

module.exports = function (op1, op2) {
  if (op1.type === 'null' || op2.type === 'null') {
    return op1.copy()
  } else if (op1.type === 'insert' && op2.type === 'insert') {
    return transformInsertInsert(op1, op2)
  } else if (op1.type === 'insert' && op2.type === 'delete') {
    return transformInsertDelete(op1, op2)
  } else if (op1.type === 'delete' && op2.type === 'insert') {
    return transformDeleteInsert(op1, op2)
  } else if (op1.type === 'delete' && op2.type === 'delete') {
    return transformDeleteDelete(op1, op2)
  } else {
    throw new Error(`Cannot transform an operation of type "${op1.type}" against one of type "${op2.type}".`)
  }
}

function transformInsertInsert (ins1, ins2) {
  const positionComparison = compare(ins1.start, ins2.start)
  if (positionComparison < 0 || (positionComparison === 0 && ins1.siteId > ins2.siteId)) {
    return new InsertOperation(ins1.start, ins1.text, ins1.siteId)
  } else {
    return new InsertOperation(traverse(ins2.end, traversal(ins1.start, ins2.start)), ins1.text, ins1.siteId)
  }
}

function transformInsertDelete (ins, del) {
  if (compare(ins.start, del.start) < 0) {
    return new InsertOperation(ins.start, ins.text, ins.siteId)
  } else if (compare(ins.start, del.end) >= 0) {
    return new InsertOperation(traverse(del.start, traversal(ins.start, del.end)), ins.text, ins.siteId)
  } else {
    return new NullOperation(ins.siteId)
  }
}

function transformDeleteInsert (del, ins) {
  if (compare(del.end, ins.start) <= 0) {
    return new DeleteOperation(del.start, del.extent, del.siteId)
  } else {
    const comparison = compare(del.start, ins.start)
    if (comparison > 0) {
      return new DeleteOperation(traverse(ins.end, traversal(del.start, ins.start)), del.extent, del.siteId)
    } else if (comparison === 0) {
      return new DeleteOperation(del.start, traverse(ins.extent, del.extent), del.siteId)
    } else {
      const leftExtent = traversal(ins.start, del.start)
      const rightExtent = traversal(del.end, ins.start)
      return new DeleteOperation(del.start, traverse(traverse(leftExtent, ins.extent), rightExtent), del.siteId)
    }
  }
}

function transformDeleteDelete (del1, del2) {
  if (compare(del1.end, del2.start) <= 0) {
    return new DeleteOperation(del1.start, del1.extent, del1.siteId)
  } else if (compare(del1.start, del2.end) >= 0) {
    return new DeleteOperation(traverse(del2.start, traversal(del1.start, del2.end)), del1.extent, del1.siteId)
  } else if (compare(del1.start, del2.start) < 0 && compare(del2.start, del1.end) < 0 && compare(del1.end, del2.end) <= 0) {
    return new DeleteOperation(del1.start, traversal(del2.start, del1.start), del1.siteId)
  } else if (compare(del2.start, del1.start) <= 0 && compare(del1.start, del2.end) < 0 && compare(del2.end, del1.end) < 0) {
    return new DeleteOperation(del2.start, traversal(del1.end, del2.end), del1.siteId)
  } else if (compare(del1.start, del2.start) < 0 && compare(del2.end, del1.end) < 0) {
    return new DeleteOperation(
      del1.start,
      traverse(traversal(del2.start, del1.start), traversal(del1.end, del2.end)),
      del1.siteId
    )
  } else {
    return new NullOperation(del1.siteId)
  }
}
