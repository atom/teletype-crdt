const ContextVector = require('./context-vector')
const assert = require('assert')
const inclusionTransform = require('./inclusion-transform')
const operationHelpers = require('./operation-helpers')

module.exports =
class DocumentReplica {
  constructor (siteId) {
    this.siteId = siteId
    this.documentState = new ContextVector()
    this.versionGroupsById = new Map()
    this.operations = []
    this.operationIndicesById = new Map()
  }

  copy (newSiteId) {
    const newReplica = Object.create(DocumentReplica.prototype)
    newReplica.siteId = newSiteId
    newReplica.documentState = this.documentState.copy()
    newReplica.versionGroupsById = new Map()
    newReplica.operations = this.operations.slice()
    newReplica.operationIndicesById = new Map(this.operationIndicesById)
    return newReplica
  }

  pushLocal (operation) {
    const localOperation = operationHelpers.copy(operation)
    localOperation.siteId = this.siteId
    localOperation.contextVector = this.documentState.copy()
    this.documentState.increment(this.siteId)
    this.appendOperation(localOperation)
    return operationHelpers.copy(localOperation)
  }

  pushRemote (remoteOperation) {
    const localOperation = this.transform(remoteOperation, this.documentState)
    this.appendOperation(remoteOperation)
    this.documentState.increment(remoteOperation.siteId)
    return localOperation
  }

  appendOperation (operation) {
    this.operationIndicesById.set(operationHelpers.getId(operation), this.operations.length)
    this.operations.push(operation)
  }

  transform (operation, targetContextVector) {
    let cachedTransformedOperation = this.getFromVersionGroup(operation, targetContextVector)
    if (cachedTransformedOperation) return operationHelpers.copy(cachedTransformedOperation)

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

    return operationHelpers.copy(operation)
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
    return operationHelpers.copy(o1B)
  }

  addToVersionGroup (operation) {
    const operationId = operationHelpers.getId(operation)
    let versions = this.versionGroupsById.get(operationId)
    if (versions == null) {
      versions = []
      this.versionGroupsById.set(operationId, versions)
    }

    versions.push(operation)
    if (versions.length === this.documentState.getSiteCount() - 1) {
      versions.shift()
    }
  }

  getFromVersionGroup (operation, contextVector) {
    const versions = this.versionGroupsById.get(operationHelpers.getId(operation))
    if (versions) {
      for (let i = versions.length - 1; i >= 0; i--) {
        if (versions[i].contextVector.equals(contextVector)) {
          return versions[i]
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
        const operationIndex = this.operationIndicesById.get(operationHelpers.buildId(siteId, sequenceNumber))
        diff.push(operationIndex)
      }
    }
    return diff.sort((a, b) => a - b).map(index => this.operations[index])
  }
}
