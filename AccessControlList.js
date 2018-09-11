const errors = require('./Errors');
const CommonList = require("./CommonList"); // AccessControlList extends this
const SmartDict = require("./SmartDict");   // _AccessControlListEntry extends this
const KeyPair = require('./KeyPair'); // Encapsulate public/private key pairs and crypto libraries
const KeyChain = require('./KeyChain'); // Hold a set of keys, and locked objects
const utils = require('./utils'); // Utility functions
const debugacl = require('debug')('dweb-objects:acl');

class AccessControlList extends CommonList {
    /*
    An AccessControlList is a list for each control domain, with the entries being who has access.

    To create a list, it just requires a key pair, like any other List

    Fields:
    accesskey:  Secret key with which things are encrypted. We are controlling who gets this.
    publickey:  Export of public key
    _list: Contains a list of signatures, each for a SmartDict each of which is:
        viewer: public URLs of the KeyPair of an authorised viewer
        token:  accesskey encrypted with PublicKey from the KeyPair
        name:   Name of this token
    Inherits from PublicPrivate: _master, _publicurls, _allowunsafestore, dontstoremaster, _listerners; and from CommonList: _list, and from SmartDict: _acl. _urls


    */

    constructor(data, options) {
        /*
        Create a new AccessControlList - see CommonList for parameters
         */
        super(data, options);
        if (this._master && !this.accesskey) {
            this.accesskey = KeyPair.b64enc(KeyPair.randomkey());
        }
        this.table = "acl";
    }

    static async p_new(data, master, key, options, kc) {
        /*
            Create a new AccessControlList, store, add to keychain

            :param data,master,key,options: see new CommonList
            :param kc: Optional KeyChain to add to
         */
        debugacl("Creating new")
        let acl = await super.p_new(data, master, key); // Calls CommonList.p_new -> new ACL() -> new CL() and then CL.p_new sets listurls and listpublicurls
        if (master) {
            kc = kc || KeyChain.default();    // Use default KeyChain (most recent)
            if (kc) {
                await kc.p_push(acl); // sig
            } else {
                await acl.p_store(); // Ensure stored even if not put on KeyChain
            }
        }
        return acl;
    }
    preflight(dd) {
        /*
        Prepare data for storage, ensure publickey available

        :param dd: dict containing data preparing for storage (from subclass)
        :returns: dict ready for storage if not modified by subclass
         */
        if ((!this._master) && this.keypair._key.sign.publicKey) {
            dd["publickey"] = dd.publickey || dd.keypair.publicexport();   // Store publickey for verification
        }
        if (!dd._master)  delete dd.accesskey;   // Dont store the accesskey on the public version
        // Super has to come after above as overrights keypair, also cant put in CommonList as MB's dont have a publickey and are only used for signing, not encryption
        return super.preflight(dd);
    }

    async p_add_acle(viewerpublicurls, data) {
        /*
        Add a new ACL entry - that gives a viewer the ability to see the accesskey of this URL

        :param viewerpublicurls: KeyPair object (contains a publickey) or array of urls of that publickey
        :data other fields to store on ACLE - currently only supports name, but could support any field
        :resolves to: this for chaining
        :throws ForbiddenError if not master
        */
        try {
            debugacl("Adding %o to %s", viewerpublicurls, this._name());
            if (viewerpublicurls instanceof KeyPair) viewerpublicurls = viewerpublicurls._publicurls;
            if (!this._master) throw new errors.ForbiddenError("ACL.p_add_acle: Cannot add viewers to a public copy of an ACL");
            if (!(viewerpublicurls && viewerpublicurls.length)) throw new errors.CodingError("ACL.p_add_acle: Cant add empty viewerpublicurls");
            let viewerpublickeypair = await SmartDict.p_fetch(viewerpublicurls); // Fetch the public key will be KeyPair
            // Create a new ACLE with access key, encrypted by publickey
            let acle = new SmartDict({
                //Need to go B64->binary->encrypt->B64
                "token": viewerpublickeypair.encrypt(KeyPair.b64dec(this.accesskey), true, this),
                "viewer": viewerpublicurls,
                "name": data["name"]
            }); //data
            await this.p_push(acle);   // Throws ForbiddenError if not master
            return acle;
        } catch (err) { // ForbiddenError from p_push if not master; not sure what else.
            console.log("Error caught in ACL.p_add_acle",err.message);
            throw err;
        }
    }

