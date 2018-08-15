const errors = require('./Errors'); // Standard Dweb Errors
const debugdomain = require('debug')('dweb-objects:domain');
// Depends on var DwebTransports being set externally - its done this way so that both direct and ServiceWorker/Proxy can be used
const SmartDict = require("./SmartDict"); //for extends
const KeyPair = require('./KeyPair'); // Encapsulate public/private key pairs and crypto libraries
const utils = require('./utils'); // Utility functions
const KeyValueTable = require("./KeyValueTable"); //for extends
const KeyChain = require('./KeyChain'); // Hold a set of keys, and locked objects
// noinspection JSUnusedLocalSymbols
const AccessControlList = require('./AccessControlList');   // Required (though not used in this code) to make sure decryption is patched in

const rootSetPublicUrls =  [ 'contenthash:/contenthash/QmVFh13MW42ksJCCj73SGS5MzKggeyu1DmxsvteDnJPkmk' ];
//Mixins based on https://javascriptweblog.wordpress.com/2011/05/31/a-fresh-look-at-javascript-mixins/

const SignatureMixin = function(fieldlist) {
    /*
        This mixin is a generic signature tool, allows to specify which fields of an object should be signed/verified.

        Fields:
        signatures: [{
            date,                   ISODate when signed
            signature,              Signature (see KeyPair)
            signedby,               Exported Public Key of Signer (see KeyPair)
            }]                      Each signature is of JSON.stringify({date, signed} where signed is fields from fieldlist
     */
    this.fieldlist = fieldlist;

    this.signatureConstructor = function() {
        this.signatures = this.signatures || [];
    };
    this._signable = function(date) {
        // Note that any of these fields which are undefined will not be in the signable string since JSON.stringify will remove them
        return JSON.stringify({"date": date, signed: utils.keyFilter(this, this.__proto__.fieldlist)});
    };
    this._signSelf = function(keypair) { // Pair of verify
        /*
        Add a signature for the fieldlist to signatures
         */
        const date = new Date(Date.now());
        this.signatures.push({date,
            signature: keypair.sign(  this._signable(date)),
            signedby: keypair.signingexport()
        })
    };
    this._verifySig = function(sig) {
        /*
        Returns:    true if matches, else false
         */
        //(sig.signature === "FAKEFAKEFAKE") ||    // TODO=DOMAIN obviously this is faking verification while testing gateway to archive metadata
        try {
            return new KeyPair({key: sig.signedby}).verify(this._signable(sig.date), sig.signature);    // Throws SigningError
        } catch(err) {
            console.warn("Invalid signature", err.message);
            return false;

        }
    };

    this._verifyOwnSigs = function() { // Pair of sign
        // Return an array of keys that signed this match, caller should check it accepts those keys
        console.debug("WARNING - faking signature verification while testing gateway to archive metadata");
        return this.signatures
            .filter(sig => this._verifySig(sig))
            .map(sig => sig.signedby);
    };

    return this;
};

const NameMixin = function(options) {
    /*
        This Mixin defines fields and methods needed to name something in a Domain,
        Typically this will be either: another Domain; another SmartDict or class; raw content (e.g a PDF or HTML.

    Signed Fields
    tableurls | tablepublicurls    Where to find the object (or table if its a domain)
    expires: ISODATE         When this name should be considered expired (it might still be resolved, but not if newer names available.
    (there is no validfrom time, this is implicitly when it was signed)
    name: str               Names that this record applies to relative to table its in. e.g.  fred, father

     */
    this.nameConstructor = function() {
        this.expires = this.expires || undefined;    // If Hasn't set
    };
    return this;
};
class Leaf extends SmartDict {
    /*
        The Leaf class is used to register another object in a domain.

        Fields
        urls: Points at object being named (for a SmartDict object its obj._publicurls)
        mimetype:   Mimetype of content esp application/json
        metadata:   Other information about the object needed before or during retrieval.
                    This is a good place to extend, please document any here for now.
                    jsontype: archive.org.dweb   is a way to say its a Dweb object,
                    jsontype: archive.org.metadata is for archive.org metadata
        Fields inherited from SignatureMixin: signatures
        Fields inherited from NameMixin: expires; name;

     */
    constructor(data, options) {
        super(data, options);
        this.nameConstructor();   //
        this.signatureConstructor(); // Initialize Signatures
        this.table = 'leaf';
        this.mimetype = this.mimetype || undefined;  // Mime type of object retrieved
        this.metadata = this.metadata || {};         // Other information about the object needed before or during retrieval
    }
    static async p_new(data, options) {
        if (data instanceof SmartDict) {
            data = {urls: data._publicurls || data._urls };  // Public if appropriate else _urls
        }
        return new this(data, options)
    }

