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
      const copiedValue = new Map()
      value.forEach((value, key) => { copiedValue.set(key, new Map(value)) })
      newReplica.operationsIndex.set(key, copiedValue)
    })
    return newReplica
  }

  pushLocal (operation) {
    const localOperation = operation.copy()
    localOperation.siteId = this.siteId
    localOperation.contextVector = this.documentState.copy()
    this.documentState.add(localOperation)
    this.appendOperation(localOperation)
    return localOperation.copy()
  }

  undoLocal (operation) {
    const invertedOperation = operation.invert()
    invertedOperation.contextVector = operation.contextVector.copy()
    invertedOperation.contextVector.add(operation)
    const transformedOperation = this.transform(invertedOperation, this.documentState)
    this.documentState.add(invertedOperation)
    this.appendOperation(invertedOperation)
    return {transformedOperation, invertedOperation}
  }

  pushRemote (remoteOperation) {
    const localOperation = this.transform(remoteOperation, this.documentState)
    this.appendOperation(remoteOperation)
    this.documentState.add(remoteOperation)
    return localOperation
  }

  appendOperation (operation) {
    let inverseCountsBySequenceNumber = this.operationsIndex.get(operation.siteId)
    if (inverseCountsBySequenceNumber == null) {
      inverseCountsBySequenceNumber = new Map()
      this.operationsIndex.set(operation.siteId, inverseCountsBySequenceNumber)
    }

    let sequenceNumber, inverseCount
    if (operation.isInverse) {
      sequenceNumber = operation.contextVector.sequenceNumberForSiteId(operation.siteId)
      inverseCount = operation.contextVector.inverseCountForOperation(operation.siteId, sequenceNumber) + 1
    } else {
      sequenceNumber = operation.contextVector.sequenceNumberForSiteId(operation.siteId) + 1
      inverseCount = 0
    }

    let indicesByInverseCount = inverseCountsBySequenceNumber.get(sequenceNumber)
    if (indicesByInverseCount == null) {
      indicesByInverseCount = new Map()
      inverseCountsBySequenceNumber.set(sequenceNumber, indicesByInverseCount)
    }

    indicesByInverseCount.set(inverseCount, this.operations.length)
    this.operations.push(operation)
  }

  transform (operation, targetContextVector) {
    let cachedTransformedOperation = this.getFromVersionGroup(operation, targetContextVector)
    if (cachedTransformedOperation) return cachedTransformedOperation.copy()

    const contextDifference = this.contextDifference(targetContextVector, operation.contextVector)
    const originalOperation = operation
    while (contextDifference.length > 0) {
      const originalOx = contextDifference.shift()
      const transformedOx = this.transform(originalOx, operation.contextVector)
      operation = this.inclusionTransform(originalOperation, operation, originalOx, transformedOx)
      if (operation.type === 'null') {
        operation.contextVector = targetContextVector.copy()
        break
      }
    }

    return operation.copy()
  }

  inclusionTransform (originalO1, transformedO1, originalO2, transformedO2) {
    const o1B = inclusionTransform(transformedO1, transformedO2)
    o1B.contextVector = transformedO1.contextVector.copy()
    o1B.contextVector.add(originalO2)
    const o2B = inclusionTransform(transformedO2, transformedO1)
    o2B.contextVector = transformedO2.contextVector.copy()
    o2B.contextVector.add(originalO1)
    this.addToVersionGroup(o1B)
    this.addToVersionGroup(o2B)
    return o1B.copy()
  }

  addToVersionGroup (operation) {
    return
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
    return
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
        const operationIndex = this.operationsIndex.get(siteId).get(sequenceNumber).get(0)
        diff.push(operationIndex)
      }
      for (let sequenceNumber = startSequenceNumber; sequenceNumber <= endSequenceNumber; sequenceNumber++) {
        const startInverseCount = contextVector2.inverseCountForOperation(siteId, sequenceNumber)
        const endInverseCount = contextVector1.inverseCountForOperation(siteId, sequenceNumber)
        assert(startInverseCount <= endInverseCount, 'Causality Violation')
        for (let inverseCount = startInverseCount + 1; inverseCount <= endInverseCount; inverseCount++) {
          const operationIndex = this.operationsIndex.get(siteId).get(sequenceNumber).get(inverseCount)
          diff.push(operationIndex)
        }
      }
    }
    return diff.sort((a, b) => a - b).map(index => this.operations[index])
  }
}
