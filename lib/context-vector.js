module.exports =
class ContextVector {
  constructor () {
    this.sequenceNumbers = []
    this.inverseGroups = []
  }

  isSubsetOf (contextVector) {
    const siteCount = Math.max(this.getSiteCount(), contextVector.getSiteCount())
    for (var siteId = 0; siteId < siteCount; siteId++) {
      if (this.compareSite(contextVector, siteId) > 0) return false
    }
    return true
  }

  equals (contextVector) {
    const siteCount = Math.max(this.getSiteCount(), contextVector.getSiteCount())
    for (var siteId = 0; siteId < siteCount; siteId++) {
      if (this.compareSite(contextVector, siteId) !== 0) return false
    }
    return true
  }

  compareSite (contextVector, siteId) {
    const seq1 = this.sequenceNumberForSiteId(siteId)
    const seq2 = contextVector.sequenceNumberForSiteId(siteId)
    if (seq1 === seq2) {
      const inv1 = this.inverseCountForOperation(siteId, seq1)
      const inv2 = contextVector.inverseCountForOperation(siteId, seq1)
      return inv1 - inv2
    } else {
      return seq1 - seq2
    }
  }

  copy () {
    const newContextVector = Object.create(ContextVector.prototype)
    newContextVector.sequenceNumbers = this.sequenceNumbers.slice()
    newContextVector.inverseGroups = this.inverseGroups.map(g => g.slice())
    return newContextVector
  }

  add (operation) {
    if (operation.isInverse) {
      const sequenceNumber = operation.contextVector.sequenceNumberForSiteId(operation.siteId)
      const inverseGroups = this.inverseGroupsForSiteId(operation.siteId)
      const inverseGroupIndex = inverseGroups.findIndex(i => i.sequenceNumber === sequenceNumber)
      if (inverseGroupIndex === -1) {
        inverseGroups.push({sequenceNumber, inverseCount: 1})
      } else {
        inverseGroups[inverseGroupIndex].inverseCount++
      }
    } else {
      this.sequenceNumbers[operation.siteId] = (this.sequenceNumbers[operation.siteId] || 0) + 1
    }
  }

  sequenceNumberForSiteId (siteId) {
    return this.sequenceNumbers[siteId] || 0
  }

  inverseGroupsForSiteId (siteId) {
    let inverseGroups = this.inverseGroups[siteId]
    if (inverseGroups == null) {
      inverseGroups = []
      this.inverseGroups[siteId] = inverseGroups
    }

    return inverseGroups
  }

  inverseCountForOperation (siteId, sequenceNumber) {
    const inverseGroups = this.inverseGroupsForSiteId(siteId)
    const inverseGroupIndex = inverseGroups.findIndex(i => i.sequenceNumber === sequenceNumber)
    return inverseGroupIndex === -1 ? 0 : inverseGroups[inverseGroupIndex].inverseCount
  }

  getSiteCount () {
    return this.sequenceNumbers.length
  }
}
