const debugsmartdict = require('debug')('dweb-objects:smartdict');
const errors = require('./Errors');
const utils = require('./utils'); // Utility functions
// Depends on var DwebTransports being set externally - its done this way so that both direct and ServiceWorker/Proxy can be used

class SmartDict {
    /*
    Stores a data structure, usually a single layer Javascript dictionary object.
    SmartDict is intended to support the mechanics of storage and retrieval while being  subclassed to implement functionality
    that understands what the data means.

    By default any fields not starting with “_” will be stored, and any object will be converted into its url.

    The hooks for encrypting and decrypting data are at this level, depending on the _acl field, but are implemented by code in CryptoLib.

    See PublicPrivate header for how PP.p_store, PP._p_storepublic, _getdata and preflight work closely together

    Fields:
    _acl    if set (on master) to a AccessControlList or KeyChain, defines storage as encrypted -
    _urls   Array of URLs of data stored
    table   Name of class as looked up in DwebObjects.table2class
     */

    constructor(data, options) {
        /*
        Creates and initialize a new SmartDict.

        data	String|Object, If a string (typically JSON), then parse first.
                A object with attributes to set on SmartDict via _setdata
        options	Passed to _setproperties, by default overrides attributes set by data
         */
        this._urls = []; // Empty URLs - will be loaded by SmartDict.p_fetch if loading from an URL
        this._setdata(data); // The data being stored - note _setdata usually subclassed does not store or set _url
        this._setproperties(options);   // Note this will override any properties set with data
        if (!this.table) { this.table = "sd"; } // Set it if the data doesnt set it, should be overridden by subclasses
    }


    __setattr__(name, value) { // Call chain is ... success or constructor > _setdata > _setproperties > __setattr__
        // Subclass this to catch any field which has its own setter
        //Note how Signature transforms date to a string
        this[name] = value;
    }

    _setproperties(dict) { // Call chain is ... onloaded or constructor > _setdata > _setproperties > __setattr__
        if (dict) { // Ignore dict if null
            for (let prop in dict) {
                //noinspection JSUnfilteredForInLoop
                this.__setattr__(prop, dict[prop]);
            }
        }
    }
    _name() {
        return this.name || typeof(this); //TODO-DEBUG find a better way to do class in webpack
    }
    stored() {
        /*
        Check if stored (Note overridden in KeyValue to use a _dirty flag)
        returns True if data has been stored
         */
        return !!(this._urls && this._urls.length);
    }

    dirty() {  //(Note overridden in KeyValue to use a _dirty flag)
        /*
        Mark an object as needing storing again, for example because one of its fields changed.
        Flag as dirty so needs uploading - subclasses may delete other, now invalid, info like signatures
        */
        this._urls = [];
    }

    preflight(dd) { // Called on outgoing dictionary of outgoing data prior to sending - note order of subclassing can be significant
        /*
        Default handler for preflight, strips attributes starting “_” and stores and converts objects to urls.
            Subclassed in AccessControlList and KeyPair to avoid storing private keys.
            dd	dictionary to convert..
            Returns	converted dictionary
        */
        let res = {};
        for (let i in dd) {
            if (i.indexOf('_') !== 0) { // Ignore any attributes starting _
                if (dd[i] instanceof SmartDict) {
                    // Any field that contains an object will be turned into an array of urls for the object.
                    if (!dd[i].stored()) throw new errors.CodingError("Should store subobjects before calling preflight");
                    // Mostly want _urls, but for example even master of KeyChain is stored with _publicurls only
                    res[i] = dd[i]._urls.length ? dd[i]._urls : dd[i]._publicurls

                } else {
                    res[i] = dd[i];
                }
            }
        }
        // Note table is a object attribute in JS, so copied above (in Python its a class attribute that needs copying
        return res
    }

    _getdata({ publicOnly=false, encryptIfAcl=true}={}) {
        /*
        Prepares data for sending. Retrieves attributes, runs through preflight.
            If there is an _acl field then it passes data through it for encrypting (see AccessControl library)
        Returns	String suitable for p_rawstore
        */
        let dd = {};
        for (let i in this) {
            //noinspection JSUnfilteredForInLoop don't use "of" because want inherited attributes
            dd[i] = this[i];    // This just copies the attributes not functions
        }
        if (publicOnly) {
            dd._master = false;
        }
        dd = this.preflight(dd); // This is where fields get deleted or updated (in subclasses etc)
        // Note that its this._acl not dd._acl as _acl is removed by default
        let res = JSON.stringify(dd);
        if (encryptIfAcl && this._acl ) { //Need to encrypt, _acl is an object, not a url
            let encdata = this._acl.encrypt(res, true);  // data, b64
            let dic = { "encrypted": encdata, "acl": this._acl._publicurls, "table": this.table};
            res = JSON.stringify(dic);
        }
        return res
    }

