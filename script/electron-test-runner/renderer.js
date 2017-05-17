const remote = require('electron').remote
const Mocha = require('mocha')
const mocha = new Mocha()

for (let path of remote.process.argv.slice(2)) {
  let resolvedFiles = Mocha.utils.lookupFiles(path, ['js'], true);
  if (typeof resolvedFiles === "string") {
    resolvedFiles = [resolvedFiles];
  }
  for (let resolvedFile of resolvedFiles) {
    mocha.addFile(resolvedFile)
  }
}
mocha.ui('tdd')
mocha.useColors(false)
mocha.run()
