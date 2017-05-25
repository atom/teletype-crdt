const WORDS = require('./words')
const {compare, traversal} = require('../../lib/point-helpers')

exports.buildRandomText = function (random, wordCount) {
  const words = []
  while (wordCount-- > 0) {
    words.push(WORDS[random(WORDS.length)])
  }
  return words.join(' ')
}
