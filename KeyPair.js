const errors = require('./Errors');
const sodium = require("libsodium-wrappers");
const debugkeypair = require('debug')('dweb-objects:keypair');
const SmartDict = require("./SmartDict");
const utils = require('./utils'); // Utility functions
//const crypto = require('crypto'); // Needed to do a simple sha256 which doesnt appear to be in libsodium
const shajs = require('sha.js');
//Buffer seems to be built in, require('Buffer') actually breaks things
const multihashes = require('multihashes');


class KeyPair extends SmartDict {
    /*
    Encapsulates public key cryptography

    Constants:
    KeyPair.KEYTYPESIGN=1, KEYTYPEENCRYPT=2, KEYTYPESIGNANDENCRYPT=3  specify which type of key to generate

    Libsodium implementation: Note that Uint8Array is the result of converting UrlSafeBase64 with sodium.to_urlsafebase64

    Fields:
    _publicurls: list of urls holding public version
    _key = {
        sign: { publicKey: Uint8Array, privateKey: Uint8Array, keyType: "ed25519" }
        encrypt: { publicKey: Uint8Array, privateKey: Uint8Array},
        seed: Uint8Array,
    }
     */

    constructor(data, options) {
        /*
        Create a new KeyPair

        :param data: Data to initialize with (see Fields above)
         */
        super(data, options);    // SmartDict takes data=json or dict
        if (!this._publicurls) this._publicurls = [];   // Initialize to empty array if not restored with data (which will happen if its master that was previously stored)
        this.table = "kp";
    }

    __setattr__(name, value) {
        /*
         Subclasses SmartDict.__setattr__ to import "key"

         :param name:   String - name of field to set, if "key" then imports, else to SmartDict.__setattr__
         :param value:  Any - stored in field, for key can be urlsafebase64 string, or Uint8Array, or dict in libsodium format above.
        #Backported to PY 20180703
         */
        if (name === "key") {
            this._key_setter(value);
        } else if (name === "private") {
            throw new errors.ToBeImplementedError("Undefined functionality KeyPair.private.setter");
        } else if (name === "public") {
            throw new errors.ToBeImplementedError("Undefined functionality KeyPair.public.setter");
        } else {
            super.__setattr__(name, value);
        }
    }

    _key_setter(value) {
        /*
        Set a key, convert formats or generate key if required.

        value:  Dictionary in local format, or Uint8Array or urlsafebase64 string {
            mnemonic: BIP39 style mnemonic (currently unsupported except one fake test case
            passphrase: A phrase to hash to get a seed
            keygen:     true to generate a new key
            seed:       32 byte string or buffer
        #Backported to PY 20180703
         */
        debugkeypair("KP._key_setter");
        if (typeof value === "string" || Array.isArray(value)) {
            this._importkey(value);
        } else {    // Should be object, or maybe undefined ?
            if (typeof value === "object") {
                if (value.mnemonic) {
                    if (value.mnemonic === "coral maze mimic half fat breeze thought champion couple muscle snack heavy gloom orchard tooth alert cram often ask hockey inform broken school cotton") { // 32 byte
                        value.seed = "01234567890123456789012345678901";  // Note this is seed from mnemonic above
                        console.log("Faking mnemonic encoding for now")
                    } else {
                        throw new errors.ToBeImplementedError("MNEMONIC STILL TO BE IMPLEMENTED");    //TODO-mnemonic
                    }
                }
                if (value.passphrase) {
                    let pp = value.passphrase;
                    for (let i = 0; i<100; i++) {
                        pp = KeyPair.sha256(pp); // Its write length for seed = i.e. 32 bytes
                    }
                    value.seed = pp;
                }
                if (value.keygen) {
                    value.seed = sodium.randombytes_buf(sodium.crypto_box_SEEDBYTES);
                    delete value.keygen;
                }
                if (value.seed) {
                    value = KeyPair._keyfromseed(value.seed, KeyPair.KEYTYPESIGNANDENCRYPT);
                }
            }
            this._key = value;
        }
    }

    storedpublic() {
        /*
        Check if the public version of this object has been stored (i.e. public keys etc)
        returns:   true if the public version is stored (i.e. _publicurls is set)
         */
        return this._publicurls.length || ! KeyPair._key_has_private(this._key)
    }

