const {compare, traverse, traversal, characterIndexForPosition} = require('./point-helpers')
const {copy, getEnd} = require('./operation-helpers')

module.exports = function (op1, op2) {
  if (op1.type === 'null' || op2.type === 'null') {
    return copy(op1)
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
  const isTie = (
    positionComparison === 0 &&
    (
      ins1.siteId > ins2.siteId ||
      (ins1.siteId === ins2.siteId && ins1.localTimestamp > ins2.localTimestamp)
    )
  )
  if (positionComparison < 0 || isTie) {
    return {type: 'insert', start: ins1.start, text: ins1.text, siteId: ins1.siteId, localTimestamp: ins1.localTimestamp}
  } else {
    return {type: 'insert', start: traverse(getEnd(ins2), traversal(ins1.start, ins2.start)), text: ins1.text, siteId: ins1.siteId, localTimestamp: ins1.localTimestamp}
  }
}

function transformInsertDelete (ins, del) {
  if (compare(ins.start, del.start) < 0) {
    return {type: 'insert', start: ins.start, text: ins.text, siteId: ins.siteId, localTimestamp: ins.localTimestamp}
  } else if (compare(ins.start, getEnd(del)) >= 0) {
    return {type: 'insert', start: traverse(del.start, traversal(ins.start, getEnd(del))), text: ins.text, siteId: ins.siteId, localTimestamp: ins.localTimestamp}
  } else {
    return {type: 'null', siteId: ins.siteId, localTimestamp: ins.localTimestamp}
  }
}

function transformDeleteInsert (del, ins) {
  if (compare(getEnd(del), ins.start) <= 0) {
    return {type: 'delete', start: del.start, text: del.text, siteId: del.siteId, localTimestamp: del.localTimestamp}
  } else {
    const comparison = compare(del.start, ins.start)
    if (comparison > 0) {
      return {type: 'delete', start: traverse(getEnd(ins), traversal(del.start, ins.start)), text: del.text, siteId: del.siteId, localTimestamp: del.localTimestamp}
    } else if (comparison === 0) {
      return {type: 'delete', start: del.start, text: ins.text + del.text, siteId: del.siteId, localTimestamp: del.localTimestamp}
    } else {
      const suffixIndex = characterIndexForPosition(del.text, traversal(ins.start, del.start))
      const text = del.text.slice(0, suffixIndex) + ins.text + del.text.slice(suffixIndex)
      return {type: 'delete', start: del.start, text, siteId: del.siteId, localTimestamp: del.localTimestamp}
    }
  }
}

function transformDeleteDelete (del1, del2) {
  if (compare(getEnd(del1), del2.start) <= 0) {
    return {type: 'delete', start: del1.start, text: del1.text, siteId: del1.siteId, localTimestamp: del1.localTimestamp}
  } else if (compare(del1.start, getEnd(del2)) >= 0) {
    return {type: 'delete', start: traverse(del2.start, traversal(del1.start, getEnd(del2))), text: del1.text, siteId: del1.siteId, localTimestamp: del1.localTimestamp}
  } else if (compare(del1.start, del2.start) < 0 && compare(del2.start, getEnd(del1)) < 0 && compare(getEnd(del1), getEnd(del2)) <= 0) {
    const prefixIndex = characterIndexForPosition(del1.text, traversal(del2.start, del1.start))
    return {type: 'delete', start: del1.start, text: del1.text.slice(0, prefixIndex), siteId: del1.siteId, localTimestamp: del1.localTimestamp}
  } else if (compare(del2.start, del1.start) <= 0 && compare(del1.start, getEnd(del2)) < 0 && compare(getEnd(del2), getEnd(del1)) < 0) {
    const suffixIndex = characterIndexForPosition(del1.text, traversal(getEnd(del2), del1.start))
    return {type: 'delete', start: del2.start, text: del1.text.slice(suffixIndex), siteId: del1.siteId, localTimestamp: del1.localTimestamp}
  } else if (compare(del1.start, del2.start) < 0 && compare(getEnd(del2), getEnd(del1)) < 0) {
    const prefixIndex = characterIndexForPosition(del1.text, traversal(del2.start, del1.start))
    const suffixIndex = characterIndexForPosition(del1.text, traversal(getEnd(del2), del1.start))
    const text = del1.text.slice(0, prefixIndex) + del1.text.slice(suffixIndex)
    return {type: 'delete', start: del1.start, text, siteId: del1.siteId, localTimestamp: del1.localTimestamp}
  } else {
    return {type: 'null', siteId: del1.siteId, localTimestamp: del1.localTimestamp}
  }
}
