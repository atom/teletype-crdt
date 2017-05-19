const ContextVector = require('./context-vector')
const assert = require('assert')
const inclusionTransform = require('./inclusion-transform')

module.exports =
class DocumentReplica {
  constructor (siteId) {
    this.siteId = siteId
    this.documentState = new ContextVector()
    this.versionGroups = new Map()
    this.operations = []
    this.operationsIndex = new Map()
  }

  copy (newSiteId) {
    const newReplica = Object.create(DocumentReplica.prototype)
    newReplica.siteId = newSiteId
    newReplica.documentState = this.documentState.copy()
    newReplica.versionGroups = new Map()
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
    const localOperation = this.transform(remoteOperation, this.documentState)
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

  transform (operation, targetContextVector) {
    let cachedTransformedOperation = this.getFromVersionGroup(operation, targetContextVector)
    if (cachedTransformedOperation) return cachedTransformedOperation.copy()

    const contextDifference = this.contextDifference(targetContextVector, operation.contextVector)
    while (contextDifference.length > 0) {
      let ox = contextDifference.shift()
      ox = this.transform(ox, operation.contextVector)
      operation = this.inclusionTransform(operation, ox)
      if (operation.type === 'null') {
        operation.contextVector = targetContextVector.copy()
        break
      }
    }

    return operation.copy()
  }

  inclusionTransform (o1, o2) {
    const o1B = inclusionTransform(o1, o2)
    o1B.contextVector = o1.contextVector.copy()
    o1B.contextVector.increment(o2.siteId)
    const o2B = inclusionTransform(o2, o1)
    o2B.contextVector = o2.contextVector.copy()
    o2B.contextVector.increment(o1.siteId)
    this.addToVersionGroup(o1B)
    this.addToVersionGroup(o2B)
    return o1B.copy()
  }

  addToVersionGroup (operation) {
    let versionsBySequenceNumber = this.versionGroups.get(operation.siteId)
    if (versionsBySequenceNumber == null) {
      versionsBySequenceNumber = new Map()
      this.versionGroups.set(operation.siteId, versionsBySequenceNumber)
    }

    const sequenceNumber = operation.contextVector.sequenceNumberForSiteId(operation.siteId) + 1
    let versions = versionsBySequenceNumber.get(sequenceNumber)
    if (versions == null) {
      versions = []
      versionsBySequenceNumber.set(sequenceNumber, versions)
    }

    versions.push(operation)
    if (versions.length === this.documentState.getSiteCount() - 1) {
      versions.shift()
    }
  }

  getFromVersionGroup (operation, contextVector) {
    const versionsBySequenceNumber = this.versionGroups.get(operation.siteId)
    if (versionsBySequenceNumber) {
      const sequenceNumber = operation.contextVector.sequenceNumberForSiteId(operation.siteId) + 1
      const versions = versionsBySequenceNumber.get(sequenceNumber)
      if (versions) {
        for (let i = versions.length - 1; i >= 0; i--) {
          if (versions[i].contextVector.equals(contextVector)) {
            return versions[i]
          }
        }
      }
    }
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
