const {extentForText, traverse, compare} = require('./point-helpers')
const assert = require('assert')

exports.DeleteOperation = class DeleteOperation {
  constructor (start, extent, priority) {
    this.type = 'delete'
    this.start = start
    this.extent = extent
    this.end = traverse(this.start, this.extent)
    this.priority = Number(priority)
    assert(!Number.isNaN(this.priority), 'priority must be a number.')
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
    return `{${this.priority}}DELETE[(${this.start.row}, ${this.start.column}), (${this.end.row}, ${this.end.column})]`
  }
}

exports.InsertOperation = class InsertOperation {
  constructor (start, text, priority) {
    this.type = 'insert'
    this.start = start
    this.text = text
    this.extent = extentForText(this.text)
    this.end = traverse(this.start, this.extent)
    this.priority = priority
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
    return `{${this.priority}}INSERT[(${this.start.row}, ${this.start.column})]="${this.text}"`
  }
}
