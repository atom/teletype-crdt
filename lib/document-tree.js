const SplayTree = require('./splay-tree')

module.exports =
class DocumentTree extends SplayTree {
  constructor (firstSegment, lastSegment, isSegmentVisible) {
    super()
    this.firstSegment = firstSegment
    this.firstSegment.documentRight = lastSegment
    this.firstSegment.documentRight.documentParent = this.firstSegment
    this.firstSegment.documentLeft = null
    this.root = this.firstSegment
    this.isSegmentVisible = isSegmentVisible
  }

  getParent (node) {
    return node.documentParent
  }

  setParent (node, value) {
    node.documentParent = value
  }

  getLeft (node) {
    return node.documentLeft
  }

  setLeft (node, value) {
    node.documentLeft = value
  }

  getRight (node) {
    return node.documentRight
  }

  setRight (node, value) {
    node.documentRight = value
  }

  findSegmentContainingPosition (position) {
    let segment = this.root
    let leftAncestorEnd = 0
    while (segment) {
      let start = leftAncestorEnd
      if (segment.documentLeft) start += segment.documentLeft.documentSubtreeExtent
      let end = start
      if (this.isSegmentVisible(segment)) end += segment.text.length

      if (position <= start && segment !== this.firstSegment) {
        segment = segment.documentLeft
      } else if (position > end) {
        leftAncestorEnd = end
        segment = segment.documentRight
      } else {
        return {segment, start, end}
      }
    }

    throw new Error('No segment found')
  }

  insertBetween (prev, next, newSegment) {
    this.splayNode(prev)
    this.splayNode(next)
    this.root = newSegment
    newSegment.documentLeft = prev
    prev.documentParent = newSegment
    newSegment.documentRight = next
    next.documentParent = newSegment
    next.documentLeft = null
    this.updateDocumentSubtreeExtent(next)
    this.updateDocumentSubtreeExtent(newSegment)
    newSegment.pos = (prev.pos + next.pos) / 2
  }

  splitSegment (prefix, suffix) {
    this.splayNode(prefix)

    this.root = suffix
    suffix.documentParent = null
    suffix.documentLeft = prefix
    prefix.documentParent = suffix
    suffix.documentRight = prefix.documentRight
    if (suffix.documentRight) suffix.documentRight.documentParent = suffix
    prefix.documentRight = null

    this.updateDocumentSubtreeExtent(prefix)
    this.updateDocumentSubtreeExtent(suffix)
  }

  updateDocumentSubtreeExtent (node) {
    node.documentSubtreeExtent = 0
    if (node.documentLeft) node.documentSubtreeExtent += node.documentLeft.documentSubtreeExtent
    if (this.isSegmentVisible(node)) node.documentSubtreeExtent += node.text.length
    if (node.documentRight) node.documentSubtreeExtent += node.documentRight.documentSubtreeExtent
  }

  getSegmentPosition (segment) {
    this.splayNode(segment)
    if (segment.documentLeft) {
      return segment.documentLeft.documentSubtreeExtent
    } else {
      return 0
    }
  }

  getSegments () {
    const treeSegments = []
    function visitTreeInOrder (node) {
      if (node.documentLeft) visitTreeInOrder(node.documentLeft)
      treeSegments.push(node)
      if (node.documentRight) visitTreeInOrder(node.documentRight)
    }
    visitTreeInOrder(this.root)
    return treeSegments
  }
}
