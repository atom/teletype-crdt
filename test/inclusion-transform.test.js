const assert = require('assert')
const inclusionTransform = require('../lib/inclusion-transform')
const {getRandomDocumentPositionAndExtent, buildRandomLines} = require('./helpers/random')
const Random = require('random-seed')
const Document = require('./helpers/document')

suite('Inclusion Transform Function', () => {
  test('respects the CE-CP1 and CP2 convergence and behavior preservation properties', function () {
    this.timeout(Infinity)

    const initialSeed = Date.now()
    for (var iteration = 0; iteration < 5000; iteration++) {
      let seed = initialSeed + iteration
      const failureMessage = `Random seed: ${seed}`
      const random = Random(seed)
      const operations = []
      const permutationsCount = 3
      const document = new Document('ABCDEFG\nHIJKLMN\nOPQRSTU\nVWXYZ')
      for (var i = 0; i < permutationsCount; i++) {
        const {start, extent} = getRandomDocumentPositionAndExtent(random, document)
        const siteId = random(permutationsCount)
        if (random(2)) {
          operations.push({type: 'delete', start, text: document.getTextFromPointAndExtent(start, extent), siteId, localTimestamp: i})
        } else {
          operations.push({type: 'insert', start, text: buildRandomLines(random, 4), siteId, localTimestamp: i})
        }
      }

      const finalTexts = []
      const permutations = permute(operations)
      for (const permutation of permutations) {
        const documentCopy = new Document(document.text)
        documentCopy.apply(permutation[0])
        documentCopy.apply(inclusionTransform(permutation[1], permutation[0]))
        documentCopy.apply(inclusionTransform(inclusionTransform(permutation[2], permutation[0]), inclusionTransform(permutation[1], permutation[0])))
        finalTexts.push(documentCopy.text)
      }

      for (var i = 0; i < finalTexts.length - 1; i++) {
        assert.equal(finalTexts[i], finalTexts[i + 1], failureMessage)
      }
    }
  })

  function permute (array) {
    if (array.length === 0) return []
    if (array.length === 1) return array.slice()

    const permutations = []
    for (var i = 0; i < array.length; i++) {
      const element = array[i]
      const otherElements = array.slice()
      otherElements.splice(i, 1)
      for (const permutation of permute(otherElements)) {
        permutations.push([element].concat(permutation))
      }
    }
    return permutations
  }
})
