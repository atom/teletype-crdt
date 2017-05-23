const {extentForText, traverse, compare} = require('./point-helpers')
const assert = require('assert')

exports.DeleteOperation = class DeleteOperation {
  constructor (start, text, siteId) {
    this.type = 'delete'
    this.start = start
    this.text = text
    this.extent = extentForText(this.text)
    this.end = traverse(this.start, this.extent)
    this.siteId = siteId
  }

  copy () {
    const newOperation = Object.create(DeleteOperation.prototype)
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
    return `Operation on site ${this.siteId}: deleting from (${this.start.row}, ${this.start.column}) to (${this.end.row}, ${this.end.column})`
  }
}

exports.InsertOperation = class InsertOperation {
  constructor (start, text, siteId) {
    this.type = 'insert'
    this.start = start
    this.text = text
    this.extent = extentForText(this.text)
    this.end = traverse(this.start, this.extent)
    this.siteId = siteId
  }

  copy () {
    const newOperation = Object.create(InsertOperation.prototype)
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
    return `Operation on site ${this.siteId}: inserting ${JSON.stringify(this.text)} at (${this.start.row}, ${this.start.column})`
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
