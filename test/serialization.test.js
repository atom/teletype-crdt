const assert = require('assert')
const {serializeOperation, deserializeOperation} = require('../lib/serialization')

suite('serialization/deserialization', () => {
  test('inserts', () => {
    const op = {
      type: 'insert',
      opId: {site: 1, seq: 2},
      text: 'hello',
      leftDependencyId: {site: 1, seq: 1},
      offsetInLeftDependency: {row: 0, column: 5},
      rightDependencyId: {site: 1, seq: 1},
      offsetInRightDependency: {row: 0, column: 5},
    }

    assert.deepEqual(deserializeOperation(serializeOperation(op)), op)
  })

  test('deletes', () => {
    const op = {
      type: 'delete',
      opId: {site: 1, seq: 3},
      offsetRanges: [
        {opId: {site: 1, seq: 1}, startOffset: {row: 0, column: 0}, endOffset: {row: 1, column: 1}},
        {opId: {site: 1, seq: 2}, startOffset: {row: 1, column: 0}, endOffset: {row: 2, column: 1}},
      ]
    }

    assert.deepEqual(deserializeOperation(serializeOperation(op)), op)
  })

  test('undo', () => {
    const op = {
      type: 'undo',
      opId: {site: 1, seq: 3},
      undoCount: 3
    }

    assert.deepEqual(deserializeOperation(serializeOperation(op)), op)
  })
})
