const assert = require('assert')
const SplayTree = require('./splay-tree')

module.exports =
class SplitTree extends SplayTree {
  constructor (segment) {
    super()
    this.startSegment = segment
    this.startSegment.splitLeft = null
    this.startSegment.splitRight = null
    this.startSegment.splitParent = null
    this.startSegment.splitSubtreeExtent = this.startSegment.text.length
    this.root = this.startSegment
  }

  getStart () {
    return this.startSegment
  }

  getParent (node) {
    return node.splitParent
  }

  setParent (node, value) {
    node.splitParent = value
  }

  getLeft (node) {
    return node.splitLeft
  }

  setLeft (node, value) {
    node.splitLeft = value
  }

  getRight (node) {
    return node.splitRight
  }

  setRight (node, value) {
    node.splitRight = value
  }

  updateSubtreeExtent (node) {
    node.splitSubtreeExtent = 0
    if (node.splitLeft) node.splitSubtreeExtent += node.splitLeft.splitSubtreeExtent
    node.splitSubtreeExtent += node.text.length
    if (node.splitRight) node.splitSubtreeExtent += node.splitRight.splitSubtreeExtent
  }

  findSegmentContainingOffset (offset) {
    let segment = this.root
    let leftAncestorEnd = 0
    while (segment) {
      let start = leftAncestorEnd
      if (segment.splitLeft) start += segment.splitLeft.splitSubtreeExtent
      const end = start + segment.text.length

      if (offset <= start && segment.splitLeft) {
        segment = segment.splitLeft
      } else if (offset > end) {
        leftAncestorEnd = end
        segment = segment.splitRight
      } else {
        return segment
      }
    }

    throw new Error('No segment found')
  }

  splitSegment (segment, offset) {
    this.splayNode(segment)
    const suffix = Object.assign({}, segment)
    suffix.text = segment.text.slice(offset)
    suffix.opId = Object.assign({}, segment.opId)
    suffix.offset += offset
    suffix.deletions = new Set(suffix.deletions)
    segment.text = segment.text.slice(0, offset)
    segment.nextSplit = suffix

    this.root = suffix
    suffix.splitParent = null
    suffix.splitLeft = segment
    segment.splitParent = suffix
    suffix.splitRight = segment.splitRight
    if (suffix.splitRight) suffix.splitRight.splitParent = suffix
    segment.splitRight = null

    this.updateSubtreeExtent(segment)
    this.updateSubtreeExtent(suffix)

    return suffix
  }
}
