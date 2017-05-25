const assert = require('assert')
const Document = require('./helpers/document')
const DocumentReplica = require('../lib/document-replica')
const Peer = require('./helpers/peer')
const Random = require('random-seed')
const {Operation} = require('../lib/operations')

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

    replica1Document.apply(replica1.applyRemote(op2ToSend))
    replica2Document.apply(replica2.applyRemote(op1ToSend))
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
    replica2Document.apply(replica2.applyRemote(op0ToSend))
    assert.equal(replica1Document.text, 'ABCDEFG')
    assert.equal(replica2Document.text, 'ABCDEFG')

    const op1 = {type: 'insert', position: 2, text: '+++'}
    const op1ToSend = replica1.applyLocal(op1)
    replica1Document.apply(op1)

    const op2 = {type: 'insert', position: 2, text: '***'}
    const op2ToSend = replica2.applyLocal(op2)
    replica2Document.apply(op2)

    replica1Document.apply(replica1.applyRemote(op2ToSend))
    replica2Document.apply(replica2.applyRemote(op1ToSend))
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
    replica2Document.apply(replica2.applyRemote(op0ToSend))
    assert.equal(replica1Document.text, 'ABCDEFG')
    assert.equal(replica2Document.text, 'ABCDEFG')

    const op1 = {type: 'insert', position: 6, text: '+++'}
    const op1ToSend = replica1.applyLocal(op1)
    replica1Document.apply(op1)

    const op2 = {type: 'insert', position: 2, text: '***'}
    const op2ToSend = replica2.applyLocal(op2)
    replica2Document.apply(op2)

    replica1Document.apply(replica1.applyRemote(op2ToSend))
    replica2Document.apply(replica2.applyRemote(op1ToSend))
    assert.equal(replica1Document.text, 'AB***CDEF+++G')
    assert.equal(replica2Document.text, 'AB***CDEF+++G')
  })

  test('push local or remote operation', () => {
    const replica1 = new DocumentReplica(0)
    const replica2 = replica1.copy(1)
    const op1 = replica1.pushLocal(new Operation('insert', 0, 'b'))
    const op2 = replica2.pushLocal(new Operation('insert', 0, 'a'))
    const op1B = replica2.pushRemote(op1)
    const op2B = replica1.pushRemote(op2)

    const replica1Document = new Document('')
    replica1Document.apply(op1)
    replica1Document.apply(op2B)

    const replica2Document = new Document('')
    replica2Document.apply(op2)
    replica2Document.apply(op1B)

    assert.equal(replica1Document.text, 'ab')
    assert.equal(replica2Document.text, 'ab')
  })

  test.only('replica convergence with random operations', function () {
    this.timeout(Infinity)
    const initialSeed = Date.now()
    const peerCount = 2
    for (var i = 0; i < 1; i++) {
      const peers = Peer.buildNetwork(peerCount, '')
      let seed = initialSeed + i
      seed = 1495719714644
      const failureMessage = `Random seed: ${seed}`
      try {
        const random = Random(seed)
        for (var j = 0; j < 3; j++) {
          const peersWithOutboundOperations = peers.filter(p => !p.isOutboxEmpty())
          if (peersWithOutboundOperations.length === 0 || random(2)) {
            const peer = peers[random(peerCount)]
            peer.performRandomEdit(random)
          } else {
            const peer = peersWithOutboundOperations[random(peersWithOutboundOperations.length)]
            peer.deliverRandomOperation(random)
          }
        }

        while (true) {
          const peersWithOutboundOperations = peers.filter(p => !p.isOutboxEmpty())
          if (peersWithOutboundOperations.length === 0) break

          const peer = peersWithOutboundOperations[random(peersWithOutboundOperations.length)]
          peer.deliverRandomOperation(random)
        }

        console.log(peers.map(p => p.document.text))
        for (var j = 0; j < peerCount - 1; j++) {
          assert.equal(peers[j].document.text, peers[j + 1].document.text, failureMessage)
        }
      } catch (e) {
        console.log(failureMessage);
        throw e
      }
    }
  })
})
