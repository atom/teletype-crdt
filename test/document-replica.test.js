const assert = require('assert')
const Random = require('random-seed')
const Document = require('./helpers/document')
const DocumentReplica = require('../lib/document-replica')
const Peer = require('./helpers/peer')
const {ZERO_POINT} = require('../lib/point-helpers')

suite('DocumentReplica', () => {
  suite('operations', () => {
    test('concurrent inserts at 0', () => {
      const replica1 = buildReplica(1)
      const replica2 = buildReplica(2)

      const ops1 = performInsert(replica1, {row: 0, column: 0}, 'a')
      const ops2 = performInsert(replica2, {row: 0, column: 0}, 'b')
      integrateOperations(replica1, ops2)
      integrateOperations(replica2, ops1)

      assert.equal(replica1.testDocument.text, 'ab')
      assert.equal(replica2.testDocument.text, 'ab')
    })

    test('concurrent inserts at the same position inside a previous insertion', () => {
      const replica1 = buildReplica(1)
      const replica2 = buildReplica(2)
      integrateOperations(replica2, performInsert(replica1, {row: 0, column: 0}, 'ABCDEFG'))

      const ops1 = performInsert(replica1, {row: 0, column: 2}, '+++')
      const ops2 = performInsert(replica2, {row: 0, column: 2}, '***')
      integrateOperations(replica1, ops2)
      integrateOperations(replica2, ops1)

      assert.equal(replica1.testDocument.text, 'AB+++***CDEFG')
      assert.equal(replica2.testDocument.text, 'AB+++***CDEFG')
    })

    test('concurrent inserts at different positions inside a previous insertion', () => {
      const replica1 = buildReplica(1)
      const replica2 = buildReplica(2)
      integrateOperations(replica2, performInsert(replica1, {row: 0, column: 0}, 'ABCDEFG'))

      const ops1 = performInsert(replica1, {row: 0, column: 6}, '+++')
      const ops2 = performInsert(replica2, {row: 0, column: 2}, '***')
      integrateOperations(replica1, ops2)
      integrateOperations(replica2, ops1)

      assert.equal(replica1.testDocument.text, 'AB***CDEF+++G')
      assert.equal(replica2.testDocument.text, 'AB***CDEF+++G')
    })

    test('concurrent overlapping deletions', () => {
      const replica1 = buildReplica(1)
      const replica2 = buildReplica(2)
      integrateOperations(replica2, performInsert(replica1, {row: 0, column: 0}, 'ABCDEFG'))

      const ops1 = performDelete(replica1, {row: 0, column: 2}, {row: 0, column: 5})
      const ops2 = performDelete(replica2, {row: 0, column: 4}, {row: 0, column: 6})
      integrateOperations(replica1, ops2)
      integrateOperations(replica2, ops1)

      assert.equal(replica1.testDocument.text, 'ABG')
      assert.equal(replica2.testDocument.text, 'ABG')
    })

    test('undoing an insertion containing other insertions', () => {
      const replica1 = buildReplica(1)
      const replica2 = buildReplica(2)

      const ops1 = performInsert(replica1, {row: 0, column: 0}, 'ABCDEFG')
      integrateOperations(replica2, ops1)

      const ops2 = performInsert(replica1, {row: 0, column: 3}, '***')
      integrateOperations(replica2, ops2)

      const ops1Undo = performUndoOrRedoOperations(replica1, ops1)
      integrateOperations(replica2, ops1Undo)

      assert.equal(replica1.testDocument.text, '***')
      assert.equal(replica2.testDocument.text, '***')
    })

    test('undoing an insertion containing a deletion', () => {
      const replica1 = buildReplica(1)
      const replica2 = buildReplica(2)

      const ops1 = performInsert(replica1, {row: 0, column: 0}, 'ABCDEFG')
      integrateOperations(replica2, ops1)

      const ops2 = performDelete(replica1, {row: 0, column: 3}, {row: 0, column: 6})
      integrateOperations(replica2, ops2)

      const ops1Undo = performUndoOrRedoOperations(replica1, ops1)
      integrateOperations(replica2, ops1Undo)

      assert.equal(replica1.testDocument.text, '')
      assert.equal(replica2.testDocument.text, '')
    })

    test('undoing a deletion that overlaps another concurrent deletion', () => {
      const replica1 = buildReplica(1)
      const replica2 = buildReplica(2)
      integrateOperations(replica2, performInsert(replica1, {row: 0, column: 0}, 'ABCDEFG'))

      const ops1 = performDelete(replica1, {row: 0, column: 1}, {row: 0, column: 4})
      const ops2 = performDelete(replica2, {row: 0, column: 3}, {row: 0, column: 6})
      integrateOperations(replica1, ops2)
      integrateOperations(replica2, ops1)
      const ops2Undo = performUndoOrRedoOperations(replica1, ops2)
      integrateOperations(replica2, ops2Undo)

      assert.equal(replica1.testDocument.text, 'AEFG')
      assert.equal(replica2.testDocument.text, 'AEFG')
    })

    test('inserting in the middle of an undone deletion and then redoing the deletion', () => {
      const replica = buildReplica(1)

      performInsert(replica, {row: 0, column: 0}, 'ABCDEFG')
      const deleteOps = performDelete(replica, {row: 0, column: 1}, {row: 0, column: 6})
      performUndoOrRedoOperations(replica, deleteOps)
      performInsert(replica, {row: 0, column: 3}, '***')
      performUndoOrRedoOperations(replica, deleteOps) // Redo

      assert.equal(replica.testDocument.text, 'A***G')
    })

    test('applying remote operations generated by a copy of the local replica', () => {
      const localReplica = buildReplica(1)
      const remoteReplica = buildReplica(1)

      integrateOperations(localReplica, performInsert(remoteReplica, {row: 0, column: 0}, 'ABCDEFG'))
      integrateOperations(localReplica, performInsert(remoteReplica, {row: 0, column: 3}, '+++'))
      performInsert(localReplica, {row: 0, column: 1}, '***')

      assert.equal(localReplica.testDocument.text, 'A***BC+++DEFG')
    })

    test('updating marker layers', () => {
      const replica1 = buildReplica(1)
      const replica2 = buildReplica(2)
      integrateOperations(replica2, performInsert(replica1, {row: 0, column: 0}, 'ABCDEFG'))

      const insert1 = performInsert(replica1, {row: 0, column: 6}, '+++')
      performInsert(replica2, {row: 0, column: 2}, '**')
      integrateOperations(replica2, insert1)

      const layerUpdate1 = replica1.updateMarkerLayers({
        1: { // Create a marker layer with 1 marker
            1: {
            range: {
              start: {row: 0, column: 1},
              end: {row: 0, column: 9}
            },
            exclusive: false,
            reversed: false,
            tailed: true
          }
        }
      })

      assert.deepEqual(replica2.integrateOperations(layerUpdate1).markerUpdates, {
        1: { // Site 1
          1: { // Marker layer 1
            1: { // Marker 1
              range: {
                start: {row: 0, column: 1},
                end: {row: 0, column: 11}
              },
              exclusive: false,
              reversed: false,
              tailed: true
            }
          }
        }
      })

      const layerUpdate2 = replica1.updateMarkerLayers({
        1: {
          1: { // Update marker
            range: {
              start: {row: 0, column: 2},
              end: {row: 0, column: 10}
            },
            exclusive: true,
            reversed: true
          },
          2: { // Create marker (with default values for exclusive, reversed, and tailed)
            range: {
              start: {row: 0, column: 0},
              end: {row: 0, column: 1}
            }
          }
        },
        2: { // Create marker layer with 1 marker
          1: {
            range: {
              start: {row: 0, column: 1},
              end: {row: 0, column: 2}
            }
          }
        }
      })

      assert.deepEqual(replica2.integrateOperations(layerUpdate2).markerUpdates, {
        1: {
          1: {
            1: {
              range: {
                start: {row: 0, column: 4},
                end: {row: 0, column: 12}
              },
              exclusive: true,
              reversed: true,
              tailed: true
            },
            2: {
              range: {
                start: {row: 0, column: 0},
                end: {row: 0, column: 1}
              },
              exclusive: false,
              reversed: false,
              tailed: true
            }
          },
          2: {
            1: {
              range: {
                start: {row: 0, column: 1},
                end: {row: 0, column: 4}
              },
              exclusive: false,
              reversed: false,
              tailed: true
            }
          }
        }
      })

      const layerUpdate3 = replica1.updateMarkerLayers({
        1: {
          2: null // Delete marker
        },
        2: null // Delete marker layer
      })
      assert.deepEqual(replica2.integrateOperations(layerUpdate3).markerUpdates, {
        1: {
          1: {
            2: null
          },
          2: null
        }
      })
    })

    test('deferring marker updates until the dependencies of their logical ranges arrive', () => {
      const replica1 = buildReplica(1)
      const replica2 = buildReplica(2)

      const insertion1 = performInsert(replica1, {row: 0, column: 0}, 'ABCDEFG')
      const insertion2 = performInsert(replica1, {row: 0, column: 4}, 'WXYZ')

      const layerUpdate1 = replica1.updateMarkerLayers({
        1: {
          // This only depends on insertion 1
          1: {
            range: {
              start: {row: 0, column: 1},
              end: {row: 0, column: 3}
            }
          },
          // This depends on insertion 2
          2: {
            range: {
              start: {row: 0, column: 5},
              end: {row: 0, column: 7}
            }
          },
          // This depends on insertion 2 but will be overwritten before
          // insertion 2 arrives at site 2
          3: {
            range: {
              start: {row: 0, column: 5},
              end: {row: 0, column: 7}
            }
          }
        }
      })

      const layerUpdate2 = replica1.updateMarkerLayers({
        1: {
          3: {
            range: {
              start: {row: 0, column: 1},
              end: {row: 0, column: 3}
            }
          }
        }
      })

      replica2.integrateOperations(insertion1)
      {
        const {markerUpdates} = replica2.integrateOperations(layerUpdate1.concat(layerUpdate2))
        assert.deepEqual(markerUpdates, {
          1: {
            1: {
              1: {
                range: {
                  start: {row: 0, column: 1},
                  end: {row: 0, column: 3}
                },
                exclusive: false,
                reversed: false,
                tailed: true
              },
              3: {
                range: {
                  start: {row: 0, column: 1},
                  end: {row: 0, column: 3}
                },
                exclusive: false,
                reversed: false,
                tailed: true
              }
            }
          }
        })
      }

      {
        const {markerUpdates} = replica2.integrateOperations(insertion2)
        assert.deepEqual(markerUpdates, {
          1: {
            1: {
              2: {
                range: {
                  start: {row: 0, column: 5},
                  end: {row: 0, column: 7}
                },
                exclusive: false,
                reversed: false,
                tailed: true
              }
            }
          }
        })
      }
    })
  })

  suite('history', () => {
    test('basic undo and redo', () => {
      const replicaA = buildReplica(1)
      const replicaB = buildReplica(2)

      integrateOperations(replicaB, performInsert(replicaA, {row: 0, column: 0}, 'a1 '))
      integrateOperations(replicaA, performInsert(replicaB, {row: 0, column: 3}, 'b1 '))
      integrateOperations(replicaB, performInsert(replicaA, {row: 0, column: 6}, 'a2 '))
      integrateOperations(replicaA, performInsert(replicaB, {row: 0, column: 9}, 'b2'))
      integrateOperations(replicaA, performSetTextInRange(replicaB, {row: 0, column: 3}, {row: 0, column: 5}, 'b3'))
      assert.equal(replicaA.testDocument.text, 'a1 b3 a2 b2')
      assert.equal(replicaB.testDocument.text, 'a1 b3 a2 b2')

      {
        integrateOperations(replicaA, performUndo(replicaB))
        assert.equal(replicaA.testDocument.text, 'a1 b1 a2 b2')
        assert.equal(replicaB.testDocument.text, 'a1 b1 a2 b2')
      }

      {
        integrateOperations(replicaB, performUndo(replicaA))
        assert.equal(replicaA.testDocument.text, 'a1 b1 b2')
        assert.equal(replicaB.testDocument.text, 'a1 b1 b2')
      }

      {
        integrateOperations(replicaB, performRedo(replicaA))
        assert.equal(replicaA.testDocument.text, 'a1 b1 a2 b2')
        assert.equal(replicaB.testDocument.text, 'a1 b1 a2 b2')
      }

      {
        integrateOperations(replicaA, performRedo(replicaB))
        assert.equal(replicaA.testDocument.text, 'a1 b3 a2 b2')
        assert.equal(replicaB.testDocument.text, 'a1 b3 a2 b2')
      }

      {
        integrateOperations(replicaA, performUndo(replicaB))
        assert.equal(replicaA.testDocument.text, 'a1 b1 a2 b2')
        assert.equal(replicaB.testDocument.text, 'a1 b1 a2 b2')
      }
    })

    test('clearing undo and redo stacks', () => {
      const replica = buildReplica(1)
      performInsert(replica, {row: 0, column: 0}, 'a')
      replica.clearUndoStack()
      performInsert(replica, {row: 0, column: 1}, 'b')
      performInsert(replica, {row: 0, column: 2}, 'c')
      replica.undo()
      replica.undo()
      assert.equal(replica.getText(), 'a')
      replica.redo()
      assert.equal(replica.getText(), 'ab')
      replica.clearRedoStack()
      replica.redo()
      assert.equal(replica.getText(), 'ab')

      // Clears the redo stack on changes
      replica.undo()
      performInsert(replica, {row: 0, column: 1}, 'd')
      assert.equal(replica.getText(), 'ad')
      replica.redo()
      assert.equal(replica.getText(), 'ad')
    })

    test('grouping changes since a checkpoint', () => {
      const replicaA = buildReplica(1)
      const replicaB = buildReplica(2)

      integrateOperations(replicaB, performInsert(replicaA, {row: 0, column: 0}, 'a1 '))
      integrateOperations(replicaB, performUpdateMarkers(replicaA, {
        1: {
          7: {range: buildRange(1, 2), exclusive: false, reversed: true, tailed: true},
          8: {range: buildRange(0, 1), exclusive: true, reversed: false, tailed: true}
        },
        2: {
          10: {range: buildRange(1, 2), exclusive: false, reversed: false, tailed: true}
        }
      }))
      const checkpoint = replicaA.createCheckpoint()
      integrateOperations(replicaB, performSetTextInRange(replicaA, {row: 0, column: 1}, {row: 0, column: 3}, '2 a3 '))
      integrateOperations(replicaB, performDelete(replicaA, {row: 0, column: 5}, {row: 0, column: 6}))
      integrateOperations(replicaA, performInsert(replicaB, {row: 0, column: 0}, 'b1 '))
      integrateOperations(replicaB, performUpdateMarkers(replicaA, {
        1: {
          7: {range: buildRange(3, 6), exclusive: true, reversed: false, tailed: true},
          8: null,
          9: {range: buildRange(0, 1), exclusive: true, reversed: false, tailed: true}
        },
        2: null,
        3: {
          11: {range: buildRange(1, 2), exclusive: false, reversed: false, tailed: true}
        }
      }))
      assert.equal(replicaA.testDocument.text, 'b1 a2 a3')
      assert.deepEqual(replicaA.testDocument.markers, {1: {
        1: {
          7: {range: buildRange(3, 6), exclusive: true, reversed: false, tailed: true},
          9: {range: buildRange(0, 1), exclusive: true, reversed: false, tailed: true}
        },
        3: {
          11: {range: buildRange(1, 2), exclusive: false, reversed: false, tailed: true}
        }
      }})
      assert.equal(replicaB.testDocument.text, 'b1 a2 a3')
      assert.deepEqual(replicaB.testDocument.markers, {1: {
        1: {
          7: {range: buildRange(3, 6), exclusive: true, reversed: false, tailed: true},
          9: {range: buildRange(0, 1), exclusive: true, reversed: false, tailed: true}
        },
        3: {
          11: {range: buildRange(1, 2), exclusive: false, reversed: false, tailed: true}
        }
      }})

      const changes = replicaA.groupChangesSinceCheckpoint(checkpoint)
      assert.deepEqual(changes, [
        {
          oldStart: {row: 0, column: 4},
          oldEnd: {row: 0, column: 6},
          oldText: "1 ",
          newStart: {row: 0, column: 4},
          newEnd: {row: 0, column: 8},
          newText: "2 a3"
        }
      ])
      assert.equal(replicaA.testDocument.text, 'b1 a2 a3')
      assert.equal(replicaB.testDocument.text, 'b1 a2 a3')

      integrateOperations(replicaB, performUndo(replicaA))
      assert.equal(replicaA.testDocument.text, 'b1 a1 ')
      assert.deepEqual(replicaA.testDocument.markers, {1: {
        1: {
          7: {range: buildRange(4, 5), exclusive: false, reversed: true, tailed: true},
          8: {range: buildRange(3, 4), exclusive: true, reversed: false, tailed: true}
        },
        2: {
          10: {range: buildRange(4, 5), exclusive: false, reversed: false, tailed: true}
        }
      }})
      assert.equal(replicaB.testDocument.text, 'b1 a1 ')
      assert.deepEqual(replicaB.testDocument.markers, {1: {
        1: {
          7: {range: buildRange(4, 5), exclusive: false, reversed: true, tailed: true},
          8: {range: buildRange(3, 4), exclusive: true, reversed: false, tailed: true}
        },
        2: {
          10: {range: buildRange(4, 5), exclusive: false, reversed: false, tailed: true}
        }
      }})

      integrateOperations(replicaB, performRedo(replicaA))
      assert.equal(replicaA.testDocument.text, 'b1 a2 a3')
      assert.deepEqual(replicaA.testDocument.markers, {1: {
        1: {
          7: {range: buildRange(3, 6), exclusive: true, reversed: false, tailed: true},
          9: {range: buildRange(0, 1), exclusive: true, reversed: false, tailed: true}
        },
        3: {
          11: {range: buildRange(1, 2), exclusive: false, reversed: false, tailed: true}
        }
      }})
      assert.equal(replicaB.testDocument.text, 'b1 a2 a3')
      assert.deepEqual(replicaB.testDocument.markers, {1: {
        1: {
          7: {range: buildRange(3, 6), exclusive: true, reversed: false, tailed: true},
          9: {range: buildRange(0, 1), exclusive: true, reversed: false, tailed: true}
        },
        3: {
          11: {range: buildRange(1, 2), exclusive: false, reversed: false, tailed: true}
        }
      }})

      integrateOperations(replicaB, performUndo(replicaA))
      assert.equal(replicaA.testDocument.text, 'b1 a1 ')
      assert.deepEqual(replicaA.testDocument.markers, {1: {
        1: {
          7: {range: buildRange(4, 5), exclusive: false, reversed: true, tailed: true},
          8: {range: buildRange(3, 4), exclusive: true, reversed: false, tailed: true}
        },
        2: {
          10: {range: buildRange(4, 5), exclusive: false, reversed: false, tailed: true}
        }
      }})
      assert.equal(replicaB.testDocument.text, 'b1 a1 ')
      assert.deepEqual(replicaB.testDocument.markers, {1: {
        1: {
          7: {range: buildRange(4, 5), exclusive: false, reversed: true, tailed: true},
          8: {range: buildRange(3, 4), exclusive: true, reversed: false, tailed: true}
        },
        2: {
          10: {range: buildRange(4, 5), exclusive: false, reversed: false, tailed: true}
        }
      }})

      // Delete checkpoint
      assert.deepEqual(replicaA.groupChangesSinceCheckpoint(checkpoint, {deleteCheckpoint: true}), [])
      assert.equal(replicaA.groupChangesSinceCheckpoint(checkpoint), false)
    })

    test('does not allow grouping changes past a barrier checkpoint', () => {
      const replica = buildReplica(1)

      const checkpointBeforeBarrier = replica.createCheckpoint({isBarrier: false})
      performInsert(replica, {row: 0, column: 0}, 'a')
      const barrierCheckpoint = replica.createCheckpoint({isBarrier: true})
      performInsert(replica, {row: 0, column: 1}, 'b')
      assert.equal(replica.groupChangesSinceCheckpoint(checkpointBeforeBarrier), false)

      performInsert(replica, {row: 0, column: 2}, 'c')
      const checkpointAfterBarrier = replica.createCheckpoint({isBarrier: false})
      const changes = replica.groupChangesSinceCheckpoint(barrierCheckpoint)
      assert.deepEqual(changes, [
        {
          oldStart: {row: 0, column: 1},
          oldEnd: {row: 0, column: 1},
          oldText: '',
          newStart: {row: 0, column: 1},
          newEnd: {row: 0, column: 3},
          newText: 'bc'
        }
      ])
    })

    test('reverting to a checkpoint', () => {
      const replicaA = buildReplica(1)
      const replicaB = buildReplica(2)

      integrateOperations(replicaB, performInsert(replicaA, {row: 0, column: 0}, 'a1 '))
      const checkpoint = replicaA.createCheckpoint()
      integrateOperations(replicaB, performSetTextInRange(replicaA, {row: 0, column: 1}, {row: 0, column: 3}, '2 a3 '))
      integrateOperations(replicaB, performDelete(replicaA, {row: 0, column: 5}, {row: 0, column: 6}))
      integrateOperations(replicaA, performInsert(replicaB, {row: 0, column: 0}, 'b1 '))
      assert.equal(replicaA.testDocument.text, 'b1 a2 a3')
      assert.equal(replicaB.testDocument.text, 'b1 a2 a3')

      integrateOperations(replicaB, performRevertToCheckpoint(replicaA, checkpoint))
      assert.equal(replicaA.testDocument.text, 'b1 a1 ')
      assert.equal(replicaB.testDocument.text, 'b1 a1 ')

      // Delete checkpoint
      replicaA.revertToCheckpoint(checkpoint, {deleteCheckpoint: true})
      assert.equal(replicaA.revertToCheckpoint(checkpoint), false)
    })

    test('does not allow reverting past a barrier checkpoint', () => {
      const replica = buildReplica(1)
      const checkpointBeforeBarrier = replica.createCheckpoint({isBarrier: false})
      performInsert(replica, {row: 0, column: 0}, 'a')
      replica.createCheckpoint({isBarrier: true})

      assert.equal(replica.revertToCheckpoint(checkpointBeforeBarrier), false)
      assert.equal(replica.getText(), 'a')

      performInsert(replica, {row: 0, column: 1}, 'b')
      assert.equal(replica.revertToCheckpoint(checkpointBeforeBarrier), false)
      assert.equal(replica.getText(), 'ab')
    })

    test('getting changes since a checkpoint', () => {
      const replicaA = buildReplica(1)
      const replicaB = buildReplica(2)

      integrateOperations(replicaB, performInsert(replicaA, {row: 0, column: 0}, 'a1 '))
      const checkpoint = replicaA.createCheckpoint()
      integrateOperations(replicaB, performSetTextInRange(replicaA, {row: 0, column: 1}, {row: 0, column: 3}, '2 a3 '))
      integrateOperations(replicaB, performDelete(replicaA, {row: 0, column: 5}, {row: 0, column: 6}))
      integrateOperations(replicaA, performInsert(replicaB, {row: 0, column: 0}, 'b1 '))
      assert.equal(replicaA.testDocument.text, 'b1 a2 a3')

      const changesSinceCheckpoint = replicaA.getChangesSinceCheckpoint(checkpoint)
      for (const change of changesSinceCheckpoint.reverse()) {
        replicaA.testDocument.setTextInRange(change.newStart, change.newEnd, change.oldText)
      }
      assert.equal(replicaA.testDocument.text, 'b1 a1 ')
    })

    test('undoing and redoing an operation that occurred adjacent to a checkpoint', () => {
      const replica = buildReplica(1)
      performInsert(replica, {row: 0, column: 0}, 'a')
      performInsert(replica, {row: 0, column: 1}, 'b')
      replica.createCheckpoint()
      performInsert(replica, {row: 0, column: 2}, 'c')

      replica.undo()
      assert.equal(replica.getText(), 'ab')
      replica.undo()
      assert.equal(replica.getText(), 'a')
      replica.redo()
      assert.equal(replica.getText(), 'ab')
      replica.redo()
      assert.equal(replica.getText(), 'abc')
    })

    test('reverting to a checkpoint after undoing and redoing an operation', () => {
      const replica = buildReplica(1)

      performInsert(replica, {row: 0, column: 0}, 'a')
      const checkpoint1 = replica.createCheckpoint()
      performInsert(replica, {row: 0, column: 1}, 'b')
      const checkpoint2 = replica.createCheckpoint()

      replica.undo()
      assert.equal(replica.getText(), 'a')
      replica.redo()
      assert.equal(replica.getText(), 'ab')

      performInsert(replica, {row: 0, column: 2}, 'c')

      replica.revertToCheckpoint(checkpoint2)
      assert.equal(replica.getText(), 'ab')

      replica.revertToCheckpoint(checkpoint1)
      assert.equal(replica.getText(), 'a')
    })

    test('undoing preserves checkpoint created prior to any operations', () => {
      const replica = buildReplica(1)
      const checkpoint = replica.createCheckpoint()
      replica.undo()
      performInsert(replica, {row: 0, column: 0}, 'a')

      replica.revertToCheckpoint(checkpoint)
      assert.equal(replica.getText(), '')
    })

    test('does not allow undoing past a barrier checkpoint', () => {
      const replica = buildReplica(1)
      performInsert(replica, {row: 0, column: 0}, 'a')
      performInsert(replica, {row: 0, column: 1}, 'b')
      replica.createCheckpoint({isBarrier: true})
      performInsert(replica, {row: 0, column: 2}, 'c')
      replica.createCheckpoint({isBarrier: false})

      assert.equal(replica.getText(), 'abc')
      replica.undo()
      assert.equal(replica.getText(), 'ab')
      assert.equal(replica.undo(), null)
      assert.equal(replica.getText(), 'ab')
    })

    test('does not add empty transactions to the undo stack', () => {
      const replicaA = buildReplica(1)
      const replicaB = buildReplica(2)
      integrateOperations(replicaB, performInsert(replicaA, {row: 0, column: 0}, 'a'))
      integrateOperations(replicaB, performInsert(replicaA, {row: 0, column: 1}, 'b'))
      const checkpoint = replicaA.createCheckpoint()
      integrateOperations(replicaA, performInsert(replicaB, {row: 0, column: 2}, 'c'))
      replicaA.groupChangesSinceCheckpoint(checkpoint)
      integrateOperations(replicaB, performUndo(replicaA))

      assert.equal(replicaA.testDocument.text, 'ac')
      assert.equal(replicaB.testDocument.text, 'ac')
    })

    test('applying a grouping interval', () => {
      const replica = buildReplica(1)
      replica.getNow = () => now

      let now = 0
      performInsert(replica, {row: 0, column: 0}, 'a')
      replica.applyGroupingInterval(101)

      now += 100
      performInsert(replica, {row: 0, column: 1}, 'b')
      replica.applyGroupingInterval(201)

      now += 200
      performInsert(replica, {row: 0, column: 2}, 'c')
      replica.applyGroupingInterval(201)

      // Not grouped with previous transaction because its associated grouping
      // interval is 201 and we always respect the minimum associated interval
      // between the last and penultimate transaction.
      now += 300
      performInsert(replica, {row: 0, column: 3}, 'd')
      replica.applyGroupingInterval(301)

      assert.equal(replica.testDocument.text, 'abcd')
      performUndo(replica)
      assert.equal(replica.testDocument.text, 'abc')
      performUndo(replica)
      assert.equal(replica.testDocument.text, '')
    })
  })

  test('replica convergence with random operations', function () {
    this.timeout(Infinity)
    const initialSeed = Date.now()
    const peerCount = 5
    for (var i = 0; i < 1000; i++) {
      const peers = Peer.buildNetwork(peerCount, '')
      let seed = initialSeed + i
      // seed = 1504270975436
      // global.enableLog = true
      const failureMessage = `Random seed: ${seed}`
      try {
        const random = Random(seed)
        let operationCount = 0
        while (operationCount < 10) {
          const peersWithOutboundOperations = peers.filter(p => !p.isOutboxEmpty())
          if (peersWithOutboundOperations.length === 0 || random(2)) {
            const peer = peers[random(peerCount)]
            const k = random(10)
            if (k < 2 && peer.editOperations.length > 0) {
              peer.undoRandomOperation(random)
            } else if (k < 4) {
              peer.updateRandomMarkers(random)
            } else {
              peer.performRandomEdit(random)
            }

            if (random(10) < 3) {
              peer.verifyTextUpdatesForRandomOperations(random)
            }

            assert.equal(peer.documentReplica.getText(), peer.document.text)

            operationCount++
          } else {
            const peer = peersWithOutboundOperations[random(peersWithOutboundOperations.length)]
            peer.deliverRandomOperation(random)

            assert.equal(peer.documentReplica.getText(), peer.document.text)
          }
        }

        while (true) {
          const peersWithOutboundOperations = peers.filter(p => !p.isOutboxEmpty())
          if (peersWithOutboundOperations.length === 0) break

          const peer = peersWithOutboundOperations[random(peersWithOutboundOperations.length)]
          peer.deliverRandomOperation(random)
        }

        for (let j = 0; j < peers.length; j++) {
          const peer = peers[j]
          peer.log(JSON.stringify(peer.document.text))
        }

        for (let j = 0; j < peers.length; j++) {
          assert.equal(peers[j].document.text, peers[j].documentReplica.getText())
        }

        for (let j = 0; j < peers.length - 1; j++) {
          assert.equal(peers[j].document.text, peers[j + 1].document.text, failureMessage)
        }

        // TODO: Get markers to converge. This isn't critical since markers
        // are current just used for decorations and an occasional divergence
        // won't be fatal.
        //
        // for (let j = 0; j < peers.length - 1; j++) {
        //   assert.deepEqual(peers[j].document.markers, peers[j + 1].document.markers, failureMessage)
        // }
      } catch (e) {
        console.log(failureMessage);
        throw e
      }
    }
  })
})

