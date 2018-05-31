# dweb-objects  API
Mitra Ardron, Internet Archive,  mitra@mitra.biz

This doc provides a concise API specification for the Dweb Javascript Object Libraries. 

It was last revised (to match the code) on 23 April 2018. 

If you find any discrepancies please add an issue here.

## Overview

The object layer sits above the Transport layer and channels access to it through a set of objects. 
They provide a set of standardised methods that can be subclassed as needed to change the default behavior.

Its implemented as a “SmartDict” class which is subclassed to provide the non-default 
behaviors required. 

* *SmartDict*:          Baseclass for objects
    * *KeyPair*:        Encapsulate cryptography into a KeyPair and actions with it.
    * *KeyValue*:       Manages a KeyValue object intended to be stored as a single item
    * *Signature*:      Encapsulates signing something
    * *PublicPrivate*:  Baseclass for anything that has publicly and privately available information
        * *CommonList*: Superclass to manage lists
            * *KeyChain*: List of Keys that a logged in user has access to
            * *AccessControlList*: Holds a list of encrypted tokens controlling access
            * *VersionList*:    Manages something which exists in multiple versions.
        * *KeyValueTable*:  Manages a key/value table where each key/value is stored seperately.
            * *Domain (Leaf)*: A table hierarchically mapping names to a resource
* *Errors*:             Utility set of classes with Error classes
* *EventListenerHandler*:   Utility class for handling event listening.

It implements two key pathways

a) create an object from stored data that has been retrieved via: `SmartDict.p_fetch(urls)`,
which will retrieve the object from one of the url,
and instantiate an object of the appropriate class.

b) Store an object on the Dweb
p_store > _getdata > preflight > Transport.p_rawstore

An object is generally retrieved by a call to

There are a set of functions defined on the SmartDict which subclasses override where appropriate.


## General API notes and conventions
We use a naming convention that anything starting “p_” returns a promise so you know to "await" it if you want a result.

Ideally functions should take a String, Buffer or where applicable Object as parameters with automatic conversion. 
And anything that takes a URL should take either a string or parsed URL object. 

The verbose parameter is a boolean that is an indicator of a need to output to the console. Normally it will be passed down to called functions and default to false.

Fields starting with "_" are by convention not stored. 

Note: I am gradually (April2018) changing the API to take an opts {} dict which includes verbose as one field. This process is incomplete, but I’m happy to see it accelerated if there is any code built on this, just let mitra@archive.org know.

## Creating new Subclasses
This library is intended to make it easy to create highly functional Dweb classes without writing/maintaining
much code. 

First pick the object to subclass based on the following questions. 
* Does it have a public and private facing version - typically because it has a keypair associated. 
    * If not - subclass SmartDict
* If it does, then does it have a list of subobjects
    * If not subclass PublicPrivate
* Is the list essentially different versions of the same object 
    * If so, subclass VersionList
* Otherwise subclass CommonList

##### table: A short character string identifying the class. 
Its used by SmartDict.p_fetch() to map stored data to classes, is set in the constructor, 
Notice how each class sets a reference to itself in SmartDict.table2class at the end of the file.

##### constructor can setup any fields needed, generally they are short
TODO Note that the signature of the constructor of subclasses may change soon (May2018) to align with SmartDict

##### async p_new - initialize new object
Generally call p_new rather than the constructor, which can asynchronously build your object, 
and should always calls the constructor.

##### __ setattr__(name, value) - set a value
If there are fields that are stored in a manner different from the standard JSON conversion,
then provide a __ setattr__() function to convert to your data type (Dates are a common case of this).

##### _setdata(value) 
Is a good place to add field initializations that are needed other than from stored data. 
For example CommonList sets _list to [] if its not already initialized.

* TODO comment on objbrowser support
* TODO - more key method docs here, copy from google doc. 

##### preflight(dd)
Is where you should remove any fields that should only be stored in the master version (e.g. see CommonList)

##### objbrowser_fields(propname)
Add support for the objectbrowser by mapping field names to the type of field (see examples in most classes)

##### async p_objbrowser(el, opts)
Add support for the objectbrowser by for example fetching any lists prior to display. (see CommonList for example)

## SmartDict Class

Subclass of Transport that stores a data structure, usually a single layer Javascript dictionary object.

SmartDict is intended to support the mechanics of storage and retrieval while being  subclassed to implement functionality
that understands what the data means.

By default any fields not starting with “_” will be stored, and any object will be converted into its url.

The hooks for encrypting and decrypting data are at this level, depending on the _acl field, but are implemented by code in CryptoLib.

Fields|&nbsp;
:---|---
_acl|if set (on master) to a AccessControlList or KeyChain, defines storage as encrypted 
_urls|Array of URLs of data stored
table|"sd", subclasses each have their own `table` code

#### The callchain for storing is ...

* p_store - store the object to the Dweb if not stored.
    * (for PublicPrivate or subclasses ) 
        * storedpublic - check if public version stored
        * _p_storepublic - store public version
            * _getdata(publicOnly: true, encryptIfAcl: false) - see _getdata below 
            * DwebTransports.p_rawstore - store publi version on underlying transports 
    * (for all subclasses of SmartDict)    
        * stored - check if object stored
        * _getdata - prepares data for sending, and convert to JSON
            * preflight - convert dictionary ready to store
            * ACL.encrypt - if required encrypt
        * DwebTransports.p_rawstore - store on underlying transports
    
#### And the callchain for retrieving is ...

* p_fetch
    * DwebTransports.p_rawfetch - retrieve raw data
    * _after_fetch convert retrieved object into intended class, (_sync_after_fetch is alternative for non-encrypted)
        * SD.p_decrypt - connect to hook registered by ACL
            * ACL.p_decryptdata - fetch necessary ACL etc to decrypt object if required
                * ACL.p_decrypt - decrypt object
        * subclass constructor - create object of intended class
            * _setdata convert from json and store
                * _setproperties store on object
                    * __ setattr__ store a specific attribute (can convert data types in subclasses)

##### new SmartDict (data, verbose, options)
Creates and initialize a new SmartDict. 
```
data        String|Object, If a string (typically JSON), then pass to Transport.loads first. 
            A object with attributes to set on SmartDict via _setdata
options     Passed to _setproperties, by default overrides attributes set by data
```

