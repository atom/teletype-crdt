const {compare, traverse, traversal, characterIndexForPosition} = require('./point-helpers')
const {Operation, NullOperation} = require('./operations')

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
    return new Operation('insert', ins1.start, ins1.text, ins1.siteId)
  } else {
    return new Operation('insert', traverse(ins2.end, traversal(ins1.start, ins2.start)), ins1.text, ins1.siteId)
  }
}

function transformInsertDelete (ins, del) {
  if (compare(ins.start, del.start) < 0) {
    return new Operation('insert', ins.start, ins.text, ins.siteId)
  } else if (compare(ins.start, del.end) >= 0) {
    return new Operation('insert', traverse(del.start, traversal(ins.start, del.end)), ins.text, ins.siteId)
  } else {
    return new NullOperation(ins.siteId)
  }
}

function transformDeleteInsert (del, ins) {
  if (compare(del.end, ins.start) <= 0) {
    return new Operation('delete', del.start, del.text, del.siteId)
  } else {
    const comparison = compare(del.start, ins.start)
    if (comparison > 0) {
      return new Operation('delete', traverse(ins.end, traversal(del.start, ins.start)), del.text, del.siteId)
    } else if (comparison === 0) {
      return new Operation('delete', del.start, ins.text + del.text, del.siteId)
    } else {
      const suffixIndex = characterIndexForPosition(del.text, traversal(ins.start, del.start))
      const text = del.text.slice(0, suffixIndex) + ins.text + del.text.slice(suffixIndex)
      return new Operation('delete', del.start, text, del.siteId)
    }
  }
}

function transformDeleteDelete (del1, del2) {
  if (compare(del1.end, del2.start) <= 0) {
    return new Operation('delete', del1.start, del1.text, del1.siteId)
  } else if (compare(del1.start, del2.end) >= 0) {
    return new Operation('delete', traverse(del2.start, traversal(del1.start, del2.end)), del1.text, del1.siteId)
  } else if (compare(del1.start, del2.start) < 0 && compare(del2.start, del1.end) < 0 && compare(del1.end, del2.end) <= 0) {
    const prefixIndex = characterIndexForPosition(del1.text, traversal(del2.start, del1.start))
    return new Operation('delete', del1.start, del1.text.slice(0, prefixIndex), del1.siteId)
  } else if (compare(del2.start, del1.start) <= 0 && compare(del1.start, del2.end) < 0 && compare(del2.end, del1.end) < 0) {
    const suffixIndex = characterIndexForPosition(del1.text, traversal(del2.end, del1.start))
    return new Operation('delete', del2.start, del1.text.slice(suffixIndex), del1.siteId)
  } else if (compare(del1.start, del2.start) < 0 && compare(del2.end, del1.end) < 0) {
    const prefixIndex = characterIndexForPosition(del1.text, traversal(del2.start, del1.start))
    const suffixIndex = characterIndexForPosition(del1.text, traversal(del2.end, del1.start))
    return new Operation('delete',
      del1.start,
      del1.text.slice(0, prefixIndex) + del1.text.slice(suffixIndex),
      del1.siteId
    )
  } else {
    return new NullOperation(del1.siteId)
  }
}