    async p_store() {
        /*
        Store public and private versions of this object if not already stored
         */
        if (super.stored())
            return; // Already stored
        if (!this.storedpublic()) { // Haven't stored a public version yet
            await this._p_storepublic();
        }
        return super.p_store()
    }

    async _p_storepublic() {
        /*
        // Store public version, dont encrypt on storing as want public part to be publicly visible
          */
        let oo = Object.assign({}, this); // Copy obj
        delete oo._key;
        delete oo._acl; // Dont secure public key
        oo.key = this.publicexport();    //Copy key except for use public version instead of private
        let ee = new this.constructor(oo);
        //TODO change to use the getdata pattern from other classes instead of "new"
        // This will require preflight being changed to notice that _master has been set to false if publicOnly=true (_getdata will delete _acl)
        // this._publicurls = await DwebTransports.p_rawstore( this._getdata({publicOnly: true, encryptIfAcl:false}));
        await ee.p_store();
        this._publicurls = ee._urls;
    }

    preflight(dd) {
        /*
        Subclasses SmartDict.preflight, checks not exporting unencrypted private keys, and exports private or public.

        :param dd: dict of fields, maybe processed by subclass
        :returns: dict of fields suitable for storing in Dweb
         */
        if (KeyPair._key_has_private(dd._key) && !dd._acl && !this._allowunsafestore) {
            throw new errors.SecurityWarning("Probably shouldnt be storing private key" + JSON.stringify(dd));
        }
        if (dd._key) { //Based on whether the CommonList is master, rather than if the key is (key could be master, and CL not)
            dd.key = KeyPair._key_has_private(dd._key) ? this.privateexport() : this.publicexport();
        }
        // This code copied from CommonList
        let publicurls = dd._publicurls; // Save before preflight super
        let master = KeyPair._key_has_private(dd._key);
        dd = super.preflight(dd);  // Edits dd in place
        if (master) { // Only store on Master, on !Master will be None and override storing url as _publicurls
            dd._publicurls = publicurls;   // May be None, have to do this AFTER the super call as super filters out "_*"
        }
        return dd
    }

    static _keyfromseed(seed, keytype) {
        /*
        Generate a key from a seed,

        :param seed:    uint8array or binary string (not urlsafebase64) to generate key from
        :param keytype: One of KeyPair.KEYTYPExyz to specify type of key wanted
        :returns:       Dict suitable for storing in _key
         */
        //Backported to PY 20180703
        let key = {};
        if (sodium.crypto_box_SEEDBYTES !== seed.length) throw new errors.CodingError(`Seed should be ${sodium.crypto_box_SEEDBYTES}, but is ${seed.length}`);
        key.seed = seed;
        if (keytype === KeyPair.KEYTYPESIGN || keytype === KeyPair.KEYTYPESIGNANDENCRYPT) {
            key.sign = sodium.crypto_sign_seed_keypair(key.seed); // Object { publicKey: Uint8Array[32], privateKey: Uint8Array[64], keyType: "ed25519" }
        }
        if (keytype === KeyPair.KEYTYPEENCRYPT || keytype === KeyPair.KEYTYPESIGNANDENCRYPT) {
            key.encrypt = sodium.crypto_box_seed_keypair(key.seed); // Object { publicKey: Uint8Array[32], privateKey: Uint8Array[64] } <<maybe other keyType
            // note this doesnt have the keyType field
        }
        return key;
    }


    _importkey(value) {
        /*
        Import a key, sets fields of _key without disturbing any already set unless its SEED.

        :param value: "xyz:1234abc" where xyz is one of "NACL PUBLIC, NACL SEED, NACL VERIFY" and 1234bc is a ursafebase64 string
                    Note NACL PRIVATE, NACL SIGNING,  are not yet supported as "NACL SEED" is exported
         #Backported to PY 20180703
        */
        //First tackle standard formats created by exporting functionality on keys
        // Call route is ... data.setter > ...> key.setter > _importkey
        //TODO-BACKPORT - Note fingerprint different from Python - this stores the key, change the Python
        if (typeof value === "object") {    // Should be array, not dict
            value.map((k) => this._importkey(k));
        } else {
            let arr = value.split(':',2);
            let tag = arr[0];
            let hash = arr[1];
            let hasharr = sodium.from_urlsafebase64(hash);
            //See https://github.com/jedisct1/libsodium.js/issues/91 for issues
            if (!this._key) { this._key = {}}   // Only handles NACL style keys
            if (tag === "NACL PUBLIC")           { this._key["encrypt"] = {"publicKey": hasharr};
            } else if (tag === "NACL PRIVATE")   { throw new errors.ToBeImplementedError("_importkey: Cant (yet) import Private key "+value+" normally use SEED");
            } else if (tag === "NACL SIGNING")   { throw new errors.ToBeImplementedError("_importkey: Cant (yet) import Signing key "+value+" normally use SEED");
            } else if (tag === "NACL SEED")      { this._key = KeyPair._keyfromseed(hasharr, KeyPair.KEYTYPESIGNANDENCRYPT);
            } else if (tag === "NACL VERIFY")    { this._key["sign"] = {"publicKey": hasharr};
            } else { throw new errors.ToBeImplementedError("_importkey: Cant (yet) import "+value) }
        }
    }

