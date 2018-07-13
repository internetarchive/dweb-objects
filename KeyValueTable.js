const SmartDict = require("./SmartDict");   // _AccessControlListEntry extends this
const PublicPrivate = require("./PublicPrivate"); //for extends
const utils = require('./utils'); // Utility functions
const CustomEvent = require('custom-event'); // From web, Not present in node - this code uses global.CustomEvent if it exists so safe on browser/node
// Depends on var DwebTransports being set externally - its done this way so that both direct and ServiceWorker/Proxy can be used

class KeyValueTable extends PublicPrivate {
    /*
    Manages a KeyValue object intended for each field to be a separate item

    Fields:
    _autoset:       When set to true, any changes will be stored to server its set after p_new writes initial data
    tableurls       Urls needed to write to the table
    tablepublicurls Urls needed to read from the table, e.g. YJS which can be retrieved from.
    _map           Where the KV mapping is stored.

    Fields Inherited from PublicPrivate:
    keypair         Key used to sign - not used here (yet), but is in Domain

    Three ordering use cases
    a) Create new object via p_new, store it the setart setting
    b) Retrieve object via SmartDict - want to start monitor after get, and start set

     */

    constructor(data, verbose, options) {
        super(data, verbose, options);
        this.table = "keyvaluetable"; // Superclasses may override
        if (typeof this._autoset === "undefined") {
            // If we haven't explicitly set _autoset then set if it looks like we are a master with a table to connect to.
            this._autoset = this._master && this["tablepublicurls"] && this.tablepublicurls.length
        }
        this._map = this._map || {};
    }

    static async p_new(data, master, key, verbose, options) {
        /*
            options: {
            keyvaluetable   Which table at the DB to store this in
            seedurls        extra urls to use for tablepublicurls, typically a http server
        */
        const keyvaluetable = options.keyvaluetable;  // Dont store this, use it to generate newtable
        delete options.keyvaluetable;
        const seedurls = options.seedurls || [];
        delete options.seedurls;
        const obj = await super.p_new(data, master, key, verbose, options);
        // Should set this._autoset to true if and only if master && urls set in data or options
        if (master && !(obj.tablepublicurls && obj.tablepublicurls.length)) {
            const res = await DwebTransports.p_newtable(obj, keyvaluetable, {verbose});
            obj.tableurls = res.privateurls;
            obj.tablepublicurls = res.publicurls.concat(seedurls);
            obj._autoset = true;
            await obj.p_store();
        }
        return obj;
    }

    objbrowser_fields(propname) {
        let fieldtypes = { _autoset: "str", "tableurls": "urlarraynolinks", "tablepublicurls": "urlarraynolinks"}
        return fieldtypes[propname] || super.objbrowser_fields(propname);
    }

    _storageFromMap(mapVal, {publicOnly=false, encryptIfAcl=true}={}) {
        /*
        Convert a value as stored on a transport medium into a value suitable for the _map dictionary. Pair of _storageFromMap.
        This is working from the assumption that the underlying transport needs a JSON string to store.
        If change that assumption - and store Objects - then these two functions should be only place that needs changing.
        This pair should be able to be subclassed safely as long as _mapFromStorage(_storageFromMap(x)) == x for your definition of equality.
        publicOnly  If true massage the data to store a safe value
        encryptIfAcl    If true, and there is an acl field, then use the encryption process before storing
         */
        if (mapVal instanceof SmartDict) {
            return mapVal._getdata({publicOnly, encryptIfAcl});               // This should also take care of not storing unencrypted private keys, and encrypting if requested.
        } else {
            return JSON.stringify(mapVal)
        }
    }
    _mapFromStorage(storageVal, verbose=false) {
        /*
        Convert a value as stored in the storage dictionary into a value suitable for the map. Pair of _storageFromMap.
         */
        try {
            let obj = storageVal && JSON.parse(storageVal);   // Could be a string, or an integer, or a object or array of any of these
            if (Array.isArray(obj)) {
                return obj.map(m => this._storageFromMap(m))
            } else if (typeof(obj) === "object") {
                if (obj["table"]) {
                    obj = SmartDict._sync_after_fetch(obj, [], verbose);   // Convert object to subclass of SmartDict, note cant decrypt as sync
                }
                //else If no "table" field, then just return the object.
            }
            //else  if its not an object, return the string or integer.
            return obj;
        } catch(err) {
            console.error("KeyValueTable._mapFromStorage Unable to decode", err);
            throw(err);
        }
    }
    preflight(dd) {
        let master = dd._master; //Save before super.preflight
        dd = super.preflight(dd);  // Edits dd in place, in particular deletes anything starting with _
        if (! master) {
            delete dd.tableurls
        }
        return dd;
    }



