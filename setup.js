debugstr = "dweb-transports dweb-transports:* dweb-objects dweb-objects:*"
if (typeof localStorage !== "undefined") localStorage.debug = debugstr;
process.env.DEBUG = debugstr;

// Fake a browser like environment for some tests inc in Node CreateCustomEvent
const jsdom = require("jsdom");
const { JSDOM } = jsdom;        //TODO - figure out what this does, dont understand the Javascript
htmlfake = '<!DOCTYPE html></html>';
const dom = new JSDOM(htmlfake);
document = dom.window.document;   // Note in JS can't see "document" like can in python

// Dweb constituents
global.DwebTransports = require('@internetarchive/dweb-transports'); // Manage all Transports that are loaded
const Domain = require('./Domain');

/*
    This file sets up various data structures,

    It can be run multiple times and new runs should override old ones.
    Generally its best to use deterministic keys here, rather than newly generated ones as multiple runs can otherwise cause unneccessary merkle-cascades.

    Usage:  > node setup.js


 */


// Utility packages (ours) And one-liners
//function delay(ms, val) { return new Promise(resolve => {setTimeout(() => { resolve(val); },ms)})}

//require('y-leveldb')(DwebTransports._transportclasses["YJS"].Y); //- can't be there for browser, node seems to find it ok without this and auto-loads with a warning.
// Note that this test setup is being mirror in test_ipfs.html
// In general it should be possible to comment out failing tests EXCEPT where they provide a value to the next */

async function p_setup() {
    try {
        //SEE-OTHER-ADDTRANSPORT - note these are options just for testing that override default options for the transport.
        let opts = {
            //http: {urlbase: "http://localhost:4244"},   // Localhost - comment out if want to use dweb.me (default args use this)
            yjs: {db: {name: "leveldb", dir: "../leveldb_dweb", connector: {}}},  // cleanStart: true  clears db so dont use that
            webtorrent: {}
        }; // Note browser requires indexeddb

        // Note the order of these is significant, it will retrieve by preference from the first setup, try with both orders if in doubt.
        //SEE-OTHER-ADDTRANSPORT
        //TODO-REQUIRE these will break
        //let t_ipfs = await DwebTransports._transportclasses["IPFS"].p_setup(opts); await t_ipfs.p_status(); // Note browser requires indexeddb
        //let t_yjs = await DwebTransports._transportclasses["YJS"].p_setup(opts);  await t_yjs.p_status(); // Should find ipfs transport
        let t_http = await DwebTransports._transportclasses["HTTP"].p_setup(opts); await t_http.p_status();
        //let t_webtorrent = await TransportWEBTORRENT.p_test(opts); await t_webtorrent.p_status();
        console.log("setup returned and transport(s) connected:", await DwebTransports.p_connectedNames());
        await Domain.p_setupOnce();
    } catch (err) {
        console.log("Test failed", err);
    }

}
p_setup();