    objbrowser_fields(propname) {
        const fieldtypes = {  "urls": "urlarray", "mimetype": "str", "metadata": "dictobj",
            "signatures": "arrayjsonobj", "name": "str", expires: "str" };
        return fieldtypes[propname] || super.objbrowser_fields(propname);
    }

    async p_printable({indent="  ",indentlevel=0}={}) {
        // Output something that can be displayed for debugging
        return `${indent.repeat(indentlevel)}${this.name} = ${this.urls.join(', ')}${this.expires ? " expires:"+this.expires : ""}\n`
    }
    async p_resolve(path) {
        /*
        Sees it it can resolve the path in the Leaf further, because we know the type of object (e.g. can return subfield of some JSON)
         */
        try {
            if (["application/json"].includes(this.mimetype) ) {
                let data = await DwebTransports.p_rawfetch(this.urls, {timeoutMS: 5000});
                let datajson = (typeof data === "string" || data instanceof Buffer) ? JSON.parse(data) : data;          // Parse JSON (dont parse if p_fetch has returned object (e.g. from KeyValueTable
                if (this.metadata["jsontype"] === "archive.org.dweb") {
                    let obj = await SmartDict._after_fetch(datajson, urls);   // Interpret as dweb - look at its "table" and possibly decrypt
                    return obj.p_resolve(path);   // This wont work unless the object implements p_resolve (most dont)
                } else {
                    console.error("Leaf.p_resolve unknown type of JSON", this.mimetype);
                    // noinspection ExceptionCaughtLocallyJS
                    throw new errors.ResolutionError(`Leaf.p_resolve unable to resolve path: ${path} in ${this.name} because jsontype ${this.metadata["jsontype"]} unrecognized`);
                }
            } else if (["text/html"].includes(this.mimetype) ) {
                return [this, path];
            } else if (this.metadata.htmlpath === "/") {   // See if we have a leaf that is a directory and a remainder
                // This is important - we copy the Leaf because "this" is cached on the parent Domain, and if we edit the urls we'd edit the cached version
                let newleaf = new Leaf(this); // Copy it.
                newleaf.urls = this.urls.map(u => u + path);     // newleaf has new url array (not pointer to this's), with remainder appended to each URL - url should end in / for a directory, and path should not start with a /
                return [newleaf, ""];
            } else {
                console.error("Leaf.p_resolve, unknown mimetype", this.mimetype);
                // noinspection ExceptionCaughtLocallyJS
                throw new errors.ResolutionError(`Leaf.p_resolve unable to resolve path: ${path} in ${this.name} because mimetype ${this.mimetype} unrecognized`);
            }
        } catch(err) {
            throw new errors.ResolutionError(err.message);
        }
    }
    async p_boot({remainder=undefined, search_supplied=undefined, opentarget="_self", openChromeTab = undefined}={}) { //TODO-API
        /*
            Utility to display a Leaf, will probably need expanding to more kinds of media and situations via options
            Strategy depends on whether we expect relativeurls inside the HTML. If do, then need to do a window.open so that URL is correct, otherwise fetch and display as a blob

            remainder:  Any remainder string to send to the attribute specified in "leaf.htmlpath if specified
            search_supplied:    Anything supplied in after the ? in the original URL, should be added to the search string
            opentarget: Where to open the file, defaults to "_self"
            thows:      First error encountered, if doesnt succeed with any url.
         */
        if (!this.mimetype || ["text/html"].includes(this.mimetype)) {
            //Its an HTML file, open it
            if (this.metadata.htmlusesrelativeurls) {
                const pathatt = this.metadata.htmlpath || "path";
                // Loop through urls till succeed to open one of them
                let errs = [];
                let urlloaded = this.urls.map(u => new URL(u)).find( url => {
                    try {
                        if (remainder) url.search = url.search + (url.search ? '&' : "") + `${pathatt}=${remainder}`;
                        if (search_supplied) url.search = url.search + (url.search ? '&' : "") + search_supplied;
                        debugdomain("Bootstrap loading url: %s", url.href);
                        if(openChromeTab){
                            debugdomain("URL to load is %s"+url.href);
                            // noinspection JSUnresolvedVariable
                            chrome.tabs.update(openChromeTab, {url:url.href}, function(){});
                        }else{
                            window.open(url.href, opentarget); //if opentarget is blank then I think should end this script.
                        }
                        return true; // Only try and open one - bypasses error throwing
                    } catch(err) {
                        console.warn("Domain Failed to open", url, err.message);
                        errs.push(err);
                        return false;
                    }
                });
                if (urlloaded) {
                    debugdomain("Succeeded to open", urlloaded.href);
                } else if (errs.length) {
                    throw err[0];   // First error encountered
                } else {
                    throw new Error("Unable to open any URL in Leaf");
                }
            } else {
                // Its not clear if parms make sense to a blob, if they are needed then can copy from above code
                // Not setting timeoutMS as could be a slow load of a big file TODO-TIMEOUT make dependent on size
                //TODO figure out how to open as a stream and send to a window
                utils.display_blob(await DwebTransports.p_rawfetch(this.urls, {  timeoutMS: 5000}), {type: this.mimetype, target: opentarget});
            }
        } else {
            throw new Error("Bootloader fail, dont know how to display mimetype" + this.mimetype);
        }
    }

}