    signingexport() {
        /* Useful to be able to export the signing key */
        return "NACL VERIFY:"+sodium.to_urlsafebase64(this._key.sign.publicKey)
    }
    publicexport() {    // TODO-BACKPORT probably change this on Python version as well
        /*
        :return: an array include one or more "NACL PUBLIC:abc123", or "NACL VERIFY:abc123" urlsafebase64 string.
         */
        let res = [];
        if (this._key.encrypt) { res.push("NACL PUBLIC:"+sodium.to_urlsafebase64(this._key.encrypt.publicKey)) }
        if (this._key.sign) { res.push(this.signingexport()) }
        return res;
    }
    verifyexportmultihashsha256_58() {
        // This is a pretty arbitrary export used for list addresses etc, it might be changed to the publickey allowing signature checking
        // but note that currently the server expects a base58 obj
        return  KeyPair.multihashsha256_58(this.signingexport())
    }

    mnemonic() { throw new errors.ToBeImplementedError("Undefined function KeyPair.mnemonic"); }

    privateexport() {
        /*
        :return: an array include one or more "NACL SEED:abc123" urlsafebase64 string.
         */
        //TODO-BACKPORT note this doesnt match the current Python implementation
        let key = this._key;
        if (key.seed) {
            return "NACL SEED:" + (typeof(key.seed) === "string" ? key.seed : sodium.to_urlsafebase64(key.seed));
        } else {
            throw new errors.ToBeImplementedError("Undefined function KeyPair.privateexport without seed", key);
            //TODO should export full set of keys prob as JSON
        }
    }

    static _key_has_private(key) {
        /*
        :return: true if the _key has a private version (or sign or encrypt or seed)
         */
        if ((key.encrypt && key.encrypt.privateKey) || (key.sign && key.sign.privateKey) || key.seed) { return true; }
        if ((key.encrypt && key.encrypt.publicKey) || (key.sign && key.sign.publicKey)) { return false; }
        console.log("_key_has_private doesnt recognize",key);
    }

    has_private() {
        /*
        :return: true if key has a private version (or sign or encrypt or seed)
         */
        return KeyPair._key_has_private(this._key)
    }
    encrypt(data, b64, signer) {
        /*
         Encrypt a string, the destination string has to include any information needed by decrypt, e.g. Nonce etc

         :param data:   String to encrypt
         :b64 bool:  true if want result encoded in urlsafebase64
         :signer AccessControlList or KeyPair: If want result signed (currently ignored for RSA, reqd for NACL)
         :return: str, binary encryption of data or urlsafebase64
         */
        // Assumes nacl.public.PrivateKey or nacl.signing.SigningKey
        if (!signer) {
            console.log("KP.encrypt no signer:", this);
            throw new errors.CodingError("Until PyNaCl bindings have secretbox we require a signer and have to add authentication");
            //box = nacl.public.Box(signer.keypair._key.encrypt.privateKey, self._key.encrypt.publicKey)
        }
        //return box.encrypt(data, encoder=(nacl.encoding.URLSafeBase64Encoder if b64 else nacl.encoding.RawEncoder))
        const nonce = sodium.randombytes_buf(sodium.crypto_box_NONCEBYTES);
        const ciphertext = sodium.crypto_box_easy(data, nonce, this._key.encrypt.publicKey, signer.keypair._key.encrypt.privateKey, "uint8array"); //(message, nonce, publicKey, secretKey, outputFormat)

        const combined = utils.mergeTypedArraysUnsafe(nonce, ciphertext);
        return b64 ? sodium.to_urlsafebase64(combined) : sodium.to_string(combined);
    }
    decrypt(data, signer, outputformat) {
        /*
         Decrypt date encrypted with encrypt (above)

         :param data:  urlsafebase64 or Uint8array, starting with nonce
         :param signer AccessControlList: If result was signed (currently ignored for RSA, reqd for NACL)
         :param outputformat: Compatible with LibSodium, typicall "text" to return a string
         :return: Data decrypted to outputformat
         :throws: EnryptionError if no encrypt.privateKey, CodingError if !data||!signer
        */
        if (!data)
            throw new errors.CodingError("KeyPair.decrypt: meaningless to decrypt undefined, null or empty strings");
        if (!signer)
            throw new errors.CodingError("Until libsodium-wrappers has secretbox we require a signer and have to add authentication");
        if (! this._key.encrypt.privateKey)
            throw new errors.EncryptionError("No private encryption key in" + JSON.stringify(this._key));
         // Note may need to convert data from unicode to str
         if (typeof(data) === "string") {   // If its a string turn into a Uint8Array
            data = sodium.from_urlsafebase64(data);
         }
         let nonce = data.slice(0,sodium.crypto_box_NONCEBYTES);
         data = data.slice(sodium.crypto_box_NONCEBYTES);
         return sodium.crypto_box_open_easy(data, nonce, signer.keypair._key.encrypt.publicKey, this._key.encrypt.privateKey, outputformat);
    }

