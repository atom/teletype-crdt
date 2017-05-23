const {extentForText, traverse, compare} = require('./point-helpers')
const assert = require('assert')

exports.Operation = class Operation {
  constructor (type, start, text, siteId) {
    this.type = type
    this.start = start
    this.text = text
    this.extent = extentForText(this.text)
    this.end = traverse(this.start, this.extent)
    this.siteId = siteId
  }

  copy () {
    const newOperation = Object.create(Operation.prototype)
    newOperation.type = this.type
    newOperation.start = this.start
    newOperation.text = this.text
    newOperation.extent = this.extent
    newOperation.end = this.end
    newOperation.siteId = this.siteId
    if (this.contextVector) newOperation.contextVector = this.contextVector.copy()
    return newOperation
  }

  toString () {
    let text = `Operation on site ${this.siteId}: `
    text += `performing ${this.type} at (${this.start.row}, ${this.start.column}). `
    text += `Extent: (${this.extent.row}, ${this.extent.column}). `
    text += `Text: ${JSON.stringify(this.text)}`
    return text
  }
}

exports.NullOperation = class NullOperation {
  constructor (siteId) {
    this.siteId = siteId
    this.type = 'null'
  }

  copy () {
    const operation = new NullOperation(this.siteId)
    if (this.contextVector) operation.contextVector = this.contextVector.copy()
    return operation
  }

  toString () {
    return `Operation on site ${this.siteId}: null operation`
  }
}
