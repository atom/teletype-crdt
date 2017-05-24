const WORDS = require('./words')
const {compare, traversal} = require('../../lib/point-helpers')

exports.getRandomDocumentPositionAndExtent = function getRandomDocumentPositionAndExtent (random, document) {
  const endRow = random(document.getLineCount())
  const startRow = random.intBetween(0, endRow)
  const startColumn = random(document.lineForRow(startRow).length)
  const endColumn = random(document.lineForRow(endRow).length)
  let start = {row: startRow, column: startColumn}
  let end = {row: endRow, column: endColumn}
  if (compare(start, end) > 0) {
    let temp = end
    end = start
    start = temp
  }
  const extent = traversal(end, start)
  return {start, extent}
}

exports.buildRandomLines = function buildRandomLines (random, maxLines) {
  const lines = []

  for (let i = 0; i < random(maxLines); i++) {
    lines.push(buildRandomLine(random))
  }

  return lines.join('\n')
}

function buildRandomLine (random) {
  const line = []

  for (let i = 0; i < random(5); i++) {
    const n = random(10)

    if (line.length > 0 && !/\s/.test(line[line.length - 1])) {
      line.push(' ')
    }

    line.push(WORDS[random(WORDS.length)])
  }

  return line.join('')
}