NameMixin.call(Leaf.prototype);
SignatureMixin.call(Leaf.prototype, ["expires", "name", "urls"]);   // Probably need to be in alphabetic order
SmartDict.table2class["leaf"] = Leaf;

class Domain extends KeyValueTable {
    /*
    The Domain class is for name resolution across multiple technologies.

    Domains are of the form /arc/somedomain/somepath/somename

    Where signed records at each level lead to the next level

    Fields:
    keys: [NACL VERIFY:xyz*]   Public Key to use to verify entries - identified by type, any of these keys can be used to sign a record


    Fields inherited from NameMixin: name; expires;
    Fields inherited from SignatureMixin: signatures

    Fields inherited from KeyValueTable
    tablepublicurls: [ str* ]       Where to find the table.
    _map:   KeyValueTable   Mapping of name strings beneath this Domain
    */
    constructor(data, options) {
        super(data, options); // Initializes _map if not already set
        this.table = "domain"; // Superclasses may override
        this.nameConstructor();  // from the Mixin, initializes signatures
        this.signatureConstructor();
        if (this._master && this.keypair && !(this.keys && this.keys.length)) {
            this.keys = [ this.keypair.signingexport()]
        }
    }
    static async p_new(data, master, key, seedurls, kids) {
        /*
        seedurls:   Urls that can be used in addition to any auto-generatd ones
        kids:       dict Initial subdomains or leafs { subdomain: Leaf or Domain }
         */
        const obj = await super.p_new(data, master, key, {keyvaluetable: "domain", seedurls: seedurls}); // Will default to call constructor and p_store if master
        if (obj.keychain) {
            await obj.keychain.p_push(obj);
        }
        for (let j in kids ) {
            // noinspection JSUnfilteredForInLoop
            await obj.p_register(j, kids[j]);
        }
        return obj;
    }

    objbrowser_fields(propname) {
        const fieldtypes = { _map: "dictobj", "keys": "arraystr",
            "signatures": "arrayjsonobj", "name": "str", expires: "str" };
        return fieldtypes[propname] || super.objbrowser_fields(propname);
    }

    sign(subdomain) { // Pair of verify
        subdomain._signSelf(this.keypair);
    }
    verify(name, subdomain) { // Pair of sign
        /* Check the subdomain is valid.
            That is teh case if the subdomain has a cryptographically valid signatures by one of the domain's keys and the name matches the name we have it at.
         */
        // its called when we think we have a resolution.
        //TODO-NAME need to be cleverer about DOS, but at moment dont have failure case if KVT only accepts signed entries from table owner or verifies on retrieval.
        // Throws error if doesnt verify
        return subdomain._verifyOwnSigs().some(key => this.keys.includes(key))                       // Check valid sig by this
            && (name === subdomain.name); // Check name matches
    }

