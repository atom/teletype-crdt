const ContextVector = require('./context-vector')
const ContextDifference = require('./context-difference')
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
    localOperation.sequenceNumber = this.documentState.sequenceNumberForSiteId(this.siteId) + 1
    localOperation.inverseCount = 0
    localOperation.contextVector = this.documentState.copy()
    this.documentState.add(localOperation)
    this.appendOperation(localOperation)
    return operationHelpers.copy(localOperation)
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
    if (contextDifference.isEmpty()) return operationHelpers.copy(operation)

    this.ensureIP2Safety(contextDifference)
    operation = this.ensureIP3Safety(operation, contextDifference)
    const contextDifferenceOperations = contextDifference.getOperations()
    while (contextDifferenceOperations.length > 0) {
      let ox = contextDifferenceOperations.shift()
      const undoPair = contextDifference.getUndoPair(ox)
      if (undoPair) {
        operation = operationHelpers.copy(operation)
        operation.contextVector.add(ox)
        operation.contextVector.add(undoPair)
      } else {
        let cachedTransformedOperation = this.getFromVersionGroup(ox, operation.contextVector)
        if (cachedTransformedOperation) {
          ox = operationHelpers.copy(cachedTransformedOperation)
        } else {
          ox = this.transform(ox, this.contextDifference(operation.contextVector, ox.contextVector))
        }
        operation = this.inclusionTransform(operation, ox)
      }
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
    const diff = new ContextDifference()
    const siteCount = Math.max(contextVector1.getSiteCount(), contextVector2.getSiteCount())
    for (let siteId = 0; siteId < siteCount; siteId++) {
      const startSequenceNumber = contextVector2.sequenceNumberForSiteId(siteId)
      const endSequenceNumber = contextVector1.sequenceNumberForSiteId(siteId)
      assert(startSequenceNumber <= endSequenceNumber, 'Causality Violation')
      for (let sequenceNumber = startSequenceNumber + 1; sequenceNumber <= endSequenceNumber; sequenceNumber++) {
        const operationId = operationHelpers.buildId(siteId, sequenceNumber, 0)
        const operationIndex = this.operationIndicesById.get(operationId)
        const operation = this.operations[operationIndex]
        diff.add(operation, operationIndex)
      }
      for (let sequenceNumber = startSequenceNumber; sequenceNumber <= endSequenceNumber; sequenceNumber++) {
        const startInverseCount = contextVector2.inverseCountForSiteIdAndSequenceNumber(siteId, sequenceNumber)
        const endInverseCount = contextVector1.inverseCountForSiteIdAndSequenceNumber(siteId, sequenceNumber)
        assert(startInverseCount <= endInverseCount, 'Causality Violation')
        for (let inverseCount = startInverseCount + 1; inverseCount <= endInverseCount; inverseCount++) {
          const operationId = operationHelpers.buildId(siteId, sequenceNumber, inverseCount)
          const operationIndex = this.operationIndicesById.get(operationId)
          const operation = this.operations[operationIndex]
          diff.add(operation, operationIndex)
        }
      }
    }

    return diff
  }

  ensureIP2Safety (contextDifference) {
    const operations = contextDifference.getOperations()
    for (let i = 0; i < operations.length; i++) {
      const operation = operations[i]
      if (contextDifference.getDoPair(operation)) continue

      const inverseOperation = operationHelpers.invert(operation)
      inverseOperation.inverseCount++
      inverseOperation.contextVector.add(operation)
      if (contextDifference.has(inverseOperation)) {
        contextDifference.markDoUndoPair(operation)
        contextDifference.remove(inverseOperation)
      }
    }
  }

  ensureIP3Safety (operation, contextDifference) {
    if (operation.inverseCount === 0) return operation

    const inverseOperation = operationHelpers.invert(operation)
    inverseOperation.inverseCount--
    inverseOperation.contextVector.remove(inverseOperation)

    const contextDifferenceOperations = contextDifference.getOperations()
    const concurrentContextDifference = new ContextDifference()
    for (let i = 0; i < contextDifferenceOperations.length; i++) {
      const contextDifferenceOperation = contextDifferenceOperations[i]
      if (operationHelpers.areConcurrent(inverseOperation, contextDifferenceOperation)) {
        const operationId = operationHelpers.getId(contextDifferenceOperation)
        const operationIndex = this.operationIndicesById.get(operationId)
        contextDifference.remove(contextDifferenceOperation)
        concurrentContextDifference.add(contextDifferenceOperation, operationIndex)
      }
    }

    const transformedOperation = operationHelpers.invert(
      this.transform(inverseOperation, concurrentContextDifference)
    )
    transformedOperation.inverseCount++
    transformedOperation.contextVector.add(inverseOperation)
    return transformedOperation
  }
}
