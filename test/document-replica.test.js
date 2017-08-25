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

      const op1 = performInsert(replica1, {row: 0, column: 0}, 'a')
      const op2 = performInsert(replica2, {row: 0, column: 0}, 'b')
      applyRemoteOperation(replica1, op2)
      applyRemoteOperation(replica2, op1)

      assert.equal(replica1.testDocument.text, 'ab')
      assert.equal(replica2.testDocument.text, 'ab')
    })

    test('concurrent inserts at the same position inside a previous insertion', () => {
      const replica1 = buildReplica(1)
      const replica2 = buildReplica(2)
      applyRemoteOperation(replica2, performInsert(replica1, {row: 0, column: 0}, 'ABCDEFG'))

      const op1 = performInsert(replica1, {row: 0, column: 2}, '+++')
      const op2 = performInsert(replica2, {row: 0, column: 2}, '***')
      applyRemoteOperation(replica1, op2)
      applyRemoteOperation(replica2, op1)

      assert.equal(replica1.testDocument.text, 'AB+++***CDEFG')
      assert.equal(replica2.testDocument.text, 'AB+++***CDEFG')
    })

    test('concurrent inserts at different positions inside a previous insertion', () => {
      const replica1 = buildReplica(1)
      const replica2 = buildReplica(2)
      applyRemoteOperation(replica2, performInsert(replica1, {row: 0, column: 0}, 'ABCDEFG'))

      const op1 = performInsert(replica1, {row: 0, column: 6}, '+++')
      const op2 = performInsert(replica2, {row: 0, column: 2}, '***')
      applyRemoteOperation(replica1, op2)
      applyRemoteOperation(replica2, op1)

      assert.equal(replica1.testDocument.text, 'AB***CDEF+++G')
      assert.equal(replica2.testDocument.text, 'AB***CDEF+++G')
    })

    test('concurrent overlapping deletions', () => {
      const replica1 = buildReplica(1)
      const replica2 = buildReplica(2)
      applyRemoteOperation(replica2, performInsert(replica1, {row: 0, column: 0}, 'ABCDEFG'))

      const op1 = performDelete(replica1, {row: 0, column: 2}, {row: 0, column: 5})
      const op2 = performDelete(replica2, {row: 0, column: 4}, {row: 0, column: 6})
      applyRemoteOperation(replica1, op2)
      applyRemoteOperation(replica2, op1)

      assert.equal(replica1.testDocument.text, 'ABG')
      assert.equal(replica2.testDocument.text, 'ABG')
    })

    test('undoing an insertion containing other insertions', () => {
      const replica1 = buildReplica(1)
      const replica2 = buildReplica(2)

      const op1 = performInsert(replica1, {row: 0, column: 0}, 'ABCDEFG')
      applyRemoteOperation(replica2, op1)

      const op2 = performInsert(replica1, {row: 0, column: 3}, '***')
      applyRemoteOperation(replica2, op2)

      const op1Undo = performUndoOrRedoOperation(replica1, op1.opId)
      applyRemoteOperation(replica2, op1Undo)

      assert.equal(replica1.testDocument.text, '***')
      assert.equal(replica2.testDocument.text, '***')
    })

    test('undoing an insertion containing a deletion', () => {
      const replica1 = buildReplica(1)
      const replica2 = buildReplica(2)

      const op1 = performInsert(replica1, {row: 0, column: 0}, 'ABCDEFG')
      applyRemoteOperation(replica2, op1)

      const op2 = performDelete(replica1, {row: 0, column: 3}, {row: 0, column: 6})
      applyRemoteOperation(replica2, op2)

      const op1Undo = performUndoOrRedoOperation(replica1, op1.opId)
      applyRemoteOperation(replica2, op1Undo)

      assert.equal(replica1.testDocument.text, '')
      assert.equal(replica2.testDocument.text, '')
    })

    test('undoing a deletion that overlaps another concurrent deletion', () => {
      const replica1 = buildReplica(1)
      const replica2 = buildReplica(2)
      applyRemoteOperation(replica2, performInsert(replica1, {row: 0, column: 0}, 'ABCDEFG'))

      const op1 = performDelete(replica1, {row: 0, column: 1}, {row: 0, column: 4})
      const op2 = performDelete(replica2, {row: 0, column: 3}, {row: 0, column: 6})
      applyRemoteOperation(replica1, op2)
      applyRemoteOperation(replica2, op1)
      const op2Undo = performUndoOrRedoOperation(replica1, op2.opId)
      applyRemoteOperation(replica2, op2Undo)

      assert.equal(replica1.testDocument.text, 'AEFG')
      assert.equal(replica2.testDocument.text, 'AEFG')
    })

    test('inserting in the middle of an undone deletion and then redoing the deletion', () => {
      const replica = buildReplica(1)

      performInsert(replica, {row: 0, column: 0}, 'ABCDEFG')
      const deleteOp = performDelete(replica, {row: 0, column: 1}, {row: 0, column: 6})
      performUndoOrRedoOperation(replica, deleteOp.opId)
      performInsert(replica, {row: 0, column: 3}, '***')
      performUndoOrRedoOperation(replica, deleteOp.opId) // Redo

      assert.equal(replica.testDocument.text, 'A***G')
    })

    test('applying remote operations generated by a copy of the local replica', () => {
      const localReplica = buildReplica(1)
      const remoteReplica = buildReplica(1)

      applyRemoteOperation(localReplica, performInsert(remoteReplica, {row: 0, column: 0}, 'ABCDEFG'))
      applyRemoteOperation(localReplica, performInsert(remoteReplica, {row: 0, column: 3}, '+++'))
      performInsert(localReplica, {row: 0, column: 1}, '***')

      assert.equal(localReplica.testDocument.text, 'A***BC+++DEFG')
    })
  })

  suite('history', () => {
    test('basic undo and redo', () => {
      const replicaA = buildReplica(1)
      const replicaB = buildReplica(2)

      applyRemoteOperation(replicaB, performInsert(replicaA, {row: 0, column: 0}, 'a1 '))
      applyRemoteOperation(replicaA, performInsert(replicaB, {row: 0, column: 3}, 'b1 '))
      applyRemoteOperation(replicaB, performInsert(replicaA, {row: 0, column: 6}, 'a2 '))
      applyRemoteOperation(replicaA, performInsert(replicaB, {row: 0, column: 9}, 'b2'))
      applyRemoteOperations(replicaA, performSetTextInRange(replicaB, {row: 0, column: 3}, {row: 0, column: 5}, 'b3'))
      assert.equal(replicaA.testDocument.text, 'a1 b3 a2 b2')
      assert.equal(replicaB.testDocument.text, 'a1 b3 a2 b2')

      {
        applyRemoteOperations(replicaA, performUndo(replicaB))
        assert.equal(replicaA.testDocument.text, 'a1 b1 a2 b2')
        assert.equal(replicaB.testDocument.text, 'a1 b1 a2 b2')
      }

      {
        applyRemoteOperations(replicaB, performUndo(replicaA))
        assert.equal(replicaA.testDocument.text, 'a1 b1 b2')
        assert.equal(replicaB.testDocument.text, 'a1 b1 b2')
      }

      {
        applyRemoteOperations(replicaB, performRedo(replicaA))
        assert.equal(replicaA.testDocument.text, 'a1 b1 a2 b2')
        assert.equal(replicaB.testDocument.text, 'a1 b1 a2 b2')
      }

      {
        applyRemoteOperations(replicaA, performRedo(replicaB))
        assert.equal(replicaA.testDocument.text, 'a1 b3 a2 b2')
        assert.equal(replicaB.testDocument.text, 'a1 b3 a2 b2')
      }

      {
        applyRemoteOperations(replicaA, performUndo(replicaB))
        assert.equal(replicaA.testDocument.text, 'a1 b1 a2 b2')
        assert.equal(replicaB.testDocument.text, 'a1 b1 a2 b2')
      }
    })

    test('grouping changes since a checkpoint', () => {
      const replicaA = buildReplica(1)
      const replicaB = buildReplica(2)

      applyRemoteOperation(replicaB, performInsert(replicaA, {row: 0, column: 0}, 'a1 '))
      const checkpoint = replicaA.createCheckpoint()
      applyRemoteOperations(replicaB, performSetTextInRange(replicaA, {row: 0, column: 1}, {row: 0, column: 3}, '2 a3 '))
      applyRemoteOperation(replicaB, performDelete(replicaA, {row: 0, column: 5}, {row: 0, column: 6}))
      applyRemoteOperation(replicaA, performInsert(replicaB, {row: 0, column: 0}, 'b1 '))
      assert.equal(replicaA.testDocument.text, 'b1 a2 a3')
      assert.equal(replicaB.testDocument.text, 'b1 a2 a3')

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

      applyRemoteOperations(replicaB, performUndo(replicaA))
      assert.equal(replicaA.testDocument.text, 'b1 a1 ')
      assert.equal(replicaB.testDocument.text, 'b1 a1 ')

      applyRemoteOperations(replicaB, performRedo(replicaA))
      assert.equal(replicaA.testDocument.text, 'b1 a2 a3')
      assert.equal(replicaB.testDocument.text, 'b1 a2 a3')

      applyRemoteOperations(replicaB, performUndo(replicaA))
      assert.equal(replicaA.testDocument.text, 'b1 a1 ')
      assert.equal(replicaB.testDocument.text, 'b1 a1 ')
    })
  })

  suite('positions', () => {
    test('local and remote position translation', () => {
      const replica1 = buildReplica(1)
      const replica2 = buildReplica(2)
      applyRemoteOperation(replica2, performInsert(replica1, {row: 0, column: 0}, 'ABCDEFG'))

      const op1 = performInsert(replica1, {row: 0, column: 6}, '+++')
      performInsert(replica2, {row: 0, column: 2}, '**')
      applyRemoteOperation(replica2, op1)

      assert.deepEqual(
        replica2.getLocalPositionSync(replica1.getRemotePosition({row: 0, column: 9})),
        {row: 0, column: 11}
      )
    })

    test('deferring remote position translation', (done) => {
      const replica1 = buildReplica(1)
      const replica2 = buildReplica(2)

      const op1 = performInsert(replica1, {row: 0, column: 0}, 'ABCDEFG')
      const remotePosition = replica1.getRemotePosition({row: 0, column: 4})
      replica2.getLocalPosition(remotePosition).then((localPosition) => {
        assert.deepEqual(localPosition, {row: 0, column: 4})
        done()
      })

      // Resolves the promise above
      applyRemoteOperation(replica2, op1)
    })
  })

  test('replica convergence with random operations', function () {
    this.timeout(Infinity)
    const initialSeed = Date.now()
    const peerCount = 5
    for (var i = 0; i < 1000; i++) {
      const peers = Peer.buildNetwork(peerCount, '')
      let seed = initialSeed + i
      // seed = 1496346683429
      // global.enableLog = true
      const failureMessage = `Random seed: ${seed}`
      try {
        const random = Random(seed)
        const remotePositions = []
        let operationCount = 0
        while (operationCount < 10) {
          const k = random(10)
          const peersWithOutboundOperations = peers.filter(p => !p.isOutboxEmpty())
          if (peersWithOutboundOperations.length === 0 || random(2)) {
            const peer = peers[random(peerCount)]
            if (random(10) < 2 && peer.localOperations.length > 0) {
              peer.undoRandomOperation(random)
            } else {
              peer.performRandomEdit(random)
            }

            if (random(10) < 3) {
              remotePositions.push(peer.generateRandomRemotePosition(random))
            }

            if (random(10) < 3) {
              peer.verifyDeltaForRandomOperations(random)
            }

            assert.equal(peer.documentReplica.getText(), peer.document.text)

            operationCount++
          } else {
            const peer = peersWithOutboundOperations[random(peersWithOutboundOperations.length)]
            peer.deliverRandomOperation(random)

            assert.equal(peer.documentReplica.getText(), peer.document.text)
          }

          for (let j = 0; j < peers.length; j++) {
            const peer = peers[j]
            for (var l = 0; l < remotePositions.length; l++) {
              const remotePosition = remotePositions[l]
              const canTranslatePosition = (
                peer.documentReplica.hasAppliedOperation(remotePosition.leftDependencyId) &&
                peer.documentReplica.hasAppliedOperation(remotePosition.rightDependencyId)
              )
              if (canTranslatePosition) {
                const replicaCopy = peer.copyReplica(remotePosition.site)
                assert.equal(replicaCopy.getText(), peer.document.text)
                const opId = {
                  site: replicaCopy.siteId,
                  seq: (replicaCopy.maxSeqsBySite[remotePosition.site] || 0) + 1
                }
                const [insertionAtRemotePosition] = replicaCopy.insertRemote(
                  Object.assign({opId, text: 'X'}, remotePosition)
                )
                assert.deepEqual(
                  peer.documentReplica.getLocalPositionSync(remotePosition),
                  insertionAtRemotePosition.position,
                  'Site: ' + peer.siteId + '\n' + failureMessage
                )
              }
            }
          }
        }

        while (true) {
          const peersWithOutboundOperations = peers.filter(p => !p.isOutboxEmpty())
          if (peersWithOutboundOperations.length === 0) break

          const peer = peersWithOutboundOperations[random(peersWithOutboundOperations.length)]
          peer.deliverRandomOperation(random)
        }

        for (let j = 0; j < peers.length; j++) {
          assert.equal(peers[j].document.text, peers[j].documentReplica.getText())
        }

        for (let j = 0; j < peers.length - 1; j++) {
          assert.equal(peers[j].document.text, peers[j + 1].document.text, failureMessage)
        }
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
  return performSetTextInRange(replica, position, ZERO_POINT, text)[0]
}

function performDelete (replica, start, end) {
  return performSetTextInRange(replica, start, end, null)[0]
}

function performSetTextInRange (replica, start, end, text) {
  replica.testDocument.setTextInRange(start, end, text)
  return replica.setTextInRange(start, end, text)
}

function performUndo (replica) {
  const {opsToApply, opsToSend} = replica.undo()
  replica.testDocument.applyMany(opsToApply)
  return opsToSend
}

function performRedo (replica) {
  const {opsToApply, opsToSend} = replica.redo()
  replica.testDocument.applyMany(opsToApply)
  return opsToSend
}

function performUndoOrRedoOperation (replica, opId) {
  const {opsToApply, opToSend} = replica.undoOrRedoOperation(opId)
  replica.testDocument.applyMany(opsToApply)
  return opToSend
}

function applyRemoteOperations (replica, ops) {
  for (const op of ops) {
    applyRemoteOperation(replica, op)
  }
}

function applyRemoteOperation (replica, op) {
  replica.testDocument.applyMany(replica.applyRemoteOperation(op))
}
