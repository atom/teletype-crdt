const assert = require('assert')
const Document = require('./helpers/document')
const DocumentReplica = require('../lib/document-replica')
const Peer = require('./helpers/peer')
const Random = require('random-seed')

suite('DocumentReplica', () => {
  test('concurrent inserts at 0', () => {
    const replica1Document = new Document('')
    const replica1 = new DocumentReplica(1)
    const replica2Document = new Document('')
    const replica2 = new DocumentReplica(2)

    const op1 = {type: 'insert', position: {row: 0, column: 0}, text: 'a'}
    const op1ToSend = replica1.applyLocal(op1)
    replica1Document.apply(op1)

    const op2 = {type: 'insert', position: {row: 0, column: 0}, text: 'b'}
    const op2ToSend = replica2.applyLocal(op2)
    replica2Document.apply(op2)

    replica1Document.applyMany(replica1.applyRemote(op2ToSend))
    replica2Document.applyMany(replica2.applyRemote(op1ToSend))
    assert.equal(replica1Document.text, 'ab')
    assert.equal(replica2Document.text, 'ab')
  })

  test('concurrent inserts at the same position inside a previous insertion', () => {
    const replica1Document = new Document('')
    const replica1 = new DocumentReplica(1)
    const replica2Document = new Document('')
    const replica2 = new DocumentReplica(2)

    const op0 = {type: 'insert', position: {row: 0, column: 0}, text: 'ABCDEFG'}
    const op0ToSend = replica1.applyLocal(op0)
    replica1Document.apply(op0)
    replica2Document.applyMany(replica2.applyRemote(op0ToSend))
    assert.equal(replica1Document.text, 'ABCDEFG')
    assert.equal(replica2Document.text, 'ABCDEFG')

    const op1 = {type: 'insert', position: {row: 0, column: 2}, text: '+++'}
    const op1ToSend = replica1.applyLocal(op1)
    replica1Document.apply(op1)

    const op2 = {type: 'insert', position: {row: 0, column: 2}, text: '***'}
    const op2ToSend = replica2.applyLocal(op2)
    replica2Document.apply(op2)

    replica1Document.applyMany(replica1.applyRemote(op2ToSend))
    replica2Document.applyMany(replica2.applyRemote(op1ToSend))
    assert.equal(replica1Document.text, 'AB+++***CDEFG')
    assert.equal(replica2Document.text, 'AB+++***CDEFG')
  })

  test('concurrent inserts at different positions inside a previous insertion', () => {
    const replica1Document = new Document('')
    const replica1 = new DocumentReplica(1)
    const replica2Document = new Document('')
    const replica2 = new DocumentReplica(2)

    const op0 = {type: 'insert', position: {row: 0, column: 0}, text: 'ABCDEFG'}
    const op0ToSend = replica1.applyLocal(op0)
    replica1Document.apply(op0)
    replica2Document.applyMany(replica2.applyRemote(op0ToSend))
    assert.equal(replica1Document.text, 'ABCDEFG')
    assert.equal(replica2Document.text, 'ABCDEFG')

    const op1 = {type: 'insert', position: {row: 0, column: 6}, text: '+++'}
    const op1ToSend = replica1.applyLocal(op1)
    replica1Document.apply(op1)

    const op2 = {type: 'insert', position: {row: 0, column: 2}, text: '***'}
    const op2ToSend = replica2.applyLocal(op2)
    replica2Document.apply(op2)

    replica1Document.applyMany(replica1.applyRemote(op2ToSend))
    replica2Document.applyMany(replica2.applyRemote(op1ToSend))
    assert.equal(replica1Document.text, 'AB***CDEF+++G')
    assert.equal(replica2Document.text, 'AB***CDEF+++G')
  })

  test('concurrent overlapping deletions', () => {
    const replica1Document = new Document('')
    const replica1 = new DocumentReplica(1)
    const replica2Document = new Document('')
    const replica2 = new DocumentReplica(2)

    const op0 = {type: 'insert', position: {row: 0, column: 0}, text: 'ABCDEFG'}
    const op0ToSend = replica1.applyLocal(op0)
    replica1Document.apply(op0)
    replica2Document.applyMany(replica2.applyRemote(op0ToSend))
    assert.equal(replica1Document.text, 'ABCDEFG')
    assert.equal(replica2Document.text, 'ABCDEFG')

    const op1 = {type: 'delete', position: {row: 0, column: 2}, extent: {row: 0, column: 3}, text: 'CDE'}
    replica1Document.apply(op1)
    const op1ToSend = replica1.applyLocal(op1)

    const op2 = {type: 'delete', position: {row: 0, column: 4}, extent: {row: 0, column: 2}, text: 'EF'}
    replica2Document.apply(op2)
    const op2ToSend = replica2.applyLocal(op2)

    replica1Document.applyMany(replica1.applyRemote(op2ToSend))
    replica2Document.applyMany(replica2.applyRemote(op1ToSend))

    assert.equal(replica1Document.text, 'ABG')
    assert.equal(replica2Document.text, 'ABG')
  })

  test('undoing an insertion containing other insertions', () => {
    const replica1Document = new Document('')
    const replica1 = new DocumentReplica(1)
    const replica2Document = new Document('')
    const replica2 = new DocumentReplica(2)

    const op0 = {type: 'insert', position: {row: 0, column: 0}, text: 'ABCDEFG'}
    const op0ToSend = replica1.applyLocal(op0)
    replica1Document.apply(op0)
    replica2Document.applyMany(replica2.applyRemote(op0ToSend))

    const op1 = {type: 'insert', position: {row: 0, column: 3}, text: '***'}
    const op1ToSend = replica1.applyLocal(op1)
    replica1Document.apply(op1)
    replica2Document.applyMany(replica2.applyRemote(op1ToSend))

    const undoOp0 = replica1.undoLocal(op0ToSend.opId)
    replica1Document.applyMany(undoOp0.opsToApply)
    replica2Document.applyMany(replica2.applyRemote(undoOp0.opToSend))
    assert.equal(replica1Document.text, '***')
    assert.equal(replica2Document.text, '***')
  })

  test('undoing an insertion containing a deletion', () => {
    const replica1Document = new Document('')
    const replica1 = new DocumentReplica(1)
    const replica2Document = new Document('')
    const replica2 = new DocumentReplica(2)

    const op0 = {type: 'insert', position: {row: 0, column: 0}, text: 'ABCDEFG'}
    const op0ToSend = replica1.applyLocal(op0)
    replica1Document.apply(op0)
    replica2Document.applyMany(replica2.applyRemote(op0ToSend))

    const op1 = {type: 'delete', position: {row: 0, column: 3}, extent: {row: 0, column: 3}, text: 'DEF'}
    const op1ToSend = replica1.applyLocal(op1)
    replica1Document.apply(op1)
    replica2Document.applyMany(replica2.applyRemote(op1ToSend))

    const undoOp0 = replica1.undoLocal(op0ToSend.opId)
    replica1Document.applyMany(undoOp0.opsToApply)
    replica2Document.applyMany(replica2.applyRemote(undoOp0.opToSend))

    assert.equal(replica1Document.text, '')
    assert.equal(replica2Document.text, '')
  })

  test('undoing a deletion that overlaps another deletion', () => {
    const replica1Document = new Document('')
    const replica1 = new DocumentReplica(1)
    const replica2Document = new Document('')
    const replica2 = new DocumentReplica(2)

    const op0 = {type: 'insert', position: {row: 0, column: 0}, text: 'ABCDEFG'}
    const op0ToSend = replica1.applyLocal(op0)
    replica1Document.apply(op0)
    replica2Document.applyMany(replica2.applyRemote(op0ToSend))

    const op1 = {type: 'delete', position: {row: 0, column: 1}, extent: {row: 0, column: 3}, text: 'BCD'}
    const op1ToSend = replica1.applyLocal(op1)
    replica1Document.apply(op1)

    const op2 = {type: 'delete', position: {row: 0, column: 3}, extent: {row: 0, column: 3}, text: 'DEF'}
    const op2ToSend = replica2.applyLocal(op2)
    replica2Document.apply(op2)

    replica1Document.applyMany(replica1.applyRemote(op2ToSend))
    replica2Document.applyMany(replica2.applyRemote(op1ToSend))

    const undoOp2 = replica1.undoLocal(op2ToSend.opId)
    replica1Document.applyMany(undoOp2.opsToApply)
    replica2Document.applyMany(replica2.applyRemote(undoOp2.opToSend))
    assert.equal(replica1Document.text, 'AEFG')
    assert.equal(replica2Document.text, 'AEFG')
  })

  test('inserting in the middle of an undone deletion and then redoing the deletion', () => {
    const document = new Document('')
    const replica = new DocumentReplica(1)

    const op0 = {type: 'insert', position: {row: 0, column: 0}, text: 'ABCDEFG'}
    replica.applyLocal(op0)
    document.apply(op0)

    const op1 = {type: 'delete', position: {row: 0, column: 1}, extent: {row: 0, column: 5}, text: 'BCDEF'}
    const {opId: op1Id} = replica.applyLocal(op1)
    document.apply(op1)
    document.applyMany(replica.undoLocal(op1Id).opsToApply)

    const op2 = {type: 'insert', position: {row: 0, column: 3}, text: '***'}
    replica.applyLocal(op2)
    document.apply(op2)

    document.applyMany(replica.undoLocal(op1Id).opsToApply)
    assert.equal(document.text, 'A***G')
  })

  test('applying remote operations generated by a copy of the local replica', () => {
    const localReplicaDocument = new Document('')
    const localReplica = new DocumentReplica(1)
    const remoteReplica = new DocumentReplica(1)

    const op1ToSend = remoteReplica.applyLocal({type: 'insert', position: {row: 0, column: 0}, text: 'ABCDEFG'})
    const op2ToSend = remoteReplica.applyLocal({type: 'insert', position: {row: 0, column: 3}, text: '+++'})
    localReplicaDocument.applyMany(localReplica.applyRemote(op1ToSend))
    localReplicaDocument.applyMany(localReplica.applyRemote(op2ToSend))

    const op3 = {type: 'insert', position: {row: 0, column: 1}, text: '***'}
    localReplica.applyLocal(op3)
    localReplicaDocument.apply(op3)

    assert.equal(localReplicaDocument.text, 'A***BC+++DEFG')
  })

  test('local and remote position translation', () => {
    const replica1 = new DocumentReplica(1)
    const replica2 = new DocumentReplica(2)

    const op0ToSend = replica1.applyLocal({type: 'insert', position: {row: 0, column: 0}, text: 'ABCDEFG'})
    replica2.applyRemote(op0ToSend)

    const op1ToSend = replica1.applyLocal({type: 'insert', position: {row: 0, column: 6}, text: '+++'})
    const op2ToSend = replica2.applyLocal({type: 'insert', position: {row: 0, column: 2}, text: '**'})
    replica2.applyRemote(op1ToSend)

    assert.deepEqual(
      replica2.getLocalPositionSync(replica1.getRemotePosition({row: 0, column: 9})),
      {row: 0, column: 11}
    )
  })

  test('deferring remote position translation', (done) => {
    const replica1 = new DocumentReplica(1)
    const replica2 = new DocumentReplica(2)

    const op1ToSend = replica1.applyLocal({type: 'insert', position: {row: 0, column: 0}, text: 'ABCDEFG'})
    const remotePosition = replica1.getRemotePosition({row: 0, column: 4})

    replica2.getLocalPosition(remotePosition).then((localPosition) => {
      assert.deepEqual(localPosition, {row: 0, column: 4})
      done()
    })
    replica2.applyRemote(op1ToSend)
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
