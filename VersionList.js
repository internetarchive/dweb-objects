const debugvl = require('debug')('dweb-objects:versionlist');
const SmartDict = require("./SmartDict");   // _AccessControlListEntry extends this
const CommonList = require("./CommonList"); // VersionList extends this
const KeyChain = require('./KeyChain'); // Hold a set of keys, and locked objects

class VersionList extends CommonList {
    /*
    Superclass for any kind of Version List, though in many cases will be able to use this directly.

    Fields:
    contentacl: ACL that should be used to lock content
    _working:   Version currently working on


    Inherited Fields worth commenting on:
    _acl:       Typically will be set to prevent access to the VersionList itself
    _list:      List of versions, last on list should be the current version
     */

    constructor(data, options) {
        /*
        :param data: Data to initialize to - usually {name, contentacl, _acl}
        :param master: true if should be master (false when loaded from Dweb)
         */
        super(data, options);
        this.table = "vl";
    }

    static async p_expanddata(data) {
        /*
        Prior to initializing data, expand any URLs in known fields (esp contentacl)

        data:   data to initialize to, but may contain url in contentacl field
        resolves to: expanded data
         */
        try {
            if (data.contentacl) {
                if (typeof data.contentacl === "string") data.contentacl = [data.contentacl];
                if (Array.isArray(data.contentacl)) data.contentacl = await SmartDict.p_fetch(data.contentacl); // THis is the one that gets "Must be logged in as Mary Smith"
            }
        } catch(err) {
                console.warn("Unable to expand data in p_expanddata",err);
        }
    }

    static async p_new(data, master, key, firstinstance) {
        /*
        Create a new instance of VersionList, store it, initialize _working and add to KeyChain:
        _acl will be default KeyChain if not specified


        data, master, key    see expanddata
        firstinstance   instance used for initialization, will be copied for each version.
        resolves to:    new instance of VersionList (note since static, it cant make subclasses)
         */
        if (!data.acl) data._acl = KeyChain.default();
        debugvl("VL.p_new data=%o",data);
        await VersionList.p_expanddata(data);  // Expands _contentacl url
        let vl = await super.p_new(data, master, key); // Calls CommonList.p_new -> new VL() -> new CL() and then sets listurls and listpublicurls
        await vl.p_store();
        if (data._acl)  // If logged in (normally the case, but not when testing or some special cases)
            await data._acl.p_push(vl);    // Store on the KeyChain so can find again
        vl._working = firstinstance;
        vl._working["_acl"] = vl.contentacl;
        return vl;
    }

    async p_saveversion() {
        /*
            Update the content edited i.e. sign a copy and store on the list, then make a new copy to work with. Triggered by Save.
            resolves to: Signature of saved version
         */
        let sig = await this.p_push(this._working);
        this._working = this._working.copy();
        return sig;             // New copy to work with, should copy _acl as well.
    }

    async p_restoreversion(sig) {
        /*
            Go back to version from a specific sig
            sig:    Signature to go back to
         */
        await sig.p_fetchdata(); // Get data - we won't necessarily have fetched it, since it could be large.
        this._working = sig.data.copy();
    }
    async p_fetchlistandworking() {
        /*
        Fetch the list of versions, and get the data for the most recent one (explicitly doesnt fetch data of earlier versions)
         */
        await this.p_fetchlist();    // Get the list
        if (this._list.length) { // There was some data
            this._working = await this._list[this._list.length - 1].p_fetchdata();    // Find last sig, fetch the data
        }
    }

    preflight(dd) {
        /*
        Prepare data for storage, doesnt store private URL of contentacl in public (!master) version

        :param dd: dict containing data preparing for storage (from subclass)
        :returns: dict ready for storage if not modified by subclass
         */
        if (!this._master) {
            delete dd.contentacl;   // Contentacl is the private ACL, no need to send at all
        }
        return super.preflight(dd); //CL preservers _master and _publicurls and listpublicurls
    }


    static async test() {
        console.log("VersionList.test starting");
        try {
            //(data, master, key, options
            let vl1 = await this.p_new({_allowunsafestore: true}, true, {passphrase: "This is a test this is only a test of VersionList"},
                    new SmartDict({textfield: "This is some content"}));
            await vl1.p_fetchlistandworking();
            let siglength = vl1._list.length; // Will check for size below
            await vl1.p_saveversion();
            //console.log("VL.test after saveversion=",vl1);
            console.assert(vl1._list.length === siglength+1);
            let vl2 = await SmartDict.p_fetch(vl1._publicurls);
            await vl2.p_fetchlistandworking();
            console.assert(vl2._list.length === siglength+1, "Expect list",siglength+1,"got",vl2._list.length);
            console.assert(vl2._working.textfield === vl1._working.textfield, "Should have retrieved");
            //await vl2.p_path(["langs", "readme.md"], ["p_elem", "myList.1",])) //TODO-PATH need a path based test
        } catch (err) {
            console.log("Caught exception in VersionList.test", err);
            throw(err)
        }
    }
}

SmartDict.table2class["vl"] = VersionList;

exports = module.exports = VersionList;
