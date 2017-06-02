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

    const op1 = {type: 'insert', position: 0, text: 'a'}
    const op1ToSend = replica1.applyLocal(op1)
    replica1Document.apply(op1)

    const op2 = {type: 'insert', position: 0, text: 'b'}
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

    const op0 = {type: 'insert', position: 0, text: 'ABCDEFG'}
    const op0ToSend = replica1.applyLocal(op0)
    replica1Document.apply(op0)
    replica2Document.applyMany(replica2.applyRemote(op0ToSend))
    assert.equal(replica1Document.text, 'ABCDEFG')
    assert.equal(replica2Document.text, 'ABCDEFG')

    const op1 = {type: 'insert', position: 2, text: '+++'}
    const op1ToSend = replica1.applyLocal(op1)
    replica1Document.apply(op1)

    const op2 = {type: 'insert', position: 2, text: '***'}
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

    const op0 = {type: 'insert', position: 0, text: 'ABCDEFG'}
    const op0ToSend = replica1.applyLocal(op0)
    replica1Document.apply(op0)
    replica2Document.applyMany(replica2.applyRemote(op0ToSend))
    assert.equal(replica1Document.text, 'ABCDEFG')
    assert.equal(replica2Document.text, 'ABCDEFG')

    const op1 = {type: 'insert', position: 6, text: '+++'}
    const op1ToSend = replica1.applyLocal(op1)
    replica1Document.apply(op1)

    const op2 = {type: 'insert', position: 2, text: '***'}
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

    const op0 = {type: 'insert', position: 0, text: 'ABCDEFG'}
    const op0ToSend = replica1.applyLocal(op0)
    replica1Document.apply(op0)
    replica2Document.applyMany(replica2.applyRemote(op0ToSend))
    assert.equal(replica1Document.text, 'ABCDEFG')
    assert.equal(replica2Document.text, 'ABCDEFG')

    const op1 = {type: 'delete', position: 2, extent: 3}
    replica1Document.apply(op1)
    const op1ToSend = replica1.applyLocal(op1)

    const op2 = {type: 'delete', position: 4, extent: 2}
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

    const op0 = {type: 'insert', position: 0, text: 'ABCDEFG'}
    const op0ToSend = replica1.applyLocal(op0)
    replica1Document.apply(op0)
    replica2Document.applyMany(replica2.applyRemote(op0ToSend))

    const op1 = {type: 'insert', position: 3, text: '***'}
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

    const op0 = {type: 'insert', position: 0, text: 'ABCDEFG'}
    const op0ToSend = replica1.applyLocal(op0)
    replica1Document.apply(op0)
    replica2Document.applyMany(replica2.applyRemote(op0ToSend))

    const op1 = {type: 'delete', position: 3, extent: 3}
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

    const op0 = {type: 'insert', position: 0, text: 'ABCDEFG'}
    const op0ToSend = replica1.applyLocal(op0)
    replica1Document.apply(op0)
    replica2Document.applyMany(replica2.applyRemote(op0ToSend))

    const op1 = {type: 'delete', position: 1, extent: 3}
    const op1ToSend = replica1.applyLocal(op1)
    replica1Document.apply(op1)

    const op2 = {type: 'delete', position: 3, extent: 3}
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

    const op0 = {type: 'insert', position: 0, text: 'ABCDEFG'}
    replica.applyLocal(op0)
    document.apply(op0)

    const op1 = {type: 'delete', position: 1, extent: 5}
    const {opId: op1Id} = replica.applyLocal(op1)
    document.apply(op1)
    document.applyMany(replica.undoLocal(op1Id).opsToApply)

    const op2 = {type: 'insert', position: 3, text: '***'}
    replica.applyLocal(op2)
    document.apply(op2)

    document.applyMany(replica.undoLocal(op1Id).opsToApply)
    assert.equal(replica.getText(), 'A***G')
  })

  test.only('replica convergence with random operations', function () {
    this.timeout(Infinity)
    const initialSeed = Date.now()
    const peerCount = 5
    for (var i = 0; i < 1000; i++) {
      console.log(i);
      const peers = Peer.buildNetwork(peerCount, '')
      let seed = initialSeed + i
      // seed = 1496346683429
      // global.enableLog = true
      const failureMessage = `Random seed: ${seed}`
      try {
        const random = Random(seed)
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
