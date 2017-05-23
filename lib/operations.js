const {extentForText, traverse, compare} = require('./point-helpers')
const assert = require('assert')

exports.Operation = class Operation {
  constructor (type, start, text, siteId, isInverse = false) {
    this.type = type
    this.start = start
    this.text = text
    this.extent = extentForText(this.text)
    this.end = traverse(this.start, this.extent)
    this.siteId = siteId
    this.isInverse = isInverse
  }

  copy () {
    const newOperation = Object.create(Operation.prototype)
    newOperation.type = this.type
    newOperation.start = this.start
    newOperation.text = this.text
    newOperation.extent = this.extent
    newOperation.end = this.end
    newOperation.siteId = this.siteId
    newOperation.isInverse = this.isInverse
    if (this.contextVector) newOperation.contextVector = this.contextVector.copy()
    return newOperation
  }

  invert () {
    const operation = this.copy()
    operation.isInverse = true
    operation.type = this.type === 'insert' ? 'delete' : 'insert'
    return operation
  }

  toString () {
    let text = `${this.isInverse ? 'Inverse ' : ''}Operation generated at Site ${this.siteId}: `
    text += `"${this.type}" at (${this.start.row}, ${this.start.column}). `
    text += `Extent: (${this.extent.row}, ${this.extent.column}). `
    text += `Text: ${JSON.stringify(this.text)}`
    return text
  }
}

exports.NullOperation = class NullOperation {
  constructor (siteId, isInverse = false) {
    this.siteId = siteId
    this.type = 'null'
    this.isInverse = isInverse
  }

  copy () {
    const operation = new NullOperation(this.siteId)
    operation.isInverse = this.isInverse
    if (this.contextVector) operation.contextVector = this.contextVector.copy()
    return operation
  }

  invert () {
    const operation = this.copy()
    operation.isInverse = true
    return operation
  }

  toString () {
    return `Operation on site ${this.siteId}: null operation`
  }
}
