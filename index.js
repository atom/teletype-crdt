const DocumentReplica = require('./lib/document-replica')
const {serializeOperation, deserializeOperation} = require('./lib/serialization')
module.exports = {DocumentReplica, serializeOperation, deserializeOperation}