##### stored()
Check if stored (Note overridden in KeyValue to use a _dirty flag)
```
returns True if data has been stored
```

##### dirty()
Mark an object as needing storing again, for example because one of its fields changed.
Flag as dirty so needs uploading - subclasses may delete other, now invalid, info like signatures
(Note overridden in KeyValue to use a _dirty flag)


##### preflight(dd)
Default handler for preflight, strips attributes starting “_” and stores and converts objects to urls.
Subclassed in AccessControlList and KeyPair to avoid storing private keys.
When subclassing, take care for example to save attributes starting "_" before calling super.
```
dd        dictionary to convert..
Returns   converted dictionary
```

##### _getdata({ publicOnly=false, encryptIfAcl=true}={})
Prepares data for sending. Retrieves attributes, runs through preflight.
If there is an _acl field then it passes data through it for encrypting (see AccessControl library[c])
```
publicOnly     Return only public version of data
encryptIfAcl   If the acl field is present then encrypt and return { acl, encrypted, table}
Returns        String suitable for p_rawstore
```

##### _setdata(value)
Stores data, subclass this if the data should be interpreted as its stored.
```
value        Object, or JSON string to load into object.
```

##### async p_store(verbose)
Store the data on Dweb, if it hasn’t already been.
It stores the urls in _urls 
```
Resolves to        object (for chaining)
```

##### match (dict)
Checks if a object matches for each key:value pair in the dictionary.
```
dict:           dictionary of fields to match, fields starting “.” are treated specially including:
  .instanceof:  holds a class to match against the obj.
Returns:        true if matches
```

##### copy (verbose)
Copy a SmartDict or subclass, will treat "this" as a dict and add to fields, note will shallowcopy, not deep copy.
```
returns:        new instance of SmartDict or subclass
```

##### p_objbrowser(el, {maxdepth=2, verbose=false}={})
Used by the ObjectBrowser to display an object for debugging, 
it includes many private functions TODO document them!
```
el  HTML Element to build the display inside
maxdepth    Not currently supported but limits depth of recursion
```


##### static _sync_after_fetch (retrievedobj, urls, verbose)
Turn a data structure retrieved from transport into a class based on retrievedobj[“table”], 
can be synchronous because doesnt allow for encrypted objects.
```
retrievedobj An object as retrieved from the transport
urls         set to _urls field to show where retrieved from
```

##### static async _after_fetch (maybeencrypted, urls, verbose)
Turn a data structure retrieved from transport into a class based on retrievedobj[“table”], object can be encrypted so its asynchronously.
```
maybeencrypted  A object retrieved from the transport that might be encrypted
urls            set to _urls field to show where retrieved from
```

##### static async p_fetch (urls, verboseOrOpts)
Fetches the object from Dweb, passes to p_decryp[1]t in case it needs decrypting, and creates an object of the appropriate class and passes data to _setdata
This should not need subclassing, (subclass _setdata or p_decrypt or _sync_after_fetch or _afterfetch instead).
```
urls        Array of urls to fetch
verboseOrOpts   boolean (verbose) or dictionary of options to pass to p_rawfetch
resolves:   New object - e.g. StructuredBlock or MutableBlock
throws:     TransportError if url invalid, ForbiddenError if decryption fails.
```

##### static async p_decrypt(data, verbose)
This is a hook to an upper layer (ACL) for decrypting data, if the layer isn't there then the data wont be decrypted.
```
data:   possibly encrypted object produced from json stored on Dweb
return: same object if not encrypted, or decrypted version
raises: AuthenticationError if can't decrypt
```

##### static decryptwith(cb)
Takes a callback that should be used to decrypt data (see AccessControlList) for setting it.
The callback should return a promise.
```
cb(encrypteddata, verbose) => resolves to data
```

## List Layer

