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

function transformInsertInsert (op1, op2) {
  const positionComparison = compare(op1.start, op2.start)
  if (positionComparison < 0 || (positionComparison === 0 && op1.siteId > op2.siteId)) {
    return new InsertOperation(op1.start, op1.text, op1.siteId)
  } else {
    return new InsertOperation(traverse(op2.end, traversal(op1.start, op2.start)), op1.text, op1.siteId)
  }
}

function transformInsertDelete (op1, op2) {
  if (compare(op1.start, op2.start) < 0) {
    return new InsertOperation(op1.start, op1.text, op1.siteId)
  } else if (compare(op1.start, op2.end) >= 0) {
    return new InsertOperation(traverse(op2.start, traversal(op1.start, op2.end)), op1.text, op1.siteId)
  } else {
    return new NullOperation(op1.siteId)
  }
}

function transformDeleteInsert (op1, op2) {
  if (compare(op1.end, op2.start) <= 0) {
    return new DeleteOperation(op1.start, op1.extent, op1.siteId)
  } else {
    const comparison = compare(op1.start, op2.start)
    if (comparison > 0) {
      return new DeleteOperation(traverse(op2.end, traversal(op1.start, op2.start)), op1.extent, op1.siteId)
    } else if (comparison === 0) {
      return new DeleteOperation(op1.start, traverse(op2.extent, op1.extent), op1.siteId)
    } else {
      const leftExtent = traversal(op2.start, op1.start)
      const rightExtent = traversal(op1.end, op2.start)
      return new DeleteOperation(op1.start, traverse(traverse(leftExtent, op2.extent), rightExtent), op1.siteId)
    }
  }
}

function transformDeleteDelete (op1, op2) {
  if (compare(op1.end, op2.start) <= 0) {
    return new DeleteOperation(op1.start, op1.extent, op1.siteId)
  } else if (compare(op1.start, op2.end) >= 0) {
    return new DeleteOperation(traverse(op2.start, traversal(op1.start, op2.end)), op1.extent, op1.siteId)
  } else if (compare(op1.start, op2.start) < 0 && compare(op2.start, op1.end) < 0 && compare(op1.end, op2.end) <= 0) {
    return new DeleteOperation(op1.start, traversal(op2.start, op1.start), op1.siteId)
  } else if (compare(op2.start, op1.start) <= 0 && compare(op1.start, op2.end) < 0 && compare(op2.end, op1.end) < 0) {
    return new DeleteOperation(op2.start, traversal(op1.end, op2.end), op1.siteId)
  } else if (compare(op1.start, op2.start) < 0 && compare(op2.end, op1.end) < 0) {
    return new DeleteOperation(op1.start, traverse(
      traversal(op2.start, op1.start),
      traversal(op1.end, op2.end)
    ), op1.siteId)
  } else {
    return new NullOperation(op1.siteId)
  }
}