    _setdata(value) {
        /*
        Stores data, subclass this if the data should be interpreted as its stored.
        value	Object, or JSON string to load into object.
         */
        // Note SmartDict expects value to be a dictionary, which should be the case since the HTTP requester interprets as JSON
        // Call chain is ...  or constructor > _setdata > _setproperties > __setattr__
        // COPIED FROM PYTHON 2017-5-27
        value = typeof(value) === "string" ? JSON.parse(value) : value; // If its a string, interpret as JSON
        if (value && value.encrypted)
            throw new errors.EncryptionError("Should have been decrypted in p_fetch");
        this._setproperties(value);
    }

    async p_store() {
        /*
        Store the data on Dweb, if it has not already been, stores any urls in _url field
        Resolves to	obj
        Throws TransportError if no transports or unable to fetch, leaves in !stored state (empty _urls field)
         */
        try {
            if (this.stored())
                return this;  // No-op if already stored, use dirty() if change after retrieved
            let data = this._getdata();
            debugsmartdict("SmartDict.p_store data=%o", data);
            this._urls = await DwebTransports.p_rawstore(data);
            debugsmartdict("SmartDict.p_store urls=%o", this._urls);
            return this;
        } catch (err) {
            console.log("SmartDict p_store failed");
            throw err;
        }
    }

    match(dict) {
        /*
        Checks if a object matches for each key:value pair in the dictionary.
        Any key starting with "." is treated specially esp:
        .instanceof: class: Checks if this is a instance of the class
        other fields will be supported here, any unsupported field results in a false.

        :returns: boolean, true if matches
         */
        return Object.keys(dict).every((key) => {
            return (
                (["_publicurls","_urls", "tablepublicurls"].includes(key))  ? utils.intersects(this[key], dict[key])
                :   (key[0] !== '.')            ? (this[key] === dict[key])
                :   ( key === ".instanceof")    ? (this instanceof dict[key])
                :   false)
        })
    }

    copy() {
        /*
        Copy a SmartDict or subclass, will treat "this" as a dict and add to fields, note will shallow copy, not deep copy.
        returns: new instance of SmartDict or subclass
        */
        return new this.constructor(this);
    }

    objbrowser_createElement(tag, attrs, children) {        // Note arguments is set to tag, attrs, child1, child2 etc
        return utils.createElement(...arguments);           // Use ... because "children" is a placeholder for a long list of arguments
    }