    sign(signable) {
        /*
        Sign and date a url using public key function.
        Pair of "verify()"

        :param signable: A signable string
        :return: signature that can be verified with verify

        Backported to Python 20180703
        */
        if (!signable) throw new errors.CodingError("Needs signable");
        if (! this._key.sign.privateKey) {
            throw new errors.EncryptionError("Can't sign with out private key. Key =" + JSON.stringify(this._key));
        }
        let sig = sodium.crypto_sign_detached(signable, this._key.sign.privateKey, "urlsafebase64");
        //Can implement and uncomment next line if seeing problems verifying things that should verify ok - tests immediate verification
        this.verify(signable, sig);
        return sig;
    }

    verify(signable, urlb64sig) {
        /*
        Verify a signature generated by sign()

        :param date, url: date (ISO string) and url exactly as signed.
        :param urlb64sig: urlsafebase64 encoded signature

        Backported to Python 20180703
         */

        let sig = sodium.from_urlsafebase64(urlb64sig);
        let tested = sodium.crypto_sign_verify_detached(sig, signable, this._key.sign.publicKey);
        if (!tested) throw new errors.SigningError("Signature not verified");
        return true;
    }

    static b64dec(data) {
        /*
        Decode arbitrary data from b64

        :param data:    urlsafebase64 encoded string
        :returns:       Uint8Array suitable for passing to libsodium
        */
        return sodium.from_urlsafebase64(data);
    };
    static b64enc(data) {
        /*
        Encode arbitrary data into b64

        :param data:    Uint8Array (typically produced by libsodium)
        :returns:       string
        */
        return sodium.to_urlsafebase64(data); };

    static randomkey() {
        /*
         Generate a random key suitable for the secretbox function (symetric encoding/decoding) of libsodium
         :return:   Uint8Array[crypto_secretbox_KEYBYTES] containing random
         */
        return sodium.randombytes_buf(sodium.crypto_secretbox_KEYBYTES);
    };

