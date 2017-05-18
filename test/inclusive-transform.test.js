const assert = require('assert')
const IT = require('../lib/inclusive-transform')
const {DeleteOperation, InsertOperation} = require('../lib/operations')
const {getRandomDocumentPositionAndExtent, buildRandomLines} = require('./helpers/random')
const Random = require('random-seed')
const Document = require('./helpers/document')

suite('Inclusive Transform Function', () => {
  test.only('respects the CE-CP1 and CP2 convergence and behavior preservation properties', function () {
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
        const priority = i
        if (random(2)) {
          operations.push(new DeleteOperation(start, extent, priority))
        } else {
          operations.push(new InsertOperation(start, buildRandomLines(random, 5), priority))
        }
      }

      const finalTexts = []
      for (const permutation of permute(operations)) {
        const documentCopy = new Document(document.text)
        applyOperation(documentCopy, permutation[0])
        applyOperation(documentCopy, IT(permutation[1], permutation[0]))
        applyOperation(documentCopy, IT(IT(permutation[2], permutation[0]), IT(permutation[1], permutation[0])))
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

  function applyOperation (document, operation) {
    if (operation == null) return

    if (operation.type === 'delete') {
      document.delete(operation.start, operation.extent)
    } else if (operation.type === 'insert') {
      document.insert(operation.start, operation.text)
    }
  }
})
