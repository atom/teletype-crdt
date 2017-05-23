const {extentForText, traverse, compare, format} = require('./point-helpers')

exports.copy = function (operation) {
  const newOperation = {
    type: operation.type,
    siteId: operation.siteId
  }
  if (operation.contextVector) newOperation.contextVector = operation.contextVector.copy()

  if (operation.type !== 'null') {
    newOperation.start = operation.start
    newOperation.text = operation.text
    newOperation.extent = operation.extent
    newOperation.end = operation.end
  }

  return newOperation
}

exports.format = function (operation) {
  if (operation.type === 'null') {
    return `Operation on site ${operation.siteId}: null operation`
  } else {
    let text = `Operation on site ${operation.siteId}: ${operation.type} at ${format(operation.start)}. `
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
