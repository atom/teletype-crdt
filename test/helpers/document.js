const {characterIndexForPosition, extentForText, traverse} = require('../../lib/point-helpers')

module.exports =
class Document {
  constructor (text) {
    this.text = text
  }

  apply (operation) {
    if (operation == null) return

    if (operation.type === 'delete') {
      this.delete(operation.start, operation.extent)
    } else if (operation.type === 'insert') {
      this.insert(operation.start, operation.text)
    }
  }

  insert (position, text) {
    const index = characterIndexForPosition(this.text, position)
    this.text = this.text.slice(0, index) + text + this.text.slice(index)
  }

  delete (position, extent) {
    const startIndex = characterIndexForPosition(this.text, position)
    const endIndex = characterIndexForPosition(this.text, traverse(position, extent))
    this.text = this.text.slice(0, startIndex) + this.text.slice(endIndex)
  }

  getTextFromPointAndExtent (start, extent) {
    const startIndex = characterIndexForPosition(this.text, start)
    const endIndex = characterIndexForPosition(this.text, traverse(start, extent))
    return this.text.slice(startIndex, endIndex)
  }

  getLineCount () {
    return extentForText(this.text).row + 1
  }

  lineForRow (row) {
    const lineStartIndex = characterIndexForPosition(this.text, {row, column: 0})
    let lineEndIndex = characterIndexForPosition(this.text, {row: row + 1, column: 0})
    if (this.text[lineEndIndex] === '\n') lineEndIndex--
    return this.text.slice(lineStartIndex, lineEndIndex)
  }
}
