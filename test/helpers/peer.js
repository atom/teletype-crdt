const {getRandomDocumentPositionAndExtent, buildRandomLines} = require('./random')
const Document = require('./document')
const DocumentReplica = require('../../lib/document-replica')
const {Operation} = require('../../lib/operations')

module.exports =
class Peer {
  static buildNetwork (n, text) {
    const peers = []
    for (var i = 0; i < n; i++) {
      peers.push(new Peer(i, text))
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
    this.history = []
    this.deferredOperations = []
  }

  connect (peer) {
    this.outboxes.set(peer, [])
  }

  send (operation) {
    this.outboxes.forEach((outbox) => outbox.push(operation))
  }

  receive (operation) {
    this.log('REMOTE: Received', operation.toString())
    if (operation.contextVector.isSubsetOf(this.documentReplica.documentState)) {
      const transformedOperation = this.documentReplica.pushRemote(operation)
      this.log('REMOTE: Transforming it and applying it', transformedOperation.toString())
      this.document.apply(transformedOperation)
      this.log('REMOTE: Text after operation', JSON.stringify(this.document.text))
      this.retryDeferredOperations()
    } else {
      this.log('Deferring it')
      this.deferredOperations.push(operation)
    }
  }

  retryDeferredOperations () {
    const deferredOperations = this.deferredOperations
    this.deferredOperations = []
    for (const operation of deferredOperations) {
      this.log('Retrying deferred operation', operation.toString())
      this.receive(operation)
    }
  }

  isOutboxEmpty () {
    return Array.from(this.outboxes.values()).every((o) => o.length === 0)
  }

  performRandomEdit (random) {
    const {start, extent} = getRandomDocumentPositionAndExtent(random, this.document)
    const k = random(10)
    let operationToApply, operationToSend
    if (k < 2 && this.history.length > 0) {
      const result = this.documentReplica.undoLocal(this.history.pop())
      operationToApply = result.transformedOperation
      operationToSend = result.inverseOperation
    } else if (k < 6) {
      operationToApply = new Operation('insert', start, buildRandomLines(random, 5), this.siteId)
      operationToSend = this.documentReplica.pushLocal(operationToApply)
      this.history.push(operationToSend)
    } else {
      operationToApply = new Operation('delete', start, this.document.getTextFromPointAndExtent(start, extent), this.siteId)
      operationToSend = this.documentReplica.pushLocal(operationToApply)
      this.history.push(operationToSend)
    }

    this.document.apply(operationToApply)
    this.log('LOCAL:  Generating and sending', operationToSend.toString())
    this.log('LOCAL:  Text after operation', JSON.stringify(this.document.text))
    this.send(operationToSend)
  }

  deliverRandomOperation (random) {
    const outboxes = Array.from(this.outboxes).filter(([peer, operations]) => operations.length > 0)
    const [peer, operations] = outboxes[random(outboxes.length)]
    peer.receive(operations.shift())
  }

  log (...message) {
    console.log(`Site ${this.siteId}`, ...message)
  }
}