    _objbrowser_row(el, name, valueElement) {
        el.appendChild(
            this.objbrowser_createElement('li', {className: 'prop'},
                this.objbrowser_createElement('span',{className: 'propname'}, name),
                valueElement ) );
    }
    objbrowser_str(el, name, val) {
        this._objbrowser_row(el, name,
            this.objbrowser_createElement('span',{className: 'propval'}, val) );
    }
    objbrowser_obj(el, name, val) {
        this._objbrowser_row(el, name,
            this.objbrowser_createElement('span',{className: 'propval', source: val},
                this.objbrowser_createElement('span', {onclick: `DwebObjects.SmartDict.p_objbrowser_expandurl(this.parentNode); return false;`},val.constructor.name)

            ));
    }
    static async p_objbrowser_expandurl(el, obj) {
        if (typeof obj === "undefined") // If dont specify check source, which may also be undefined, but use if there.
            obj = el.source || el.getAttribute("source"); // Note el.source wont work for elements
        if (Array.isArray(obj) && typeof obj[0] === "string")
            obj = await SmartDict.p_fetch(obj);
        else if (typeof obj === "string")
            obj = await SmartDict.p_fetch([obj]);
        //else // Expecting its subclass of SmartDict or otherwise has a p_objbrowser method
        await obj.p_objbrowser(el,{maxdepth: 2});    //Could pass args here but this comes from UI onclick
        return false;
    }
    objbrowser_urlarray(el, name, arr, {links=false}={}) {
        this._objbrowser_row(el, name,
            this.objbrowser_createElement('ul',{className: 'propurls propval'},
                links
                    ? arr.map(l => this.objbrowser_createElement('li',{className: 'propurl', source: l},
                        this.objbrowser_createElement('span', {onclick: `DwebObjects.SmartDict.p_objbrowser_expandurl(this.parentNode); return false;`},l)
                    ) )
                    : arr.map(l => this.objbrowser_createElement('li',{className: 'propurl'},l) )
            ) );
    }
    objbrowser_arrayobj(el, name, arr, {links=false}={}) {
        this._objbrowser_row(el, name,
            this.objbrowser_createElement('ul',{className: 'propurls propval'},
                arr.map((l,i) => this.objbrowser_createElement('li',{className: 'propurl', source: l},
                    this.objbrowser_createElement('span', {onclick: `DwebObjects.SmartDict.p_objbrowser_expandurl(this.parentNode); return false;`}, `${i}...`)
                ))
            ) );
    }
    objbrowser_dictobj(el, name, arr, {links=false}={}) {
        const ul = this.objbrowser_createElement('ul',{className: 'propurls propval'},[]);
        this._objbrowser_row(el, name, ul);
        arr.map((l,i) => this._objbrowser_row(ul, name,
            this.objbrowser_createElement('span', {},
                this.objbrowser_createElement('span', {onclick: `DwebObjects.SmartDict.p_objbrowser_expandurl(this.parentNode); return false;`}, `${i}...`)
            )));
    }
    objbrowser_arraystr(el, name, arr) {
        this._objbrowser_row(el, name,
            this.objbrowser_createElement('ul',{className: 'propurls propval'},
                arr.map((l,i) => this.objbrowser_createElement('li',{className: 'propval'},
                    this.objbrowser_createElement('span', {}, l)
                ))
            ) );
    }
    objbrowser_fields(propname) {
        let fieldtypes = { _acl: "obj", _urls: "urlarray", table: "str", name: "str" } // Note Name is not an explicit field, but is normally set
        return fieldtypes[propname];
    }
    async p_objbrowser(el, {maxdepth=2}={}) { // Note This could be sync, but subclassing is async
        //TODO-OBJBROWSER empty values & condition on option
        if (typeof el === 'string') { el = document.getElementById(el); }
        for (let propname in this) {
            switch(propname) {
                case "xx":   el.appendChild("XX"); // This is how to special case a field
                    break;
                default:
                    switch (this.objbrowser_fields(propname)) {  // Note this is just types for this particular superclass, each recursion will look at different set
                        case "urlarray": this.objbrowser_urlarray(el, propname, this[propname], {links: true});
                            break;
                        case "urlarraynolinks": this.objbrowser_urlarray(el, propname, this[propname], {links: false});
                            break;
                        case "str": this.objbrowser_str(el, propname, this[propname]);
                            break;
                        case "obj": this.objbrowser_obj(el, propname, this[propname]);
                            break;
                        case "jsonobj": this.objbrowser_str(el, propname, JSON.stringify(this[propname]));
                            break;
                        case "arrayjsonobj": this.objbrowser_arraystr(el, propname, this[propname].map(m => JSON.stringify(m)));
                            break;
                        case "arrayobj": this.objbrowser_arrayobj(el, propname, this[propname], {links: true});
                            break;
                        case "dictobj": this.objbrowser_dictobj(el, propname, this[propname], {links: true});
                            break;
                        case "arraystr": this.objbrowser_arraystr(el, propname, this[propname]);
                            break;
                        case "key": this.objbrowser_key(el, propname, this[propname]); // Only defined on KeyPair
                            break;
                        default:
                            // Super classes call super.p_objbrowser(el,options) here
                            this.objbrowser_str(el, propname, this[propname].toString())
                            console.log("objbrowser warning, no field type specified for",propname);
                    }
            }
        }
    }
    static _sync_after_fetch(retrievedobj, urls) {
        /*
         Turn a data structure retrieved from transport into a class based on retrievedobj[“table”]
        retrievedobj	An object as retrieved from the transport
        urls	        set to _urls field to show where retrieved from
        */
        let table = retrievedobj.table;               // Find the class it belongs to
        if (!table) {
            throw new errors.ToBeImplementedError("SmartDict.p_fetch: no table field, whatever this is we cant decode it");
        }
        let cls = this.table2class[table];        // Gets class
        if (!cls) { // noinspection ExceptionCaughtLocallyJS
            throw new errors.ToBeImplementedError("SmartDict.p_fetch: " + table + " is not implemented in table2class");
        }
        //console.log(cls);
        if (!((cls === SmartDict) || (cls.prototype instanceof SmartDict))) { // noinspection ExceptionCaughtLocallyJS
            throw new errors.ForbiddenError("Avoiding data driven hacks to other classes - seeing " + table);
        }
        if (urls.length) {
            retrievedobj._urls = urls;                         // Save where we got it - preempts a store - must do this after decrypt and before constructor as e.g KVT sets monitor if _urls is set
        }
        return new cls(retrievedobj);
        // Returns new object that should be a subclass of SmartDict

    }
    static async _after_fetch(maybeencrypted, urls) {
        /* Takes a structure after JSON.parse that might be encrypted, tried to decrypt
        raises: AuthenticationError if can't decrypt
         */
        let table = maybeencrypted.table;               // Find the class it belongs to
        if (!table) {
            throw new errors.ToBeImplementedError("SmartDict.p_fetch: no table field, whatever this is we cant decode it");
        }
        let cls = this.table2class[table];        // Gets class
        if (!cls) { // noinspection ExceptionCaughtLocallyJS
            throw new errors.ToBeImplementedError("SmartDict.p_fetch: " + table + " is not implemented in table2class");
        }
        //console.log(cls);
        if (!((cls === SmartDict) || (cls.prototype instanceof SmartDict))) { // noinspection ExceptionCaughtLocallyJS
            throw new errors.ForbiddenError("Avoiding data driven hacks to other classes - seeing " + table);
        }
        let decrypted = await cls.p_decrypt(maybeencrypted);    // decrypt - may return string or obj , note it can be subclassed for different encryption
        if (urls.length) {
            decrypted._urls = urls;                         // Save where we got it - preempts a store - must do this after decrypt and before constructor as e.g KVT sets monitor if _urls is set
        }
        return new cls(decrypted);
        // Returns new object that should be a subclass of SmartDict
    }
    //TODO-PATH notes below were written before Domain.js was built, better approach now would be to follow approach in Domain.js for "resolve" so that can have a Leaf be/point to a SmartDict (or other object) and then resolve a path in it
    //TODO-PATH add a method SmartDict.path(str) => (SmartDict, unresolved)
    //TODO-PATH uses step function. SmartDict.stepping(str) => (SmartDict, unresolved)  just does one step
    //TODO-PATH override step in subclasses e.g. Versionlist could jump through to current, a list could do based on Name etc
    //TODO-PATH see https://app.asana.com/0/235474089595967/476882458177199
    //TODO-PATH try uploading a directory adn using as test /ipfs/QmbdBWeoke5hyf1NDUV9Bee5YWZcFTRqtc3M17ntQ4ZsKv