    async p_register(name, registrable) {
        /*
        Register an object
        name:   What to register it under, relative to "this"
        registrable:    Either a Domain or Leaf, or else something with _publicurls or _urls (i.e. after calling p_store) and it will be wrapped with a Leaf

        Code path is domain.p_register -> domain.p_set
         */
        if (!(registrable instanceof Domain || registrable instanceof Leaf)) {
            // If it isnt a Domain or Leaf then build a name to point at it
            registrable = await Leaf.p_new(registrable)
        }
        registrable.name =  name;
        this.sign(registrable);
        console.assert(this.verify(name, registrable));   // It better verify !
        await this.p_set(name, registrable, {publicOnly: true, encryptIfAcl: false});
    }
    /*
        ------------ Resolution ---------------------
        Strategy: At any point in resolution,
        * start with path - look that up,
        * if fails, remove right hand side and try again,
        * keep reducing till get to something can resolve.
      */

    // use p_getall to get all registered names

    static async p_rootSet( ){
        //TODO-CONFIG put this (and other TODO-CONFIG into config file)
        this.root = await SmartDict.p_fetch(rootSetPublicUrls,  {timeoutMS: 5000});
    }

    static async p_rootResolve(path) {
        debugdomain("Resolving: %s in root", path);
        if (!this.root)
            await this.p_rootSet();
        if (path.startsWith("dweb:"))
            path = path.slice(5);
        if (path[0] === "/") {  // Path should start at root, but sometimes will be relative
            path = path.slice(1);
        }
        const res = await this.root.p_resolve(path);
        debugdomain("Resolved path %s to %s %s", path, res[0] ? (await res[0].p_printable({maxindent: 0})) : "undefined", res[1] ? "remaining:" + res[1] : "");
        return res;

    }
    async p_resolve(path) {
        /*
        Resolves a path, should resolve to the leaf
        resolves to:    [ Leaf, remainder ]
        raises:     CodingError
         */
        if (path[0] === "/") {
            throw new errors.CodingError(`p_resolve paths should be relative, got: ${path}`)
        }
        debugdomain("resolving %s in %s", path, this.name);
        let res;
        const remainder = path.split('/');
        const name = remainder.shift();
        res = await this.p_getMerge(name);
        if (res) {
            res = await SmartDict._after_fetch(res, []);  //Turn into an object
            this.verify(name, res);                                     // Check its valid
        }
        if (res) { // Found one
            if (!remainder.length) // We found it
                return [ res, undefined ] ;
            return await res.p_resolve(remainder.join('/'));           // ===== Note recursion ====
            //TODO need other classes e.g. SD  etc to handle p_resolve as way to get path
        } else {
            console.warn("Unable to resolve",name,"in",this.name);
            return [ undefined, path ];
        }
    }

