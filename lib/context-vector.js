const assert = require('assert')

module.exports =
class ContextVector {
  constructor () {
    this.sequenceNumbers = []
    this.inverseGroups = []
  }

  isSubsetOf (contextVector) {
    const siteCount = Math.max(this.getSiteCount(), contextVector.getSiteCount())
    for (var siteId = 0; siteId < siteCount; siteId++) {
      if (this.sequenceNumberForSiteId(siteId) > contextVector.sequenceNumberForSiteId(siteId)) {
        return false
      }

      const inverseGroup1 = this.inverseGroups[siteId]
      if (inverseGroup1) {
        const inverseGroup2 = contextVector.inverseGroups[siteId]
        for (const sequenceNumber in inverseGroup1) {
          if (!inverseGroup2) return false

          if (inverseGroup1[sequenceNumber] > (inverseGroup2[sequenceNumber] || 0)) {
            return false
          }
        }
      }
    }
    return true
  }

  equals (contextVector) {
    const siteCount = Math.max(this.getSiteCount(), contextVector.getSiteCount())
    for (var siteId = 0; siteId < siteCount; siteId++) {
      if (this.sequenceNumberForSiteId(siteId) !== contextVector.sequenceNumberForSiteId(siteId)) {
        return false
      }

      const inverseGroup1 = this.inverseGroups[siteId]
      if (inverseGroup1) {
        const inverseGroup2 = contextVector.inverseGroups[siteId]
        for (const sequenceNumber in inverseGroup1) {
          if (!inverseGroup2) return false

          if (inverseGroup1[sequenceNumber] !== inverseGroup2[sequenceNumber]) {
            return false
          }
        }
      }
    }
    return true
  }

  copy () {
    const newContextVector = Object.create(ContextVector.prototype)
    newContextVector.sequenceNumbers = this.sequenceNumbers.slice()
    newContextVector.inverseGroups = this.inverseGroups.map(g => Object.assign({}, g))
    return newContextVector
  }

  add (operation) {
    const siteId = operation.siteId
    if (operation.inverseCount > 0) {
      assert.equal(
        this.sequenceNumberForSiteId(operation.siteId),
        operation.sequenceNumber,
        'Cannot add an operation from a different context'
      )
      let inverseGroup = this.inverseGroups[siteId]
      if (inverseGroup == null) {
        inverseGroup = {}
        this.inverseGroups[siteId] = {}
      }
      const currentInverseCount = inverseGroup[operation.sequenceNumber] || 0
      assert.equal(
        currentInverseCount,
        operation.inverseCount - 1,
        'Cannot add an operation from a different context'
      )
      inverseGroup[operation.sequenceNumber] = operation.inverseCount
    } else {
      assert.equal(
        this.sequenceNumberForSiteId(operation.siteId),
        operation.sequenceNumber - 1,
        'Cannot add an operation from a different context'
      )
      this.sequenceNumbers[siteId] = operation.sequenceNumber
    }
  }

  remove (operation) {
    const {siteId, sequenceNumber, inverseCount} = operation
    assert.equal(
      this.sequenceNumberForSiteId(siteId),
      sequenceNumber,
      'Cannot remove an operation from a different context'
    )

    if (inverseCount > 0) {
      let inverseGroup = this.inverseGroups[siteId]
      if (inverseGroup == null) {
        inverseGroup = {}
        this.inverseGroups[siteId] = {}
      }
      const currentInverseCount = inverseGroup[sequenceNumber] || 0
      assert.equal(
        currentInverseCount,
        inverseCount,
        'Cannot remove an operation from a different context'
      )
      if (currentInverseCount === 1) {
        delete inverseGroup[sequenceNumber]
      } else {
        inverseGroup[sequenceNumber] = currentInverseCount - 1
      }
    } else {
      this.sequenceNumbers[siteId] = sequenceNumber - 1
    }
  }

  sequenceNumberForSiteId (siteId) {
    return this.sequenceNumbers[siteId] || 0
  }

  inverseCountForSiteIdAndSequenceNumber (siteId, sequenceNumber) {
    const inverseGroup = this.inverseGroups[siteId] || {}
    return inverseGroup[sequenceNumber] || 0
  }

  getSiteCount () {
    return this.sequenceNumbers.length
  }
}
