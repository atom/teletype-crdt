const assert = require('assert')
const {
  serializeOperationBinary, deserializeOperationBinary,
  serializeRemotePositionBinary, deserializeRemotePositionBinary
} = require('../lib/serialization')

suite('serialization/deserialization', () => {
  test('inserts', () => {
    const op = {
      type: 'splice',
      spliceId: {site: 1, seq: 2},
      insertion: {
        text: 'hello',
        leftDependencyId: {site: 1, seq: 1},
        offsetInLeftDependency: {row: 0, column: 5},
        rightDependencyId: {site: 1, seq: 1},
        offsetInRightDependency: {row: 0, column: 5},
      },
      deletion: {
        leftDependencyId: {site: 1, seq: 1},
        offsetInLeftDependency: {row: 0, column: 5},
        rightDependencyId: {site: 1, seq: 1},
        offsetInRightDependency: {row: 0, column: 5},
        maxSeqsBySite: {
          '1': 3,
          '2': 5
        }
      }
    }

    assert.deepEqual(deserializeOperationBinary(serializeOperationBinary(op)), op)
  })

  test('undo', () => {
    const op = {
      type: 'undo',
      spliceId: {site: 1, seq: 3},
      undoCount: 3
    }

    assert.deepEqual(deserializeOperationBinary(serializeOperationBinary(op)), op)
  })

  test('marker updates', () => {
    const op = {
      type: 'markers-update',
      siteId: 1,
      updates: {
        1: {
          1: {
            range: {
              startDependencyId: {site: 1, seq: 1},
              offsetInStartDependency: {row: 0, column: 1},
              endDependencyId: {site: 1, seq: 1},
              offsetInEndDependency: {row: 0, column: 6}
            },
            exclusive: false,
            reversed: false,
            tailed: true
          },
          2: null
        },
        2: null
      }
    }

    assert.deepEqual(deserializeOperationBinary(serializeOperationBinary(op)), op)
  })
})
