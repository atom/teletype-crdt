const assert = require('assert')
const TextBuffer = require('text-buffer')
const Random = require('random-seed')
const {buildRandomLines, getRandomBufferRange} = require('./helpers/random')
const Transceiver = require('../lib/transceiver')

suite('Peers Integration', () => {
  test('peer replicas converge', () => {
    const peerCount = 3
    const peers = buildPeers(peerCount)
    let seed = 1
    const random = Random(seed)
    for (var i = 0; i < 3; i++) {
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

    const finalText = peers[0].buffer.getText()
    for (var i = 1; i < peerCount; i++) {
      assert.equal(peers[i].buffer.getText(), finalText)
    }
  })

  function buildPeers (n) {
    const peers = []
    for (var i = 0; i < n; i++) {
      peers.push(new Peer())
    }

    for (var i = 0; i < n; i++) {
      for (var j = 0; i < n; i++) {
        if (i !== j) peers[i].connect(peers[j])
      }
    }

    return peers
  }
})

class Peer {
  constructor () {
    this.outboxes = new Map()
    this.buffer = new TextBuffer()
    this.channel = {
      send: (operation) => {
        this.outboxes.forEach((outbox) => outbox.push(operation))
      }
    }
    this.transceiver = new Transceiver(this.buffer, this.channel)
  }

  connect (peer) {
    this.outboxes.set(peer, [])
  }

  receive (operation) {
    this.channel.didReceive(operation)
  }

  isOutboxEmpty () {
    return Array.from(this.outboxes.values()).every((o) => o.length === 0)
  }

  performRandomEdit (random) {
    const range = getRandomBufferRange(random, this.buffer)
    const text = buildRandomLines(random, 4)
    this.buffer.setTextInRange(range, text)
  }

  deliverRandomOperation (random) {
    const outboxes = Array.from(this.outboxes).filter(([peer, operations]) => operations.length > 0)
    const [peer, operations] = outboxes[random(outboxes.length)]
    peer.receive(operations.shift())
  }
}

class Channel {
  constructor (props) {
    this.send = props.didSend
  }
}
