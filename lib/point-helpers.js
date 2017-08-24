const assert = require('assert')

exports.ZERO_POINT = Object.freeze({row: 0, column: 0})

exports.compare = function (a, b) {
  return primitiveCompare(a.row, a.column, b.row, b.column)
}

function primitiveCompare (rowA, columnA, rowB, columnB) {
  if (rowA === rowB) {
    return columnA - columnB
  } else {
    return rowA - rowB
  }
}

exports.traverse = function (start, distance) {
  if (distance.row === 0)
    return {row: start.row, column: start.column + distance.column}
  else {
    return {row: start.row + distance.row, column: distance.column}
  }
}

exports.traversal = function (end, start) {
  if (end.row === start.row) {
    return {row: 0, column: end.column - start.column}
  } else {
    return {row: end.row - start.row, column: end.column}
  }
}

exports.extentForText = function (text) {
  let row = 0
  let column = 0
  let index = 0
  while (index < text.length) {
    const char = text[index]
    if (char === '\n') {
      column = 0
      row++
    } else {
      column++
    }
    index++
  }

  return {row, column}
}

exports.characterIndexForPosition = function (text, target) {
  // Previously we instantiated a point object here and mutated its fields, so
  // that we could use the `compare` function we already export. However, this
  // seems to trigger a weird optimization bug on v8 5.6.326.50 which causes
  // this function to return unpredictable results, so we use primitive-valued
  // variables instead.
  let row = 0
  let column = 0
  let index = 0
  while (primitiveCompare(row, column, target.row, target.column) < 0 && index <= text.length) {
    if (text[index] === '\n') {
      row++
      column = 0
    } else {
      column++
    }

    index++
  }

  assert(primitiveCompare(row, column, target.row, target.column) <= 0, 'Target position should not exceed the extent of the given text')

  return index
}
