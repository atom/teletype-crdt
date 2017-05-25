const {characterIndexForPosition, extentForText, traverse} = require('../../lib/point-helpers')

module.exports =
class Document {
  constructor (text) {
    this.text = text
  }

  apply (operation) {
    if (operation.type === 'delete') {
      this.delete(operation.position, operation.extent)
    } else if (operation.type === 'insert') {
      this.insert(operation.position, operation.text)
    }
  }

  insert (position, text) {
    this.text = this.text.slice(0, position) + text + this.text.slice(position)
  }

  delete (position, extent) {
    this.text = this.text.slice(0, position) + this.text.slice(position + extent)
  }
}
