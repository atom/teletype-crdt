const assert = require('assert')
const Document = require('./helpers/document')
const DocumentReplica = require('../lib/document-replica')
const Peer = require('./helpers/peer')
const Random = require('random-seed')
const {InsertOperation} = require('../lib/operations')

suite('DocumentReplica', () => {
  test('push local or remote operation', () => {
    const replica1 = new DocumentReplica(0)
    const replica2 = replica1.copy(1)
    const op1 = replica1.pushLocal(new InsertOperation({row: 0, column: 0}, 'b'))
    const op2 = replica2.pushLocal(new InsertOperation({row: 0, column: 0}, 'a'))
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

  test('replica convergence with random operations', function () {
    this.timeout(Infinity)
    const initialSeed = Date.now()
    const peerCount = 5
    for (var i = 0; i < 1000; i++) {
      const peers = Peer.buildNetwork(peerCount, 'ABCDEFG\nHIJKLMN\NOPQRSTU\nVWXYZ')
      let seed = initialSeed + i
      // seed = 1
      const failureMessage = `Random seed: ${seed}`
      try {
        const random = Random(seed)
        for (var j = 0; j < 15; j++) {
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
