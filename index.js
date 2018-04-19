// Javascript library for Dweb objects
// Use this file by e.g. const DwebObjects = require('dweb-objects')

DwebObjects = { }

//Not including Transports here, as may choose between direct or service worker
//DwebObjects.Transports = require('dweb-transports');

DwebObjects.errors = require('./Errors');
DwebObjects.SmartDict = require("./SmartDict");
DwebObjects.KeyPair = require("./KeyPair");
DwebObjects.Signature = require("./Signature");
DwebObjects.PublicPrivate = require("./PublicPrivate");
DwebObjects.CommonList = require("./CommonList");
DwebObjects.KeyValueTable = require("./KeyValueTable");
DwebObjects.AccessControlList = require("./AccessControlList");
DwebObjects.KeyChain = require('./KeyChain');
DwebObjects.VersionList = require('./VersionList');
DwebObjects.EventListenerHandler = require("./EventListenerHandler");
DwebObjects.Domain = require("./Domain");
DwebObjects.Leaf = DwebObjects.Domain.clsLeaf;
// Note that no transports are required here, the ones used are loaded in ../archive/archive.js or ./Dweb_alltransports.js
DwebObjects.utils = require('./utils.js'); // Some short functions of relevance multiple places.
if (typeof window !== "undefined") { window.DwebObjects = DwebObjects; }
exports = module.exports = DwebObjects;