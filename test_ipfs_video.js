//TODO-REPO move this to dweb-transports
localStorage.debug = "dweb-transports dweb-transports:* dweb-objects dweb-objects:*";
const IPFS = require('ipfs');

var ipfs;
const CID = require('cids');
const unixFs = require('ipfs-unixfs');
const multihashes = require('multihashes');
let tryexpectedfailures = false; // Set to false if want to check the things we expect to fail.
const ipfsAPI = require('ipfs-http-client')
// connect to ipfs daemon API server

const usehttpapi=false; // True uses local ipfs instance on machine where doing test, otherwise uses Javascript library

let defaultipfsoptions = {
    repo: '/tmp/ipfs_testipfsv7', //TODO-IPFS think through where, esp for browser
    //init: true,
    //start: false,
    config: {
        //Addresses: { Swarm: [ '/dns4/ws-star.discovery.libp2p.io/tcp/443/wss/p2p-websocket-star']},
        Bootstrap: ['/dns4/dweb.me/tcp/443/wss/ipfs/QmPNgKEjC7wkpu3aHUzKKhZmbEfiGzL5TP1L8zZoHJyXZW'],
    },
    EXPERIMENTAL: {
        pubsub: true
    }
};

// Converstion routines - IPFS's API is odd, some functions want a multihash (e.g. "Q..." or "z...") some wanta path e.g. "/ipfs/Q..." and soem want a CID data structure
function ipfsFrom(url) {
    /*
    Convert to a ipfspath i.e. /ipfs/Qm....
    Required because of strange differences in APIs between files.cat and dag.get  see https://github.com/ipfs/js-ipfs/issues/1229
     */
    if (url instanceof CID)
        return "/ipfs/"+url.toBaseEncodedString();
    if (typeof(url) !== "string") { // It better be URL which unfortunately is hard to test
        url = url.path;
    }
    if (url.indexOf('/ipfs/')) {
        return url.slice(url.indexOf('/ipfs/'));
    }
    throw new errors.CodingError(`ipfsFrom: Cant convert url ${url} into a path starting /ipfs/`);
}
function multihashFrom(url) {
    if (url instanceof CID)
        return url.toBaseEncodedString();
    if (typeof url === 'object' && url.path)
        url = url.path;     // /ipfs/Q...
    if (typeof(url) === "string") {
        const idx = url.indexOf("/ipfs/");
        if (idx > -1) {
            return url.slice(idx+6);
        }
    }
    throw new errors.CodingError(`Cant turn ${url} into a multihash`);
}

function p_ipfsstart() {
    return new Promise((resolve, reject) => {
        if (!usehttpapi) {
            ipfs = new IPFS(defaultipfsoptions);

            ipfs.on('ready', () => {
                resolve();
            });
            ipfs.on('error', (err) => reject(err));
        } else {
            ipfs = ipfsAPI('localhost', '5001', {protocol: 'http'}) // leaving out the arguments will default to these values
            resolve();
        }
    })
        .then(() => ipfs.version())
        .then((version) => console.log('IPFS READY', version))
        .catch((err) => {
            console.log("Error caught in p_ipfsstart", err);
            throw(err);
        })
}

function check_result(name, buff, expected, expectfailure) {
    if ( (typeof(expected) === "number") && (expected !== buff.length)) {
        console.log(name, "Expected block length", expected, "but got", buff.length, expectfailure ? "Note this was expected to fail." : "");
        //console.log(buff); // Normally leave commented out - will be long if looking at 250k file !
    } else if ((typeof(expected) !== "number") && (JSON.stringify(expected) !== JSON.stringify(buff))) {
        console.log(name, "Expected:", expected.constructor.name, expected, "got", buff.constructor.name, buff, expectfailure ? "Note this was expected to fail." : "");
    } else {
        console.log(name, "Retrieved successfully");
    }
    return buff; // Simplify promise chain
}

async function test_files_cat(cid, expected, expectfailure) {
    try {
        if (expectfailure && !tryexpectedfailures) return;
        console.log("testing via files.cat")
        cid = ipfsFrom(cid);    // Turn it into the /ipfs/Q... form that files.cat now expects
        buff = await ipfs.files.cat(cid); //Error: Groups are not supported in the blocks case - never returns from this call.
        check_result("files.cat", buff, expected, expectfailure);
    } catch(err) {
        console.log("Error thrown in files.cat", err);
    }
}