    static sym_encrypt(data, sym_key, b64) {
        /*
        Decrypt data based on a symetric key

        :param data:    arbitrary string
        :param sym_key: symetric key encoded in urlsafebase64
        :param b64:     true if want output encoded in urlsafebase64, otherwise string
        :returns:       encrypted data
         */
        // May need to handle different forms of sym_key for now assume urlbase64 encoded string
        if (!sym_key) throw new errors.CodingError('KP.sym_encrypt sym_key cant be empty');
        sym_key = sodium.from_urlsafebase64(sym_key);
        const nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES);
        const ciphertext = sodium.crypto_secretbox_easy(data, nonce, sym_key, "uint8array");  // message, nonce, key, outputFormat
        const combined = utils.mergeTypedArraysUnsafe(nonce, ciphertext);
        return b64 ? sodium.to_urlsafebase64(combined) : sodium.to_string(combined);
    };

    static sym_decrypt(data, sym_key, outputformat) {
        /*
        Decrypt data based on a symetric key

        :param data:    urlsafebase64 string or Uint8Array
        :param sym_key: symetric key encoded in urlsafebase64 or Uint8Array
        :param outputformat:    Libsodium output format one of "uint8array", "text", "base64" or "urlsafebase64"
        :returns:       decrypted data in selected outputformat
         */
        if (!data)
            throw new errors.EncryptionError("KeyPair.sym_decrypt: meaningless to decrypt undefined, null or empty strings");
        // Note may need to convert data from unicode to str
        if (typeof(data) === "string") {   // If its a string turn into a Uint8Array
            data = sodium.from_urlsafebase64(data);
        }
        if (typeof(sym_key) === "string") {   // If its a string turn into a Uint8Array
            data = sodium.from_urlsafebase64(sym_key);
        }
        let nonce = data.slice(0,sodium.crypto_box_NONCEBYTES);
        data = data.slice(sodium.crypto_box_NONCEBYTES);
        try {
            return sodium.crypto_secretbox_open_easy(data, nonce, sym_key, outputformat);
        } catch(err) {
            throw new errors.DecryptionFailError("Failed in symetrical decryption");
        }
    };

    static sha256(data) {
        /*
        data:       String or Buffer containing string of arbitrary length
        returns:    32 byte Uint8Array with SHA256 hash
        */
        let b2 = (data instanceof Buffer) ? data : new Buffer(data);
        // See browser built in exampel at https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/digest
        return shajs('sha256').update(b2).digest(); // Note this exists only because IPFS makes it ridiculously hard to get the hash synchronously
        //return crypto.createHash('sha256').update(b2).digest(); // Note this was the only dependence on crypto which is now deprecated
        //Not sure if this is Buffer or string
    }

    static multihashsha256_58(data) {
        // Base58 of a Multihash of a Sha2_256 of data - as used by IPFS
        return multihashes.toB58String(multihashes.encode(KeyPair.sha256(data), 'sha2-256'));
    }
    objbrowser_key(el, name, val) {
        return this.objbrowser_str(el, name, this.has_private() ? this.privateexport() : this.publicexport());
    }
    objbrowser_fields(propname) {
        let fieldtypes = { _key: "key", _publicurls: "urlarray"}
        return fieldtypes[propname] || super.objbrowser_fields(propname);
    }


    static test() {
        // First test some of the lower level libsodium functionality - create key etc
        debugkeypair("KeyPair.test starting");
        let qbf="The quick brown fox ran over the lazy duck";
        let key = sodium.randombytes_buf(sodium.crypto_shorthash_KEYBYTES);
        let shash_u64 = sodium.crypto_shorthash('test', key, 'urlsafebase64'); // urlsafebase64 is support added by mitra
        key = null;
        let hash_hex = sodium.crypto_generichash(32, qbf, key, 'hex'); // Try this with null as the key
        let hash_64 = sodium.crypto_generichash(32, qbf, key, 'base64'); // Try this with null as the key
        let hash_u64 = sodium.crypto_generichash(32, qbf, key, 'urlsafebase64'); // Try this with null as the key
        debugkeypair("hash_hex = %s %s %s %s",shash_u64, hash_hex, hash_64, hash_u64);
        if (hash_u64 !== "YOanaCqfg3UsKoqlNmVG7SFwLgDyB3aToEmLCH-vOzs=") { console.log("ERR Bad blake2 hash"); }
        let signingkey = sodium.crypto_sign_keypair();
        debugkeypair("test: SigningKey= %o", signingkey);
        let seedstr = "01234567890123456789012345678901";
        let seed = sodium.from_string(seedstr);
        let boxkey = sodium.crypto_box_seed_keypair(seed);
        //FAILS - No round trip yet: debugkeypair("XXX@57 to_string=%s",sodium.to_string(boxkey.privateKey));
        //TODO-BACKPORT get better test from Python.test_client.test_keypair
    };
}

KeyPair.KEYTYPESIGN = 1;            // Want a signing key
KeyPair.KEYTYPEENCRYPT = 2;         // Want a key for encryption
KeyPair.KEYTYPESIGNANDENCRYPT = 3;  // Want both types of key - this is usually used for encryption due to libsodium-wrappers limitations.

SmartDict.table2class["kp"] = KeyPair;


exports = module.exports = KeyPair;