    async p_set(name, value, {verbose=false, publicOnly=false, encryptIfAcl=true, fromNet=false}={}) {
        /* Set a value to a named key in the table setup during creating of this KeyValueTable
            name            of key to store under
            value           value to store
            publicOnly      If true massage the data to store a safe value
            encryptIfAcl    If true, and there is an acl field, then use the encryption process before storing
            fromNet         If true this data came from a notification from the net, store locally but don't send back to net

         */
        // Subclased in Domain to avoid overwriting private version with public version from net
        //TODO-KEYVALUE-SIGN these sets need to be signed if the transport overwrites the previous, rather than appending see dweb-objects/issue#2
        //TODO-KEYVALUE-SIGN the difference is that if appended, then an invalid signature (if reqd) in the value would cause it to be discarded. see dweb-objects/issue#2
        if (this._autoset && !fromNet && (this._map[name] !== value)) {
            await DwebTransports.p_set(this.tableurls, name, this._storageFromMap(value, {publicOnly, encryptIfAcl}), {verbose}); // Note were not waiting for result but have to else hit locks
        }
        if (!((value instanceof PublicPrivate) && this._map[name] && this._map[name]._master)) {
            // Dont overwrite the name:value pair if we already hold the master copy. This is needed for Domain, but probably generally useful
            // The typical scenario is that a p_set causes a monitor event back on same machine, but value is the public version
            this._map[name] = value;
        }
    }
    _updatemap(res) {
        Object.keys(res).map(key => { try { this._map[key] = this._mapFromStorage(res[key])} catch(err) { console.log("Not updating",key)} } );
    }
    async p_get(keys, verbose) {
        /*  Get the value stored at a key
        keys:   single key or array of keys
        returns:    single result or dictionary, will convert from storage format
         */
        if (!Array.isArray(keys)) { // Handle single by doing plural and returning the key
            return (await this.p_get([keys], verbose))[keys]
        }
        if (!keys.every(k => this._map[k])) {
            // If we dont have all the keys, get from transport
            const res = await DwebTransports.p_get(this.tablepublicurls, keys, {verbose});
            this._updatemap(res);
        }
        // Return from _map after possibly updating it
        return utils.keyFilter(this._map, keys);
    }

    async p_getMerge(keys, verbose) {
        /*
        Get the value of a key, but if there are multiple tablepublicurls then check them all, and use the most recent value
        TODO - will store most recent back to stores that don't have it.

        key:    Key or Array of keys.
        return: value or array of values
         */
        if (Array.isArray(keys)) {
            const res = {};
            const self = this;
            await Promise.all(keys.map((n) => { res[n] = self.p_getMerge(n, verbose)}));    // this was p_get but that looked wrong, changed to p_getMerge
            return res;
        }
        if (this._map[keys])
            return this._map[keys]; // If already have a defined result then return it (it will be from this session so reasonable to cache)
        const rr = (await Promise.all(this.tablepublicurls.map(u => DwebTransports.p_get([u], keys, {verbose}).catch((err) => undefined))))
            .map(r => this._mapFromStorage(r))
        // Errors in above will result in an undefined in the res array, which will be filtered out.
        // res is now an array of returned values in same order as tablepublicurls
        //TODO-NAME TODO-KEYVALUE-SIGN should verify here before do this test but note Python gateway is still using FAKEFAKEFAKE as a signature see dweb-objects/issue#2
        const indexOfMostRecent = rr.reduce((iBest, r, i, arr) => (r && r.signatures[0].date) > (arr[iBest] || "" && arr[iBest].signatures[0].date) ? i : iBest, 0);
        //TODO-NAME save best results to others.
        const value = rr[indexOfMostRecent];
        this._map[keys] = value;
        return value;
    }

