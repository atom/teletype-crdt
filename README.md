# teletype-crdt

The string-wise sequence CRDT powering peer-to-peer collaborative editing in [Teletype for Atom](https://github.com/atom/teletype).

## Hacking

After cloning this repository, you can install its dependencies by running:

```
npm install
```

And then run tests via:

```
npm test
```

## Background

For more details on the techniques used for this data structure, we recommend reading the following papers:

* [Data consistency for P2P Collaborative Editing](https://doi.org/10.1145/1180875.1180916)
* [Supporting String-Wise Operations and Selective Undo for Peer-to-Peer Group Editing](https://doi.org/10.1145/2660398.2660401)
* [High Responsiveness for Group Editing CRDTs](https://doi.org/10.1145/2957276.2957300)

## TODO

* [ ] Document APIs
