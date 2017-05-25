module.exports =
class DocumentReplica {
  constructor (siteId) {
    this.siteId = siteId
    this.nextSequenceNumber = 1
    const initialInsertion = {
      siteId: 0,
      sequenceNumber: 0,
      positionInParent: 0,
      text: '',
      offset: 0
    }
    this.fragments = [initialInsertion]
    this.insertions = new Map()
    this.insertions.set(getId(initialInsertion), [initialInsertion])
  }

  applyLocal (operation) {
    if (operation.type === 'insert') {
      return this.applyLocalInsertion(operation)
    } else {
      throw new Error('implement me')
    }
  }

  applyLocalInsertion ({position, text}) {
    let fragmentStart = 0
    for (let i = 0; i < this.fragments.length; i++) {
      const fragment = this.fragments[i]
      const fragmentEnd = fragmentStart + fragment.text.length
      if (position >= fragmentStart && position <= fragmentEnd) {
        if (position < fragmentEnd) {

        } else {
          const sequenceNumber = this.nextSequenceNumber++
          const positionInParent = fragment.offset + fragment.text.length
          const insertion = {
            siteId: this.siteId,
            sequenceNumber: sequenceNumber,
            parentSiteId: fragment.siteId,
            parentSequenceNumber: fragment.sequenceNumber,
            positionInParent,
            text
          }
          this.fragments.splice(i + 1, 0, insertion)
          this.insertions.set(getId(insertion), [insertion])
          return Object.assign({type: 'insert'}, insertion)
        }
      }
    }
  }

  applyRemote (operation) {
    if (operation.type === 'insert') {
      return this.applyRemoteInsertion(operation)
    } else {
      throw new Error('implement me')
    }
  }

  applyRemoteInsertion ({siteId, sequenceNumber, parentSiteId, parentSequenceNumber, positionInParent, text}) {
    let targetFragment
    const parentInsertionId = getId({siteId: parentSiteId, sequenceNumber: parentSequenceNumber})
    const fragments = this.insertions.get(parentInsertionId)
    for (let i = 0; i < fragments.length; i++) {
      targetFragment = fragments[i]
      const fragmentEnd = targetFragment.offset + targetFragment.text.length
      if (targetFragment.offset <= positionInParent && positionInParent <= fragmentEnd) {
        break
      }
    }

    let fragmentEnd = 0
    let insertionIndex = 0
    while (insertionIndex < this.fragments.length) {
      const fragment = this.fragments[insertionIndex]
      fragmentEnd += fragment.text.length
      insertionIndex++

      if (fragment === targetFragment) break
    }

    while (insertionIndex < this.fragments.length) {
      const subsequentFragment = this.fragments[insertionIndex]
      if (parentSiteId === subsequentFragment.parentSiteId &&
          parentSequenceNumber === subsequentFragment.parentSequenceNumber) {
        if (siteId <= subsequentFragment.siteId) break
      } else {
        break
      }
      fragmentEnd += subsequentFragment.text.length
      insertionIndex++
    }

    const insertion = {
      siteId,
      sequenceNumber,
      parentSiteId,
      parentSequenceNumber,
      positionInParent,
      text
    }
    this.insertions.set(getId(insertion), [insertion])
    this.fragments.splice(insertionIndex, 0, insertion)
    return {type: 'insert', position: fragmentEnd, text}
  }
}

function getId ({siteId, sequenceNumber}) {
  return siteId + '.' + sequenceNumber
}
