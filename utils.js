// Keep this light, ideally dont put anything needing a "require" in here
utils = {}; //utility functions

//Parts of this file (consolearr, and createElement) are duplicated in dweb-transport; dweb-transports and dweb-objects repo

// ==== OBJECT ORIENTED JAVASCRIPT ===============

// Utility function to print a array of items but just show number and last.
utils.consolearr  = (arr) => ((arr && arr.length >0) ? [arr.length+" items inc:", arr[arr.length-1]] : arr );

/*
Quick intersection for short arrays. Note there are better solutions exist for longer arrays
This is intended for comparing two sets of probably equal, but possibly just intersecting URLs

a, b    (shortish) arrays
Returns true if two shortish arrays a and b intersect
    or if b is not an array, then if b is in a
    If a is undefined then result is false
 */
utils.intersects = (a,b) =>  a ? (Array.isArray(b) ? a.some(x => b.includes(x)) : a.includes(b)) : false ;

utils.mergeTypedArraysUnsafe = function(a, b) { // Take care of inability to concatenate typed arrays such as Uint8
    //http://stackoverflow.com/questions/14071463/how-can-i-merge-typedarrays-in-javascript also has a safe version
    const c = new a.constructor(a.length + b.length);
    c.set(a);
    c.set(b, a.length);
    return c;
};

utils.objectfrom = function(data, hints={}) {
    // Generic way to turn something into a object (typically expecting a string, or a buffer)
    // This can get weird, there appear to be two DIFFERENT Uint8Arrays, one has a constructor "TypedArray" the other "Uint8Array"
    // "TypedArray" doesnt appear to be defined so can't test if its an instance of that, but in tests the TypedArray ones are
    // not instances of Buffer and need converting first
    if ((data instanceof Uint8Array) && !(data instanceof Buffer)) return utils.objectfrom(new Buffer(data));
    return (typeof data === "string" || data instanceof Buffer || data instanceof Uint8Array) ? JSON.parse(data) : data;
}

utils.keyFilter = function(dic, keys) {
    // Utility to return a new dic containing each of keys (equivalent to python { dic[k] for k in keys }
    return keys.reduce(function(prev, key) { prev[key] = dic[key]; return prev; }, {});
}

utils.display_blob = function(bb, options) {
    /*
        Display a blob of data (in a browser)
        Typical usage Dweb.utils.display_blob(await Dweb.Transports.p_rawfetch(urls), {type: "application/pdf"})
        bb: Data to display, either as blob or something that can be passed to Blob([bb]) e.g. a buffer
        options:    {
            type: mimetype  (required if bb not already a blob)
            target:     Where to display e.g. "_blank" or "_self"
        }
        TODO probably extend this to do a download which has some code in archive/*js to handle
     */
    // See https://developer.mozilla.org/en-US/docs/Web/API/URL/createObjectURL
    // and https://stackoverflow.com/questions/3665115/create-a-file-in-memory-for-user-to-download-not-through-server
    if (!(bb instanceof Blob)) {
        console.log("display_blob: creating with type",options.type);
        bb = new Blob([bb], {type: options.type})
    }
    console.log("display_blob:",typeof bb);
    // This next code is bizarre combination needed to open a blob from within an HTML window.
    let a = window.document.createElement('a');
    //bb = new Blob([datapdf], {type: 'application/pdf'});
    let objectURL = URL.createObjectURL(bb);
    a.href = objectURL;
    a.target= (options && options.target) || "_blank";                      // Open in new window by default
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    //URL.revokeObjectURL(objectURL)    //TODO figure out when can do this - maybe last one, or maybe dont care?
}
utils.createElement = function(tag, attrs, children) {        // Note arguments is set to tag, attrs, child1, child2 etc
    // Note identical version in dweb-transport/js/utils.js and dweb-transports/utils.js and dweb-objects/utils.js
    var element = document.createElement(tag);
    for (let name in attrs) {
        let attrname = (name.toLowerCase() === "classname" ? "class" : name);
        if (name === "dangerouslySetInnerHTML") {
            element.innerHTML = attrs[name]["__html"];
            delete attrs.dangerouslySetInnerHTML;
        }
        if (attrs.hasOwnProperty(name)) {
            let value = attrs[name];
            if (value === true) {
                element.setAttribute(attrname, name);
            } else if (typeof value === "object" && !Array.isArray(value)) { // e.g. style: {{fontSize: "124px"}}
                if (["style"].includes(attrname)) {
                    for (let k in value) {
                        element[attrname][k] = value[k];
                    }
                } else {
                    // Assume we are really trying to set the value to an object, allow it
                    element[attrname] = value;  // Wont let us use setAttribute(attrname, value) unclear if because unknow attribute or object
                }
            } else if (value !== false && value != null) {
                element.setAttribute(attrname, value.toString());
            }
        }
    }
    for (let i = 2; i < arguments.length; i++) { // Everything after attrs
        let child = arguments[i];
        if (!child) {
        } else if (Array.isArray(child)) {
            child.map((c) => element.appendChild(c.nodeType == null ?
                document.createTextNode(c.toString()) : c))
        }
        else {
            element.appendChild(
                child.nodeType == null ?
                    document.createTextNode(child.toString()) : child);
        }
    }
    return element;
}

exports = module.exports = utils;