    async p_printable({indent="  ",indentlevel=0, maxindent=9}={}) {
        // Output something that can be displayed for debugging
        return `${indent.repeat(indentlevel)}${this.name} @ ${this.tablepublicurls.join(', ')}${this.expires ? " expires:"+this.expires : ""}\n`
            + ((indentlevel >= maxindent) ? "..." : (await Promise.all((await this.p_keys()).map(k => this._map[k].p_printable({indent, indentlevel: indentlevel + 1, maxindent: maxindent})))).join(''))
    }
    static async p_setupOnce() {
        //const metadatagateway = 'http://localhost:4244/leaf/archiveid';
        //const metadataGateway = 'https://dweb.me/leaf/archiveid';
        const metadataGateway = 'https://dweb.archive.org/leaf';
        //TODO-NAMING change passphrases to something secret, figure out what need to change
        const pass1 = "all knowledge for all time to everyone for free"; // TODO-NAMING make something secret
        const pass2 = "Replace this with something secret"; // Base for other keys during testing - TODO-NAMING replace with keygen: true so noone knows private key
        const archiveadminkc = await KeyChain.p_new({name: "Archive.org Admin"}, {passphrase: "Archive.org Admin/" + pass1});  // << THis is what you login as
        //const archiveadminacl = await AccessControlList.p_new({name: "Archive.org Administrators", _acl: archiveadminkc}, true, {keygen: true}, {}, archiveadminkc);  //data, master, key, options, kc
        //const archiveadminkey = new KeyPair({name: "Archive.org Admin", key: {keygen: true}, _acl: archiveadminkc} );
        //await archiveadminkc.p_push(archiveadminkey);
        //await archiveadminacl.p_add_acle(archiveadminkey, {name: "Archive.org Admin"} );

        /* SECURITY DOCS
            archiveadminkc is the keychain owned by the Archive Administrator (who logs in with its ID/passphrase)
            Each domain has a random private key (for now I've used a passphase to generate them so that tests dont rebuild data structures)
            / /arc /arc/archive.org /arc/archive.org/metadata domains have _acl=archiveadminkc so only Archive Admin can see the private key which is needed to register


        */
        //TODO-NAME add ipfs address and ideally ipns address to archiveOrgDetails record
        //p_new should add registrars at whichever compliant transports are connected (YJS, HTTP)
        Domain.root = await Domain.p_new({_acl: archiveadminkc, name: "/", keychain: archiveadminkc}, true, {passphrase: pass2+"/"}, [], {   //TODO-NAME will need a secure root key and a way to load here securely
            arc: await Domain.p_new({_acl: archiveadminkc, keychain: archiveadminkc},true, {passphrase: pass2+"/arc"}, [], { // /arc domain points at our top level resolver.
                "archive.org": await Domain.p_new({_acl: archiveadminkc, keychain: archiveadminkc}, true, {passphrase: pass2+"/arc/archive.org"}, [], {
                    ".": await Leaf.p_new({urls: ["https://dweb.me/archive/archive.html"], mimetype: "text/html",
                        metadata: {htmlusesrelativeurls: true}}, {}),
                    "about": await Leaf.p_new({urls: ["https://archive.org/about/"], metadata: {htmlpath: "/" }}, {}),
                    //TODO-ARC change these once dweb.me fixed
                    "details": await Leaf.p_new({urls: ["https://dweb.me/archive/archive.html"], mimetype: "text/html",
                        metadata: {htmlusesrelativeurls: true, htmlpath: "item"}},[], {}),
                    "examples": await Leaf.p_new({urls: ["https://dweb.me/archive/examples/"], metadata: {htmlpath: "/" }}, {}),
                    "images": await Leaf.p_new({urls: ["https://dweb.me/archive/images/"], metadata: {htmlpath: "/" }}, {}),
                    "serve": await Leaf.p_new({urls: ["https://dweb.archive.org/download/"], metadata: {htmlpath: "/" }}, {}), // Example is in commute.description
                    //"metadata": await Domain.p_new({_acl: archiveadminkc, keychain: archiveadminkc}, true, {passphrase: pass2+"/arc/archive.org/metadata"}, [metadataGateway], {}),
                    "metadata": await Leaf.p_new({urls: ["gun:/gun/arc/archive.org/metadata/", "https://dweb.archive.org/metadata/"], metadata: {htmlpath: "/" }}, {}),
                    //"metadata": await Leaf.p_new({urls: ["gun:/gun/arc/archive.org/metadata/"], metadata: {htmlpath: "/" }}, {}),  //TODO-GUN See hack - where - to use temp?
                    "search.php": await Leaf.p_new({urls: ["https://dweb.me/archive/archive.html"], mimetype: "text/html",
                        metadata: {htmlusesrelativeurls: true, htmlpath: "query"}}, {}),
                    "search": await Leaf.p_new({urls: ["https://dweb.me/archive/archive.html"], mimetype: "text/html",
                        metadata: {htmlusesrelativeurls: true, htmlpath: "query"}}, {})
                    //Note I was seeing a lock error here, but cant repeat now - commenting out one of these last two lines seemed to clear it.
                })
            }),
            ipfs: await Leaf.p_new({urls: ["http://ipfs.io/ipfs/", "https://dweb.me/ipfs/"],  metadata: {htmlpath: "/" }}, {}),
            //TODO-IPFS, running into problems as of 22Jul2018 with files.cat, so skipping direct ipfs load till figure out.
            //ipfs: await Leaf.p_new({urls: ["ipfs:/ipfs/", "http://ipfs.io/ipfs/", "https://dweb.me/ipfs/"],  metadata: {htmlpath: "/" }}, {}),
        }); //root
        const testing = Domain.root.tablepublicurls.map(u => u.includes("localhost")).includes(true);
        if (JSON.stringify(Domain.root._publicurls) === JSON.stringify(rootSetPublicUrls)) {
            console.log("root urls havent changed");
        } else {
            console.log(testing ? "publicurls for testing" : "Put these Domain.root public urls in const rootSetPublicUrls", Domain.root._publicurls);
        }
        const metadatatableurls = Domain.root._map["arc"]._map["archive.org"]._map["metadata"].tablepublicurls
        const metadatatableurl = metadatatableurls ? metadatatableurls.find(u=>u.includes("getall/table")) : undefined;
        if (metadatatableurl && !testing) {
            console.log("Put this in gateway config.py config.domains.metadata:", metadatatableurl);
        }
        debugdomain(await this.root.p_printable());
    }

