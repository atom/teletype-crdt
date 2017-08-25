const assert = require('assert')
const {
  ZERO_POINT, characterIndexForPosition, extentForText, compare, traverse
} = require('../../lib/point-helpers')

module.exports =
class Document {
  constructor (text) {
    this.text = text
  }

  applyMany (operations) {
    assert(Array.isArray(operations))

    for (let i = 0; i < operations.length; i++) {
      this.apply(operations[i])
    }
  }

  apply ({type, position, extent, text}) {
    if (type === 'delete') {
      const end  = traverse(position, extent)
      const textToDelete = this.getTextInRange(position, end)
      assert.equal(text, textToDelete)
      this.delete(position, end)
    } else if (type === 'insert') {
      assert.deepEqual(extent, extentForText(text))
      this.insert(position, text)
    } else {
      throw new Error('Unknown operation type')
    }
  }

  setTextInRange (start, end, text) {
    if (compare(end, start) > 0) {
      this.delete(start, end)
    }

    if (text && text.length > 0) {
      this.insert(start, text)
    }
  }

  insert (position, text) {
    const index = characterIndexForPosition(this.text, position)
    this.text = this.text.slice(0, index) + text + this.text.slice(index)
  }

  delete (startPosition, endPosition) {
    const textExtent = extentForText(this.text)
    assert(compare(startPosition, textExtent) < 0)
    assert(compare(endPosition, textExtent) <= 0)
    const startIndex = characterIndexForPosition(this.text, startPosition)
    const endIndex = characterIndexForPosition(this.text, endPosition)
    this.text = this.text.slice(0, startIndex) + this.text.slice(endIndex)
  }

  lineForRow (row) {
    const startIndex = characterIndexForPosition(this.text, {row, column: 0})
    const endIndex = characterIndexForPosition(this.text, {row: row + 1, column: 0}) - 1
    return this.text.slice(startIndex, endIndex)
  }

  getLineCount () {
    return extentForText(this.text).row + 1
  }

  getTextInRange (start, end) {
    const startIndex = characterIndexForPosition(this.text, start)
    const endIndex = characterIndexForPosition(this.text, end)
    return this.text.slice(startIndex, endIndex)
  }
}
