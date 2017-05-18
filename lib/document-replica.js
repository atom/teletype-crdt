const ContextVector = require('./context-vector')
const assert = require('assert')
const inclusionTransform = require('./inclusion-transform')

module.exports =
class DocumentReplica {
  constructor (siteId) {
    this.siteId = siteId
    this.documentState = new ContextVector()
    this.operations = []
    this.operationsIndex = new Map()
  }

  copy (newSiteId) {
    const newReplica = Object.create(DocumentReplica.prototype)
    newReplica.siteId = newSiteId
    newReplica.documentState = this.documentState.copy()
    newReplica.operations = this.operations.slice()
    newReplica.operationsIndex = new Map()
    this.operationsIndex.forEach((value, key) => {
      newReplica.operationsIndex.set(key, new Map(value))
    })
    return newReplica
  }

  pushLocal (operation) {
    const localOperation = operation.copy()
    localOperation.siteId = this.siteId
    localOperation.contextVector = this.documentState.copy()
    this.documentState.increment(this.siteId)
    this.appendOperation(localOperation)
    return localOperation.copy()
  }

  pushRemote (remoteOperation) {
    const localOperation = this.transform(
      remoteOperation,
      this.contextDifference(this.documentState, remoteOperation.contextVector)
    )
    this.appendOperation(remoteOperation)
    this.documentState.increment(remoteOperation.siteId)
    return localOperation
  }

  appendOperation (operation) {
    let indicesBySequenceNumber = this.operationsIndex.get(operation.siteId)
    if (indicesBySequenceNumber == null) {
      indicesBySequenceNumber = new Map()
      this.operationsIndex.set(operation.siteId, indicesBySequenceNumber)
    }

    const sequenceNumber = operation.contextVector.sequenceNumberForSiteId(operation.siteId) + 1
    indicesBySequenceNumber.set(sequenceNumber, this.operations.length)
    this.operations.push(operation)
  }

  transform (operation, contextDifference) {
    while (contextDifference.length > 0) {
      let ox = contextDifference.shift()
      ox = this.transform(ox, this.contextDifference(operation.contextVector, ox.contextVector))
      const originalContextVector = operation.contextVector.copy()
      operation = inclusionTransform(operation, ox)
      operation.contextVector = originalContextVector
      operation.contextVector.increment(ox.siteId)
    }

    return operation.copy()
  }

  contextDifference (contextVector1, contextVector2) {
    const diff = []
    const siteCount = Math.max(contextVector1.getSiteCount(), contextVector2.getSiteCount())
    for (let siteId = 0; siteId < siteCount; siteId++) {
      const startSequenceNumber = contextVector2.sequenceNumberForSiteId(siteId)
      const endSequenceNumber = contextVector1.sequenceNumberForSiteId(siteId)
      assert(startSequenceNumber <= endSequenceNumber, 'Causality Violation')
      for (let sequenceNumber = startSequenceNumber + 1; sequenceNumber <= endSequenceNumber; sequenceNumber++) {
        const operationIndex = this.operationsIndex.get(siteId).get(sequenceNumber)
        diff.push(operationIndex)
      }
    }
    return diff.sort((a, b) => a - b).map(index => this.operations[index])
  }
}