    static async p_resolveNames(name) {
        /* Turn an array of urls into another array, resolving any names if possible and leaving other URLs untouched
        /* Try and resolve a name,
        name:   One, or an array of Names of the form dweb:/ especially dweb:/arc/archive.org/foo
        resolves to:    [ url ]  Array of urls which will be empty if not resolved (which is quite likely if relative name not defined)
        */
        if (Array.isArray(name)) {
            // Note can't use "this" in here, as since its passed as a callback to DwebTransports, "this" is DwebTransports
            return [].concat(...await Promise.all(name.map(u => u.startsWith("dweb:/arc") ? Domain.p_resolveNames(u) : [u])))
        } else {
            name = name.replace("dweb:/", ""); // Strip leading dweb:/ before resolving in root
            const res = await Domain.p_rootResolve(name);     // [ Leaf object, remainder ] //TODO-NAME see comments in p_rootResolve about FAKEFAKEFAKE
            //if (!(res[0] && (res[0].name === name.split('/').splice(-1)[0]) && !res[1])) {   // checks /aaa/bbb/ccc resolved to something with name=ccc and no remainder
            if (!(res[0] && !res[1])) {   // checks /aaa/bbb/ccc resolved to something with name=ccc and no remainder
                return [];  // No urls
            } else {
                return res[0].urls;
            }
        }
    }
    privateFromKeyChain() {
        /* Look in the logged in user's keychains to see if have the private version of this domain, in which case can work on it
        returns:    undefined or Domain
         */
        return KeyChain.find_in_keychains({tablepublicurls: this.tablepublicurls})
    }
    static async p_test() {
        console.log("KeyValueTable testing starting");
        try {
            const pass = "Testing pass phrase";
            //Register the toplevel domain
            // Set mnemonic to value that generates seed "01234567890123456789012345678901"
            const mnemonic = "coral maze mimic half fat breeze thought champion couple muscle snack heavy gloom orchard tooth alert cram often ask hockey inform broken school cotton"; // 32 byte
            const kc = await KeyChain.p_new({name: "test_keychain kc"}, {mnemonic: mnemonic});    //Note in KEYCHAIN 4 we recreate exactly same way.
            Domain.root = await Domain.p_new({
                name: "",   // Root is "" so that [name,name].join('/' is consistent for next level.
                keys: [],
                signatures: [],    // TODO-NAME Root record itself needs signing - but by who (maybe /arc etc)
                expires: undefined,
                _acl: kc,
                _map: undefined,   // May need to define this as an empty KVT
            }, true, {passphrase: pass+"/"});   //TODO-NAME will need a secure root key
            //Now register a subdomain
            const testingtoplevel = await Domain.p_new({_acl: kc}, true, {passphrase: pass+"/testingtoplevel"});
            await Domain.root.p_register("testingtoplevel", testingtoplevel);
            const adomain = await Domain.p_new({_acl: kc}, true, {passphrase: pass+"/testingtoplevel/adomain"});
            await testingtoplevel.p_register("adomain", adomain);
            const item1 = await new SmartDict({"name": "My name", "birthdate": "2001-01-01"}).p_store();
            await adomain.p_register("item1", item1);
            // Now try resolving on a client - i.e. without the Domain.root privte keys
            const ClientDomainRoot = await SmartDict.p_fetch(Domain.root._publicurls);
            let res= await ClientDomainRoot.p_resolve('testingtoplevel/adomain/item1');
            console.log("Resolved to",await res[0].p_printable({maxindent:2}),res[1]);
            console.assert(res[0].urls[0] === item1._urls[0]);
            // Now some failure cases / errors
            console.log("-Expect unable to completely resolve");
            res= await Domain.root.p_resolve('testingtoplevel/adomain/itemxx');
            console.assert(typeof res[0] === "undefined");
            console.log("-Expect unable to completely resolve");
            res= await Domain.root.p_resolve('testingtoplevel/adomainxx/item1');
            console.assert(typeof res[0] === "undefined");
            console.log("-Expect unable to completely resolve");
            res= await Domain.root.p_resolve('testingtoplevelxx/adomain/item1');
            console.assert(typeof res[0] === "undefined");
            console.log("Structure of registrations");
            console.log(await Domain.root.p_printable());
            // Commented out as should run under setup.js with correct transports
            // await this.p_setupOnce();

            /* Dont expect this to quite work now not doing setupOnce in above test
            console.log("Next line should attempt to find in metadata table *YJS or HTTP) then try leaf/archiveid?key=commute");
            let itemid = "commute";
            let name = `arc/archive.org/metadata/${itemid}`;
            res = await Domain.root.p_resolve(name);
            //TODO-NAME note p_resolve is faking signature verification on FAKEFAKEFAKE - will also need to error check that which currently causes exception
            console.assert(res[0].name === "/"+name);
            console.log("Resolved",name,"to",await res[0].p_printable({maxindent:2}), res[1]);
            let metadata = await DwebTransports.p_rawfetch(res[0].urls); // Using Block as its multiurl and might not be HTTP urls
            console.log("Retrieved metadata",JSON.stringify(metadata));
            console.log("---Expect failure to resolve 'arc/archive.org/details/commute'");
            console.assert(metadata.metadata.identifier === itemid);
            //TODO-NAME dont think next will work.
            try { //TODO-NAME will need to figure out what want this to do
                res = await Domain.root.p_resolve("arc/archive.org/details/commute");
                console.log("resolved to",await res[0].p_printable({maxindent:2}), res[1] ? `Remainder=${res[1]}`: "");
            } catch(err) {
                console.log("Got error",err);
            }
            console.log('------');
            */

        } catch (err) {
            console.log("Caught exception in Domain.test", err);
            throw(err)
        }
    }
    static async p_test_gateway(opts={}) {
        // Has to be tested against the gateway, not localhost
        console.log("Domain.p_test_gateway");
        try {
            Domain.root = undefined; // Clear out test root
            console.log("NAMES connected");
            let res = await this.p_resolveNames(["dweb:/arc/archive.org/metadata/commute"]);
            //console.assert(res.includes("https://dweb.me/metadata/archiveid/commute"))
            console.assert(res.includes("https://dweb.archive.org/metadata/commute"));
        } catch(err) {
            console.log("Exception thrown in Domain.p_test_gateway:", err.message);
            throw err;
        }
    }

