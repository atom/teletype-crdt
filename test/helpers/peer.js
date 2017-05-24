const {getRandomDocumentPositionAndExtent, buildRandomLines} = require('./random')
const Document = require('./document')
const DocumentReplica = require('../../lib/document-replica')
const operationHelpers = require('../../lib/operation-helpers')

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
    this.log('Received from Site ' + operation.siteId, operationHelpers.format(operation))
    if (operation.contextVector.isSubsetOf(this.documentReplica.documentState)) {
      const transformedOperation = this.documentReplica.pushRemote(operation)
      this.log('Transforming it and applying it', operationHelpers.format(transformedOperation))
      this.document.apply(transformedOperation)
      this.log('Document', JSON.stringify(this.document.text))
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
      this.log('Retrying deferred operation', operationHelpers.format(operation))
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
      operationToApply = result.operationToApply
      operationToSend = result.operationToSend
    } else if (k < 6) {
      operationToApply = {type: 'insert', start, text: buildRandomLines(random, 5)}
      operationToSend = this.documentReplica.pushLocal(operationToApply)
      this.history.push(operationToSend)
    } else {
      operationToApply = {type: 'delete', start, text: this.document.getTextFromPointAndExtent(start, extent)}
      operationToSend = this.documentReplica.pushLocal(operationToApply)
      this.history.push(operationToSend)
    }

    this.document.apply(operationToApply)
    this.log('Applying', operationHelpers.format(operationToApply))
    this.log('Document', JSON.stringify(this.document.text))
    this.send(operationToSend)
    this.log('Sending', operationHelpers.format(operationToSend))
  }

  deliverRandomOperation (random) {
    const outboxes = Array.from(this.outboxes).filter(([peer, operations]) => operations.length > 0)
    const [peer, operations] = outboxes[random(outboxes.length)]
    peer.receive(operations.shift())
  }

  log (...message) {
    if (global.enableLog) {
      console.log(`Site ${this.siteId}`, ...message)
    }
  }
}
