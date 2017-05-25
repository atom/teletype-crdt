const assert = require('assert')
const inclusionTransform = require('../lib/inclusion-transform')
const {invert} = require('../lib/operation-helpers')
const {getRandomDocumentPositionAndExtent, buildRandomLines} = require('./helpers/random')
const Random = require('random-seed')
const Document = require('./helpers/document')

suite('Inclusion Transform Function', () => {
  test('problematic undo case', () => {

    const doc1 = new Document('ABCDEFG\nHIJKLMN\nOPQRSTU\nVWXYZ')
    const doc2 = doc1.copy()

    const o1 = {type: 'delete', start: {row: 0, column: 2}, text: 'CDEFG'} // site: 2, context: {}
    const o2 = {type: 'insert', start: {row: 0, column: 2}, text: 'CDEFG'} // site: 2, context: {o1}
    const o3 = {type: 'delete', start: {row: 0, column: 4}, text: 'EFG\nHIJKL'} // site: 0, context: {}
    const o4 = {type: 'delete', start: {row: 0, column: 1}, text: 'B\nHI'} // site: 1, context: {o1}

    const it = inclusionTransform


    const x = it(invert(it(invert(o2), o3)), it(o4, it(o3, o1)))
    const y =

    doc1.apply()
    doc1.apply(x)


    doc2.apply(y)
  })


  test('respects the CE-CP1 and CP2 convergence and behavior preservation properties', function () {
    this.timeout(Infinity)

    const initialSeed = Date.now()
    for (var iteration = 0; iteration < 1000; iteration++) {
      let seed = initialSeed + iteration
      const failureMessage = `Random seed: ${seed}`
      const random = Random(seed)
      const operations = []
      const document = new Document('ABCDEF\nGHIJKL\nMNOPQR\n')
      for (var i = 0; i < 3; i++) {
        const {start, extent} = getRandomDocumentPositionAndExtent(random, document)
        const siteId = i
        if (random(2)) {
          operations.push({type: 'delete', start, text: document.getTextFromPointAndExtent(start, extent), siteId})
        } else {
          operations.push({type: 'insert', start, text: buildRandomLines(random, 5), siteId})
        }
      }

      const finalTexts = []
      for (const permutation of permute(operations)) {
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
