const assert = require('assert')
const Random = require('random-seed')
const Document = require('./helpers/document')
const DocumentReplica = require('../lib/document-replica')
const Peer = require('./helpers/peer')

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

      const op1 = performDelete(replica1, {row: 0, column: 2}, {row: 0, column: 3})
      const op2 = performDelete(replica2, {row: 0, column: 4}, {row: 0, column: 2})
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

      const op1Undo = performundoOrRedoOperation(replica1, op1.opId)
      applyRemoteOperation(replica2, op1Undo)

      assert.equal(replica1.testDocument.text, '***')
      assert.equal(replica2.testDocument.text, '***')
    })

    test('undoing an insertion containing a deletion', () => {
      const replica1 = buildReplica(1)
      const replica2 = buildReplica(2)

      const op1 = performInsert(replica1, {row: 0, column: 0}, 'ABCDEFG')
      applyRemoteOperation(replica2, op1)

      const op2 = performDelete(replica1, {row: 0, column: 3}, {row: 0, column: 3})
      applyRemoteOperation(replica2, op2)

      const op1Undo = performundoOrRedoOperation(replica1, op1.opId)
      applyRemoteOperation(replica2, op1Undo)

      assert.equal(replica1.testDocument.text, '')
      assert.equal(replica2.testDocument.text, '')
    })

    test('undoing a deletion that overlaps another concurrent deletion', () => {
      const replica1 = buildReplica(1)
      const replica2 = buildReplica(2)
      applyRemoteOperation(replica2, performInsert(replica1, {row: 0, column: 0}, 'ABCDEFG'))

      const op1 = performDelete(replica1, {row: 0, column: 1}, {row: 0, column: 3})
      const op2 = performDelete(replica2, {row: 0, column: 3}, {row: 0, column: 3})
      applyRemoteOperation(replica1, op2)
      applyRemoteOperation(replica2, op1)
      const op2Undo = performundoOrRedoOperation(replica1, op2.opId)
      applyRemoteOperation(replica2, op2Undo)

      assert.equal(replica1.testDocument.text, 'AEFG')
      assert.equal(replica2.testDocument.text, 'AEFG')
    })

    test('inserting in the middle of an undone deletion and then redoing the deletion', () => {
      const replica = buildReplica(1)

      performInsert(replica, {row: 0, column: 0}, 'ABCDEFG')
      const deleteOp = performDelete(replica, {row: 0, column: 1}, {row: 0, column: 5})
      performundoOrRedoOperation(replica, deleteOp.opId)
      performInsert(replica, {row: 0, column: 3}, '***')
      performundoOrRedoOperation(replica, deleteOp.opId) // Redo

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
            if (random(10) < 2 && peer.history.length > 0) {
              peer.undoRandomOperation(random)
            } else {
              peer.performRandomEdit(random)
            }

            if (random(10) < 3) {
              remotePositions.push(peer.generateRandomRemotePosition(random))
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
  replica.testDocument.insert(position, text)
  return replica.insert(position, text)
}

function performDelete (replica, position, extent) {
  replica.testDocument.delete(position, extent)
  return replica.delete(position, extent)
}

function performundoOrRedoOperation (replica, opId) {
  const {opsToApply, opToSend} = replica.undoOrRedoOperation(opId)
  replica.testDocument.applyMany(opsToApply)
  return opToSend
}

function applyRemoteOperation (replica, op) {
  replica.testDocument.applyMany(replica.applyRemoteOperation(op))
}
