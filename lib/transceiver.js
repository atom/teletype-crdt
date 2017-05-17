module.exports =
class Transceiver {
  constructor (buffer, channel) {
    buffer.onDidChangeText(this.didChangeText.bind(this))
    channel.didReceive = this.didReceive.bind(this)
  }

  didReceive (operation) {

  }

  didChangeText (changes) {
    // transform

    // for (const transformedOperation of transformedOperations) {
    //   this.channel.send(transformedOperation)
    // }
  }
}
