const assert = require('assert')
const {getRandomDocumentRange, buildRandomLines} = require('./random')
const {ZERO_POINT, compare, traverse, extentForText} = require('../../lib/point-helpers')
const {serializeOperation, deserializeOperation} = require('../../lib/serialization')
const LocalDocument = require('./local-document')
const Document = require('../../lib/document')

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
    this.localDocument = new LocalDocument(text)
    this.document = new Document({siteId})
    this.deferredOperations = []
    this.editOperations = []
    this.nonUndoEditOperations = []
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
    const {textUpdates, markerUpdates} = this.document.integrateOperations([operation])
    // this.log('Applying delta', changes)
    this.localDocument.updateText(textUpdates)
    this.localDocument.updateMarkers(markerUpdates)
    this.log('Text', JSON.stringify(this.localDocument.text))

    if (operation.type !== 'markers-update') {
      this.editOperations.push(operation)
      if (operation.type !== 'undo') this.nonUndoEditOperations.push(operation)
    }
  }

  isOutboxEmpty () {
    return Array.from(this.outboxes.values()).every((o) => o.length === 0)
  }

  performRandomEdit (random) {
    let operations
    while (true) {
      let {start, end} = getRandomDocumentRange(random, this.localDocument)
      const text = buildRandomLines(random, 1)
      if (compare(end, ZERO_POINT) > 0 || text.length > 0) {
        this.log('setTextInRange', start, end, JSON.stringify(text))
        this.localDocument.setTextInRange(start, end, text)
        operations = this.document.setTextInRange(start, end, text)
        break
      }
    }
    this.log('Text', JSON.stringify(this.localDocument.text))

    for (const operation of operations) {
      this.send(operation)
      this.editOperations.push(operation)
      this.nonUndoEditOperations.push(operation)
    }
  }

  undoRandomOperation (random) {
    const opToUndo = this.editOperations[random(this.editOperations.length)]
    const {spliceId} = opToUndo

    if (this.document.hasAppliedSplice(spliceId)) {
      this.log('Undoing', opToUndo)
      const {operations, textUpdates} = this.document.undoOrRedoOperations([opToUndo])
      this.log('Applying delta', textUpdates)
      this.localDocument.updateText(textUpdates)
      this.log('Text', JSON.stringify(this.localDocument.text))
      this.editOperations.push(operations[0])
      this.send(operations[0])
    }
  }

  updateRandomMarkers (random) {
    const markerUpdates = {}
    const siteMarkerLayers = this.localDocument.markers[this.siteId] || {}

    const n = random.intBetween(1, 1)
    for (let i = 0; i < n; i++) {
      const layerId = random(10)

      if (random(10) < 1 && siteMarkerLayers[layerId]) {
        markerUpdates[layerId] = null
      } else {
        if (!markerUpdates[layerId]) markerUpdates[layerId] = {}
        const layer = siteMarkerLayers[layerId] || {}
        const markerIds = Object.keys(layer)
        if (random(10) < 1 && markerIds.length > 0) {
          const markerId = markerIds[random(markerIds.length)]
          markerUpdates[layerId][markerId] = null
        } else {
          const markerId = random(10)
          const range = getRandomDocumentRange(random, this.localDocument)
          const exclusive = Boolean(random(2))
          const reversed = Boolean(random(2))
          const tailed = Boolean(random(2))
          markerUpdates[layerId][markerId] = {range, exclusive, reversed, tailed}
        }
      }
    }

    this.log('Update markers', markerUpdates)
    this.localDocument.updateMarkers({[this.siteId]: markerUpdates})
    const operations = this.document.updateMarkers(markerUpdates)
    for (const operation of operations) {
      this.send(operation)
    }
  }

  verifyTextUpdatesForRandomOperations (random) {
    const n = random(Math.min(10, this.nonUndoEditOperations.length))
    const operationsSet = new Set()
    for (let i = 0; i < n; i++) {
      const index = random(this.nonUndoEditOperations.length)
      const operation = this.nonUndoEditOperations[index]
      if (this.document.hasAppliedSplice(operation.spliceId)) operationsSet.add(operation)
    }
    const operations = Array.from(operationsSet)
    const delta = this.document.textUpdatesForOperations(operations)

    const documentCopy = new LocalDocument(this.localDocument.text)
    for (const change of delta.slice().reverse()) {
      documentCopy.setTextInRange(change.newStart, change.newEnd, change.oldText)
    }

    const replicaCopy = this.document.replicate(this.document.siteId)
    const notUndoneOperations = operations.filter((operation) =>
      !this.document.isSpliceUndone(operation)
    )
    replicaCopy.undoOrRedoOperations(notUndoneOperations)

    assert.equal(documentCopy.text, replicaCopy.getText())
  }

  verifyDocumentReplication () {
    const replica = this.document.replicate(this.document.siteId)
    assert.equal(replica.getText(), this.document.getText())
    assert.deepEqual(replica.getMarkers(), this.document.getMarkers())
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