See [Dweb - List](https://docs.google.com/document/d/1vm-Lze_Gu6gEQUPvh-yRCayCnT82SyECOrd8co3EPfo/edit#_)
(TODO-move material from google doc to repository.)

Allows managing lists through four classes:
* KeyPair - encapsulates Public/Private keys supporting signing and encryption
* Signature - a signature of some other object
* PublicPrivate - superclass of classes which are typically stored in a private and public version.
* CommonList - superclass managing lists of Signatures


### KeyPair - encapsulates Public/Private keys supporting signing and encryption
Encapsulates public key cryptography, it builds on libsodium. 
Theoretically, use of a different cryptolibrary should be confined to this class.

*Fields*:
```
_key    Holds a structure, that may depend on cryptographic library used.
Inherits from SmartDict: _acl; _urls
```

*Constant*|Value|Meaning
---------|-----|------
KEYTYPESIGN|1|Want a signing key
KEYTYPEENCRYPT|2|Want a key for encryption
KEYTYPESIGNANDENCRYPT|3|Want both types of key - usually used for encryption due to libsodium-wrappers limitations.

##### Libsodium implementation:
Note that Uint8Array is the result of converting UrlSafeBase64 with sodium.to_urlsafebase64
```
_key = {
    sign: { publicKey: Uint8Array, privateKey: Uint8Array, keyType: "ed25519" }
    encrypt: { publicKey: Uint8Array, privateKey: Uint8Array},
    seed: Uint8Array,
}
```

##### new KeyPair (data, verbose)
Create a new KeyPair
```
data: data to initialize with (see Fields above)
```

##### __setattr__(name, value) {
Subclasses SmartDict.__setattr__ to import "key"
```
name:               String - name of field to set, special cases:
  key               Import key via _key_setter
  private, public   Error - can't import directly" then imports
  *                 otherwise passes to SmartDict.__setattr__
value:              Any - stored in field, for key see _key_setter()
```

##### _key_setter(value)
(Internal function) Set a key based on a dictionary of alternatives.
```
value: 
  string or array Pass to _importkey or
  dictionary interpret fields as;
    mnemonic:     BIP39 style mnemonic (currently unsupported except one fake test case
    passphrase:   A phrase to hash (sha256) to get a seed
    keygen:       True to generate a new random key
    seed:         32 byte binary as Uint8array or string to pass to _keyfromseed
```

##### storedpublic()
Check if the public version of this object has been stored (i.e. public keys etc)
```
returns:   true if the public version is stored (i.e. _publicurls is set)
```

##### async p_store(verbose)
Store public and private versions of this object if not already stored

##### preflight(dd)
Subclasses SmartDict.preflight, checks not exporting unencrypted private keys, 
and exports private or public.
```
dd:        dict of fields, maybe processed by subclass
returns:   dict of fields suitable for storing in Dweb
```

##### static _keyfromseed(seed, keytype, verbose)
Generate a key from a seed,
```
seed:      uint8array or binary string (not urlsafebase64) to generate key from
keytype:   One of KeyPair.KEYTYPExyz to specify type of key wanted
returns:   Dict suitable for storing in _key
```

##### _importkey(value)
Import a key, sets fields of _key without disturbing any already set unless its SEED.
```
value: "xyz:1234abc" where xyz is one of "NACL PUBLIC, NACL SEED, NACL VERIFY" 
        and 1234bc is a ursafebase64 string
        Note NACL PRIVATE, NACL SIGNING,  are not yet supported as "NACL SEED" is exported
```

##### signingexport()
```
returns   "NACL VERIFY:xyz123" export urlsafebase64 string of public key used for checking signature 
```

##### publicexport()
```
return   Array of public keys can be "NACL PUBLIC:abc123", or "NACL VERIFY:abc123" (urlbase64)
```
##### verifyexportmultihashsha256_58
This is a pretty arbitrary export used for list addresses etc, it might be changed to the publickey allowing signature checking
but note that currently the server expects a base58 obj
```
retuns base58 string
```

##### privateexport()
```
return:  Array of private keys, currently just "NACL SEED:abc123" urlsafebase64 string.
```

##### has_private()
```
return:  True if key has a private version (or sign or encrypt or seed)
```

##### encrypt (data, b64, signer)
Encrypt a string, the destination string has to include any information needed by decrypt, e.g. Nonce etc
```
data:       String to encrypt
b64         bool: True if want result encoded in urlsafebase64
signer      AccessControlList or KeyPair: If want result signed (currently ignored for RSA, reqd for NACL)
return:     str, binary encryption of data or urlsafebase64
```

##### decrypt (data, signer, outputformat)
Decrypt date encrypted with encrypt (above)
```
data:           urlsafebase64 or Uint8array, starting with nonce
signer          AccessControlList: If result was signed (currently ignored for RSA, reqd for NACL)
outputformat:   Compatible with LibSodium, typically "text" to return a string
return:         Data decrypted to outputformat
throws:         EnryptionError if no encrypt.privateKey, CodingError if !data||!signer
```

##### sign(signable, verbose)
Sign and date a signable string using public key function. 
Pair of "verify()"
```
signable:  string being signed, it could really be any data,
return:    signature that can be verified with verify
```

##### verify(signable, urlb64sig) {
Verify a signature generated by sign()
```
signable:         date and url exactly as signed.
urlb64sig:         urlsafebase64 encoded signature
```

##### static b64dec (data)
Decode arbitrary data from b64
```
data:       urlsafebase64 encoded string
returns:    Uint8Array suitable for passing to libsodium
```

##### static b64enc(data) {
Encode arbitrary data into b64
```
data:       Uint8Array (typically produced by libsodium)
returns:    string
```

##### static randomkey ()
Generate a random key suitable for the secretbox function (symetric encoding/decoding) of libsodium
```
returns:   Uint8Array[crypto_secretbox_KEYBYTES] containing random
```

##### static sym_encrypt (data, sym_key, b64)
Decrypt data based on a symetric key
```
data:            arbitrary string
sym_key:         symetric key encoded in urlsafebase64
b64:             true if want output encoded in urlsafebase64, otherwise string
returns:         encrypted data
```

##### static sym_decrypt (data, sym_key, outputformat)
Decrypt data based on a symetric key
```
data:            urlsafebase64 string or Uint8Array
sym_key:         symetric key encoded in urlsafebase64 or Uint8Array
outputformat:    Libsodium output format one of "uint8array", "text", "base64" or "urlsafebase64"
Returns:         decrypted data in selected outputformat
```

##### static sha256 (data) 
```
data:               String or Buffer containing string of arbitrary length
returns:            32 byte Uint8Array with SHA256 hash
```

##### static multihashsha256_58(data) {
```
data     String or Buffer containing string of arbitrary length
returns  Base58 of a Multihash of a Sha2_256 of data - as used by IPFS
```

##### objbrowser_key(el, name, val)
Support objbrowser by converting key to a string (by exporting it)

### Signature - holds signatures stored on CommonList
The Signature class holds a signed entry that can be added to a CommonList._list .
The urls of the signed object are stored with the signature in CommonList.p_add()

#####Fields:
```
date:        Date stamp (according to browser) when item signed
urls:        Array of urls of object signed
signature:          Signature of the date and urls
signedby:           Public urls of list signing this (list should have a public key)
Inherits from SmartDict: _acl, _urls
```

##### new Signature (dic, verbose)
Create a new instance of Signature
```
dic:         data to initialize - see Fields above
```

##### __setattr__(name, value)
Overrides SmartDict.__setattr__ 
```
name:   If "date" then convert value from string to javascript Date
```

##### preflight(dd)
Overrides SmartDict.preflight to convert fields of dd
```
date    Convert back to iso string.
data    Deleted (it will be the signed data)
```

##### signable()
Return a string suitable for signing - (date + url)
```
return:        signable string (date in isoformat + url)
```

##### static async p_sign (commonlist, urls, verbose)
Sign and date a url.
```
commonlist:    Subclass of CommonList containing a private key to sign with.
urls:          Array of urls of item being signed
resolves to:   Signature (dated with current time on browser)
```

##### verify(commonlist, verbose) 
Pass signature to commonlist for verification
```
commonlist:     Subclass of CommonList containing a private key to verify with.
return:         True if verifies ok (passed to CommonList’s verification function)
```

##### static filterduplicates(arr)
Utility function to allow filtering out of duplicates
```
arr:      [Signature*]
returns:  [Signature*] containing only the first occuring instance of each signature 
        (note first in array, not necessarily first by date)
```

##### async p_fetchdata({verbose=false, ignoreerrors=false} = {})
Fetch the data related to a Signature, store on .data
```
ignoreerrors:   Passed if should ignore any failures, especially failures to decrypt
resolves to:    obj - object that was signed
raises:         AuthenticationError if can't decrypt
```

### PublicPrivate extends SmartDict - encapsulate classes stored as public & private
PublicPrivate is a superclass for anything (except KeyPair) that is stored in both public and private
version, this includes CommonList, KeyValueTable and their subclasses.

##### Fields:
```
keypair         Holds a KeyPair used to sign items
_master         true if this is a master list, i.e. can add things
_publicurls     Holds the urls of publicly available version of the list.
_allowunsafestore true if should override protection against storing unencrypted private keys (usually only during testing)
dontstoremaster true if should not store master key
_listeners      Any event listeners  //TODO-LISTENER - maybe move to SmartDict as generically useful
```

##### new PublicPrivate (data, verbose, options)
Create a new instance of CommonList (but see p_new)
```
data:     json string or dict to load fields from
options:  dict that overrides any fields of data
```

##### static async p_new(data, master, key, verbose, options)
Create a new PublicPrivate, just calls new PublicPrivate, 
All subclases should implement p_new and call super.p_new so that this gets done. 
```
data:       json string or dict to load fields from
master:     boolean, true if should create a master list with private key etc
key:        KeyPair or { seed: 32bytestring} or {mnemonic: BIP39 string} or {keygen: true}
            (Note BIP39 not yet implemented)
options:    dict that overrides any fields of data
```

##### __ setattr__(name, value)
Overrides SmartDict.__ setattr__ Passes name=keypair to _setkeypair()

##### _setkeypair(value, verbose)
Turn the value into a keypair and store on keypair field, 
sets master if key has a private key (but note this is overridden in the constructor).
```
value:  KeyPair or dict like _key field of KeyPair
```

##### keytype()
Return the type of key to use from Dweb.KeyPair.KEYTYPE* constants
By default its KEYTYPESIGN, but KeyChain subclasses
```
return:         constant
```

##### preflight(dd)
Prepare a dictionary of data for storage,

Subclasses SmartDict to:
* convert the keypair for export and check not unintentionally exporting a unencrypted public key
* ensure that _publicurl is stored (by default it would be removed)
(note subclassed by AccessControlList(
```
dd:         dict of attributes of this, possibly changed by superclass
returns:    dict of attributes ready for storage.
```

##### async _p_storepublic(verbose)
Store a public version, doesn’t encrypt on storing as want public part to be publicly visible (esp for Domain)

##### storedpublic()
Returns:        True if the object’s public version (i.e. public keys etc) has been stored

##### async p_store(verbose)
Override SmartDIct to store on Dweb, if _master is true, will ensure that stores a public version as well, and saves in _publicurl.
Will store master unless dontstoremaster is set.

##### stored()
```
Returns:        True if object’s private and public versions both stored, or should not be stored. 
```

##### async p_sign(urls, verbose)
Utility function to create a signature, normally use p_push which signs and puts on _list and on Dweb
```
urls:        array of ursl of object to sign
returns:     Signature
throws:      assertion error if doesn't
```

##### verify(sig, verbose)
Check that a signature is validly signed by this list.
```
sig:         Signature
Returns:     true on success (currently assertion error on failure, but that will change)
```

#### Event Handling in PublicPrivate
NOTE the event infrastructure may get moved to SmartDict

##### addEventListener(type, callback)
Add an event monitor for this list, for example if the UI wants to monitor when things are added. It will be called by listmonitor. 
```
type:        The event type, currently only “insert” is ever dispatched.
callback:    function({target: this, detail: sig})
```

##### removeEventListener(type, callback) 
Inverse of addEventListener - will remove the callaback if its been added. 
```
type:        Currently supports "insert"
callback:    function({target: this, detail: sig})
```

##### dispatchEvent(event)
Dispatch event to any listeners of the appropriate type. Normally this is only called by listmonitor, but it could be called for other reasons with custom events.
```
event:        Instance of CustomEvent
```

### CommonList extends PublicPrivate - superclass for all lists
CommonList is a superclass for anything that manages a storable list of other urls
e.g.VersionList, KeyChain, AccessControlList

##### Fields:
```
_list           Holds an array of signatures of items put on the list
_publicurls     Holds an array of urls of publicly available version of the list.
listurls        List of URLs for lists 
listpublicurls  Public version of URL for list
Inherits from PublicPrivate: keypair, _master, _publicurls, _allowunsafestore, dontstoremaster, _listeners
inherits from SmartDict: _acl, _urls
```

##### static async p_new CommonList (data, verbose, options)
Create a new instance of CommonList (but see p_new) - see PublicPrivate.new for documentation
Note that in almost all cases should use p_new rather than constructor as constructor cant setup listurls and listpublicurls

##### static async p_new(data, master, key, verbose, options)
Create a new CommonList, and sets listurls and listpublicurls based on calls to Transports.
This should be used in preference to “new CommonList()”

##### _setdata(value)
Overrides PublicPrivate._setdata to set _list=[] if not initialized

##### preflight(dd)
Overrides PublicPrivate.preflight() to remove unsafe fields (listurls) before storage
```
dd      dictionary of fields
returns dictionary of fields
```
 
##### async p_fetchlist(verbose)
Load the list from the Dweb,
Use p_list_then_elements instead if wish to load the individual items in the list

##### async p_list_then_elements(verbose)
Utility function to simplify nested functions, fetches body, list and each element in the list.
```
resolves        list of objects suitable for storing on a field (e.g. keys)
```

##### async p_push(obj, verbose)
Sign and store a object on a list, stores both locally on _list and sends to Dweb
```
obj:        Should be subclass of SmartDict, (Block is not supported)
resolves:   Signature created in process - for adding to lists etc.
throws:     ForbiddenError if not master;
```

##### async p_add(sig, verbose)
Add a signature to the Dweb for this list
```
sig:      Signature to add
resolves: undefined
```

##### listmonitor (verbose) 
Setup a callback on all valid transports, so if anything is added to this list on the Dweb it will be called. This method then deduplicates, and if the event is new will call any callback added with addEventListener() with an event of type “insert”   Note that the callback is called WITHOUT fetching the data referenced in the Sig, since it could be large, or a stream etc.

### KeyValueTable - storage and retrieval of data by a key
Manages a KeyValue object intended for each field to be a separate item stored independently.

##### Fields:
```
_autoset:       When set to true, any changes will be stored to server, its set after p_new writes initial data
tableurls       Urls needed to write to the table
tablepublicurls Urls needed to read from the table, e.g. YJS which can be retrieved from.
_map           Where the KV mapping is stored.

Fields Inherited from PublicPrivate:
keypair         Key used to sign - not used here (yet), but is in Domain
```
Two ordering use cases
* Create new object via p_new, store it via the _autoset setting
* Retrieve object via SmartDict - want to start monitor after get, and start set

##### new KeyValueTable (data, verbose, options)
Create a new instance of KeyValueTable (but see p_new) - see PublicPrivate.p_new for documentation
```
data: {_autoset}  if _autoset is undefined then will be set if master && tableplublicurls is set
```

##### static async p_new (data, master, key, verbose, options)
Create a new KeyValueTable, (calls constructor), calls Transports for tableurls and tablepublicurls
```
keyvaluetable    Which table at the DB to store this in. (DB is auto-selected based on keys)
seedurls         extra urls to use for tablepublicurls, typically a http server
```

##### _storageFromMap(mapVal, {publicOnly=false, encryptIfAcl=true}={})
Convert a value as stored on a transport medium into a value suitable for the _map dictionary. Pair of _storageFromMap.
This is working from the assumption that the underlying transport needs a JSON string to store.
If change that assumption - and store Objects - then these two functions should be only place that needs changing.
This pair should be able to be subclassed safely as long as _mapFromStorage(_storageFromMap(x)) == x for your definition of equality.
```
publicOnly  If true massage the data to store a safe value
encryptIfAcl    If true, and there is an acl field, then use the encryption process before storing
```

##### _mapFromStorage(storageVal, verbose=false) {
Convert a value as stored in the storage dictionary into a value suitable for the map. Pair of _storageFromMap.

##### preflight(dd)
Overrides PublicPrivate.preflight to delete tableurls from non-master

##### async p_set (name, value, {verbose=false, publicOnly=false, encryptIfAcl=true, fromNet=false}={})
Set a value to a named key in the table setup during creating of this KeyValueTable
(Subclased in Domain to avoid overwriting private version with public version from net)
```
name            of key to store under
value           value to store
publicOnly      If true massage the data to store a safe value
encryptIfAcl    If true, and there is an acl field, then use the encryption process before storing
fromNet         If true this data came from a notification from the net, store locally but don't send back to net
```

##### _updatemp(res)
Internal function to udate the map from a dict 
```
res dictionary of field names and values
```

##### async p_get (keys, verbose)
Get the value stored at a key from the transport, store locally in _map as well. 
```
keys:        single key or array of keys
returns        single result or dictionary, will convert from storage format
```

##### async p_getMerge(keys, verbose) {
Get the value of a key, but if there are multiple tablepublicurls then check them all, and use the most recent value
TODO - will store most recent back to stores that don't have it.
```
key:    Key or Array of keys.
return: value or array of values
```

##### async p_keys(verbose)
```
returns array of all keys
```

##### async p_getall (verbose)
```
returns        dictionary of all keys and values
```

##### async p_delete key, {fromNet=false, verbose=false}={})
Delete the key from the map and on the net
```
fromNet        Only delete locally - this request came from the net
```

##### monitor(verbose)
Add a monitor for each transport - note this means if multiple transports support it, then will get duplicate events back if everyone else is notifying all of them.
Note monitor() is synchronous, so it cannot do asynchronous things like connecting to the underlying transport
Stack: KVT()|KVT.p_new => KVT.monitor => (a: Transports.monitor => YJS.monitor)(b: dispatchEvent)

### KeyValue extends SmartDict
TODO This is incomplete, will have a interface similar to KeyValueTable

## Authentication layer
The Authentication Layer builds on the Lists, there is a
[Google Doc: Dweb - Authentication](https://docs.google.com/document/d/1bdcNtfJQ04Twlbef1VZAjQYLmZgpdCFDapQBoef_CGs/edit)
describing it. 
TODO - convert Dweb-Authentication to .md and add to repository.

In essence:

* An AccessControlList (ACL) is added to the `_acl` field of any SmartDict subclass
* SmartDict.p_store encrypts such objects with a secret key (stored on the ACL)
* The ACL has a list of people who can access the doc, 
each item on the list is the secret key encrypted by the Public Key of the user. 
* A user has one or more KeyChains with a list of their Private/Public KeyPairs
* When SmartDict.p_fetch retrieves and object, it checks the logged in user's KeyChains 
and the ACL for a matching keypair, and if found decrypts the document

### AccessControlList extends CommonList - a list of people who can access a set of resources.

An AccessControlList is a list for each control domain, with the entries being who has access.
To create a list, it just requires a key pair, like any other List

##### Fields:
```
accesskey:  Secret key with which things are encrypted. We are controlling who gets this.
_list: Contains a list of signatures, each for a SmartDict each of which is:
   viewer: public URLs of the KeyPair of an authorised viewer
   token:  accesskey encrypted with PublicKey from the KeyPair
   name:   Name of this token
Inherits from PublicPrivate: _master, _publicurls, _allowunsafestore, dontstoremaster, _listerners; and from CommonList: _list, and from SmartDict: _acl. _urls
```
##### new AccessControlList(data, verbose, options)
Create a new AccessControlList - see PublicPrivate for parameters, but should use p_new

##### static async p_new (data, master, key, verbose, options, kc) 
Create a new AccessControlList, store, add to keychain, adds listurls and listpublicurls
```
data,master,key,verbose,options: see new PublicPrivate
Kc:        Optional KeyChain to add to
```
##### preflight (dd)
Overrides CommonList, Prepare data for storage, ensure publickey available
```
dd:        dict containing data preparing for storage (from subclass)
returns        dict ready for storage if not modified by subclass
```
##### async p_add_acle (viewerpublicurls, data, verbose) 
Add a new ACL entry - that gives a viewer the ability to see the accesskey of this ACL
```
viewerpublicurls:        Array of urls of the viewers KeyPair object (contains a publickey)
data:        Dict of data fields, only currently supports “name” but could theoretically add any.
resolves to:         this for chaining
```
##### p_tokens(verbose)
Return the list of tokens on this ACL. Side effect of loading data on each Signature in this._list
```
resolves to: [ SmartDict{token:, viewer:, name: }, ... ]
```
##### _findtokens (viewerkeypair, decrypt, verbose)
Find the entries, if any, in the ACL for a specific viewer
There might be more than one if either the accesskey changed or the person was added multiple times.
Entries are SmartDict with token being the decryptable accesskey we want
The ACL should have been p_list_then_elements() before so that this can run synchronously.
```
viewerkeypair:        KeyPair of viewer
decrypt:         If should decrypt the
return:            Array of encrypted tokens (strings) or array of uint8Array
throws:            CodingError if not yet fetched
```
##### encrypt(data, b64)
Encrypt some data based on the accesskey of this list.
```
data:         string - data to be encrypted
b64:         true if want result as urlbase64 string, otherwise string
:return:         string, possibly encoded in urlsafebase64
```

##### decrypt (data,, verbose)
Decrypt data 
```
data:         string from json of encrypted data - b64 encrypted
:return:        Decrypted data
:throw:        AuthenticationError if there are no tokens for our ViewerKeyPair that can decrypt the data
```

##### static async p_decryptdata(value, verbose) 
Takes a dict, checks if encrypted (by presence of "encrypted" field, and returns immediately if not
Otherwise if can find the ACL's url in our keychains then decrypt with it (it will be a KeyChain, not a ACL in that case.
Else returns a promise that resolves to the data
No assumption is made about what is in the decrypted data
```
value:         object from parsing incoming JSON that may contain {acl, encrypted} acl will be url of AccessControlList or KeyChain
:return:         data or promise that resolves to data
:throws:         AuthenticationError if cannot decrypt
```

### KeyChain extends COmmonList - collection of KeyPair, ACL etc
KeyChain extends CommonList to store a users keys, MutableBlocks and AccessControlLists
#####Fields:
```
_keys:  Array of keys (the signed objects on the list)
```
##### Class Variables
```
eventHandler - monitor events on KeyChains (TODO document which)
keychains - list of logged in KeyChains
```

##### new KeyChain (data, verbose, options)
Create a new KeyChain, for parameters see CommonList or Publicprivate.

It calls any EventHandlers with cb("login", keychain)

##### static async p_new (data, key, verbose) 
Create a new KeyChain object based on a new or existing key.
Store and add to the Dweb.keychains, list any elements already on the KeyChain (relevant for existing keys)
```
data, key:  See CommonList or PublicPrivate for parameters
resolves to:    KeyChain created
```

##### async p_list_then_elements({verbose=false, ignoreerrors=false}={})
Subclasses CommonList to store elements in a _keys array.
```
ignoreerrors    If set will continue and ignore (just log) any elements it cant retriev
resolves to:            Array of KeyPair
```

##### encrypt (data, b64)
Encrypt an object (usually represented by the json string). Pair of .decrypt()
```
res: The material to encrypt, usually JSON but could probably also be opaque bytes
b64: True if result wanted in urlsafebase64 (usually)
:return:    Data encrypted by Public Key of this KeyChain.
```

##### decrypt(data, verbose)
Decrypt data with this KeyChain - pair of .encrypt()
```
data: String from json, b64 encoded
return: decrypted text as string
throws: :throws: EnryptionError if no encrypt.privateKey, CodingError if !data
```

##### p_store (verbose)
Unlike other p_store this ONLY stores the public version, and sets the _publicurl, on the assumption that the private key of a KeyChain should never be stored.
Private/master version should never be stored since the KeyChain is itself the encryption root.

#### KeyChains - managing the "keychains" variable
This may be separated to its own class at some point

##### static addkeychains(keychains)
```
keychains:         keychain or Array of keychains
```
##### static logout()
Logout user - removes all of Dweb.keychains

##### static default()
Find the default KeyChain for locking (currently the most recent login)
```
Returns:        keychain or undefined
```

##### static keychains_find (dict, verbose) 
Locate a needed KeyChain on Dweb.keychains by some filter.
```
dict:            dictionary to check against the keychain (see CommonList.match() for interpretation
:return:                AccessControlList or KeyChain or null
```

##### static find_in_keychains(dict, verbose)
Locate a needed KeyChain on this.keychains by some filter.
```
dict:    dictionary to check against the keychain (see CommonList.match() for interpretation
:return:        AccessControlList or KeyChain or null
```

##### static mykeys(clstarget)
Utility function to find any keys in any of Dweb.keychains for the target class.
```
clstarget:          Class to search Dweb.keychains for, KeyPair, or something with a KeyPair 
        e.g. subclass of CommonList(ACL, MB)
returns:            (possibly empty) array of KeyPair or CommonList
```

## Application Tools

### VersionList extends CommonList - manage something which has versions.
Extends a list to have semantics where the most recent entry is the current version, and older versions can be retrieved.

##### Fields:
```
contentacl: ACL that should be used to lock content
_working:   Version currently working on
Inherited Fields worth commenting on:
_acl:       Set to prevent access to the VersionList itself
_list:      List of versions, last on list should be the current version
```

##### new VersionList (data, verbose, options)
```
data:        Data to initialize to - usually {name, contentacl, _acl}
master:      True if should be master (false when loaded from Dweb)       
```

##### static async p_expanddata(data, verbose)
Prior to initializing data, expand any URLs in known fields (esp contentacl)
```
data:           data to initialize to
resolves to:    expanded data
```

##### static async p_new (data, master, key, firstinstance, verbose)
Create a new instance of VersionList, store it, initialize _working and add to KeyChain:
_acl will be default KeyChain if not specified
```
data,           see p_expanddata
master, key     see CommonList
firstinstance   instance used for initialization, will be copied for each version.
resolves to:    new instance of VersionList (note since static, it cannot make subclasses)
```

##### async p_saveversion(verbose)
Update the content edited i.e. sign a copy and store on the list, 
then make a new copy to work with.
Triggered by Save in most examples.
```
resolves to:        Signature of saved version
```

##### async p_restoreversion(sig, verbose)
Go back to version from a specific sig (sets _working)
```
sig:        Signature to go back to
```

##### async p_fetchlistandworking(verbose)
Fetch the list of versions, and get the data for the most recent one (explicitly does not fetch data of earlier versions)

##### preflight(dd)
Prepare data for storage, does not store private URL of contentacl in public (!master) version
```
dd        dict containing data preparing for storage (from subclass)
returns        dict ready for storage if not modified by subclass
```

## Naming Layer
The naming layer is to support a simple recursive naming system 
allowing a string to be resolved to a set of URLs that may be used for retrieval

It consists of a pair of classes and two mixins (groups of functions for multiple classes)
* Domain - defines a naming domain in which other things are named
* Leaf - defines the end point of naming and refers to an object stored, 
includes some metadata to enable handling
* SignatureMixin - generic signature tool, specifies which fields of an object should be signed
* NameMixing - generic name defining tool

### SignatureMixin = function(fieldlist) {
This mixin is a generic signature tool, allows to specify which fields of an object 
should be signed/verified.

Each signature is of JSON.stringify({date, signed} where signed is fields from fieldlist

To apply this mixin, see the example in Domain.js
SignatureMixin.call(Domain.prototype, ["tablepublicurls", "name", "keys", "expires"]);

##### Fields (on Mixing in class):
```
signatures: Array of dictionaries
    date,                   ISODate when signed
    signature,              Signature (see KeyPair)
    signedby,               Exported Public Key of Signer (see KeyPair)
```
##### Class Fields (on Mixing in class):
fieldlist   List of fields to sign

##### signatureConstructor()
Called from mixing in class - empties signatures

##### _signable(date)
Create a string suitable for signing
```
returns: JSON like "{ date: isodate, signed: { field/values to be signed }"
```
##### _signSelf(keypair)
Add a signature for the fieldlist to signatures, Pair of verify

##### _verifyOwnSigs()
Pair of sign, caller should check it accepts the keys returned
```
Returns array of keys that signed this match, 
```

### NameMixin = function(options)
This Mixin defines fields and methods needed to name something in a Domain,
Typically this will be either: another Domain; another SmartDict or class; raw content (e.g a PDF or HTML.

##### Signed Fields (on Mixing in class)
```
tableurls | tablepublicurls Where to find the object (or table if its a domain)
expires: ISODATE        When this name should be considered expired (it might still be resolved, but not if newer names available.
(there is no validfrom time, this is implicitly when it was signed)
name: str               Names that this record applies to relative to table its in. e.g.  fred, father
```
##### nameConstructor()
should be called by Mixing in classes construtor

### Leaf extends SmartDict and mixes in NameMixin & SignatureMixin
The Leaf class is used to register another object in a domain.

##### Fields
```
urls:       Points at object being named (for a SmartDict object its obj._publicurls)
mimetype:   Mimetype of content esp application/json
metadata:   Other information about the object needed before or during retrieval.
            This is a good place to extend, please document any here for now.
    jsontype: archive.org.dweb   is a way to say its a Dweb object,
    jsontype: archive.org.metadata is for archive.org metadata
Fields inherited from SignatureMixin: signatures
Fields inherited from NameMixin: expires; name;
```
##### new Leaf(data, verbose, options)
Constructs new Leaf, calls signature and name mixin constructors

##### static async p_new(data, verbose, options)
Create a new Leaf
returns Leaf

##### async p_printable({indent="  ",indentlevel=0}={})
Support debugging
```
returns Multiline output that can be displayed for debugging
```
##### async p_resolve(path, {verbose=false}={})
Sees it it can resolve the path in the Leaf further, because we know the type of object (e.g. can return subfield of some JSON)
```
path    / separated string to resolve in object
```
##### async p_boot({remainder=undefined, search_supplied=undefined, opentarget="_self", verbose=false}={})
Utility to display a Leaf, will probably need expanding to more kinds of media and situations via options
Strategy depends on whether we expect relativeurls inside the HTML. 
If do, then need to do a window.open so that URL is correct, otherwise fetch and display as a blob
```
remainder:       Any remainder string to send to the attribute specified in "leaf.htmlpath if specified
search_supplied: Anything supplied after the ? in the original URL, should be added to the search string
opentarget:      Where to open the file, defaults to "_self"
thows:           First error encountered, if doesnt succeed with any url.
```
### Domain extends KeyValueTable and mixes in NameMixin & SignatureMixin
The Domain class is for name resolution across multiple technologies.

Domains are of the form /arc/somedomain/somepath/somename
Where signed records at each level lead to the next level

##### Fields:
```
keys: [NACL VERIFY:xyz*]   Public Key to use to verify entries - identified by type, any of these keys can be used to sign a record
Fields inherited from NameMixin: name; expires; signatures
Fields inherited from SignatureMixin: signature
Fields inherited from KeyValueTable
    tablepublicurls: [ str* ]       Where to find the table.
    _map:   KeyValueTable   Mapping of name strings beneath this Domain
```

##### new Domain(data, verbose, options)
Constructs new Domain, calls signature and name mixin constructors

##### static async p_new(data, master, key, verbose, seedurls, kids)
Construct and return new Domain
```
data, master, key   See KeyValueTable.p_new
seedurls:   Urls that can be used in addition to any auto-generatd ones
kids:       dict Initial subdomains or leafs { subdomain: Leaf or Domain }
```

##### sign(subdomain) { // Pair of verify
Sign a subdomain with this domains private key
```
subdomain:  Domain or Leaf
```

##### verify(name, subdomain) { // Pair of sign
Check the subdomain is valid.
That is the case if the subdomain has a cryptographically valid signatures by one of the domain's keys and the name matches the name we have it at.
```
returns:    boolean
```

##### async p_register(name, registrable, verbose) {
Register an object.
Code path is domain.p_register -> domain.p_set
```
name:   What to register it under, relative to "this"
registrable:    Either a Domain or Leaf, or else something with _publicurls or _urls (i.e. after calling p_store) and it will be wrapped with a Leaf
```

##### static async p_rootSet( {verbose=false}={})
Setup a standard set of urls for the root domain


##### static async p_rootResolve(path, {verbose=false}={}) {
Resolve a path relative to the root
```
path    see p_resolve
resolves to:    [ Leaf, remainder ]
raises:         CodingError
```

##### async p_resolve(path, {verbose=false}={})
Resolves a path retlative to this Domain, should resolve to the Leaf
```
path            / separated path, e.g. arc/archive.org/details
resolves to:    [ Leaf, remainder ]
raises:         CodingError
```
##### async p_printable({indent="  ",indentlevel=0, maxindent=9}={}) {
Support printable debugging
```
returns multi line string suitable for console.log
```
##### static async p_setupOnce({verbose=false} = {})
Intended to be run once to setup global names

##### static async p_resolveNames(name, {verbose=false}={})
Turn an array of urls into another array, resolving any names if possible and leaving other URLs untouched
Try and resolve a name,
```
name:   One, or an array of Names of the form dweb:/ especially dweb:/arc/archive.org/foo
resolves to:    [ url ]  Array of urls which will be empty if not resolved (which is quite likely if relative name not defined)
```

##### privateFromKeyChain() {
Look in the logged in user's keychains to see if have the private version of this domain, in which case can work on it
```
returns:    undefined or Domain
```
##### static async p_resolveAndBoot(name, {verbose=false, opentarget="_self", search_supplied=undefined}={})
Utility function for bootloader.html
Try and resolve a name, if get a Leaf then boot it, if get another domain then try and resolve the "." and boot that.
```
search_supplied: Anything supplied in after the ? in the original URL, should be added to the search string
opentarget:      Where to open the file, defaults to "_self"
throws:          Error if cant resolve to a Leaf, or Error from loading the Leaf
```
## Error classes
Errors are implemented as classes to make it easier to check if certain kinds of errors have 
been thrown. The current set are as below, the message is the class name, but can be overwritten in the constructor.
e.g. new errors.CodingError("Shouldnt have done this")

Class|Means
-----|-----
ToBeImplementedError|The code for this has not been implemented
ObsoleteError|An old function that probably shouldnt be being called - check the code.
TransportError|Something went wrong fetching or storing to the underlying transports.
CodingError|Use this when the code logic has been broken - e.g. something is called with an undefined parameter, its preferable to console.assert Typically this is an error, that should have been caught higher up.
EncryptionError|Use this when the logic of encryption wont let you do something, typically something higher should have stopped you trying. Examples include signing something when you only have a public key.
SigningError|Use this something that should have been signed isn't - this is externally signed, i.e. a data rather than coding error
ForbiddenError|You aren't allowed to do this
AuthenticationError|Authentication stopped you doing something, i.e. logging in might help.
IntentionallyUnimplementedError|This function isn't implemented, and that is intentional, so it probably shouldnt be being called. (Check the code)
DecryptionFailError|We failed to decrypt something although the Authentication looked good.
SecurityWarning|A warning that we are doing something unsafe.
ResolutionError|Failed to resolve a name (see Domains.js)

##Event Listening
Events aren't widely used yet in this library. There are several event listening mechanisms being used, mostly for compatability with other code. 
At some point they may get merged, and could possible be setup as a Mixin, although all users
are currently subclasses of PublicPrivate.  

* PublicPrivate - implements its own architecture see above
* EventListener class as used by KeyChain at the class level

### EventListener - used by KeyChain
An event is a callback f({name, values})

##### new EventListener()
Create a new eventListeners field initialized to empty.
e.g. this.eventHandler = new EventListenerHandler()

##### addEventListener(f(name, values) => undefined)
Add a event listener that will be called back on any events on this EventListener

##### removeEventListener(f(name, values) => undefined))
Remove an event listener if an exact match is found.

##### removeAllEventListeners()
Remove all event listeners 

##### callEventListeners(event)
Call all the handlers, its up to each handler to decide if its listening for this kind of event. 
A shallow copy of the values is passed. 
```
event = { dict, typically { type: 'insert', values: [x,y,z]}
```

### Which events caught where. 

Class|Events|Event handler type|Setup|Sent|Caught
-----|------|------------------|-----|----|------
KeyChain (class)|login|EventListener|apps|KC.p_new|applications
KeyValueTable (instance)|set, delete|PublicPrivate|KVT.monitor|Transports.monitor||

## Utilities
A class exists with a set of generally useful functions. 

##### consolearr(arr)
console.log an array, prints the length and one or two members for long arrays

##### intersects(a,b) =>  boolean
Quick intersection for short arrays. Note there are better solutions exist for longer arrays
This is intended for comparing two sets of probably equal, but possibly just intersecting URLs
```
a, b    (shortish) arrays
Returns true if two shortish arrays a and b intersect 
    or if b is not an array, then if b is in a
    If a is undefined then result is false
```
##### mergeTypedArraysUnsafe(a, b)
Take care of inability to concatenate typed arrays such as Uint8. 
```
a,b     Typed arrays e.g. Uint8Array, behave is unpredictable if they are different types
returns Array of same type as a, but concatenated shallow copy.
```
##### objectfrom (data, hints={})
Generic way to turn something into a object (typically expecting a string, or a buffer)
This can get weird, there appear to be two DIFFERENT Uint8Arrays, one has a constructor "TypedArray" the other "Uint8Array"
"TypedArray" doesnt appear to be defined so can't test if its an instance of that, but in tests the TypedArray ones are
not instances of Buffer and need converting first
```
data    object (returned unchanged), string, buffer, Uint8Array (either kind)
hints   currently unused
returns object parsing JSON
```
##### keyFilter(dic, keys)
Utility to return a new dic containing each of keys 
(equivalent to python { dic[k] for k in keys }
```
dic Dictionary object, 
keys    [ str* ] keys to return from object.
```

##### createElement(tag, attrs, ...children)
Create a new HTML Element, set its attributes, and add children to it. 
Note that ReactFake in dweb-archive expands on this in an application specific manner, 
and dweb-transports/htmutils.js has a more flexible version. 
TODO merge from dweb-transport back to here.
```
tag     lowercase tag e.g. 'img'
attrs   dictionary of attributes to set, the values of this dictionary can be objects
children    Any number of parameters each being a HtmlElement or an array of Elements.
```
