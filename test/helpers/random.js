const WORDS = require('./words')
const {compare, traversal} = require('../../lib/point-helpers')

exports.getRandomDocumentRange = function getRandomDocumentPositionAndExtent (random, document) {
  const endRow = random(document.getLineCount())
  const endColumn = random(document.lineForRow(endRow).length)

  let startRow, startColumn
  if (random(10) < 1) {
    startRow = endRow
    startColumn = endColumn
  } else {
    startRow = random.intBetween(0, endRow)
    startColumn = random(document.lineForRow(startRow).length)
  }

  let start = {row: startRow, column: startColumn}
  let end = {row: endRow, column: endColumn}
  if (compare(start, end) > 0) {
    const temp = end
    end = start
    start = temp
  }
  return {start, end}
}

exports.buildRandomLines = function buildRandomLines (random, maxLines) {
  const lineCount = random.intBetween(0, maxLines)
  const lines = []
  for (let i = 0; i < lineCount; i++) {
    const wordCount = lineCount === 1 ? random.intBetween(1, 5) : random(5)
    lines.push(buildRandomLine(random, wordCount))
  }
  return lines.join('\n')
}

function buildRandomLine (random, wordCount) {
  const line = []
  for (let i = 0; i < wordCount; i++) {
    line.push(WORDS[random(WORDS.length)])
  }
  return line.join('')
}
