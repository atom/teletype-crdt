const assert = require('assert')
const Random = require('random-seed')
const LocalDocument = require('./helpers/local-document')
const Document = require('../lib/document')
const Peer = require('./helpers/peer')
const {ZERO_POINT} = require('../lib/point-helpers')

suite('Document', () => {
  suite('operations', () => {
    test('concurrent inserts at 0', () => {
      const replica1 = buildDocument(1)
      const replica2 = buildDocument(2)

      const ops1 = performInsert(replica1, {row: 0, column: 0}, 'a')
      const ops2 = performInsert(replica2, {row: 0, column: 0}, 'b')
      integrateOperations(replica1, ops2)
      integrateOperations(replica2, ops1)

      assert.equal(replica1.testLocalDocument.text, 'ab')
      assert.equal(replica2.testLocalDocument.text, 'ab')
    })

    test('concurrent inserts at the same position inside a previous insertion', () => {
      const replica1 = buildDocument(1)
      const replica2 = buildDocument(2)
      integrateOperations(replica2, performInsert(replica1, {row: 0, column: 0}, 'ABCDEFG'))

      const ops1 = performInsert(replica1, {row: 0, column: 2}, '+++')
      const ops2 = performInsert(replica2, {row: 0, column: 2}, '***')
      integrateOperations(replica1, ops2)
      integrateOperations(replica2, ops1)

      assert.equal(replica1.testLocalDocument.text, 'AB+++***CDEFG')
      assert.equal(replica2.testLocalDocument.text, 'AB+++***CDEFG')
    })

    test('concurrent inserts at different positions inside a previous insertion', () => {
      const replica1 = buildDocument(1)
      const replica2 = buildDocument(2)
      integrateOperations(replica2, performInsert(replica1, {row: 0, column: 0}, 'ABCDEFG'))

      const ops1 = performInsert(replica1, {row: 0, column: 6}, '+++')
      const ops2 = performInsert(replica2, {row: 0, column: 2}, '***')
      integrateOperations(replica1, ops2)
      integrateOperations(replica2, ops1)

      assert.equal(replica1.testLocalDocument.text, 'AB***CDEF+++G')
      assert.equal(replica2.testLocalDocument.text, 'AB***CDEF+++G')
    })

    test('concurrent overlapping deletions', () => {
      const replica1 = buildDocument(1)
      const replica2 = buildDocument(2)
      integrateOperations(replica2, performInsert(replica1, {row: 0, column: 0}, 'ABCDEFG'))

      const ops1 = performDelete(replica1, {row: 0, column: 2}, {row: 0, column: 5})
      const ops2 = performDelete(replica2, {row: 0, column: 4}, {row: 0, column: 6})
      integrateOperations(replica1, ops2)
      integrateOperations(replica2, ops1)

      assert.equal(replica1.testLocalDocument.text, 'ABG')
      assert.equal(replica2.testLocalDocument.text, 'ABG')
    })

    test('undoing an insertion containing other insertions', () => {
      const replica1 = buildDocument(1)
      const replica2 = buildDocument(2)

      const ops1 = performInsert(replica1, {row: 0, column: 0}, 'ABCDEFG')
      integrateOperations(replica2, ops1)

      const ops2 = performInsert(replica1, {row: 0, column: 3}, '***')
      integrateOperations(replica2, ops2)

      const ops1Undo = performUndoOrRedoOperations(replica1, ops1)
      integrateOperations(replica2, ops1Undo)

      assert.equal(replica1.testLocalDocument.text, '***')
      assert.equal(replica2.testLocalDocument.text, '***')
    })

    test('undoing an insertion containing a deletion', () => {
      const replica1 = buildDocument(1)
      const replica2 = buildDocument(2)

      const ops1 = performInsert(replica1, {row: 0, column: 0}, 'ABCDEFG')
      integrateOperations(replica2, ops1)

      const ops2 = performDelete(replica1, {row: 0, column: 3}, {row: 0, column: 6})
      integrateOperations(replica2, ops2)

      const ops1Undo = performUndoOrRedoOperations(replica1, ops1)
      integrateOperations(replica2, ops1Undo)

      assert.equal(replica1.testLocalDocument.text, '')
      assert.equal(replica2.testLocalDocument.text, '')
    })

    test('undoing a deletion that overlaps another concurrent deletion', () => {
      const replica1 = buildDocument(1)
      const replica2 = buildDocument(2)
      integrateOperations(replica2, performInsert(replica1, {row: 0, column: 0}, 'ABCDEFG'))

      const ops1 = performDelete(replica1, {row: 0, column: 1}, {row: 0, column: 4})
      const ops2 = performDelete(replica2, {row: 0, column: 3}, {row: 0, column: 6})
      integrateOperations(replica1, ops2)
      integrateOperations(replica2, ops1)
      const ops2Undo = performUndoOrRedoOperations(replica1, ops2)
      integrateOperations(replica2, ops2Undo)

      assert.equal(replica1.testLocalDocument.text, 'AEFG')
      assert.equal(replica2.testLocalDocument.text, 'AEFG')
    })

    test('inserting in the middle of an undone deletion and then redoing the deletion', () => {
      const replica = buildDocument(1)

      performInsert(replica, {row: 0, column: 0}, 'ABCDEFG')
      const deleteOps = performDelete(replica, {row: 0, column: 1}, {row: 0, column: 6})
      performUndoOrRedoOperations(replica, deleteOps)
      performInsert(replica, {row: 0, column: 3}, '***')
      performUndoOrRedoOperations(replica, deleteOps) // Redo

      assert.equal(replica.testLocalDocument.text, 'A***G')
    })

    test('applying remote operations generated by a copy of the local replica', () => {
      const localReplica = buildDocument(1)
      const remoteReplica = buildDocument(1)

      integrateOperations(localReplica, performInsert(remoteReplica, {row: 0, column: 0}, 'ABCDEFG'))
      integrateOperations(localReplica, performInsert(remoteReplica, {row: 0, column: 3}, '+++'))
      performInsert(localReplica, {row: 0, column: 1}, '***')

      assert.equal(localReplica.testLocalDocument.text, 'A***BC+++DEFG')
    })

    test('updating marker layers', () => {
      const replica1 = buildDocument(1)
      const replica2 = buildDocument(2)
      integrateOperations(replica2, performInsert(replica1, {row: 0, column: 0}, 'ABCDEFG'))

      const insert1 = performInsert(replica1, {row: 0, column: 6}, '+++')
      performInsert(replica2, {row: 0, column: 2}, '**')
      integrateOperations(replica2, insert1)

      integrateOperations(replica2, performUpdateMarkers(replica1, {
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
      }))
      assert.deepEqual(replica1.getMarkers(), {
        1: { // Site 1
          1: { // Marker layer 1
            1: { // Marker 1
              range: {
                start: {row: 0, column: 1},
                end: {row: 0, column: 9}
              },
              exclusive: false,
              reversed: false,
              tailed: true
            }
          }
        }
      })
      assert.deepEqual(replica2.getMarkers(), {
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
      assert.deepEqual(replica2.testLocalDocument.markers, replica2.getMarkers())

      integrateOperations(replica2, performUpdateMarkers(replica1, {
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
      }))
      assert.deepEqual(replica1.getMarkers(), {
        1: {
          1: {
            1: {
              range: {
                start: {row: 0, column: 2},
                end: {row: 0, column: 10}
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
                end: {row: 0, column: 2}
              },
              exclusive: false,
              reversed: false,
              tailed: true
            }
          }
        }
      })
      assert.deepEqual(replica2.getMarkers(), {
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
      assert.deepEqual(replica2.testLocalDocument.markers, replica2.getMarkers())

      integrateOperations(replica2, performUpdateMarkers(replica1, {
        1: {
          2: null // Delete marker
        },
        2: null // Delete marker layer
      }))
      assert.deepEqual(replica1.getMarkers(), {
        1: {
          1: {
            1: {
              range: {
                start: {row: 0, column: 2},
                end: {row: 0, column: 10}
              },
              exclusive: true,
              reversed: true,
              tailed: true
            },
          }
        }
      })
      assert.deepEqual(replica2.getMarkers(), {
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
          }
        }
      })
      assert.deepEqual(replica2.testLocalDocument.markers, replica2.getMarkers())
    })

    test('deferring marker updates until the dependencies of their logical ranges arrive', () => {
      const replica1 = buildDocument(1)
      const replica2 = buildDocument(2)

      const insertion1 = performInsert(replica1, {row: 0, column: 0}, 'ABCDEFG')
      const insertion2 = performInsert(replica1, {row: 0, column: 4}, 'WXYZ')

      const layerUpdate1 = replica1.updateMarkers({
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

      const layerUpdate2 = replica1.updateMarkers({
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

  suite('linear history methods', () => {
    test('basic undo and redo', () => {
      const replicaA = buildDocument(1)
      const replicaB = buildDocument(2)

      integrateOperations(replicaB, performInsert(replicaA, {row: 0, column: 0}, 'a1 '))
      integrateOperations(replicaA, performInsert(replicaB, {row: 0, column: 3}, 'b1 '))
      integrateOperations(replicaB, performInsert(replicaA, {row: 0, column: 6}, 'a2 '))
      integrateOperations(replicaA, performInsert(replicaB, {row: 0, column: 9}, 'b2'))
      integrateOperations(replicaA, performSetTextInRange(replicaB, {row: 0, column: 3}, {row: 0, column: 5}, 'b3'))
      assert.equal(replicaA.testLocalDocument.text, 'a1 b3 a2 b2')
      assert.equal(replicaB.testLocalDocument.text, 'a1 b3 a2 b2')

      {
        integrateOperations(replicaA, performUndo(replicaB).operations)
        assert.equal(replicaA.testLocalDocument.text, 'a1 b1 a2 b2')
        assert.equal(replicaB.testLocalDocument.text, 'a1 b1 a2 b2')
      }

      {
        integrateOperations(replicaB, performUndo(replicaA).operations)
        assert.equal(replicaA.testLocalDocument.text, 'a1 b1 b2')
        assert.equal(replicaB.testLocalDocument.text, 'a1 b1 b2')
      }

      {
        integrateOperations(replicaB, performRedo(replicaA).operations)
        assert.equal(replicaA.testLocalDocument.text, 'a1 b1 a2 b2')
        assert.equal(replicaB.testLocalDocument.text, 'a1 b1 a2 b2')
      }

      {
        integrateOperations(replicaA, performRedo(replicaB).operations)
        assert.equal(replicaA.testLocalDocument.text, 'a1 b3 a2 b2')
        assert.equal(replicaB.testLocalDocument.text, 'a1 b3 a2 b2')
      }

      {
        integrateOperations(replicaA, performUndo(replicaB).operations)
        assert.equal(replicaA.testLocalDocument.text, 'a1 b1 a2 b2')
        assert.equal(replicaB.testLocalDocument.text, 'a1 b1 a2 b2')
      }
    })

    test('skipping insertions on the undo stack', () => {
      const replicaA = buildDocument(1)
      const replicaB = buildDocument(1)

      integrateOperations(replicaB, performSetTextInRange(replicaA, ZERO_POINT, ZERO_POINT, 'abcdefg', {pushToHistory: false}))
      assert.equal(replicaA.testLocalDocument.text, 'abcdefg')
      assert.equal(replicaB.testLocalDocument.text, 'abcdefg')
      assert(!replicaA.undo())
      assert(!replicaB.undo())
    })

    test('clearing undo and redo stacks', () => {
      const replica = buildDocument(1)
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
      const replicaA = buildDocument(1)
      const replicaB = buildDocument(2)

      integrateOperations(replicaB, performInsert(replicaA, {row: 0, column: 0}, 'a1 '))
      const checkpoint = replicaA.createCheckpoint({markers: {
        1: {
          1: {range: buildRange(0, 1), exclusive: true, a: 1},
        },
        2: {
          1: {range: buildRange(1, 2), b: 2}
        }
      }})
      integrateOperations(replicaB, performSetTextInRange(replicaA, {row: 0, column: 1}, {row: 0, column: 3}, '2 a3 '))
      integrateOperations(replicaB, performDelete(replicaA, {row: 0, column: 5}, {row: 0, column: 6}))
      integrateOperations(replicaA, performInsert(replicaB, {row: 0, column: 0}, 'b1 '))
      assert.equal(replicaA.testLocalDocument.text, 'b1 a2 a3')
      assert.equal(replicaB.testLocalDocument.text, replicaA.testLocalDocument.text)
      assert.deepEqual(replicaB.testLocalDocument.markers, replicaA.testLocalDocument.markers)

      const changes = replicaA.groupChangesSinceCheckpoint(checkpoint, {
        markers: {
          1: {
            1: {range: buildRange(3, 5), c: 3},
          }
        }
      })

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
      assert.equal(replicaA.testLocalDocument.text, 'b1 a2 a3')
      assert.equal(replicaB.testLocalDocument.text, 'b1 a2 a3')

      {
        const {operations, markers} = performUndo(replicaA)
        integrateOperations(replicaB, operations)
        assert.equal(replicaA.testLocalDocument.text, 'b1 a1 ')
        assert.equal(replicaB.testLocalDocument.text, replicaA.testLocalDocument.text)
        assert.deepEqual(markers, {
          1: {
            1: {range: buildRange(3, 4), exclusive: true, a: 1},
          },
          2: {
            1: {range: buildRange(4, 5), b: 2}
          }
        })
      }

      {
        const {operations, markers} = performRedo(replicaA)
        integrateOperations(replicaB, operations)
        assert.equal(replicaA.testLocalDocument.text, 'b1 a2 a3')
        assert.equal(replicaB.testLocalDocument.text, replicaA.testLocalDocument.text)
        assert.deepEqual(markers, {
          1: {
            1: {range: buildRange(3, 5), c: 3},
          }
        })
      }

      integrateOperations(replicaA, performUndo(replicaB).operations)

      {
        const {operations, markers} = performUndo(replicaA)
        integrateOperations(replicaB, operations)
        assert.equal(replicaA.testLocalDocument.text, 'a1 ')
        assert.equal(replicaB.testLocalDocument.text, replicaA.testLocalDocument.text)
        assert.deepEqual(markers, {
          1: {
            1: {range: buildRange(0, 1), exclusive: true, a: 1},
          },
          2: {
            1: {range: buildRange(1, 2), b: 2}
          }
        })
      }

      // Delete checkpoint
      assert.deepEqual(replicaA.groupChangesSinceCheckpoint(checkpoint, {deleteCheckpoint: true}), [])
      assert.equal(replicaA.groupChangesSinceCheckpoint(checkpoint), false)
    })

    test('does not allow grouping changes past a barrier checkpoint', () => {
      const replica = buildDocument(1)

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
      const replicaA = buildDocument(1)
      const replicaB = buildDocument(2)

      integrateOperations(replicaB, performInsert(replicaA, {row: 0, column: 0}, 'a1 '))
      const checkpoint = replicaA.createCheckpoint({markers: {
        1: {
          1: {range: buildRange(0, 1), exclusive: true, a: 1},
        },
        2: {
          1: {range: buildRange(1, 2), b: 2}
        }
      }})
      integrateOperations(replicaB, performSetTextInRange(replicaA, {row: 0, column: 1}, {row: 0, column: 3}, '2 a3 '))
      integrateOperations(replicaB, performDelete(replicaA, {row: 0, column: 5}, {row: 0, column: 6}))
      integrateOperations(replicaA, performInsert(replicaB, {row: 0, column: 0}, 'b1 '))

      assert.equal(replicaA.testLocalDocument.text, 'b1 a2 a3')
      assert.equal(replicaB.testLocalDocument.text, replicaA.testLocalDocument.text)

      const {operations, markers} = performRevertToCheckpoint(replicaA, checkpoint)
      integrateOperations(replicaB, operations)
      assert.equal(replicaA.testLocalDocument.text, 'b1 a1 ')
      assert.equal(replicaB.testLocalDocument.text, replicaA.testLocalDocument.text)
      assert.deepEqual(markers, {
        1: {
          1: {range: buildRange(3, 4), exclusive: true, a: 1},
        },
        2: {
          1: {range: buildRange(4, 5), b: 2}
        }
      })

      // Delete checkpoint
      replicaA.revertToCheckpoint(checkpoint, {deleteCheckpoint: true})
      assert.equal(replicaA.revertToCheckpoint(checkpoint), false)
    })

    test('does not allow reverting past a barrier checkpoint', () => {
      const replica = buildDocument(1)
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
      const replicaA = buildDocument(1)
      const replicaB = buildDocument(2)

      integrateOperations(replicaB, performInsert(replicaA, {row: 0, column: 0}, 'a1 '))
      const checkpoint = replicaA.createCheckpoint()
      integrateOperations(replicaB, performSetTextInRange(replicaA, {row: 0, column: 1}, {row: 0, column: 3}, '2 a3 '))
      integrateOperations(replicaB, performDelete(replicaA, {row: 0, column: 5}, {row: 0, column: 6}))
      integrateOperations(replicaA, performInsert(replicaB, {row: 0, column: 0}, 'b1 '))
      assert.equal(replicaA.testLocalDocument.text, 'b1 a2 a3')

      const changesSinceCheckpoint = replicaA.getChangesSinceCheckpoint(checkpoint)
      for (const change of changesSinceCheckpoint.reverse()) {
        replicaA.testLocalDocument.setTextInRange(change.newStart, change.newEnd, change.oldText)
      }
      assert.equal(replicaA.testLocalDocument.text, 'b1 a1 ')
    })

    test('undoing and redoing an operation that occurred adjacent to a checkpoint', () => {
      const replica = buildDocument(1)
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
      const replica = buildDocument(1)

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
      const replica = buildDocument(1)
      const checkpoint = replica.createCheckpoint()
      replica.undo()
      performInsert(replica, {row: 0, column: 0}, 'a')

      replica.revertToCheckpoint(checkpoint)
      assert.equal(replica.getText(), '')
    })

    test('does not allow undoing past a barrier checkpoint', () => {
      const replica = buildDocument(1)
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
      const replicaA = buildDocument(1)
      const replicaB = buildDocument(2)
      integrateOperations(replicaB, performInsert(replicaA, {row: 0, column: 0}, 'a'))
      integrateOperations(replicaB, performInsert(replicaA, {row: 0, column: 1}, 'b'))
      const checkpoint = replicaA.createCheckpoint()
      integrateOperations(replicaA, performInsert(replicaB, {row: 0, column: 2}, 'c'))
      replicaA.groupChangesSinceCheckpoint(checkpoint)
      integrateOperations(replicaB, performUndo(replicaA).operations)

      assert.equal(replicaA.testLocalDocument.text, 'ac')
      assert.equal(replicaB.testLocalDocument.text, 'ac')
    })

    test('applying a grouping interval', () => {
      const replica = buildDocument(1)
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

      assert.equal(replica.testLocalDocument.text, 'abcd')
      performUndo(replica)
      assert.equal(replica.testLocalDocument.text, 'abc')
      performUndo(replica)
      assert.equal(replica.testLocalDocument.text, '')
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

            assert.equal(peer.history.getText(), peer.localDocument.text)

            operationCount++
          } else {
            const peer = peersWithOutboundOperations[random(peersWithOutboundOperations.length)]
            peer.deliverRandomOperation(random)

            assert.equal(peer.history.getText(), peer.localDocument.text)
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
          peer.log(JSON.stringify(peer.localDocument.text))
        }

        for (let j = 0; j < peers.length; j++) {
          assert.equal(peers[j].localDocument.text, peers[j].history.getText())
        }

        for (let j = 0; j < peers.length - 1; j++) {
          assert.equal(peers[j].localDocument.text, peers[j + 1].localDocument.text, failureMessage)
        }

        // TODO: Get markers to converge. This isn't critical since markers
        // are current just used for decorations and an occasional divergence
        // won't be fatal.
        //
        // for (let j = 0; j < peers.length - 1; j++) {
        //   assert.deepEqual(peers[j].localDocument.markers, peers[j + 1].localDocument.markers, failureMessage)
        // }
      } catch (e) {
        console.log(failureMessage);
        throw e
      }
    }
  })
})

function buildDocument (siteId) {
  const replica = new Document(siteId)
  replica.testLocalDocument = new LocalDocument('')
  return replica
}

function performInsert (replica, position, text) {
  return performSetTextInRange(replica, position, ZERO_POINT, text)
}

function performDelete (replica, start, end) {
  return performSetTextInRange(replica, start, end, '')
}

function performSetTextInRange (replica, start, end, text, options) {
  replica.testLocalDocument.setTextInRange(start, end, text)
  return replica.setTextInRange(start, end, text, options)
}

function performUndo (replica) {
  const {operations, textUpdates, markers} = replica.undo()
  replica.testLocalDocument.updateText(textUpdates)
  return {operations, markers}
}

function performRedo (replica) {
  const {operations, textUpdates, markers} = replica.redo()
  replica.testLocalDocument.updateText(textUpdates)
  return {operations, markers}
}

function performUndoOrRedoOperations (replica, operationToUndo) {
  const {operations, textUpdates} = replica.undoOrRedoOperations(operationToUndo)
  replica.testLocalDocument.updateText(textUpdates)
  return operations
}

function performRevertToCheckpoint (replica, checkpoint, options) {
  const {operations, textUpdates, markers} = replica.revertToCheckpoint(checkpoint, options)
  replica.testLocalDocument.updateText(textUpdates)
  return {operations, markers}
}

function performUpdateMarkers (replica, markerUpdates) {
  replica.testLocalDocument.updateMarkers({[replica.siteId]: markerUpdates})
  return replica.updateMarkers(markerUpdates)
}

function integrateOperations (replica, ops) {
  const {textUpdates, markerUpdates} = replica.integrateOperations(ops)
  replica.testLocalDocument.updateText(textUpdates)
  replica.testLocalDocument.updateMarkers(markerUpdates)
}

function buildRange (startColumn, endColumn) {
  return {
    start: {row: 0, column: startColumn},
    end: {row: 0, column: endColumn}
  }
}
