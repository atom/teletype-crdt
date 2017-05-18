const assert = require('assert')
const IT = require('../lib/inclusive-transform')
const {DeleteOperation, InsertOperation} = require('../lib/operations')
const {getRandomBufferRange, buildRandomLines} = require('./helpers/random')
const Random = require('random-seed')
const TextBuffer = require('text-buffer')

suite('Inclusive Transform Function', () => {
  test.only('respects the CE-CP1 and CP2 convergence and behavior preservation properties', function () {
    this.timeout(Infinity)

    const initialSeed = Date.now()
    const buffer = new TextBuffer({text: 'ABCDEF\nGHIJKL\nMNOPQR\n'})
    for (var iteration = 0; iteration < 1000; iteration++) {
      let seed = initialSeed + iteration
      const failureMessage = `Random seed: ${seed}`
      const random = Random(seed)
      const operations = []
      for (var i = 0; i < 3; i++) {
        const range = getRandomBufferRange(random, buffer)
        const priority = i
        if (random(2)) {
          operations.push(new DeleteOperation(range.start, range.getExtent(), priority))
        } else {
          operations.push(new InsertOperation(range.start, buildRandomLines(random, 5), priority))
        }
      }

      const finalTexts = []
      for (const permutation of permute(operations)) {
        buffer.transact(() => {
          applyOperationToBuffer(permutation[0], buffer)
          applyOperationToBuffer(IT(permutation[1], permutation[0]), buffer)
          applyOperationToBuffer(IT(IT(permutation[2], permutation[0]), IT(permutation[1], permutation[0])), buffer)
        })

        finalTexts.push(buffer.getText())
        buffer.undo()
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

  function applyOperationToBuffer (operation, buffer) {
    if (operation == null) return

    if (operation.type === 'delete') {
      buffer.setTextInRange([operation.start, operation.end], '')
    } else if (operation.type === 'insert') {
      buffer.setTextInRange([operation.start, operation.start], operation.text)
    }
  }
})
