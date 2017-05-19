const {extentForText, traverse, compare} = require('./point-helpers')
const assert = require('assert')

exports.DeleteOperation = class DeleteOperation {
  constructor (start, extent, siteId) {
    this.type = 'delete'
    this.start = start
    this.extent = extent
    this.end = traverse(this.start, this.extent)
    this.siteId = Number(siteId)
    assert(!Number.isNaN(this.siteId), 'siteId must be a number.')
  }

  copy () {
    const newOperation = Object.create(DeleteOperation.prototype)
    newOperation.type = this.type
    newOperation.start = this.start
    newOperation.extent = this.extent
    newOperation.end = this.end
    newOperation.siteId = this.siteId
    if (this.contextVector) newOperation.contextVector = this.contextVector.copy()
    return newOperation
  }

  equals (op) {
    return (
      op != null &&
      op.type === this.type &&
      compare(op.start, this.start) === 0 &&
      compare(op.extent, this.extent)
    )
  }

  toString () {
    return `{${this.siteId}}DELETE[(${this.start.row}, ${this.start.column}), (${this.end.row}, ${this.end.column})]`
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
    assert(!Number.isNaN(this.siteId), 'siteId must be a number.')
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

  equals (op) {
    return (
      op != null &&
      op.type === this.type &&
      compare(op.start, this.start) === 0 &&
      op.text === this.text
    )
  }

  toString () {
    return `{${this.siteId}}INSERT[(${this.start.row}, ${this.start.column})]=${JSON.stringify(this.text)}`
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
    return `{${this.siteId}}NULL`
  }
}