function buildReplica (siteId) {
  const replica = new DocumentReplica(siteId)
  replica.testDocument = new Document('')
  return replica
}

function performInsert (replica, position, text) {
  return performSetTextInRange(replica, position, ZERO_POINT, text)
}

function performDelete (replica, start, end) {
  return performSetTextInRange(replica, start, end, '')
}

function performSetTextInRange (replica, start, end, text) {
  replica.testDocument.setTextInRange(start, end, text)
  return replica.setTextInRange(start, end, text)
}

function performUndo (replica) {
  const {operations, textUpdates, markerUpdates} = replica.undo()
  replica.testDocument.updateText(textUpdates)
  replica.testDocument.updateMarkers({[replica.siteId]: markerUpdates})
  return operations
}

function performRedo (replica) {
  const {operations, textUpdates, markerUpdates} = replica.redo()
  replica.testDocument.updateText(textUpdates)
  replica.testDocument.updateMarkers({[replica.siteId]: markerUpdates})
  return operations
}

function performUndoOrRedoOperations (replica, operationToUndo) {
  const {textUpdates, operations} = replica.undoOrRedoOperations(operationToUndo)
  replica.testDocument.updateText(textUpdates)
  return operations
}

function performRevertToCheckpoint (replica, checkpoint, options) {
  const {textUpdates, operations} = replica.revertToCheckpoint(checkpoint, options)
  replica.testDocument.updateText(textUpdates)
  return operations
}

function performUpdateMarkers (replica, markerUpdates) {
  replica.testDocument.updateMarkers({[replica.siteId]: markerUpdates})
  return replica.updateMarkerLayers(markerUpdates)
}

function integrateOperations (replica, ops) {
  const {textUpdates, markerUpdates} = replica.integrateOperations(ops)
  replica.testDocument.updateText(textUpdates)
  replica.testDocument.updateMarkers(markerUpdates)
}

function buildRange (startColumn, endColumn) {
  return {
    start: {row: 0, column: startColumn},
    end: {row: 0, column: endColumn}
  }
}
