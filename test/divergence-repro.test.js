const assert = require('assert')
const Document = require('./helpers/document')
const DocumentReplica = require('../lib/document-replica')
const Peer = require('./helpers/peer')
const Random = require('random-seed')

const fs = require('fs')
const path = require('path')

suite('DocumentReplica', () => {
  test('divergence 1', () => {
    const hostOps = JSON.parse(fs.readFileSync(path.join(__dirname, 'host-ops.json'), 'utf8'))
    const guestOps = JSON.parse(fs.readFileSync(path.join(__dirname, 'guest-ops.json'), 'utf8'))
    const hostReplicaText = fs.readFileSync(path.join(__dirname, 'replica-text-host.txt'), 'utf8')
    const guestReplicaText = fs.readFileSync(path.join(__dirname, 'replica-text-guest.txt'), 'utf8')

    const host = new DocumentReplica(1)
    const guest = new DocumentReplica(2)

    for (const op of guestOps) {
      guest.applyRemote(op)
    }

    for (const op of hostOps) {
      host.applyRemote(op)
    }

    // console.log(guest.getText());
    assert.equal(host.getText(), guest.getText())
    // assert.equal(guest.getText(), hostReplicaText)
    assert.equal(guestReplicaText, guest.getText())
  })

  test.only('divergence 2', () => {
    const host = new DocumentReplica(1)
    const guest = new DocumentReplica(2)

    const hostOps = JSON.parse(fs.readFileSync(path.join(__dirname, 'host.json'), 'utf8'))
    const guestInfo = JSON.parse(fs.readFileSync(path.join(__dirname, 'guest.json'), 'utf8'))

    for (const op of hostOps) {
      console.log('apply', op);
      host.applyRemote(op)
    }
  })
})