    static async p_fetch(urls, opts={}) {
        /*
        Fetches the object from Dweb, passes to p_decrypt in case it needs decrypting,
        and creates an object of the appropriate class and passes data to _setdata
        This should not need subclassing, (subclass _setdata or p_decrypt instead).

        :resolves: New object - e.g. VersionList or KeyChain
        :throws: TransportError if url invalid, ForbiddenError if cant decrypt

         */
        try {
            debugsmartdict("SmartDict.p_fetch %o", urls);
            let data = await DwebTransports.p_rawfetch(urls, opts);  // Fetch the data Throws TransportError immediately if url invalid, expect it to catch if Transport fails
            let maybeencrypted = utils.objectfrom(data);         // Parse JSON (dont parse if p_fetch has returned object (e.g. from KeyValueTable
            return await this._after_fetch(maybeencrypted, urls); // AuthenticationError if can't decrypt
            // Returns new object that should be a subclass of SmartDict
        } catch(err) {
            console.log(`cant fetch and decrypt ${urls}`);
            throw(err);
        }
    }

    static async p_decrypt(data) {
        /*
         This is a hook to an upper layer for decrypting data, if the layer isn't there then the data wont be decrypted.
         Chain is SD.p_fetch > SD.p_decryptdata > ACL|KC.decrypt, then SD.setdata

         :param data: possibly encrypted object produced from json stored on Dweb
         :return: same object if not encrypted, or decrypted version
         :raises: AuthenticationError if can't decrypt
         */
        if (this.decryptcb) {
            return await this.decryptcb(data);
        }
    }

    static decryptwith(cb) {
        /*
        Takes a callback that should be used to decrypt data (see AccessControlList) for setting it.
        The callback should return a promise.
        raises: AuthenticationError if can't decrypt

        cb(encrypteddata) => resolves to data
         */
        this.decryptcb = cb;
    }

}

SmartDict.decryptcb = undefined;
SmartDict.table2class = { // Each of these needs a constructor that takes data and is ok with no other parameters, (otherwise define a set of these methods as factories)
    "sd": SmartDict
};

exports = module.exports = SmartDict;
