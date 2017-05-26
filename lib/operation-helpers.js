const {extentForText, traverse, compare, format} = require('./point-helpers')

exports.copy = function (operation) {
  const newOperation = {
    type: operation.type,
    siteId: operation.siteId,
    sequenceNumber: operation.sequenceNumber,
    inverseCount: operation.inverseCount,
    localTimestamp: operation.localTimestamp
  }
  if (operation.contextVector) newOperation.contextVector = operation.contextVector.copy()

  if (operation.type !== 'null') {
    newOperation.start = operation.start
    newOperation.text = operation.text
  }

  return newOperation
}

exports.invert = function (operation) {
  const newOperation = exports.copy(operation)
  if (newOperation.type === 'insert') {
    newOperation.type = 'delete'
  } else if (newOperation.type === 'delete') {
    newOperation.type = 'insert'
  }
  return newOperation
}

exports.format = function (operation) {
  if (operation.type === 'null') {
    return `Operation: null operation`
  } else {
    let text = `${operation.type} at ${format(operation.start)}. `
    text += `Extent: ${format(extentForText(operation.text))}. `
    text += `Text: ${JSON.stringify(operation.text)}`
    return text
  }
}

exports.getEnd = function (operation) {
  if (!operation.end) {
    operation.end = traverse(operation.start, extentForText(operation.text))
  }

  return operation.end
}

exports.getId = function (operation) {
  if (!operation.id) {
    const {siteId, sequenceNumber, inverseCount} = operation
    operation.id = exports.buildId(siteId, sequenceNumber, inverseCount)
  }

  return operation.id
}

exports.buildId = function (siteId, sequenceNumber, inverseCount) {
  return `${siteId}-${sequenceNumber}-${inverseCount}`
}