    async p_keys(verbose) {
        /*
        returns array of all keys
         */
        return await DwebTransports.p_keys(this.tablepublicurls, {verbose})
    }
    async p_getall(verbose) {
        /*
        returns dictionary of all keys
         */
        const res = await DwebTransports.p_getall(this.tablepublicurls, verbose);
        this._updatemap(res);
        return this._map;
    }

    async p_delete(key, {fromNet=false, verbose=false}={}) {
        delete this._map[key]; // Delete locally
        if (!fromNet) {
            await DwebTransports.p_delete(this.tablepublicurls, key, {verbose});    // and remotely.
        }
    }
    //get(name, default) cant be defined as overrides this.get()

    // ----- Listener interface ----- see https://developer.mozilla.org/en-US/docs/Web/API/EventTarget for the pattern
    monitor({verbose=false, current=false}={}) {
        /*
        Add a monitor for each transport - note this means if multiple transports support it, then will get duplicate events back if everyone else is notifying all of them.
        Note monitor() is synchronous, so it cant do asynchronous things like connecting to the underlying transport
        Stack: KVT()|KVT.p_new => KVT.monitor => (a: DwebTransports.monitor => YJS.monitor)(b: dispatchEvent)
         */
        if (verbose) console.log("Monitoring", this.tablepublicurls);
        DwebTransports.monitor(this.tablepublicurls, //TODO-SW this wont work with service workers yet,
            (event) => {    // event of form {type, key, value} with value being an obj, so already done JSON.parse (see YJS for example)
                if (verbose) console.log("KVT monitor",event,this.tablepublicurls);
                switch (event.type) {
                    case "set": // YJS mapped from ad
                        this.p_set(event.key, this._mapFromStorage(event.value), {fromNet: true, verbose: verbose}); // Loop broken in set if value unchanged
                        break;
                    case "delete":
                        if (!["tablepublicurls", "tableurls"].includes(event.key)) { //Potentially damaging, may need to check other fields
                            this.p_delete(event.key, {fromNet: true, verbose: verbose});
                        }
                        break;
                }
                this.dispatchEvent(new CustomEvent(event.type, {target: this, detail: event}));   // Pass event on to application after updating local object
            },
            {verbose, current});
    }

    static async p_test(verbose) {
        if (verbose) console.log("KeyValueTable testing starting");
        try {
            let masterobj = await this.p_new({name: "TEST KEYVALUETABLE", _allowunsafestore: true}, true, {passphrase: "This is a test this is only a test of VersionList"}, verbose, { keyvaluetable: "TESTTABLENAME"});
            await masterobj.p_set("address","Nowhere", verbose);
            let publicobj = await SmartDict.p_fetch(masterobj._publicurls, verbose);
            await publicobj.p_getall(); // Load from table
            console.assert(publicobj._map["address"] === "Nowhere"); // Shouldnt be set yet
            await masterobj.p_set("address","Everywhere", verbose);
            await delay(500);
            if (await DwebTransports.p_urlsValidFor(masterobj.tablepublicurls, "monitor").length) {
                console.assert(publicobj._map["address"] === "Everywhere"); // Should be set after allow time for monitor event
            } else {
                console.log('Loaded transports dont support "monitor"');
            }
        } catch (err) {
            console.log("Caught exception in KeyValueTable.test", err);
            throw(err)
        }
    }


}
function delay(ms, val) { return new Promise(resolve => {setTimeout(() => { resolve(val); },ms)})}

SmartDict.table2class["keyvaluetable"] = KeyValueTable;

exports = module.exports = KeyValueTable;
