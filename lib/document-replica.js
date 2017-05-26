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
    this.localTimestamp = 1
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
    localOperation.sequenceNumber = this.documentState.sequenceNumberForSiteId(this.siteId) + 1
    localOperation.inverseCount = 0
    localOperation.localTimestamp = this.localTimestamp++
    localOperation.contextVector = this.documentState.copy()
    this.documentState.add(localOperation)
    this.appendOperation(localOperation)
    return operationHelpers.copy(localOperation)
  }

  undoLocal (operation) {
    const localOperation = operationHelpers.invert(operation)
    localOperation.inverseCount++
    localOperation.localTimestamp = this.localTimestamp++
    localOperation.contextVector.add(operation)
    const contextDifference = this.contextDifference(this.documentState, localOperation.contextVector)
    const operationToApply = this.transform(localOperation, contextDifference)
    this.documentState.add(localOperation)
    this.appendOperation(localOperation)
    return {operationToSend: localOperation, operationToApply}
  }

  pushRemote (remoteOperation) {
    const contextDifference = this.contextDifference(this.documentState, remoteOperation.contextVector)
    const localOperation = this.transform(remoteOperation, contextDifference)
    this.appendOperation(remoteOperation)
    this.documentState.add(remoteOperation)
    return localOperation
  }

  appendOperation (operation) {
    this.operationIndicesById.set(operationHelpers.getId(operation), this.operations.length)
    this.operations.push(operation)
  }

  transform (operation, contextDifference) {
    while (contextDifference.length > 0) {
      let ox = contextDifference.shift()
      let cachedTransformedOperation = this.getFromVersionGroup(ox, operation.contextVector)
      if (cachedTransformedOperation) {
        ox = operationHelpers.copy(cachedTransformedOperation)
      } else {
        ox = this.transform(ox, this.contextDifference(operation.contextVector, ox.contextVector))
      }
      operation = this.inclusionTransform(operation, ox)
    }

    return operationHelpers.copy(operation)
  }

  inclusionTransform (o1, o2) {
    const o1B = inclusionTransform(o1, o2)
    o1B.siteId = o1.siteId
    o1B.sequenceNumber = o1.sequenceNumber
    o1B.inverseCount = o1.inverseCount
    o1B.contextVector = o1.contextVector.copy()
    o1B.contextVector.add(o2)
    const o2B = inclusionTransform(o2, o1)
    o2B.siteId = o2.siteId
    o2B.sequenceNumber = o2.sequenceNumber
    o2B.inverseCount = o2.inverseCount
    o2B.contextVector = o2.contextVector.copy()
    o2B.contextVector.add(o1)
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
    const contextDifference = []
    const siteCount = Math.max(contextVector1.getSiteCount(), contextVector2.getSiteCount())
    for (let siteId = 0; siteId < siteCount; siteId++) {
      const startSequenceNumber = contextVector2.sequenceNumberForSiteId(siteId)
      const endSequenceNumber = contextVector1.sequenceNumberForSiteId(siteId)
      assert(startSequenceNumber <= endSequenceNumber, 'Causality Violation')
      for (let sequenceNumber = startSequenceNumber + 1; sequenceNumber <= endSequenceNumber; sequenceNumber++) {
        const operationId = operationHelpers.buildId(siteId, sequenceNumber, 0)
        contextDifference.push(this.operationIndicesById.get(operationId))
      }
      for (let sequenceNumber in contextVector1.inverseGroups[siteId]) {
        const startInverseCount = contextVector2.inverseCountForSiteIdAndSequenceNumber(siteId, sequenceNumber)
        const endInverseCount = contextVector1.inverseGroups[siteId][sequenceNumber]
        assert(startInverseCount <= endInverseCount, 'Causality Violation')
        for (let inverseCount = startInverseCount + 1; inverseCount <= endInverseCount; inverseCount++) {
          const operationId = operationHelpers.buildId(siteId, sequenceNumber, inverseCount)
          contextDifference.push(this.operationIndicesById.get(operationId))
        }
      }
    }

    return contextDifference.sort((index1, index2) => index1 - index2).map(i => this.operations[i])
  }
}