    static async p_resolveAndBoot(name, {opentarget="_self", search_supplied=undefined, openChromeTab=undefined}={}) {
        /*
        Utility function for bootloader.html
        Try and resolve a name, if get a Leaf then boot it, if get another domain then try and resolve the "." and boot that.
        search_supplied: Anything supplied in after the ? in the original URL, should be added to the search string
        opentarget:      Where to open the file, defaults to "_self"
        throws:          Error if cant resolve to a Leaf, or Error from loading the Leaf

        TODO - are there any cases where want to try multiple names -dont think so
         */
        let nameandsearch = name.split('?');
        name = nameandsearch[0];
        if (nameandsearch.length) search_supplied = nameandsearch[1];
        let res = await this.p_rootResolve(name);
        let resolution = res[0];    // Will be a Leaf or a Domain
        let remainder = res[1];
        if (resolution instanceof Leaf) {
            await resolution.p_boot({remainder, search_supplied, opentarget, openChromeTab}); // Throws error if fails
        } else if ((resolution instanceof Domain) && (!remainder)) {
            res = await resolution.p_resolve(".");
            resolution = res[0];
            remainder = res[1];
            if (resolution instanceof Leaf) {
                await resolution.p_boot({remainder, search_supplied, opentarget, openChromeTab}); // Throws error if fails
            } else {
                // noinspection ExceptionCaughtLocallyJS
                throw new Error("Path resolves to a Domain even after looking at '.'");
            }
        }
    }

}
NameMixin.call(Domain.prototype);   // Add in the Mixin
SignatureMixin.call(Domain.prototype, ["tablepublicurls", "name", "keys", "expires"]);

Domain.clsLeaf = Leaf;  // Just So exports can find it and load into Dweb TODO move to own file
SmartDict.table2class["domain"] = Domain;
DwebTransports.resolveNamesWith(Domain.p_resolveNames); // Note this won't work if tried in Client to a Service Worker, must be in same thread as Transport
exports = module.exports = Domain;
