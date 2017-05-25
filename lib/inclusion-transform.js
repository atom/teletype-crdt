const {copy} = require('./operation-helpers')

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
  let {type, position, text, siteId, debugId} = ins1

  if (position > ins2.position || (position === ins2.position && siteId <= ins2.siteId)) {
    position++
  }

  return {type, position, text, siteId, debugId}
}

function transformInsertDelete (ins, del) {
  let {type, position, text, siteId, debugId} = ins

  if (position > del.position) {
    position--
  }

  return {type, position, text, siteId, debugId}
}

function transformDeleteInsert (del, ins) {
  let {type, position, text, siteId, debugId} = del
  if (del.position >= ins.position) position++
  return {type, position, text, siteId, debugId}
}

function transformDeleteDelete (del1, del2) {
  let {type, position, text, siteId, debugId} = del1
  if (position === del2.position) {
    return {type: 'null', siteId, debugId}
  }
  if (position > del2.position) position--
  return {type, position, text, siteId, debugId}
}
