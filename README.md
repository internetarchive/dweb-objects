# DwebObjects
Object library for higher level Decentralized Web concepts.  Builds on dweb-transports.

## Background
This library is part of a general project at the Internet Archive (archive.org) 
to support the decentralized web.  

### Goals
* to allow a API that can be used to build functionality in the Dweb easier.

### Node Installation
* Clone this repo. 
* Until this is in npm, add the lines
`"dweb-transports": "git+https://git@github.com/internetarchive/dweb-transports.git",`
`"dweb-objects": "git+https://git@github.com/internetarchive/dweb-objects.git",`
to your package.json file in the dependencies section. 
* `npm install dweb-objects`  will install the dependencies including IPFS & WebTorrent and dweb-transports

In this order.
```
const DwebTransports = require('dweb-transport') #adds the transports
const DwebObjects = require('dweb-objects;)      #adds the object library
```

* TODO writeup how to require only some of the transports.
* Then see usage API below

### Installation and usage in the Browser

* Install npm & node
* Clone this repo and cd to it.
* `npm build` will create dist/dweb_transports_object.js
* Add to your `<HEAD>`

```
<SCRIPT type="text/javascript" src="dweb_transports_bundle.js"></SCRIPT>
<SCRIPT type="text/javascript" src="dweb_objects_bundle.js"></SCRIPT>
```

See the examples in the [`dweb-transport` repo](https://github.com/internetarchive/dweb-transport) for some example code. 

See [API.md](./API.md) for the detailed API.

##See related:

* [Archive.org](http://dweb.archive.org/details) bootstrap into the Archive's page
* [Examples](http://dweb.me/examples) examples

###Repos:
* *dweb-transports:* Common API to underlying transports (http, webtorrent, ipfs, yjs)
* *dweb-objects:* Object model for Dweb inc Lists, Authentication, Key/Value, Naming
* *dweb-serviceworker:* Run Transports in ServiceWorker (experimental)
* *dweb-archive:* Decentralized Archive webpage and bootstrapping 
* *dweb-transport:* Original Repo, still includes examples but being split into smaller repos
