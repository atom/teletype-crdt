exports.compare = function (a, b) {
  if (a.row === b.row) {
    return a.column - b.column
  } else {
    return a.row - b.row
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