    async p_tokens() { //TODO-BACKPORT
        /*
        Return the list of tokens on this ACL. Side effect of loading data on each Signature in this._list
        resolves to: [ SmartDict{token:, viewer:, name: }, ... ]
         */
        return this.p_list_then_elements();      // Trivial
    }
    _findtokens(viewerkeypair, decrypt) {
        /*
        Find the entries, if any, in the ACL for a specific viewer
        There might be more than one if either the accesskey changed or the person was added multiple times.
        Entries are SmartDict with token being the decryptable accesskey we want
        The ACL should have been p_tokens() before so that this can run synchronously.

        :param viewerkeypair:  KeyPair of viewer
        :param decrypt: If should decrypt the
        :return:    Array of encrypted tokens (strings) or array of uint8Array
        :throws:    CodingError if not yet fetched
        */

        debugacl(`ACL._findtokens (decrypt=${decrypt} looking for tokens in ${this._publicurls}, matching viewerkeypair=`,viewerkeypair);
        const viewerurls = viewerkeypair._publicurls; // Note this was erroneously _url, has to be _publicurls as cant store the private url on a ACL as person setting up ACL doesn't know it
        if (! this._list.length) { return []}
        let toks = this._list
            .filter((sig) => utils.intersects(sig.data.viewer, viewerurls))    // Find any sigs that match this viewerurl - should be decryptable, note handles potentially different lists of urls
            .map((sig) => sig.data.token);
        if (decrypt) {  // If requested, decrypt each of them
            toks = toks.map((tok) => viewerkeypair.decrypt(tok, this, "uint8array"));
        }
        debugacl(`ACL._findtokens found ${toks.length}`);
        return toks;
    }

    encrypt(data, b64) {
        /*
        Encrypt some data based on the accesskey of this list.

        :param data: string - data to be encrypted
        :param b64: true if want result as urlbase64 string, otherwise string
        :return: string, possibly encoded in urlsafebase64
        :throws: CodingError if this.accesskey not set
         */
        if (!this.accesskey) {
            console.log("ACL.encrypt no accesskey, prob Public",this);
            throw new errors.EncryptionError("ACL.encrypt needs an access key - is this a Public _acl?")
        }
        return KeyPair.sym_encrypt(data, this.accesskey, b64); };  //CodingError if accesskey not set

    decrypt(data) {
        /*
            Decrypt data for a viewer.
            Chain is SD.p_fetch > SD.p_decryptdata > ACL|KC.decrypt, then SD.setdata

            :param data: string from json of encrypted data - b64 encrypted
            :return:                Decrypted data
            :throw:                 AuthenticationError if there are no tokens for our ViewerKeyPair that can decrypt the data
        */
        let vks = KeyChain.mykeys(KeyPair); // Get a list of all my keys (across all the KeyChains)
        if (!Array.isArray(vks)) { vks = [ vks ]; } // Convert singular key into an array
        for (let vk of vks) { // Loop over all our keys  //TODO-ACLDICT
            let accesskeys = this._findtokens(vk, true); // Find any tokens in ACL for this KeyPair and decrypt to get accesskey (maybe empty)
            for (let accesskey of accesskeys) { // Try each of these keys
                try {   // If can decrypt then return the data
                    return KeyPair.sym_decrypt(data, accesskey, "text"); //data. symkey #Exception DecryptionFail
                } catch(err) { //TODO Should really only catch DecryptionFailError, but presume not experiencing other errors
                    //do nothing,
                }
            }
        }
        // If drop out of nested loop then there was no token for our ViewerKey that contained a accesskey that can decrypt the data
        throw new errors.AuthenticationError("ACL.decrypt: No valid keys found");
    };