async function test_bylinks(cid, expected, expectfailure) {
    //TODO still working on this
    try {
        if (expectfailure && !tryexpectedfailures) return;
        console.log("testing via object.links and data")
        const links = await ipfs.object.links(multihashFrom(cid))
        console.log(`Retrieved ${links.length} links`);
        chunks = []
        for (let l in links) {
            const link = links[l];
            const lmh = link.multihash;
            console.log("Link",l,"multihash=",multihashes.toB58String(lmh), lmh)
            const d = await ipfs.object.data(lmh);
            console.log(`Read ${d.length} bytes`);
            const data = unixFs.unmarshal(d).data;
            console.log(`Unmarshaled ${data.length} bytes`)
            chunks.push(data);
        }
        const buff = Buffer.concat(chunks);
        check_result("bylinks", buff, expected, expectfailure)
    } catch (err) {
        console.log("Error thrown in test_bylinks", err);
    }
}

/* Each of this set of routines uploads with one method, and tries retrieving with multiple */

async function test_long_file(note, multihash, len) {
    console.log(`--------Testing ${note} ${multihash}`);
    // Note this hash is fetchable via https://ipfs.io/ipfs/Qmbzs7jhkBZuVixhnM3J3QhMrL6bcAoSYiRPZrdoX3DhzB
    let cid = new CID(multihash);
    // Uncomment one or both of these tests
    await test_files_cat(cid, len,false);             // Works in node and in Chrome
    //await test_bylinks(cid, len, false);
}
async function test_ipfs() {
    await p_ipfsstart(true);
	await test_long_file('PDF sent to http api a long time ago', "Qmbzs7jhkBZuVixhnM3J3QhMrL6bcAoSYiRPZrdoX3DhzB", 262438);
	//await test_long_file('Commute 11Mb video sent a few months ago almost certainly via urlstore', 'zdj7Wc9BBA2kar84oo8S6VotYc9PySAnmc8ji6kzKAFjqMxHS', 11919082);
	//await test_long_file('500Mb file sent few days ago via urlstore', 'zdj7WfaG5e1PWoqxWUyUyS2nTe4pgNQZ4tRnrfd5uoxrXAANA', 521998952);
	//await test_long_file('Smaller 22Mb video sent 2018-03-13', 'zdj7WaHjDtE2e7g614UfXNwyrBwRUd6JkujRsLc9M2ufozLct', 22207578);
	//await test_long_file('Using ipfs add', 'QmUrp54J5E2jxf8stDiCa56uXASjqHeX2oFWSx35qRE4SV', 0);
	//await test_long_file('Using curl urlstore add', 'zdj7WkPCyjRgfCAMosMxCx8UhtW6rZvPNRsxCzg3mrxTLRVBr', 321761);
    //await test_long_file('Using a hash from the DHT Provide logs', 'zb2rhmFWNJ7TVEKQF6UEjnPbw4ESoq8CwbVTPHwQbacnoRd9M', 321761);  // files.cat says invalid node type, object.links returns undefined
    //await test_long_file('Using ipfs add on standard deployment on my mac', 'QmRfcgjWEWdzKBnnSYwmV7Kt5wVVuWZvLm96o4dj7myWuy', 321761);    // Same file as above as of 27Mar doesnt respond on links?
    //await test_long_file('Using a hash from the DHT Provide logs', 'zdj7WXHDDkXthYNLKNQg2DZkBD8vmAQ2K37dURNRwAAM1iMSQ', 321761);  // files.cat says invalid node type, object.links returns undefined
    await test_long_file('Using a hash from add.csv using http add', 'QmfWQzucB7QWq32meSSKk8xLEtouAEWnWs7RatbxJz9wkj', 13980);  // files.cat says invalid node type, object.links returns undefined
    await test_long_file('Using a hash from add.csv using http urlstore', 'zb2rhXDUQRraHn3tQcq8MHVMVSVP9RwRyEMzyBhehssVjnPWb', 9613);  // files.cat says invalid node type, object.links returns undefined
    console.log('---- finished --- ')
}

test_ipfs();
