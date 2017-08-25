const {getRandomDocumentRange, buildRandomLines} = require('./random')
const {ZERO_POINT, compare, traverse, extentForText} = require('../../lib/point-helpers')
const {serializeOperation, deserializeOperation} = require('../../lib/serialization')
const Document = require('./document')
const DocumentReplica = require('../../lib/document-replica')

module.exports =
class Peer {
  static buildNetwork (n, text) {
    const peers = []
    for (var i = 0; i < n; i++) {
      peers.push(new Peer(i + 1, text))
    }

    for (var i = 0; i < n; i++) {
      for (var j = 0; j < n; j++) {
        if (i !== j) peers[i].connect(peers[j])
      }
    }

    return peers
  }

  constructor (siteId, text) {
    this.siteId = siteId
    this.outboxes = new Map()
    this.document = new Document(text)
    this.documentReplica = new DocumentReplica(siteId)
    this.deferredOperations = []
    this.history = []
    this.operations = [] // includes undo
  }

  connect (peer) {
    this.outboxes.set(peer, [])
  }

  send (operation) {
    operation = serializeOperation(operation)
    this.outboxes.forEach((outbox) => outbox.push(operation))
  }

  receive (operation) {
    operation = deserializeOperation(operation)
    this.log('Received', operation)
    const opsToApply = this.documentReplica.applyRemoteOperation(operation)
    this.log('Applying', opsToApply)
    this.document.applyMany(opsToApply)
    this.log('Text', JSON.stringify(this.document.text))
    this.history.push(operation)
    this.operations.push(operation)
  }

  isOutboxEmpty () {
    return Array.from(this.outboxes.values()).every((o) => o.length === 0)
  }

  performRandomEdit (random) {
    let operations
    while (true) {
      const {start, end} = getRandomDocumentRange(random, this.document)
      const text = buildRandomLines(random, 3)
      if (compare(end, ZERO_POINT) > 0 || text.length > 0) {
        this.log('setTextInRange', start, end, JSON.stringify(text))
        this.document.setTextInRange(start, end, text)
        operations = this.documentReplica.setTextInRange(start, end, text)
        break
      }
    }
    this.log('Text', JSON.stringify(this.document.text))

    for (const operation of operations) {
      this.send(operation)
      this.history.push(operation)
      this.operations.push(operation)
    }
  }

  undoRandomOperation (random) {
    const opToUndo = this.history[random(this.history.length)]
    if (this.documentReplica.hasAppliedOperation(opToUndo.opId)) {
      this.log('Undoing', opToUndo)
      const {opsToApply, opToSend} = this.documentReplica.undoOrRedoOperation(opToUndo.opId)
      this.log('Applying', opsToApply)
      this.document.applyMany(opsToApply)
      this.log('Text', JSON.stringify(this.document.text))
      this.operations.push(opToSend)
      this.send(opToSend)
    }
  }

  deliverRandomOperation (random) {
    const outboxes = Array.from(this.outboxes).filter(([peer, operations]) => operations.length > 0)
    const [peer, operations] = outboxes[random(outboxes.length)]
    peer.receive(operations.shift())
  }

  generateRandomRemotePosition (random) {
    const {start} = getRandomDocumentRange(random, this.document)
    const remotePosition = this.documentReplica.getRemotePosition(start)
    this.log('Generating random remote position', start, remotePosition)
    return remotePosition
  }

  copyReplica (siteId) {
    const replica = new DocumentReplica(siteId)
    for (let i = 0; i < this.operations.length; i++) {
      replica.applyRemoteOperation(this.operations[i])
    }
    return replica
  }

  log (...message) {
    if (global.enableLog) {
      console.log(`Site ${this.siteId}`, ...message)
    }
  }
}