    static async p_decryptdata(value) {
        /*
         Takes a dict,
         checks if encrypted (by presence of "encrypted" field, and returns immediately if not
         Otherwise if can find the ACL's url in our keychains then decrypt with it (it will be a KeyChain, not a ACL in that case.
         Else returns a promise that resolves to the data
         No assumption is made about what is in the decrypted data

         Chain is SD.p_fetch > SD.p_decryptdata > ACL.p_decrypt > ACL|KC.decrypt, then SD.setdata

         :param value: object from parsing incoming JSON that may contain {acl, encrypted} acl will be url of AccessControlList or KeyChain
         :return: data or promise that resolves to data
         :throws: AuthenticationError if cannot decrypt
         */
        try {
            if (!value.encrypted) {
                return value;
            } else {
                debugacl("ACL.p_decryptdata of: %o",value);
                let aclurls = value.acl;
                // First check is one of our own objects (encrypted with one of our keychains) rather thn encrypted with one of our keys
                let decryptor = KeyChain.keychains_find({_publicurls: aclurls});  // Matching KeyChain or None
                if (!decryptor) {
                    // TODO-AUTHENTICATION probably add person - to - person version encrypted with receivers Pub Key
                    debugacl("ACL.p_decryptdata: Looking for our own ACL: %o",aclurls);
                    decryptor = KeyChain.mykeys(AccessControlList).find((acl) => acl.match({_publicurls: aclurls}));  // Returns undefined if none match or keychains is empty, else first match
                    debugacl("ACL.p_decryptdata: fetching ACL: %o",aclurls);
                    if (!decryptor) {
                        decryptor = await SmartDict.p_fetch(aclurls); // Will be AccessControlList
                        debugacl("ACL.p_decryptdata: fetched ACL: %o", decryptor);
                        if (decryptor instanceof KeyChain) {
                            debugacl(`ACL.p_decryptdata: encrypted with KC name=${decryptor.name}, but not logged in`);
                            // noinspection ExceptionCaughtLocallyJS
                            throw new errors.AuthenticationError(`Must be logged in as ${decryptor.name}`);
                        }
                    }
                    debugacl("ACL.p_decryptdata: fetching ACL tokens");
                    await decryptor.p_tokens(); // Will load blocks in sig as well
                    debugacl("ACL.p_decryptdata: fetched ACL tokens for %o %o",decryptor._publicurls, decryptor._list.map((sig) => sig.data) );
                }
                let decrypted = JSON.parse(decryptor.decrypt(value.encrypted));  // Resolves to data or throws AuthentictionError
                if (!decrypted._acl) decrypted._acl = decryptor;    // Save the _acl used for encryption in case write it back TODO not sure we can encrypt it back
                return decrypted;
            }
        } catch(err) {
            console.log("Unable to decrypt:", value, err);
            throw(err);
        }
    }
    objbrowser_fields(propname) {
        let fieldtypes = { accesskey: "str", "publickey": "str"}
        return fieldtypes[propname] || super.objbrowser_fields(propname);
    }

    static async p_test() { //TODO-BACKPORT - copy into Python/test_client
        // Test ACL - note creates and returns a ACL suitable for other tests
        debugacl("AccessControlList.p_test");
        try {
            debugacl("Creating AccessControlList");
            // Create a acl for testing, - full breakout is in test_keychain
            let accesskey = KeyPair.randomkey();
            let aclseed = "01234567890123456789012345678902";    // Note seed with 01 at end used in mnemonic faking
            let keypair = new KeyPair({key: "NACL SEED:" + KeyPair.b64enc(new Buffer(aclseed))});
            //ACL(data, master, keypair, keygen, mnemonic, options)
            let acl = await this.p_new({
                accesskey: KeyPair.b64enc(accesskey),
                _allowunsafestore: true  // Not setting _acl on this
            }, true, keypair, {});
            debugacl("Creating AccessControlList url= %o", acl._urls);
            return {acl: acl};
        } catch(err) {
            console.log("Error in AccessControlList.p_test", err);   // Log since maybe "unhandled" if just throw
            throw err;
        }
    }

}
SmartDict.decryptwith((data) => AccessControlList.p_decryptdata(data));   // Enable decryption immediately at Transportation
SmartDict.table2class["acl"] = AccessControlList;

exports = module.exports = AccessControlList;


