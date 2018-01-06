
/** vim: et:ts=4:sw=4:sts=4
 * @license RequireJS 2.3.5 Copyright jQuery Foundation and other contributors.
 * Released under MIT license, https://github.com/requirejs/requirejs/blob/master/LICENSE
 */
//Not using strict: uneven strict support in browsers, #392, and causes
//problems with requirejs.exec()/transpiler plugins that may not be strict.
/*jslint regexp: true, nomen: true, sloppy: true */
/*global window, navigator, document, importScripts, setTimeout, opera */

var requirejs, require, define;
(function (global, setTimeout) {
    var req, s, head, baseElement, dataMain, src,
        interactiveScript, currentlyAddingScript, mainScript, subPath,
        version = '2.3.5',
        commentRegExp = /\/\*[\s\S]*?\*\/|([^:"'=]|^)\/\/.*$/mg,
        cjsRequireRegExp = /[^.]\s*require\s*\(\s*["']([^'"\s]+)["']\s*\)/g,
        jsSuffixRegExp = /\.js$/,
        currDirRegExp = /^\.\//,
        op = Object.prototype,
        ostring = op.toString,
        hasOwn = op.hasOwnProperty,
        isBrowser = !!(typeof window !== 'undefined' && typeof navigator !== 'undefined' && window.document),
        isWebWorker = !isBrowser && typeof importScripts !== 'undefined',
        //PS3 indicates loaded and complete, but need to wait for complete
        //specifically. Sequence is 'loading', 'loaded', execution,
        // then 'complete'. The UA check is unfortunate, but not sure how
        //to feature test w/o causing perf issues.
        readyRegExp = isBrowser && navigator.platform === 'PLAYSTATION 3' ?
                      /^complete$/ : /^(complete|loaded)$/,
        defContextName = '_',
        //Oh the tragedy, detecting opera. See the usage of isOpera for reason.
        isOpera = typeof opera !== 'undefined' && opera.toString() === '[object Opera]',
        contexts = {},
        cfg = {},
        globalDefQueue = [],
        useInteractive = false;

    //Could match something like ')//comment', do not lose the prefix to comment.
    function commentReplace(match, singlePrefix) {
        return singlePrefix || '';
    }

    function isFunction(it) {
        return ostring.call(it) === '[object Function]';
    }

    function isArray(it) {
        return ostring.call(it) === '[object Array]';
    }

    /**
     * Helper function for iterating over an array. If the func returns
     * a true value, it will break out of the loop.
     */
    function each(ary, func) {
        if (ary) {
            var i;
            for (i = 0; i < ary.length; i += 1) {
                if (ary[i] && func(ary[i], i, ary)) {
                    break;
                }
            }
        }
    }

    /**
     * Helper function for iterating over an array backwards. If the func
     * returns a true value, it will break out of the loop.
     */
    function eachReverse(ary, func) {
        if (ary) {
            var i;
            for (i = ary.length - 1; i > -1; i -= 1) {
                if (ary[i] && func(ary[i], i, ary)) {
                    break;
                }
            }
        }
    }

    function hasProp(obj, prop) {
        return hasOwn.call(obj, prop);
    }

    function getOwn(obj, prop) {
        return hasProp(obj, prop) && obj[prop];
    }

    /**
     * Cycles over properties in an object and calls a function for each
     * property value. If the function returns a truthy value, then the
     * iteration is stopped.
     */
    function eachProp(obj, func) {
        var prop;
        for (prop in obj) {
            if (hasProp(obj, prop)) {
                if (func(obj[prop], prop)) {
                    break;
                }
            }
        }
    }

    /**
     * Simple function to mix in properties from source into target,
     * but only if target does not already have a property of the same name.
     */
    function mixin(target, source, force, deepStringMixin) {
        if (source) {
            eachProp(source, function (value, prop) {
                if (force || !hasProp(target, prop)) {
                    if (deepStringMixin && typeof value === 'object' && value &&
                        !isArray(value) && !isFunction(value) &&
                        !(value instanceof RegExp)) {

                        if (!target[prop]) {
                            target[prop] = {};
                        }
                        mixin(target[prop], value, force, deepStringMixin);
                    } else {
                        target[prop] = value;
                    }
                }
            });
        }
        return target;
    }

    //Similar to Function.prototype.bind, but the 'this' object is specified
    //first, since it is easier to read/figure out what 'this' will be.
    function bind(obj, fn) {
        return function () {
            return fn.apply(obj, arguments);
        };
    }

    function scripts() {
        return document.getElementsByTagName('script');
    }

    function defaultOnError(err) {
        throw err;
    }

    //Allow getting a global that is expressed in
    //dot notation, like 'a.b.c'.
    function getGlobal(value) {
        if (!value) {
            return value;
        }
        var g = global;
        each(value.split('.'), function (part) {
            g = g[part];
        });
        return g;
    }

    /**
     * Constructs an error with a pointer to an URL with more information.
     * @param {String} id the error ID that maps to an ID on a web page.
     * @param {String} message human readable error.
     * @param {Error} [err] the original error, if there is one.
     *
     * @returns {Error}
     */
    function makeError(id, msg, err, requireModules) {
        var e = new Error(msg + '\nhttp://requirejs.org/docs/errors.html#' + id);
        e.requireType = id;
        e.requireModules = requireModules;
        if (err) {
            e.originalError = err;
        }
        return e;
    }

    if (typeof define !== 'undefined') {
        //If a define is already in play via another AMD loader,
        //do not overwrite.
        return;
    }

    if (typeof requirejs !== 'undefined') {
        if (isFunction(requirejs)) {
            //Do not overwrite an existing requirejs instance.
            return;
        }
        cfg = requirejs;
        requirejs = undefined;
    }

    //Allow for a require config object
    if (typeof require !== 'undefined' && !isFunction(require)) {
        //assume it is a config object.
        cfg = require;
        require = undefined;
    }

    function newContext(contextName) {
        var inCheckLoaded, Module, context, handlers,
            checkLoadedTimeoutId,
            config = {
                //Defaults. Do not set a default for map
                //config to speed up normalize(), which
                //will run faster if there is no default.
                waitSeconds: 7,
                baseUrl: './',
                paths: {},
                bundles: {},
                pkgs: {},
                shim: {},
                config: {}
            },
            registry = {},
            //registry of just enabled modules, to speed
            //cycle breaking code when lots of modules
            //are registered, but not activated.
            enabledRegistry = {},
            undefEvents = {},
            defQueue = [],
            defined = {},
            urlFetched = {},
            bundlesMap = {},
            requireCounter = 1,
            unnormalizedCounter = 1;

        /**
         * Trims the . and .. from an array of path segments.
         * It will keep a leading path segment if a .. will become
         * the first path segment, to help with module name lookups,
         * which act like paths, but can be remapped. But the end result,
         * all paths that use this function should look normalized.
         * NOTE: this method MODIFIES the input array.
         * @param {Array} ary the array of path segments.
         */
        function trimDots(ary) {
            var i, part;
            for (i = 0; i < ary.length; i++) {
                part = ary[i];
                if (part === '.') {
                    ary.splice(i, 1);
                    i -= 1;
                } else if (part === '..') {
                    // If at the start, or previous value is still ..,
                    // keep them so that when converted to a path it may
                    // still work when converted to a path, even though
                    // as an ID it is less than ideal. In larger point
                    // releases, may be better to just kick out an error.
                    if (i === 0 || (i === 1 && ary[2] === '..') || ary[i - 1] === '..') {
                        continue;
                    } else if (i > 0) {
                        ary.splice(i - 1, 2);
                        i -= 2;
                    }
                }
            }
        }

        /**
         * Given a relative module name, like ./something, normalize it to
         * a real name that can be mapped to a path.
         * @param {String} name the relative name
         * @param {String} baseName a real name that the name arg is relative
         * to.
         * @param {Boolean} applyMap apply the map config to the value. Should
         * only be done if this normalization is for a dependency ID.
         * @returns {String} normalized name
         */
        function normalize(name, baseName, applyMap) {
            var pkgMain, mapValue, nameParts, i, j, nameSegment, lastIndex,
                foundMap, foundI, foundStarMap, starI, normalizedBaseParts,
                baseParts = (baseName && baseName.split('/')),
                map = config.map,
                starMap = map && map['*'];

            //Adjust any relative paths.
            if (name) {
                name = name.split('/');
                lastIndex = name.length - 1;

                // If wanting node ID compatibility, strip .js from end
                // of IDs. Have to do this here, and not in nameToUrl
                // because node allows either .js or non .js to map
                // to same file.
                if (config.nodeIdCompat && jsSuffixRegExp.test(name[lastIndex])) {
                    name[lastIndex] = name[lastIndex].replace(jsSuffixRegExp, '');
                }

                // Starts with a '.' so need the baseName
                if (name[0].charAt(0) === '.' && baseParts) {
                    //Convert baseName to array, and lop off the last part,
                    //so that . matches that 'directory' and not name of the baseName's
                    //module. For instance, baseName of 'one/two/three', maps to
                    //'one/two/three.js', but we want the directory, 'one/two' for
                    //this normalization.
                    normalizedBaseParts = baseParts.slice(0, baseParts.length - 1);
                    name = normalizedBaseParts.concat(name);
                }

                trimDots(name);
                name = name.join('/');
            }

            //Apply map config if available.
            if (applyMap && map && (baseParts || starMap)) {
                nameParts = name.split('/');

                outerLoop: for (i = nameParts.length; i > 0; i -= 1) {
                    nameSegment = nameParts.slice(0, i).join('/');

                    if (baseParts) {
                        //Find the longest baseName segment match in the config.
                        //So, do joins on the biggest to smallest lengths of baseParts.
                        for (j = baseParts.length; j > 0; j -= 1) {
                            mapValue = getOwn(map, baseParts.slice(0, j).join('/'));

                            //baseName segment has config, find if it has one for
                            //this name.
                            if (mapValue) {
                                mapValue = getOwn(mapValue, nameSegment);
                                if (mapValue) {
                                    //Match, update name to the new value.
                                    foundMap = mapValue;
                                    foundI = i;
                                    break outerLoop;
                                }
                            }
                        }
                    }

                    //Check for a star map match, but just hold on to it,
                    //if there is a shorter segment match later in a matching
                    //config, then favor over this star map.
                    if (!foundStarMap && starMap && getOwn(starMap, nameSegment)) {
                        foundStarMap = getOwn(starMap, nameSegment);
                        starI = i;
                    }
                }

                if (!foundMap && foundStarMap) {
                    foundMap = foundStarMap;
                    foundI = starI;
                }

                if (foundMap) {
                    nameParts.splice(0, foundI, foundMap);
                    name = nameParts.join('/');
                }
            }

            // If the name points to a package's name, use
            // the package main instead.
            pkgMain = getOwn(config.pkgs, name);

            return pkgMain ? pkgMain : name;
        }

        function removeScript(name) {
            if (isBrowser) {
                each(scripts(), function (scriptNode) {
                    if (scriptNode.getAttribute('data-requiremodule') === name &&
                            scriptNode.getAttribute('data-requirecontext') === context.contextName) {
                        scriptNode.parentNode.removeChild(scriptNode);
                        return true;
                    }
                });
            }
        }

        function hasPathFallback(id) {
            var pathConfig = getOwn(config.paths, id);
            if (pathConfig && isArray(pathConfig) && pathConfig.length > 1) {
                //Pop off the first array value, since it failed, and
                //retry
                pathConfig.shift();
                context.require.undef(id);

                //Custom require that does not do map translation, since
                //ID is "absolute", already mapped/resolved.
                context.makeRequire(null, {
                    skipMap: true
                })([id]);

                return true;
            }
        }

        //Turns a plugin!resource to [plugin, resource]
        //with the plugin being undefined if the name
        //did not have a plugin prefix.
        function splitPrefix(name) {
            var prefix,
                index = name ? name.indexOf('!') : -1;
            if (index > -1) {
                prefix = name.substring(0, index);
                name = name.substring(index + 1, name.length);
            }
            return [prefix, name];
        }

        /**
         * Creates a module mapping that includes plugin prefix, module
         * name, and path. If parentModuleMap is provided it will
         * also normalize the name via require.normalize()
         *
         * @param {String} name the module name
         * @param {String} [parentModuleMap] parent module map
         * for the module name, used to resolve relative names.
         * @param {Boolean} isNormalized: is the ID already normalized.
         * This is true if this call is done for a define() module ID.
         * @param {Boolean} applyMap: apply the map config to the ID.
         * Should only be true if this map is for a dependency.
         *
         * @returns {Object}
         */
        function makeModuleMap(name, parentModuleMap, isNormalized, applyMap) {
            var url, pluginModule, suffix, nameParts,
                prefix = null,
                parentName = parentModuleMap ? parentModuleMap.name : null,
                originalName = name,
                isDefine = true,
                normalizedName = '';

            //If no name, then it means it is a require call, generate an
            //internal name.
            if (!name) {
                isDefine = false;
                name = '_@r' + (requireCounter += 1);
            }

            nameParts = splitPrefix(name);
            prefix = nameParts[0];
            name = nameParts[1];

            if (prefix) {
                prefix = normalize(prefix, parentName, applyMap);
                pluginModule = getOwn(defined, prefix);
            }

            //Account for relative paths if there is a base name.
            if (name) {
                if (prefix) {
                    if (isNormalized) {
                        normalizedName = name;
                    } else if (pluginModule && pluginModule.normalize) {
                        //Plugin is loaded, use its normalize method.
                        normalizedName = pluginModule.normalize(name, function (name) {
                            return normalize(name, parentName, applyMap);
                        });
                    } else {
                        // If nested plugin references, then do not try to
                        // normalize, as it will not normalize correctly. This
                        // places a restriction on resourceIds, and the longer
                        // term solution is not to normalize until plugins are
                        // loaded and all normalizations to allow for async
                        // loading of a loader plugin. But for now, fixes the
                        // common uses. Details in #1131
                        normalizedName = name.indexOf('!') === -1 ?
                                         normalize(name, parentName, applyMap) :
                                         name;
                    }
                } else {
                    //A regular module.
                    normalizedName = normalize(name, parentName, applyMap);

                    //Normalized name may be a plugin ID due to map config
                    //application in normalize. The map config values must
                    //already be normalized, so do not need to redo that part.
                    nameParts = splitPrefix(normalizedName);
                    prefix = nameParts[0];
                    normalizedName = nameParts[1];
                    isNormalized = true;

                    url = context.nameToUrl(normalizedName);
                }
            }

            //If the id is a plugin id that cannot be determined if it needs
            //normalization, stamp it with a unique ID so two matching relative
            //ids that may conflict can be separate.
            suffix = prefix && !pluginModule && !isNormalized ?
                     '_unnormalized' + (unnormalizedCounter += 1) :
                     '';

            return {
                prefix: prefix,
                name: normalizedName,
                parentMap: parentModuleMap,
                unnormalized: !!suffix,
                url: url,
                originalName: originalName,
                isDefine: isDefine,
                id: (prefix ?
                        prefix + '!' + normalizedName :
                        normalizedName) + suffix
            };
        }

        function getModule(depMap) {
            var id = depMap.id,
                mod = getOwn(registry, id);

            if (!mod) {
                mod = registry[id] = new context.Module(depMap);
            }

            return mod;
        }

        function on(depMap, name, fn) {
            var id = depMap.id,
                mod = getOwn(registry, id);

            if (hasProp(defined, id) &&
                    (!mod || mod.defineEmitComplete)) {
                if (name === 'defined') {
                    fn(defined[id]);
                }
            } else {
                mod = getModule(depMap);
                if (mod.error && name === 'error') {
                    fn(mod.error);
                } else {
                    mod.on(name, fn);
                }
            }
        }

        function onError(err, errback) {
            var ids = err.requireModules,
                notified = false;

            if (errback) {
                errback(err);
            } else {
                each(ids, function (id) {
                    var mod = getOwn(registry, id);
                    if (mod) {
                        //Set error on module, so it skips timeout checks.
                        mod.error = err;
                        if (mod.events.error) {
                            notified = true;
                            mod.emit('error', err);
                        }
                    }
                });

                if (!notified) {
                    req.onError(err);
                }
            }
        }

        /**
         * Internal method to transfer globalQueue items to this context's
         * defQueue.
         */
        function takeGlobalQueue() {
            //Push all the globalDefQueue items into the context's defQueue
            if (globalDefQueue.length) {
                each(globalDefQueue, function(queueItem) {
                    var id = queueItem[0];
                    if (typeof id === 'string') {
                        context.defQueueMap[id] = true;
                    }
                    defQueue.push(queueItem);
                });
                globalDefQueue = [];
            }
        }

        handlers = {
            'require': function (mod) {
                if (mod.require) {
                    return mod.require;
                } else {
                    return (mod.require = context.makeRequire(mod.map));
                }
            },
            'exports': function (mod) {
                mod.usingExports = true;
                if (mod.map.isDefine) {
                    if (mod.exports) {
                        return (defined[mod.map.id] = mod.exports);
                    } else {
                        return (mod.exports = defined[mod.map.id] = {});
                    }
                }
            },
            'module': function (mod) {
                if (mod.module) {
                    return mod.module;
                } else {
                    return (mod.module = {
                        id: mod.map.id,
                        uri: mod.map.url,
                        config: function () {
                            return getOwn(config.config, mod.map.id) || {};
                        },
                        exports: mod.exports || (mod.exports = {})
                    });
                }
            }
        };

        function cleanRegistry(id) {
            //Clean up machinery used for waiting modules.
            delete registry[id];
            delete enabledRegistry[id];
        }

        function breakCycle(mod, traced, processed) {
            var id = mod.map.id;

            if (mod.error) {
                mod.emit('error', mod.error);
            } else {
                traced[id] = true;
                each(mod.depMaps, function (depMap, i) {
                    var depId = depMap.id,
                        dep = getOwn(registry, depId);

                    //Only force things that have not completed
                    //being defined, so still in the registry,
                    //and only if it has not been matched up
                    //in the module already.
                    if (dep && !mod.depMatched[i] && !processed[depId]) {
                        if (getOwn(traced, depId)) {
                            mod.defineDep(i, defined[depId]);
                            mod.check(); //pass false?
                        } else {
                            breakCycle(dep, traced, processed);
                        }
                    }
                });
                processed[id] = true;
            }
        }

        function checkLoaded() {
            var err, usingPathFallback,
                waitInterval = config.waitSeconds * 1000,
                //It is possible to disable the wait interval by using waitSeconds of 0.
                expired = waitInterval && (context.startTime + waitInterval) < new Date().getTime(),
                noLoads = [],
                reqCalls = [],
                stillLoading = false,
                needCycleCheck = true;

            //Do not bother if this call was a result of a cycle break.
            if (inCheckLoaded) {
                return;
            }

            inCheckLoaded = true;

            //Figure out the state of all the modules.
            eachProp(enabledRegistry, function (mod) {
                var map = mod.map,
                    modId = map.id;

                //Skip things that are not enabled or in error state.
                if (!mod.enabled) {
                    return;
                }

                if (!map.isDefine) {
                    reqCalls.push(mod);
                }

                if (!mod.error) {
                    //If the module should be executed, and it has not
                    //been inited and time is up, remember it.
                    if (!mod.inited && expired) {
                        if (hasPathFallback(modId)) {
                            usingPathFallback = true;
                            stillLoading = true;
                        } else {
                            noLoads.push(modId);
                            removeScript(modId);
                        }
                    } else if (!mod.inited && mod.fetched && map.isDefine) {
                        stillLoading = true;
                        if (!map.prefix) {
                            //No reason to keep looking for unfinished
                            //loading. If the only stillLoading is a
                            //plugin resource though, keep going,
                            //because it may be that a plugin resource
                            //is waiting on a non-plugin cycle.
                            return (needCycleCheck = false);
                        }
                    }
                }
            });

            if (expired && noLoads.length) {
                //If wait time expired, throw error of unloaded modules.
                err = makeError('timeout', 'Load timeout for modules: ' + noLoads, null, noLoads);
                err.contextName = context.contextName;
                return onError(err);
            }

            //Not expired, check for a cycle.
            if (needCycleCheck) {
                each(reqCalls, function (mod) {
                    breakCycle(mod, {}, {});
                });
            }

            //If still waiting on loads, and the waiting load is something
            //other than a plugin resource, or there are still outstanding
            //scripts, then just try back later.
            if ((!expired || usingPathFallback) && stillLoading) {
                //Something is still waiting to load. Wait for it, but only
                //if a timeout is not already in effect.
                if ((isBrowser || isWebWorker) && !checkLoadedTimeoutId) {
                    checkLoadedTimeoutId = setTimeout(function () {
                        checkLoadedTimeoutId = 0;
                        checkLoaded();
                    }, 50);
                }
            }

            inCheckLoaded = false;
        }

        Module = function (map) {
            this.events = getOwn(undefEvents, map.id) || {};
            this.map = map;
            this.shim = getOwn(config.shim, map.id);
            this.depExports = [];
            this.depMaps = [];
            this.depMatched = [];
            this.pluginMaps = {};
            this.depCount = 0;

            /* this.exports this.factory
               this.depMaps = [],
               this.enabled, this.fetched
            */
        };

        Module.prototype = {
            init: function (depMaps, factory, errback, options) {
                options = options || {};

                //Do not do more inits if already done. Can happen if there
                //are multiple define calls for the same module. That is not
                //a normal, common case, but it is also not unexpected.
                if (this.inited) {
                    return;
                }

                this.factory = factory;

                if (errback) {
                    //Register for errors on this module.
                    this.on('error', errback);
                } else if (this.events.error) {
                    //If no errback already, but there are error listeners
                    //on this module, set up an errback to pass to the deps.
                    errback = bind(this, function (err) {
                        this.emit('error', err);
                    });
                }

                //Do a copy of the dependency array, so that
                //source inputs are not modified. For example
                //"shim" deps are passed in here directly, and
                //doing a direct modification of the depMaps array
                //would affect that config.
                this.depMaps = depMaps && depMaps.slice(0);

                this.errback = errback;

                //Indicate this module has be initialized
                this.inited = true;

                this.ignore = options.ignore;

                //Could have option to init this module in enabled mode,
                //or could have been previously marked as enabled. However,
                //the dependencies are not known until init is called. So
                //if enabled previously, now trigger dependencies as enabled.
                if (options.enabled || this.enabled) {
                    //Enable this module and dependencies.
                    //Will call this.check()
                    this.enable();
                } else {
                    this.check();
                }
            },

            defineDep: function (i, depExports) {
                //Because of cycles, defined callback for a given
                //export can be called more than once.
                if (!this.depMatched[i]) {
                    this.depMatched[i] = true;
                    this.depCount -= 1;
                    this.depExports[i] = depExports;
                }
            },

            fetch: function () {
                if (this.fetched) {
                    return;
                }
                this.fetched = true;

                context.startTime = (new Date()).getTime();

                var map = this.map;

                //If the manager is for a plugin managed resource,
                //ask the plugin to load it now.
                if (this.shim) {
                    context.makeRequire(this.map, {
                        enableBuildCallback: true
                    })(this.shim.deps || [], bind(this, function () {
                        return map.prefix ? this.callPlugin() : this.load();
                    }));
                } else {
                    //Regular dependency.
                    return map.prefix ? this.callPlugin() : this.load();
                }
            },

            load: function () {
                var url = this.map.url;

                //Regular dependency.
                if (!urlFetched[url]) {
                    urlFetched[url] = true;
                    context.load(this.map.id, url);
                }
            },

            /**
             * Checks if the module is ready to define itself, and if so,
             * define it.
             */
            check: function () {
                if (!this.enabled || this.enabling) {
                    return;
                }

                var err, cjsModule,
                    id = this.map.id,
                    depExports = this.depExports,
                    exports = this.exports,
                    factory = this.factory;

                if (!this.inited) {
                    // Only fetch if not already in the defQueue.
                    if (!hasProp(context.defQueueMap, id)) {
                        this.fetch();
                    }
                } else if (this.error) {
                    this.emit('error', this.error);
                } else if (!this.defining) {
                    //The factory could trigger another require call
                    //that would result in checking this module to
                    //define itself again. If already in the process
                    //of doing that, skip this work.
                    this.defining = true;

                    if (this.depCount < 1 && !this.defined) {
                        if (isFunction(factory)) {
                            //If there is an error listener, favor passing
                            //to that instead of throwing an error. However,
                            //only do it for define()'d  modules. require
                            //errbacks should not be called for failures in
                            //their callbacks (#699). However if a global
                            //onError is set, use that.
                            if ((this.events.error && this.map.isDefine) ||
                                req.onError !== defaultOnError) {
                                try {
                                    exports = context.execCb(id, factory, depExports, exports);
                                } catch (e) {
                                    err = e;
                                }
                            } else {
                                exports = context.execCb(id, factory, depExports, exports);
                            }

                            // Favor return value over exports. If node/cjs in play,
                            // then will not have a return value anyway. Favor
                            // module.exports assignment over exports object.
                            if (this.map.isDefine && exports === undefined) {
                                cjsModule = this.module;
                                if (cjsModule) {
                                    exports = cjsModule.exports;
                                } else if (this.usingExports) {
                                    //exports already set the defined value.
                                    exports = this.exports;
                                }
                            }

                            if (err) {
                                err.requireMap = this.map;
                                err.requireModules = this.map.isDefine ? [this.map.id] : null;
                                err.requireType = this.map.isDefine ? 'define' : 'require';
                                return onError((this.error = err));
                            }

                        } else {
                            //Just a literal value
                            exports = factory;
                        }

                        this.exports = exports;

                        if (this.map.isDefine && !this.ignore) {
                            defined[id] = exports;

                            if (req.onResourceLoad) {
                                var resLoadMaps = [];
                                each(this.depMaps, function (depMap) {
                                    resLoadMaps.push(depMap.normalizedMap || depMap);
                                });
                                req.onResourceLoad(context, this.map, resLoadMaps);
                            }
                        }

                        //Clean up
                        cleanRegistry(id);

                        this.defined = true;
                    }

                    //Finished the define stage. Allow calling check again
                    //to allow define notifications below in the case of a
                    //cycle.
                    this.defining = false;

                    if (this.defined && !this.defineEmitted) {
                        this.defineEmitted = true;
                        this.emit('defined', this.exports);
                        this.defineEmitComplete = true;
                    }

                }
            },

            callPlugin: function () {
                var map = this.map,
                    id = map.id,
                    //Map already normalized the prefix.
                    pluginMap = makeModuleMap(map.prefix);

                //Mark this as a dependency for this plugin, so it
                //can be traced for cycles.
                this.depMaps.push(pluginMap);

                on(pluginMap, 'defined', bind(this, function (plugin) {
                    var load, normalizedMap, normalizedMod,
                        bundleId = getOwn(bundlesMap, this.map.id),
                        name = this.map.name,
                        parentName = this.map.parentMap ? this.map.parentMap.name : null,
                        localRequire = context.makeRequire(map.parentMap, {
                            enableBuildCallback: true
                        });

                    //If current map is not normalized, wait for that
                    //normalized name to load instead of continuing.
                    if (this.map.unnormalized) {
                        //Normalize the ID if the plugin allows it.
                        if (plugin.normalize) {
                            name = plugin.normalize(name, function (name) {
                                return normalize(name, parentName, true);
                            }) || '';
                        }

                        //prefix and name should already be normalized, no need
                        //for applying map config again either.
                        normalizedMap = makeModuleMap(map.prefix + '!' + name,
                                                      this.map.parentMap,
                                                      true);
                        on(normalizedMap,
                            'defined', bind(this, function (value) {
                                this.map.normalizedMap = normalizedMap;
                                this.init([], function () { return value; }, null, {
                                    enabled: true,
                                    ignore: true
                                });
                            }));

                        normalizedMod = getOwn(registry, normalizedMap.id);
                        if (normalizedMod) {
                            //Mark this as a dependency for this plugin, so it
                            //can be traced for cycles.
                            this.depMaps.push(normalizedMap);

                            if (this.events.error) {
                                normalizedMod.on('error', bind(this, function (err) {
                                    this.emit('error', err);
                                }));
                            }
                            normalizedMod.enable();
                        }

                        return;
                    }

                    //If a paths config, then just load that file instead to
                    //resolve the plugin, as it is built into that paths layer.
                    if (bundleId) {
                        this.map.url = context.nameToUrl(bundleId);
                        this.load();
                        return;
                    }

                    load = bind(this, function (value) {
                        this.init([], function () { return value; }, null, {
                            enabled: true
                        });
                    });

                    load.error = bind(this, function (err) {
                        this.inited = true;
                        this.error = err;
                        err.requireModules = [id];

                        //Remove temp unnormalized modules for this module,
                        //since they will never be resolved otherwise now.
                        eachProp(registry, function (mod) {
                            if (mod.map.id.indexOf(id + '_unnormalized') === 0) {
                                cleanRegistry(mod.map.id);
                            }
                        });

                        onError(err);
                    });

                    //Allow plugins to load other code without having to know the
                    //context or how to 'complete' the load.
                    load.fromText = bind(this, function (text, textAlt) {
                        /*jslint evil: true */
                        var moduleName = map.name,
                            moduleMap = makeModuleMap(moduleName),
                            hasInteractive = useInteractive;

                        //As of 2.1.0, support just passing the text, to reinforce
                        //fromText only being called once per resource. Still
                        //support old style of passing moduleName but discard
                        //that moduleName in favor of the internal ref.
                        if (textAlt) {
                            text = textAlt;
                        }

                        //Turn off interactive script matching for IE for any define
                        //calls in the text, then turn it back on at the end.
                        if (hasInteractive) {
                            useInteractive = false;
                        }

                        //Prime the system by creating a module instance for
                        //it.
                        getModule(moduleMap);

                        //Transfer any config to this other module.
                        if (hasProp(config.config, id)) {
                            config.config[moduleName] = config.config[id];
                        }

                        try {
                            req.exec(text);
                        } catch (e) {
                            return onError(makeError('fromtexteval',
                                             'fromText eval for ' + id +
                                            ' failed: ' + e,
                                             e,
                                             [id]));
                        }

                        if (hasInteractive) {
                            useInteractive = true;
                        }

                        //Mark this as a dependency for the plugin
                        //resource
                        this.depMaps.push(moduleMap);

                        //Support anonymous modules.
                        context.completeLoad(moduleName);

                        //Bind the value of that module to the value for this
                        //resource ID.
                        localRequire([moduleName], load);
                    });

                    //Use parentName here since the plugin's name is not reliable,
                    //could be some weird string with no path that actually wants to
                    //reference the parentName's path.
                    plugin.load(map.name, localRequire, load, config);
                }));

                context.enable(pluginMap, this);
                this.pluginMaps[pluginMap.id] = pluginMap;
            },

            enable: function () {
                enabledRegistry[this.map.id] = this;
                this.enabled = true;

                //Set flag mentioning that the module is enabling,
                //so that immediate calls to the defined callbacks
                //for dependencies do not trigger inadvertent load
                //with the depCount still being zero.
                this.enabling = true;

                //Enable each dependency
                each(this.depMaps, bind(this, function (depMap, i) {
                    var id, mod, handler;

                    if (typeof depMap === 'string') {
                        //Dependency needs to be converted to a depMap
                        //and wired up to this module.
                        depMap = makeModuleMap(depMap,
                                               (this.map.isDefine ? this.map : this.map.parentMap),
                                               false,
                                               !this.skipMap);
                        this.depMaps[i] = depMap;

                        handler = getOwn(handlers, depMap.id);

                        if (handler) {
                            this.depExports[i] = handler(this);
                            return;
                        }

                        this.depCount += 1;

                        on(depMap, 'defined', bind(this, function (depExports) {
                            if (this.undefed) {
                                return;
                            }
                            this.defineDep(i, depExports);
                            this.check();
                        }));

                        if (this.errback) {
                            on(depMap, 'error', bind(this, this.errback));
                        } else if (this.events.error) {
                            // No direct errback on this module, but something
                            // else is listening for errors, so be sure to
                            // propagate the error correctly.
                            on(depMap, 'error', bind(this, function(err) {
                                this.emit('error', err);
                            }));
                        }
                    }

                    id = depMap.id;
                    mod = registry[id];

                    //Skip special modules like 'require', 'exports', 'module'
                    //Also, don't call enable if it is already enabled,
                    //important in circular dependency cases.
                    if (!hasProp(handlers, id) && mod && !mod.enabled) {
                        context.enable(depMap, this);
                    }
                }));

                //Enable each plugin that is used in
                //a dependency
                eachProp(this.pluginMaps, bind(this, function (pluginMap) {
                    var mod = getOwn(registry, pluginMap.id);
                    if (mod && !mod.enabled) {
                        context.enable(pluginMap, this);
                    }
                }));

                this.enabling = false;

                this.check();
            },

            on: function (name, cb) {
                var cbs = this.events[name];
                if (!cbs) {
                    cbs = this.events[name] = [];
                }
                cbs.push(cb);
            },

            emit: function (name, evt) {
                each(this.events[name], function (cb) {
                    cb(evt);
                });
                if (name === 'error') {
                    //Now that the error handler was triggered, remove
                    //the listeners, since this broken Module instance
                    //can stay around for a while in the registry.
                    delete this.events[name];
                }
            }
        };

        function callGetModule(args) {
            //Skip modules already defined.
            if (!hasProp(defined, args[0])) {
                getModule(makeModuleMap(args[0], null, true)).init(args[1], args[2]);
            }
        }

        function removeListener(node, func, name, ieName) {
            //Favor detachEvent because of IE9
            //issue, see attachEvent/addEventListener comment elsewhere
            //in this file.
            if (node.detachEvent && !isOpera) {
                //Probably IE. If not it will throw an error, which will be
                //useful to know.
                if (ieName) {
                    node.detachEvent(ieName, func);
                }
            } else {
                node.removeEventListener(name, func, false);
            }
        }

        /**
         * Given an event from a script node, get the requirejs info from it,
         * and then removes the event listeners on the node.
         * @param {Event} evt
         * @returns {Object}
         */
        function getScriptData(evt) {
            //Using currentTarget instead of target for Firefox 2.0's sake. Not
            //all old browsers will be supported, but this one was easy enough
            //to support and still makes sense.
            var node = evt.currentTarget || evt.srcElement;

            //Remove the listeners once here.
            removeListener(node, context.onScriptLoad, 'load', 'onreadystatechange');
            removeListener(node, context.onScriptError, 'error');

            return {
                node: node,
                id: node && node.getAttribute('data-requiremodule')
            };
        }

        function intakeDefines() {
            var args;

            //Any defined modules in the global queue, intake them now.
            takeGlobalQueue();

            //Make sure any remaining defQueue items get properly processed.
            while (defQueue.length) {
                args = defQueue.shift();
                if (args[0] === null) {
                    return onError(makeError('mismatch', 'Mismatched anonymous define() module: ' +
                        args[args.length - 1]));
                } else {
                    //args are id, deps, factory. Should be normalized by the
                    //define() function.
                    callGetModule(args);
                }
            }
            context.defQueueMap = {};
        }

        context = {
            config: config,
            contextName: contextName,
            registry: registry,
            defined: defined,
            urlFetched: urlFetched,
            defQueue: defQueue,
            defQueueMap: {},
            Module: Module,
            makeModuleMap: makeModuleMap,
            nextTick: req.nextTick,
            onError: onError,

            /**
             * Set a configuration for the context.
             * @param {Object} cfg config object to integrate.
             */
            configure: function (cfg) {
                //Make sure the baseUrl ends in a slash.
                if (cfg.baseUrl) {
                    if (cfg.baseUrl.charAt(cfg.baseUrl.length - 1) !== '/') {
                        cfg.baseUrl += '/';
                    }
                }

                // Convert old style urlArgs string to a function.
                if (typeof cfg.urlArgs === 'string') {
                    var urlArgs = cfg.urlArgs;
                    cfg.urlArgs = function(id, url) {
                        return (url.indexOf('?') === -1 ? '?' : '&') + urlArgs;
                    };
                }

                //Save off the paths since they require special processing,
                //they are additive.
                var shim = config.shim,
                    objs = {
                        paths: true,
                        bundles: true,
                        config: true,
                        map: true
                    };

                eachProp(cfg, function (value, prop) {
                    if (objs[prop]) {
                        if (!config[prop]) {
                            config[prop] = {};
                        }
                        mixin(config[prop], value, true, true);
                    } else {
                        config[prop] = value;
                    }
                });

                //Reverse map the bundles
                if (cfg.bundles) {
                    eachProp(cfg.bundles, function (value, prop) {
                        each(value, function (v) {
                            if (v !== prop) {
                                bundlesMap[v] = prop;
                            }
                        });
                    });
                }

                //Merge shim
                if (cfg.shim) {
                    eachProp(cfg.shim, function (value, id) {
                        //Normalize the structure
                        if (isArray(value)) {
                            value = {
                                deps: value
                            };
                        }
                        if ((value.exports || value.init) && !value.exportsFn) {
                            value.exportsFn = context.makeShimExports(value);
                        }
                        shim[id] = value;
                    });
                    config.shim = shim;
                }

                //Adjust packages if necessary.
                if (cfg.packages) {
                    each(cfg.packages, function (pkgObj) {
                        var location, name;

                        pkgObj = typeof pkgObj === 'string' ? {name: pkgObj} : pkgObj;

                        name = pkgObj.name;
                        location = pkgObj.location;
                        if (location) {
                            config.paths[name] = pkgObj.location;
                        }

                        //Save pointer to main module ID for pkg name.
                        //Remove leading dot in main, so main paths are normalized,
                        //and remove any trailing .js, since different package
                        //envs have different conventions: some use a module name,
                        //some use a file name.
                        config.pkgs[name] = pkgObj.name + '/' + (pkgObj.main || 'main')
                                     .replace(currDirRegExp, '')
                                     .replace(jsSuffixRegExp, '');
                    });
                }

                //If there are any "waiting to execute" modules in the registry,
                //update the maps for them, since their info, like URLs to load,
                //may have changed.
                eachProp(registry, function (mod, id) {
                    //If module already has init called, since it is too
                    //late to modify them, and ignore unnormalized ones
                    //since they are transient.
                    if (!mod.inited && !mod.map.unnormalized) {
                        mod.map = makeModuleMap(id, null, true);
                    }
                });

                //If a deps array or a config callback is specified, then call
                //require with those args. This is useful when require is defined as a
                //config object before require.js is loaded.
                if (cfg.deps || cfg.callback) {
                    context.require(cfg.deps || [], cfg.callback);
                }
            },

            makeShimExports: function (value) {
                function fn() {
                    var ret;
                    if (value.init) {
                        ret = value.init.apply(global, arguments);
                    }
                    return ret || (value.exports && getGlobal(value.exports));
                }
                return fn;
            },

            makeRequire: function (relMap, options) {
                options = options || {};

                function localRequire(deps, callback, errback) {
                    var id, map, requireMod;

                    if (options.enableBuildCallback && callback && isFunction(callback)) {
                        callback.__requireJsBuild = true;
                    }

                    if (typeof deps === 'string') {
                        if (isFunction(callback)) {
                            //Invalid call
                            return onError(makeError('requireargs', 'Invalid require call'), errback);
                        }

                        //If require|exports|module are requested, get the
                        //value for them from the special handlers. Caveat:
                        //this only works while module is being defined.
                        if (relMap && hasProp(handlers, deps)) {
                            return handlers[deps](registry[relMap.id]);
                        }

                        //Synchronous access to one module. If require.get is
                        //available (as in the Node adapter), prefer that.
                        if (req.get) {
                            return req.get(context, deps, relMap, localRequire);
                        }

                        //Normalize module name, if it contains . or ..
                        map = makeModuleMap(deps, relMap, false, true);
                        id = map.id;

                        if (!hasProp(defined, id)) {
                            return onError(makeError('notloaded', 'Module name "' +
                                        id +
                                        '" has not been loaded yet for context: ' +
                                        contextName +
                                        (relMap ? '' : '. Use require([])')));
                        }
                        return defined[id];
                    }

                    //Grab defines waiting in the global queue.
                    intakeDefines();

                    //Mark all the dependencies as needing to be loaded.
                    context.nextTick(function () {
                        //Some defines could have been added since the
                        //require call, collect them.
                        intakeDefines();

                        requireMod = getModule(makeModuleMap(null, relMap));

                        //Store if map config should be applied to this require
                        //call for dependencies.
                        requireMod.skipMap = options.skipMap;

                        requireMod.init(deps, callback, errback, {
                            enabled: true
                        });

                        checkLoaded();
                    });

                    return localRequire;
                }

                mixin(localRequire, {
                    isBrowser: isBrowser,

                    /**
                     * Converts a module name + .extension into an URL path.
                     * *Requires* the use of a module name. It does not support using
                     * plain URLs like nameToUrl.
                     */
                    toUrl: function (moduleNamePlusExt) {
                        var ext,
                            index = moduleNamePlusExt.lastIndexOf('.'),
                            segment = moduleNamePlusExt.split('/')[0],
                            isRelative = segment === '.' || segment === '..';

                        //Have a file extension alias, and it is not the
                        //dots from a relative path.
                        if (index !== -1 && (!isRelative || index > 1)) {
                            ext = moduleNamePlusExt.substring(index, moduleNamePlusExt.length);
                            moduleNamePlusExt = moduleNamePlusExt.substring(0, index);
                        }

                        return context.nameToUrl(normalize(moduleNamePlusExt,
                                                relMap && relMap.id, true), ext,  true);
                    },

                    defined: function (id) {
                        return hasProp(defined, makeModuleMap(id, relMap, false, true).id);
                    },

                    specified: function (id) {
                        id = makeModuleMap(id, relMap, false, true).id;
                        return hasProp(defined, id) || hasProp(registry, id);
                    }
                });

                //Only allow undef on top level require calls
                if (!relMap) {
                    localRequire.undef = function (id) {
                        //Bind any waiting define() calls to this context,
                        //fix for #408
                        takeGlobalQueue();

                        var map = makeModuleMap(id, relMap, true),
                            mod = getOwn(registry, id);

                        mod.undefed = true;
                        removeScript(id);

                        delete defined[id];
                        delete urlFetched[map.url];
                        delete undefEvents[id];

                        //Clean queued defines too. Go backwards
                        //in array so that the splices do not
                        //mess up the iteration.
                        eachReverse(defQueue, function(args, i) {
                            if (args[0] === id) {
                                defQueue.splice(i, 1);
                            }
                        });
                        delete context.defQueueMap[id];

                        if (mod) {
                            //Hold on to listeners in case the
                            //module will be attempted to be reloaded
                            //using a different config.
                            if (mod.events.defined) {
                                undefEvents[id] = mod.events;
                            }

                            cleanRegistry(id);
                        }
                    };
                }

                return localRequire;
            },

            /**
             * Called to enable a module if it is still in the registry
             * awaiting enablement. A second arg, parent, the parent module,
             * is passed in for context, when this method is overridden by
             * the optimizer. Not shown here to keep code compact.
             */
            enable: function (depMap) {
                var mod = getOwn(registry, depMap.id);
                if (mod) {
                    getModule(depMap).enable();
                }
            },

            /**
             * Internal method used by environment adapters to complete a load event.
             * A load event could be a script load or just a load pass from a synchronous
             * load call.
             * @param {String} moduleName the name of the module to potentially complete.
             */
            completeLoad: function (moduleName) {
                var found, args, mod,
                    shim = getOwn(config.shim, moduleName) || {},
                    shExports = shim.exports;

                takeGlobalQueue();

                while (defQueue.length) {
                    args = defQueue.shift();
                    if (args[0] === null) {
                        args[0] = moduleName;
                        //If already found an anonymous module and bound it
                        //to this name, then this is some other anon module
                        //waiting for its completeLoad to fire.
                        if (found) {
                            break;
                        }
                        found = true;
                    } else if (args[0] === moduleName) {
                        //Found matching define call for this script!
                        found = true;
                    }

                    callGetModule(args);
                }
                context.defQueueMap = {};

                //Do this after the cycle of callGetModule in case the result
                //of those calls/init calls changes the registry.
                mod = getOwn(registry, moduleName);

                if (!found && !hasProp(defined, moduleName) && mod && !mod.inited) {
                    if (config.enforceDefine && (!shExports || !getGlobal(shExports))) {
                        if (hasPathFallback(moduleName)) {
                            return;
                        } else {
                            return onError(makeError('nodefine',
                                             'No define call for ' + moduleName,
                                             null,
                                             [moduleName]));
                        }
                    } else {
                        //A script that does not call define(), so just simulate
                        //the call for it.
                        callGetModule([moduleName, (shim.deps || []), shim.exportsFn]);
                    }
                }

                checkLoaded();
            },

            /**
             * Converts a module name to a file path. Supports cases where
             * moduleName may actually be just an URL.
             * Note that it **does not** call normalize on the moduleName,
             * it is assumed to have already been normalized. This is an
             * internal API, not a public one. Use toUrl for the public API.
             */
            nameToUrl: function (moduleName, ext, skipExt) {
                var paths, syms, i, parentModule, url,
                    parentPath, bundleId,
                    pkgMain = getOwn(config.pkgs, moduleName);

                if (pkgMain) {
                    moduleName = pkgMain;
                }

                bundleId = getOwn(bundlesMap, moduleName);

                if (bundleId) {
                    return context.nameToUrl(bundleId, ext, skipExt);
                }

                //If a colon is in the URL, it indicates a protocol is used and it is just
                //an URL to a file, or if it starts with a slash, contains a query arg (i.e. ?)
                //or ends with .js, then assume the user meant to use an url and not a module id.
                //The slash is important for protocol-less URLs as well as full paths.
                if (req.jsExtRegExp.test(moduleName)) {
                    //Just a plain path, not module name lookup, so just return it.
                    //Add extension if it is included. This is a bit wonky, only non-.js things pass
                    //an extension, this method probably needs to be reworked.
                    url = moduleName + (ext || '');
                } else {
                    //A module that needs to be converted to a path.
                    paths = config.paths;

                    syms = moduleName.split('/');
                    //For each module name segment, see if there is a path
                    //registered for it. Start with most specific name
                    //and work up from it.
                    for (i = syms.length; i > 0; i -= 1) {
                        parentModule = syms.slice(0, i).join('/');

                        parentPath = getOwn(paths, parentModule);
                        if (parentPath) {
                            //If an array, it means there are a few choices,
                            //Choose the one that is desired
                            if (isArray(parentPath)) {
                                parentPath = parentPath[0];
                            }
                            syms.splice(0, i, parentPath);
                            break;
                        }
                    }

                    //Join the path parts together, then figure out if baseUrl is needed.
                    url = syms.join('/');
                    url += (ext || (/^data\:|^blob\:|\?/.test(url) || skipExt ? '' : '.js'));
                    url = (url.charAt(0) === '/' || url.match(/^[\w\+\.\-]+:/) ? '' : config.baseUrl) + url;
                }

                return config.urlArgs && !/^blob\:/.test(url) ?
                       url + config.urlArgs(moduleName, url) : url;
            },

            //Delegates to req.load. Broken out as a separate function to
            //allow overriding in the optimizer.
            load: function (id, url) {
                req.load(context, id, url);
            },

            /**
             * Executes a module callback function. Broken out as a separate function
             * solely to allow the build system to sequence the files in the built
             * layer in the right sequence.
             *
             * @private
             */
            execCb: function (name, callback, args, exports) {
                return callback.apply(exports, args);
            },

            /**
             * callback for script loads, used to check status of loading.
             *
             * @param {Event} evt the event from the browser for the script
             * that was loaded.
             */
            onScriptLoad: function (evt) {
                //Using currentTarget instead of target for Firefox 2.0's sake. Not
                //all old browsers will be supported, but this one was easy enough
                //to support and still makes sense.
                if (evt.type === 'load' ||
                        (readyRegExp.test((evt.currentTarget || evt.srcElement).readyState))) {
                    //Reset interactive script so a script node is not held onto for
                    //to long.
                    interactiveScript = null;

                    //Pull out the name of the module and the context.
                    var data = getScriptData(evt);
                    context.completeLoad(data.id);
                }
            },

            /**
             * Callback for script errors.
             */
            onScriptError: function (evt) {
                var data = getScriptData(evt);
                if (!hasPathFallback(data.id)) {
                    var parents = [];
                    eachProp(registry, function(value, key) {
                        if (key.indexOf('_@r') !== 0) {
                            each(value.depMaps, function(depMap) {
                                if (depMap.id === data.id) {
                                    parents.push(key);
                                    return true;
                                }
                            });
                        }
                    });
                    return onError(makeError('scripterror', 'Script error for "' + data.id +
                                             (parents.length ?
                                             '", needed by: ' + parents.join(', ') :
                                             '"'), evt, [data.id]));
                }
            }
        };

        context.require = context.makeRequire();
        return context;
    }

    /**
     * Main entry point.
     *
     * If the only argument to require is a string, then the module that
     * is represented by that string is fetched for the appropriate context.
     *
     * If the first argument is an array, then it will be treated as an array
     * of dependency string names to fetch. An optional function callback can
     * be specified to execute when all of those dependencies are available.
     *
     * Make a local req variable to help Caja compliance (it assumes things
     * on a require that are not standardized), and to give a short
     * name for minification/local scope use.
     */
    req = requirejs = function (deps, callback, errback, optional) {

        //Find the right context, use default
        var context, config,
            contextName = defContextName;

        // Determine if have config object in the call.
        if (!isArray(deps) && typeof deps !== 'string') {
            // deps is a config object
            config = deps;
            if (isArray(callback)) {
                // Adjust args if there are dependencies
                deps = callback;
                callback = errback;
                errback = optional;
            } else {
                deps = [];
            }
        }

        if (config && config.context) {
            contextName = config.context;
        }

        context = getOwn(contexts, contextName);
        if (!context) {
            context = contexts[contextName] = req.s.newContext(contextName);
        }

        if (config) {
            context.configure(config);
        }

        return context.require(deps, callback, errback);
    };

    /**
     * Support require.config() to make it easier to cooperate with other
     * AMD loaders on globally agreed names.
     */
    req.config = function (config) {
        return req(config);
    };

    /**
     * Execute something after the current tick
     * of the event loop. Override for other envs
     * that have a better solution than setTimeout.
     * @param  {Function} fn function to execute later.
     */
    req.nextTick = typeof setTimeout !== 'undefined' ? function (fn) {
        setTimeout(fn, 4);
    } : function (fn) { fn(); };

    /**
     * Export require as a global, but only if it does not already exist.
     */
    if (!require) {
        require = req;
    }

    req.version = version;

    //Used to filter out dependencies that are already paths.
    req.jsExtRegExp = /^\/|:|\?|\.js$/;
    req.isBrowser = isBrowser;
    s = req.s = {
        contexts: contexts,
        newContext: newContext
    };

    //Create default context.
    req({});

    //Exports some context-sensitive methods on global require.
    each([
        'toUrl',
        'undef',
        'defined',
        'specified'
    ], function (prop) {
        //Reference from contexts instead of early binding to default context,
        //so that during builds, the latest instance of the default context
        //with its config gets used.
        req[prop] = function () {
            var ctx = contexts[defContextName];
            return ctx.require[prop].apply(ctx, arguments);
        };
    });

    if (isBrowser) {
        head = s.head = document.getElementsByTagName('head')[0];
        //If BASE tag is in play, using appendChild is a problem for IE6.
        //When that browser dies, this can be removed. Details in this jQuery bug:
        //http://dev.jquery.com/ticket/2709
        baseElement = document.getElementsByTagName('base')[0];
        if (baseElement) {
            head = s.head = baseElement.parentNode;
        }
    }

    /**
     * Any errors that require explicitly generates will be passed to this
     * function. Intercept/override it if you want custom error handling.
     * @param {Error} err the error object.
     */
    req.onError = defaultOnError;

    /**
     * Creates the node for the load command. Only used in browser envs.
     */
    req.createNode = function (config, moduleName, url) {
        var node = config.xhtml ?
                document.createElementNS('http://www.w3.org/1999/xhtml', 'html:script') :
                document.createElement('script');
        node.type = config.scriptType || 'text/javascript';
        node.charset = 'utf-8';
        node.async = true;
        return node;
    };

    /**
     * Does the request to load a module for the browser case.
     * Make this a separate function to allow other environments
     * to override it.
     *
     * @param {Object} context the require context to find state.
     * @param {String} moduleName the name of the module.
     * @param {Object} url the URL to the module.
     */
    req.load = function (context, moduleName, url) {
        var config = (context && context.config) || {},
            node;
        if (isBrowser) {
            //In the browser so use a script tag
            node = req.createNode(config, moduleName, url);

            node.setAttribute('data-requirecontext', context.contextName);
            node.setAttribute('data-requiremodule', moduleName);

            //Set up load listener. Test attachEvent first because IE9 has
            //a subtle issue in its addEventListener and script onload firings
            //that do not match the behavior of all other browsers with
            //addEventListener support, which fire the onload event for a
            //script right after the script execution. See:
            //https://connect.microsoft.com/IE/feedback/details/648057/script-onload-event-is-not-fired-immediately-after-script-execution
            //UNFORTUNATELY Opera implements attachEvent but does not follow the script
            //script execution mode.
            if (node.attachEvent &&
                    //Check if node.attachEvent is artificially added by custom script or
                    //natively supported by browser
                    //read https://github.com/requirejs/requirejs/issues/187
                    //if we can NOT find [native code] then it must NOT natively supported.
                    //in IE8, node.attachEvent does not have toString()
                    //Note the test for "[native code" with no closing brace, see:
                    //https://github.com/requirejs/requirejs/issues/273
                    !(node.attachEvent.toString && node.attachEvent.toString().indexOf('[native code') < 0) &&
                    !isOpera) {
                //Probably IE. IE (at least 6-8) do not fire
                //script onload right after executing the script, so
                //we cannot tie the anonymous define call to a name.
                //However, IE reports the script as being in 'interactive'
                //readyState at the time of the define call.
                useInteractive = true;

                node.attachEvent('onreadystatechange', context.onScriptLoad);
                //It would be great to add an error handler here to catch
                //404s in IE9+. However, onreadystatechange will fire before
                //the error handler, so that does not help. If addEventListener
                //is used, then IE will fire error before load, but we cannot
                //use that pathway given the connect.microsoft.com issue
                //mentioned above about not doing the 'script execute,
                //then fire the script load event listener before execute
                //next script' that other browsers do.
                //Best hope: IE10 fixes the issues,
                //and then destroys all installs of IE 6-9.
                //node.attachEvent('onerror', context.onScriptError);
            } else {
                node.addEventListener('load', context.onScriptLoad, false);
                node.addEventListener('error', context.onScriptError, false);
            }
            node.src = url;

            //Calling onNodeCreated after all properties on the node have been
            //set, but before it is placed in the DOM.
            if (config.onNodeCreated) {
                config.onNodeCreated(node, config, moduleName, url);
            }

            //For some cache cases in IE 6-8, the script executes before the end
            //of the appendChild execution, so to tie an anonymous define
            //call to the module name (which is stored on the node), hold on
            //to a reference to this node, but clear after the DOM insertion.
            currentlyAddingScript = node;
            if (baseElement) {
                head.insertBefore(node, baseElement);
            } else {
                head.appendChild(node);
            }
            currentlyAddingScript = null;

            return node;
        } else if (isWebWorker) {
            try {
                //In a web worker, use importScripts. This is not a very
                //efficient use of importScripts, importScripts will block until
                //its script is downloaded and evaluated. However, if web workers
                //are in play, the expectation is that a build has been done so
                //that only one script needs to be loaded anyway. This may need
                //to be reevaluated if other use cases become common.

                // Post a task to the event loop to work around a bug in WebKit
                // where the worker gets garbage-collected after calling
                // importScripts(): https://webkit.org/b/153317
                setTimeout(function() {}, 0);
                importScripts(url);

                //Account for anonymous modules
                context.completeLoad(moduleName);
            } catch (e) {
                context.onError(makeError('importscripts',
                                'importScripts failed for ' +
                                    moduleName + ' at ' + url,
                                e,
                                [moduleName]));
            }
        }
    };

    function getInteractiveScript() {
        if (interactiveScript && interactiveScript.readyState === 'interactive') {
            return interactiveScript;
        }

        eachReverse(scripts(), function (script) {
            if (script.readyState === 'interactive') {
                return (interactiveScript = script);
            }
        });
        return interactiveScript;
    }

    //Look for a data-main script attribute, which could also adjust the baseUrl.
    if (isBrowser && !cfg.skipDataMain) {
        //Figure out baseUrl. Get it from the script tag with require.js in it.
        eachReverse(scripts(), function (script) {
            //Set the 'head' where we can append children by
            //using the script's parent.
            if (!head) {
                head = script.parentNode;
            }

            //Look for a data-main attribute to set main script for the page
            //to load. If it is there, the path to data main becomes the
            //baseUrl, if it is not already set.
            dataMain = script.getAttribute('data-main');
            if (dataMain) {
                //Preserve dataMain in case it is a path (i.e. contains '?')
                mainScript = dataMain;

                //Set final baseUrl if there is not already an explicit one,
                //but only do so if the data-main value is not a loader plugin
                //module ID.
                if (!cfg.baseUrl && mainScript.indexOf('!') === -1) {
                    //Pull off the directory of data-main for use as the
                    //baseUrl.
                    src = mainScript.split('/');
                    mainScript = src.pop();
                    subPath = src.length ? src.join('/')  + '/' : './';

                    cfg.baseUrl = subPath;
                }

                //Strip off any trailing .js since mainScript is now
                //like a module name.
                mainScript = mainScript.replace(jsSuffixRegExp, '');

                //If mainScript is still a path, fall back to dataMain
                if (req.jsExtRegExp.test(mainScript)) {
                    mainScript = dataMain;
                }

                //Put the data-main script in the files to load.
                cfg.deps = cfg.deps ? cfg.deps.concat(mainScript) : [mainScript];

                return true;
            }
        });
    }

    /**
     * The function that handles definitions of modules. Differs from
     * require() in that a string for the module should be the first argument,
     * and the function to execute after dependencies are loaded should
     * return a value to define the module corresponding to the first argument's
     * name.
     */
    define = function (name, deps, callback) {
        var node, context;

        //Allow for anonymous modules
        if (typeof name !== 'string') {
            //Adjust args appropriately
            callback = deps;
            deps = name;
            name = null;
        }

        //This module may not have dependencies
        if (!isArray(deps)) {
            callback = deps;
            deps = null;
        }

        //If no name, and callback is a function, then figure out if it a
        //CommonJS thing with dependencies.
        if (!deps && isFunction(callback)) {
            deps = [];
            //Remove comments from the callback string,
            //look for require calls, and pull them into the dependencies,
            //but only if there are function args.
            if (callback.length) {
                callback
                    .toString()
                    .replace(commentRegExp, commentReplace)
                    .replace(cjsRequireRegExp, function (match, dep) {
                        deps.push(dep);
                    });

                //May be a CommonJS thing even without require calls, but still
                //could use exports, and module. Avoid doing exports and module
                //work though if it just needs require.
                //REQUIRES the function to expect the CommonJS variables in the
                //order listed below.
                deps = (callback.length === 1 ? ['require'] : ['require', 'exports', 'module']).concat(deps);
            }
        }

        //If in IE 6-8 and hit an anonymous define() call, do the interactive
        //work.
        if (useInteractive) {
            node = currentlyAddingScript || getInteractiveScript();
            if (node) {
                if (!name) {
                    name = node.getAttribute('data-requiremodule');
                }
                context = contexts[node.getAttribute('data-requirecontext')];
            }
        }

        //Always save off evaluating the def call until the script onload handler.
        //This allows multiple modules to be in a file without prematurely
        //tracing dependencies, and allows for anonymous module support,
        //where the module name is not known until the script onload event
        //occurs. If no context, use the global queue, and get it processed
        //in the onscript load callback.
        if (context) {
            context.defQueue.push([name, deps, callback]);
            context.defQueueMap[name] = true;
        } else {
            globalDefQueue.push([name, deps, callback]);
        }
    };

    define.amd = {
        jQuery: true
    };

    /**
     * Executes the text. Normally just uses eval, but can be modified
     * to use a better, environment-specific call. Only used for transpiling
     * loader plugins, not for plain JS modules.
     * @param {String} text the text to execute/evaluate.
     */
    req.exec = function (text) {
        /*jslint evil: true */
        return eval(text);
    };

    //Set up with config info.
    req(cfg);
}(this, (typeof setTimeout === 'undefined' ? undefined : setTimeout)));

define("requireLib", function(){});

/*!
 * Knockout JavaScript library v3.4.2
 * (c) The Knockout.js team - http://knockoutjs.com/
 * License: MIT (http://www.opensource.org/licenses/mit-license.php)
 */

(function() {(function(n){var x=this||(0,eval)("this"),t=x.document,M=x.navigator,u=x.jQuery,H=x.JSON;(function(n){"function"===typeof define&&define.amd?define('knockout',["exports","require"],n):"object"===typeof exports&&"object"===typeof module?n(module.exports||exports):n(x.ko={})})(function(N,O){function J(a,c){return null===a||typeof a in R?a===c:!1}function S(b,c){var d;return function(){d||(d=a.a.setTimeout(function(){d=n;b()},c))}}function T(b,c){var d;return function(){clearTimeout(d);d=a.a.setTimeout(b,c)}}function U(a,
c){c&&c!==E?"beforeChange"===c?this.Ob(a):this.Ja(a,c):this.Pb(a)}function V(a,c){null!==c&&c.k&&c.k()}function W(a,c){var d=this.Mc,e=d[s];e.T||(this.ob&&this.Oa[c]?(d.Sb(c,a,this.Oa[c]),this.Oa[c]=null,--this.ob):e.s[c]||d.Sb(c,a,e.t?{$:a}:d.yc(a)),a.Ha&&a.Hc())}function K(b,c,d,e){a.d[b]={init:function(b,g,h,l,m){var k,r;a.m(function(){var q=g(),p=a.a.c(q),p=!d!==!p,A=!r;if(A||c||p!==k)A&&a.xa.Ca()&&(r=a.a.wa(a.f.childNodes(b),!0)),p?(A||a.f.fa(b,a.a.wa(r)),a.hb(e?e(m,q):m,b)):a.f.za(b),k=p},null,
{i:b});return{controlsDescendantBindings:!0}}};a.h.va[b]=!1;a.f.aa[b]=!0}var a="undefined"!==typeof N?N:{};a.b=function(b,c){for(var d=b.split("."),e=a,f=0;f<d.length-1;f++)e=e[d[f]];e[d[d.length-1]]=c};a.H=function(a,c,d){a[c]=d};a.version="3.4.2";a.b("version",a.version);a.options={deferUpdates:!1,useOnlyNativeEvents:!1};a.a=function(){function b(a,b){for(var c in a)a.hasOwnProperty(c)&&b(c,a[c])}function c(a,b){if(b)for(var c in b)b.hasOwnProperty(c)&&(a[c]=b[c]);return a}function d(a,b){a.__proto__=
b;return a}function e(b,c,d,e){var m=b[c].match(r)||[];a.a.r(d.match(r),function(b){a.a.ra(m,b,e)});b[c]=m.join(" ")}var f={__proto__:[]}instanceof Array,g="function"===typeof Symbol,h={},l={};h[M&&/Firefox\/2/i.test(M.userAgent)?"KeyboardEvent":"UIEvents"]=["keyup","keydown","keypress"];h.MouseEvents="click dblclick mousedown mouseup mousemove mouseover mouseout mouseenter mouseleave".split(" ");b(h,function(a,b){if(b.length)for(var c=0,d=b.length;c<d;c++)l[b[c]]=a});var m={propertychange:!0},k=
t&&function(){for(var a=3,b=t.createElement("div"),c=b.getElementsByTagName("i");b.innerHTML="\x3c!--[if gt IE "+ ++a+"]><i></i><![endif]--\x3e",c[0];);return 4<a?a:n}(),r=/\S+/g;return{gc:["authenticity_token",/^__RequestVerificationToken(_.*)?$/],r:function(a,b){for(var c=0,d=a.length;c<d;c++)b(a[c],c)},o:function(a,b){if("function"==typeof Array.prototype.indexOf)return Array.prototype.indexOf.call(a,b);for(var c=0,d=a.length;c<d;c++)if(a[c]===b)return c;return-1},Vb:function(a,b,c){for(var d=
0,e=a.length;d<e;d++)if(b.call(c,a[d],d))return a[d];return null},Na:function(b,c){var d=a.a.o(b,c);0<d?b.splice(d,1):0===d&&b.shift()},Wb:function(b){b=b||[];for(var c=[],d=0,e=b.length;d<e;d++)0>a.a.o(c,b[d])&&c.push(b[d]);return c},ib:function(a,b){a=a||[];for(var c=[],d=0,e=a.length;d<e;d++)c.push(b(a[d],d));return c},Ma:function(a,b){a=a||[];for(var c=[],d=0,e=a.length;d<e;d++)b(a[d],d)&&c.push(a[d]);return c},ta:function(a,b){if(b instanceof Array)a.push.apply(a,b);else for(var c=0,d=b.length;c<
d;c++)a.push(b[c]);return a},ra:function(b,c,d){var e=a.a.o(a.a.Bb(b),c);0>e?d&&b.push(c):d||b.splice(e,1)},la:f,extend:c,$a:d,ab:f?d:c,D:b,Ea:function(a,b){if(!a)return a;var c={},d;for(d in a)a.hasOwnProperty(d)&&(c[d]=b(a[d],d,a));return c},rb:function(b){for(;b.firstChild;)a.removeNode(b.firstChild)},nc:function(b){b=a.a.W(b);for(var c=(b[0]&&b[0].ownerDocument||t).createElement("div"),d=0,e=b.length;d<e;d++)c.appendChild(a.ba(b[d]));return c},wa:function(b,c){for(var d=0,e=b.length,m=[];d<e;d++){var k=
b[d].cloneNode(!0);m.push(c?a.ba(k):k)}return m},fa:function(b,c){a.a.rb(b);if(c)for(var d=0,e=c.length;d<e;d++)b.appendChild(c[d])},uc:function(b,c){var d=b.nodeType?[b]:b;if(0<d.length){for(var e=d[0],m=e.parentNode,k=0,f=c.length;k<f;k++)m.insertBefore(c[k],e);k=0;for(f=d.length;k<f;k++)a.removeNode(d[k])}},Ba:function(a,b){if(a.length){for(b=8===b.nodeType&&b.parentNode||b;a.length&&a[0].parentNode!==b;)a.splice(0,1);for(;1<a.length&&a[a.length-1].parentNode!==b;)a.length--;if(1<a.length){var c=
a[0],d=a[a.length-1];for(a.length=0;c!==d;)a.push(c),c=c.nextSibling;a.push(d)}}return a},wc:function(a,b){7>k?a.setAttribute("selected",b):a.selected=b},cb:function(a){return null===a||a===n?"":a.trim?a.trim():a.toString().replace(/^[\s\xa0]+|[\s\xa0]+$/g,"")},sd:function(a,b){a=a||"";return b.length>a.length?!1:a.substring(0,b.length)===b},Rc:function(a,b){if(a===b)return!0;if(11===a.nodeType)return!1;if(b.contains)return b.contains(3===a.nodeType?a.parentNode:a);if(b.compareDocumentPosition)return 16==
(b.compareDocumentPosition(a)&16);for(;a&&a!=b;)a=a.parentNode;return!!a},qb:function(b){return a.a.Rc(b,b.ownerDocument.documentElement)},Tb:function(b){return!!a.a.Vb(b,a.a.qb)},A:function(a){return a&&a.tagName&&a.tagName.toLowerCase()},Zb:function(b){return a.onError?function(){try{return b.apply(this,arguments)}catch(c){throw a.onError&&a.onError(c),c;}}:b},setTimeout:function(b,c){return setTimeout(a.a.Zb(b),c)},dc:function(b){setTimeout(function(){a.onError&&a.onError(b);throw b;},0)},q:function(b,
c,d){var e=a.a.Zb(d);d=k&&m[c];if(a.options.useOnlyNativeEvents||d||!u)if(d||"function"!=typeof b.addEventListener)if("undefined"!=typeof b.attachEvent){var f=function(a){e.call(b,a)},l="on"+c;b.attachEvent(l,f);a.a.G.qa(b,function(){b.detachEvent(l,f)})}else throw Error("Browser doesn't support addEventListener or attachEvent");else b.addEventListener(c,e,!1);else u(b).bind(c,e)},Fa:function(b,c){if(!b||!b.nodeType)throw Error("element must be a DOM node when calling triggerEvent");var d;"input"===
a.a.A(b)&&b.type&&"click"==c.toLowerCase()?(d=b.type,d="checkbox"==d||"radio"==d):d=!1;if(a.options.useOnlyNativeEvents||!u||d)if("function"==typeof t.createEvent)if("function"==typeof b.dispatchEvent)d=t.createEvent(l[c]||"HTMLEvents"),d.initEvent(c,!0,!0,x,0,0,0,0,0,!1,!1,!1,!1,0,b),b.dispatchEvent(d);else throw Error("The supplied element doesn't support dispatchEvent");else if(d&&b.click)b.click();else if("undefined"!=typeof b.fireEvent)b.fireEvent("on"+c);else throw Error("Browser doesn't support triggering events");
else u(b).trigger(c)},c:function(b){return a.I(b)?b():b},Bb:function(b){return a.I(b)?b.p():b},fb:function(b,c,d){var k;c&&("object"===typeof b.classList?(k=b.classList[d?"add":"remove"],a.a.r(c.match(r),function(a){k.call(b.classList,a)})):"string"===typeof b.className.baseVal?e(b.className,"baseVal",c,d):e(b,"className",c,d))},bb:function(b,c){var d=a.a.c(c);if(null===d||d===n)d="";var e=a.f.firstChild(b);!e||3!=e.nodeType||a.f.nextSibling(e)?a.f.fa(b,[b.ownerDocument.createTextNode(d)]):e.data=
d;a.a.Wc(b)},vc:function(a,b){a.name=b;if(7>=k)try{a.mergeAttributes(t.createElement("<input name='"+a.name+"'/>"),!1)}catch(c){}},Wc:function(a){9<=k&&(a=1==a.nodeType?a:a.parentNode,a.style&&(a.style.zoom=a.style.zoom))},Sc:function(a){if(k){var b=a.style.width;a.style.width=0;a.style.width=b}},nd:function(b,c){b=a.a.c(b);c=a.a.c(c);for(var d=[],e=b;e<=c;e++)d.push(e);return d},W:function(a){for(var b=[],c=0,d=a.length;c<d;c++)b.push(a[c]);return b},bc:function(a){return g?Symbol(a):a},xd:6===k,
yd:7===k,C:k,ic:function(b,c){for(var d=a.a.W(b.getElementsByTagName("input")).concat(a.a.W(b.getElementsByTagName("textarea"))),e="string"==typeof c?function(a){return a.name===c}:function(a){return c.test(a.name)},k=[],m=d.length-1;0<=m;m--)e(d[m])&&k.push(d[m]);return k},kd:function(b){return"string"==typeof b&&(b=a.a.cb(b))?H&&H.parse?H.parse(b):(new Function("return "+b))():null},Gb:function(b,c,d){if(!H||!H.stringify)throw Error("Cannot find JSON.stringify(). Some browsers (e.g., IE < 8) don't support it natively, but you can overcome this by adding a script reference to json2.js, downloadable from http://www.json.org/json2.js");
return H.stringify(a.a.c(b),c,d)},ld:function(c,d,e){e=e||{};var k=e.params||{},m=e.includeFields||this.gc,f=c;if("object"==typeof c&&"form"===a.a.A(c))for(var f=c.action,l=m.length-1;0<=l;l--)for(var g=a.a.ic(c,m[l]),h=g.length-1;0<=h;h--)k[g[h].name]=g[h].value;d=a.a.c(d);var r=t.createElement("form");r.style.display="none";r.action=f;r.method="post";for(var n in d)c=t.createElement("input"),c.type="hidden",c.name=n,c.value=a.a.Gb(a.a.c(d[n])),r.appendChild(c);b(k,function(a,b){var c=t.createElement("input");
c.type="hidden";c.name=a;c.value=b;r.appendChild(c)});t.body.appendChild(r);e.submitter?e.submitter(r):r.submit();setTimeout(function(){r.parentNode.removeChild(r)},0)}}}();a.b("utils",a.a);a.b("utils.arrayForEach",a.a.r);a.b("utils.arrayFirst",a.a.Vb);a.b("utils.arrayFilter",a.a.Ma);a.b("utils.arrayGetDistinctValues",a.a.Wb);a.b("utils.arrayIndexOf",a.a.o);a.b("utils.arrayMap",a.a.ib);a.b("utils.arrayPushAll",a.a.ta);a.b("utils.arrayRemoveItem",a.a.Na);a.b("utils.extend",a.a.extend);a.b("utils.fieldsIncludedWithJsonPost",
a.a.gc);a.b("utils.getFormFields",a.a.ic);a.b("utils.peekObservable",a.a.Bb);a.b("utils.postJson",a.a.ld);a.b("utils.parseJson",a.a.kd);a.b("utils.registerEventHandler",a.a.q);a.b("utils.stringifyJson",a.a.Gb);a.b("utils.range",a.a.nd);a.b("utils.toggleDomNodeCssClass",a.a.fb);a.b("utils.triggerEvent",a.a.Fa);a.b("utils.unwrapObservable",a.a.c);a.b("utils.objectForEach",a.a.D);a.b("utils.addOrRemoveItem",a.a.ra);a.b("utils.setTextContent",a.a.bb);a.b("unwrap",a.a.c);Function.prototype.bind||(Function.prototype.bind=
function(a){var c=this;if(1===arguments.length)return function(){return c.apply(a,arguments)};var d=Array.prototype.slice.call(arguments,1);return function(){var e=d.slice(0);e.push.apply(e,arguments);return c.apply(a,e)}});a.a.e=new function(){function a(b,g){var h=b[d];if(!h||"null"===h||!e[h]){if(!g)return n;h=b[d]="ko"+c++;e[h]={}}return e[h]}var c=0,d="__ko__"+(new Date).getTime(),e={};return{get:function(c,d){var e=a(c,!1);return e===n?n:e[d]},set:function(c,d,e){if(e!==n||a(c,!1)!==n)a(c,!0)[d]=
e},clear:function(a){var b=a[d];return b?(delete e[b],a[d]=null,!0):!1},J:function(){return c++ +d}}};a.b("utils.domData",a.a.e);a.b("utils.domData.clear",a.a.e.clear);a.a.G=new function(){function b(b,c){var e=a.a.e.get(b,d);e===n&&c&&(e=[],a.a.e.set(b,d,e));return e}function c(d){var e=b(d,!1);if(e)for(var e=e.slice(0),l=0;l<e.length;l++)e[l](d);a.a.e.clear(d);a.a.G.cleanExternalData(d);if(f[d.nodeType])for(e=d.firstChild;d=e;)e=d.nextSibling,8===d.nodeType&&c(d)}var d=a.a.e.J(),e={1:!0,8:!0,9:!0},
f={1:!0,9:!0};return{qa:function(a,c){if("function"!=typeof c)throw Error("Callback must be a function");b(a,!0).push(c)},tc:function(c,e){var f=b(c,!1);f&&(a.a.Na(f,e),0==f.length&&a.a.e.set(c,d,n))},ba:function(b){if(e[b.nodeType]&&(c(b),f[b.nodeType])){var d=[];a.a.ta(d,b.getElementsByTagName("*"));for(var l=0,m=d.length;l<m;l++)c(d[l])}return b},removeNode:function(b){a.ba(b);b.parentNode&&b.parentNode.removeChild(b)},cleanExternalData:function(a){u&&"function"==typeof u.cleanData&&u.cleanData([a])}}};
a.ba=a.a.G.ba;a.removeNode=a.a.G.removeNode;a.b("cleanNode",a.ba);a.b("removeNode",a.removeNode);a.b("utils.domNodeDisposal",a.a.G);a.b("utils.domNodeDisposal.addDisposeCallback",a.a.G.qa);a.b("utils.domNodeDisposal.removeDisposeCallback",a.a.G.tc);(function(){var b=[0,"",""],c=[1,"<table>","</table>"],d=[3,"<table><tbody><tr>","</tr></tbody></table>"],e=[1,"<select multiple='multiple'>","</select>"],f={thead:c,tbody:c,tfoot:c,tr:[2,"<table><tbody>","</tbody></table>"],td:d,th:d,option:e,optgroup:e},
g=8>=a.a.C;a.a.na=function(c,d){var e;if(u)if(u.parseHTML)e=u.parseHTML(c,d)||[];else{if((e=u.clean([c],d))&&e[0]){for(var k=e[0];k.parentNode&&11!==k.parentNode.nodeType;)k=k.parentNode;k.parentNode&&k.parentNode.removeChild(k)}}else{(e=d)||(e=t);var k=e.parentWindow||e.defaultView||x,r=a.a.cb(c).toLowerCase(),q=e.createElement("div"),p;p=(r=r.match(/^<([a-z]+)[ >]/))&&f[r[1]]||b;r=p[0];p="ignored<div>"+p[1]+c+p[2]+"</div>";"function"==typeof k.innerShiv?q.appendChild(k.innerShiv(p)):(g&&e.appendChild(q),
q.innerHTML=p,g&&q.parentNode.removeChild(q));for(;r--;)q=q.lastChild;e=a.a.W(q.lastChild.childNodes)}return e};a.a.Eb=function(b,c){a.a.rb(b);c=a.a.c(c);if(null!==c&&c!==n)if("string"!=typeof c&&(c=c.toString()),u)u(b).html(c);else for(var d=a.a.na(c,b.ownerDocument),e=0;e<d.length;e++)b.appendChild(d[e])}})();a.b("utils.parseHtmlFragment",a.a.na);a.b("utils.setHtml",a.a.Eb);a.N=function(){function b(c,e){if(c)if(8==c.nodeType){var f=a.N.pc(c.nodeValue);null!=f&&e.push({Qc:c,hd:f})}else if(1==c.nodeType)for(var f=
0,g=c.childNodes,h=g.length;f<h;f++)b(g[f],e)}var c={};return{yb:function(a){if("function"!=typeof a)throw Error("You can only pass a function to ko.memoization.memoize()");var b=(4294967296*(1+Math.random())|0).toString(16).substring(1)+(4294967296*(1+Math.random())|0).toString(16).substring(1);c[b]=a;return"\x3c!--[ko_memo:"+b+"]--\x3e"},Bc:function(a,b){var f=c[a];if(f===n)throw Error("Couldn't find any memo with ID "+a+". Perhaps it's already been unmemoized.");try{return f.apply(null,b||[]),
!0}finally{delete c[a]}},Cc:function(c,e){var f=[];b(c,f);for(var g=0,h=f.length;g<h;g++){var l=f[g].Qc,m=[l];e&&a.a.ta(m,e);a.N.Bc(f[g].hd,m);l.nodeValue="";l.parentNode&&l.parentNode.removeChild(l)}},pc:function(a){return(a=a.match(/^\[ko_memo\:(.*?)\]$/))?a[1]:null}}}();a.b("memoization",a.N);a.b("memoization.memoize",a.N.yb);a.b("memoization.unmemoize",a.N.Bc);a.b("memoization.parseMemoText",a.N.pc);a.b("memoization.unmemoizeDomNodeAndDescendants",a.N.Cc);a.Z=function(){function b(){if(e)for(var b=
e,c=0,m;g<e;)if(m=d[g++]){if(g>b){if(5E3<=++c){g=e;a.a.dc(Error("'Too much recursion' after processing "+c+" task groups."));break}b=e}try{m()}catch(k){a.a.dc(k)}}}function c(){b();g=e=d.length=0}var d=[],e=0,f=1,g=0;return{scheduler:x.MutationObserver?function(a){var b=t.createElement("div");(new MutationObserver(a)).observe(b,{attributes:!0});return function(){b.classList.toggle("foo")}}(c):t&&"onreadystatechange"in t.createElement("script")?function(a){var b=t.createElement("script");b.onreadystatechange=
function(){b.onreadystatechange=null;t.documentElement.removeChild(b);b=null;a()};t.documentElement.appendChild(b)}:function(a){setTimeout(a,0)},Za:function(b){e||a.Z.scheduler(c);d[e++]=b;return f++},cancel:function(a){a-=f-e;a>=g&&a<e&&(d[a]=null)},resetForTesting:function(){var a=e-g;g=e=d.length=0;return a},rd:b}}();a.b("tasks",a.Z);a.b("tasks.schedule",a.Z.Za);a.b("tasks.runEarly",a.Z.rd);a.Aa={throttle:function(b,c){b.throttleEvaluation=c;var d=null;return a.B({read:b,write:function(e){clearTimeout(d);
d=a.a.setTimeout(function(){b(e)},c)}})},rateLimit:function(a,c){var d,e,f;"number"==typeof c?d=c:(d=c.timeout,e=c.method);a.gb=!1;f="notifyWhenChangesStop"==e?T:S;a.Wa(function(a){return f(a,d)})},deferred:function(b,c){if(!0!==c)throw Error("The 'deferred' extender only accepts the value 'true', because it is not supported to turn deferral off once enabled.");b.gb||(b.gb=!0,b.Wa(function(c){var e,f=!1;return function(){if(!f){a.Z.cancel(e);e=a.Z.Za(c);try{f=!0,b.notifySubscribers(n,"dirty")}finally{f=
!1}}}}))},notify:function(a,c){a.equalityComparer="always"==c?null:J}};var R={undefined:1,"boolean":1,number:1,string:1};a.b("extenders",a.Aa);a.zc=function(b,c,d){this.$=b;this.jb=c;this.Pc=d;this.T=!1;a.H(this,"dispose",this.k)};a.zc.prototype.k=function(){this.T=!0;this.Pc()};a.K=function(){a.a.ab(this,D);D.ub(this)};var E="change",D={ub:function(a){a.F={change:[]};a.Qb=1},Y:function(b,c,d){var e=this;d=d||E;var f=new a.zc(e,c?b.bind(c):b,function(){a.a.Na(e.F[d],f);e.Ka&&e.Ka(d)});e.ua&&e.ua(d);
e.F[d]||(e.F[d]=[]);e.F[d].push(f);return f},notifySubscribers:function(b,c){c=c||E;c===E&&this.Kb();if(this.Ra(c)){var d=c===E&&this.Fc||this.F[c].slice(0);try{a.l.Xb();for(var e=0,f;f=d[e];++e)f.T||f.jb(b)}finally{a.l.end()}}},Pa:function(){return this.Qb},Zc:function(a){return this.Pa()!==a},Kb:function(){++this.Qb},Wa:function(b){var c=this,d=a.I(c),e,f,g,h;c.Ja||(c.Ja=c.notifySubscribers,c.notifySubscribers=U);var l=b(function(){c.Ha=!1;d&&h===c&&(h=c.Mb?c.Mb():c());var a=f||c.Ua(g,h);f=e=!1;
a&&c.Ja(g=h)});c.Pb=function(a){c.Fc=c.F[E].slice(0);c.Ha=e=!0;h=a;l()};c.Ob=function(a){e||(g=a,c.Ja(a,"beforeChange"))};c.Hc=function(){c.Ua(g,c.p(!0))&&(f=!0)}},Ra:function(a){return this.F[a]&&this.F[a].length},Xc:function(b){if(b)return this.F[b]&&this.F[b].length||0;var c=0;a.a.D(this.F,function(a,b){"dirty"!==a&&(c+=b.length)});return c},Ua:function(a,c){return!this.equalityComparer||!this.equalityComparer(a,c)},extend:function(b){var c=this;b&&a.a.D(b,function(b,e){var f=a.Aa[b];"function"==
typeof f&&(c=f(c,e)||c)});return c}};a.H(D,"subscribe",D.Y);a.H(D,"extend",D.extend);a.H(D,"getSubscriptionsCount",D.Xc);a.a.la&&a.a.$a(D,Function.prototype);a.K.fn=D;a.lc=function(a){return null!=a&&"function"==typeof a.Y&&"function"==typeof a.notifySubscribers};a.b("subscribable",a.K);a.b("isSubscribable",a.lc);a.xa=a.l=function(){function b(a){d.push(e);e=a}function c(){e=d.pop()}var d=[],e,f=0;return{Xb:b,end:c,sc:function(b){if(e){if(!a.lc(b))throw Error("Only subscribable things can act as dependencies");
e.jb.call(e.Lc,b,b.Gc||(b.Gc=++f))}},w:function(a,d,e){try{return b(),a.apply(d,e||[])}finally{c()}},Ca:function(){if(e)return e.m.Ca()},Va:function(){if(e)return e.Va}}}();a.b("computedContext",a.xa);a.b("computedContext.getDependenciesCount",a.xa.Ca);a.b("computedContext.isInitial",a.xa.Va);a.b("ignoreDependencies",a.wd=a.l.w);var F=a.a.bc("_latestValue");a.O=function(b){function c(){if(0<arguments.length)return c.Ua(c[F],arguments[0])&&(c.ia(),c[F]=arguments[0],c.ha()),this;a.l.sc(c);return c[F]}
c[F]=b;a.a.la||a.a.extend(c,a.K.fn);a.K.fn.ub(c);a.a.ab(c,B);a.options.deferUpdates&&a.Aa.deferred(c,!0);return c};var B={equalityComparer:J,p:function(){return this[F]},ha:function(){this.notifySubscribers(this[F])},ia:function(){this.notifySubscribers(this[F],"beforeChange")}};a.a.la&&a.a.$a(B,a.K.fn);var I=a.O.md="__ko_proto__";B[I]=a.O;a.Qa=function(b,c){return null===b||b===n||b[I]===n?!1:b[I]===c?!0:a.Qa(b[I],c)};a.I=function(b){return a.Qa(b,a.O)};a.Da=function(b){return"function"==typeof b&&
b[I]===a.O||"function"==typeof b&&b[I]===a.B&&b.$c?!0:!1};a.b("observable",a.O);a.b("isObservable",a.I);a.b("isWriteableObservable",a.Da);a.b("isWritableObservable",a.Da);a.b("observable.fn",B);a.H(B,"peek",B.p);a.H(B,"valueHasMutated",B.ha);a.H(B,"valueWillMutate",B.ia);a.ma=function(b){b=b||[];if("object"!=typeof b||!("length"in b))throw Error("The argument passed when initializing an observable array must be an array, or null, or undefined.");b=a.O(b);a.a.ab(b,a.ma.fn);return b.extend({trackArrayChanges:!0})};
a.ma.fn={remove:function(b){for(var c=this.p(),d=[],e="function"!=typeof b||a.I(b)?function(a){return a===b}:b,f=0;f<c.length;f++){var g=c[f];e(g)&&(0===d.length&&this.ia(),d.push(g),c.splice(f,1),f--)}d.length&&this.ha();return d},removeAll:function(b){if(b===n){var c=this.p(),d=c.slice(0);this.ia();c.splice(0,c.length);this.ha();return d}return b?this.remove(function(c){return 0<=a.a.o(b,c)}):[]},destroy:function(b){var c=this.p(),d="function"!=typeof b||a.I(b)?function(a){return a===b}:b;this.ia();
for(var e=c.length-1;0<=e;e--)d(c[e])&&(c[e]._destroy=!0);this.ha()},destroyAll:function(b){return b===n?this.destroy(function(){return!0}):b?this.destroy(function(c){return 0<=a.a.o(b,c)}):[]},indexOf:function(b){var c=this();return a.a.o(c,b)},replace:function(a,c){var d=this.indexOf(a);0<=d&&(this.ia(),this.p()[d]=c,this.ha())}};a.a.la&&a.a.$a(a.ma.fn,a.O.fn);a.a.r("pop push reverse shift sort splice unshift".split(" "),function(b){a.ma.fn[b]=function(){var a=this.p();this.ia();this.Yb(a,b,arguments);
var d=a[b].apply(a,arguments);this.ha();return d===a?this:d}});a.a.r(["slice"],function(b){a.ma.fn[b]=function(){var a=this();return a[b].apply(a,arguments)}});a.b("observableArray",a.ma);a.Aa.trackArrayChanges=function(b,c){function d(){if(!e){e=!0;l=b.notifySubscribers;b.notifySubscribers=function(a,b){b&&b!==E||++h;return l.apply(this,arguments)};var c=[].concat(b.p()||[]);f=null;g=b.Y(function(d){d=[].concat(d||[]);if(b.Ra("arrayChange")){var e;if(!f||1<h)f=a.a.lb(c,d,b.kb);e=f}c=d;f=null;h=0;
e&&e.length&&b.notifySubscribers(e,"arrayChange")})}}b.kb={};c&&"object"==typeof c&&a.a.extend(b.kb,c);b.kb.sparse=!0;if(!b.Yb){var e=!1,f=null,g,h=0,l,m=b.ua,k=b.Ka;b.ua=function(a){m&&m.call(b,a);"arrayChange"===a&&d()};b.Ka=function(a){k&&k.call(b,a);"arrayChange"!==a||b.Ra("arrayChange")||(l&&(b.notifySubscribers=l,l=n),g.k(),e=!1)};b.Yb=function(b,c,d){function k(a,b,c){return m[m.length]={status:a,value:b,index:c}}if(e&&!h){var m=[],l=b.length,g=d.length,G=0;switch(c){case "push":G=l;case "unshift":for(c=
0;c<g;c++)k("added",d[c],G+c);break;case "pop":G=l-1;case "shift":l&&k("deleted",b[G],G);break;case "splice":c=Math.min(Math.max(0,0>d[0]?l+d[0]:d[0]),l);for(var l=1===g?l:Math.min(c+(d[1]||0),l),g=c+g-2,G=Math.max(l,g),n=[],s=[],w=2;c<G;++c,++w)c<l&&s.push(k("deleted",b[c],c)),c<g&&n.push(k("added",d[w],c));a.a.hc(s,n);break;default:return}f=m}}}};var s=a.a.bc("_state");a.m=a.B=function(b,c,d){function e(){if(0<arguments.length){if("function"===typeof f)f.apply(g.sb,arguments);else throw Error("Cannot write a value to a ko.computed unless you specify a 'write' option. If you wish to read the current value, don't pass any parameters.");
return this}a.l.sc(e);(g.V||g.t&&e.Sa())&&e.U();return g.M}"object"===typeof b?d=b:(d=d||{},b&&(d.read=b));if("function"!=typeof d.read)throw Error("Pass a function that returns the value of the ko.computed");var f=d.write,g={M:n,da:!0,V:!0,Ta:!1,Hb:!1,T:!1,Ya:!1,t:!1,od:d.read,sb:c||d.owner,i:d.disposeWhenNodeIsRemoved||d.i||null,ya:d.disposeWhen||d.ya,pb:null,s:{},L:0,fc:null};e[s]=g;e.$c="function"===typeof f;a.a.la||a.a.extend(e,a.K.fn);a.K.fn.ub(e);a.a.ab(e,z);d.pure?(g.Ya=!0,g.t=!0,a.a.extend(e,
Y)):d.deferEvaluation&&a.a.extend(e,Z);a.options.deferUpdates&&a.Aa.deferred(e,!0);g.i&&(g.Hb=!0,g.i.nodeType||(g.i=null));g.t||d.deferEvaluation||e.U();g.i&&e.ca()&&a.a.G.qa(g.i,g.pb=function(){e.k()});return e};var z={equalityComparer:J,Ca:function(){return this[s].L},Sb:function(a,c,d){if(this[s].Ya&&c===this)throw Error("A 'pure' computed must not be called recursively");this[s].s[a]=d;d.Ia=this[s].L++;d.pa=c.Pa()},Sa:function(){var a,c,d=this[s].s;for(a in d)if(d.hasOwnProperty(a)&&(c=d[a],this.oa&&
c.$.Ha||c.$.Zc(c.pa)))return!0},gd:function(){this.oa&&!this[s].Ta&&this.oa(!1)},ca:function(){var a=this[s];return a.V||0<a.L},qd:function(){this.Ha?this[s].V&&(this[s].da=!0):this.ec()},yc:function(a){if(a.gb&&!this[s].i){var c=a.Y(this.gd,this,"dirty"),d=a.Y(this.qd,this);return{$:a,k:function(){c.k();d.k()}}}return a.Y(this.ec,this)},ec:function(){var b=this,c=b.throttleEvaluation;c&&0<=c?(clearTimeout(this[s].fc),this[s].fc=a.a.setTimeout(function(){b.U(!0)},c)):b.oa?b.oa(!0):b.U(!0)},U:function(b){var c=
this[s],d=c.ya,e=!1;if(!c.Ta&&!c.T){if(c.i&&!a.a.qb(c.i)||d&&d()){if(!c.Hb){this.k();return}}else c.Hb=!1;c.Ta=!0;try{e=this.Vc(b)}finally{c.Ta=!1}c.L||this.k();return e}},Vc:function(b){var c=this[s],d=!1,e=c.Ya?n:!c.L,f={Mc:this,Oa:c.s,ob:c.L};a.l.Xb({Lc:f,jb:W,m:this,Va:e});c.s={};c.L=0;f=this.Uc(c,f);this.Ua(c.M,f)&&(c.t||this.notifySubscribers(c.M,"beforeChange"),c.M=f,c.t?this.Kb():b&&this.notifySubscribers(c.M),d=!0);e&&this.notifySubscribers(c.M,"awake");return d},Uc:function(b,c){try{var d=
b.od;return b.sb?d.call(b.sb):d()}finally{a.l.end(),c.ob&&!b.t&&a.a.D(c.Oa,V),b.da=b.V=!1}},p:function(a){var c=this[s];(c.V&&(a||!c.L)||c.t&&this.Sa())&&this.U();return c.M},Wa:function(b){a.K.fn.Wa.call(this,b);this.Mb=function(){this[s].da?this.U():this[s].V=!1;return this[s].M};this.oa=function(a){this.Ob(this[s].M);this[s].V=!0;a&&(this[s].da=!0);this.Pb(this)}},k:function(){var b=this[s];!b.t&&b.s&&a.a.D(b.s,function(a,b){b.k&&b.k()});b.i&&b.pb&&a.a.G.tc(b.i,b.pb);b.s=null;b.L=0;b.T=!0;b.da=
!1;b.V=!1;b.t=!1;b.i=null}},Y={ua:function(b){var c=this,d=c[s];if(!d.T&&d.t&&"change"==b){d.t=!1;if(d.da||c.Sa())d.s=null,d.L=0,c.U()&&c.Kb();else{var e=[];a.a.D(d.s,function(a,b){e[b.Ia]=a});a.a.r(e,function(a,b){var e=d.s[a],l=c.yc(e.$);l.Ia=b;l.pa=e.pa;d.s[a]=l})}d.T||c.notifySubscribers(d.M,"awake")}},Ka:function(b){var c=this[s];c.T||"change"!=b||this.Ra("change")||(a.a.D(c.s,function(a,b){b.k&&(c.s[a]={$:b.$,Ia:b.Ia,pa:b.pa},b.k())}),c.t=!0,this.notifySubscribers(n,"asleep"))},Pa:function(){var b=
this[s];b.t&&(b.da||this.Sa())&&this.U();return a.K.fn.Pa.call(this)}},Z={ua:function(a){"change"!=a&&"beforeChange"!=a||this.p()}};a.a.la&&a.a.$a(z,a.K.fn);var P=a.O.md;a.m[P]=a.O;z[P]=a.m;a.bd=function(b){return a.Qa(b,a.m)};a.cd=function(b){return a.Qa(b,a.m)&&b[s]&&b[s].Ya};a.b("computed",a.m);a.b("dependentObservable",a.m);a.b("isComputed",a.bd);a.b("isPureComputed",a.cd);a.b("computed.fn",z);a.H(z,"peek",z.p);a.H(z,"dispose",z.k);a.H(z,"isActive",z.ca);a.H(z,"getDependenciesCount",z.Ca);a.rc=
function(b,c){if("function"===typeof b)return a.m(b,c,{pure:!0});b=a.a.extend({},b);b.pure=!0;return a.m(b,c)};a.b("pureComputed",a.rc);(function(){function b(a,f,g){g=g||new d;a=f(a);if("object"!=typeof a||null===a||a===n||a instanceof RegExp||a instanceof Date||a instanceof String||a instanceof Number||a instanceof Boolean)return a;var h=a instanceof Array?[]:{};g.save(a,h);c(a,function(c){var d=f(a[c]);switch(typeof d){case "boolean":case "number":case "string":case "function":h[c]=d;break;case "object":case "undefined":var k=
g.get(d);h[c]=k!==n?k:b(d,f,g)}});return h}function c(a,b){if(a instanceof Array){for(var c=0;c<a.length;c++)b(c);"function"==typeof a.toJSON&&b("toJSON")}else for(c in a)b(c)}function d(){this.keys=[];this.Lb=[]}a.Ac=function(c){if(0==arguments.length)throw Error("When calling ko.toJS, pass the object you want to convert.");return b(c,function(b){for(var c=0;a.I(b)&&10>c;c++)b=b();return b})};a.toJSON=function(b,c,d){b=a.Ac(b);return a.a.Gb(b,c,d)};d.prototype={save:function(b,c){var d=a.a.o(this.keys,
b);0<=d?this.Lb[d]=c:(this.keys.push(b),this.Lb.push(c))},get:function(b){b=a.a.o(this.keys,b);return 0<=b?this.Lb[b]:n}}})();a.b("toJS",a.Ac);a.b("toJSON",a.toJSON);(function(){a.j={u:function(b){switch(a.a.A(b)){case "option":return!0===b.__ko__hasDomDataOptionValue__?a.a.e.get(b,a.d.options.zb):7>=a.a.C?b.getAttributeNode("value")&&b.getAttributeNode("value").specified?b.value:b.text:b.value;case "select":return 0<=b.selectedIndex?a.j.u(b.options[b.selectedIndex]):n;default:return b.value}},ja:function(b,
c,d){switch(a.a.A(b)){case "option":switch(typeof c){case "string":a.a.e.set(b,a.d.options.zb,n);"__ko__hasDomDataOptionValue__"in b&&delete b.__ko__hasDomDataOptionValue__;b.value=c;break;default:a.a.e.set(b,a.d.options.zb,c),b.__ko__hasDomDataOptionValue__=!0,b.value="number"===typeof c?c:""}break;case "select":if(""===c||null===c)c=n;for(var e=-1,f=0,g=b.options.length,h;f<g;++f)if(h=a.j.u(b.options[f]),h==c||""==h&&c===n){e=f;break}if(d||0<=e||c===n&&1<b.size)b.selectedIndex=e;break;default:if(null===
c||c===n)c="";b.value=c}}}})();a.b("selectExtensions",a.j);a.b("selectExtensions.readValue",a.j.u);a.b("selectExtensions.writeValue",a.j.ja);a.h=function(){function b(b){b=a.a.cb(b);123===b.charCodeAt(0)&&(b=b.slice(1,-1));var c=[],d=b.match(e),r,h=[],p=0;if(d){d.push(",");for(var A=0,y;y=d[A];++A){var v=y.charCodeAt(0);if(44===v){if(0>=p){c.push(r&&h.length?{key:r,value:h.join("")}:{unknown:r||h.join("")});r=p=0;h=[];continue}}else if(58===v){if(!p&&!r&&1===h.length){r=h.pop();continue}}else 47===
v&&A&&1<y.length?(v=d[A-1].match(f))&&!g[v[0]]&&(b=b.substr(b.indexOf(y)+1),d=b.match(e),d.push(","),A=-1,y="/"):40===v||123===v||91===v?++p:41===v||125===v||93===v?--p:r||h.length||34!==v&&39!==v||(y=y.slice(1,-1));h.push(y)}}return c}var c=["true","false","null","undefined"],d=/^(?:[$_a-z][$\w]*|(.+)(\.\s*[$_a-z][$\w]*|\[.+\]))$/i,e=RegExp("\"(?:[^\"\\\\]|\\\\.)*\"|'(?:[^'\\\\]|\\\\.)*'|/(?:[^/\\\\]|\\\\.)*/w*|[^\\s:,/][^,\"'{}()/:[\\]]*[^\\s,\"'{}()/:[\\]]|[^\\s]","g"),f=/[\])"'A-Za-z0-9_$]+$/,
g={"in":1,"return":1,"typeof":1},h={};return{va:[],ga:h,Ab:b,Xa:function(e,m){function k(b,e){var m;if(!A){var l=a.getBindingHandler(b);if(l&&l.preprocess&&!(e=l.preprocess(e,b,k)))return;if(l=h[b])m=e,0<=a.a.o(c,m)?m=!1:(l=m.match(d),m=null===l?!1:l[1]?"Object("+l[1]+")"+l[2]:m),l=m;l&&g.push("'"+b+"':function(_z){"+m+"=_z}")}p&&(e="function(){return "+e+" }");f.push("'"+b+"':"+e)}m=m||{};var f=[],g=[],p=m.valueAccessors,A=m.bindingParams,y="string"===typeof e?b(e):e;a.a.r(y,function(a){k(a.key||
a.unknown,a.value)});g.length&&k("_ko_property_writers","{"+g.join(",")+" }");return f.join(",")},fd:function(a,b){for(var c=0;c<a.length;c++)if(a[c].key==b)return!0;return!1},Ga:function(b,c,d,e,f){if(b&&a.I(b))!a.Da(b)||f&&b.p()===e||b(e);else if((b=c.get("_ko_property_writers"))&&b[d])b[d](e)}}}();a.b("expressionRewriting",a.h);a.b("expressionRewriting.bindingRewriteValidators",a.h.va);a.b("expressionRewriting.parseObjectLiteral",a.h.Ab);a.b("expressionRewriting.preProcessBindings",a.h.Xa);a.b("expressionRewriting._twoWayBindings",
a.h.ga);a.b("jsonExpressionRewriting",a.h);a.b("jsonExpressionRewriting.insertPropertyAccessorsIntoJson",a.h.Xa);(function(){function b(a){return 8==a.nodeType&&g.test(f?a.text:a.nodeValue)}function c(a){return 8==a.nodeType&&h.test(f?a.text:a.nodeValue)}function d(a,d){for(var e=a,f=1,l=[];e=e.nextSibling;){if(c(e)&&(f--,0===f))return l;l.push(e);b(e)&&f++}if(!d)throw Error("Cannot find closing comment tag to match: "+a.nodeValue);return null}function e(a,b){var c=d(a,b);return c?0<c.length?c[c.length-
1].nextSibling:a.nextSibling:null}var f=t&&"\x3c!--test--\x3e"===t.createComment("test").text,g=f?/^\x3c!--\s*ko(?:\s+([\s\S]+))?\s*--\x3e$/:/^\s*ko(?:\s+([\s\S]+))?\s*$/,h=f?/^\x3c!--\s*\/ko\s*--\x3e$/:/^\s*\/ko\s*$/,l={ul:!0,ol:!0};a.f={aa:{},childNodes:function(a){return b(a)?d(a):a.childNodes},za:function(c){if(b(c)){c=a.f.childNodes(c);for(var d=0,e=c.length;d<e;d++)a.removeNode(c[d])}else a.a.rb(c)},fa:function(c,d){if(b(c)){a.f.za(c);for(var e=c.nextSibling,f=0,l=d.length;f<l;f++)e.parentNode.insertBefore(d[f],
e)}else a.a.fa(c,d)},qc:function(a,c){b(a)?a.parentNode.insertBefore(c,a.nextSibling):a.firstChild?a.insertBefore(c,a.firstChild):a.appendChild(c)},kc:function(c,d,e){e?b(c)?c.parentNode.insertBefore(d,e.nextSibling):e.nextSibling?c.insertBefore(d,e.nextSibling):c.appendChild(d):a.f.qc(c,d)},firstChild:function(a){return b(a)?!a.nextSibling||c(a.nextSibling)?null:a.nextSibling:a.firstChild},nextSibling:function(a){b(a)&&(a=e(a));return a.nextSibling&&c(a.nextSibling)?null:a.nextSibling},Yc:b,vd:function(a){return(a=
(f?a.text:a.nodeValue).match(g))?a[1]:null},oc:function(d){if(l[a.a.A(d)]){var k=d.firstChild;if(k){do if(1===k.nodeType){var f;f=k.firstChild;var g=null;if(f){do if(g)g.push(f);else if(b(f)){var h=e(f,!0);h?f=h:g=[f]}else c(f)&&(g=[f]);while(f=f.nextSibling)}if(f=g)for(g=k.nextSibling,h=0;h<f.length;h++)g?d.insertBefore(f[h],g):d.appendChild(f[h])}while(k=k.nextSibling)}}}}})();a.b("virtualElements",a.f);a.b("virtualElements.allowedBindings",a.f.aa);a.b("virtualElements.emptyNode",a.f.za);a.b("virtualElements.insertAfter",
a.f.kc);a.b("virtualElements.prepend",a.f.qc);a.b("virtualElements.setDomNodeChildren",a.f.fa);(function(){a.S=function(){this.Kc={}};a.a.extend(a.S.prototype,{nodeHasBindings:function(b){switch(b.nodeType){case 1:return null!=b.getAttribute("data-bind")||a.g.getComponentNameForNode(b);case 8:return a.f.Yc(b);default:return!1}},getBindings:function(b,c){var d=this.getBindingsString(b,c),d=d?this.parseBindingsString(d,c,b):null;return a.g.Rb(d,b,c,!1)},getBindingAccessors:function(b,c){var d=this.getBindingsString(b,
c),d=d?this.parseBindingsString(d,c,b,{valueAccessors:!0}):null;return a.g.Rb(d,b,c,!0)},getBindingsString:function(b){switch(b.nodeType){case 1:return b.getAttribute("data-bind");case 8:return a.f.vd(b);default:return null}},parseBindingsString:function(b,c,d,e){try{var f=this.Kc,g=b+(e&&e.valueAccessors||""),h;if(!(h=f[g])){var l,m="with($context){with($data||{}){return{"+a.h.Xa(b,e)+"}}}";l=new Function("$context","$element",m);h=f[g]=l}return h(c,d)}catch(k){throw k.message="Unable to parse bindings.\nBindings value: "+
b+"\nMessage: "+k.message,k;}}});a.S.instance=new a.S})();a.b("bindingProvider",a.S);(function(){function b(a){return function(){return a}}function c(a){return a()}function d(b){return a.a.Ea(a.l.w(b),function(a,c){return function(){return b()[c]}})}function e(c,e,k){return"function"===typeof c?d(c.bind(null,e,k)):a.a.Ea(c,b)}function f(a,b){return d(this.getBindings.bind(this,a,b))}function g(b,c,d){var e,k=a.f.firstChild(c),f=a.S.instance,m=f.preprocessNode;if(m){for(;e=k;)k=a.f.nextSibling(e),
m.call(f,e);k=a.f.firstChild(c)}for(;e=k;)k=a.f.nextSibling(e),h(b,e,d)}function h(b,c,d){var e=!0,k=1===c.nodeType;k&&a.f.oc(c);if(k&&d||a.S.instance.nodeHasBindings(c))e=m(c,null,b,d).shouldBindDescendants;e&&!r[a.a.A(c)]&&g(b,c,!k)}function l(b){var c=[],d={},e=[];a.a.D(b,function X(k){if(!d[k]){var f=a.getBindingHandler(k);f&&(f.after&&(e.push(k),a.a.r(f.after,function(c){if(b[c]){if(-1!==a.a.o(e,c))throw Error("Cannot combine the following bindings, because they have a cyclic dependency: "+e.join(", "));
X(c)}}),e.length--),c.push({key:k,jc:f}));d[k]=!0}});return c}function m(b,d,e,k){var m=a.a.e.get(b,q);if(!d){if(m)throw Error("You cannot apply bindings multiple times to the same element.");a.a.e.set(b,q,!0)}!m&&k&&a.xc(b,e);var g;if(d&&"function"!==typeof d)g=d;else{var h=a.S.instance,r=h.getBindingAccessors||f,p=a.B(function(){(g=d?d(e,b):r.call(h,b,e))&&e.Q&&e.Q();return g},null,{i:b});g&&p.ca()||(p=null)}var s;if(g){var t=p?function(a){return function(){return c(p()[a])}}:function(a){return g[a]},
u=function(){return a.a.Ea(p?p():g,c)};u.get=function(a){return g[a]&&c(t(a))};u.has=function(a){return a in g};k=l(g);a.a.r(k,function(c){var d=c.jc.init,k=c.jc.update,f=c.key;if(8===b.nodeType&&!a.f.aa[f])throw Error("The binding '"+f+"' cannot be used with virtual elements");try{"function"==typeof d&&a.l.w(function(){var a=d(b,t(f),u,e.$data,e);if(a&&a.controlsDescendantBindings){if(s!==n)throw Error("Multiple bindings ("+s+" and "+f+") are trying to control descendant bindings of the same element. You cannot use these bindings together on the same element.");
s=f}}),"function"==typeof k&&a.B(function(){k(b,t(f),u,e.$data,e)},null,{i:b})}catch(m){throw m.message='Unable to process binding "'+f+": "+g[f]+'"\nMessage: '+m.message,m;}})}return{shouldBindDescendants:s===n}}function k(b){return b&&b instanceof a.R?b:new a.R(b)}a.d={};var r={script:!0,textarea:!0,template:!0};a.getBindingHandler=function(b){return a.d[b]};a.R=function(b,c,d,e,k){function f(){var k=g?b():b,m=a.a.c(k);c?(c.Q&&c.Q(),a.a.extend(l,c),l.Q=r):(l.$parents=[],l.$root=m,l.ko=a);l.$rawData=
k;l.$data=m;d&&(l[d]=m);e&&e(l,c,m);return l.$data}function m(){return h&&!a.a.Tb(h)}var l=this,g="function"==typeof b&&!a.I(b),h,r;k&&k.exportDependencies?f():(r=a.B(f,null,{ya:m,i:!0}),r.ca()&&(l.Q=r,r.equalityComparer=null,h=[],r.Dc=function(b){h.push(b);a.a.G.qa(b,function(b){a.a.Na(h,b);h.length||(r.k(),l.Q=r=n)})}))};a.R.prototype.createChildContext=function(b,c,d,e){return new a.R(b,this,c,function(a,b){a.$parentContext=b;a.$parent=b.$data;a.$parents=(b.$parents||[]).slice(0);a.$parents.unshift(a.$parent);
d&&d(a)},e)};a.R.prototype.extend=function(b){return new a.R(this.Q||this.$data,this,null,function(c,d){c.$rawData=d.$rawData;a.a.extend(c,"function"==typeof b?b():b)})};a.R.prototype.ac=function(a,b){return this.createChildContext(a,b,null,{exportDependencies:!0})};var q=a.a.e.J(),p=a.a.e.J();a.xc=function(b,c){if(2==arguments.length)a.a.e.set(b,p,c),c.Q&&c.Q.Dc(b);else return a.a.e.get(b,p)};a.La=function(b,c,d){1===b.nodeType&&a.f.oc(b);return m(b,c,k(d),!0)};a.Ic=function(b,c,d){d=k(d);return a.La(b,
e(c,d,b),d)};a.hb=function(a,b){1!==b.nodeType&&8!==b.nodeType||g(k(a),b,!0)};a.Ub=function(a,b){!u&&x.jQuery&&(u=x.jQuery);if(b&&1!==b.nodeType&&8!==b.nodeType)throw Error("ko.applyBindings: first parameter should be your view model; second parameter should be a DOM node");b=b||x.document.body;h(k(a),b,!0)};a.nb=function(b){switch(b.nodeType){case 1:case 8:var c=a.xc(b);if(c)return c;if(b.parentNode)return a.nb(b.parentNode)}return n};a.Oc=function(b){return(b=a.nb(b))?b.$data:n};a.b("bindingHandlers",
a.d);a.b("applyBindings",a.Ub);a.b("applyBindingsToDescendants",a.hb);a.b("applyBindingAccessorsToNode",a.La);a.b("applyBindingsToNode",a.Ic);a.b("contextFor",a.nb);a.b("dataFor",a.Oc)})();(function(b){function c(c,e){var m=f.hasOwnProperty(c)?f[c]:b,k;m?m.Y(e):(m=f[c]=new a.K,m.Y(e),d(c,function(b,d){var e=!(!d||!d.synchronous);g[c]={definition:b,dd:e};delete f[c];k||e?m.notifySubscribers(b):a.Z.Za(function(){m.notifySubscribers(b)})}),k=!0)}function d(a,b){e("getConfig",[a],function(c){c?e("loadComponent",
[a,c],function(a){b(a,c)}):b(null,null)})}function e(c,d,f,k){k||(k=a.g.loaders.slice(0));var g=k.shift();if(g){var q=g[c];if(q){var p=!1;if(q.apply(g,d.concat(function(a){p?f(null):null!==a?f(a):e(c,d,f,k)}))!==b&&(p=!0,!g.suppressLoaderExceptions))throw Error("Component loaders must supply values by invoking the callback, not by returning values synchronously.");}else e(c,d,f,k)}else f(null)}var f={},g={};a.g={get:function(d,e){var f=g.hasOwnProperty(d)?g[d]:b;f?f.dd?a.l.w(function(){e(f.definition)}):
a.Z.Za(function(){e(f.definition)}):c(d,e)},$b:function(a){delete g[a]},Nb:e};a.g.loaders=[];a.b("components",a.g);a.b("components.get",a.g.get);a.b("components.clearCachedDefinition",a.g.$b)})();(function(){function b(b,c,d,e){function g(){0===--y&&e(h)}var h={},y=2,v=d.template;d=d.viewModel;v?f(c,v,function(c){a.g.Nb("loadTemplate",[b,c],function(a){h.template=a;g()})}):g();d?f(c,d,function(c){a.g.Nb("loadViewModel",[b,c],function(a){h[l]=a;g()})}):g()}function c(a,b,d){if("function"===typeof b)d(function(a){return new b(a)});
else if("function"===typeof b[l])d(b[l]);else if("instance"in b){var e=b.instance;d(function(){return e})}else"viewModel"in b?c(a,b.viewModel,d):a("Unknown viewModel value: "+b)}function d(b){switch(a.a.A(b)){case "script":return a.a.na(b.text);case "textarea":return a.a.na(b.value);case "template":if(e(b.content))return a.a.wa(b.content.childNodes)}return a.a.wa(b.childNodes)}function e(a){return x.DocumentFragment?a instanceof DocumentFragment:a&&11===a.nodeType}function f(a,b,c){"string"===typeof b.require?
O||x.require?(O||x.require)([b.require],c):a("Uses require, but no AMD loader is present"):c(b)}function g(a){return function(b){throw Error("Component '"+a+"': "+b);}}var h={};a.g.register=function(b,c){if(!c)throw Error("Invalid configuration for "+b);if(a.g.wb(b))throw Error("Component "+b+" is already registered");h[b]=c};a.g.wb=function(a){return h.hasOwnProperty(a)};a.g.ud=function(b){delete h[b];a.g.$b(b)};a.g.cc={getConfig:function(a,b){b(h.hasOwnProperty(a)?h[a]:null)},loadComponent:function(a,
c,d){var e=g(a);f(e,c,function(c){b(a,e,c,d)})},loadTemplate:function(b,c,f){b=g(b);if("string"===typeof c)f(a.a.na(c));else if(c instanceof Array)f(c);else if(e(c))f(a.a.W(c.childNodes));else if(c.element)if(c=c.element,x.HTMLElement?c instanceof HTMLElement:c&&c.tagName&&1===c.nodeType)f(d(c));else if("string"===typeof c){var l=t.getElementById(c);l?f(d(l)):b("Cannot find element with ID "+c)}else b("Unknown element type: "+c);else b("Unknown template value: "+c)},loadViewModel:function(a,b,d){c(g(a),
b,d)}};var l="createViewModel";a.b("components.register",a.g.register);a.b("components.isRegistered",a.g.wb);a.b("components.unregister",a.g.ud);a.b("components.defaultLoader",a.g.cc);a.g.loaders.push(a.g.cc);a.g.Ec=h})();(function(){function b(b,e){var f=b.getAttribute("params");if(f){var f=c.parseBindingsString(f,e,b,{valueAccessors:!0,bindingParams:!0}),f=a.a.Ea(f,function(c){return a.m(c,null,{i:b})}),g=a.a.Ea(f,function(c){var e=c.p();return c.ca()?a.m({read:function(){return a.a.c(c())},write:a.Da(e)&&
function(a){c()(a)},i:b}):e});g.hasOwnProperty("$raw")||(g.$raw=f);return g}return{$raw:{}}}a.g.getComponentNameForNode=function(b){var c=a.a.A(b);if(a.g.wb(c)&&(-1!=c.indexOf("-")||"[object HTMLUnknownElement]"==""+b||8>=a.a.C&&b.tagName===c))return c};a.g.Rb=function(c,e,f,g){if(1===e.nodeType){var h=a.g.getComponentNameForNode(e);if(h){c=c||{};if(c.component)throw Error('Cannot use the "component" binding on a custom element matching a component');var l={name:h,params:b(e,f)};c.component=g?function(){return l}:
l}}return c};var c=new a.S;9>a.a.C&&(a.g.register=function(a){return function(b){t.createElement(b);return a.apply(this,arguments)}}(a.g.register),t.createDocumentFragment=function(b){return function(){var c=b(),f=a.g.Ec,g;for(g in f)f.hasOwnProperty(g)&&c.createElement(g);return c}}(t.createDocumentFragment))})();(function(b){function c(b,c,d){c=c.template;if(!c)throw Error("Component '"+b+"' has no template");b=a.a.wa(c);a.f.fa(d,b)}function d(a,b,c,d){var e=a.createViewModel;return e?e.call(a,
d,{element:b,templateNodes:c}):d}var e=0;a.d.component={init:function(f,g,h,l,m){function k(){var a=r&&r.dispose;"function"===typeof a&&a.call(r);q=r=null}var r,q,p=a.a.W(a.f.childNodes(f));a.a.G.qa(f,k);a.m(function(){var l=a.a.c(g()),h,v;"string"===typeof l?h=l:(h=a.a.c(l.name),v=a.a.c(l.params));if(!h)throw Error("No component name specified");var n=q=++e;a.g.get(h,function(e){if(q===n){k();if(!e)throw Error("Unknown component '"+h+"'");c(h,e,f);var l=d(e,f,p,v);e=m.createChildContext(l,b,function(a){a.$component=
l;a.$componentTemplateNodes=p});r=l;a.hb(e,f)}})},null,{i:f});return{controlsDescendantBindings:!0}}};a.f.aa.component=!0})();var Q={"class":"className","for":"htmlFor"};a.d.attr={update:function(b,c){var d=a.a.c(c())||{};a.a.D(d,function(c,d){d=a.a.c(d);var g=!1===d||null===d||d===n;g&&b.removeAttribute(c);8>=a.a.C&&c in Q?(c=Q[c],g?b.removeAttribute(c):b[c]=d):g||b.setAttribute(c,d.toString());"name"===c&&a.a.vc(b,g?"":d.toString())})}};(function(){a.d.checked={after:["value","attr"],init:function(b,
c,d){function e(){var e=b.checked,f=p?g():e;if(!a.xa.Va()&&(!l||e)){var h=a.l.w(c);if(k){var m=r?h.p():h;q!==f?(e&&(a.a.ra(m,f,!0),a.a.ra(m,q,!1)),q=f):a.a.ra(m,f,e);r&&a.Da(h)&&h(m)}else a.h.Ga(h,d,"checked",f,!0)}}function f(){var d=a.a.c(c());b.checked=k?0<=a.a.o(d,g()):h?d:g()===d}var g=a.rc(function(){return d.has("checkedValue")?a.a.c(d.get("checkedValue")):d.has("value")?a.a.c(d.get("value")):b.value}),h="checkbox"==b.type,l="radio"==b.type;if(h||l){var m=c(),k=h&&a.a.c(m)instanceof Array,
r=!(k&&m.push&&m.splice),q=k?g():n,p=l||k;l&&!b.name&&a.d.uniqueName.init(b,function(){return!0});a.m(e,null,{i:b});a.a.q(b,"click",e);a.m(f,null,{i:b});m=n}}};a.h.ga.checked=!0;a.d.checkedValue={update:function(b,c){b.value=a.a.c(c())}}})();a.d.css={update:function(b,c){var d=a.a.c(c());null!==d&&"object"==typeof d?a.a.D(d,function(c,d){d=a.a.c(d);a.a.fb(b,c,d)}):(d=a.a.cb(String(d||"")),a.a.fb(b,b.__ko__cssValue,!1),b.__ko__cssValue=d,a.a.fb(b,d,!0))}};a.d.enable={update:function(b,c){var d=a.a.c(c());
d&&b.disabled?b.removeAttribute("disabled"):d||b.disabled||(b.disabled=!0)}};a.d.disable={update:function(b,c){a.d.enable.update(b,function(){return!a.a.c(c())})}};a.d.event={init:function(b,c,d,e,f){var g=c()||{};a.a.D(g,function(g){"string"==typeof g&&a.a.q(b,g,function(b){var m,k=c()[g];if(k){try{var r=a.a.W(arguments);e=f.$data;r.unshift(e);m=k.apply(e,r)}finally{!0!==m&&(b.preventDefault?b.preventDefault():b.returnValue=!1)}!1===d.get(g+"Bubble")&&(b.cancelBubble=!0,b.stopPropagation&&b.stopPropagation())}})})}};
a.d.foreach={mc:function(b){return function(){var c=b(),d=a.a.Bb(c);if(!d||"number"==typeof d.length)return{foreach:c,templateEngine:a.X.vb};a.a.c(c);return{foreach:d.data,as:d.as,includeDestroyed:d.includeDestroyed,afterAdd:d.afterAdd,beforeRemove:d.beforeRemove,afterRender:d.afterRender,beforeMove:d.beforeMove,afterMove:d.afterMove,templateEngine:a.X.vb}}},init:function(b,c){return a.d.template.init(b,a.d.foreach.mc(c))},update:function(b,c,d,e,f){return a.d.template.update(b,a.d.foreach.mc(c),
d,e,f)}};a.h.va.foreach=!1;a.f.aa.foreach=!0;a.d.hasfocus={init:function(b,c,d){function e(e){b.__ko_hasfocusUpdating=!0;var f=b.ownerDocument;if("activeElement"in f){var g;try{g=f.activeElement}catch(k){g=f.body}e=g===b}f=c();a.h.Ga(f,d,"hasfocus",e,!0);b.__ko_hasfocusLastValue=e;b.__ko_hasfocusUpdating=!1}var f=e.bind(null,!0),g=e.bind(null,!1);a.a.q(b,"focus",f);a.a.q(b,"focusin",f);a.a.q(b,"blur",g);a.a.q(b,"focusout",g)},update:function(b,c){var d=!!a.a.c(c());b.__ko_hasfocusUpdating||b.__ko_hasfocusLastValue===
d||(d?b.focus():b.blur(),!d&&b.__ko_hasfocusLastValue&&b.ownerDocument.body.focus(),a.l.w(a.a.Fa,null,[b,d?"focusin":"focusout"]))}};a.h.ga.hasfocus=!0;a.d.hasFocus=a.d.hasfocus;a.h.ga.hasFocus=!0;a.d.html={init:function(){return{controlsDescendantBindings:!0}},update:function(b,c){a.a.Eb(b,c())}};K("if");K("ifnot",!1,!0);K("with",!0,!1,function(a,c){return a.ac(c)});var L={};a.d.options={init:function(b){if("select"!==a.a.A(b))throw Error("options binding applies only to SELECT elements");for(;0<
b.length;)b.remove(0);return{controlsDescendantBindings:!0}},update:function(b,c,d){function e(){return a.a.Ma(b.options,function(a){return a.selected})}function f(a,b,c){var d=typeof b;return"function"==d?b(a):"string"==d?a[b]:c}function g(c,e){if(A&&k)a.j.ja(b,a.a.c(d.get("value")),!0);else if(p.length){var f=0<=a.a.o(p,a.j.u(e[0]));a.a.wc(e[0],f);A&&!f&&a.l.w(a.a.Fa,null,[b,"change"])}}var h=b.multiple,l=0!=b.length&&h?b.scrollTop:null,m=a.a.c(c()),k=d.get("valueAllowUnset")&&d.has("value"),r=
d.get("optionsIncludeDestroyed");c={};var q,p=[];k||(h?p=a.a.ib(e(),a.j.u):0<=b.selectedIndex&&p.push(a.j.u(b.options[b.selectedIndex])));m&&("undefined"==typeof m.length&&(m=[m]),q=a.a.Ma(m,function(b){return r||b===n||null===b||!a.a.c(b._destroy)}),d.has("optionsCaption")&&(m=a.a.c(d.get("optionsCaption")),null!==m&&m!==n&&q.unshift(L)));var A=!1;c.beforeRemove=function(a){b.removeChild(a)};m=g;d.has("optionsAfterRender")&&"function"==typeof d.get("optionsAfterRender")&&(m=function(b,c){g(0,c);
a.l.w(d.get("optionsAfterRender"),null,[c[0],b!==L?b:n])});a.a.Db(b,q,function(c,e,g){g.length&&(p=!k&&g[0].selected?[a.j.u(g[0])]:[],A=!0);e=b.ownerDocument.createElement("option");c===L?(a.a.bb(e,d.get("optionsCaption")),a.j.ja(e,n)):(g=f(c,d.get("optionsValue"),c),a.j.ja(e,a.a.c(g)),c=f(c,d.get("optionsText"),g),a.a.bb(e,c));return[e]},c,m);a.l.w(function(){k?a.j.ja(b,a.a.c(d.get("value")),!0):(h?p.length&&e().length<p.length:p.length&&0<=b.selectedIndex?a.j.u(b.options[b.selectedIndex])!==p[0]:
p.length||0<=b.selectedIndex)&&a.a.Fa(b,"change")});a.a.Sc(b);l&&20<Math.abs(l-b.scrollTop)&&(b.scrollTop=l)}};a.d.options.zb=a.a.e.J();a.d.selectedOptions={after:["options","foreach"],init:function(b,c,d){a.a.q(b,"change",function(){var e=c(),f=[];a.a.r(b.getElementsByTagName("option"),function(b){b.selected&&f.push(a.j.u(b))});a.h.Ga(e,d,"selectedOptions",f)})},update:function(b,c){if("select"!=a.a.A(b))throw Error("values binding applies only to SELECT elements");var d=a.a.c(c()),e=b.scrollTop;
d&&"number"==typeof d.length&&a.a.r(b.getElementsByTagName("option"),function(b){var c=0<=a.a.o(d,a.j.u(b));b.selected!=c&&a.a.wc(b,c)});b.scrollTop=e}};a.h.ga.selectedOptions=!0;a.d.style={update:function(b,c){var d=a.a.c(c()||{});a.a.D(d,function(c,d){d=a.a.c(d);if(null===d||d===n||!1===d)d="";b.style[c]=d})}};a.d.submit={init:function(b,c,d,e,f){if("function"!=typeof c())throw Error("The value for a submit binding must be a function");a.a.q(b,"submit",function(a){var d,e=c();try{d=e.call(f.$data,
b)}finally{!0!==d&&(a.preventDefault?a.preventDefault():a.returnValue=!1)}})}};a.d.text={init:function(){return{controlsDescendantBindings:!0}},update:function(b,c){a.a.bb(b,c())}};a.f.aa.text=!0;(function(){if(x&&x.navigator)var b=function(a){if(a)return parseFloat(a[1])},c=x.opera&&x.opera.version&&parseInt(x.opera.version()),d=x.navigator.userAgent,e=b(d.match(/^(?:(?!chrome).)*version\/([^ ]*) safari/i)),f=b(d.match(/Firefox\/([^ ]*)/));if(10>a.a.C)var g=a.a.e.J(),h=a.a.e.J(),l=function(b){var c=
this.activeElement;(c=c&&a.a.e.get(c,h))&&c(b)},m=function(b,c){var d=b.ownerDocument;a.a.e.get(d,g)||(a.a.e.set(d,g,!0),a.a.q(d,"selectionchange",l));a.a.e.set(b,h,c)};a.d.textInput={init:function(b,d,g){function l(c,d){a.a.q(b,c,d)}function h(){var c=a.a.c(d());if(null===c||c===n)c="";u!==n&&c===u?a.a.setTimeout(h,4):b.value!==c&&(s=c,b.value=c)}function y(){t||(u=b.value,t=a.a.setTimeout(v,4))}function v(){clearTimeout(t);u=t=n;var c=b.value;s!==c&&(s=c,a.h.Ga(d(),g,"textInput",c))}var s=b.value,
t,u,x=9==a.a.C?y:v;10>a.a.C?(l("propertychange",function(a){"value"===a.propertyName&&x(a)}),8==a.a.C&&(l("keyup",v),l("keydown",v)),8<=a.a.C&&(m(b,x),l("dragend",y))):(l("input",v),5>e&&"textarea"===a.a.A(b)?(l("keydown",y),l("paste",y),l("cut",y)):11>c?l("keydown",y):4>f&&(l("DOMAutoComplete",v),l("dragdrop",v),l("drop",v)));l("change",v);a.m(h,null,{i:b})}};a.h.ga.textInput=!0;a.d.textinput={preprocess:function(a,b,c){c("textInput",a)}}})();a.d.uniqueName={init:function(b,c){if(c()){var d="ko_unique_"+
++a.d.uniqueName.Nc;a.a.vc(b,d)}}};a.d.uniqueName.Nc=0;a.d.value={after:["options","foreach"],init:function(b,c,d){if("input"!=b.tagName.toLowerCase()||"checkbox"!=b.type&&"radio"!=b.type){var e=["change"],f=d.get("valueUpdate"),g=!1,h=null;f&&("string"==typeof f&&(f=[f]),a.a.ta(e,f),e=a.a.Wb(e));var l=function(){h=null;g=!1;var e=c(),f=a.j.u(b);a.h.Ga(e,d,"value",f)};!a.a.C||"input"!=b.tagName.toLowerCase()||"text"!=b.type||"off"==b.autocomplete||b.form&&"off"==b.form.autocomplete||-1!=a.a.o(e,"propertychange")||
(a.a.q(b,"propertychange",function(){g=!0}),a.a.q(b,"focus",function(){g=!1}),a.a.q(b,"blur",function(){g&&l()}));a.a.r(e,function(c){var d=l;a.a.sd(c,"after")&&(d=function(){h=a.j.u(b);a.a.setTimeout(l,0)},c=c.substring(5));a.a.q(b,c,d)});var m=function(){var e=a.a.c(c()),f=a.j.u(b);if(null!==h&&e===h)a.a.setTimeout(m,0);else if(e!==f)if("select"===a.a.A(b)){var g=d.get("valueAllowUnset"),f=function(){a.j.ja(b,e,g)};f();g||e===a.j.u(b)?a.a.setTimeout(f,0):a.l.w(a.a.Fa,null,[b,"change"])}else a.j.ja(b,
e)};a.m(m,null,{i:b})}else a.La(b,{checkedValue:c})},update:function(){}};a.h.ga.value=!0;a.d.visible={update:function(b,c){var d=a.a.c(c()),e="none"!=b.style.display;d&&!e?b.style.display="":!d&&e&&(b.style.display="none")}};(function(b){a.d[b]={init:function(c,d,e,f,g){return a.d.event.init.call(this,c,function(){var a={};a[b]=d();return a},e,f,g)}}})("click");a.P=function(){};a.P.prototype.renderTemplateSource=function(){throw Error("Override renderTemplateSource");};a.P.prototype.createJavaScriptEvaluatorBlock=
function(){throw Error("Override createJavaScriptEvaluatorBlock");};a.P.prototype.makeTemplateSource=function(b,c){if("string"==typeof b){c=c||t;var d=c.getElementById(b);if(!d)throw Error("Cannot find template with ID "+b);return new a.v.n(d)}if(1==b.nodeType||8==b.nodeType)return new a.v.sa(b);throw Error("Unknown template type: "+b);};a.P.prototype.renderTemplate=function(a,c,d,e){a=this.makeTemplateSource(a,e);return this.renderTemplateSource(a,c,d,e)};a.P.prototype.isTemplateRewritten=function(a,
c){return!1===this.allowTemplateRewriting?!0:this.makeTemplateSource(a,c).data("isRewritten")};a.P.prototype.rewriteTemplate=function(a,c,d){a=this.makeTemplateSource(a,d);c=c(a.text());a.text(c);a.data("isRewritten",!0)};a.b("templateEngine",a.P);a.Ib=function(){function b(b,c,d,h){b=a.h.Ab(b);for(var l=a.h.va,m=0;m<b.length;m++){var k=b[m].key;if(l.hasOwnProperty(k)){var r=l[k];if("function"===typeof r){if(k=r(b[m].value))throw Error(k);}else if(!r)throw Error("This template engine does not support the '"+
k+"' binding within its templates");}}d="ko.__tr_ambtns(function($context,$element){return(function(){return{ "+a.h.Xa(b,{valueAccessors:!0})+" } })()},'"+d.toLowerCase()+"')";return h.createJavaScriptEvaluatorBlock(d)+c}var c=/(<([a-z]+\d*)(?:\s+(?!data-bind\s*=\s*)[a-z0-9\-]+(?:=(?:\"[^\"]*\"|\'[^\']*\'|[^>]*))?)*\s+)data-bind\s*=\s*(["'])([\s\S]*?)\3/gi,d=/\x3c!--\s*ko\b\s*([\s\S]*?)\s*--\x3e/g;return{Tc:function(b,c,d){c.isTemplateRewritten(b,d)||c.rewriteTemplate(b,function(b){return a.Ib.jd(b,
c)},d)},jd:function(a,f){return a.replace(c,function(a,c,d,e,k){return b(k,c,d,f)}).replace(d,function(a,c){return b(c,"\x3c!-- ko --\x3e","#comment",f)})},Jc:function(b,c){return a.N.yb(function(d,h){var l=d.nextSibling;l&&l.nodeName.toLowerCase()===c&&a.La(l,b,h)})}}}();a.b("__tr_ambtns",a.Ib.Jc);(function(){a.v={};a.v.n=function(b){if(this.n=b){var c=a.a.A(b);this.eb="script"===c?1:"textarea"===c?2:"template"==c&&b.content&&11===b.content.nodeType?3:4}};a.v.n.prototype.text=function(){var b=1===
this.eb?"text":2===this.eb?"value":"innerHTML";if(0==arguments.length)return this.n[b];var c=arguments[0];"innerHTML"===b?a.a.Eb(this.n,c):this.n[b]=c};var b=a.a.e.J()+"_";a.v.n.prototype.data=function(c){if(1===arguments.length)return a.a.e.get(this.n,b+c);a.a.e.set(this.n,b+c,arguments[1])};var c=a.a.e.J();a.v.n.prototype.nodes=function(){var b=this.n;if(0==arguments.length)return(a.a.e.get(b,c)||{}).mb||(3===this.eb?b.content:4===this.eb?b:n);a.a.e.set(b,c,{mb:arguments[0]})};a.v.sa=function(a){this.n=
a};a.v.sa.prototype=new a.v.n;a.v.sa.prototype.text=function(){if(0==arguments.length){var b=a.a.e.get(this.n,c)||{};b.Jb===n&&b.mb&&(b.Jb=b.mb.innerHTML);return b.Jb}a.a.e.set(this.n,c,{Jb:arguments[0]})};a.b("templateSources",a.v);a.b("templateSources.domElement",a.v.n);a.b("templateSources.anonymousTemplate",a.v.sa)})();(function(){function b(b,c,d){var e;for(c=a.f.nextSibling(c);b&&(e=b)!==c;)b=a.f.nextSibling(e),d(e,b)}function c(c,d){if(c.length){var e=c[0],f=c[c.length-1],g=e.parentNode,h=
a.S.instance,n=h.preprocessNode;if(n){b(e,f,function(a,b){var c=a.previousSibling,d=n.call(h,a);d&&(a===e&&(e=d[0]||b),a===f&&(f=d[d.length-1]||c))});c.length=0;if(!e)return;e===f?c.push(e):(c.push(e,f),a.a.Ba(c,g))}b(e,f,function(b){1!==b.nodeType&&8!==b.nodeType||a.Ub(d,b)});b(e,f,function(b){1!==b.nodeType&&8!==b.nodeType||a.N.Cc(b,[d])});a.a.Ba(c,g)}}function d(a){return a.nodeType?a:0<a.length?a[0]:null}function e(b,e,f,h,q){q=q||{};var p=(b&&d(b)||f||{}).ownerDocument,n=q.templateEngine||g;
a.Ib.Tc(f,n,p);f=n.renderTemplate(f,h,q,p);if("number"!=typeof f.length||0<f.length&&"number"!=typeof f[0].nodeType)throw Error("Template engine must return an array of DOM nodes");p=!1;switch(e){case "replaceChildren":a.f.fa(b,f);p=!0;break;case "replaceNode":a.a.uc(b,f);p=!0;break;case "ignoreTargetNode":break;default:throw Error("Unknown renderMode: "+e);}p&&(c(f,h),q.afterRender&&a.l.w(q.afterRender,null,[f,h.$data]));return f}function f(b,c,d){return a.I(b)?b():"function"===typeof b?b(c,d):b}
var g;a.Fb=function(b){if(b!=n&&!(b instanceof a.P))throw Error("templateEngine must inherit from ko.templateEngine");g=b};a.Cb=function(b,c,k,h,q){k=k||{};if((k.templateEngine||g)==n)throw Error("Set a template engine before calling renderTemplate");q=q||"replaceChildren";if(h){var p=d(h);return a.B(function(){var g=c&&c instanceof a.R?c:new a.R(c,null,null,null,{exportDependencies:!0}),n=f(b,g.$data,g),g=e(h,q,n,g,k);"replaceNode"==q&&(h=g,p=d(h))},null,{ya:function(){return!p||!a.a.qb(p)},i:p&&
"replaceNode"==q?p.parentNode:p})}return a.N.yb(function(d){a.Cb(b,c,k,d,"replaceNode")})};a.pd=function(b,d,g,h,q){function p(a,b){c(b,t);g.afterRender&&g.afterRender(b,a);t=null}function s(a,c){t=q.createChildContext(a,g.as,function(a){a.$index=c});var d=f(b,a,t);return e(null,"ignoreTargetNode",d,t,g)}var t;return a.B(function(){var b=a.a.c(d)||[];"undefined"==typeof b.length&&(b=[b]);b=a.a.Ma(b,function(b){return g.includeDestroyed||b===n||null===b||!a.a.c(b._destroy)});a.l.w(a.a.Db,null,[h,b,
s,g,p])},null,{i:h})};var h=a.a.e.J();a.d.template={init:function(b,c){var d=a.a.c(c());if("string"==typeof d||d.name)a.f.za(b);else{if("nodes"in d){if(d=d.nodes||[],a.I(d))throw Error('The "nodes" option must be a plain, non-observable array.');}else d=a.f.childNodes(b);d=a.a.nc(d);(new a.v.sa(b)).nodes(d)}return{controlsDescendantBindings:!0}},update:function(b,c,d,e,f){var g=c();c=a.a.c(g);d=!0;e=null;"string"==typeof c?c={}:(g=c.name,"if"in c&&(d=a.a.c(c["if"])),d&&"ifnot"in c&&(d=!a.a.c(c.ifnot)));
"foreach"in c?e=a.pd(g||b,d&&c.foreach||[],c,b,f):d?(f="data"in c?f.ac(c.data,c.as):f,e=a.Cb(g||b,f,c,b)):a.f.za(b);f=e;(c=a.a.e.get(b,h))&&"function"==typeof c.k&&c.k();a.a.e.set(b,h,f&&f.ca()?f:n)}};a.h.va.template=function(b){b=a.h.Ab(b);return 1==b.length&&b[0].unknown||a.h.fd(b,"name")?null:"This template engine does not support anonymous templates nested within its templates"};a.f.aa.template=!0})();a.b("setTemplateEngine",a.Fb);a.b("renderTemplate",a.Cb);a.a.hc=function(a,c,d){if(a.length&&
c.length){var e,f,g,h,l;for(e=f=0;(!d||e<d)&&(h=a[f]);++f){for(g=0;l=c[g];++g)if(h.value===l.value){h.moved=l.index;l.moved=h.index;c.splice(g,1);e=g=0;break}e+=g}}};a.a.lb=function(){function b(b,d,e,f,g){var h=Math.min,l=Math.max,m=[],k,n=b.length,q,p=d.length,s=p-n||1,t=n+p+1,v,u,x;for(k=0;k<=n;k++)for(u=v,m.push(v=[]),x=h(p,k+s),q=l(0,k-1);q<=x;q++)v[q]=q?k?b[k-1]===d[q-1]?u[q-1]:h(u[q]||t,v[q-1]||t)+1:q+1:k+1;h=[];l=[];s=[];k=n;for(q=p;k||q;)p=m[k][q]-1,q&&p===m[k][q-1]?l.push(h[h.length]={status:e,
value:d[--q],index:q}):k&&p===m[k-1][q]?s.push(h[h.length]={status:f,value:b[--k],index:k}):(--q,--k,g.sparse||h.push({status:"retained",value:d[q]}));a.a.hc(s,l,!g.dontLimitMoves&&10*n);return h.reverse()}return function(a,d,e){e="boolean"===typeof e?{dontLimitMoves:e}:e||{};a=a||[];d=d||[];return a.length<d.length?b(a,d,"added","deleted",e):b(d,a,"deleted","added",e)}}();a.b("utils.compareArrays",a.a.lb);(function(){function b(b,c,d,h,l){var m=[],k=a.B(function(){var k=c(d,l,a.a.Ba(m,b))||[];0<
m.length&&(a.a.uc(m,k),h&&a.l.w(h,null,[d,k,l]));m.length=0;a.a.ta(m,k)},null,{i:b,ya:function(){return!a.a.Tb(m)}});return{ea:m,B:k.ca()?k:n}}var c=a.a.e.J(),d=a.a.e.J();a.a.Db=function(e,f,g,h,l){function m(b,c){w=q[c];u!==c&&(D[b]=w);w.tb(u++);a.a.Ba(w.ea,e);t.push(w);z.push(w)}function k(b,c){if(b)for(var d=0,e=c.length;d<e;d++)c[d]&&a.a.r(c[d].ea,function(a){b(a,d,c[d].ka)})}f=f||[];h=h||{};var r=a.a.e.get(e,c)===n,q=a.a.e.get(e,c)||[],p=a.a.ib(q,function(a){return a.ka}),s=a.a.lb(p,f,h.dontLimitMoves),
t=[],v=0,u=0,x=[],z=[];f=[];for(var D=[],p=[],w,C=0,B,E;B=s[C];C++)switch(E=B.moved,B.status){case "deleted":E===n&&(w=q[v],w.B&&(w.B.k(),w.B=n),a.a.Ba(w.ea,e).length&&(h.beforeRemove&&(t.push(w),z.push(w),w.ka===d?w=null:f[C]=w),w&&x.push.apply(x,w.ea)));v++;break;case "retained":m(C,v++);break;case "added":E!==n?m(C,E):(w={ka:B.value,tb:a.O(u++)},t.push(w),z.push(w),r||(p[C]=w))}a.a.e.set(e,c,t);k(h.beforeMove,D);a.a.r(x,h.beforeRemove?a.ba:a.removeNode);for(var C=0,r=a.f.firstChild(e),F;w=z[C];C++){w.ea||
a.a.extend(w,b(e,g,w.ka,l,w.tb));for(v=0;s=w.ea[v];r=s.nextSibling,F=s,v++)s!==r&&a.f.kc(e,s,F);!w.ad&&l&&(l(w.ka,w.ea,w.tb),w.ad=!0)}k(h.beforeRemove,f);for(C=0;C<f.length;++C)f[C]&&(f[C].ka=d);k(h.afterMove,D);k(h.afterAdd,p)}})();a.b("utils.setDomNodeChildrenFromArrayMapping",a.a.Db);a.X=function(){this.allowTemplateRewriting=!1};a.X.prototype=new a.P;a.X.prototype.renderTemplateSource=function(b,c,d,e){if(c=(9>a.a.C?0:b.nodes)?b.nodes():null)return a.a.W(c.cloneNode(!0).childNodes);b=b.text();
return a.a.na(b,e)};a.X.vb=new a.X;a.Fb(a.X.vb);a.b("nativeTemplateEngine",a.X);(function(){a.xb=function(){var a=this.ed=function(){if(!u||!u.tmpl)return 0;try{if(0<=u.tmpl.tag.tmpl.open.toString().indexOf("__"))return 2}catch(a){}return 1}();this.renderTemplateSource=function(b,e,f,g){g=g||t;f=f||{};if(2>a)throw Error("Your version of jQuery.tmpl is too old. Please upgrade to jQuery.tmpl 1.0.0pre or later.");var h=b.data("precompiled");h||(h=b.text()||"",h=u.template(null,"{{ko_with $item.koBindingContext}}"+
h+"{{/ko_with}}"),b.data("precompiled",h));b=[e.$data];e=u.extend({koBindingContext:e},f.templateOptions);e=u.tmpl(h,b,e);e.appendTo(g.createElement("div"));u.fragments={};return e};this.createJavaScriptEvaluatorBlock=function(a){return"{{ko_code ((function() { return "+a+" })()) }}"};this.addTemplate=function(a,b){t.write("<script type='text/html' id='"+a+"'>"+b+"\x3c/script>")};0<a&&(u.tmpl.tag.ko_code={open:"__.push($1 || '');"},u.tmpl.tag.ko_with={open:"with($1) {",close:"} "})};a.xb.prototype=
new a.P;var b=new a.xb;0<b.ed&&a.Fb(b);a.b("jqueryTmplTemplateEngine",a.xb)})()})})();})();

/*! jQuery v2.2.4 | (c) jQuery Foundation | jquery.org/license */
!function(a,b){"object"==typeof module&&"object"==typeof module.exports?module.exports=a.document?b(a,!0):function(a){if(!a.document)throw new Error("jQuery requires a window with a document");return b(a)}:b(a)}("undefined"!=typeof window?window:this,function(a,b){var c=[],d=a.document,e=c.slice,f=c.concat,g=c.push,h=c.indexOf,i={},j=i.toString,k=i.hasOwnProperty,l={},m="2.2.4",n=function(a,b){return new n.fn.init(a,b)},o=/^[\s\uFEFF\xA0]+|[\s\uFEFF\xA0]+$/g,p=/^-ms-/,q=/-([\da-z])/gi,r=function(a,b){return b.toUpperCase()};n.fn=n.prototype={jquery:m,constructor:n,selector:"",length:0,toArray:function(){return e.call(this)},get:function(a){return null!=a?0>a?this[a+this.length]:this[a]:e.call(this)},pushStack:function(a){var b=n.merge(this.constructor(),a);return b.prevObject=this,b.context=this.context,b},each:function(a){return n.each(this,a)},map:function(a){return this.pushStack(n.map(this,function(b,c){return a.call(b,c,b)}))},slice:function(){return this.pushStack(e.apply(this,arguments))},first:function(){return this.eq(0)},last:function(){return this.eq(-1)},eq:function(a){var b=this.length,c=+a+(0>a?b:0);return this.pushStack(c>=0&&b>c?[this[c]]:[])},end:function(){return this.prevObject||this.constructor()},push:g,sort:c.sort,splice:c.splice},n.extend=n.fn.extend=function(){var a,b,c,d,e,f,g=arguments[0]||{},h=1,i=arguments.length,j=!1;for("boolean"==typeof g&&(j=g,g=arguments[h]||{},h++),"object"==typeof g||n.isFunction(g)||(g={}),h===i&&(g=this,h--);i>h;h++)if(null!=(a=arguments[h]))for(b in a)c=g[b],d=a[b],g!==d&&(j&&d&&(n.isPlainObject(d)||(e=n.isArray(d)))?(e?(e=!1,f=c&&n.isArray(c)?c:[]):f=c&&n.isPlainObject(c)?c:{},g[b]=n.extend(j,f,d)):void 0!==d&&(g[b]=d));return g},n.extend({expando:"jQuery"+(m+Math.random()).replace(/\D/g,""),isReady:!0,error:function(a){throw new Error(a)},noop:function(){},isFunction:function(a){return"function"===n.type(a)},isArray:Array.isArray,isWindow:function(a){return null!=a&&a===a.window},isNumeric:function(a){var b=a&&a.toString();return!n.isArray(a)&&b-parseFloat(b)+1>=0},isPlainObject:function(a){var b;if("object"!==n.type(a)||a.nodeType||n.isWindow(a))return!1;if(a.constructor&&!k.call(a,"constructor")&&!k.call(a.constructor.prototype||{},"isPrototypeOf"))return!1;for(b in a);return void 0===b||k.call(a,b)},isEmptyObject:function(a){var b;for(b in a)return!1;return!0},type:function(a){return null==a?a+"":"object"==typeof a||"function"==typeof a?i[j.call(a)]||"object":typeof a},globalEval:function(a){var b,c=eval;a=n.trim(a),a&&(1===a.indexOf("use strict")?(b=d.createElement("script"),b.text=a,d.head.appendChild(b).parentNode.removeChild(b)):c(a))},camelCase:function(a){return a.replace(p,"ms-").replace(q,r)},nodeName:function(a,b){return a.nodeName&&a.nodeName.toLowerCase()===b.toLowerCase()},each:function(a,b){var c,d=0;if(s(a)){for(c=a.length;c>d;d++)if(b.call(a[d],d,a[d])===!1)break}else for(d in a)if(b.call(a[d],d,a[d])===!1)break;return a},trim:function(a){return null==a?"":(a+"").replace(o,"")},makeArray:function(a,b){var c=b||[];return null!=a&&(s(Object(a))?n.merge(c,"string"==typeof a?[a]:a):g.call(c,a)),c},inArray:function(a,b,c){return null==b?-1:h.call(b,a,c)},merge:function(a,b){for(var c=+b.length,d=0,e=a.length;c>d;d++)a[e++]=b[d];return a.length=e,a},grep:function(a,b,c){for(var d,e=[],f=0,g=a.length,h=!c;g>f;f++)d=!b(a[f],f),d!==h&&e.push(a[f]);return e},map:function(a,b,c){var d,e,g=0,h=[];if(s(a))for(d=a.length;d>g;g++)e=b(a[g],g,c),null!=e&&h.push(e);else for(g in a)e=b(a[g],g,c),null!=e&&h.push(e);return f.apply([],h)},guid:1,proxy:function(a,b){var c,d,f;return"string"==typeof b&&(c=a[b],b=a,a=c),n.isFunction(a)?(d=e.call(arguments,2),f=function(){return a.apply(b||this,d.concat(e.call(arguments)))},f.guid=a.guid=a.guid||n.guid++,f):void 0},now:Date.now,support:l}),"function"==typeof Symbol&&(n.fn[Symbol.iterator]=c[Symbol.iterator]),n.each("Boolean Number String Function Array Date RegExp Object Error Symbol".split(" "),function(a,b){i["[object "+b+"]"]=b.toLowerCase()});function s(a){var b=!!a&&"length"in a&&a.length,c=n.type(a);return"function"===c||n.isWindow(a)?!1:"array"===c||0===b||"number"==typeof b&&b>0&&b-1 in a}var t=function(a){var b,c,d,e,f,g,h,i,j,k,l,m,n,o,p,q,r,s,t,u="sizzle"+1*new Date,v=a.document,w=0,x=0,y=ga(),z=ga(),A=ga(),B=function(a,b){return a===b&&(l=!0),0},C=1<<31,D={}.hasOwnProperty,E=[],F=E.pop,G=E.push,H=E.push,I=E.slice,J=function(a,b){for(var c=0,d=a.length;d>c;c++)if(a[c]===b)return c;return-1},K="checked|selected|async|autofocus|autoplay|controls|defer|disabled|hidden|ismap|loop|multiple|open|readonly|required|scoped",L="[\\x20\\t\\r\\n\\f]",M="(?:\\\\.|[\\w-]|[^\\x00-\\xa0])+",N="\\["+L+"*("+M+")(?:"+L+"*([*^$|!~]?=)"+L+"*(?:'((?:\\\\.|[^\\\\'])*)'|\"((?:\\\\.|[^\\\\\"])*)\"|("+M+"))|)"+L+"*\\]",O=":("+M+")(?:\\((('((?:\\\\.|[^\\\\'])*)'|\"((?:\\\\.|[^\\\\\"])*)\")|((?:\\\\.|[^\\\\()[\\]]|"+N+")*)|.*)\\)|)",P=new RegExp(L+"+","g"),Q=new RegExp("^"+L+"+|((?:^|[^\\\\])(?:\\\\.)*)"+L+"+$","g"),R=new RegExp("^"+L+"*,"+L+"*"),S=new RegExp("^"+L+"*([>+~]|"+L+")"+L+"*"),T=new RegExp("="+L+"*([^\\]'\"]*?)"+L+"*\\]","g"),U=new RegExp(O),V=new RegExp("^"+M+"$"),W={ID:new RegExp("^#("+M+")"),CLASS:new RegExp("^\\.("+M+")"),TAG:new RegExp("^("+M+"|[*])"),ATTR:new RegExp("^"+N),PSEUDO:new RegExp("^"+O),CHILD:new RegExp("^:(only|first|last|nth|nth-last)-(child|of-type)(?:\\("+L+"*(even|odd|(([+-]|)(\\d*)n|)"+L+"*(?:([+-]|)"+L+"*(\\d+)|))"+L+"*\\)|)","i"),bool:new RegExp("^(?:"+K+")$","i"),needsContext:new RegExp("^"+L+"*[>+~]|:(even|odd|eq|gt|lt|nth|first|last)(?:\\("+L+"*((?:-\\d)?\\d*)"+L+"*\\)|)(?=[^-]|$)","i")},X=/^(?:input|select|textarea|button)$/i,Y=/^h\d$/i,Z=/^[^{]+\{\s*\[native \w/,$=/^(?:#([\w-]+)|(\w+)|\.([\w-]+))$/,_=/[+~]/,aa=/'|\\/g,ba=new RegExp("\\\\([\\da-f]{1,6}"+L+"?|("+L+")|.)","ig"),ca=function(a,b,c){var d="0x"+b-65536;return d!==d||c?b:0>d?String.fromCharCode(d+65536):String.fromCharCode(d>>10|55296,1023&d|56320)},da=function(){m()};try{H.apply(E=I.call(v.childNodes),v.childNodes),E[v.childNodes.length].nodeType}catch(ea){H={apply:E.length?function(a,b){G.apply(a,I.call(b))}:function(a,b){var c=a.length,d=0;while(a[c++]=b[d++]);a.length=c-1}}}function fa(a,b,d,e){var f,h,j,k,l,o,r,s,w=b&&b.ownerDocument,x=b?b.nodeType:9;if(d=d||[],"string"!=typeof a||!a||1!==x&&9!==x&&11!==x)return d;if(!e&&((b?b.ownerDocument||b:v)!==n&&m(b),b=b||n,p)){if(11!==x&&(o=$.exec(a)))if(f=o[1]){if(9===x){if(!(j=b.getElementById(f)))return d;if(j.id===f)return d.push(j),d}else if(w&&(j=w.getElementById(f))&&t(b,j)&&j.id===f)return d.push(j),d}else{if(o[2])return H.apply(d,b.getElementsByTagName(a)),d;if((f=o[3])&&c.getElementsByClassName&&b.getElementsByClassName)return H.apply(d,b.getElementsByClassName(f)),d}if(c.qsa&&!A[a+" "]&&(!q||!q.test(a))){if(1!==x)w=b,s=a;else if("object"!==b.nodeName.toLowerCase()){(k=b.getAttribute("id"))?k=k.replace(aa,"\\$&"):b.setAttribute("id",k=u),r=g(a),h=r.length,l=V.test(k)?"#"+k:"[id='"+k+"']";while(h--)r[h]=l+" "+qa(r[h]);s=r.join(","),w=_.test(a)&&oa(b.parentNode)||b}if(s)try{return H.apply(d,w.querySelectorAll(s)),d}catch(y){}finally{k===u&&b.removeAttribute("id")}}}return i(a.replace(Q,"$1"),b,d,e)}function ga(){var a=[];function b(c,e){return a.push(c+" ")>d.cacheLength&&delete b[a.shift()],b[c+" "]=e}return b}function ha(a){return a[u]=!0,a}function ia(a){var b=n.createElement("div");try{return!!a(b)}catch(c){return!1}finally{b.parentNode&&b.parentNode.removeChild(b),b=null}}function ja(a,b){var c=a.split("|"),e=c.length;while(e--)d.attrHandle[c[e]]=b}function ka(a,b){var c=b&&a,d=c&&1===a.nodeType&&1===b.nodeType&&(~b.sourceIndex||C)-(~a.sourceIndex||C);if(d)return d;if(c)while(c=c.nextSibling)if(c===b)return-1;return a?1:-1}function la(a){return function(b){var c=b.nodeName.toLowerCase();return"input"===c&&b.type===a}}function ma(a){return function(b){var c=b.nodeName.toLowerCase();return("input"===c||"button"===c)&&b.type===a}}function na(a){return ha(function(b){return b=+b,ha(function(c,d){var e,f=a([],c.length,b),g=f.length;while(g--)c[e=f[g]]&&(c[e]=!(d[e]=c[e]))})})}function oa(a){return a&&"undefined"!=typeof a.getElementsByTagName&&a}c=fa.support={},f=fa.isXML=function(a){var b=a&&(a.ownerDocument||a).documentElement;return b?"HTML"!==b.nodeName:!1},m=fa.setDocument=function(a){var b,e,g=a?a.ownerDocument||a:v;return g!==n&&9===g.nodeType&&g.documentElement?(n=g,o=n.documentElement,p=!f(n),(e=n.defaultView)&&e.top!==e&&(e.addEventListener?e.addEventListener("unload",da,!1):e.attachEvent&&e.attachEvent("onunload",da)),c.attributes=ia(function(a){return a.className="i",!a.getAttribute("className")}),c.getElementsByTagName=ia(function(a){return a.appendChild(n.createComment("")),!a.getElementsByTagName("*").length}),c.getElementsByClassName=Z.test(n.getElementsByClassName),c.getById=ia(function(a){return o.appendChild(a).id=u,!n.getElementsByName||!n.getElementsByName(u).length}),c.getById?(d.find.ID=function(a,b){if("undefined"!=typeof b.getElementById&&p){var c=b.getElementById(a);return c?[c]:[]}},d.filter.ID=function(a){var b=a.replace(ba,ca);return function(a){return a.getAttribute("id")===b}}):(delete d.find.ID,d.filter.ID=function(a){var b=a.replace(ba,ca);return function(a){var c="undefined"!=typeof a.getAttributeNode&&a.getAttributeNode("id");return c&&c.value===b}}),d.find.TAG=c.getElementsByTagName?function(a,b){return"undefined"!=typeof b.getElementsByTagName?b.getElementsByTagName(a):c.qsa?b.querySelectorAll(a):void 0}:function(a,b){var c,d=[],e=0,f=b.getElementsByTagName(a);if("*"===a){while(c=f[e++])1===c.nodeType&&d.push(c);return d}return f},d.find.CLASS=c.getElementsByClassName&&function(a,b){return"undefined"!=typeof b.getElementsByClassName&&p?b.getElementsByClassName(a):void 0},r=[],q=[],(c.qsa=Z.test(n.querySelectorAll))&&(ia(function(a){o.appendChild(a).innerHTML="<a id='"+u+"'></a><select id='"+u+"-\r\\' msallowcapture=''><option selected=''></option></select>",a.querySelectorAll("[msallowcapture^='']").length&&q.push("[*^$]="+L+"*(?:''|\"\")"),a.querySelectorAll("[selected]").length||q.push("\\["+L+"*(?:value|"+K+")"),a.querySelectorAll("[id~="+u+"-]").length||q.push("~="),a.querySelectorAll(":checked").length||q.push(":checked"),a.querySelectorAll("a#"+u+"+*").length||q.push(".#.+[+~]")}),ia(function(a){var b=n.createElement("input");b.setAttribute("type","hidden"),a.appendChild(b).setAttribute("name","D"),a.querySelectorAll("[name=d]").length&&q.push("name"+L+"*[*^$|!~]?="),a.querySelectorAll(":enabled").length||q.push(":enabled",":disabled"),a.querySelectorAll("*,:x"),q.push(",.*:")})),(c.matchesSelector=Z.test(s=o.matches||o.webkitMatchesSelector||o.mozMatchesSelector||o.oMatchesSelector||o.msMatchesSelector))&&ia(function(a){c.disconnectedMatch=s.call(a,"div"),s.call(a,"[s!='']:x"),r.push("!=",O)}),q=q.length&&new RegExp(q.join("|")),r=r.length&&new RegExp(r.join("|")),b=Z.test(o.compareDocumentPosition),t=b||Z.test(o.contains)?function(a,b){var c=9===a.nodeType?a.documentElement:a,d=b&&b.parentNode;return a===d||!(!d||1!==d.nodeType||!(c.contains?c.contains(d):a.compareDocumentPosition&&16&a.compareDocumentPosition(d)))}:function(a,b){if(b)while(b=b.parentNode)if(b===a)return!0;return!1},B=b?function(a,b){if(a===b)return l=!0,0;var d=!a.compareDocumentPosition-!b.compareDocumentPosition;return d?d:(d=(a.ownerDocument||a)===(b.ownerDocument||b)?a.compareDocumentPosition(b):1,1&d||!c.sortDetached&&b.compareDocumentPosition(a)===d?a===n||a.ownerDocument===v&&t(v,a)?-1:b===n||b.ownerDocument===v&&t(v,b)?1:k?J(k,a)-J(k,b):0:4&d?-1:1)}:function(a,b){if(a===b)return l=!0,0;var c,d=0,e=a.parentNode,f=b.parentNode,g=[a],h=[b];if(!e||!f)return a===n?-1:b===n?1:e?-1:f?1:k?J(k,a)-J(k,b):0;if(e===f)return ka(a,b);c=a;while(c=c.parentNode)g.unshift(c);c=b;while(c=c.parentNode)h.unshift(c);while(g[d]===h[d])d++;return d?ka(g[d],h[d]):g[d]===v?-1:h[d]===v?1:0},n):n},fa.matches=function(a,b){return fa(a,null,null,b)},fa.matchesSelector=function(a,b){if((a.ownerDocument||a)!==n&&m(a),b=b.replace(T,"='$1']"),c.matchesSelector&&p&&!A[b+" "]&&(!r||!r.test(b))&&(!q||!q.test(b)))try{var d=s.call(a,b);if(d||c.disconnectedMatch||a.document&&11!==a.document.nodeType)return d}catch(e){}return fa(b,n,null,[a]).length>0},fa.contains=function(a,b){return(a.ownerDocument||a)!==n&&m(a),t(a,b)},fa.attr=function(a,b){(a.ownerDocument||a)!==n&&m(a);var e=d.attrHandle[b.toLowerCase()],f=e&&D.call(d.attrHandle,b.toLowerCase())?e(a,b,!p):void 0;return void 0!==f?f:c.attributes||!p?a.getAttribute(b):(f=a.getAttributeNode(b))&&f.specified?f.value:null},fa.error=function(a){throw new Error("Syntax error, unrecognized expression: "+a)},fa.uniqueSort=function(a){var b,d=[],e=0,f=0;if(l=!c.detectDuplicates,k=!c.sortStable&&a.slice(0),a.sort(B),l){while(b=a[f++])b===a[f]&&(e=d.push(f));while(e--)a.splice(d[e],1)}return k=null,a},e=fa.getText=function(a){var b,c="",d=0,f=a.nodeType;if(f){if(1===f||9===f||11===f){if("string"==typeof a.textContent)return a.textContent;for(a=a.firstChild;a;a=a.nextSibling)c+=e(a)}else if(3===f||4===f)return a.nodeValue}else while(b=a[d++])c+=e(b);return c},d=fa.selectors={cacheLength:50,createPseudo:ha,match:W,attrHandle:{},find:{},relative:{">":{dir:"parentNode",first:!0}," ":{dir:"parentNode"},"+":{dir:"previousSibling",first:!0},"~":{dir:"previousSibling"}},preFilter:{ATTR:function(a){return a[1]=a[1].replace(ba,ca),a[3]=(a[3]||a[4]||a[5]||"").replace(ba,ca),"~="===a[2]&&(a[3]=" "+a[3]+" "),a.slice(0,4)},CHILD:function(a){return a[1]=a[1].toLowerCase(),"nth"===a[1].slice(0,3)?(a[3]||fa.error(a[0]),a[4]=+(a[4]?a[5]+(a[6]||1):2*("even"===a[3]||"odd"===a[3])),a[5]=+(a[7]+a[8]||"odd"===a[3])):a[3]&&fa.error(a[0]),a},PSEUDO:function(a){var b,c=!a[6]&&a[2];return W.CHILD.test(a[0])?null:(a[3]?a[2]=a[4]||a[5]||"":c&&U.test(c)&&(b=g(c,!0))&&(b=c.indexOf(")",c.length-b)-c.length)&&(a[0]=a[0].slice(0,b),a[2]=c.slice(0,b)),a.slice(0,3))}},filter:{TAG:function(a){var b=a.replace(ba,ca).toLowerCase();return"*"===a?function(){return!0}:function(a){return a.nodeName&&a.nodeName.toLowerCase()===b}},CLASS:function(a){var b=y[a+" "];return b||(b=new RegExp("(^|"+L+")"+a+"("+L+"|$)"))&&y(a,function(a){return b.test("string"==typeof a.className&&a.className||"undefined"!=typeof a.getAttribute&&a.getAttribute("class")||"")})},ATTR:function(a,b,c){return function(d){var e=fa.attr(d,a);return null==e?"!="===b:b?(e+="","="===b?e===c:"!="===b?e!==c:"^="===b?c&&0===e.indexOf(c):"*="===b?c&&e.indexOf(c)>-1:"$="===b?c&&e.slice(-c.length)===c:"~="===b?(" "+e.replace(P," ")+" ").indexOf(c)>-1:"|="===b?e===c||e.slice(0,c.length+1)===c+"-":!1):!0}},CHILD:function(a,b,c,d,e){var f="nth"!==a.slice(0,3),g="last"!==a.slice(-4),h="of-type"===b;return 1===d&&0===e?function(a){return!!a.parentNode}:function(b,c,i){var j,k,l,m,n,o,p=f!==g?"nextSibling":"previousSibling",q=b.parentNode,r=h&&b.nodeName.toLowerCase(),s=!i&&!h,t=!1;if(q){if(f){while(p){m=b;while(m=m[p])if(h?m.nodeName.toLowerCase()===r:1===m.nodeType)return!1;o=p="only"===a&&!o&&"nextSibling"}return!0}if(o=[g?q.firstChild:q.lastChild],g&&s){m=q,l=m[u]||(m[u]={}),k=l[m.uniqueID]||(l[m.uniqueID]={}),j=k[a]||[],n=j[0]===w&&j[1],t=n&&j[2],m=n&&q.childNodes[n];while(m=++n&&m&&m[p]||(t=n=0)||o.pop())if(1===m.nodeType&&++t&&m===b){k[a]=[w,n,t];break}}else if(s&&(m=b,l=m[u]||(m[u]={}),k=l[m.uniqueID]||(l[m.uniqueID]={}),j=k[a]||[],n=j[0]===w&&j[1],t=n),t===!1)while(m=++n&&m&&m[p]||(t=n=0)||o.pop())if((h?m.nodeName.toLowerCase()===r:1===m.nodeType)&&++t&&(s&&(l=m[u]||(m[u]={}),k=l[m.uniqueID]||(l[m.uniqueID]={}),k[a]=[w,t]),m===b))break;return t-=e,t===d||t%d===0&&t/d>=0}}},PSEUDO:function(a,b){var c,e=d.pseudos[a]||d.setFilters[a.toLowerCase()]||fa.error("unsupported pseudo: "+a);return e[u]?e(b):e.length>1?(c=[a,a,"",b],d.setFilters.hasOwnProperty(a.toLowerCase())?ha(function(a,c){var d,f=e(a,b),g=f.length;while(g--)d=J(a,f[g]),a[d]=!(c[d]=f[g])}):function(a){return e(a,0,c)}):e}},pseudos:{not:ha(function(a){var b=[],c=[],d=h(a.replace(Q,"$1"));return d[u]?ha(function(a,b,c,e){var f,g=d(a,null,e,[]),h=a.length;while(h--)(f=g[h])&&(a[h]=!(b[h]=f))}):function(a,e,f){return b[0]=a,d(b,null,f,c),b[0]=null,!c.pop()}}),has:ha(function(a){return function(b){return fa(a,b).length>0}}),contains:ha(function(a){return a=a.replace(ba,ca),function(b){return(b.textContent||b.innerText||e(b)).indexOf(a)>-1}}),lang:ha(function(a){return V.test(a||"")||fa.error("unsupported lang: "+a),a=a.replace(ba,ca).toLowerCase(),function(b){var c;do if(c=p?b.lang:b.getAttribute("xml:lang")||b.getAttribute("lang"))return c=c.toLowerCase(),c===a||0===c.indexOf(a+"-");while((b=b.parentNode)&&1===b.nodeType);return!1}}),target:function(b){var c=a.location&&a.location.hash;return c&&c.slice(1)===b.id},root:function(a){return a===o},focus:function(a){return a===n.activeElement&&(!n.hasFocus||n.hasFocus())&&!!(a.type||a.href||~a.tabIndex)},enabled:function(a){return a.disabled===!1},disabled:function(a){return a.disabled===!0},checked:function(a){var b=a.nodeName.toLowerCase();return"input"===b&&!!a.checked||"option"===b&&!!a.selected},selected:function(a){return a.parentNode&&a.parentNode.selectedIndex,a.selected===!0},empty:function(a){for(a=a.firstChild;a;a=a.nextSibling)if(a.nodeType<6)return!1;return!0},parent:function(a){return!d.pseudos.empty(a)},header:function(a){return Y.test(a.nodeName)},input:function(a){return X.test(a.nodeName)},button:function(a){var b=a.nodeName.toLowerCase();return"input"===b&&"button"===a.type||"button"===b},text:function(a){var b;return"input"===a.nodeName.toLowerCase()&&"text"===a.type&&(null==(b=a.getAttribute("type"))||"text"===b.toLowerCase())},first:na(function(){return[0]}),last:na(function(a,b){return[b-1]}),eq:na(function(a,b,c){return[0>c?c+b:c]}),even:na(function(a,b){for(var c=0;b>c;c+=2)a.push(c);return a}),odd:na(function(a,b){for(var c=1;b>c;c+=2)a.push(c);return a}),lt:na(function(a,b,c){for(var d=0>c?c+b:c;--d>=0;)a.push(d);return a}),gt:na(function(a,b,c){for(var d=0>c?c+b:c;++d<b;)a.push(d);return a})}},d.pseudos.nth=d.pseudos.eq;for(b in{radio:!0,checkbox:!0,file:!0,password:!0,image:!0})d.pseudos[b]=la(b);for(b in{submit:!0,reset:!0})d.pseudos[b]=ma(b);function pa(){}pa.prototype=d.filters=d.pseudos,d.setFilters=new pa,g=fa.tokenize=function(a,b){var c,e,f,g,h,i,j,k=z[a+" "];if(k)return b?0:k.slice(0);h=a,i=[],j=d.preFilter;while(h){c&&!(e=R.exec(h))||(e&&(h=h.slice(e[0].length)||h),i.push(f=[])),c=!1,(e=S.exec(h))&&(c=e.shift(),f.push({value:c,type:e[0].replace(Q," ")}),h=h.slice(c.length));for(g in d.filter)!(e=W[g].exec(h))||j[g]&&!(e=j[g](e))||(c=e.shift(),f.push({value:c,type:g,matches:e}),h=h.slice(c.length));if(!c)break}return b?h.length:h?fa.error(a):z(a,i).slice(0)};function qa(a){for(var b=0,c=a.length,d="";c>b;b++)d+=a[b].value;return d}function ra(a,b,c){var d=b.dir,e=c&&"parentNode"===d,f=x++;return b.first?function(b,c,f){while(b=b[d])if(1===b.nodeType||e)return a(b,c,f)}:function(b,c,g){var h,i,j,k=[w,f];if(g){while(b=b[d])if((1===b.nodeType||e)&&a(b,c,g))return!0}else while(b=b[d])if(1===b.nodeType||e){if(j=b[u]||(b[u]={}),i=j[b.uniqueID]||(j[b.uniqueID]={}),(h=i[d])&&h[0]===w&&h[1]===f)return k[2]=h[2];if(i[d]=k,k[2]=a(b,c,g))return!0}}}function sa(a){return a.length>1?function(b,c,d){var e=a.length;while(e--)if(!a[e](b,c,d))return!1;return!0}:a[0]}function ta(a,b,c){for(var d=0,e=b.length;e>d;d++)fa(a,b[d],c);return c}function ua(a,b,c,d,e){for(var f,g=[],h=0,i=a.length,j=null!=b;i>h;h++)(f=a[h])&&(c&&!c(f,d,e)||(g.push(f),j&&b.push(h)));return g}function va(a,b,c,d,e,f){return d&&!d[u]&&(d=va(d)),e&&!e[u]&&(e=va(e,f)),ha(function(f,g,h,i){var j,k,l,m=[],n=[],o=g.length,p=f||ta(b||"*",h.nodeType?[h]:h,[]),q=!a||!f&&b?p:ua(p,m,a,h,i),r=c?e||(f?a:o||d)?[]:g:q;if(c&&c(q,r,h,i),d){j=ua(r,n),d(j,[],h,i),k=j.length;while(k--)(l=j[k])&&(r[n[k]]=!(q[n[k]]=l))}if(f){if(e||a){if(e){j=[],k=r.length;while(k--)(l=r[k])&&j.push(q[k]=l);e(null,r=[],j,i)}k=r.length;while(k--)(l=r[k])&&(j=e?J(f,l):m[k])>-1&&(f[j]=!(g[j]=l))}}else r=ua(r===g?r.splice(o,r.length):r),e?e(null,g,r,i):H.apply(g,r)})}function wa(a){for(var b,c,e,f=a.length,g=d.relative[a[0].type],h=g||d.relative[" "],i=g?1:0,k=ra(function(a){return a===b},h,!0),l=ra(function(a){return J(b,a)>-1},h,!0),m=[function(a,c,d){var e=!g&&(d||c!==j)||((b=c).nodeType?k(a,c,d):l(a,c,d));return b=null,e}];f>i;i++)if(c=d.relative[a[i].type])m=[ra(sa(m),c)];else{if(c=d.filter[a[i].type].apply(null,a[i].matches),c[u]){for(e=++i;f>e;e++)if(d.relative[a[e].type])break;return va(i>1&&sa(m),i>1&&qa(a.slice(0,i-1).concat({value:" "===a[i-2].type?"*":""})).replace(Q,"$1"),c,e>i&&wa(a.slice(i,e)),f>e&&wa(a=a.slice(e)),f>e&&qa(a))}m.push(c)}return sa(m)}function xa(a,b){var c=b.length>0,e=a.length>0,f=function(f,g,h,i,k){var l,o,q,r=0,s="0",t=f&&[],u=[],v=j,x=f||e&&d.find.TAG("*",k),y=w+=null==v?1:Math.random()||.1,z=x.length;for(k&&(j=g===n||g||k);s!==z&&null!=(l=x[s]);s++){if(e&&l){o=0,g||l.ownerDocument===n||(m(l),h=!p);while(q=a[o++])if(q(l,g||n,h)){i.push(l);break}k&&(w=y)}c&&((l=!q&&l)&&r--,f&&t.push(l))}if(r+=s,c&&s!==r){o=0;while(q=b[o++])q(t,u,g,h);if(f){if(r>0)while(s--)t[s]||u[s]||(u[s]=F.call(i));u=ua(u)}H.apply(i,u),k&&!f&&u.length>0&&r+b.length>1&&fa.uniqueSort(i)}return k&&(w=y,j=v),t};return c?ha(f):f}return h=fa.compile=function(a,b){var c,d=[],e=[],f=A[a+" "];if(!f){b||(b=g(a)),c=b.length;while(c--)f=wa(b[c]),f[u]?d.push(f):e.push(f);f=A(a,xa(e,d)),f.selector=a}return f},i=fa.select=function(a,b,e,f){var i,j,k,l,m,n="function"==typeof a&&a,o=!f&&g(a=n.selector||a);if(e=e||[],1===o.length){if(j=o[0]=o[0].slice(0),j.length>2&&"ID"===(k=j[0]).type&&c.getById&&9===b.nodeType&&p&&d.relative[j[1].type]){if(b=(d.find.ID(k.matches[0].replace(ba,ca),b)||[])[0],!b)return e;n&&(b=b.parentNode),a=a.slice(j.shift().value.length)}i=W.needsContext.test(a)?0:j.length;while(i--){if(k=j[i],d.relative[l=k.type])break;if((m=d.find[l])&&(f=m(k.matches[0].replace(ba,ca),_.test(j[0].type)&&oa(b.parentNode)||b))){if(j.splice(i,1),a=f.length&&qa(j),!a)return H.apply(e,f),e;break}}}return(n||h(a,o))(f,b,!p,e,!b||_.test(a)&&oa(b.parentNode)||b),e},c.sortStable=u.split("").sort(B).join("")===u,c.detectDuplicates=!!l,m(),c.sortDetached=ia(function(a){return 1&a.compareDocumentPosition(n.createElement("div"))}),ia(function(a){return a.innerHTML="<a href='#'></a>","#"===a.firstChild.getAttribute("href")})||ja("type|href|height|width",function(a,b,c){return c?void 0:a.getAttribute(b,"type"===b.toLowerCase()?1:2)}),c.attributes&&ia(function(a){return a.innerHTML="<input/>",a.firstChild.setAttribute("value",""),""===a.firstChild.getAttribute("value")})||ja("value",function(a,b,c){return c||"input"!==a.nodeName.toLowerCase()?void 0:a.defaultValue}),ia(function(a){return null==a.getAttribute("disabled")})||ja(K,function(a,b,c){var d;return c?void 0:a[b]===!0?b.toLowerCase():(d=a.getAttributeNode(b))&&d.specified?d.value:null}),fa}(a);n.find=t,n.expr=t.selectors,n.expr[":"]=n.expr.pseudos,n.uniqueSort=n.unique=t.uniqueSort,n.text=t.getText,n.isXMLDoc=t.isXML,n.contains=t.contains;var u=function(a,b,c){var d=[],e=void 0!==c;while((a=a[b])&&9!==a.nodeType)if(1===a.nodeType){if(e&&n(a).is(c))break;d.push(a)}return d},v=function(a,b){for(var c=[];a;a=a.nextSibling)1===a.nodeType&&a!==b&&c.push(a);return c},w=n.expr.match.needsContext,x=/^<([\w-]+)\s*\/?>(?:<\/\1>|)$/,y=/^.[^:#\[\.,]*$/;function z(a,b,c){if(n.isFunction(b))return n.grep(a,function(a,d){return!!b.call(a,d,a)!==c});if(b.nodeType)return n.grep(a,function(a){return a===b!==c});if("string"==typeof b){if(y.test(b))return n.filter(b,a,c);b=n.filter(b,a)}return n.grep(a,function(a){return h.call(b,a)>-1!==c})}n.filter=function(a,b,c){var d=b[0];return c&&(a=":not("+a+")"),1===b.length&&1===d.nodeType?n.find.matchesSelector(d,a)?[d]:[]:n.find.matches(a,n.grep(b,function(a){return 1===a.nodeType}))},n.fn.extend({find:function(a){var b,c=this.length,d=[],e=this;if("string"!=typeof a)return this.pushStack(n(a).filter(function(){for(b=0;c>b;b++)if(n.contains(e[b],this))return!0}));for(b=0;c>b;b++)n.find(a,e[b],d);return d=this.pushStack(c>1?n.unique(d):d),d.selector=this.selector?this.selector+" "+a:a,d},filter:function(a){return this.pushStack(z(this,a||[],!1))},not:function(a){return this.pushStack(z(this,a||[],!0))},is:function(a){return!!z(this,"string"==typeof a&&w.test(a)?n(a):a||[],!1).length}});var A,B=/^(?:\s*(<[\w\W]+>)[^>]*|#([\w-]*))$/,C=n.fn.init=function(a,b,c){var e,f;if(!a)return this;if(c=c||A,"string"==typeof a){if(e="<"===a[0]&&">"===a[a.length-1]&&a.length>=3?[null,a,null]:B.exec(a),!e||!e[1]&&b)return!b||b.jquery?(b||c).find(a):this.constructor(b).find(a);if(e[1]){if(b=b instanceof n?b[0]:b,n.merge(this,n.parseHTML(e[1],b&&b.nodeType?b.ownerDocument||b:d,!0)),x.test(e[1])&&n.isPlainObject(b))for(e in b)n.isFunction(this[e])?this[e](b[e]):this.attr(e,b[e]);return this}return f=d.getElementById(e[2]),f&&f.parentNode&&(this.length=1,this[0]=f),this.context=d,this.selector=a,this}return a.nodeType?(this.context=this[0]=a,this.length=1,this):n.isFunction(a)?void 0!==c.ready?c.ready(a):a(n):(void 0!==a.selector&&(this.selector=a.selector,this.context=a.context),n.makeArray(a,this))};C.prototype=n.fn,A=n(d);var D=/^(?:parents|prev(?:Until|All))/,E={children:!0,contents:!0,next:!0,prev:!0};n.fn.extend({has:function(a){var b=n(a,this),c=b.length;return this.filter(function(){for(var a=0;c>a;a++)if(n.contains(this,b[a]))return!0})},closest:function(a,b){for(var c,d=0,e=this.length,f=[],g=w.test(a)||"string"!=typeof a?n(a,b||this.context):0;e>d;d++)for(c=this[d];c&&c!==b;c=c.parentNode)if(c.nodeType<11&&(g?g.index(c)>-1:1===c.nodeType&&n.find.matchesSelector(c,a))){f.push(c);break}return this.pushStack(f.length>1?n.uniqueSort(f):f)},index:function(a){return a?"string"==typeof a?h.call(n(a),this[0]):h.call(this,a.jquery?a[0]:a):this[0]&&this[0].parentNode?this.first().prevAll().length:-1},add:function(a,b){return this.pushStack(n.uniqueSort(n.merge(this.get(),n(a,b))))},addBack:function(a){return this.add(null==a?this.prevObject:this.prevObject.filter(a))}});function F(a,b){while((a=a[b])&&1!==a.nodeType);return a}n.each({parent:function(a){var b=a.parentNode;return b&&11!==b.nodeType?b:null},parents:function(a){return u(a,"parentNode")},parentsUntil:function(a,b,c){return u(a,"parentNode",c)},next:function(a){return F(a,"nextSibling")},prev:function(a){return F(a,"previousSibling")},nextAll:function(a){return u(a,"nextSibling")},prevAll:function(a){return u(a,"previousSibling")},nextUntil:function(a,b,c){return u(a,"nextSibling",c)},prevUntil:function(a,b,c){return u(a,"previousSibling",c)},siblings:function(a){return v((a.parentNode||{}).firstChild,a)},children:function(a){return v(a.firstChild)},contents:function(a){return a.contentDocument||n.merge([],a.childNodes)}},function(a,b){n.fn[a]=function(c,d){var e=n.map(this,b,c);return"Until"!==a.slice(-5)&&(d=c),d&&"string"==typeof d&&(e=n.filter(d,e)),this.length>1&&(E[a]||n.uniqueSort(e),D.test(a)&&e.reverse()),this.pushStack(e)}});var G=/\S+/g;function H(a){var b={};return n.each(a.match(G)||[],function(a,c){b[c]=!0}),b}n.Callbacks=function(a){a="string"==typeof a?H(a):n.extend({},a);var b,c,d,e,f=[],g=[],h=-1,i=function(){for(e=a.once,d=b=!0;g.length;h=-1){c=g.shift();while(++h<f.length)f[h].apply(c[0],c[1])===!1&&a.stopOnFalse&&(h=f.length,c=!1)}a.memory||(c=!1),b=!1,e&&(f=c?[]:"")},j={add:function(){return f&&(c&&!b&&(h=f.length-1,g.push(c)),function d(b){n.each(b,function(b,c){n.isFunction(c)?a.unique&&j.has(c)||f.push(c):c&&c.length&&"string"!==n.type(c)&&d(c)})}(arguments),c&&!b&&i()),this},remove:function(){return n.each(arguments,function(a,b){var c;while((c=n.inArray(b,f,c))>-1)f.splice(c,1),h>=c&&h--}),this},has:function(a){return a?n.inArray(a,f)>-1:f.length>0},empty:function(){return f&&(f=[]),this},disable:function(){return e=g=[],f=c="",this},disabled:function(){return!f},lock:function(){return e=g=[],c||(f=c=""),this},locked:function(){return!!e},fireWith:function(a,c){return e||(c=c||[],c=[a,c.slice?c.slice():c],g.push(c),b||i()),this},fire:function(){return j.fireWith(this,arguments),this},fired:function(){return!!d}};return j},n.extend({Deferred:function(a){var b=[["resolve","done",n.Callbacks("once memory"),"resolved"],["reject","fail",n.Callbacks("once memory"),"rejected"],["notify","progress",n.Callbacks("memory")]],c="pending",d={state:function(){return c},always:function(){return e.done(arguments).fail(arguments),this},then:function(){var a=arguments;return n.Deferred(function(c){n.each(b,function(b,f){var g=n.isFunction(a[b])&&a[b];e[f[1]](function(){var a=g&&g.apply(this,arguments);a&&n.isFunction(a.promise)?a.promise().progress(c.notify).done(c.resolve).fail(c.reject):c[f[0]+"With"](this===d?c.promise():this,g?[a]:arguments)})}),a=null}).promise()},promise:function(a){return null!=a?n.extend(a,d):d}},e={};return d.pipe=d.then,n.each(b,function(a,f){var g=f[2],h=f[3];d[f[1]]=g.add,h&&g.add(function(){c=h},b[1^a][2].disable,b[2][2].lock),e[f[0]]=function(){return e[f[0]+"With"](this===e?d:this,arguments),this},e[f[0]+"With"]=g.fireWith}),d.promise(e),a&&a.call(e,e),e},when:function(a){var b=0,c=e.call(arguments),d=c.length,f=1!==d||a&&n.isFunction(a.promise)?d:0,g=1===f?a:n.Deferred(),h=function(a,b,c){return function(d){b[a]=this,c[a]=arguments.length>1?e.call(arguments):d,c===i?g.notifyWith(b,c):--f||g.resolveWith(b,c)}},i,j,k;if(d>1)for(i=new Array(d),j=new Array(d),k=new Array(d);d>b;b++)c[b]&&n.isFunction(c[b].promise)?c[b].promise().progress(h(b,j,i)).done(h(b,k,c)).fail(g.reject):--f;return f||g.resolveWith(k,c),g.promise()}});var I;n.fn.ready=function(a){return n.ready.promise().done(a),this},n.extend({isReady:!1,readyWait:1,holdReady:function(a){a?n.readyWait++:n.ready(!0)},ready:function(a){(a===!0?--n.readyWait:n.isReady)||(n.isReady=!0,a!==!0&&--n.readyWait>0||(I.resolveWith(d,[n]),n.fn.triggerHandler&&(n(d).triggerHandler("ready"),n(d).off("ready"))))}});function J(){d.removeEventListener("DOMContentLoaded",J),a.removeEventListener("load",J),n.ready()}n.ready.promise=function(b){return I||(I=n.Deferred(),"complete"===d.readyState||"loading"!==d.readyState&&!d.documentElement.doScroll?a.setTimeout(n.ready):(d.addEventListener("DOMContentLoaded",J),a.addEventListener("load",J))),I.promise(b)},n.ready.promise();var K=function(a,b,c,d,e,f,g){var h=0,i=a.length,j=null==c;if("object"===n.type(c)){e=!0;for(h in c)K(a,b,h,c[h],!0,f,g)}else if(void 0!==d&&(e=!0,n.isFunction(d)||(g=!0),j&&(g?(b.call(a,d),b=null):(j=b,b=function(a,b,c){return j.call(n(a),c)})),b))for(;i>h;h++)b(a[h],c,g?d:d.call(a[h],h,b(a[h],c)));return e?a:j?b.call(a):i?b(a[0],c):f},L=function(a){return 1===a.nodeType||9===a.nodeType||!+a.nodeType};function M(){this.expando=n.expando+M.uid++}M.uid=1,M.prototype={register:function(a,b){var c=b||{};return a.nodeType?a[this.expando]=c:Object.defineProperty(a,this.expando,{value:c,writable:!0,configurable:!0}),a[this.expando]},cache:function(a){if(!L(a))return{};var b=a[this.expando];return b||(b={},L(a)&&(a.nodeType?a[this.expando]=b:Object.defineProperty(a,this.expando,{value:b,configurable:!0}))),b},set:function(a,b,c){var d,e=this.cache(a);if("string"==typeof b)e[b]=c;else for(d in b)e[d]=b[d];return e},get:function(a,b){return void 0===b?this.cache(a):a[this.expando]&&a[this.expando][b]},access:function(a,b,c){var d;return void 0===b||b&&"string"==typeof b&&void 0===c?(d=this.get(a,b),void 0!==d?d:this.get(a,n.camelCase(b))):(this.set(a,b,c),void 0!==c?c:b)},remove:function(a,b){var c,d,e,f=a[this.expando];if(void 0!==f){if(void 0===b)this.register(a);else{n.isArray(b)?d=b.concat(b.map(n.camelCase)):(e=n.camelCase(b),b in f?d=[b,e]:(d=e,d=d in f?[d]:d.match(G)||[])),c=d.length;while(c--)delete f[d[c]]}(void 0===b||n.isEmptyObject(f))&&(a.nodeType?a[this.expando]=void 0:delete a[this.expando])}},hasData:function(a){var b=a[this.expando];return void 0!==b&&!n.isEmptyObject(b)}};var N=new M,O=new M,P=/^(?:\{[\w\W]*\}|\[[\w\W]*\])$/,Q=/[A-Z]/g;function R(a,b,c){var d;if(void 0===c&&1===a.nodeType)if(d="data-"+b.replace(Q,"-$&").toLowerCase(),c=a.getAttribute(d),"string"==typeof c){try{c="true"===c?!0:"false"===c?!1:"null"===c?null:+c+""===c?+c:P.test(c)?n.parseJSON(c):c;
}catch(e){}O.set(a,b,c)}else c=void 0;return c}n.extend({hasData:function(a){return O.hasData(a)||N.hasData(a)},data:function(a,b,c){return O.access(a,b,c)},removeData:function(a,b){O.remove(a,b)},_data:function(a,b,c){return N.access(a,b,c)},_removeData:function(a,b){N.remove(a,b)}}),n.fn.extend({data:function(a,b){var c,d,e,f=this[0],g=f&&f.attributes;if(void 0===a){if(this.length&&(e=O.get(f),1===f.nodeType&&!N.get(f,"hasDataAttrs"))){c=g.length;while(c--)g[c]&&(d=g[c].name,0===d.indexOf("data-")&&(d=n.camelCase(d.slice(5)),R(f,d,e[d])));N.set(f,"hasDataAttrs",!0)}return e}return"object"==typeof a?this.each(function(){O.set(this,a)}):K(this,function(b){var c,d;if(f&&void 0===b){if(c=O.get(f,a)||O.get(f,a.replace(Q,"-$&").toLowerCase()),void 0!==c)return c;if(d=n.camelCase(a),c=O.get(f,d),void 0!==c)return c;if(c=R(f,d,void 0),void 0!==c)return c}else d=n.camelCase(a),this.each(function(){var c=O.get(this,d);O.set(this,d,b),a.indexOf("-")>-1&&void 0!==c&&O.set(this,a,b)})},null,b,arguments.length>1,null,!0)},removeData:function(a){return this.each(function(){O.remove(this,a)})}}),n.extend({queue:function(a,b,c){var d;return a?(b=(b||"fx")+"queue",d=N.get(a,b),c&&(!d||n.isArray(c)?d=N.access(a,b,n.makeArray(c)):d.push(c)),d||[]):void 0},dequeue:function(a,b){b=b||"fx";var c=n.queue(a,b),d=c.length,e=c.shift(),f=n._queueHooks(a,b),g=function(){n.dequeue(a,b)};"inprogress"===e&&(e=c.shift(),d--),e&&("fx"===b&&c.unshift("inprogress"),delete f.stop,e.call(a,g,f)),!d&&f&&f.empty.fire()},_queueHooks:function(a,b){var c=b+"queueHooks";return N.get(a,c)||N.access(a,c,{empty:n.Callbacks("once memory").add(function(){N.remove(a,[b+"queue",c])})})}}),n.fn.extend({queue:function(a,b){var c=2;return"string"!=typeof a&&(b=a,a="fx",c--),arguments.length<c?n.queue(this[0],a):void 0===b?this:this.each(function(){var c=n.queue(this,a,b);n._queueHooks(this,a),"fx"===a&&"inprogress"!==c[0]&&n.dequeue(this,a)})},dequeue:function(a){return this.each(function(){n.dequeue(this,a)})},clearQueue:function(a){return this.queue(a||"fx",[])},promise:function(a,b){var c,d=1,e=n.Deferred(),f=this,g=this.length,h=function(){--d||e.resolveWith(f,[f])};"string"!=typeof a&&(b=a,a=void 0),a=a||"fx";while(g--)c=N.get(f[g],a+"queueHooks"),c&&c.empty&&(d++,c.empty.add(h));return h(),e.promise(b)}});var S=/[+-]?(?:\d*\.|)\d+(?:[eE][+-]?\d+|)/.source,T=new RegExp("^(?:([+-])=|)("+S+")([a-z%]*)$","i"),U=["Top","Right","Bottom","Left"],V=function(a,b){return a=b||a,"none"===n.css(a,"display")||!n.contains(a.ownerDocument,a)};function W(a,b,c,d){var e,f=1,g=20,h=d?function(){return d.cur()}:function(){return n.css(a,b,"")},i=h(),j=c&&c[3]||(n.cssNumber[b]?"":"px"),k=(n.cssNumber[b]||"px"!==j&&+i)&&T.exec(n.css(a,b));if(k&&k[3]!==j){j=j||k[3],c=c||[],k=+i||1;do f=f||".5",k/=f,n.style(a,b,k+j);while(f!==(f=h()/i)&&1!==f&&--g)}return c&&(k=+k||+i||0,e=c[1]?k+(c[1]+1)*c[2]:+c[2],d&&(d.unit=j,d.start=k,d.end=e)),e}var X=/^(?:checkbox|radio)$/i,Y=/<([\w:-]+)/,Z=/^$|\/(?:java|ecma)script/i,$={option:[1,"<select multiple='multiple'>","</select>"],thead:[1,"<table>","</table>"],col:[2,"<table><colgroup>","</colgroup></table>"],tr:[2,"<table><tbody>","</tbody></table>"],td:[3,"<table><tbody><tr>","</tr></tbody></table>"],_default:[0,"",""]};$.optgroup=$.option,$.tbody=$.tfoot=$.colgroup=$.caption=$.thead,$.th=$.td;function _(a,b){var c="undefined"!=typeof a.getElementsByTagName?a.getElementsByTagName(b||"*"):"undefined"!=typeof a.querySelectorAll?a.querySelectorAll(b||"*"):[];return void 0===b||b&&n.nodeName(a,b)?n.merge([a],c):c}function aa(a,b){for(var c=0,d=a.length;d>c;c++)N.set(a[c],"globalEval",!b||N.get(b[c],"globalEval"))}var ba=/<|&#?\w+;/;function ca(a,b,c,d,e){for(var f,g,h,i,j,k,l=b.createDocumentFragment(),m=[],o=0,p=a.length;p>o;o++)if(f=a[o],f||0===f)if("object"===n.type(f))n.merge(m,f.nodeType?[f]:f);else if(ba.test(f)){g=g||l.appendChild(b.createElement("div")),h=(Y.exec(f)||["",""])[1].toLowerCase(),i=$[h]||$._default,g.innerHTML=i[1]+n.htmlPrefilter(f)+i[2],k=i[0];while(k--)g=g.lastChild;n.merge(m,g.childNodes),g=l.firstChild,g.textContent=""}else m.push(b.createTextNode(f));l.textContent="",o=0;while(f=m[o++])if(d&&n.inArray(f,d)>-1)e&&e.push(f);else if(j=n.contains(f.ownerDocument,f),g=_(l.appendChild(f),"script"),j&&aa(g),c){k=0;while(f=g[k++])Z.test(f.type||"")&&c.push(f)}return l}!function(){var a=d.createDocumentFragment(),b=a.appendChild(d.createElement("div")),c=d.createElement("input");c.setAttribute("type","radio"),c.setAttribute("checked","checked"),c.setAttribute("name","t"),b.appendChild(c),l.checkClone=b.cloneNode(!0).cloneNode(!0).lastChild.checked,b.innerHTML="<textarea>x</textarea>",l.noCloneChecked=!!b.cloneNode(!0).lastChild.defaultValue}();var da=/^key/,ea=/^(?:mouse|pointer|contextmenu|drag|drop)|click/,fa=/^([^.]*)(?:\.(.+)|)/;function ga(){return!0}function ha(){return!1}function ia(){try{return d.activeElement}catch(a){}}function ja(a,b,c,d,e,f){var g,h;if("object"==typeof b){"string"!=typeof c&&(d=d||c,c=void 0);for(h in b)ja(a,h,c,d,b[h],f);return a}if(null==d&&null==e?(e=c,d=c=void 0):null==e&&("string"==typeof c?(e=d,d=void 0):(e=d,d=c,c=void 0)),e===!1)e=ha;else if(!e)return a;return 1===f&&(g=e,e=function(a){return n().off(a),g.apply(this,arguments)},e.guid=g.guid||(g.guid=n.guid++)),a.each(function(){n.event.add(this,b,e,d,c)})}n.event={global:{},add:function(a,b,c,d,e){var f,g,h,i,j,k,l,m,o,p,q,r=N.get(a);if(r){c.handler&&(f=c,c=f.handler,e=f.selector),c.guid||(c.guid=n.guid++),(i=r.events)||(i=r.events={}),(g=r.handle)||(g=r.handle=function(b){return"undefined"!=typeof n&&n.event.triggered!==b.type?n.event.dispatch.apply(a,arguments):void 0}),b=(b||"").match(G)||[""],j=b.length;while(j--)h=fa.exec(b[j])||[],o=q=h[1],p=(h[2]||"").split(".").sort(),o&&(l=n.event.special[o]||{},o=(e?l.delegateType:l.bindType)||o,l=n.event.special[o]||{},k=n.extend({type:o,origType:q,data:d,handler:c,guid:c.guid,selector:e,needsContext:e&&n.expr.match.needsContext.test(e),namespace:p.join(".")},f),(m=i[o])||(m=i[o]=[],m.delegateCount=0,l.setup&&l.setup.call(a,d,p,g)!==!1||a.addEventListener&&a.addEventListener(o,g)),l.add&&(l.add.call(a,k),k.handler.guid||(k.handler.guid=c.guid)),e?m.splice(m.delegateCount++,0,k):m.push(k),n.event.global[o]=!0)}},remove:function(a,b,c,d,e){var f,g,h,i,j,k,l,m,o,p,q,r=N.hasData(a)&&N.get(a);if(r&&(i=r.events)){b=(b||"").match(G)||[""],j=b.length;while(j--)if(h=fa.exec(b[j])||[],o=q=h[1],p=(h[2]||"").split(".").sort(),o){l=n.event.special[o]||{},o=(d?l.delegateType:l.bindType)||o,m=i[o]||[],h=h[2]&&new RegExp("(^|\\.)"+p.join("\\.(?:.*\\.|)")+"(\\.|$)"),g=f=m.length;while(f--)k=m[f],!e&&q!==k.origType||c&&c.guid!==k.guid||h&&!h.test(k.namespace)||d&&d!==k.selector&&("**"!==d||!k.selector)||(m.splice(f,1),k.selector&&m.delegateCount--,l.remove&&l.remove.call(a,k));g&&!m.length&&(l.teardown&&l.teardown.call(a,p,r.handle)!==!1||n.removeEvent(a,o,r.handle),delete i[o])}else for(o in i)n.event.remove(a,o+b[j],c,d,!0);n.isEmptyObject(i)&&N.remove(a,"handle events")}},dispatch:function(a){a=n.event.fix(a);var b,c,d,f,g,h=[],i=e.call(arguments),j=(N.get(this,"events")||{})[a.type]||[],k=n.event.special[a.type]||{};if(i[0]=a,a.delegateTarget=this,!k.preDispatch||k.preDispatch.call(this,a)!==!1){h=n.event.handlers.call(this,a,j),b=0;while((f=h[b++])&&!a.isPropagationStopped()){a.currentTarget=f.elem,c=0;while((g=f.handlers[c++])&&!a.isImmediatePropagationStopped())a.rnamespace&&!a.rnamespace.test(g.namespace)||(a.handleObj=g,a.data=g.data,d=((n.event.special[g.origType]||{}).handle||g.handler).apply(f.elem,i),void 0!==d&&(a.result=d)===!1&&(a.preventDefault(),a.stopPropagation()))}return k.postDispatch&&k.postDispatch.call(this,a),a.result}},handlers:function(a,b){var c,d,e,f,g=[],h=b.delegateCount,i=a.target;if(h&&i.nodeType&&("click"!==a.type||isNaN(a.button)||a.button<1))for(;i!==this;i=i.parentNode||this)if(1===i.nodeType&&(i.disabled!==!0||"click"!==a.type)){for(d=[],c=0;h>c;c++)f=b[c],e=f.selector+" ",void 0===d[e]&&(d[e]=f.needsContext?n(e,this).index(i)>-1:n.find(e,this,null,[i]).length),d[e]&&d.push(f);d.length&&g.push({elem:i,handlers:d})}return h<b.length&&g.push({elem:this,handlers:b.slice(h)}),g},props:"altKey bubbles cancelable ctrlKey currentTarget detail eventPhase metaKey relatedTarget shiftKey target timeStamp view which".split(" "),fixHooks:{},keyHooks:{props:"char charCode key keyCode".split(" "),filter:function(a,b){return null==a.which&&(a.which=null!=b.charCode?b.charCode:b.keyCode),a}},mouseHooks:{props:"button buttons clientX clientY offsetX offsetY pageX pageY screenX screenY toElement".split(" "),filter:function(a,b){var c,e,f,g=b.button;return null==a.pageX&&null!=b.clientX&&(c=a.target.ownerDocument||d,e=c.documentElement,f=c.body,a.pageX=b.clientX+(e&&e.scrollLeft||f&&f.scrollLeft||0)-(e&&e.clientLeft||f&&f.clientLeft||0),a.pageY=b.clientY+(e&&e.scrollTop||f&&f.scrollTop||0)-(e&&e.clientTop||f&&f.clientTop||0)),a.which||void 0===g||(a.which=1&g?1:2&g?3:4&g?2:0),a}},fix:function(a){if(a[n.expando])return a;var b,c,e,f=a.type,g=a,h=this.fixHooks[f];h||(this.fixHooks[f]=h=ea.test(f)?this.mouseHooks:da.test(f)?this.keyHooks:{}),e=h.props?this.props.concat(h.props):this.props,a=new n.Event(g),b=e.length;while(b--)c=e[b],a[c]=g[c];return a.target||(a.target=d),3===a.target.nodeType&&(a.target=a.target.parentNode),h.filter?h.filter(a,g):a},special:{load:{noBubble:!0},focus:{trigger:function(){return this!==ia()&&this.focus?(this.focus(),!1):void 0},delegateType:"focusin"},blur:{trigger:function(){return this===ia()&&this.blur?(this.blur(),!1):void 0},delegateType:"focusout"},click:{trigger:function(){return"checkbox"===this.type&&this.click&&n.nodeName(this,"input")?(this.click(),!1):void 0},_default:function(a){return n.nodeName(a.target,"a")}},beforeunload:{postDispatch:function(a){void 0!==a.result&&a.originalEvent&&(a.originalEvent.returnValue=a.result)}}}},n.removeEvent=function(a,b,c){a.removeEventListener&&a.removeEventListener(b,c)},n.Event=function(a,b){return this instanceof n.Event?(a&&a.type?(this.originalEvent=a,this.type=a.type,this.isDefaultPrevented=a.defaultPrevented||void 0===a.defaultPrevented&&a.returnValue===!1?ga:ha):this.type=a,b&&n.extend(this,b),this.timeStamp=a&&a.timeStamp||n.now(),void(this[n.expando]=!0)):new n.Event(a,b)},n.Event.prototype={constructor:n.Event,isDefaultPrevented:ha,isPropagationStopped:ha,isImmediatePropagationStopped:ha,isSimulated:!1,preventDefault:function(){var a=this.originalEvent;this.isDefaultPrevented=ga,a&&!this.isSimulated&&a.preventDefault()},stopPropagation:function(){var a=this.originalEvent;this.isPropagationStopped=ga,a&&!this.isSimulated&&a.stopPropagation()},stopImmediatePropagation:function(){var a=this.originalEvent;this.isImmediatePropagationStopped=ga,a&&!this.isSimulated&&a.stopImmediatePropagation(),this.stopPropagation()}},n.each({mouseenter:"mouseover",mouseleave:"mouseout",pointerenter:"pointerover",pointerleave:"pointerout"},function(a,b){n.event.special[a]={delegateType:b,bindType:b,handle:function(a){var c,d=this,e=a.relatedTarget,f=a.handleObj;return e&&(e===d||n.contains(d,e))||(a.type=f.origType,c=f.handler.apply(this,arguments),a.type=b),c}}}),n.fn.extend({on:function(a,b,c,d){return ja(this,a,b,c,d)},one:function(a,b,c,d){return ja(this,a,b,c,d,1)},off:function(a,b,c){var d,e;if(a&&a.preventDefault&&a.handleObj)return d=a.handleObj,n(a.delegateTarget).off(d.namespace?d.origType+"."+d.namespace:d.origType,d.selector,d.handler),this;if("object"==typeof a){for(e in a)this.off(e,b,a[e]);return this}return b!==!1&&"function"!=typeof b||(c=b,b=void 0),c===!1&&(c=ha),this.each(function(){n.event.remove(this,a,c,b)})}});var ka=/<(?!area|br|col|embed|hr|img|input|link|meta|param)(([\w:-]+)[^>]*)\/>/gi,la=/<script|<style|<link/i,ma=/checked\s*(?:[^=]|=\s*.checked.)/i,na=/^true\/(.*)/,oa=/^\s*<!(?:\[CDATA\[|--)|(?:\]\]|--)>\s*$/g;function pa(a,b){return n.nodeName(a,"table")&&n.nodeName(11!==b.nodeType?b:b.firstChild,"tr")?a.getElementsByTagName("tbody")[0]||a.appendChild(a.ownerDocument.createElement("tbody")):a}function qa(a){return a.type=(null!==a.getAttribute("type"))+"/"+a.type,a}function ra(a){var b=na.exec(a.type);return b?a.type=b[1]:a.removeAttribute("type"),a}function sa(a,b){var c,d,e,f,g,h,i,j;if(1===b.nodeType){if(N.hasData(a)&&(f=N.access(a),g=N.set(b,f),j=f.events)){delete g.handle,g.events={};for(e in j)for(c=0,d=j[e].length;d>c;c++)n.event.add(b,e,j[e][c])}O.hasData(a)&&(h=O.access(a),i=n.extend({},h),O.set(b,i))}}function ta(a,b){var c=b.nodeName.toLowerCase();"input"===c&&X.test(a.type)?b.checked=a.checked:"input"!==c&&"textarea"!==c||(b.defaultValue=a.defaultValue)}function ua(a,b,c,d){b=f.apply([],b);var e,g,h,i,j,k,m=0,o=a.length,p=o-1,q=b[0],r=n.isFunction(q);if(r||o>1&&"string"==typeof q&&!l.checkClone&&ma.test(q))return a.each(function(e){var f=a.eq(e);r&&(b[0]=q.call(this,e,f.html())),ua(f,b,c,d)});if(o&&(e=ca(b,a[0].ownerDocument,!1,a,d),g=e.firstChild,1===e.childNodes.length&&(e=g),g||d)){for(h=n.map(_(e,"script"),qa),i=h.length;o>m;m++)j=e,m!==p&&(j=n.clone(j,!0,!0),i&&n.merge(h,_(j,"script"))),c.call(a[m],j,m);if(i)for(k=h[h.length-1].ownerDocument,n.map(h,ra),m=0;i>m;m++)j=h[m],Z.test(j.type||"")&&!N.access(j,"globalEval")&&n.contains(k,j)&&(j.src?n._evalUrl&&n._evalUrl(j.src):n.globalEval(j.textContent.replace(oa,"")))}return a}function va(a,b,c){for(var d,e=b?n.filter(b,a):a,f=0;null!=(d=e[f]);f++)c||1!==d.nodeType||n.cleanData(_(d)),d.parentNode&&(c&&n.contains(d.ownerDocument,d)&&aa(_(d,"script")),d.parentNode.removeChild(d));return a}n.extend({htmlPrefilter:function(a){return a.replace(ka,"<$1></$2>")},clone:function(a,b,c){var d,e,f,g,h=a.cloneNode(!0),i=n.contains(a.ownerDocument,a);if(!(l.noCloneChecked||1!==a.nodeType&&11!==a.nodeType||n.isXMLDoc(a)))for(g=_(h),f=_(a),d=0,e=f.length;e>d;d++)ta(f[d],g[d]);if(b)if(c)for(f=f||_(a),g=g||_(h),d=0,e=f.length;e>d;d++)sa(f[d],g[d]);else sa(a,h);return g=_(h,"script"),g.length>0&&aa(g,!i&&_(a,"script")),h},cleanData:function(a){for(var b,c,d,e=n.event.special,f=0;void 0!==(c=a[f]);f++)if(L(c)){if(b=c[N.expando]){if(b.events)for(d in b.events)e[d]?n.event.remove(c,d):n.removeEvent(c,d,b.handle);c[N.expando]=void 0}c[O.expando]&&(c[O.expando]=void 0)}}}),n.fn.extend({domManip:ua,detach:function(a){return va(this,a,!0)},remove:function(a){return va(this,a)},text:function(a){return K(this,function(a){return void 0===a?n.text(this):this.empty().each(function(){1!==this.nodeType&&11!==this.nodeType&&9!==this.nodeType||(this.textContent=a)})},null,a,arguments.length)},append:function(){return ua(this,arguments,function(a){if(1===this.nodeType||11===this.nodeType||9===this.nodeType){var b=pa(this,a);b.appendChild(a)}})},prepend:function(){return ua(this,arguments,function(a){if(1===this.nodeType||11===this.nodeType||9===this.nodeType){var b=pa(this,a);b.insertBefore(a,b.firstChild)}})},before:function(){return ua(this,arguments,function(a){this.parentNode&&this.parentNode.insertBefore(a,this)})},after:function(){return ua(this,arguments,function(a){this.parentNode&&this.parentNode.insertBefore(a,this.nextSibling)})},empty:function(){for(var a,b=0;null!=(a=this[b]);b++)1===a.nodeType&&(n.cleanData(_(a,!1)),a.textContent="");return this},clone:function(a,b){return a=null==a?!1:a,b=null==b?a:b,this.map(function(){return n.clone(this,a,b)})},html:function(a){return K(this,function(a){var b=this[0]||{},c=0,d=this.length;if(void 0===a&&1===b.nodeType)return b.innerHTML;if("string"==typeof a&&!la.test(a)&&!$[(Y.exec(a)||["",""])[1].toLowerCase()]){a=n.htmlPrefilter(a);try{for(;d>c;c++)b=this[c]||{},1===b.nodeType&&(n.cleanData(_(b,!1)),b.innerHTML=a);b=0}catch(e){}}b&&this.empty().append(a)},null,a,arguments.length)},replaceWith:function(){var a=[];return ua(this,arguments,function(b){var c=this.parentNode;n.inArray(this,a)<0&&(n.cleanData(_(this)),c&&c.replaceChild(b,this))},a)}}),n.each({appendTo:"append",prependTo:"prepend",insertBefore:"before",insertAfter:"after",replaceAll:"replaceWith"},function(a,b){n.fn[a]=function(a){for(var c,d=[],e=n(a),f=e.length-1,h=0;f>=h;h++)c=h===f?this:this.clone(!0),n(e[h])[b](c),g.apply(d,c.get());return this.pushStack(d)}});var wa,xa={HTML:"block",BODY:"block"};function ya(a,b){var c=n(b.createElement(a)).appendTo(b.body),d=n.css(c[0],"display");return c.detach(),d}function za(a){var b=d,c=xa[a];return c||(c=ya(a,b),"none"!==c&&c||(wa=(wa||n("<iframe frameborder='0' width='0' height='0'/>")).appendTo(b.documentElement),b=wa[0].contentDocument,b.write(),b.close(),c=ya(a,b),wa.detach()),xa[a]=c),c}var Aa=/^margin/,Ba=new RegExp("^("+S+")(?!px)[a-z%]+$","i"),Ca=function(b){var c=b.ownerDocument.defaultView;return c&&c.opener||(c=a),c.getComputedStyle(b)},Da=function(a,b,c,d){var e,f,g={};for(f in b)g[f]=a.style[f],a.style[f]=b[f];e=c.apply(a,d||[]);for(f in b)a.style[f]=g[f];return e},Ea=d.documentElement;!function(){var b,c,e,f,g=d.createElement("div"),h=d.createElement("div");if(h.style){h.style.backgroundClip="content-box",h.cloneNode(!0).style.backgroundClip="",l.clearCloneStyle="content-box"===h.style.backgroundClip,g.style.cssText="border:0;width:8px;height:0;top:0;left:-9999px;padding:0;margin-top:1px;position:absolute",g.appendChild(h);function i(){h.style.cssText="-webkit-box-sizing:border-box;-moz-box-sizing:border-box;box-sizing:border-box;position:relative;display:block;margin:auto;border:1px;padding:1px;top:1%;width:50%",h.innerHTML="",Ea.appendChild(g);var d=a.getComputedStyle(h);b="1%"!==d.top,f="2px"===d.marginLeft,c="4px"===d.width,h.style.marginRight="50%",e="4px"===d.marginRight,Ea.removeChild(g)}n.extend(l,{pixelPosition:function(){return i(),b},boxSizingReliable:function(){return null==c&&i(),c},pixelMarginRight:function(){return null==c&&i(),e},reliableMarginLeft:function(){return null==c&&i(),f},reliableMarginRight:function(){var b,c=h.appendChild(d.createElement("div"));return c.style.cssText=h.style.cssText="-webkit-box-sizing:content-box;box-sizing:content-box;display:block;margin:0;border:0;padding:0",c.style.marginRight=c.style.width="0",h.style.width="1px",Ea.appendChild(g),b=!parseFloat(a.getComputedStyle(c).marginRight),Ea.removeChild(g),h.removeChild(c),b}})}}();function Fa(a,b,c){var d,e,f,g,h=a.style;return c=c||Ca(a),g=c?c.getPropertyValue(b)||c[b]:void 0,""!==g&&void 0!==g||n.contains(a.ownerDocument,a)||(g=n.style(a,b)),c&&!l.pixelMarginRight()&&Ba.test(g)&&Aa.test(b)&&(d=h.width,e=h.minWidth,f=h.maxWidth,h.minWidth=h.maxWidth=h.width=g,g=c.width,h.width=d,h.minWidth=e,h.maxWidth=f),void 0!==g?g+"":g}function Ga(a,b){return{get:function(){return a()?void delete this.get:(this.get=b).apply(this,arguments)}}}var Ha=/^(none|table(?!-c[ea]).+)/,Ia={position:"absolute",visibility:"hidden",display:"block"},Ja={letterSpacing:"0",fontWeight:"400"},Ka=["Webkit","O","Moz","ms"],La=d.createElement("div").style;function Ma(a){if(a in La)return a;var b=a[0].toUpperCase()+a.slice(1),c=Ka.length;while(c--)if(a=Ka[c]+b,a in La)return a}function Na(a,b,c){var d=T.exec(b);return d?Math.max(0,d[2]-(c||0))+(d[3]||"px"):b}function Oa(a,b,c,d,e){for(var f=c===(d?"border":"content")?4:"width"===b?1:0,g=0;4>f;f+=2)"margin"===c&&(g+=n.css(a,c+U[f],!0,e)),d?("content"===c&&(g-=n.css(a,"padding"+U[f],!0,e)),"margin"!==c&&(g-=n.css(a,"border"+U[f]+"Width",!0,e))):(g+=n.css(a,"padding"+U[f],!0,e),"padding"!==c&&(g+=n.css(a,"border"+U[f]+"Width",!0,e)));return g}function Pa(a,b,c){var d=!0,e="width"===b?a.offsetWidth:a.offsetHeight,f=Ca(a),g="border-box"===n.css(a,"boxSizing",!1,f);if(0>=e||null==e){if(e=Fa(a,b,f),(0>e||null==e)&&(e=a.style[b]),Ba.test(e))return e;d=g&&(l.boxSizingReliable()||e===a.style[b]),e=parseFloat(e)||0}return e+Oa(a,b,c||(g?"border":"content"),d,f)+"px"}function Qa(a,b){for(var c,d,e,f=[],g=0,h=a.length;h>g;g++)d=a[g],d.style&&(f[g]=N.get(d,"olddisplay"),c=d.style.display,b?(f[g]||"none"!==c||(d.style.display=""),""===d.style.display&&V(d)&&(f[g]=N.access(d,"olddisplay",za(d.nodeName)))):(e=V(d),"none"===c&&e||N.set(d,"olddisplay",e?c:n.css(d,"display"))));for(g=0;h>g;g++)d=a[g],d.style&&(b&&"none"!==d.style.display&&""!==d.style.display||(d.style.display=b?f[g]||"":"none"));return a}n.extend({cssHooks:{opacity:{get:function(a,b){if(b){var c=Fa(a,"opacity");return""===c?"1":c}}}},cssNumber:{animationIterationCount:!0,columnCount:!0,fillOpacity:!0,flexGrow:!0,flexShrink:!0,fontWeight:!0,lineHeight:!0,opacity:!0,order:!0,orphans:!0,widows:!0,zIndex:!0,zoom:!0},cssProps:{"float":"cssFloat"},style:function(a,b,c,d){if(a&&3!==a.nodeType&&8!==a.nodeType&&a.style){var e,f,g,h=n.camelCase(b),i=a.style;return b=n.cssProps[h]||(n.cssProps[h]=Ma(h)||h),g=n.cssHooks[b]||n.cssHooks[h],void 0===c?g&&"get"in g&&void 0!==(e=g.get(a,!1,d))?e:i[b]:(f=typeof c,"string"===f&&(e=T.exec(c))&&e[1]&&(c=W(a,b,e),f="number"),null!=c&&c===c&&("number"===f&&(c+=e&&e[3]||(n.cssNumber[h]?"":"px")),l.clearCloneStyle||""!==c||0!==b.indexOf("background")||(i[b]="inherit"),g&&"set"in g&&void 0===(c=g.set(a,c,d))||(i[b]=c)),void 0)}},css:function(a,b,c,d){var e,f,g,h=n.camelCase(b);return b=n.cssProps[h]||(n.cssProps[h]=Ma(h)||h),g=n.cssHooks[b]||n.cssHooks[h],g&&"get"in g&&(e=g.get(a,!0,c)),void 0===e&&(e=Fa(a,b,d)),"normal"===e&&b in Ja&&(e=Ja[b]),""===c||c?(f=parseFloat(e),c===!0||isFinite(f)?f||0:e):e}}),n.each(["height","width"],function(a,b){n.cssHooks[b]={get:function(a,c,d){return c?Ha.test(n.css(a,"display"))&&0===a.offsetWidth?Da(a,Ia,function(){return Pa(a,b,d)}):Pa(a,b,d):void 0},set:function(a,c,d){var e,f=d&&Ca(a),g=d&&Oa(a,b,d,"border-box"===n.css(a,"boxSizing",!1,f),f);return g&&(e=T.exec(c))&&"px"!==(e[3]||"px")&&(a.style[b]=c,c=n.css(a,b)),Na(a,c,g)}}}),n.cssHooks.marginLeft=Ga(l.reliableMarginLeft,function(a,b){return b?(parseFloat(Fa(a,"marginLeft"))||a.getBoundingClientRect().left-Da(a,{marginLeft:0},function(){return a.getBoundingClientRect().left}))+"px":void 0}),n.cssHooks.marginRight=Ga(l.reliableMarginRight,function(a,b){return b?Da(a,{display:"inline-block"},Fa,[a,"marginRight"]):void 0}),n.each({margin:"",padding:"",border:"Width"},function(a,b){n.cssHooks[a+b]={expand:function(c){for(var d=0,e={},f="string"==typeof c?c.split(" "):[c];4>d;d++)e[a+U[d]+b]=f[d]||f[d-2]||f[0];return e}},Aa.test(a)||(n.cssHooks[a+b].set=Na)}),n.fn.extend({css:function(a,b){return K(this,function(a,b,c){var d,e,f={},g=0;if(n.isArray(b)){for(d=Ca(a),e=b.length;e>g;g++)f[b[g]]=n.css(a,b[g],!1,d);return f}return void 0!==c?n.style(a,b,c):n.css(a,b)},a,b,arguments.length>1)},show:function(){return Qa(this,!0)},hide:function(){return Qa(this)},toggle:function(a){return"boolean"==typeof a?a?this.show():this.hide():this.each(function(){V(this)?n(this).show():n(this).hide()})}});function Ra(a,b,c,d,e){return new Ra.prototype.init(a,b,c,d,e)}n.Tween=Ra,Ra.prototype={constructor:Ra,init:function(a,b,c,d,e,f){this.elem=a,this.prop=c,this.easing=e||n.easing._default,this.options=b,this.start=this.now=this.cur(),this.end=d,this.unit=f||(n.cssNumber[c]?"":"px")},cur:function(){var a=Ra.propHooks[this.prop];return a&&a.get?a.get(this):Ra.propHooks._default.get(this)},run:function(a){var b,c=Ra.propHooks[this.prop];return this.options.duration?this.pos=b=n.easing[this.easing](a,this.options.duration*a,0,1,this.options.duration):this.pos=b=a,this.now=(this.end-this.start)*b+this.start,this.options.step&&this.options.step.call(this.elem,this.now,this),c&&c.set?c.set(this):Ra.propHooks._default.set(this),this}},Ra.prototype.init.prototype=Ra.prototype,Ra.propHooks={_default:{get:function(a){var b;return 1!==a.elem.nodeType||null!=a.elem[a.prop]&&null==a.elem.style[a.prop]?a.elem[a.prop]:(b=n.css(a.elem,a.prop,""),b&&"auto"!==b?b:0)},set:function(a){n.fx.step[a.prop]?n.fx.step[a.prop](a):1!==a.elem.nodeType||null==a.elem.style[n.cssProps[a.prop]]&&!n.cssHooks[a.prop]?a.elem[a.prop]=a.now:n.style(a.elem,a.prop,a.now+a.unit)}}},Ra.propHooks.scrollTop=Ra.propHooks.scrollLeft={set:function(a){a.elem.nodeType&&a.elem.parentNode&&(a.elem[a.prop]=a.now)}},n.easing={linear:function(a){return a},swing:function(a){return.5-Math.cos(a*Math.PI)/2},_default:"swing"},n.fx=Ra.prototype.init,n.fx.step={};var Sa,Ta,Ua=/^(?:toggle|show|hide)$/,Va=/queueHooks$/;function Wa(){return a.setTimeout(function(){Sa=void 0}),Sa=n.now()}function Xa(a,b){var c,d=0,e={height:a};for(b=b?1:0;4>d;d+=2-b)c=U[d],e["margin"+c]=e["padding"+c]=a;return b&&(e.opacity=e.width=a),e}function Ya(a,b,c){for(var d,e=(_a.tweeners[b]||[]).concat(_a.tweeners["*"]),f=0,g=e.length;g>f;f++)if(d=e[f].call(c,b,a))return d}function Za(a,b,c){var d,e,f,g,h,i,j,k,l=this,m={},o=a.style,p=a.nodeType&&V(a),q=N.get(a,"fxshow");c.queue||(h=n._queueHooks(a,"fx"),null==h.unqueued&&(h.unqueued=0,i=h.empty.fire,h.empty.fire=function(){h.unqueued||i()}),h.unqueued++,l.always(function(){l.always(function(){h.unqueued--,n.queue(a,"fx").length||h.empty.fire()})})),1===a.nodeType&&("height"in b||"width"in b)&&(c.overflow=[o.overflow,o.overflowX,o.overflowY],j=n.css(a,"display"),k="none"===j?N.get(a,"olddisplay")||za(a.nodeName):j,"inline"===k&&"none"===n.css(a,"float")&&(o.display="inline-block")),c.overflow&&(o.overflow="hidden",l.always(function(){o.overflow=c.overflow[0],o.overflowX=c.overflow[1],o.overflowY=c.overflow[2]}));for(d in b)if(e=b[d],Ua.exec(e)){if(delete b[d],f=f||"toggle"===e,e===(p?"hide":"show")){if("show"!==e||!q||void 0===q[d])continue;p=!0}m[d]=q&&q[d]||n.style(a,d)}else j=void 0;if(n.isEmptyObject(m))"inline"===("none"===j?za(a.nodeName):j)&&(o.display=j);else{q?"hidden"in q&&(p=q.hidden):q=N.access(a,"fxshow",{}),f&&(q.hidden=!p),p?n(a).show():l.done(function(){n(a).hide()}),l.done(function(){var b;N.remove(a,"fxshow");for(b in m)n.style(a,b,m[b])});for(d in m)g=Ya(p?q[d]:0,d,l),d in q||(q[d]=g.start,p&&(g.end=g.start,g.start="width"===d||"height"===d?1:0))}}function $a(a,b){var c,d,e,f,g;for(c in a)if(d=n.camelCase(c),e=b[d],f=a[c],n.isArray(f)&&(e=f[1],f=a[c]=f[0]),c!==d&&(a[d]=f,delete a[c]),g=n.cssHooks[d],g&&"expand"in g){f=g.expand(f),delete a[d];for(c in f)c in a||(a[c]=f[c],b[c]=e)}else b[d]=e}function _a(a,b,c){var d,e,f=0,g=_a.prefilters.length,h=n.Deferred().always(function(){delete i.elem}),i=function(){if(e)return!1;for(var b=Sa||Wa(),c=Math.max(0,j.startTime+j.duration-b),d=c/j.duration||0,f=1-d,g=0,i=j.tweens.length;i>g;g++)j.tweens[g].run(f);return h.notifyWith(a,[j,f,c]),1>f&&i?c:(h.resolveWith(a,[j]),!1)},j=h.promise({elem:a,props:n.extend({},b),opts:n.extend(!0,{specialEasing:{},easing:n.easing._default},c),originalProperties:b,originalOptions:c,startTime:Sa||Wa(),duration:c.duration,tweens:[],createTween:function(b,c){var d=n.Tween(a,j.opts,b,c,j.opts.specialEasing[b]||j.opts.easing);return j.tweens.push(d),d},stop:function(b){var c=0,d=b?j.tweens.length:0;if(e)return this;for(e=!0;d>c;c++)j.tweens[c].run(1);return b?(h.notifyWith(a,[j,1,0]),h.resolveWith(a,[j,b])):h.rejectWith(a,[j,b]),this}}),k=j.props;for($a(k,j.opts.specialEasing);g>f;f++)if(d=_a.prefilters[f].call(j,a,k,j.opts))return n.isFunction(d.stop)&&(n._queueHooks(j.elem,j.opts.queue).stop=n.proxy(d.stop,d)),d;return n.map(k,Ya,j),n.isFunction(j.opts.start)&&j.opts.start.call(a,j),n.fx.timer(n.extend(i,{elem:a,anim:j,queue:j.opts.queue})),j.progress(j.opts.progress).done(j.opts.done,j.opts.complete).fail(j.opts.fail).always(j.opts.always)}n.Animation=n.extend(_a,{tweeners:{"*":[function(a,b){var c=this.createTween(a,b);return W(c.elem,a,T.exec(b),c),c}]},tweener:function(a,b){n.isFunction(a)?(b=a,a=["*"]):a=a.match(G);for(var c,d=0,e=a.length;e>d;d++)c=a[d],_a.tweeners[c]=_a.tweeners[c]||[],_a.tweeners[c].unshift(b)},prefilters:[Za],prefilter:function(a,b){b?_a.prefilters.unshift(a):_a.prefilters.push(a)}}),n.speed=function(a,b,c){var d=a&&"object"==typeof a?n.extend({},a):{complete:c||!c&&b||n.isFunction(a)&&a,duration:a,easing:c&&b||b&&!n.isFunction(b)&&b};return d.duration=n.fx.off?0:"number"==typeof d.duration?d.duration:d.duration in n.fx.speeds?n.fx.speeds[d.duration]:n.fx.speeds._default,null!=d.queue&&d.queue!==!0||(d.queue="fx"),d.old=d.complete,d.complete=function(){n.isFunction(d.old)&&d.old.call(this),d.queue&&n.dequeue(this,d.queue)},d},n.fn.extend({fadeTo:function(a,b,c,d){return this.filter(V).css("opacity",0).show().end().animate({opacity:b},a,c,d)},animate:function(a,b,c,d){var e=n.isEmptyObject(a),f=n.speed(b,c,d),g=function(){var b=_a(this,n.extend({},a),f);(e||N.get(this,"finish"))&&b.stop(!0)};return g.finish=g,e||f.queue===!1?this.each(g):this.queue(f.queue,g)},stop:function(a,b,c){var d=function(a){var b=a.stop;delete a.stop,b(c)};return"string"!=typeof a&&(c=b,b=a,a=void 0),b&&a!==!1&&this.queue(a||"fx",[]),this.each(function(){var b=!0,e=null!=a&&a+"queueHooks",f=n.timers,g=N.get(this);if(e)g[e]&&g[e].stop&&d(g[e]);else for(e in g)g[e]&&g[e].stop&&Va.test(e)&&d(g[e]);for(e=f.length;e--;)f[e].elem!==this||null!=a&&f[e].queue!==a||(f[e].anim.stop(c),b=!1,f.splice(e,1));!b&&c||n.dequeue(this,a)})},finish:function(a){return a!==!1&&(a=a||"fx"),this.each(function(){var b,c=N.get(this),d=c[a+"queue"],e=c[a+"queueHooks"],f=n.timers,g=d?d.length:0;for(c.finish=!0,n.queue(this,a,[]),e&&e.stop&&e.stop.call(this,!0),b=f.length;b--;)f[b].elem===this&&f[b].queue===a&&(f[b].anim.stop(!0),f.splice(b,1));for(b=0;g>b;b++)d[b]&&d[b].finish&&d[b].finish.call(this);delete c.finish})}}),n.each(["toggle","show","hide"],function(a,b){var c=n.fn[b];n.fn[b]=function(a,d,e){return null==a||"boolean"==typeof a?c.apply(this,arguments):this.animate(Xa(b,!0),a,d,e)}}),n.each({slideDown:Xa("show"),slideUp:Xa("hide"),slideToggle:Xa("toggle"),fadeIn:{opacity:"show"},fadeOut:{opacity:"hide"},fadeToggle:{opacity:"toggle"}},function(a,b){n.fn[a]=function(a,c,d){return this.animate(b,a,c,d)}}),n.timers=[],n.fx.tick=function(){var a,b=0,c=n.timers;for(Sa=n.now();b<c.length;b++)a=c[b],a()||c[b]!==a||c.splice(b--,1);c.length||n.fx.stop(),Sa=void 0},n.fx.timer=function(a){n.timers.push(a),a()?n.fx.start():n.timers.pop()},n.fx.interval=13,n.fx.start=function(){Ta||(Ta=a.setInterval(n.fx.tick,n.fx.interval))},n.fx.stop=function(){a.clearInterval(Ta),Ta=null},n.fx.speeds={slow:600,fast:200,_default:400},n.fn.delay=function(b,c){return b=n.fx?n.fx.speeds[b]||b:b,c=c||"fx",this.queue(c,function(c,d){var e=a.setTimeout(c,b);d.stop=function(){a.clearTimeout(e)}})},function(){var a=d.createElement("input"),b=d.createElement("select"),c=b.appendChild(d.createElement("option"));a.type="checkbox",l.checkOn=""!==a.value,l.optSelected=c.selected,b.disabled=!0,l.optDisabled=!c.disabled,a=d.createElement("input"),a.value="t",a.type="radio",l.radioValue="t"===a.value}();var ab,bb=n.expr.attrHandle;n.fn.extend({attr:function(a,b){return K(this,n.attr,a,b,arguments.length>1)},removeAttr:function(a){return this.each(function(){n.removeAttr(this,a)})}}),n.extend({attr:function(a,b,c){var d,e,f=a.nodeType;if(3!==f&&8!==f&&2!==f)return"undefined"==typeof a.getAttribute?n.prop(a,b,c):(1===f&&n.isXMLDoc(a)||(b=b.toLowerCase(),e=n.attrHooks[b]||(n.expr.match.bool.test(b)?ab:void 0)),void 0!==c?null===c?void n.removeAttr(a,b):e&&"set"in e&&void 0!==(d=e.set(a,c,b))?d:(a.setAttribute(b,c+""),c):e&&"get"in e&&null!==(d=e.get(a,b))?d:(d=n.find.attr(a,b),null==d?void 0:d))},attrHooks:{type:{set:function(a,b){if(!l.radioValue&&"radio"===b&&n.nodeName(a,"input")){var c=a.value;return a.setAttribute("type",b),c&&(a.value=c),b}}}},removeAttr:function(a,b){var c,d,e=0,f=b&&b.match(G);if(f&&1===a.nodeType)while(c=f[e++])d=n.propFix[c]||c,n.expr.match.bool.test(c)&&(a[d]=!1),a.removeAttribute(c)}}),ab={set:function(a,b,c){return b===!1?n.removeAttr(a,c):a.setAttribute(c,c),c}},n.each(n.expr.match.bool.source.match(/\w+/g),function(a,b){var c=bb[b]||n.find.attr;bb[b]=function(a,b,d){var e,f;return d||(f=bb[b],bb[b]=e,e=null!=c(a,b,d)?b.toLowerCase():null,bb[b]=f),e}});var cb=/^(?:input|select|textarea|button)$/i,db=/^(?:a|area)$/i;n.fn.extend({prop:function(a,b){return K(this,n.prop,a,b,arguments.length>1)},removeProp:function(a){return this.each(function(){delete this[n.propFix[a]||a]})}}),n.extend({prop:function(a,b,c){var d,e,f=a.nodeType;if(3!==f&&8!==f&&2!==f)return 1===f&&n.isXMLDoc(a)||(b=n.propFix[b]||b,e=n.propHooks[b]),
void 0!==c?e&&"set"in e&&void 0!==(d=e.set(a,c,b))?d:a[b]=c:e&&"get"in e&&null!==(d=e.get(a,b))?d:a[b]},propHooks:{tabIndex:{get:function(a){var b=n.find.attr(a,"tabindex");return b?parseInt(b,10):cb.test(a.nodeName)||db.test(a.nodeName)&&a.href?0:-1}}},propFix:{"for":"htmlFor","class":"className"}}),l.optSelected||(n.propHooks.selected={get:function(a){var b=a.parentNode;return b&&b.parentNode&&b.parentNode.selectedIndex,null},set:function(a){var b=a.parentNode;b&&(b.selectedIndex,b.parentNode&&b.parentNode.selectedIndex)}}),n.each(["tabIndex","readOnly","maxLength","cellSpacing","cellPadding","rowSpan","colSpan","useMap","frameBorder","contentEditable"],function(){n.propFix[this.toLowerCase()]=this});var eb=/[\t\r\n\f]/g;function fb(a){return a.getAttribute&&a.getAttribute("class")||""}n.fn.extend({addClass:function(a){var b,c,d,e,f,g,h,i=0;if(n.isFunction(a))return this.each(function(b){n(this).addClass(a.call(this,b,fb(this)))});if("string"==typeof a&&a){b=a.match(G)||[];while(c=this[i++])if(e=fb(c),d=1===c.nodeType&&(" "+e+" ").replace(eb," ")){g=0;while(f=b[g++])d.indexOf(" "+f+" ")<0&&(d+=f+" ");h=n.trim(d),e!==h&&c.setAttribute("class",h)}}return this},removeClass:function(a){var b,c,d,e,f,g,h,i=0;if(n.isFunction(a))return this.each(function(b){n(this).removeClass(a.call(this,b,fb(this)))});if(!arguments.length)return this.attr("class","");if("string"==typeof a&&a){b=a.match(G)||[];while(c=this[i++])if(e=fb(c),d=1===c.nodeType&&(" "+e+" ").replace(eb," ")){g=0;while(f=b[g++])while(d.indexOf(" "+f+" ")>-1)d=d.replace(" "+f+" "," ");h=n.trim(d),e!==h&&c.setAttribute("class",h)}}return this},toggleClass:function(a,b){var c=typeof a;return"boolean"==typeof b&&"string"===c?b?this.addClass(a):this.removeClass(a):n.isFunction(a)?this.each(function(c){n(this).toggleClass(a.call(this,c,fb(this),b),b)}):this.each(function(){var b,d,e,f;if("string"===c){d=0,e=n(this),f=a.match(G)||[];while(b=f[d++])e.hasClass(b)?e.removeClass(b):e.addClass(b)}else void 0!==a&&"boolean"!==c||(b=fb(this),b&&N.set(this,"__className__",b),this.setAttribute&&this.setAttribute("class",b||a===!1?"":N.get(this,"__className__")||""))})},hasClass:function(a){var b,c,d=0;b=" "+a+" ";while(c=this[d++])if(1===c.nodeType&&(" "+fb(c)+" ").replace(eb," ").indexOf(b)>-1)return!0;return!1}});var gb=/\r/g,hb=/[\x20\t\r\n\f]+/g;n.fn.extend({val:function(a){var b,c,d,e=this[0];{if(arguments.length)return d=n.isFunction(a),this.each(function(c){var e;1===this.nodeType&&(e=d?a.call(this,c,n(this).val()):a,null==e?e="":"number"==typeof e?e+="":n.isArray(e)&&(e=n.map(e,function(a){return null==a?"":a+""})),b=n.valHooks[this.type]||n.valHooks[this.nodeName.toLowerCase()],b&&"set"in b&&void 0!==b.set(this,e,"value")||(this.value=e))});if(e)return b=n.valHooks[e.type]||n.valHooks[e.nodeName.toLowerCase()],b&&"get"in b&&void 0!==(c=b.get(e,"value"))?c:(c=e.value,"string"==typeof c?c.replace(gb,""):null==c?"":c)}}}),n.extend({valHooks:{option:{get:function(a){var b=n.find.attr(a,"value");return null!=b?b:n.trim(n.text(a)).replace(hb," ")}},select:{get:function(a){for(var b,c,d=a.options,e=a.selectedIndex,f="select-one"===a.type||0>e,g=f?null:[],h=f?e+1:d.length,i=0>e?h:f?e:0;h>i;i++)if(c=d[i],(c.selected||i===e)&&(l.optDisabled?!c.disabled:null===c.getAttribute("disabled"))&&(!c.parentNode.disabled||!n.nodeName(c.parentNode,"optgroup"))){if(b=n(c).val(),f)return b;g.push(b)}return g},set:function(a,b){var c,d,e=a.options,f=n.makeArray(b),g=e.length;while(g--)d=e[g],(d.selected=n.inArray(n.valHooks.option.get(d),f)>-1)&&(c=!0);return c||(a.selectedIndex=-1),f}}}}),n.each(["radio","checkbox"],function(){n.valHooks[this]={set:function(a,b){return n.isArray(b)?a.checked=n.inArray(n(a).val(),b)>-1:void 0}},l.checkOn||(n.valHooks[this].get=function(a){return null===a.getAttribute("value")?"on":a.value})});var ib=/^(?:focusinfocus|focusoutblur)$/;n.extend(n.event,{trigger:function(b,c,e,f){var g,h,i,j,l,m,o,p=[e||d],q=k.call(b,"type")?b.type:b,r=k.call(b,"namespace")?b.namespace.split("."):[];if(h=i=e=e||d,3!==e.nodeType&&8!==e.nodeType&&!ib.test(q+n.event.triggered)&&(q.indexOf(".")>-1&&(r=q.split("."),q=r.shift(),r.sort()),l=q.indexOf(":")<0&&"on"+q,b=b[n.expando]?b:new n.Event(q,"object"==typeof b&&b),b.isTrigger=f?2:3,b.namespace=r.join("."),b.rnamespace=b.namespace?new RegExp("(^|\\.)"+r.join("\\.(?:.*\\.|)")+"(\\.|$)"):null,b.result=void 0,b.target||(b.target=e),c=null==c?[b]:n.makeArray(c,[b]),o=n.event.special[q]||{},f||!o.trigger||o.trigger.apply(e,c)!==!1)){if(!f&&!o.noBubble&&!n.isWindow(e)){for(j=o.delegateType||q,ib.test(j+q)||(h=h.parentNode);h;h=h.parentNode)p.push(h),i=h;i===(e.ownerDocument||d)&&p.push(i.defaultView||i.parentWindow||a)}g=0;while((h=p[g++])&&!b.isPropagationStopped())b.type=g>1?j:o.bindType||q,m=(N.get(h,"events")||{})[b.type]&&N.get(h,"handle"),m&&m.apply(h,c),m=l&&h[l],m&&m.apply&&L(h)&&(b.result=m.apply(h,c),b.result===!1&&b.preventDefault());return b.type=q,f||b.isDefaultPrevented()||o._default&&o._default.apply(p.pop(),c)!==!1||!L(e)||l&&n.isFunction(e[q])&&!n.isWindow(e)&&(i=e[l],i&&(e[l]=null),n.event.triggered=q,e[q](),n.event.triggered=void 0,i&&(e[l]=i)),b.result}},simulate:function(a,b,c){var d=n.extend(new n.Event,c,{type:a,isSimulated:!0});n.event.trigger(d,null,b)}}),n.fn.extend({trigger:function(a,b){return this.each(function(){n.event.trigger(a,b,this)})},triggerHandler:function(a,b){var c=this[0];return c?n.event.trigger(a,b,c,!0):void 0}}),n.each("blur focus focusin focusout load resize scroll unload click dblclick mousedown mouseup mousemove mouseover mouseout mouseenter mouseleave change select submit keydown keypress keyup error contextmenu".split(" "),function(a,b){n.fn[b]=function(a,c){return arguments.length>0?this.on(b,null,a,c):this.trigger(b)}}),n.fn.extend({hover:function(a,b){return this.mouseenter(a).mouseleave(b||a)}}),l.focusin="onfocusin"in a,l.focusin||n.each({focus:"focusin",blur:"focusout"},function(a,b){var c=function(a){n.event.simulate(b,a.target,n.event.fix(a))};n.event.special[b]={setup:function(){var d=this.ownerDocument||this,e=N.access(d,b);e||d.addEventListener(a,c,!0),N.access(d,b,(e||0)+1)},teardown:function(){var d=this.ownerDocument||this,e=N.access(d,b)-1;e?N.access(d,b,e):(d.removeEventListener(a,c,!0),N.remove(d,b))}}});var jb=a.location,kb=n.now(),lb=/\?/;n.parseJSON=function(a){return JSON.parse(a+"")},n.parseXML=function(b){var c;if(!b||"string"!=typeof b)return null;try{c=(new a.DOMParser).parseFromString(b,"text/xml")}catch(d){c=void 0}return c&&!c.getElementsByTagName("parsererror").length||n.error("Invalid XML: "+b),c};var mb=/#.*$/,nb=/([?&])_=[^&]*/,ob=/^(.*?):[ \t]*([^\r\n]*)$/gm,pb=/^(?:about|app|app-storage|.+-extension|file|res|widget):$/,qb=/^(?:GET|HEAD)$/,rb=/^\/\//,sb={},tb={},ub="*/".concat("*"),vb=d.createElement("a");vb.href=jb.href;function wb(a){return function(b,c){"string"!=typeof b&&(c=b,b="*");var d,e=0,f=b.toLowerCase().match(G)||[];if(n.isFunction(c))while(d=f[e++])"+"===d[0]?(d=d.slice(1)||"*",(a[d]=a[d]||[]).unshift(c)):(a[d]=a[d]||[]).push(c)}}function xb(a,b,c,d){var e={},f=a===tb;function g(h){var i;return e[h]=!0,n.each(a[h]||[],function(a,h){var j=h(b,c,d);return"string"!=typeof j||f||e[j]?f?!(i=j):void 0:(b.dataTypes.unshift(j),g(j),!1)}),i}return g(b.dataTypes[0])||!e["*"]&&g("*")}function yb(a,b){var c,d,e=n.ajaxSettings.flatOptions||{};for(c in b)void 0!==b[c]&&((e[c]?a:d||(d={}))[c]=b[c]);return d&&n.extend(!0,a,d),a}function zb(a,b,c){var d,e,f,g,h=a.contents,i=a.dataTypes;while("*"===i[0])i.shift(),void 0===d&&(d=a.mimeType||b.getResponseHeader("Content-Type"));if(d)for(e in h)if(h[e]&&h[e].test(d)){i.unshift(e);break}if(i[0]in c)f=i[0];else{for(e in c){if(!i[0]||a.converters[e+" "+i[0]]){f=e;break}g||(g=e)}f=f||g}return f?(f!==i[0]&&i.unshift(f),c[f]):void 0}function Ab(a,b,c,d){var e,f,g,h,i,j={},k=a.dataTypes.slice();if(k[1])for(g in a.converters)j[g.toLowerCase()]=a.converters[g];f=k.shift();while(f)if(a.responseFields[f]&&(c[a.responseFields[f]]=b),!i&&d&&a.dataFilter&&(b=a.dataFilter(b,a.dataType)),i=f,f=k.shift())if("*"===f)f=i;else if("*"!==i&&i!==f){if(g=j[i+" "+f]||j["* "+f],!g)for(e in j)if(h=e.split(" "),h[1]===f&&(g=j[i+" "+h[0]]||j["* "+h[0]])){g===!0?g=j[e]:j[e]!==!0&&(f=h[0],k.unshift(h[1]));break}if(g!==!0)if(g&&a["throws"])b=g(b);else try{b=g(b)}catch(l){return{state:"parsererror",error:g?l:"No conversion from "+i+" to "+f}}}return{state:"success",data:b}}n.extend({active:0,lastModified:{},etag:{},ajaxSettings:{url:jb.href,type:"GET",isLocal:pb.test(jb.protocol),global:!0,processData:!0,async:!0,contentType:"application/x-www-form-urlencoded; charset=UTF-8",accepts:{"*":ub,text:"text/plain",html:"text/html",xml:"application/xml, text/xml",json:"application/json, text/javascript"},contents:{xml:/\bxml\b/,html:/\bhtml/,json:/\bjson\b/},responseFields:{xml:"responseXML",text:"responseText",json:"responseJSON"},converters:{"* text":String,"text html":!0,"text json":n.parseJSON,"text xml":n.parseXML},flatOptions:{url:!0,context:!0}},ajaxSetup:function(a,b){return b?yb(yb(a,n.ajaxSettings),b):yb(n.ajaxSettings,a)},ajaxPrefilter:wb(sb),ajaxTransport:wb(tb),ajax:function(b,c){"object"==typeof b&&(c=b,b=void 0),c=c||{};var e,f,g,h,i,j,k,l,m=n.ajaxSetup({},c),o=m.context||m,p=m.context&&(o.nodeType||o.jquery)?n(o):n.event,q=n.Deferred(),r=n.Callbacks("once memory"),s=m.statusCode||{},t={},u={},v=0,w="canceled",x={readyState:0,getResponseHeader:function(a){var b;if(2===v){if(!h){h={};while(b=ob.exec(g))h[b[1].toLowerCase()]=b[2]}b=h[a.toLowerCase()]}return null==b?null:b},getAllResponseHeaders:function(){return 2===v?g:null},setRequestHeader:function(a,b){var c=a.toLowerCase();return v||(a=u[c]=u[c]||a,t[a]=b),this},overrideMimeType:function(a){return v||(m.mimeType=a),this},statusCode:function(a){var b;if(a)if(2>v)for(b in a)s[b]=[s[b],a[b]];else x.always(a[x.status]);return this},abort:function(a){var b=a||w;return e&&e.abort(b),z(0,b),this}};if(q.promise(x).complete=r.add,x.success=x.done,x.error=x.fail,m.url=((b||m.url||jb.href)+"").replace(mb,"").replace(rb,jb.protocol+"//"),m.type=c.method||c.type||m.method||m.type,m.dataTypes=n.trim(m.dataType||"*").toLowerCase().match(G)||[""],null==m.crossDomain){j=d.createElement("a");try{j.href=m.url,j.href=j.href,m.crossDomain=vb.protocol+"//"+vb.host!=j.protocol+"//"+j.host}catch(y){m.crossDomain=!0}}if(m.data&&m.processData&&"string"!=typeof m.data&&(m.data=n.param(m.data,m.traditional)),xb(sb,m,c,x),2===v)return x;k=n.event&&m.global,k&&0===n.active++&&n.event.trigger("ajaxStart"),m.type=m.type.toUpperCase(),m.hasContent=!qb.test(m.type),f=m.url,m.hasContent||(m.data&&(f=m.url+=(lb.test(f)?"&":"?")+m.data,delete m.data),m.cache===!1&&(m.url=nb.test(f)?f.replace(nb,"$1_="+kb++):f+(lb.test(f)?"&":"?")+"_="+kb++)),m.ifModified&&(n.lastModified[f]&&x.setRequestHeader("If-Modified-Since",n.lastModified[f]),n.etag[f]&&x.setRequestHeader("If-None-Match",n.etag[f])),(m.data&&m.hasContent&&m.contentType!==!1||c.contentType)&&x.setRequestHeader("Content-Type",m.contentType),x.setRequestHeader("Accept",m.dataTypes[0]&&m.accepts[m.dataTypes[0]]?m.accepts[m.dataTypes[0]]+("*"!==m.dataTypes[0]?", "+ub+"; q=0.01":""):m.accepts["*"]);for(l in m.headers)x.setRequestHeader(l,m.headers[l]);if(m.beforeSend&&(m.beforeSend.call(o,x,m)===!1||2===v))return x.abort();w="abort";for(l in{success:1,error:1,complete:1})x[l](m[l]);if(e=xb(tb,m,c,x)){if(x.readyState=1,k&&p.trigger("ajaxSend",[x,m]),2===v)return x;m.async&&m.timeout>0&&(i=a.setTimeout(function(){x.abort("timeout")},m.timeout));try{v=1,e.send(t,z)}catch(y){if(!(2>v))throw y;z(-1,y)}}else z(-1,"No Transport");function z(b,c,d,h){var j,l,t,u,w,y=c;2!==v&&(v=2,i&&a.clearTimeout(i),e=void 0,g=h||"",x.readyState=b>0?4:0,j=b>=200&&300>b||304===b,d&&(u=zb(m,x,d)),u=Ab(m,u,x,j),j?(m.ifModified&&(w=x.getResponseHeader("Last-Modified"),w&&(n.lastModified[f]=w),w=x.getResponseHeader("etag"),w&&(n.etag[f]=w)),204===b||"HEAD"===m.type?y="nocontent":304===b?y="notmodified":(y=u.state,l=u.data,t=u.error,j=!t)):(t=y,!b&&y||(y="error",0>b&&(b=0))),x.status=b,x.statusText=(c||y)+"",j?q.resolveWith(o,[l,y,x]):q.rejectWith(o,[x,y,t]),x.statusCode(s),s=void 0,k&&p.trigger(j?"ajaxSuccess":"ajaxError",[x,m,j?l:t]),r.fireWith(o,[x,y]),k&&(p.trigger("ajaxComplete",[x,m]),--n.active||n.event.trigger("ajaxStop")))}return x},getJSON:function(a,b,c){return n.get(a,b,c,"json")},getScript:function(a,b){return n.get(a,void 0,b,"script")}}),n.each(["get","post"],function(a,b){n[b]=function(a,c,d,e){return n.isFunction(c)&&(e=e||d,d=c,c=void 0),n.ajax(n.extend({url:a,type:b,dataType:e,data:c,success:d},n.isPlainObject(a)&&a))}}),n._evalUrl=function(a){return n.ajax({url:a,type:"GET",dataType:"script",async:!1,global:!1,"throws":!0})},n.fn.extend({wrapAll:function(a){var b;return n.isFunction(a)?this.each(function(b){n(this).wrapAll(a.call(this,b))}):(this[0]&&(b=n(a,this[0].ownerDocument).eq(0).clone(!0),this[0].parentNode&&b.insertBefore(this[0]),b.map(function(){var a=this;while(a.firstElementChild)a=a.firstElementChild;return a}).append(this)),this)},wrapInner:function(a){return n.isFunction(a)?this.each(function(b){n(this).wrapInner(a.call(this,b))}):this.each(function(){var b=n(this),c=b.contents();c.length?c.wrapAll(a):b.append(a)})},wrap:function(a){var b=n.isFunction(a);return this.each(function(c){n(this).wrapAll(b?a.call(this,c):a)})},unwrap:function(){return this.parent().each(function(){n.nodeName(this,"body")||n(this).replaceWith(this.childNodes)}).end()}}),n.expr.filters.hidden=function(a){return!n.expr.filters.visible(a)},n.expr.filters.visible=function(a){return a.offsetWidth>0||a.offsetHeight>0||a.getClientRects().length>0};var Bb=/%20/g,Cb=/\[\]$/,Db=/\r?\n/g,Eb=/^(?:submit|button|image|reset|file)$/i,Fb=/^(?:input|select|textarea|keygen)/i;function Gb(a,b,c,d){var e;if(n.isArray(b))n.each(b,function(b,e){c||Cb.test(a)?d(a,e):Gb(a+"["+("object"==typeof e&&null!=e?b:"")+"]",e,c,d)});else if(c||"object"!==n.type(b))d(a,b);else for(e in b)Gb(a+"["+e+"]",b[e],c,d)}n.param=function(a,b){var c,d=[],e=function(a,b){b=n.isFunction(b)?b():null==b?"":b,d[d.length]=encodeURIComponent(a)+"="+encodeURIComponent(b)};if(void 0===b&&(b=n.ajaxSettings&&n.ajaxSettings.traditional),n.isArray(a)||a.jquery&&!n.isPlainObject(a))n.each(a,function(){e(this.name,this.value)});else for(c in a)Gb(c,a[c],b,e);return d.join("&").replace(Bb,"+")},n.fn.extend({serialize:function(){return n.param(this.serializeArray())},serializeArray:function(){return this.map(function(){var a=n.prop(this,"elements");return a?n.makeArray(a):this}).filter(function(){var a=this.type;return this.name&&!n(this).is(":disabled")&&Fb.test(this.nodeName)&&!Eb.test(a)&&(this.checked||!X.test(a))}).map(function(a,b){var c=n(this).val();return null==c?null:n.isArray(c)?n.map(c,function(a){return{name:b.name,value:a.replace(Db,"\r\n")}}):{name:b.name,value:c.replace(Db,"\r\n")}}).get()}}),n.ajaxSettings.xhr=function(){try{return new a.XMLHttpRequest}catch(b){}};var Hb={0:200,1223:204},Ib=n.ajaxSettings.xhr();l.cors=!!Ib&&"withCredentials"in Ib,l.ajax=Ib=!!Ib,n.ajaxTransport(function(b){var c,d;return l.cors||Ib&&!b.crossDomain?{send:function(e,f){var g,h=b.xhr();if(h.open(b.type,b.url,b.async,b.username,b.password),b.xhrFields)for(g in b.xhrFields)h[g]=b.xhrFields[g];b.mimeType&&h.overrideMimeType&&h.overrideMimeType(b.mimeType),b.crossDomain||e["X-Requested-With"]||(e["X-Requested-With"]="XMLHttpRequest");for(g in e)h.setRequestHeader(g,e[g]);c=function(a){return function(){c&&(c=d=h.onload=h.onerror=h.onabort=h.onreadystatechange=null,"abort"===a?h.abort():"error"===a?"number"!=typeof h.status?f(0,"error"):f(h.status,h.statusText):f(Hb[h.status]||h.status,h.statusText,"text"!==(h.responseType||"text")||"string"!=typeof h.responseText?{binary:h.response}:{text:h.responseText},h.getAllResponseHeaders()))}},h.onload=c(),d=h.onerror=c("error"),void 0!==h.onabort?h.onabort=d:h.onreadystatechange=function(){4===h.readyState&&a.setTimeout(function(){c&&d()})},c=c("abort");try{h.send(b.hasContent&&b.data||null)}catch(i){if(c)throw i}},abort:function(){c&&c()}}:void 0}),n.ajaxSetup({accepts:{script:"text/javascript, application/javascript, application/ecmascript, application/x-ecmascript"},contents:{script:/\b(?:java|ecma)script\b/},converters:{"text script":function(a){return n.globalEval(a),a}}}),n.ajaxPrefilter("script",function(a){void 0===a.cache&&(a.cache=!1),a.crossDomain&&(a.type="GET")}),n.ajaxTransport("script",function(a){if(a.crossDomain){var b,c;return{send:function(e,f){b=n("<script>").prop({charset:a.scriptCharset,src:a.url}).on("load error",c=function(a){b.remove(),c=null,a&&f("error"===a.type?404:200,a.type)}),d.head.appendChild(b[0])},abort:function(){c&&c()}}}});var Jb=[],Kb=/(=)\?(?=&|$)|\?\?/;n.ajaxSetup({jsonp:"callback",jsonpCallback:function(){var a=Jb.pop()||n.expando+"_"+kb++;return this[a]=!0,a}}),n.ajaxPrefilter("json jsonp",function(b,c,d){var e,f,g,h=b.jsonp!==!1&&(Kb.test(b.url)?"url":"string"==typeof b.data&&0===(b.contentType||"").indexOf("application/x-www-form-urlencoded")&&Kb.test(b.data)&&"data");return h||"jsonp"===b.dataTypes[0]?(e=b.jsonpCallback=n.isFunction(b.jsonpCallback)?b.jsonpCallback():b.jsonpCallback,h?b[h]=b[h].replace(Kb,"$1"+e):b.jsonp!==!1&&(b.url+=(lb.test(b.url)?"&":"?")+b.jsonp+"="+e),b.converters["script json"]=function(){return g||n.error(e+" was not called"),g[0]},b.dataTypes[0]="json",f=a[e],a[e]=function(){g=arguments},d.always(function(){void 0===f?n(a).removeProp(e):a[e]=f,b[e]&&(b.jsonpCallback=c.jsonpCallback,Jb.push(e)),g&&n.isFunction(f)&&f(g[0]),g=f=void 0}),"script"):void 0}),n.parseHTML=function(a,b,c){if(!a||"string"!=typeof a)return null;"boolean"==typeof b&&(c=b,b=!1),b=b||d;var e=x.exec(a),f=!c&&[];return e?[b.createElement(e[1])]:(e=ca([a],b,f),f&&f.length&&n(f).remove(),n.merge([],e.childNodes))};var Lb=n.fn.load;n.fn.load=function(a,b,c){if("string"!=typeof a&&Lb)return Lb.apply(this,arguments);var d,e,f,g=this,h=a.indexOf(" ");return h>-1&&(d=n.trim(a.slice(h)),a=a.slice(0,h)),n.isFunction(b)?(c=b,b=void 0):b&&"object"==typeof b&&(e="POST"),g.length>0&&n.ajax({url:a,type:e||"GET",dataType:"html",data:b}).done(function(a){f=arguments,g.html(d?n("<div>").append(n.parseHTML(a)).find(d):a)}).always(c&&function(a,b){g.each(function(){c.apply(this,f||[a.responseText,b,a])})}),this},n.each(["ajaxStart","ajaxStop","ajaxComplete","ajaxError","ajaxSuccess","ajaxSend"],function(a,b){n.fn[b]=function(a){return this.on(b,a)}}),n.expr.filters.animated=function(a){return n.grep(n.timers,function(b){return a===b.elem}).length};function Mb(a){return n.isWindow(a)?a:9===a.nodeType&&a.defaultView}n.offset={setOffset:function(a,b,c){var d,e,f,g,h,i,j,k=n.css(a,"position"),l=n(a),m={};"static"===k&&(a.style.position="relative"),h=l.offset(),f=n.css(a,"top"),i=n.css(a,"left"),j=("absolute"===k||"fixed"===k)&&(f+i).indexOf("auto")>-1,j?(d=l.position(),g=d.top,e=d.left):(g=parseFloat(f)||0,e=parseFloat(i)||0),n.isFunction(b)&&(b=b.call(a,c,n.extend({},h))),null!=b.top&&(m.top=b.top-h.top+g),null!=b.left&&(m.left=b.left-h.left+e),"using"in b?b.using.call(a,m):l.css(m)}},n.fn.extend({offset:function(a){if(arguments.length)return void 0===a?this:this.each(function(b){n.offset.setOffset(this,a,b)});var b,c,d=this[0],e={top:0,left:0},f=d&&d.ownerDocument;if(f)return b=f.documentElement,n.contains(b,d)?(e=d.getBoundingClientRect(),c=Mb(f),{top:e.top+c.pageYOffset-b.clientTop,left:e.left+c.pageXOffset-b.clientLeft}):e},position:function(){if(this[0]){var a,b,c=this[0],d={top:0,left:0};return"fixed"===n.css(c,"position")?b=c.getBoundingClientRect():(a=this.offsetParent(),b=this.offset(),n.nodeName(a[0],"html")||(d=a.offset()),d.top+=n.css(a[0],"borderTopWidth",!0),d.left+=n.css(a[0],"borderLeftWidth",!0)),{top:b.top-d.top-n.css(c,"marginTop",!0),left:b.left-d.left-n.css(c,"marginLeft",!0)}}},offsetParent:function(){return this.map(function(){var a=this.offsetParent;while(a&&"static"===n.css(a,"position"))a=a.offsetParent;return a||Ea})}}),n.each({scrollLeft:"pageXOffset",scrollTop:"pageYOffset"},function(a,b){var c="pageYOffset"===b;n.fn[a]=function(d){return K(this,function(a,d,e){var f=Mb(a);return void 0===e?f?f[b]:a[d]:void(f?f.scrollTo(c?f.pageXOffset:e,c?e:f.pageYOffset):a[d]=e)},a,d,arguments.length)}}),n.each(["top","left"],function(a,b){n.cssHooks[b]=Ga(l.pixelPosition,function(a,c){return c?(c=Fa(a,b),Ba.test(c)?n(a).position()[b]+"px":c):void 0})}),n.each({Height:"height",Width:"width"},function(a,b){n.each({padding:"inner"+a,content:b,"":"outer"+a},function(c,d){n.fn[d]=function(d,e){var f=arguments.length&&(c||"boolean"!=typeof d),g=c||(d===!0||e===!0?"margin":"border");return K(this,function(b,c,d){var e;return n.isWindow(b)?b.document.documentElement["client"+a]:9===b.nodeType?(e=b.documentElement,Math.max(b.body["scroll"+a],e["scroll"+a],b.body["offset"+a],e["offset"+a],e["client"+a])):void 0===d?n.css(b,c,g):n.style(b,c,d,g)},b,f?d:void 0,f,null)}})}),n.fn.extend({bind:function(a,b,c){return this.on(a,null,b,c)},unbind:function(a,b){return this.off(a,null,b)},delegate:function(a,b,c,d){return this.on(b,a,c,d)},undelegate:function(a,b,c){return 1===arguments.length?this.off(a,"**"):this.off(b,a||"**",c)},size:function(){return this.length}}),n.fn.andSelf=n.fn.addBack,"function"==typeof define&&define.amd&&define("jquery",[],function(){return n});var Nb=a.jQuery,Ob=a.$;return n.noConflict=function(b){return a.$===n&&(a.$=Ob),b&&a.jQuery===n&&(a.jQuery=Nb),n},b||(a.jQuery=a.$=n),n});

(function (factory) {
	// Module systems magic dance.

	if (typeof require === "function" && typeof exports === "object" && typeof module === "object") {
		// CommonJS or Node: hard-coded dependency on "knockout"
		factory(require("knockout"), exports);
	} else if (typeof define === "function" && define["amd"]) {
		// AMD anonymous module with hard-coded dependency on "knockout"
		define('knockout-mapping',["knockout", "exports"], factory);
	} else {
		// <script> tag: use the global `ko` object, attaching a `mapping` property
		factory(ko, ko.mapping = {});
	}
}(function (ko, exports) {
	var DEBUG=true;
	var mappingProperty = "__ko_mapping__";
	var realKoDependentObservable = ko.dependentObservable;
	var mappingNesting = 0;
	var dependentObservables;
	var visitedObjects;
	var recognizedRootProperties = ["create", "update", "key", "arrayChanged"];
	var emptyReturn = {};

	var _defaultOptions = {
		include: ["_destroy"],
		ignore: [],
		copy: [],
		observe: []
	};
	var defaultOptions = _defaultOptions;

	// Author: KennyTM @ StackOverflow
	function unionArrays (x, y) {
		var obj = {};
		for (var i = x.length - 1; i >= 0; -- i) obj[x[i]] = x[i];
		for (var i = y.length - 1; i >= 0; -- i) obj[y[i]] = y[i];
		var res = [];

		for (var k in obj) {
			res.push(obj[k]);
		};

		return res;
	}

	function extendObject(destination, source) {
		var destType;

		for (var key in source) {
			if (source.hasOwnProperty(key) && source[key]) {
				destType = exports.getType(destination[key]);
				if (key && destination[key] && destType !== "array" && destType !== "string") {
					extendObject(destination[key], source[key]);
				} else {
					var bothArrays = exports.getType(destination[key]) === "array" && exports.getType(source[key]) === "array";
					if (bothArrays) {
						destination[key] = unionArrays(destination[key], source[key]);
					} else {
						destination[key] = source[key];
					}
				}
			}
		}
	}

	function merge(obj1, obj2) {
		var merged = {};
		extendObject(merged, obj1);
		extendObject(merged, obj2);

		return merged;
	}

	exports.isMapped = function (viewModel) {
		var unwrapped = ko.utils.unwrapObservable(viewModel);
		return unwrapped && unwrapped[mappingProperty];
	}

	exports.fromJS = function (jsObject /*, inputOptions, target*/ ) {
		if (arguments.length == 0) throw new Error("When calling ko.fromJS, pass the object you want to convert.");

		try {
			if (!mappingNesting++) {
				dependentObservables = [];
				visitedObjects = new objectLookup();
			}

			var options;
			var target;

			if (arguments.length == 2) {
				if (arguments[1][mappingProperty]) {
					target = arguments[1];
				} else {
					options = arguments[1];
				}
			}
			if (arguments.length == 3) {
				options = arguments[1];
				target = arguments[2];
			}

			if (target) {
				options = merge(options, target[mappingProperty]);
			}
			options = fillOptions(options);

			var result = updateViewModel(target, jsObject, options);
			if (target) {
				result = target;
			}

			// Evaluate any dependent observables that were proxied.
			// Do this after the model's observables have been created
			if (!--mappingNesting) {
				while (dependentObservables.length) {
					var DO = dependentObservables.pop();
					if (DO) {
						DO();
						
						// Move this magic property to the underlying dependent observable
						DO.__DO["throttleEvaluation"] = DO["throttleEvaluation"];
					}
				}
			}

			// Save any new mapping options in the view model, so that updateFromJS can use them later.
			result[mappingProperty] = merge(result[mappingProperty], options);

			return result;
		} catch(e) {
			mappingNesting = 0;
			throw e;
		}
	};

	exports.fromJSON = function (jsonString /*, options, target*/ ) {
		var parsed = ko.utils.parseJson(jsonString);
		arguments[0] = parsed;
		return exports.fromJS.apply(this, arguments);
	};

	exports.updateFromJS = function (viewModel) {
		throw new Error("ko.mapping.updateFromJS, use ko.mapping.fromJS instead. Please note that the order of parameters is different!");
	};

	exports.updateFromJSON = function (viewModel) {
		throw new Error("ko.mapping.updateFromJSON, use ko.mapping.fromJSON instead. Please note that the order of parameters is different!");
	};

	exports.toJS = function (rootObject, options) {
		if (!defaultOptions) exports.resetDefaultOptions();

		if (arguments.length == 0) throw new Error("When calling ko.mapping.toJS, pass the object you want to convert.");
		if (exports.getType(defaultOptions.ignore) !== "array") throw new Error("ko.mapping.defaultOptions().ignore should be an array.");
		if (exports.getType(defaultOptions.include) !== "array") throw new Error("ko.mapping.defaultOptions().include should be an array.");
		if (exports.getType(defaultOptions.copy) !== "array") throw new Error("ko.mapping.defaultOptions().copy should be an array.");

		// Merge in the options used in fromJS
		options = fillOptions(options, rootObject[mappingProperty]);

		// We just unwrap everything at every level in the object graph
		return exports.visitModel(rootObject, function (x) {
			return ko.utils.unwrapObservable(x)
		}, options);
	};

	exports.toJSON = function (rootObject, options) {
		var plainJavaScriptObject = exports.toJS(rootObject, options);
		return ko.utils.stringifyJson(plainJavaScriptObject);
	};

	exports.defaultOptions = function () {
		if (arguments.length > 0) {
			defaultOptions = arguments[0];
		} else {
			return defaultOptions;
		}
	};

	exports.resetDefaultOptions = function () {
		defaultOptions = {
			include: _defaultOptions.include.slice(0),
			ignore: _defaultOptions.ignore.slice(0),
			copy: _defaultOptions.copy.slice(0)
		};
	};

	exports.getType = function(x) {
		if ((x) && (typeof (x) === "object")) {
			if (x.constructor === Date) return "date";
			if (x.constructor === Array) return "array";
		}
		return typeof x;
	}

	function fillOptions(rawOptions, otherOptions) {
		var options = merge({}, rawOptions);

		// Move recognized root-level properties into a root namespace
		for (var i = recognizedRootProperties.length - 1; i >= 0; i--) {
			var property = recognizedRootProperties[i];
			
			// Carry on, unless this property is present
			if (!options[property]) continue;
			
			// Move the property into the root namespace
			if (!(options[""] instanceof Object)) options[""] = {};
			options[""][property] = options[property];
			delete options[property];
		}

		if (otherOptions) {
			options.ignore = mergeArrays(otherOptions.ignore, options.ignore);
			options.include = mergeArrays(otherOptions.include, options.include);
			options.copy = mergeArrays(otherOptions.copy, options.copy);
			options.observe = mergeArrays(otherOptions.observe, options.observe);
		}
		options.ignore = mergeArrays(options.ignore, defaultOptions.ignore);
		options.include = mergeArrays(options.include, defaultOptions.include);
		options.copy = mergeArrays(options.copy, defaultOptions.copy);
		options.observe = mergeArrays(options.observe, defaultOptions.observe);

		options.mappedProperties = options.mappedProperties || {};
		options.copiedProperties = options.copiedProperties || {};
		return options;
	}

	function mergeArrays(a, b) {
		if (exports.getType(a) !== "array") {
			if (exports.getType(a) === "undefined") a = [];
			else a = [a];
		}
		if (exports.getType(b) !== "array") {
			if (exports.getType(b) === "undefined") b = [];
			else b = [b];
		}

		return ko.utils.arrayGetDistinctValues(a.concat(b));
	}

	// When using a 'create' callback, we proxy the dependent observable so that it doesn't immediately evaluate on creation.
	// The reason is that the dependent observables in the user-specified callback may contain references to properties that have not been mapped yet.
	function withProxyDependentObservable(dependentObservables, callback) {
		var localDO = ko.dependentObservable;
		ko.dependentObservable = function (read, owner, options) {
			options = options || {};

			if (read && typeof read == "object") { // mirrors condition in knockout implementation of DO's
				options = read;
			}

			var realDeferEvaluation = options.deferEvaluation;

			var isRemoved = false;

			// We wrap the original dependent observable so that we can remove it from the 'dependentObservables' list we need to evaluate after mapping has
			// completed if the user already evaluated the DO themselves in the meantime.
			var wrap = function (DO) {
				// Temporarily revert ko.dependentObservable, since it is used in ko.isWriteableObservable
				var tmp = ko.dependentObservable;
				ko.dependentObservable = realKoDependentObservable;
				var isWriteable = ko.isWriteableObservable(DO);
				ko.dependentObservable = tmp;

				var wrapped = realKoDependentObservable({
					read: function () {
						if (!isRemoved) {
							ko.utils.arrayRemoveItem(dependentObservables, DO);
							isRemoved = true;
						}
						return DO.apply(DO, arguments);
					},
					write: isWriteable && function (val) {
						return DO(val);
					},
					deferEvaluation: true
				});
				if (DEBUG) wrapped._wrapper = true;
				wrapped.__DO = DO;
				return wrapped;
			};
			
			options.deferEvaluation = true; // will either set for just options, or both read/options.
			var realDependentObservable = new realKoDependentObservable(read, owner, options);

			if (!realDeferEvaluation) {
				realDependentObservable = wrap(realDependentObservable);
				dependentObservables.push(realDependentObservable);
			}

			return realDependentObservable;
		}
		ko.dependentObservable.fn = realKoDependentObservable.fn;
		ko.computed = ko.dependentObservable;
		var result = callback();
		ko.dependentObservable = localDO;
		ko.computed = ko.dependentObservable;
		return result;
	}

	function updateViewModel(mappedRootObject, rootObject, options, parentName, parent, parentPropertyName, mappedParent) {
		var isArray = exports.getType(ko.utils.unwrapObservable(rootObject)) === "array";

		parentPropertyName = parentPropertyName || "";

		// If this object was already mapped previously, take the options from there and merge them with our existing ones.
		if (exports.isMapped(mappedRootObject)) {
			var previousMapping = ko.utils.unwrapObservable(mappedRootObject)[mappingProperty];
			options = merge(previousMapping, options);
		}

		var callbackParams = {
			data: rootObject,
			parent: mappedParent || parent
		};

		var hasCreateCallback = function () {
			return options[parentName] && options[parentName].create instanceof Function;
		};

		var createCallback = function (data) {
			return withProxyDependentObservable(dependentObservables, function () {
				
				if (ko.utils.unwrapObservable(parent) instanceof Array) {
					return options[parentName].create({
						data: data || callbackParams.data,
						parent: callbackParams.parent,
						skip: emptyReturn
					});
				} else {
					return options[parentName].create({
						data: data || callbackParams.data,
						parent: callbackParams.parent
					});
				}				
			});
		};

		var hasUpdateCallback = function () {
			return options[parentName] && options[parentName].update instanceof Function;
		};

		var updateCallback = function (obj, data) {
			var params = {
				data: data || callbackParams.data,
				parent: callbackParams.parent,
				target: ko.utils.unwrapObservable(obj)
			};

			if (ko.isWriteableObservable(obj)) {
				params.observable = obj;
			}

			return options[parentName].update(params);
		}

		var alreadyMapped = visitedObjects.get(rootObject);
		if (alreadyMapped) {
			return alreadyMapped;
		}

		parentName = parentName || "";

		if (!isArray) {
			// For atomic types, do a direct update on the observable
			if (!canHaveProperties(rootObject)) {
				switch (exports.getType(rootObject)) {
				case "function":
					if (hasUpdateCallback()) {
						if (ko.isWriteableObservable(rootObject)) {
							rootObject(updateCallback(rootObject));
							mappedRootObject = rootObject;
						} else {
							mappedRootObject = updateCallback(rootObject);
						}
					} else {
						mappedRootObject = rootObject;
					}
					break;
				default:
					if (ko.isWriteableObservable(mappedRootObject)) {
						if (hasUpdateCallback()) {
							var valueToWrite = updateCallback(mappedRootObject);
							mappedRootObject(valueToWrite);
							return valueToWrite;
						} else {
							var valueToWrite = ko.utils.unwrapObservable(rootObject);
							mappedRootObject(valueToWrite);
							return valueToWrite;
						}
					} else {
						var hasCreateOrUpdateCallback = hasCreateCallback() || hasUpdateCallback();
						
						if (hasCreateCallback()) {
							mappedRootObject = createCallback();
						} else {
							mappedRootObject = ko.observable(ko.utils.unwrapObservable(rootObject));
						}

						if (hasUpdateCallback()) {
							mappedRootObject(updateCallback(mappedRootObject));
						}
						
						if (hasCreateOrUpdateCallback) return mappedRootObject;
					}
				}

			} else {
				mappedRootObject = ko.utils.unwrapObservable(mappedRootObject);
				if (!mappedRootObject) {
					if (hasCreateCallback()) {
						var result = createCallback();

						if (hasUpdateCallback()) {
							result = updateCallback(result);
						}

						return result;
					} else {
						if (hasUpdateCallback()) {
							return updateCallback(result);
						}

						mappedRootObject = {};
					}
				}

				if (hasUpdateCallback()) {
					mappedRootObject = updateCallback(mappedRootObject);
				}

				visitedObjects.save(rootObject, mappedRootObject);
				if (hasUpdateCallback()) return mappedRootObject;

				// For non-atomic types, visit all properties and update recursively
				visitPropertiesOrArrayEntries(rootObject, function (indexer) {
					var fullPropertyName = parentPropertyName.length ? parentPropertyName + "." + indexer : indexer;

					if (ko.utils.arrayIndexOf(options.ignore, fullPropertyName) != -1) {
						return;
					}

					if (ko.utils.arrayIndexOf(options.copy, fullPropertyName) != -1) {
						mappedRootObject[indexer] = rootObject[indexer];
						return;
					}

					if(typeof rootObject[indexer] != "object" && typeof rootObject[indexer] != "array" && options.observe.length > 0 && ko.utils.arrayIndexOf(options.observe, fullPropertyName) == -1)
					{
						mappedRootObject[indexer] = rootObject[indexer];
						options.copiedProperties[fullPropertyName] = true;
						return;
					}
					
					// In case we are adding an already mapped property, fill it with the previously mapped property value to prevent recursion.
					// If this is a property that was generated by fromJS, we should use the options specified there
					var prevMappedProperty = visitedObjects.get(rootObject[indexer]);
					var retval = updateViewModel(mappedRootObject[indexer], rootObject[indexer], options, indexer, mappedRootObject, fullPropertyName, mappedRootObject);
					var value = prevMappedProperty || retval;
					
					if(options.observe.length > 0 && ko.utils.arrayIndexOf(options.observe, fullPropertyName) == -1)
					{
						mappedRootObject[indexer] = value();
						options.copiedProperties[fullPropertyName] = true;
						return;
					}
					
					if (ko.isWriteableObservable(mappedRootObject[indexer])) {
						value = ko.utils.unwrapObservable(value);
						if (mappedRootObject[indexer]() !== value) {
							mappedRootObject[indexer](value);
						}
					} else {
						value = mappedRootObject[indexer] === undefined ? value : ko.utils.unwrapObservable(value);
						mappedRootObject[indexer] = value;
					}

					options.mappedProperties[fullPropertyName] = true;
				});
			}
		} else { //mappedRootObject is an array
			var changes = [];

			var hasKeyCallback = false;
			var keyCallback = function (x) {
				return x;
			}
			if (options[parentName] && options[parentName].key) {
				keyCallback = options[parentName].key;
				hasKeyCallback = true;
			}

			if (!ko.isObservable(mappedRootObject)) {
				// When creating the new observable array, also add a bunch of utility functions that take the 'key' of the array items into account.
				mappedRootObject = ko.observableArray([]);

				mappedRootObject.mappedRemove = function (valueOrPredicate) {
					var predicate = typeof valueOrPredicate == "function" ? valueOrPredicate : function (value) {
							return value === keyCallback(valueOrPredicate);
						};
					return mappedRootObject.remove(function (item) {
						return predicate(keyCallback(item));
					});
				}

				mappedRootObject.mappedRemoveAll = function (arrayOfValues) {
					var arrayOfKeys = filterArrayByKey(arrayOfValues, keyCallback);
					return mappedRootObject.remove(function (item) {
						return ko.utils.arrayIndexOf(arrayOfKeys, keyCallback(item)) != -1;
					});
				}

				mappedRootObject.mappedDestroy = function (valueOrPredicate) {
					var predicate = typeof valueOrPredicate == "function" ? valueOrPredicate : function (value) {
							return value === keyCallback(valueOrPredicate);
						};
					return mappedRootObject.destroy(function (item) {
						return predicate(keyCallback(item));
					});
				}

				mappedRootObject.mappedDestroyAll = function (arrayOfValues) {
					var arrayOfKeys = filterArrayByKey(arrayOfValues, keyCallback);
					return mappedRootObject.destroy(function (item) {
						return ko.utils.arrayIndexOf(arrayOfKeys, keyCallback(item)) != -1;
					});
				}

				mappedRootObject.mappedIndexOf = function (item) {
					var keys = filterArrayByKey(mappedRootObject(), keyCallback);
					var key = keyCallback(item);
					return ko.utils.arrayIndexOf(keys, key);
				}

				mappedRootObject.mappedGet = function (item) {
					return mappedRootObject()[mappedRootObject.mappedIndexOf(item)];
				}

				mappedRootObject.mappedCreate = function (value) {
					if (mappedRootObject.mappedIndexOf(value) !== -1) {
						throw new Error("There already is an object with the key that you specified.");
					}

					var item = hasCreateCallback() ? createCallback(value) : value;
					if (hasUpdateCallback()) {
						var newValue = updateCallback(item, value);
						if (ko.isWriteableObservable(item)) {
							item(newValue);
						} else {
							item = newValue;
						}
					}
					mappedRootObject.push(item);
					return item;
				}
			}

			var currentArrayKeys = filterArrayByKey(ko.utils.unwrapObservable(mappedRootObject), keyCallback).sort();
			var newArrayKeys = filterArrayByKey(rootObject, keyCallback);
			if (hasKeyCallback) newArrayKeys.sort();
			var editScript = ko.utils.compareArrays(currentArrayKeys, newArrayKeys);

			var ignoreIndexOf = {};
			
			var i, j;

			var unwrappedRootObject = ko.utils.unwrapObservable(rootObject);
			var itemsByKey = {};
			var optimizedKeys = true;
			for (i = 0, j = unwrappedRootObject.length; i < j; i++) {
				var key = keyCallback(unwrappedRootObject[i]);
				if (key === undefined || key instanceof Object) {
					optimizedKeys = false;
					break;
				}
				itemsByKey[key] = unwrappedRootObject[i];
			}

			var newContents = [];
			var passedOver = 0;
			for (i = 0, j = editScript.length; i < j; i++) {
				var key = editScript[i];
				var mappedItem;
				var fullPropertyName = parentPropertyName + "[" + i + "]";
				switch (key.status) {
				case "added":
					var item = optimizedKeys ? itemsByKey[key.value] : getItemByKey(ko.utils.unwrapObservable(rootObject), key.value, keyCallback);
					mappedItem = updateViewModel(undefined, item, options, parentName, mappedRootObject, fullPropertyName, parent);
					if(!hasCreateCallback()) {
						mappedItem = ko.utils.unwrapObservable(mappedItem);
					}

					var index = ignorableIndexOf(ko.utils.unwrapObservable(rootObject), item, ignoreIndexOf);
					
					if (mappedItem === emptyReturn) {
						passedOver++;
					} else {
						newContents[index - passedOver] = mappedItem;
					}
						
					ignoreIndexOf[index] = true;
					break;
				case "retained":
					var item = optimizedKeys ? itemsByKey[key.value] : getItemByKey(ko.utils.unwrapObservable(rootObject), key.value, keyCallback);
					mappedItem = getItemByKey(mappedRootObject, key.value, keyCallback);
					updateViewModel(mappedItem, item, options, parentName, mappedRootObject, fullPropertyName, parent);

					var index = ignorableIndexOf(ko.utils.unwrapObservable(rootObject), item, ignoreIndexOf);
					newContents[index] = mappedItem;
					ignoreIndexOf[index] = true;
					break;
				case "deleted":
					mappedItem = getItemByKey(mappedRootObject, key.value, keyCallback);
					break;
				}

				changes.push({
					event: key.status,
					item: mappedItem
				});
			}

			mappedRootObject(newContents);

			if (options[parentName] && options[parentName].arrayChanged) {
				ko.utils.arrayForEach(changes, function (change) {
					options[parentName].arrayChanged(change.event, change.item);
				});
			}
		}

		return mappedRootObject;
	}

	function ignorableIndexOf(array, item, ignoreIndices) {
		for (var i = 0, j = array.length; i < j; i++) {
			if (ignoreIndices[i] === true) continue;
			if (array[i] === item) return i;
		}
		return null;
	}

	function mapKey(item, callback) {
		var mappedItem;
		if (callback) mappedItem = callback(item);
		if (exports.getType(mappedItem) === "undefined") mappedItem = item;

		return ko.utils.unwrapObservable(mappedItem);
	}

	function getItemByKey(array, key, callback) {
		array = ko.utils.unwrapObservable(array);
		for (var i = 0, j = array.length; i < j; i++) {
			var item = array[i];
			if (mapKey(item, callback) === key) return item;
		}

		throw new Error("When calling ko.update*, the key '" + key + "' was not found!");
	}

	function filterArrayByKey(array, callback) {
		return ko.utils.arrayMap(ko.utils.unwrapObservable(array), function (item) {
			if (callback) {
				return mapKey(item, callback);
			} else {
				return item;
			}
		});
	}

	function visitPropertiesOrArrayEntries(rootObject, visitorCallback) {
		if (exports.getType(rootObject) === "array") {
			for (var i = 0; i < rootObject.length; i++)
			visitorCallback(i);
		} else {
			for (var propertyName in rootObject)
			visitorCallback(propertyName);
		}
	};

	function canHaveProperties(object) {
		var type = exports.getType(object);
		return ((type === "object") || (type === "array")) && (object !== null);
	}

	// Based on the parentName, this creates a fully classified name of a property

	function getPropertyName(parentName, parent, indexer) {
		var propertyName = parentName || "";
		if (exports.getType(parent) === "array") {
			if (parentName) {
				propertyName += "[" + indexer + "]";
			}
		} else {
			if (parentName) {
				propertyName += ".";
			}
			propertyName += indexer;
		}
		return propertyName;
	}

	exports.visitModel = function (rootObject, callback, options) {
		options = options || {};
		options.visitedObjects = options.visitedObjects || new objectLookup();

		var mappedRootObject;
		var unwrappedRootObject = ko.utils.unwrapObservable(rootObject);

		if (!canHaveProperties(unwrappedRootObject)) {
			return callback(rootObject, options.parentName);
		} else {
			options = fillOptions(options, unwrappedRootObject[mappingProperty]);

			// Only do a callback, but ignore the results
			callback(rootObject, options.parentName);
			mappedRootObject = exports.getType(unwrappedRootObject) === "array" ? [] : {};
		}

		options.visitedObjects.save(rootObject, mappedRootObject);

		var parentName = options.parentName;
		visitPropertiesOrArrayEntries(unwrappedRootObject, function (indexer) {
			if (options.ignore && ko.utils.arrayIndexOf(options.ignore, indexer) != -1) return;

			var propertyValue = unwrappedRootObject[indexer];
			options.parentName = getPropertyName(parentName, unwrappedRootObject, indexer);

			// If we don't want to explicitly copy the unmapped property...
			if (ko.utils.arrayIndexOf(options.copy, indexer) === -1) {
				// ...find out if it's a property we want to explicitly include
				if (ko.utils.arrayIndexOf(options.include, indexer) === -1) {
					// The mapped properties object contains all the properties that were part of the original object.
					// If a property does not exist, and it is not because it is part of an array (e.g. "myProp[3]"), then it should not be unmapped.
				    if (unwrappedRootObject[mappingProperty]
				        && unwrappedRootObject[mappingProperty].mappedProperties && !unwrappedRootObject[mappingProperty].mappedProperties[indexer]
				        && unwrappedRootObject[mappingProperty].copiedProperties && !unwrappedRootObject[mappingProperty].copiedProperties[indexer]
				        && !(exports.getType(unwrappedRootObject) === "array")) {
						return;
					}
				}
			}

			var outputProperty;
			switch (exports.getType(ko.utils.unwrapObservable(propertyValue))) {
			case "object":
			case "array":
			case "undefined":
				var previouslyMappedValue = options.visitedObjects.get(propertyValue);
				mappedRootObject[indexer] = (exports.getType(previouslyMappedValue) !== "undefined") ? previouslyMappedValue : exports.visitModel(propertyValue, callback, options);
				break;
			default:
				mappedRootObject[indexer] = callback(propertyValue, options.parentName);
			}
		});

		return mappedRootObject;
	}

	function simpleObjectLookup() {
		var keys = [];
		var values = [];
		this.save = function (key, value) {
			var existingIndex = ko.utils.arrayIndexOf(keys, key);
			if (existingIndex >= 0) values[existingIndex] = value;
			else {
				keys.push(key);
				values.push(value);
			}
		};
		this.get = function (key) {
			var existingIndex = ko.utils.arrayIndexOf(keys, key);
			var value = (existingIndex >= 0) ? values[existingIndex] : undefined;
			return value;
		};
	};
	
	function objectLookup() {
		var buckets = {};
		
		var findBucket = function(key) {
			var bucketKey;
			try {
				bucketKey = key;//JSON.stringify(key);
			}
			catch (e) {
				bucketKey = "$$$";
			}

			var bucket = buckets[bucketKey];
			if (bucket === undefined) {
				bucket = new simpleObjectLookup();
				buckets[bucketKey] = bucket;
			}
			return bucket;
		};
		
		this.save = function (key, value) {
			findBucket(key).save(key, value);
		};
		this.get = function (key) {
			return findBucket(key).get(key);
		};
	};
}));

/*

 JS Signals <http://millermedeiros.github.com/js-signals/>
 Released under the MIT license
 Author: Miller Medeiros
 Version: 1.0.0 - Build: 268 (2012/11/29 05:48 PM)
*/
(function(i){function h(a,b,c,d,e){this._listener=b;this._isOnce=c;this.context=d;this._signal=a;this._priority=e||0}function g(a,b){if(typeof a!=="function")throw Error("listener is a required param of {fn}() and should be a Function.".replace("{fn}",b));}function e(){this._bindings=[];this._prevParams=null;var a=this;this.dispatch=function(){e.prototype.dispatch.apply(a,arguments)}}h.prototype={active:!0,params:null,execute:function(a){var b;this.active&&this._listener&&(a=this.params?this.params.concat(a):
a,b=this._listener.apply(this.context,a),this._isOnce&&this.detach());return b},detach:function(){return this.isBound()?this._signal.remove(this._listener,this.context):null},isBound:function(){return!!this._signal&&!!this._listener},isOnce:function(){return this._isOnce},getListener:function(){return this._listener},getSignal:function(){return this._signal},_destroy:function(){delete this._signal;delete this._listener;delete this.context},toString:function(){return"[SignalBinding isOnce:"+this._isOnce+
", isBound:"+this.isBound()+", active:"+this.active+"]"}};e.prototype={VERSION:"1.0.0",memorize:!1,_shouldPropagate:!0,active:!0,_registerListener:function(a,b,c,d){var e=this._indexOfListener(a,c);if(e!==-1){if(a=this._bindings[e],a.isOnce()!==b)throw Error("You cannot add"+(b?"":"Once")+"() then add"+(!b?"":"Once")+"() the same listener without removing the relationship first.");}else a=new h(this,a,b,c,d),this._addBinding(a);this.memorize&&this._prevParams&&a.execute(this._prevParams);return a},
_addBinding:function(a){var b=this._bindings.length;do--b;while(this._bindings[b]&&a._priority<=this._bindings[b]._priority);this._bindings.splice(b+1,0,a)},_indexOfListener:function(a,b){for(var c=this._bindings.length,d;c--;)if(d=this._bindings[c],d._listener===a&&d.context===b)return c;return-1},has:function(a,b){return this._indexOfListener(a,b)!==-1},add:function(a,b,c){g(a,"add");return this._registerListener(a,!1,b,c)},addOnce:function(a,b,c){g(a,"addOnce");return this._registerListener(a,
!0,b,c)},remove:function(a,b){g(a,"remove");var c=this._indexOfListener(a,b);c!==-1&&(this._bindings[c]._destroy(),this._bindings.splice(c,1));return a},removeAll:function(){for(var a=this._bindings.length;a--;)this._bindings[a]._destroy();this._bindings.length=0},getNumListeners:function(){return this._bindings.length},halt:function(){this._shouldPropagate=!1},dispatch:function(a){if(this.active){var b=Array.prototype.slice.call(arguments),c=this._bindings.length,d;if(this.memorize)this._prevParams=
b;if(c){d=this._bindings.slice();this._shouldPropagate=!0;do c--;while(d[c]&&this._shouldPropagate&&d[c].execute(b)!==!1)}}},forget:function(){this._prevParams=null},dispose:function(){this.removeAll();delete this._bindings;delete this._prevParams},toString:function(){return"[Signal active:"+this.active+" numListeners:"+this.getNumListeners()+"]"}};var f=e;f.Signal=e;typeof define==="function"&&define.amd?define('signals',[],function(){return f}):typeof module!=="undefined"&&module.exports?module.exports=f:i.signals=
f})(this);
/** @license
 * crossroads <http://millermedeiros.github.com/crossroads.js/>
 * Author: Miller Medeiros | MIT License
 * v0.12.2 (2015/07/31 18:37)
 */
;(function(){var a=function(a){function e(a,b){if(a.indexOf)return a.indexOf(b);var c=a.length;while(c--)if(a[c]===b)return c;return-1}function f(a,b){var c=e(a,b);c!==-1&&a.splice(c,1)}function g(a,b){return"[object "+b+"]"===Object.prototype.toString.call(a)}function h(a){return g(a,"RegExp")}function i(a){return g(a,"Array")}function j(a){return typeof a=="function"}function k(a){var b;return a===null||a==="null"?b=null:a==="true"?b=!0:a==="false"?b=!1:a===d||a==="undefined"?b=d:a===""||isNaN(a)?b=a:b=parseFloat(a),b}function l(a){var b=a.length,c=[];while(b--)c[b]=k(a[b]);return c}function m(a,b){var c=(a||"").replace("?","").split("&"),d=/([^=]+)=(.+)/,e=-1,f={},g,h,j,l;while(h=c[++e])g=h.indexOf("="),l=h.substring(0,g),j=decodeURIComponent(h.substring(g+1)),b!==!1&&(j=k(j)),l in f?i(f[l])?f[l].push(j):f[l]=[f[l],j]:f[l]=j;return f}function n(){this.bypassed=new a.Signal,this.routed=new a.Signal,this._routes=[],this._prevRoutes=[],this._piped=[],this.resetState()}function o(b,c,d,e){var f=h(b),g=e.patternLexer;this._router=e,this._pattern=b,this._paramsIds=f?null:g.getParamIds(b),this._optionalParamsIds=f?null:g.getOptionalParamsIds(b),this._matchRegexp=f?b:g.compilePattern(b,e.ignoreCase),this.matched=new a.Signal,this.switched=new a.Signal,c&&this.matched.add(c),this._priority=d||0}var b,c,d;return c=/t(.+)?/.exec("t")[1]==="",n.prototype={greedy:!1,greedyEnabled:!0,ignoreCase:!0,ignoreState:!1,shouldTypecast:!1,normalizeFn:null,resetState:function(){this._prevRoutes.length=0,this._prevMatchedRequest=null,this._prevBypassedRequest=null},create:function(){return new n},addRoute:function(a,b,c){var d=new o(a,b,c,this);return this._sortedInsert(d),d},removeRoute:function(a){f(this._routes,a),a._destroy()},removeAllRoutes:function(){var a=this.getNumRoutes();while(a--)this._routes[a]._destroy();this._routes.length=0},parse:function(a,b){a=a||"",b=b||[];if(!this.ignoreState&&(a===this._prevMatchedRequest||a===this._prevBypassedRequest))return;var c=this._getMatchedRoutes(a),d=0,e=c.length,f;if(e){this._prevMatchedRequest=a,this._notifyPrevRoutes(c,a),this._prevRoutes=c;while(d<e)f=c[d],f.route.matched.dispatch.apply(f.route.matched,b.concat(f.params)),f.isFirst=!d,this.routed.dispatch.apply(this.routed,b.concat([a,f])),d+=1}else this._prevBypassedRequest=a,this.bypassed.dispatch.apply(this.bypassed,b.concat([a]));this._pipeParse(a,b)},_notifyPrevRoutes:function(a,b){var c=0,d;while(d=this._prevRoutes[c++])d.route.switched&&this._didSwitch(d.route,a)&&d.route.switched.dispatch(b)},_didSwitch:function(a,b){var c,d=0;while(c=b[d++])if(c.route===a)return!1;return!0},_pipeParse:function(a,b){var c=0,d;while(d=this._piped[c++])d.parse(a,b)},getNumRoutes:function(){return this._routes.length},_sortedInsert:function(a){var b=this._routes,c=b.length;do--c;while(b[c]&&a._priority<=b[c]._priority);b.splice(c+1,0,a)},_getMatchedRoutes:function(a){var b=[],c=this._routes,d=c.length,e;while(e=c[--d]){(!b.length||this.greedy||e.greedy)&&e.match(a)&&b.push({route:e,params:e._getParamsArray(a)});if(!this.greedyEnabled&&b.length)break}return b},pipe:function(a){this._piped.push(a)},unpipe:function(a){f(this._piped,a)},toString:function(){return"[crossroads numRoutes:"+this.getNumRoutes()+"]"}},b=new n,b.VERSION="0.12.2",b.NORM_AS_ARRAY=function(a,b){return[b.vals_]},b.NORM_AS_OBJECT=function(a,b){return[b]},o.prototype={greedy:!1,rules:void 0,match:function(a){return a=a||"",this._matchRegexp.test(a)&&this._validateParams(a)},_validateParams:function(a){var b=this.rules,c=this._getParamsObject(a),d;for(d in b)if(d!=="normalize_"&&b.hasOwnProperty(d)&&!this._isValidParam(a,d,c))return!1;return!0},_isValidParam:function(a,b,c){var d=this.rules[b],f=c[b],g=!1,k=b.indexOf("?")===0;return f==null&&this._optionalParamsIds&&e(this._optionalParamsIds,b)!==-1?g=!0:h(d)?(k&&(f=c[b+"_"]),g=d.test(f)):i(d)?(k&&(f=c[b+"_"]),g=this._isValidArrayRule(d,f)):j(d)&&(g=d(f,a,c)),g},_isValidArrayRule:function(a,b){if(!this._router.ignoreCase)return e(a,b)!==-1;typeof b=="string"&&(b=b.toLowerCase());var c=a.length,d,f;while(c--){d=a[c],f=typeof d=="string"?d.toLowerCase():d;if(f===b)return!0}return!1},_getParamsObject:function(a){var b=this._router.shouldTypecast,d=this._router.patternLexer.getParamValues(a,this._matchRegexp,b),f={},g=d.length,h,i;while(g--)i=d[g],this._paramsIds&&(h=this._paramsIds[g],h.indexOf("?")===0&&i&&(f[h+"_"]=i,i=m(i,b),d[g]=i),c&&i===""&&e(this._optionalParamsIds,h)!==-1&&(i=void 0,d[g]=i),f[h]=i),f[g]=i;return f.request_=b?k(a):a,f.vals_=d,f},_getParamsArray:function(a){var b=this.rules?this.rules.normalize_:null,c;return b=b||this._router.normalizeFn,b&&j(b)?c=b(a,this._getParamsObject(a)):c=this._getParamsObject(a).vals_,c},interpolate:function(a){var b=this._router.patternLexer.interpolate(this._pattern,a);if(!this._validateParams(b))throw new Error("Generated string doesn't validate against `Route.rules`.");return b},dispose:function(){this._router.removeRoute(this)},_destroy:function(){this.matched.dispose(),this.switched.dispose(),this.matched=this.switched=this._pattern=this._matchRegexp=null},toString:function(){return'[Route pattern:"'+this._pattern+'", numListeners:'+this.matched.getNumListeners()+"]"}},n.prototype.patternLexer=function(){function k(){var a,b;for(a in e)e.hasOwnProperty(a)&&(b=e[a],b.id="__CR_"+a+"__",b.save="save"in b?b.save.replace("{{id}}",b.id):b.id,b.rRestore=new RegExp(b.id,"g"))}function m(a,b){var c=[],d;a.lastIndex=0;while(d=a.exec(b))c.push(d[1]);return c}function n(a){return m(d,a)}function o(a){return m(e.OP.rgx,a)}function p(d,e){return d=d||"",d&&(j===f?d=d.replace(b,""):j===h&&(d=d.replace(c,"")),d=q(d,"rgx","save"),d=d.replace(a,"\\$&"),d=q(d,"rRestore","res"),j===f&&(d="\\/?"+d)),j!==g&&(d+="\\/?"),new RegExp("^"+d+"$",e?"i":"")}function q(a,b,c){var d,f;for(f in e)e.hasOwnProperty(f)&&(d=e[f],a=a.replace(d[b],d[c]));return a}function r(a,b,c){var d=b.exec(a);return d&&(d.shift(),c&&(d=l(d))),d}function s(a,b){b=b||{};if(typeof a!="string")throw new Error("Route pattern should be a string.");var c=function(a,c){var d;c=c.substr(0,1)==="?"?c.substr(1):c;if(b[c]!=null){if(typeof b[c]=="object"){var e=[],f;for(var g in b[c]){f=b[c][g];if(i(f))for(var h in f)g.slice(-2)=="[]"?e.push(encodeURI(g.slice(0,-2))+"[]="+encodeURI(f[h])):e.push(encodeURI(g+"="+f[h]));else e.push(encodeURI(g+"="+f))}d="?"+e.join("&")}else d=String(b[c]);if(a.indexOf("*")===-1&&d.indexOf("/")!==-1)throw new Error('Invalid value "'+d+'" for segment "'+a+'".')}else{if(a.indexOf("{")!==-1)throw new Error("The segment "+a+" is required.");d=""}return d};return e.OS.trail||(e.OS.trail=new RegExp("(?:"+e.OS.id+")+$")),a.replace(e.OS.rgx,e.OS.save).replace(d,c).replace(e.OS.trail,"").replace(e.OS.rRestore,"/")}var a=/[\\.+*?\^$\[\](){}\/'#]/g,b=/^\/|\/$/g,c=/\/$/g,d=/(?:\{|:)([^}:]+)(?:\}|:)/g,e={OS:{rgx:/([:}]|\w(?=\/))\/?(:|(?:\{\?))/g,save:"$1{{id}}$2",res:"\\/?"},RS:{rgx:/([:}])\/?(\{)/g,save:"$1{{id}}$2",res:"\\/"},RQ:{rgx:/\{\?([^}]+)\}/g,res:"\\?([^#]+)"},OQ:{rgx:/:\?([^:]+):/g,res:"(?:\\?([^#]*))?"},OR:{rgx:/:([^:]+)\*:/g,res:"(.*)?"},RR:{rgx:/\{([^}]+)\*\}/g,res:"(.+)"},RP:{rgx:/\{([^}]+)\}/g,res:"([^\\/?]+)"},OP:{rgx:/:([^:]+):/g,res:"([^\\/?]+)?/?"}},f=1,g=2,h=3,j=f;return k(),{strict:function(){j=g},loose:function(){j=f},legacy:function(){j=h},getParamIds:n,getOptionalParamsIds:o,getParamValues:r,compilePattern:p,interpolate:s}}(),b};typeof define=="function"&&define.amd?define('crossroads',["signals"],a):typeof module!="undefined"&&module.exports?module.exports=a(require("signals")):window.crossroads=a(window.signals)})();
/*!
 * Hasher <http://github.com/millermedeiros/hasher>
 * @author Miller Medeiros
 * @version 1.2.0 (2013/11/11 03:18 PM)
 * Released under the MIT License
 */
(function(){var a=function(b){var c=(function(k){var p=25,r=k.document,n=k.history,x=b.Signal,f,v,m,F,d,D,t=/#(.*)$/,j=/(\?.*)|(\#.*)/,g=/^\#/,i=(!+"\v1"),B=("onhashchange" in k)&&r.documentMode!==7,e=i&&!B,s=(location.protocol==="file:");function o(G){return String(G||"").replace(/\W/g,"\\$&")}function u(H){if(!H){return""}var G=new RegExp("^"+o(f.prependHash)+"|"+o(f.appendHash)+"$","g");return H.replace(G,"")}function E(){var G=t.exec(f.getURL());var I=(G&&G[1])||"";try{return f.raw?I:decodeURIComponent(I)}catch(H){return I}}function A(){return(d)?d.contentWindow.frameHash:null}function z(){d=r.createElement("iframe");d.src="about:blank";d.style.display="none";r.body.appendChild(d)}function h(){if(d&&v!==A()){var G=d.contentWindow.document;G.open();G.write("<html><head><title>"+r.title+'</title><script type="text/javascript">var frameHash="'+v+'";<\/script></head><body>&nbsp;</body></html>');G.close()}}function l(G,H){if(v!==G){var I=v;v=G;if(e){if(!H){h()}else{d.contentWindow.frameHash=G}}f.changed.dispatch(u(G),u(I))}}if(e){D=function(){var H=E(),G=A();if(G!==v&&G!==H){f.setHash(u(G))}else{if(H!==v){l(H)}}}}else{D=function(){var G=E();if(G!==v){l(G)}}}function C(I,G,H){if(I.addEventListener){I.addEventListener(G,H,false)}else{if(I.attachEvent){I.attachEvent("on"+G,H)}}}function y(I,G,H){if(I.removeEventListener){I.removeEventListener(G,H,false)}else{if(I.detachEvent){I.detachEvent("on"+G,H)}}}function q(H){H=Array.prototype.slice.call(arguments);var G=H.join(f.separator);G=G?f.prependHash+G.replace(g,"")+f.appendHash:G;return G}function w(G){G=encodeURI(G);if(i&&s){G=G.replace(/\?/,"%3F")}return G}f={VERSION:"1.2.0",raw:false,appendHash:"",prependHash:"/",separator:"/",changed:new x(),stopped:new x(),initialized:new x(),init:function(){if(F){return}v=E();if(B){C(k,"hashchange",D)}else{if(e){if(!d){z()}h()}m=setInterval(D,p)}F=true;f.initialized.dispatch(u(v))},stop:function(){if(!F){return}if(B){y(k,"hashchange",D)}else{clearInterval(m);m=null}F=false;f.stopped.dispatch(u(v))},isActive:function(){return F},getURL:function(){return k.location.href},getBaseURL:function(){return f.getURL().replace(j,"")},setHash:function(G){G=q.apply(null,arguments);if(G!==v){l(G);if(G===v){if(!f.raw){G=w(G)}k.location.hash="#"+G}}},replaceHash:function(G){G=q.apply(null,arguments);if(G!==v){l(G,true);if(G===v){if(!f.raw){G=w(G)}k.location.replace("#"+G)}}},getHash:function(){return u(v)},getHashAsArray:function(){return f.getHash().split(f.separator)},dispose:function(){f.stop();f.initialized.dispose();f.stopped.dispose();f.changed.dispose();d=f=k.hasher=null},toString:function(){return'[hasher version="'+f.VERSION+'" hash="'+f.getHash()+'"]'}};f.initialized.memorize=true;return f}(window));return c};if(typeof define==="function"&&define.amd){define('hasher',["signals"],a)}else{if(typeof exports==="object"){module.exports=a(require("signals"))}else{window.hasher=a(window.signals)}}}());
!function(e){if("object"==typeof exports&&"undefined"!=typeof module)module.exports=e();else if("function"==typeof define&&define.amd)define('stacktrace',[],e);else{var t;t="undefined"!=typeof window?window:"undefined"!=typeof global?global:"undefined"!=typeof self?self:this,t.StackTrace=e()}}(function(){var e;return function t(e,n,r){function o(a,s){if(!n[a]){if(!e[a]){var u="function"==typeof require&&require;if(!s&&u)return u(a,!0);if(i)return i(a,!0);var c=new Error("Cannot find module '"+a+"'");throw c.code="MODULE_NOT_FOUND",c}var l=n[a]={exports:{}};e[a][0].call(l.exports,function(t){var n=e[a][1][t];return o(n?n:t)},l,l.exports,t,e,n,r)}return n[a].exports}for(var i="function"==typeof require&&require,a=0;a<r.length;a++)o(r[a]);return o}({1:[function(t,n,r){!function(o,i){"function"==typeof e&&e.amd?e("error-stack-parser",["stackframe"],i):"object"==typeof r?n.exports=i(t("stackframe")):o.ErrorStackParser=i(o.StackFrame)}(this,function(e){function t(e,t,n){if("function"==typeof Array.prototype.map)return e.map(t,n);for(var r=new Array(e.length),o=0;o<e.length;o++)r[o]=t.call(n,e[o]);return r}function n(e,t,n){if("function"==typeof Array.prototype.filter)return e.filter(t,n);for(var r=[],o=0;o<e.length;o++)t.call(n,e[o])&&r.push(e[o]);return r}function r(e,t){if("function"==typeof Array.prototype.indexOf)return e.indexOf(t);for(var n=0;n<e.length;n++)if(e[n]===t)return n;return-1}var o=/(^|@)\S+\:\d+/,i=/^\s*at .*(\S+\:\d+|\(native\))/m,a=/^(eval@)?(\[native code\])?$/;return{parse:function(e){if("undefined"!=typeof e.stacktrace||"undefined"!=typeof e["opera#sourceloc"])return this.parseOpera(e);if(e.stack&&e.stack.match(i))return this.parseV8OrIE(e);if(e.stack)return this.parseFFOrSafari(e);throw new Error("Cannot parse given Error object")},extractLocation:function(e){if(-1===e.indexOf(":"))return[e];var t=/(.+?)(?:\:(\d+))?(?:\:(\d+))?$/,n=t.exec(e.replace(/[\(\)]/g,""));return[n[1],n[2]||void 0,n[3]||void 0]},parseV8OrIE:function(o){var a=n(o.stack.split("\n"),function(e){return!!e.match(i)},this);return t(a,function(t){t.indexOf("(eval ")>-1&&(t=t.replace(/eval code/g,"eval").replace(/(\(eval at [^\()]*)|(\)\,.*$)/g,""));var n=t.replace(/^\s+/,"").replace(/\(eval code/g,"(").split(/\s+/).slice(1),o=this.extractLocation(n.pop()),i=n.join(" ")||void 0,a=r(["eval","<anonymous>"],o[0])>-1?void 0:o[0];return new e(i,void 0,a,o[1],o[2],t)},this)},parseFFOrSafari:function(r){var o=n(r.stack.split("\n"),function(e){return!e.match(a)},this);return t(o,function(t){if(t.indexOf(" > eval")>-1&&(t=t.replace(/ line (\d+)(?: > eval line \d+)* > eval\:\d+\:\d+/g,":$1")),-1===t.indexOf("@")&&-1===t.indexOf(":"))return new e(t);var n=t.split("@"),r=this.extractLocation(n.pop()),o=n.join("@")||void 0;return new e(o,void 0,r[0],r[1],r[2],t)},this)},parseOpera:function(e){return!e.stacktrace||e.message.indexOf("\n")>-1&&e.message.split("\n").length>e.stacktrace.split("\n").length?this.parseOpera9(e):e.stack?this.parseOpera11(e):this.parseOpera10(e)},parseOpera9:function(t){for(var n=/Line (\d+).*script (?:in )?(\S+)/i,r=t.message.split("\n"),o=[],i=2,a=r.length;a>i;i+=2){var s=n.exec(r[i]);s&&o.push(new e(void 0,void 0,s[2],s[1],void 0,r[i]))}return o},parseOpera10:function(t){for(var n=/Line (\d+).*script (?:in )?(\S+)(?:: In function (\S+))?$/i,r=t.stacktrace.split("\n"),o=[],i=0,a=r.length;a>i;i+=2){var s=n.exec(r[i]);s&&o.push(new e(s[3]||void 0,void 0,s[2],s[1],void 0,r[i]))}return o},parseOpera11:function(r){var i=n(r.stack.split("\n"),function(e){return!!e.match(o)&&!e.match(/^Error created at/)},this);return t(i,function(t){var n,r=t.split("@"),o=this.extractLocation(r.pop()),i=r.shift()||"",a=i.replace(/<anonymous function(: (\w+))?>/,"$2").replace(/\([^\)]*\)/g,"")||void 0;i.match(/\(([^\)]*)\)/)&&(n=i.replace(/^[^\(]+\(([^\)]*)\)$/,"$1"));var s=void 0===n||"[arguments not available]"===n?void 0:n.split(",");return new e(a,s,o[0],o[1],o[2],t)},this)}}})},{stackframe:14}],2:[function(t,n,r){(function(r,o){(function(){function i(e){return"function"==typeof e||"object"==typeof e&&null!==e}function a(e){return"function"==typeof e}function s(e){Z=e}function u(e){V=e}function c(){return function(){r.nextTick(g)}}function l(){return function(){z(g)}}function f(){var e=0,t=new Q(g),n=document.createTextNode("");return t.observe(n,{characterData:!0}),function(){n.data=e=++e%2}}function p(){var e=new MessageChannel;return e.port1.onmessage=g,function(){e.port2.postMessage(0)}}function h(){return function(){setTimeout(g,1)}}function g(){for(var e=0;W>e;e+=2){var t=ne[e],n=ne[e+1];t(n),ne[e]=void 0,ne[e+1]=void 0}W=0}function d(){try{var e=t,n=e("vertx");return z=n.runOnLoop||n.runOnContext,l()}catch(r){return h()}}function m(e,t){var n=this,r=n._state;if(r===ae&&!e||r===se&&!t)return this;var o=new this.constructor(v),i=n._result;if(r){var a=arguments[r-1];V(function(){P(r,o,a,i)})}else j(n,o,e,t);return o}function y(e){var t=this;if(e&&"object"==typeof e&&e.constructor===t)return e;var n=new t(v);return E(n,e),n}function v(){}function _(){return new TypeError("You cannot resolve a promise with itself")}function w(){return new TypeError("A promises callback cannot return that same promise.")}function b(e){try{return e.then}catch(t){return ue.error=t,ue}}function A(e,t,n,r){try{e.call(t,n,r)}catch(o){return o}}function C(e,t,n){V(function(e){var r=!1,o=A(n,t,function(n){r||(r=!0,t!==n?E(e,n):N(e,n))},function(t){r||(r=!0,T(e,t))},"Settle: "+(e._label||" unknown promise"));!r&&o&&(r=!0,T(e,o))},e)}function O(e,t){t._state===ae?N(e,t._result):t._state===se?T(e,t._result):j(t,void 0,function(t){E(e,t)},function(t){T(e,t)})}function S(e,t,n){t.constructor===e.constructor&&n===re&&constructor.resolve===oe?O(e,t):n===ue?T(e,ue.error):void 0===n?N(e,t):a(n)?C(e,t,n):N(e,t)}function E(e,t){e===t?T(e,_()):i(t)?S(e,t,b(t)):N(e,t)}function L(e){e._onerror&&e._onerror(e._result),M(e)}function N(e,t){e._state===ie&&(e._result=t,e._state=ae,0!==e._subscribers.length&&V(M,e))}function T(e,t){e._state===ie&&(e._state=se,e._result=t,V(L,e))}function j(e,t,n,r){var o=e._subscribers,i=o.length;e._onerror=null,o[i]=t,o[i+ae]=n,o[i+se]=r,0===i&&e._state&&V(M,e)}function M(e){var t=e._subscribers,n=e._state;if(0!==t.length){for(var r,o,i=e._result,a=0;a<t.length;a+=3)r=t[a],o=t[a+n],r?P(n,r,o,i):o(i);e._subscribers.length=0}}function k(){this.error=null}function x(e,t){try{return e(t)}catch(n){return ce.error=n,ce}}function P(e,t,n,r){var o,i,s,u,c=a(n);if(c){if(o=x(n,r),o===ce?(u=!0,i=o.error,o=null):s=!0,t===o)return void T(t,w())}else o=r,s=!0;t._state!==ie||(c&&s?E(t,o):u?T(t,i):e===ae?N(t,o):e===se&&T(t,o))}function R(e,t){try{t(function(t){E(e,t)},function(t){T(e,t)})}catch(n){T(e,n)}}function F(e){return new de(this,e).promise}function U(e){function t(e){E(o,e)}function n(e){T(o,e)}var r=this,o=new r(v);if(!H(e))return T(o,new TypeError("You must pass an array to race.")),o;for(var i=e.length,a=0;o._state===ie&&i>a;a++)j(r.resolve(e[a]),void 0,t,n);return o}function G(e){var t=this,n=new t(v);return T(n,e),n}function $(){throw new TypeError("You must pass a resolver function as the first argument to the promise constructor")}function D(){throw new TypeError("Failed to construct 'Promise': Please use the 'new' operator, this object constructor cannot be called as a function.")}function B(e){this._id=he++,this._state=void 0,this._result=void 0,this._subscribers=[],v!==e&&("function"!=typeof e&&$(),this instanceof B?R(this,e):D())}function J(e,t){this._instanceConstructor=e,this.promise=new e(v),Array.isArray(t)?(this._input=t,this.length=t.length,this._remaining=t.length,this._result=new Array(this.length),0===this.length?N(this.promise,this._result):(this.length=this.length||0,this._enumerate(),0===this._remaining&&N(this.promise,this._result))):T(this.promise,this._validationError())}function q(){var e;if("undefined"!=typeof o)e=o;else if("undefined"!=typeof self)e=self;else try{e=Function("return this")()}catch(t){throw new Error("polyfill failed because global object is unavailable in this environment")}var n=e.Promise;(!n||"[object Promise]"!==Object.prototype.toString.call(n.resolve())||n.cast)&&(e.Promise=ge)}var I;I=Array.isArray?Array.isArray:function(e){return"[object Array]"===Object.prototype.toString.call(e)};var z,Z,Y,H=I,W=0,V=function(e,t){ne[W]=e,ne[W+1]=t,W+=2,2===W&&(Z?Z(g):Y())},X="undefined"!=typeof window?window:void 0,K=X||{},Q=K.MutationObserver||K.WebKitMutationObserver,ee="undefined"!=typeof r&&"[object process]"==={}.toString.call(r),te="undefined"!=typeof Uint8ClampedArray&&"undefined"!=typeof importScripts&&"undefined"!=typeof MessageChannel,ne=new Array(1e3);Y=ee?c():Q?f():te?p():void 0===X&&"function"==typeof t?d():h();var re=m,oe=y,ie=void 0,ae=1,se=2,ue=new k,ce=new k,le=F,fe=U,pe=G,he=0,ge=B;B.all=le,B.race=fe,B.resolve=oe,B.reject=pe,B._setScheduler=s,B._setAsap=u,B._asap=V,B.prototype={constructor:B,then:re,"catch":function(e){return this.then(null,e)}};var de=J;J.prototype._validationError=function(){return new Error("Array Methods must be provided an Array")},J.prototype._enumerate=function(){for(var e=this.length,t=this._input,n=0;this._state===ie&&e>n;n++)this._eachEntry(t[n],n)},J.prototype._eachEntry=function(e,t){var n=this._instanceConstructor,r=n.resolve;if(r===oe){var o=b(e);if(o===re&&e._state!==ie)this._settledAt(e._state,t,e._result);else if("function"!=typeof o)this._remaining--,this._result[t]=e;else if(n===ge){var i=new n(v);S(i,e,o),this._willSettleAt(i,t)}else this._willSettleAt(new n(function(t){t(e)}),t)}else this._willSettleAt(r(e),t)},J.prototype._settledAt=function(e,t,n){var r=this.promise;r._state===ie&&(this._remaining--,e===se?T(r,n):this._result[t]=n),0===this._remaining&&N(r,this._result)},J.prototype._willSettleAt=function(e,t){var n=this;j(e,void 0,function(e){n._settledAt(ae,t,e)},function(e){n._settledAt(se,t,e)})};var me=q,ye={Promise:ge,polyfill:me};"function"==typeof e&&e.amd?e(function(){return ye}):"undefined"!=typeof n&&n.exports?n.exports=ye:"undefined"!=typeof this&&(this.ES6Promise=ye),me()}).call(this)}).call(this,t("_process"),"undefined"!=typeof global?global:"undefined"!=typeof self?self:"undefined"!=typeof window?window:{})},{_process:4}],3:[function(t,n,r){(function(t){(function(){function o(e,t){function n(e){if(n[e]!==m)return n[e];var o;if("bug-string-char-index"==e)o="a"!="a"[0];else if("json"==e)o=n("json-stringify")&&n("json-parse");else{var a,s='{"a":[1,true,false,null,"\\u0000\\b\\n\\f\\r\\t"]}';if("json-stringify"==e){var u=t.stringify,l="function"==typeof u&&_;if(l){(a=function(){return 1}).toJSON=a;try{l="0"===u(0)&&"0"===u(new r)&&'""'==u(new i)&&u(v)===m&&u(m)===m&&u()===m&&"1"===u(a)&&"[1]"==u([a])&&"[null]"==u([m])&&"null"==u(null)&&"[null,null,null]"==u([m,v,null])&&u({a:[a,!0,!1,null,"\x00\b\n\f\r	"]})==s&&"1"===u(null,a)&&"[\n 1,\n 2\n]"==u([1,2],null,1)&&'"-271821-04-20T00:00:00.000Z"'==u(new c(-864e13))&&'"+275760-09-13T00:00:00.000Z"'==u(new c(864e13))&&'"-000001-01-01T00:00:00.000Z"'==u(new c(-621987552e5))&&'"1969-12-31T23:59:59.999Z"'==u(new c(-1))}catch(f){l=!1}}o=l}if("json-parse"==e){var p=t.parse;if("function"==typeof p)try{if(0===p("0")&&!p(!1)){a=p(s);var h=5==a.a.length&&1===a.a[0];if(h){try{h=!p('"	"')}catch(f){}if(h)try{h=1!==p("01")}catch(f){}if(h)try{h=1!==p("1.")}catch(f){}}}}catch(f){h=!1}o=h}}return n[e]=!!o}e||(e=u.Object()),t||(t=u.Object());var r=e.Number||u.Number,i=e.String||u.String,s=e.Object||u.Object,c=e.Date||u.Date,l=e.SyntaxError||u.SyntaxError,f=e.TypeError||u.TypeError,p=e.Math||u.Math,h=e.JSON||u.JSON;"object"==typeof h&&h&&(t.stringify=h.stringify,t.parse=h.parse);var g,d,m,y=s.prototype,v=y.toString,_=new c(-0xc782b5b800cec);try{_=-109252==_.getUTCFullYear()&&0===_.getUTCMonth()&&1===_.getUTCDate()&&10==_.getUTCHours()&&37==_.getUTCMinutes()&&6==_.getUTCSeconds()&&708==_.getUTCMilliseconds()}catch(w){}if(!n("json")){var b="[object Function]",A="[object Date]",C="[object Number]",O="[object String]",S="[object Array]",E="[object Boolean]",L=n("bug-string-char-index");if(!_)var N=p.floor,T=[0,31,59,90,120,151,181,212,243,273,304,334],j=function(e,t){return T[t]+365*(e-1970)+N((e-1969+(t=+(t>1)))/4)-N((e-1901+t)/100)+N((e-1601+t)/400)};if((g=y.hasOwnProperty)||(g=function(e){var t,n={};return(n.__proto__=null,n.__proto__={toString:1},n).toString!=v?g=function(e){var t=this.__proto__,n=e in(this.__proto__=null,this);return this.__proto__=t,n}:(t=n.constructor,g=function(e){var n=(this.constructor||t).prototype;return e in this&&!(e in n&&this[e]===n[e])}),n=null,g.call(this,e)}),d=function(e,t){var n,r,o,i=0;(n=function(){this.valueOf=0}).prototype.valueOf=0,r=new n;for(o in r)g.call(r,o)&&i++;return n=r=null,i?d=2==i?function(e,t){var n,r={},o=v.call(e)==b;for(n in e)o&&"prototype"==n||g.call(r,n)||!(r[n]=1)||!g.call(e,n)||t(n)}:function(e,t){var n,r,o=v.call(e)==b;for(n in e)o&&"prototype"==n||!g.call(e,n)||(r="constructor"===n)||t(n);(r||g.call(e,n="constructor"))&&t(n)}:(r=["valueOf","toString","toLocaleString","propertyIsEnumerable","isPrototypeOf","hasOwnProperty","constructor"],d=function(e,t){var n,o,i=v.call(e)==b,s=!i&&"function"!=typeof e.constructor&&a[typeof e.hasOwnProperty]&&e.hasOwnProperty||g;for(n in e)i&&"prototype"==n||!s.call(e,n)||t(n);for(o=r.length;n=r[--o];s.call(e,n)&&t(n));}),d(e,t)},!n("json-stringify")){var M={92:"\\\\",34:'\\"',8:"\\b",12:"\\f",10:"\\n",13:"\\r",9:"\\t"},k="000000",x=function(e,t){return(k+(t||0)).slice(-e)},P="\\u00",R=function(e){for(var t='"',n=0,r=e.length,o=!L||r>10,i=o&&(L?e.split(""):e);r>n;n++){var a=e.charCodeAt(n);switch(a){case 8:case 9:case 10:case 12:case 13:case 34:case 92:t+=M[a];break;default:if(32>a){t+=P+x(2,a.toString(16));break}t+=o?i[n]:e.charAt(n)}}return t+'"'},F=function(e,t,n,r,o,i,a){var s,u,c,l,p,h,y,_,w,b,L,T,M,k,P,U;try{s=t[e]}catch(G){}if("object"==typeof s&&s)if(u=v.call(s),u!=A||g.call(s,"toJSON"))"function"==typeof s.toJSON&&(u!=C&&u!=O&&u!=S||g.call(s,"toJSON"))&&(s=s.toJSON(e));else if(s>-1/0&&1/0>s){if(j){for(p=N(s/864e5),c=N(p/365.2425)+1970-1;j(c+1,0)<=p;c++);for(l=N((p-j(c,0))/30.42);j(c,l+1)<=p;l++);p=1+p-j(c,l),h=(s%864e5+864e5)%864e5,y=N(h/36e5)%24,_=N(h/6e4)%60,w=N(h/1e3)%60,b=h%1e3}else c=s.getUTCFullYear(),l=s.getUTCMonth(),p=s.getUTCDate(),y=s.getUTCHours(),_=s.getUTCMinutes(),w=s.getUTCSeconds(),b=s.getUTCMilliseconds();s=(0>=c||c>=1e4?(0>c?"-":"+")+x(6,0>c?-c:c):x(4,c))+"-"+x(2,l+1)+"-"+x(2,p)+"T"+x(2,y)+":"+x(2,_)+":"+x(2,w)+"."+x(3,b)+"Z"}else s=null;if(n&&(s=n.call(t,e,s)),null===s)return"null";if(u=v.call(s),u==E)return""+s;if(u==C)return s>-1/0&&1/0>s?""+s:"null";if(u==O)return R(""+s);if("object"==typeof s){for(k=a.length;k--;)if(a[k]===s)throw f();if(a.push(s),L=[],P=i,i+=o,u==S){for(M=0,k=s.length;k>M;M++)T=F(M,s,n,r,o,i,a),L.push(T===m?"null":T);U=L.length?o?"[\n"+i+L.join(",\n"+i)+"\n"+P+"]":"["+L.join(",")+"]":"[]"}else d(r||s,function(e){var t=F(e,s,n,r,o,i,a);t!==m&&L.push(R(e)+":"+(o?" ":"")+t)}),U=L.length?o?"{\n"+i+L.join(",\n"+i)+"\n"+P+"}":"{"+L.join(",")+"}":"{}";return a.pop(),U}};t.stringify=function(e,t,n){var r,o,i,s;if(a[typeof t]&&t)if((s=v.call(t))==b)o=t;else if(s==S){i={};for(var u,c=0,l=t.length;l>c;u=t[c++],s=v.call(u),(s==O||s==C)&&(i[u]=1));}if(n)if((s=v.call(n))==C){if((n-=n%1)>0)for(r="",n>10&&(n=10);r.length<n;r+=" ");}else s==O&&(r=n.length<=10?n:n.slice(0,10));return F("",(u={},u[""]=e,u),o,i,r,"",[])}}if(!n("json-parse")){var U,G,$=i.fromCharCode,D={92:"\\",34:'"',47:"/",98:"\b",116:"	",110:"\n",102:"\f",114:"\r"},B=function(){throw U=G=null,l()},J=function(){for(var e,t,n,r,o,i=G,a=i.length;a>U;)switch(o=i.charCodeAt(U)){case 9:case 10:case 13:case 32:U++;break;case 123:case 125:case 91:case 93:case 58:case 44:return e=L?i.charAt(U):i[U],U++,e;case 34:for(e="@",U++;a>U;)if(o=i.charCodeAt(U),32>o)B();else if(92==o)switch(o=i.charCodeAt(++U)){case 92:case 34:case 47:case 98:case 116:case 110:case 102:case 114:e+=D[o],U++;break;case 117:for(t=++U,n=U+4;n>U;U++)o=i.charCodeAt(U),o>=48&&57>=o||o>=97&&102>=o||o>=65&&70>=o||B();e+=$("0x"+i.slice(t,U));break;default:B()}else{if(34==o)break;for(o=i.charCodeAt(U),t=U;o>=32&&92!=o&&34!=o;)o=i.charCodeAt(++U);e+=i.slice(t,U)}if(34==i.charCodeAt(U))return U++,e;B();default:if(t=U,45==o&&(r=!0,o=i.charCodeAt(++U)),o>=48&&57>=o){for(48==o&&(o=i.charCodeAt(U+1),o>=48&&57>=o)&&B(),r=!1;a>U&&(o=i.charCodeAt(U),o>=48&&57>=o);U++);if(46==i.charCodeAt(U)){for(n=++U;a>n&&(o=i.charCodeAt(n),o>=48&&57>=o);n++);n==U&&B(),U=n}if(o=i.charCodeAt(U),101==o||69==o){for(o=i.charCodeAt(++U),(43==o||45==o)&&U++,n=U;a>n&&(o=i.charCodeAt(n),o>=48&&57>=o);n++);n==U&&B(),U=n}return+i.slice(t,U)}if(r&&B(),"true"==i.slice(U,U+4))return U+=4,!0;if("false"==i.slice(U,U+5))return U+=5,!1;if("null"==i.slice(U,U+4))return U+=4,null;B()}return"$"},q=function(e){var t,n;if("$"==e&&B(),"string"==typeof e){if("@"==(L?e.charAt(0):e[0]))return e.slice(1);if("["==e){for(t=[];e=J(),"]"!=e;n||(n=!0))n&&(","==e?(e=J(),"]"==e&&B()):B()),","==e&&B(),t.push(q(e));return t}if("{"==e){for(t={};e=J(),"}"!=e;n||(n=!0))n&&(","==e?(e=J(),"}"==e&&B()):B()),(","==e||"string"!=typeof e||"@"!=(L?e.charAt(0):e[0])||":"!=J())&&B(),t[e.slice(1)]=q(J());return t}B()}return e},I=function(e,t,n){var r=z(e,t,n);r===m?delete e[t]:e[t]=r},z=function(e,t,n){var r,o=e[t];if("object"==typeof o&&o)if(v.call(o)==S)for(r=o.length;r--;)I(o,r,n);else d(o,function(e){I(o,e,n)});return n.call(e,t,o)};t.parse=function(e,t){var n,r;return U=0,G=""+e,n=q(J()),"$"!=J()&&B(),U=G=null,t&&v.call(t)==b?z((r={},r[""]=n,r),"",t):n}}}return t.runInContext=o,t}var i="function"==typeof e&&e.amd,a={"function":!0,object:!0},s=a[typeof r]&&r&&!r.nodeType&&r,u=a[typeof window]&&window||this,c=s&&a[typeof n]&&n&&!n.nodeType&&"object"==typeof t&&t;if(!c||c.global!==c&&c.window!==c&&c.self!==c||(u=c),s&&!i)o(u,s);else{var l=u.JSON,f=u.JSON3,p=!1,h=o(u,u.JSON3={noConflict:function(){return p||(p=!0,u.JSON=l,u.JSON3=f,l=f=null),h}});u.JSON={parse:h.parse,stringify:h.stringify}}i&&e(function(){return h})}).call(this)}).call(this,"undefined"!=typeof global?global:"undefined"!=typeof self?self:"undefined"!=typeof window?window:{})},{}],4:[function(e,t,n){function r(e){if(c===setTimeout)return setTimeout(e,0);try{return c(e,0)}catch(t){try{return c.call(null,e,0)}catch(t){return c.call(this,e,0)}}}function o(e){if(l===clearTimeout)return clearTimeout(e);try{return l(e)}catch(t){try{return l.call(null,e)}catch(t){return l.call(this,e)}}}function i(){g&&p&&(g=!1,p.length?h=p.concat(h):d=-1,h.length&&a())}function a(){if(!g){var e=r(i);g=!0;for(var t=h.length;t;){for(p=h,h=[];++d<t;)p&&p[d].run();d=-1,t=h.length}p=null,g=!1,o(e)}}function s(e,t){this.fun=e,this.array=t}function u(){}var c,l,f=t.exports={};!function(){try{c=setTimeout}catch(e){c=function(){throw new Error("setTimeout is not defined")}}try{l=clearTimeout}catch(e){l=function(){throw new Error("clearTimeout is not defined")}}}();var p,h=[],g=!1,d=-1;f.nextTick=function(e){var t=new Array(arguments.length-1);if(arguments.length>1)for(var n=1;n<arguments.length;n++)t[n-1]=arguments[n];h.push(new s(e,t)),1!==h.length||g||r(a)},s.prototype.run=function(){this.fun.apply(null,this.array)},f.title="browser",f.browser=!0,f.env={},f.argv=[],f.version="",f.versions={},f.on=u,f.addListener=u,f.once=u,f.off=u,f.removeListener=u,f.removeAllListeners=u,f.emit=u,f.binding=function(e){throw new Error("process.binding is not supported")},f.cwd=function(){return"/"},f.chdir=function(e){throw new Error("process.chdir is not supported")},f.umask=function(){return 0}},{}],5:[function(e,t,n){function r(){this._array=[],this._set=Object.create(null)}var o=e("./util"),i=Object.prototype.hasOwnProperty;r.fromArray=function(e,t){for(var n=new r,o=0,i=e.length;i>o;o++)n.add(e[o],t);return n},r.prototype.size=function(){return Object.getOwnPropertyNames(this._set).length},r.prototype.add=function(e,t){var n=o.toSetString(e),r=i.call(this._set,n),a=this._array.length;(!r||t)&&this._array.push(e),r||(this._set[n]=a)},r.prototype.has=function(e){var t=o.toSetString(e);return i.call(this._set,t)},r.prototype.indexOf=function(e){var t=o.toSetString(e);if(i.call(this._set,t))return this._set[t];throw new Error('"'+e+'" is not in the set.')},r.prototype.at=function(e){if(e>=0&&e<this._array.length)return this._array[e];throw new Error("No element indexed by "+e)},r.prototype.toArray=function(){return this._array.slice()},n.ArraySet=r},{"./util":11}],6:[function(e,t,n){function r(e){return 0>e?(-e<<1)+1:(e<<1)+0}function o(e){var t=1===(1&e),n=e>>1;return t?-n:n}var i=e("./base64"),a=5,s=1<<a,u=s-1,c=s;n.encode=function(e){var t,n="",o=r(e);do t=o&u,o>>>=a,o>0&&(t|=c),n+=i.encode(t);while(o>0);return n},n.decode=function(e,t,n){var r,s,l=e.length,f=0,p=0;do{if(t>=l)throw new Error("Expected more digits in base 64 VLQ value.");if(s=i.decode(e.charCodeAt(t++)),-1===s)throw new Error("Invalid base64 digit: "+e.charAt(t-1));r=!!(s&c),s&=u,f+=s<<p,p+=a}while(r);n.value=o(f),n.rest=t}},{"./base64":7}],7:[function(e,t,n){var r="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/".split("");n.encode=function(e){if(e>=0&&e<r.length)return r[e];throw new TypeError("Must be between 0 and 63: "+e)},n.decode=function(e){var t=65,n=90,r=97,o=122,i=48,a=57,s=43,u=47,c=26,l=52;return e>=t&&n>=e?e-t:e>=r&&o>=e?e-r+c:e>=i&&a>=e?e-i+l:e==s?62:e==u?63:-1}},{}],8:[function(e,t,n){function r(e,t,o,i,a,s){var u=Math.floor((t-e)/2)+e,c=a(o,i[u],!0);return 0===c?u:c>0?t-u>1?r(u,t,o,i,a,s):s==n.LEAST_UPPER_BOUND?t<i.length?t:-1:u:u-e>1?r(e,u,o,i,a,s):s==n.LEAST_UPPER_BOUND?u:0>e?-1:e}n.GREATEST_LOWER_BOUND=1,n.LEAST_UPPER_BOUND=2,n.search=function(e,t,o,i){if(0===t.length)return-1;var a=r(-1,t.length,e,t,o,i||n.GREATEST_LOWER_BOUND);if(0>a)return-1;for(;a-1>=0&&0===o(t[a],t[a-1],!0);)--a;return a}},{}],9:[function(e,t,n){function r(e,t,n){var r=e[t];e[t]=e[n],e[n]=r}function o(e,t){return Math.round(e+Math.random()*(t-e))}function i(e,t,n,a){if(a>n){var s=o(n,a),u=n-1;r(e,s,a);for(var c=e[a],l=n;a>l;l++)t(e[l],c)<=0&&(u+=1,r(e,u,l));r(e,u+1,l);var f=u+1;i(e,t,n,f-1),i(e,t,f+1,a)}}n.quickSort=function(e,t){i(e,t,0,e.length-1)}},{}],10:[function(e,t,n){function r(e){var t=e;return"string"==typeof e&&(t=JSON.parse(e.replace(/^\)\]\}'/,""))),null!=t.sections?new a(t):new o(t)}function o(e){var t=e;"string"==typeof e&&(t=JSON.parse(e.replace(/^\)\]\}'/,"")));var n=s.getArg(t,"version"),r=s.getArg(t,"sources"),o=s.getArg(t,"names",[]),i=s.getArg(t,"sourceRoot",null),a=s.getArg(t,"sourcesContent",null),u=s.getArg(t,"mappings"),l=s.getArg(t,"file",null);if(n!=this._version)throw new Error("Unsupported version: "+n);r=r.map(String).map(s.normalize).map(function(e){return i&&s.isAbsolute(i)&&s.isAbsolute(e)?s.relative(i,e):e}),this._names=c.fromArray(o.map(String),!0),this._sources=c.fromArray(r,!0),this.sourceRoot=i,this.sourcesContent=a,this._mappings=u,this.file=l}function i(){this.generatedLine=0,this.generatedColumn=0,this.source=null,this.originalLine=null,this.originalColumn=null,this.name=null}function a(e){var t=e;"string"==typeof e&&(t=JSON.parse(e.replace(/^\)\]\}'/,"")));var n=s.getArg(t,"version"),o=s.getArg(t,"sections");if(n!=this._version)throw new Error("Unsupported version: "+n);this._sources=new c,this._names=new c;var i={line:-1,column:0};this._sections=o.map(function(e){if(e.url)throw new Error("Support for url field in sections not implemented.");var t=s.getArg(e,"offset"),n=s.getArg(t,"line"),o=s.getArg(t,"column");if(n<i.line||n===i.line&&o<i.column)throw new Error("Section offsets must be ordered and non-overlapping.");return i=t,{generatedOffset:{generatedLine:n+1,generatedColumn:o+1},consumer:new r(s.getArg(e,"map"))}})}var s=e("./util"),u=e("./binary-search"),c=e("./array-set").ArraySet,l=e("./base64-vlq"),f=e("./quick-sort").quickSort;r.fromSourceMap=function(e){return o.fromSourceMap(e)},r.prototype._version=3,r.prototype.__generatedMappings=null,Object.defineProperty(r.prototype,"_generatedMappings",{get:function(){return this.__generatedMappings||this._parseMappings(this._mappings,this.sourceRoot),this.__generatedMappings}}),r.prototype.__originalMappings=null,Object.defineProperty(r.prototype,"_originalMappings",{get:function(){return this.__originalMappings||this._parseMappings(this._mappings,this.sourceRoot),this.__originalMappings}}),r.prototype._charIsMappingSeparator=function(e,t){var n=e.charAt(t);return";"===n||","===n},r.prototype._parseMappings=function(e,t){throw new Error("Subclasses must implement _parseMappings")},r.GENERATED_ORDER=1,r.ORIGINAL_ORDER=2,r.GREATEST_LOWER_BOUND=1,r.LEAST_UPPER_BOUND=2,r.prototype.eachMapping=function(e,t,n){var o,i=t||null,a=n||r.GENERATED_ORDER;switch(a){case r.GENERATED_ORDER:o=this._generatedMappings;break;case r.ORIGINAL_ORDER:o=this._originalMappings;break;default:throw new Error("Unknown order of iteration.")}var u=this.sourceRoot;o.map(function(e){var t=null===e.source?null:this._sources.at(e.source);return null!=t&&null!=u&&(t=s.join(u,t)),{source:t,generatedLine:e.generatedLine,generatedColumn:e.generatedColumn,originalLine:e.originalLine,originalColumn:e.originalColumn,name:null===e.name?null:this._names.at(e.name)}},this).forEach(e,i)},r.prototype.allGeneratedPositionsFor=function(e){var t=s.getArg(e,"line"),n={source:s.getArg(e,"source"),originalLine:t,originalColumn:s.getArg(e,"column",0)};if(null!=this.sourceRoot&&(n.source=s.relative(this.sourceRoot,n.source)),!this._sources.has(n.source))return[];n.source=this._sources.indexOf(n.source);var r=[],o=this._findMapping(n,this._originalMappings,"originalLine","originalColumn",s.compareByOriginalPositions,u.LEAST_UPPER_BOUND);if(o>=0){var i=this._originalMappings[o];if(void 0===e.column)for(var a=i.originalLine;i&&i.originalLine===a;)r.push({line:s.getArg(i,"generatedLine",null),column:s.getArg(i,"generatedColumn",null),lastColumn:s.getArg(i,"lastGeneratedColumn",null)}),i=this._originalMappings[++o];else for(var c=i.originalColumn;i&&i.originalLine===t&&i.originalColumn==c;)r.push({line:s.getArg(i,"generatedLine",null),column:s.getArg(i,"generatedColumn",null),lastColumn:s.getArg(i,"lastGeneratedColumn",null)}),i=this._originalMappings[++o]}return r},n.SourceMapConsumer=r,o.prototype=Object.create(r.prototype),o.prototype.consumer=r,o.fromSourceMap=function(e){var t=Object.create(o.prototype),n=t._names=c.fromArray(e._names.toArray(),!0),r=t._sources=c.fromArray(e._sources.toArray(),!0);t.sourceRoot=e._sourceRoot,t.sourcesContent=e._generateSourcesContent(t._sources.toArray(),t.sourceRoot),t.file=e._file;for(var a=e._mappings.toArray().slice(),u=t.__generatedMappings=[],l=t.__originalMappings=[],p=0,h=a.length;h>p;p++){var g=a[p],d=new i;d.generatedLine=g.generatedLine,d.generatedColumn=g.generatedColumn,g.source&&(d.source=r.indexOf(g.source),d.originalLine=g.originalLine,d.originalColumn=g.originalColumn,g.name&&(d.name=n.indexOf(g.name)),l.push(d)),u.push(d)}return f(t.__originalMappings,s.compareByOriginalPositions),t},o.prototype._version=3,Object.defineProperty(o.prototype,"sources",{get:function(){return this._sources.toArray().map(function(e){return null!=this.sourceRoot?s.join(this.sourceRoot,e):e},this)}}),o.prototype._parseMappings=function(e,t){for(var n,r,o,a,u,c=1,p=0,h=0,g=0,d=0,m=0,y=e.length,v=0,_={},w={},b=[],A=[];y>v;)if(";"===e.charAt(v))c++,v++,p=0;else if(","===e.charAt(v))v++;else{for(n=new i,n.generatedLine=c,a=v;y>a&&!this._charIsMappingSeparator(e,a);a++);if(r=e.slice(v,a),o=_[r])v+=r.length;else{for(o=[];a>v;)l.decode(e,v,w),u=w.value,v=w.rest,o.push(u);if(2===o.length)throw new Error("Found a source, but no line and column");if(3===o.length)throw new Error("Found a source and line, but no column");_[r]=o}n.generatedColumn=p+o[0],p=n.generatedColumn,o.length>1&&(n.source=d+o[1],d+=o[1],n.originalLine=h+o[2],h=n.originalLine,n.originalLine+=1,n.originalColumn=g+o[3],g=n.originalColumn,o.length>4&&(n.name=m+o[4],m+=o[4])),A.push(n),"number"==typeof n.originalLine&&b.push(n)}f(A,s.compareByGeneratedPositionsDeflated),this.__generatedMappings=A,f(b,s.compareByOriginalPositions),this.__originalMappings=b},o.prototype._findMapping=function(e,t,n,r,o,i){if(e[n]<=0)throw new TypeError("Line must be greater than or equal to 1, got "+e[n]);if(e[r]<0)throw new TypeError("Column must be greater than or equal to 0, got "+e[r]);return u.search(e,t,o,i)},o.prototype.computeColumnSpans=function(){for(var e=0;e<this._generatedMappings.length;++e){var t=this._generatedMappings[e];if(e+1<this._generatedMappings.length){var n=this._generatedMappings[e+1];if(t.generatedLine===n.generatedLine){t.lastGeneratedColumn=n.generatedColumn-1;continue}}t.lastGeneratedColumn=1/0}},o.prototype.originalPositionFor=function(e){var t={generatedLine:s.getArg(e,"line"),generatedColumn:s.getArg(e,"column")},n=this._findMapping(t,this._generatedMappings,"generatedLine","generatedColumn",s.compareByGeneratedPositionsDeflated,s.getArg(e,"bias",r.GREATEST_LOWER_BOUND));if(n>=0){var o=this._generatedMappings[n];if(o.generatedLine===t.generatedLine){var i=s.getArg(o,"source",null);null!==i&&(i=this._sources.at(i),null!=this.sourceRoot&&(i=s.join(this.sourceRoot,i)));var a=s.getArg(o,"name",null);return null!==a&&(a=this._names.at(a)),{source:i,line:s.getArg(o,"originalLine",null),column:s.getArg(o,"originalColumn",null),name:a}}}return{source:null,line:null,column:null,name:null}},o.prototype.hasContentsOfAllSources=function(){return this.sourcesContent?this.sourcesContent.length>=this._sources.size()&&!this.sourcesContent.some(function(e){return null==e}):!1},o.prototype.sourceContentFor=function(e,t){if(!this.sourcesContent)return null;if(null!=this.sourceRoot&&(e=s.relative(this.sourceRoot,e)),this._sources.has(e))return this.sourcesContent[this._sources.indexOf(e)];var n;if(null!=this.sourceRoot&&(n=s.urlParse(this.sourceRoot))){var r=e.replace(/^file:\/\//,"");if("file"==n.scheme&&this._sources.has(r))return this.sourcesContent[this._sources.indexOf(r)];if((!n.path||"/"==n.path)&&this._sources.has("/"+e))return this.sourcesContent[this._sources.indexOf("/"+e)]}if(t)return null;throw new Error('"'+e+'" is not in the SourceMap.')},o.prototype.generatedPositionFor=function(e){var t=s.getArg(e,"source");if(null!=this.sourceRoot&&(t=s.relative(this.sourceRoot,t)),!this._sources.has(t))return{line:null,column:null,lastColumn:null};t=this._sources.indexOf(t);var n={source:t,originalLine:s.getArg(e,"line"),originalColumn:s.getArg(e,"column")},o=this._findMapping(n,this._originalMappings,"originalLine","originalColumn",s.compareByOriginalPositions,s.getArg(e,"bias",r.GREATEST_LOWER_BOUND));if(o>=0){var i=this._originalMappings[o];if(i.source===n.source)return{line:s.getArg(i,"generatedLine",null),column:s.getArg(i,"generatedColumn",null),lastColumn:s.getArg(i,"lastGeneratedColumn",null)}}return{line:null,column:null,lastColumn:null}},n.BasicSourceMapConsumer=o,a.prototype=Object.create(r.prototype),a.prototype.constructor=r,a.prototype._version=3,Object.defineProperty(a.prototype,"sources",{get:function(){for(var e=[],t=0;t<this._sections.length;t++)for(var n=0;n<this._sections[t].consumer.sources.length;n++)e.push(this._sections[t].consumer.sources[n]);return e}}),a.prototype.originalPositionFor=function(e){var t={generatedLine:s.getArg(e,"line"),generatedColumn:s.getArg(e,"column")},n=u.search(t,this._sections,function(e,t){var n=e.generatedLine-t.generatedOffset.generatedLine;return n?n:e.generatedColumn-t.generatedOffset.generatedColumn}),r=this._sections[n];return r?r.consumer.originalPositionFor({line:t.generatedLine-(r.generatedOffset.generatedLine-1),column:t.generatedColumn-(r.generatedOffset.generatedLine===t.generatedLine?r.generatedOffset.generatedColumn-1:0),bias:e.bias}):{source:null,line:null,column:null,name:null}},a.prototype.hasContentsOfAllSources=function(){return this._sections.every(function(e){return e.consumer.hasContentsOfAllSources()})},a.prototype.sourceContentFor=function(e,t){for(var n=0;n<this._sections.length;n++){var r=this._sections[n],o=r.consumer.sourceContentFor(e,!0);if(o)return o}if(t)return null;throw new Error('"'+e+'" is not in the SourceMap.');
},a.prototype.generatedPositionFor=function(e){for(var t=0;t<this._sections.length;t++){var n=this._sections[t];if(-1!==n.consumer.sources.indexOf(s.getArg(e,"source"))){var r=n.consumer.generatedPositionFor(e);if(r){var o={line:r.line+(n.generatedOffset.generatedLine-1),column:r.column+(n.generatedOffset.generatedLine===r.line?n.generatedOffset.generatedColumn-1:0)};return o}}}return{line:null,column:null}},a.prototype._parseMappings=function(e,t){this.__generatedMappings=[],this.__originalMappings=[];for(var n=0;n<this._sections.length;n++)for(var r=this._sections[n],o=r.consumer._generatedMappings,i=0;i<o.length;i++){var a=o[i],u=r.consumer._sources.at(a.source);null!==r.consumer.sourceRoot&&(u=s.join(r.consumer.sourceRoot,u)),this._sources.add(u),u=this._sources.indexOf(u);var c=r.consumer._names.at(a.name);this._names.add(c),c=this._names.indexOf(c);var l={source:u,generatedLine:a.generatedLine+(r.generatedOffset.generatedLine-1),generatedColumn:a.generatedColumn+(r.generatedOffset.generatedLine===a.generatedLine?r.generatedOffset.generatedColumn-1:0),originalLine:a.originalLine,originalColumn:a.originalColumn,name:c};this.__generatedMappings.push(l),"number"==typeof l.originalLine&&this.__originalMappings.push(l)}f(this.__generatedMappings,s.compareByGeneratedPositionsDeflated),f(this.__originalMappings,s.compareByOriginalPositions)},n.IndexedSourceMapConsumer=a},{"./array-set":5,"./base64-vlq":6,"./binary-search":8,"./quick-sort":9,"./util":11}],11:[function(e,t,n){function r(e,t,n){if(t in e)return e[t];if(3===arguments.length)return n;throw new Error('"'+t+'" is a required argument.')}function o(e){var t=e.match(y);return t?{scheme:t[1],auth:t[2],host:t[3],port:t[4],path:t[5]}:null}function i(e){var t="";return e.scheme&&(t+=e.scheme+":"),t+="//",e.auth&&(t+=e.auth+"@"),e.host&&(t+=e.host),e.port&&(t+=":"+e.port),e.path&&(t+=e.path),t}function a(e){var t=e,r=o(e);if(r){if(!r.path)return e;t=r.path}for(var a,s=n.isAbsolute(t),u=t.split(/\/+/),c=0,l=u.length-1;l>=0;l--)a=u[l],"."===a?u.splice(l,1):".."===a?c++:c>0&&(""===a?(u.splice(l+1,c),c=0):(u.splice(l,2),c--));return t=u.join("/"),""===t&&(t=s?"/":"."),r?(r.path=t,i(r)):t}function s(e,t){""===e&&(e="."),""===t&&(t=".");var n=o(t),r=o(e);if(r&&(e=r.path||"/"),n&&!n.scheme)return r&&(n.scheme=r.scheme),i(n);if(n||t.match(v))return t;if(r&&!r.host&&!r.path)return r.host=t,i(r);var s="/"===t.charAt(0)?t:a(e.replace(/\/+$/,"")+"/"+t);return r?(r.path=s,i(r)):s}function u(e,t){""===e&&(e="."),e=e.replace(/\/$/,"");for(var n=0;0!==t.indexOf(e+"/");){var r=e.lastIndexOf("/");if(0>r)return t;if(e=e.slice(0,r),e.match(/^([^\/]+:\/)?\/*$/))return t;++n}return Array(n+1).join("../")+t.substr(e.length+1)}function c(e){return e}function l(e){return p(e)?"$"+e:e}function f(e){return p(e)?e.slice(1):e}function p(e){if(!e)return!1;var t=e.length;if(9>t)return!1;if(95!==e.charCodeAt(t-1)||95!==e.charCodeAt(t-2)||111!==e.charCodeAt(t-3)||116!==e.charCodeAt(t-4)||111!==e.charCodeAt(t-5)||114!==e.charCodeAt(t-6)||112!==e.charCodeAt(t-7)||95!==e.charCodeAt(t-8)||95!==e.charCodeAt(t-9))return!1;for(var n=t-10;n>=0;n--)if(36!==e.charCodeAt(n))return!1;return!0}function h(e,t,n){var r=e.source-t.source;return 0!==r?r:(r=e.originalLine-t.originalLine,0!==r?r:(r=e.originalColumn-t.originalColumn,0!==r||n?r:(r=e.generatedColumn-t.generatedColumn,0!==r?r:(r=e.generatedLine-t.generatedLine,0!==r?r:e.name-t.name))))}function g(e,t,n){var r=e.generatedLine-t.generatedLine;return 0!==r?r:(r=e.generatedColumn-t.generatedColumn,0!==r||n?r:(r=e.source-t.source,0!==r?r:(r=e.originalLine-t.originalLine,0!==r?r:(r=e.originalColumn-t.originalColumn,0!==r?r:e.name-t.name))))}function d(e,t){return e===t?0:e>t?1:-1}function m(e,t){var n=e.generatedLine-t.generatedLine;return 0!==n?n:(n=e.generatedColumn-t.generatedColumn,0!==n?n:(n=d(e.source,t.source),0!==n?n:(n=e.originalLine-t.originalLine,0!==n?n:(n=e.originalColumn-t.originalColumn,0!==n?n:d(e.name,t.name)))))}n.getArg=r;var y=/^(?:([\w+\-.]+):)?\/\/(?:(\w+:\w+)@)?([\w.]*)(?::(\d+))?(\S*)$/,v=/^data:.+\,.+$/;n.urlParse=o,n.urlGenerate=i,n.normalize=a,n.join=s,n.isAbsolute=function(e){return"/"===e.charAt(0)||!!e.match(y)},n.relative=u;var _=function(){var e=Object.create(null);return!("__proto__"in e)}();n.toSetString=_?c:l,n.fromSetString=_?c:f,n.compareByOriginalPositions=h,n.compareByGeneratedPositionsDeflated=g,n.compareByGeneratedPositionsInflated=m},{}],12:[function(t,n,r){!function(t,o){"function"==typeof e&&e.amd?e("stackframe",[],o):"object"==typeof r?n.exports=o():t.StackFrame=o()}(this,function(){function e(e){return!isNaN(parseFloat(e))&&isFinite(e)}function t(e,t,n,r,o,i){void 0!==e&&this.setFunctionName(e),void 0!==t&&this.setArgs(t),void 0!==n&&this.setFileName(n),void 0!==r&&this.setLineNumber(r),void 0!==o&&this.setColumnNumber(o),void 0!==i&&this.setSource(i)}return t.prototype={getFunctionName:function(){return this.functionName},setFunctionName:function(e){this.functionName=String(e)},getArgs:function(){return this.args},setArgs:function(e){if("[object Array]"!==Object.prototype.toString.call(e))throw new TypeError("Args must be an Array");this.args=e},getFileName:function(){return this.fileName},setFileName:function(e){this.fileName=String(e)},getLineNumber:function(){return this.lineNumber},setLineNumber:function(t){if(!e(t))throw new TypeError("Line Number must be a Number");this.lineNumber=Number(t)},getColumnNumber:function(){return this.columnNumber},setColumnNumber:function(t){if(!e(t))throw new TypeError("Column Number must be a Number");this.columnNumber=Number(t)},getSource:function(){return this.source},setSource:function(e){this.source=String(e)},toString:function(){var t=this.getFunctionName()||"{anonymous}",n="("+(this.getArgs()||[]).join(",")+")",r=this.getFileName()?"@"+this.getFileName():"",o=e(this.getLineNumber())?":"+this.getLineNumber():"",i=e(this.getColumnNumber())?":"+this.getColumnNumber():"";return t+n+r+o+i}},t})},{}],13:[function(t,n,r){!function(o,i){"function"==typeof e&&e.amd?e("stack-generator",["stackframe"],i):"object"==typeof r?n.exports=i(t("stackframe")):o.StackGenerator=i(o.StackFrame)}(this,function(e){return{backtrace:function(t){var n=[],r=10;"object"==typeof t&&"number"==typeof t.maxStackSize&&(r=t.maxStackSize);for(var o=arguments.callee;o&&n.length<r;){for(var i=new Array(o.arguments.length),a=0;a<i.length;++a)i[a]=o.arguments[a];/function(?:\s+([\w$]+))+\s*\(/.test(o.toString())?n.push(new e(RegExp.$1||void 0,i)):n.push(new e(void 0,i));try{o=o.caller}catch(s){break}}return n}}})},{stackframe:12}],14:[function(e,t,n){arguments[4][12][0].apply(n,arguments)},{dup:12}],15:[function(t,n,r){!function(o,i){"function"==typeof e&&e.amd?e("stacktrace-gps",["source-map","stackframe"],i):"object"==typeof r?n.exports=i(t("source-map/lib/source-map-consumer"),t("stackframe")):o.StackTraceGPS=i(o.SourceMap||o.sourceMap,o.StackFrame)}(this,function(e,t){function n(e){return new Promise(function(t,n){var r=new XMLHttpRequest;r.open("get",e),r.onerror=n,r.onreadystatechange=function(){4===r.readyState&&(r.status>=200&&r.status<300?t(r.responseText):n(new Error("HTTP status: "+r.status+" retrieving "+e)))},r.send()})}function r(e){if("undefined"!=typeof window&&window.atob)return window.atob(e);throw new Error("You must supply a polyfill for window.atob in this environment")}function o(e){if("undefined"!=typeof JSON&&JSON.parse)return JSON.parse(e);throw new Error("You must supply a polyfill for JSON.parse in this environment")}function i(e,t){for(var n,r=/function\s+([^(]*?)\s*\(([^)]*)\)/,o=/['"]?([$_A-Za-z][$_A-Za-z0-9]*)['"]?\s*[:=]\s*function\b/,i=/['"]?([$_A-Za-z][$_A-Za-z0-9]*)['"]?\s*[:=]\s*(?:eval|new Function)\b/,a=e.split("\n"),s="",u=Math.min(t,20),c=0;u>c;++c){var l=a[t-c-1],f=l.indexOf("//");if(f>=0&&(l=l.substr(0,f)),l){if(s=l+s,n=o.exec(s),n&&n[1])return n[1];if(n=r.exec(s),n&&n[1])return n[1];if(n=i.exec(s),n&&n[1])return n[1]}}}function a(){if("function"!=typeof Object.defineProperty||"function"!=typeof Object.create)throw new Error("Unable to consume source maps in older browsers")}function s(e){if("object"!=typeof e)throw new TypeError("Given StackFrame is not an object");if("string"!=typeof e.fileName)throw new TypeError("Given file name is not a String");if("number"!=typeof e.lineNumber||e.lineNumber%1!==0||e.lineNumber<1)throw new TypeError("Given line number must be a positive integer");if("number"!=typeof e.columnNumber||e.columnNumber%1!==0||e.columnNumber<0)throw new TypeError("Given column number must be a non-negative integer");return!0}function u(e){var t=/\/\/[#@] ?sourceMappingURL=([^\s'"]+)\s*$/.exec(e);if(t&&t[1])return t[1];throw new Error("sourceMappingURL not found")}function c(n,r,o,i,a){var s=new e.SourceMapConsumer(n),u=s.originalPositionFor({line:o,column:i}),c=s.sourceContentFor(u.source);return c&&(a[u.source]=c),new t(u.name,r,u.source,u.line,u.column)}return function l(e){return this instanceof l?(e=e||{},this.sourceCache=e.sourceCache||{},this.ajax=e.ajax||n,this._atob=e.atob||r,this._get=function(t){return new Promise(function(n,r){var o="data:"===t.substr(0,5);if(this.sourceCache[t])n(this.sourceCache[t]);else if(e.offline&&!o)r(new Error("Cannot make network requests in offline mode"));else if(o){var i=/^data:application\/json;([\w=:"-]+;)*base64,/,a=t.match(i);if(a){var s=a[0].length,u=t.substr(s),c=this._atob(u);this.sourceCache[t]=c,n(c)}else r(new Error("The encoding of the inline sourcemap is not supported"))}else{var l=this.ajax(t,{method:"get"});this.sourceCache[t]=l,l.then(n,r)}}.bind(this))},this.pinpoint=function(e){return new Promise(function(t,n){this.getMappedLocation(e).then(function(e){function n(){t(e)}this.findFunctionName(e).then(t,n)["catch"](n)}.bind(this),n)}.bind(this))},this.findFunctionName=function(e){return new Promise(function(n,r){s(e),this._get(e.fileName).then(function(r){var o=e.lineNumber,a=e.columnNumber,s=i(r,o,a);n(s?new t(s,e.args,e.fileName,o,a):e)},r)["catch"](r)}.bind(this))},void(this.getMappedLocation=function(e){return new Promise(function(t,n){a(),s(e);var r=this.sourceCache,i=e.fileName;this._get(i).then(function(a){var s=u(a),l="data:"===s.substr(0,5),f=i.substring(0,i.lastIndexOf("/")+1);"/"===s[0]||l||/^https?:\/\/|^\/\//i.test(s)||(s=f+s),this._get(s).then(function(n){var i=e.lineNumber,a=e.columnNumber;"string"==typeof n&&(n=o(n.replace(/^\)\]\}'/,""))),"undefined"==typeof n.sourceRoot&&(n.sourceRoot=f),t(c(n,e.args,i,a,r))},n)["catch"](n)}.bind(this),n)["catch"](n)}.bind(this))})):new l(e)}})},{"source-map/lib/source-map-consumer":10,stackframe:14}],16:[function(e,t,n){Array.isArray||(Array.isArray=function(e){return"[object Array]"===Object.prototype.toString.call(e)}),"undefined"==typeof Promise&&ES6Promise.polyfill(),Function.prototype.bind||(Function.prototype.bind=function(e){if("function"!=typeof this)throw new TypeError("Function.prototype.bind - what is trying to be bound is not callable");var t=Array.prototype.slice.call(arguments,1),n=this,r=function(){},o=function(){return n.apply(this instanceof r&&e?this:e,t.concat(Array.prototype.slice.call(arguments)))};return r.prototype=this.prototype,o.prototype=new r,o}),Array.prototype.map||(Array.prototype.map=function(e,t){if(void 0===this||null===this)throw new TypeError("this is null or not defined");var n,r=Object(this),o=r.length>>>0;if("function"!=typeof e)throw new TypeError(e+" is not a function");arguments.length>1&&(n=t);for(var i=new Array(o),a=0;o>a;){var s,u;a in r&&(s=r[a],u=e.call(n,s,a,r),i[a]=u),a++}return i}),Array.prototype.filter||(Array.prototype.filter=function(e){if(void 0===this||null===this)throw new TypeError("this is null or not defined");var t=Object(this),n=t.length>>>0;if("function"!=typeof e)throw new TypeError(e+" is not a function");for(var r=[],o=arguments.length>=2?arguments[1]:void 0,i=0;n>i;i++)if(i in t){var a=t[i];e.call(o,a,i,t)&&r.push(a)}return r}),Array.prototype.forEach||(Array.prototype.forEach=function(e,t){var n,r;if(null===this||void 0===this)throw new TypeError(" this is null or not defined");var o=Object(this),i=o.length>>>0;if("function"!=typeof e)throw new TypeError(e+" is not a function");for(arguments.length>1&&(n=t),r=0;i>r;){var a;r in o&&(a=o[r],e.call(n,a,r,o)),r++}})},{}],17:[function(t,n,r){!function(o,i){"function"==typeof e&&e.amd?e("stacktrace",["error-stack-parser","stack-generator","stacktrace-gps"],i):"object"==typeof r?n.exports=i(t("error-stack-parser"),t("stack-generator"),t("stacktrace-gps")):o.StackTrace=i(o.ErrorStackParser,o.StackGenerator,o.StackTraceGPS)}(this,function(e,t,n){function r(e,t){var n={};return[e,t].forEach(function(e){for(var t in e)e.hasOwnProperty(t)&&(n[t]=e[t]);return n}),n}function o(e){return e.stack||e["opera#sourceloc"]}function i(e,t){return"function"==typeof t?e.filter(t):e}var a={filter:function(e){return-1===(e.functionName||"").indexOf("StackTrace$$")&&-1===(e.functionName||"").indexOf("ErrorStackParser$$")&&-1===(e.functionName||"").indexOf("StackTraceGPS$$")&&-1===(e.functionName||"").indexOf("StackGenerator$$")},sourceCache:{}},s=function(){try{throw new Error}catch(e){return e}};return{get:function(e){var t=s();return o(t)?this.fromError(t,e):this.generateArtificially(e)},getSync:function(n){n=r(a,n);var u=s(),c=o(u)?e.parse(u):t.backtrace(n);return i(c,n.filter)},fromError:function(t,o){o=r(a,o);var s=new n(o);return new Promise(function(n){var r=i(e.parse(t),o.filter);n(Promise.all(r.map(function(e){return new Promise(function(t){function n(){t(e)}s.pinpoint(e).then(t,n)["catch"](n)})})))}.bind(this))},generateArtificially:function(e){e=r(a,e);var n=t.backtrace(e);return"function"==typeof e.filter&&(n=n.filter(e.filter)),Promise.resolve(n)},instrument:function(e,t,n,r){if("function"!=typeof e)throw new Error("Cannot instrument non-function object");if("function"==typeof e.__stacktraceOriginalFn)return e;var i=function(){try{return this.get().then(t,n)["catch"](n),e.apply(r||this,arguments)}catch(i){throw o(i)&&this.fromError(i).then(t,n)["catch"](n),i}}.bind(this);return i.__stacktraceOriginalFn=e,i},deinstrument:function(e){if("function"!=typeof e)throw new Error("Cannot de-instrument non-function object");return"function"==typeof e.__stacktraceOriginalFn?e.__stacktraceOriginalFn:e},report:function(e,t,n){return new Promise(function(r,o){var i=new XMLHttpRequest;i.onerror=o,i.onreadystatechange=function(){4===i.readyState&&(i.status>=200&&i.status<400?r(i.responseText):o(new Error("POST to "+t+" failed with status: "+i.status)))},i.open("post",t),i.setRequestHeader("Content-Type","application/json");var a={stack:e};void 0!==n&&(a.message=n),i.send(JSON.stringify(a))})}}})},{"error-stack-parser":1,"stack-generator":13,"stacktrace-gps":15}]},{},[2,3,16,17])(17)});
//# sourceMappingURL=stacktrace-with-promises-and-json-polyfills.min.js.map
;
!function(e,n){if("function"==typeof require&&"object"==typeof exports&&"object"==typeof module)n(require(["knockout","jquery","knockout-mapping","crossroads","hasher","signals","stacktrace"]),exports);else{if("function"!=typeof define||!define.amd)throw new Error("Quark.js must be used as an AMD module, it must not be included with an script tag");define('quark',["knockout","jquery","knockout-mapping","crossroads","hasher","signals","stacktrace"],n)}}(this,function(e,n,t,r,i,o,a){function s(e){return e.replace(/([.*+?^=!:${}()|\[\]\/\\])/g,"\\$1")}function u(e,n,t){return e.replace(new RegExp(s(n),"g"),t)}function c(e,n,t,r){var i="_object: "+e,o=B.call(this,i,n,t,r),a=o._object();return d(a,function(e){return function(){return e}})}function d(e,n){if(!e)return e;var t={};for(var r in e)e.hasOwnProperty(r)&&(t[r]=n(e[r],r,e));return t}function l(n,t){var r=n(),i=t.get("formatter");if(!H.isString(i)&&!H.isObject(i)&&!H.isFunction(i))throw new Error("Must specify formatter name, function or object");e.isObservable(r)||(r=e.observable(r));var o;o=H.isString(i)?H.formatters[i]:i;var a={};if(!H.isDefined(o))throw new Error("No formatter found with the specified name: "+i);if(H.isFunction(o))a.read=function(){return H.isDefined(r())?o(r()):r()};else{if(!H.isObject(o))throw new Error("The formatter object must be a function or an object with read and write properties");H.isFunction(o.read)&&(a.read=function(){return H.isDefined(r())?o.read(r()):r()}),H.isFunction(o.write)&&(a.write=function(e){r(H.isDefined(e)?o.write(e):e)})}return e.pureComputed(a)}function f(e){var n=e||!1,t=H.signal();this.lock=function(){n=!1},this.force=function(){n=!0},this.unlock=function(){n=!0,t.dispatch()},this.isLocked=function(){return!n},this.call=function(e){n?e():t.addOnce(function(){n=!0,e()})},this.dispose=function(){H.signalClear(t)}}function p(e,n,t,r){this.component=n,this.node=t,this.message=e,this.stack=r.stack}function m(e,n,t){t=t||"";for(var r in n){var i,o=n[r];i=r?e?e+"-"+r:r:e,H.isString(o)?t?H.registerComponent(i,t+"/"+o):H.registerComponent(i,o):m(i,o,t)}}function v(){function e(e,t,r){if(!H.isString(e))throw new Error("The behaviour name must be an string. If you specified an array check that all elements are valid behaviour names");if(!n[e])throw new Error("The are no behaviours loaded with the name "+e+".");n[e](t,r),H.isDefined(t.behaviours)||(t.behaviours={}),t.behaviours[e]=!0}var n={};this.define=function(e,t,r){if(n[e]&&console.warn("There was already a behaviour loaded with the name "+e+". It will be replaced with the new one."),!H.isString(e))throw new Error("The behaviour name must be an string.");if(!H.isFunction(t))throw new Error("The behaviour must be a function that takes an object as a parameter an applies the new functionality to it.");if(H.isDefined(r)&&!H.isFunction(r))throw new Error("The behaviour dispose must be a function that performs cleanup of the behaviour when disposing.");t.dispose=r,n[e]=t},this.apply=function(n,t,r){if(!H.isObject(t))throw new Error("You must specifify a valid object to apply the behaviour.");if(H.isArray(n))for(var i=0;i<n.length;i++)e(n[i],t,r);else{if(!H.isString(n))throw new Error("The behaviour name must be an string or an array of strings.");e(n,t,r)}},this.has=function(e,n){if(!H.isObject(n))throw new Error("You must specifify a valid object to check the behaviour.");if(!H.isString(e))throw new Error("The behaviour name must be an string.");return!(!H.isDefined(n.behaviours)||!H.isDefined(n.behaviours[e]))},this.dispose=function(e){if(!H.isObject(e))throw new Error("You must specifify a valid object to apply the behaviour.");if(H.isDefined(e.behaviours))for(var t in e.behaviours){var r=n[t];r&&H.isFunction(n[behaviourName].dispose)&&n[behaviourName].dispose(e)}}}function h(e){var n=function(){return{nodes:e.$componentTemplateNodes}};return n}function b(e){var n=e.$parent,t=e.$parentContext,r=e.extend({$component:n.getModel(),$componentTemplateNodes:t.$componentTemplateNodes,$data:n.getScope(),$parent:t.$parent?t.$parent.model:void 0,$parentContext:t.$parentContext,$parents:t.$parents,$rawData:n.getScope(),$root:t.$root});return H.isArray(r.$parents)&&r.$parents[0]&&r.$parents[0].model&&(r.$parents[0]=r.$parents[0].model),r}function g(n,t){for(var r=e.virtualElements.childNodes(n),i=0;i<r.length;i++)if(r[i]==t)return!0;return!1}function w(e){for(var n=e.previousSibling;null!=n;){if(g(n,e))return n;n=n.previousSibling}if(null==n)return e.parentNode}function y(e){if(8==e.nodeType){var n=e.nodeValue.match(/model-bind[\s]*:[\s]*\"[\s\S]*?\"/);if(n){var t=n[0].match(/\"[\s\S]*?\"/);if(t){var r=t[0].indexOf('"')+1,i=t[0].indexOf('"',r);return t[0].substring(r,i)}}}else if(e.attributes)for(var o=0;o<e.attributes.length;o++){var a=e.attributes[o];if(a.specified&&"model-bind"==a.name)return a.value}return!1}function x(e){var n=function(){var n=Array(),t=w(e);t=w(t);var r=y(t);return r&&(n.push(document.createComment(" ko "+r+" ")),n.push(document.createComment(" /ko "))),{nodes:n,if:n.length>0}};return n}function k(e){var n=e.$parentContext.$parentContext,t=e.$parent,r=n.extend({$child:t.getModel(),$childContext:e.$parentContext});return r}function C(){function e(e){this.name=e,this.loaded=!1,this.ready=!1,this.model=void 0,this.tracker=void 0}function n(){for(var e in i){var n=i[e];if(!n.loaded||!n.ready)return!1}return!0}var t,r=this,i={},o=!1,a="";this.ready=H.lock(),this.loaded=H.signal(),this.readied=H.signal(),this.isReady=function(){return!r.ready.isLocked()},this.addDependency=function(n){r.ready.lock(),i[n]=new e(n)},this.removeDependency=function(e){if(i[e]){var n=i[e].tracker;n&&(n.parent=""),delete i[e]}},this.loadDependency=function(e,n,t){i[e].model=n,i[e].tracker=t,i[e].loaded=!0,r.loaded.dispatch(e,n),t?(t.setParent(r,e),t.isReady()?r.readyDependency(e):i[e].ready=!1):r.readyDependency(e)},this.readyDependency=function(e){i[e].ready=!0,r.readied.dispatch(e,i[e].model),n()&&(r.ready.unlock(),o&&o.readyDependency(a,t,r))},this.setMainModel=function(e){t=e},this.setParent=function(e,n){o=e,a=n},this.get=function(e){var n=i[e];if(n)return n.model},this.reset=function(){r.ready.lock();for(var e in i)r.removeDependency(e)},this.dispose=function(){r.ready.dispose(),H.signalClear(r.loaded),H.signalClear(r.readied);for(var e in i)r.removeDependency(e)}}function E(e,n,t){if(8==e.nodeType){var r=e.nodeValue.match(/model-bind[\s]*:[\s]*\"[\s\S]*?\"/);if(r){var i=r[0].match(/\"[\s\S]*?\"/);if(i){var o=i[0].indexOf('"')+1,a=i[0].indexOf('"',o),s=i[0].substring(o,a),u='"'+s;s&&(u+=", "),u+=t+": '"+n+"'\"",e.nodeValue=e.nodeValue.replace(i[0],u)}}else e.nodeValue+='model-bind: "'+t+": '"+n+"'\""}else{var c=!1;if(e.attributes)for(var d=0;d<e.attributes.length;d++){var l=e.attributes[d];l.specified&&"model-bind"==l.name&&(l.value&&(l.value+=", "),l.value+=t+": '"+n+"'",c=!0)}if(!c)var l=e.setAttribute("model-bind",t+": '"+n+"'")}}function j(t,r,i){var o=e.unwrap(t()),a=r.get("virtual")||!1,s=function(){if(a){for(var e=[],t=0,r=0;r<i.$componentTemplateNodes.length;r++){var s=i.$componentTemplateNodes[r];8==s.nodeType&&s.nodeValue.trim().toUpperCase()==o.toUpperCase()&&t++,t>0&&(e.push(s),8==s.nodeType&&s.nodeValue.trim().toUpperCase()=="/"+o.toUpperCase()&&t--)}return{nodes:e}}if(H.isDefined(o)){var u=n(i.$componentTemplateNodes).filter(o);return{nodes:u}}return{nodes:i.$componentTemplateNodes}};return s}function $(e){var n=e.$parentContext,t=e.$data,r=n.extend({$containerContext:e,$container:t.model});return r}function O(t,r,i){var o=e.unwrap(t()),a=r.get("virtual")||!1,s=function(){if(a){for(var e=0;e<i.$componentTemplateNodes.length;e++){var t=i.$componentTemplateNodes[e];if(8==t.nodeType&&t.nodeValue.trim().toUpperCase()==o.toUpperCase())return!0}return!1}return n(i.$componentTemplateNodes).filter(o).length>0};return s}function D(){function t(e){var n,t=h.name();if(!t)return{index:0};n=t.split("/");for(var r,i=e.split("/"),o=0;o<i.length;o++){if(n[o]!=i[o])return{index:o,fullName:r};r=r?r+"/"+n[o]:n[o]}return{index:i.length,fullName:r}}function o(){}function a(e,n,t,r){t.setMainModel(n),t.ready.force(),h.trackers[e]=t,h.controllers[e]=n,r&&(n.parent=r)}function s(e,n,t){var r=[];if(e&&(r=e.split("/")),n.index<r.length){var i,u=r[n.index],c=n.fullName;c&&h.controllers[c]&&(i=h.controllers[c]);var d=n.fullName?n.fullName+"/"+u:u,l={index:n.index+1,fullName:d};H.controllerProvider(d,function(n){var r=new C,o=new n(i,r);a(d,o,r,i),s(e,l,t)},function(n){var r=new C,u=new o(i,r);a(d,u,r,i),s(e,l,t)})}else t()}function u(e){var n=h.name(),t=[];n&&(t=n.split("/"));for(var r=e.fullName,i=e.index;i<t.length;i++){var o=t[i];r=r?r+"/"+o:o;var a=h.controllers[r],s=h.trackers[r];a&&H.isFunction(a.dispose)&&a.dispose(),s&&s.dispose(),delete h.controllers[r],delete h.trackers[r]}}function c(e){var n=h.name(),t=[];n&&(t=n.split("/"));for(var r=e.fullName,i=e.index;i<t.length;i++){var o=t[i];r=r?r+"/"+o:o;var a=b[r],s=h.controllers[r];for(var u in a)s.outlets[u]="empty"}}function d(n,t){var r=[];n&&(r=n.split("/"));for(var i=t.fullName,o=t.index;o<r.length;o++){var a=r[o];i=i?i+"/"+a:a;var s=h.controllers[i],u=b[i];s.outlets||(s.outlets={});for(var c in u)s.outlets[c]=u[c];var d=y[i];if(s.params||(s.params={}),d)if(H.isArray(d))for(var l=0;l<d.length;l++)s.params[d[l]]=e.observable();else{if(!H.isObject(d))throw new Error("The parameters of '"+i+"' must be an object or array");for(var a in d)s.params[a]=e.observable(d[a])}}}function l(e,n){var t,r=[];n&&(r=n.split("/"));for(var i=0;i<r.length;i++){var o=r[i];if(t=t?t+"/"+o:o,y[t]){var a=h.controllers[t];if(a&&a.params)for(var s in a.params)if(H.isDefined(e[s])){var u=e[s];a.params[s](u)}}}}function f(e,n){var t=[];e&&(t=e.split("/"));for(var r=n.fullName,i=n.index;i<t.length;i++){var o=t[i];r=r?r+"/"+o:o;var a=h.controllers[r];a&&a.init&&a.init()}}function p(e,n){w[e]=v.addRoute(n,function(n){var r=t(e);c(r),u(r),s(e,r,function(){d(e,r),l(n,e),f(e,r),h.name(e);var t=m.getPageConfig(e);t.module?h.module(t.module):H.undefine(h.module),m.routed.dispatch(e)})})}var m=this,v=r.create();v.normalizeFn=r.NORM_AS_OBJECT,v.ignoreState=!0;var h={name:e.observable(),module:e.observable(),controllers:{},trackers:{}};this.current=h.name,this.currentModule=h.module,this.currentHash=e.observable(),this.routed=H.signal();var b={},g={},w={},y={},x={};this.pages=function(e,t,r){if(r)for(var i in e)for(var o=i.split("/"),a="",s=0;s<o.length;s++){var u=o[s];""!=a&&(a+="/"),a+=u,b[a]||(x[a]=r)}if(n.extend(b,e),t){n.extend(y,t);for(var i in t)H.isDefined(b[i])||(b[i]={})}},this.getPageConfig=function(e){var n={};return b[e]&&(n.name=e,n.outlets=b[e]),g[e]&&(n.route=g[e]),y[e]&&(n.param=y[e]),x[e]&&(n.module=x[e]),n},this.mapRoute=function(e){for(var n in e){var t=e[n];p(n,t),g[n]=t}},this.parse=function(e){m.currentHash(e),v.parse(e)},this.hash=function(e,n){var t=w[e];if(t)return t.interpolate(n)},this.activateHasher=function(e){function n(n,t){H.isDefined(e)?e(n,t):m.parse(n)}i.initialized.add(n),i.changed.add(n),i.init()},e.bindingHandlers.outlet={init:function(n,t,r,i,o){function a(e){var n=[];e&&(n=e.split("/"));for(var t,r,i,o,a,l=0;l<n.length;l++){var f=n[l];r=r?r+"/"+f:f;var t=h.controllers[r],p=h.trackers[r];for(var m in t.outlets)m==u&&(i=t.outlets[m],o=t,a=p)}if(i){if(i!=c().name||o!=s){var v={name:i};o&&o.sendParameters?v.params=o.sendParameters(u,i):v.params={},a.addDependency(u),s=o,c(v),d&&window.scrollTo(0,0)}}else s="",c({name:"empty"})}var s,u=e.unwrap(t()),c=e.observable({name:"empty"}),d=r.get("resetScroll")||!0,l=h.name.subscribe(a);a(h.name()),e.utils.domNodeDisposal.addDisposeCallback(n,function(){l.dispose(),s=""}),E(n,u,"exportToController");var f=function(){return c};return e.bindingHandlers.component.init(n,f,r,i,o)}},e.virtualElements.allowedBindings.outlet=!0,e.bindingHandlers.exportToController={init:function(n,t,r,i,o){var a=e.unwrap(t()),s=[],u=h.name();u&&(s=u.split("/"));for(var c,d,l,f,p,m=0;m<s.length;m++){var v=s[m];d=d?d+"/"+v:v;var c=h.controllers[d],b=h.trackers[d];for(var g in c.outlets)g==a&&(l=c.outlets[g],f=c,p=b)}if(f&&p){var w=o.$childContext.$data.getModel(),y=o.$childContext.$data.getImports();p.loadDependency(a,w,y)}f="",p=""}},e.virtualElements.allowedBindings.exportToController=!0}function T(n,t){t||(t=this),t.validationReset();for(var r in t.validationConfig){var i=t.validationConfig[r];if(e.validators[r]){var o=e.validators[r](t,i);if(!o.validate(n))return!1}}return!0}function S(e,t,r,i,o){var a=t(),s=!1;if(H.isArray(a)){for(var u=0;u<a.length;u++)if(!a[u].hasError()){s=!0;break}}else s=a.hasError();s?n(e).addClass("has-error"):n(e).removeClass("has-error")}function N(){var e=this,n={};this.get=function(t){if(n[t])return n[t];var r=require("service!"+t),i=new r(e);return n[t]=i,i}}var H={};H.started=!1,H.ajaxErrorHandlers={},H.formatters={},H.isDefined=function(e){return"undefined"!=typeof e},H.isString=function(e){return"string"==typeof e||e instanceof String},H.isInt=function(e){return Number(e)===e&&e%1===0},H.canBeInt=function(e){return Number(e)==e&&e%1===0},H.isNumeric=function(e){return"number"==typeof e},H.isDecimal=function(e){return e===Number(e)&&e%1!==0},H.isArray=function(e){return n.isArray(e)},H.isObject=function(e){return!(null===e||"object"!=typeof e||e instanceof Array)},H.isFunction=function(e){return null!==e&&"function"==typeof e},H.isDate=function(e){return e instanceof Date},H.isValidDate=function(e){return!!H.isDate(e)&&!isNaN(e.getTime())},H.clone=function(e){return n.extend(!0,{},e)},H.cloneObservable=function(e){return t.fromJS(t.toJS(e))},H.cloneMixed=function(n){var t=new n.constructor;for(var r in n){var i;e.isObservable(n[r])?(i=n[r](),H.isObject(i)?t[r]=e.observable(H.cloneMixed(i)):t[r]=e.observable(i)):(i=n[r],H.isObject(i)?t[r]=H.cloneMixed(i):t[r]=i)}return t},H.call=function(n){if(e.isObservable(n)&&(n=n()),e.isObservable(n))throw new Error("Callback can not be an observable");if(H.isFunction(n)){var t=Array.prototype.slice.call(arguments,1);return n.apply(null,t)}},H.makeDate=function(e,n){if(H.isDate(e)||(e=new Date(e)),!H.isValidDate(e)){if(!n)return;e=new Date}return e},H.toShortISO=function(e){if(H.isDate(e))return e.toISOString().slice(0,10)},H.clear=function(t){n.each(t,function(n,t){e.isObservable(t)?t(void 0):t=void 0})},H.undefine=function(n){e.isObservable(n)?n(void 0):n=void 0},H.formatString=function(){var e=Array.prototype.slice.call(arguments),n=e[0];if(2==e.length&&H.isString(e[0])&&H.isObject(e[1])){var t=e[1],r=n;for(var i in t)r=u(r,"{"+i+"}",t[i]);return r}for(var o=1;o<e.length;o++)n=u(n,"{"+(o-1)+"}",e[o]);return n},H.extends=function(e,n){e.prototype=new n,e.prototype.constructor=e,e.super=n.prototype},e.associativeObservable=function(n){function t(){return arguments.length>0?(r(arguments[0]),this):r()}var r=e.observable(n);return t.add=function(e,n){var t=r();t||(t={}),t[e]=n,r(t)},t.get=function(e){var n=r();if(n){if(H.isDefined(n[e]))return n[e];throw new Error("The specified key does not exists")}throw new Error("The specified key does not exists")},t.exists=function(e){var n=r();return!(!n||!H.isDefined(n[e]))},t.update=function(e,n){var t=r();if(t){if(H.isDefined(t[e])){var i=t[e];return t[e]=n,r(t),i}throw new Error("The specified key does not exists")}throw new Error("The specified key does not exists")},t.remove=function(e){var n,t=r();return t&&H.isDefined(t[e])&&(n=t[e],delete t[e],r(t)),n},t.array=e.pureComputed(function(){var e=r(),n=[];if(e)for(var t in e){var i=e[t];n.push(i)}return n}),t.each=function(e){var n=r();if(n)for(var t in n)e(t,n[t])},t.subscribe=function(e){return r.subscribe(e)},t},e.observable.fn.refresh=function(){var e=this();H.undefine(this),this(e)},e.isObservableArray=function(n){return!(!e.isObservable(n)||void 0===n.indexOf)},e.isComputed=function(n){return null!==n&&void 0!==n&&void 0!==n.__ko_proto__&&(n.__ko_proto__===e.dependentObservable||e.isComputed(n.__ko_proto__))},e.mapToJS=function(e){return t.toJS(t.fromJS(e))},e.mapFromJS=function(e){return t.fromJS(t.toJS(e))};var B=e.bindingProvider.prototype.parseBindingsString,M=/^\$\{(.+)\}$/;e.bindingProvider.prototype.parseBindingsString=function(e,n,t,r){var i=e.match(M);return i?c.call(this,i[1],n,t,r):B.apply(this,arguments)},e.bindingHandlers.href={update:function(n,t,r,i,o){var a=e.unwrap(t()),s=e.unwrap(r.get("params")),u=function(){return{href:"#"+H.routing.hash(a,s)}};return e.bindingHandlers.attr.update(n,u,r,i,o)}},e.bindingHandlers.onBind={init:function(n,t,r,i,o){var a=e.unwrap(t());a(n,i,o)}},e.bindingHandlers.format={init:function(n,t,r){var i=l(t,r),o=r.get("bindTo")||"text",a={};a[o]=i,e.applyBindingsToNode(n,a)}},e.bindingHandlers.waitReady={init:function(n,t,r,i,o){function a(e){e==s&&(u(!0),i.imports.readied.remove(a))}var s=e.unwrap(t());if(!H.isString(s))throw new Error("The binding must be an string with the property name of the imported dependency");var u=e.observable(!1);return i&&i.imports&&i.imports.readied&&i.imports.readied.add(a),e.bindingHandlers.if.init(n,u,r,i,o)}},e.virtualElements.allowedBindings.waitReady=!0,H.signal=function(){return new o.Signal},H.signalClear=function(e){e.removeAll()},H.lock=function(e){return new f(e||!1)},H.wait=function(e,n){e.call(n)},H.redirect=function(e){return window.location.href=e,!0},H.redirectHash=function(e,n){var t=H.routing.hash(e,n);H.redirect("#"+t)},H.getParam=function(e){var n=void 0,t=[];return location.search.substr(1).split("&").forEach(function(r){t=r.split("="),t[0]===e&&(n=decodeURIComponent(t[1]))}),n},H.replaceAndBind=function(t,r,i){e.cleanNode(n(t).get(0)),n(t).empty(),n(t).html(r),e.applyBindings(i,n(t).get(0))},H.htmlEncode=function(e){return e?n("<div />").text(e).html():""},H.htmlDecode=function(e){return e?n("<div />").html(e).text():""},H.limitText=function(e,n){return H.isInt(n)?n<6&&(n=6):n=6,H.isString(e)?(e.length>n&&(e=e.substr(0,n-3)+"..."),e):""},H.setCookie=function(e,n,t){var r=new Date;if(void 0!==t){r.setTime(r.getTime()+1e3*t);var i="expires="+r.toUTCString();document.cookie=e+"="+n+"; "+i}else document.cookie=e+"="+n+"; "},H.getCookie=function(e){e+="=";for(var n=document.cookie.split(";"),t=0;t<n.length;t++){for(var r=n[t];" "===r.charAt(0);)r=r.substring(1);if(0===r.indexOf(e))return r.substring(e.length,r.length)}return""},H.clearCookie=function(e){H.setCookie(e,"",-1)},H.loadCss=function(e){var n=document.createElement("link");n.type="text/css",n.rel="stylesheet",n.href=e,document.getElementsByTagName("head")[0].appendChild(n)};var A=!1;H.ajaxConfig={contentType:"application/json",dataType:"json",async:!0,cache:!1,authorization:{has:function(){return!0},configAuthorization:function(e){return e},authorize:function(e,n){n(!0)}},globalEvents:{start:H.signal(),authorizing:H.signal(),authorized:H.signal(),complete:H.signal()}},H.ajax=function(e,t,r,i,o,a){function s(){l=l.authorization.configAuthorization(l),n.ajax(l)}var u=a||{},c=i||{};if(!e)throw new Error("Must specify the target URL");var d;H.isFunction(c)?d=c:H.isObject(c)&&(d=c.onSuccess);var l={url:e,type:t||"GET",data:r,success:d,complete:function(){H.ajaxConfig.globalEvents.complete.dispatch(e,t,r,l),H.isDefined(c.onComplete)&&c.onComplete()},error:function(n,i,o){H.ajaxConfig.globalEvents.complete.dispatch(e,t,r,l);var a=!1;if(H.isDefined(c.onError)&&(a=c.onError(n,i,o)),!a)for(var s in H.ajaxErrorHandlers)if(H.ajaxErrorHandlers[s](e,n,i,o)){a=!0;break}}};l=n.extend(l,H.ajaxConfig),l=n.extend(l,u),H.ajaxConfig.globalEvents.start.dispatch(e,t,r,l),!A&&o?l.authorization.has()?s():(A=!0,H.ajaxConfig.globalEvents.authorizing.dispatch(e,t,r,l),l.authorization.authorize(function(n){A=!1,n&&(H.ajaxConfig.globalEvents.authorized.dispatch(e,t,r,l),s())})):n.ajax(l)},H.onError=function(e,n){return!1},H.errorSignal=H.signal(),Object.setPrototypeOf(p,Error),p.prototype=Object.create(Error.prototype),p.prototype.name="BindingError",p.prototype.message="",p.prototype.constructor=p,window.onerror=function(e,n,t,r,i){var o,s,u=H.onError(e,i);return H.isObject(u)?(u.handled&&(s=u.handled),u.stack&&(o=u.stack)):s=u,a.fromError(i).then(function(e){H.errorSignal.dispatch(i,e),o&&o(e)}),s},requirejs.onError=function(e){throw e},e.onError=function(e){throw e};var q=function(){var n=new e.bindingProvider;this.nodeHasBindings=n.nodeHasBindings,this.getBindings=function(e,t){var r;try{r=n.getBindings(e,t)}catch(n){var i=t.$component;throw new p("Binding Error: "+n.message,i,e,n)}return r}};return e.bindingProvider.instance=new q,H.modules=e.associativeObservable({}),H.start=function(n){H.started||(e.applyBindings(n),H.started=!0)},H.module=function(e,n,t){if(!H.isDefined(e))throw new Error("Must specify the module configuration. You can define 'module' as dependency and pass that value in this parameter");var r=e.id.substring(0,e.id.indexOf("/")),i=e.uri.substring(0,e.uri.lastIndexOf("/"));if(H.modules.exists(r))return H.modules.get(r);if(n||(n={}),H.isDefined(n.require)&&require.config(n.require),n.components)for(var o in n.components){var a=n.prefix+"-"+o,s=r+"/"+n.components[o];H.registerComponent(a,s)}if(n.namespaces&&(n.prefix?m(n.prefix,n.namespaces,r):m("",n.namespaces,r)),H.isArray(n.css))for(var u=0;u<n.css.length;u++)H.loadCss(i+"/"+n.css[u]);n.pages&&(n.params?H.routing.pages(n.pages,n.params,r):H.routing.pages(n.pages,void 0,r)),n.routes&&H.routing.mapRoute(n.routes);var c;return t&&(c=new t(r,i,e)),H.modules.add(r,{name:r,path:i,info:e,config:n,main:c}),H.modules.get(r)},H.component=function(e,n){function t(n){var t,r,i={},o=new C;e&&!t&&(r=H.serviceContext(n),t=new e(n,i,o,r),o.setMainModel(t),o.ready.force(),o&&H.isFunction(o.initComponent)&&o.initComponent(),i.model=t,i.imports=o,i.context=r),this.getModel=function(){return t},this.getScope=function(){return i},this.getImports=function(){return o},this.dispose=function(){t&&t.dispose&&t.dispose(),i&&i.dispose&&i.dispose(),o&&o.dispose(),delete t,delete i,delete o}}return H.isDefined(n)||(n=e,H.undefine(e)),e?{template:n,viewModel:t,modelType:e}:{template:n}},H.parameters=function(n,t,r){if(!H.isObject(n))throw new Error("You must specify a parameters config object");if(!H.isObject(t))throw new Error("You must specify the configured values for the component, usually you can obtain it from the parameters array received in the component's constructor.");if(!H.isDefined(r))throw new Error("You must specify the viewmodel of the component in wich to load the parameters.");H.isArray(r)||(r=Array(r));for(var i in n)for(var o=0;o<r.length;o++){var a=r[o];if(a[i]=n[i],H.isDefined(t[i]))if(e.isObservable(a[i])&&e.isObservable(t[i]))a[i]=t[i];else if(e.isObservable(a[i])&&!e.isObservable(t[i]))a[i](t[i]);else if(!e.isObservable(a[i])&&e.isObservable(t[i]))a[i]=t[i]();else if(!e.isObservable(a[i])&&!e.isObservable(t[i]))if(H.isFunction(a[i])){if(H.isFunction(t[i]))a[i]=t[i];else if(H.isDefined(t[i]))throw new Error("The parameter "+i+" must be a callback.")}else H.isObject(n[i])&&H.isObject(t[i])?H.parameters(n[i],t[i],a[i]):a[i]=t[i]}},H.repackParameters=function(e,t){var r={},i=new Array,o={};if(H.isArray(e))i=e;else if(H.isObject(e)){if(!(H.isArray(e.export)||H.isString(e.export)||H.isObject(e.send)))throw new Error("The params object must be an array of values to export, or an object with at least an export or send property, or a string with the name of the property to export");H.isDefined(e.export)&&(i=e.export),H.isObject(e.send)&&(o=e.send)}else{if(!H.isString(e))throw new Error("The params object must be an array of values to export, or an object with at least an export or send property, or a string with the name of the property to export");i=e}if(H.isArray(i))for(var a=0;a<i.length;a++){var s=i[a];H.isDefined(t[s])&&(r=n.extend(r,t[s]))}else H.isDefined(t[i])&&(r=n.extend(r,t[i]));for(var s in o)r[s]=o[s];return r},H.inject=function(n,t,r){if(H.isDefined(n)&&H.isDefined(t))for(var i in n)if(H.isDefined(t[i])){var o;o=e.isObservable(n[i])?n[i]():n[i],e.isObservable(t[i])?r&&H.isObject(t[i]())?H.inject(o,t[i](),!0):t[i](o):r&&H.isObject(t[i])?H.inject(o,t[i],!0):t[i]=o}},H.emptyTemplate=function(e){return e?"<!-- quark-component --><!-- /quark-component -->":"<quark-component></quark-component>"},H.registerComponent=function(n,t){e.components.register(n,{require:t})},H.registerComponents=function(e){m("",e)},e.components.register("empty",{template:" "}),H.onNamespace=function(e,n){var t=this,r=e;return this.register=function(e,n){return H.registerComponent(r+"-"+e,n),t},this.namespace=function(e){return new H.onNamespace(r+"-"+e,t)},this.endNamespace=function(){return n},t},H.behaviour=new v,e.components.register("quark-component",{template:"<!-- ko componentScope --><!-- /ko --><!-- ko modelBinder --><!-- /ko -->"}),e.bindingHandlers.componentScope={init:function(n,t,r,i,o){var a=h(o),s=b(o);return e.bindingHandlers.template.init(n,a,r,s.$data,s)},update:function(n,t,r,i,o){var a=h(o),s=b(o);return e.bindingHandlers.template.update(n,a,r,s.$data,s)}},e.virtualElements.allowedBindings.componentScope=!0,e.bindingHandlers.modelBinder={init:function(n,t,r,i,o){var a=x(n),s=k(o);return e.bindingHandlers.template.init(n,a,r,o.$parent,s)},update:function(n,t,r,i,o){var a=x(n),s=k(o);return e.bindingHandlers.template.update(n,a,r,o.$parent,s)}},e.virtualElements.allowedBindings.modelBinder=!0,H.tracker=function(){return new C},e.bindingHandlers.import={init:function(e,n,t,r,i){var o,a,s=n();if(r&&r.imports&&r.model)o=r.model,a=r.imports;else{if(!r||!r.$imports)throw new Error("The import binding can only import to Quark components or objects with a propery $imports that contains a Tracker object");o=r,a=r.$imports}a.addDependency(s),E(e,s,"export")}},e.virtualElements.allowedBindings.import=!0,e.bindingHandlers.export={init:function(n,t,r,i,o){var a;a=e.unwrap(t());var s,u;if(i&&i.imports&&i.model)s=i.model,u=i.imports;else{if(!i||!i.$imports)throw new Error("The import binding can only import to Quark components or objects with a propery $imports that contains a Tracker object");s=i,u=i.$imports}var c;if(!H.isString(a))throw new Error("The value of the vm value must be an string with the name of the property where quark must load the viewmodel of the nested component");if(c=a,u){var d=o.$childContext.$data.getModel(),l=o.$childContext.$data.getImports();u.loadDependency(c,d,l)}}},e.virtualElements.allowedBindings.export=!0,e.bindingHandlers.content={init:function(n,t,r,i,o){var a=j(t,r,o),s=$(o);return e.bindingHandlers.template.init(n,a,r,o.$parent,s)},update:function(n,t,r,i,o){var a=j(t,r,o),s=$(o);return e.bindingHandlers.template.update(n,a,r,o.$parent,s)}},e.virtualElements.allowedBindings.content=!0,e.bindingHandlers.hasContent={init:function(n,t,r,i,o){var a=O(t,r,o);return e.bindingHandlers.if.init(n,a,r,o,o)}},e.virtualElements.allowedBindings.hasContent=!0,e.bindingHandlers.hasNotContent={init:function(n,t,r,i,o){var a=O(t,r,o);return e.bindingHandlers.ifnot.init(n,a,r,o,o)}},e.virtualElements.allowedBindings.hasNotContent=!0,H.controllerProvider=function(e,n,t){var r=this,i="";this.controllersBase="controllers";var o=H.routing.getPageConfig(e);i=o.module?o.module+"/"+r.controllersBase+"/"+e+".controller":r.controllersBase+"/"+e+".controller",require([i],function(e){n(e)},function(e){t()})},H.routing=new D,e.bindingHandlers.namespace={init:function(n,t,r,i,o){var a=t(),s=r.get("alias");if(!H.isString(a))throw new Error("Must specify namespace as string. The binding must be in the form: namespace: 'namespace', alias: 'alias'");if(!H.isString(s))throw new Error("Must specify alias to namespace as string. The binding must be in the form: namespace: 'namespace', alias: 'alias'");var u=a.toLowerCase();if(s=s.toLowerCase(),o){var c;c=o.namespaces?{namespaces:o.namespaces}:{namespaces:{}},c.namespaces[s]=u;var d=o.extend(c);return e.applyBindingsToDescendants(d,n),{controlsDescendantBindings:!0}}}},e.virtualElements.allowedBindings.namespace=!0,e.bindingProvider.instance.preprocessNode=function(n){if(8==n.nodeType){var t=n.nodeValue.match(/^\s*(quark-component[\s\S]+)/);if(t)return n.data=" ko component: { name: 'quark-component' } ",n;var t=n.nodeValue.match(/^\s*(\/quark-component[\s\S]+)/);if(t)return n.data=" /ko ",n}if(n&&n.nodeName&&e.components.isRegistered(n.nodeName.toLowerCase())&&n.attributes.virtual){var r=n.attributes.params,i=n.attributes["data-bind"],o=n.attributes["model-bind"],a=" ko component: { name: '"+n.nodeName.toLowerCase()+"' ";if(r){var s=/^\$\{(.+)\}$/,u=r.value.match(s);a+=u?", params: "+u[1]+" ":", params: { "+r.value+" } "}else a+=", params: {}";a+=" } ",i&&(a+=", "+i.value+" "),o&&(a+=', model-bind: "'+o.value+'"');var c=document.createComment(a),d=document.createComment(" /ko ");for(n.parentNode.insertBefore(d,n.nextSibling),n.parentNode.replaceChild(c,n);n.childNodes.length>0;)c.parentNode.insertBefore(n.childNodes[0],d);return[c,d]}},e.components.getComponentNameForNode=function(n){var t=n.tagName&&n.tagName.toLowerCase();if(e.components.isRegistered(t))return t;if(t.indexOf(":")!==-1){var r=t.split(":"),i=r[0],o=r[1],a=e.contextFor(n);if(a&&H.isObject(a.namespaces)&&a.namespaces[i]){var s=a.namespaces[i],u=s+"-"+o;if(e.components.isRegistered(u))return u}}return null},e.validators={},e.validate=function(n,t){var r=!0;for(var i in n){var o=n[i];e.isObservable(o)&&o.validatable&&(o.validate(t)||(r=!1))}return r},e.unsubscribeValidation=function(n){for(var t in n){var r=n[t];e.isObservable(r)&&r.validatable&&r.validationSubscription&&(r.validationSubscription.dispose(),delete r.validationSubscription)}},e.validationReset=function(n){for(var t in n){var r=n[t];e.isObservable(r)&&r.validatable&&r.validationReset()}},e.observable.fn.validation=function(n,t){return this.validatable=n,this.validationConfig=t,this.hasError=e.observable(),this.validationMessage=e.observable(),this},e.observable.fn.validationReset=function(){this.validatable&&(this.hasError(!1),this.validationMessage(""))},e.observable.fn.validate=function(e){return e&&!this.validationSubscription&&(this.validationSubscription=this.subscribe(T,this)),T(this(),this)},e.bindingHandlers.formGroupError={init:function(e,n,t,r,i){S(e,n,t,r,i)},update:function(e,n,t,r,i){S(e,n,t,r,i)}},e.bindingHandlers.fieldError={init:function(n,t,r,i,o){var a=function(){return t().validationMessage};e.bindingHandlers.text.init(n,a,r,i,o)},update:function(n,t,r,i,o){var a=function(){return t().hasError},s=function(){return t().validationMessage};e.bindingHandlers.visible.update(n,a,r,i,o),e.bindingHandlers.text.update(n,s,r,i,o)}},H.serviceContext=function(e){return e&&e.context&&e.context instanceof N?e.context:new N},"function"==typeof define&&define.amd&&define("knockout",[],function(){return e}),H});
/**
 * @license text 2.0.15 Copyright jQuery Foundation and other contributors.
 * Released under MIT license, http://github.com/requirejs/text/LICENSE
 */
/*jslint regexp: true */
/*global require, XMLHttpRequest, ActiveXObject,
  define, window, process, Packages,
  java, location, Components, FileUtils */

define('text',['module'], function (module) {
    

    var text, fs, Cc, Ci, xpcIsWindows,
        progIds = ['Msxml2.XMLHTTP', 'Microsoft.XMLHTTP', 'Msxml2.XMLHTTP.4.0'],
        xmlRegExp = /^\s*<\?xml(\s)+version=[\'\"](\d)*.(\d)*[\'\"](\s)*\?>/im,
        bodyRegExp = /<body[^>]*>\s*([\s\S]+)\s*<\/body>/im,
        hasLocation = typeof location !== 'undefined' && location.href,
        defaultProtocol = hasLocation && location.protocol && location.protocol.replace(/\:/, ''),
        defaultHostName = hasLocation && location.hostname,
        defaultPort = hasLocation && (location.port || undefined),
        buildMap = {},
        masterConfig = (module.config && module.config()) || {};

    function useDefault(value, defaultValue) {
        return value === undefined || value === '' ? defaultValue : value;
    }

    //Allow for default ports for http and https.
    function isSamePort(protocol1, port1, protocol2, port2) {
        if (port1 === port2) {
            return true;
        } else if (protocol1 === protocol2) {
            if (protocol1 === 'http') {
                return useDefault(port1, '80') === useDefault(port2, '80');
            } else if (protocol1 === 'https') {
                return useDefault(port1, '443') === useDefault(port2, '443');
            }
        }
        return false;
    }

    text = {
        version: '2.0.15',

        strip: function (content) {
            //Strips <?xml ...?> declarations so that external SVG and XML
            //documents can be added to a document without worry. Also, if the string
            //is an HTML document, only the part inside the body tag is returned.
            if (content) {
                content = content.replace(xmlRegExp, "");
                var matches = content.match(bodyRegExp);
                if (matches) {
                    content = matches[1];
                }
            } else {
                content = "";
            }
            return content;
        },

        jsEscape: function (content) {
            return content.replace(/(['\\])/g, '\\$1')
                .replace(/[\f]/g, "\\f")
                .replace(/[\b]/g, "\\b")
                .replace(/[\n]/g, "\\n")
                .replace(/[\t]/g, "\\t")
                .replace(/[\r]/g, "\\r")
                .replace(/[\u2028]/g, "\\u2028")
                .replace(/[\u2029]/g, "\\u2029");
        },

        createXhr: masterConfig.createXhr || function () {
            //Would love to dump the ActiveX crap in here. Need IE 6 to die first.
            var xhr, i, progId;
            if (typeof XMLHttpRequest !== "undefined") {
                return new XMLHttpRequest();
            } else if (typeof ActiveXObject !== "undefined") {
                for (i = 0; i < 3; i += 1) {
                    progId = progIds[i];
                    try {
                        xhr = new ActiveXObject(progId);
                    } catch (e) {}

                    if (xhr) {
                        progIds = [progId];  // so faster next time
                        break;
                    }
                }
            }

            return xhr;
        },

        /**
         * Parses a resource name into its component parts. Resource names
         * look like: module/name.ext!strip, where the !strip part is
         * optional.
         * @param {String} name the resource name
         * @returns {Object} with properties "moduleName", "ext" and "strip"
         * where strip is a boolean.
         */
        parseName: function (name) {
            var modName, ext, temp,
                strip = false,
                index = name.lastIndexOf("."),
                isRelative = name.indexOf('./') === 0 ||
                             name.indexOf('../') === 0;

            if (index !== -1 && (!isRelative || index > 1)) {
                modName = name.substring(0, index);
                ext = name.substring(index + 1);
            } else {
                modName = name;
            }

            temp = ext || modName;
            index = temp.indexOf("!");
            if (index !== -1) {
                //Pull off the strip arg.
                strip = temp.substring(index + 1) === "strip";
                temp = temp.substring(0, index);
                if (ext) {
                    ext = temp;
                } else {
                    modName = temp;
                }
            }

            return {
                moduleName: modName,
                ext: ext,
                strip: strip
            };
        },

        xdRegExp: /^((\w+)\:)?\/\/([^\/\\]+)/,

        /**
         * Is an URL on another domain. Only works for browser use, returns
         * false in non-browser environments. Only used to know if an
         * optimized .js version of a text resource should be loaded
         * instead.
         * @param {String} url
         * @returns Boolean
         */
        useXhr: function (url, protocol, hostname, port) {
            var uProtocol, uHostName, uPort,
                match = text.xdRegExp.exec(url);
            if (!match) {
                return true;
            }
            uProtocol = match[2];
            uHostName = match[3];

            uHostName = uHostName.split(':');
            uPort = uHostName[1];
            uHostName = uHostName[0];

            return (!uProtocol || uProtocol === protocol) &&
                   (!uHostName || uHostName.toLowerCase() === hostname.toLowerCase()) &&
                   ((!uPort && !uHostName) || isSamePort(uProtocol, uPort, protocol, port));
        },

        finishLoad: function (name, strip, content, onLoad) {
            content = strip ? text.strip(content) : content;
            if (masterConfig.isBuild) {
                buildMap[name] = content;
            }
            onLoad(content);
        },

        load: function (name, req, onLoad, config) {
            //Name has format: some.module.filext!strip
            //The strip part is optional.
            //if strip is present, then that means only get the string contents
            //inside a body tag in an HTML string. For XML/SVG content it means
            //removing the <?xml ...?> declarations so the content can be inserted
            //into the current doc without problems.

            // Do not bother with the work if a build and text will
            // not be inlined.
            if (config && config.isBuild && !config.inlineText) {
                onLoad();
                return;
            }

            masterConfig.isBuild = config && config.isBuild;

            var parsed = text.parseName(name),
                nonStripName = parsed.moduleName +
                    (parsed.ext ? '.' + parsed.ext : ''),
                url = req.toUrl(nonStripName),
                useXhr = (masterConfig.useXhr) ||
                         text.useXhr;

            // Do not load if it is an empty: url
            if (url.indexOf('empty:') === 0) {
                onLoad();
                return;
            }

            //Load the text. Use XHR if possible and in a browser.
            if (!hasLocation || useXhr(url, defaultProtocol, defaultHostName, defaultPort)) {
                text.get(url, function (content) {
                    text.finishLoad(name, parsed.strip, content, onLoad);
                }, function (err) {
                    if (onLoad.error) {
                        onLoad.error(err);
                    }
                });
            } else {
                //Need to fetch the resource across domains. Assume
                //the resource has been optimized into a JS module. Fetch
                //by the module name + extension, but do not include the
                //!strip part to avoid file system issues.
                req([nonStripName], function (content) {
                    text.finishLoad(parsed.moduleName + '.' + parsed.ext,
                                    parsed.strip, content, onLoad);
                });
            }
        },

        write: function (pluginName, moduleName, write, config) {
            if (buildMap.hasOwnProperty(moduleName)) {
                var content = text.jsEscape(buildMap[moduleName]);
                write.asModule(pluginName + "!" + moduleName,
                               "define(function () { return '" +
                                   content +
                               "';});\n");
            }
        },

        writeFile: function (pluginName, moduleName, req, write, config) {
            var parsed = text.parseName(moduleName),
                extPart = parsed.ext ? '.' + parsed.ext : '',
                nonStripName = parsed.moduleName + extPart,
                //Use a '.js' file name so that it indicates it is a
                //script that can be loaded across domains.
                fileName = req.toUrl(parsed.moduleName + extPart) + '.js';

            //Leverage own load() method to load plugin value, but only
            //write out values that do not have the strip argument,
            //to avoid any potential issues with ! in file names.
            text.load(nonStripName, req, function (value) {
                //Use own write() method to construct full module value.
                //But need to create shell that translates writeFile's
                //write() to the right interface.
                var textWrite = function (contents) {
                    return write(fileName, contents);
                };
                textWrite.asModule = function (moduleName, contents) {
                    return write.asModule(moduleName, fileName, contents);
                };

                text.write(pluginName, nonStripName, textWrite, config);
            }, config);
        }
    };

    if (masterConfig.env === 'node' || (!masterConfig.env &&
            typeof process !== "undefined" &&
            process.versions &&
            !!process.versions.node &&
            !process.versions['node-webkit'] &&
            !process.versions['atom-shell'])) {
        //Using special require.nodeRequire, something added by r.js.
        fs = require.nodeRequire('fs');

        text.get = function (url, callback, errback) {
            try {
                var file = fs.readFileSync(url, 'utf8');
                //Remove BOM (Byte Mark Order) from utf8 files if it is there.
                if (file[0] === '\uFEFF') {
                    file = file.substring(1);
                }
                callback(file);
            } catch (e) {
                if (errback) {
                    errback(e);
                }
            }
        };
    } else if (masterConfig.env === 'xhr' || (!masterConfig.env &&
            text.createXhr())) {
        text.get = function (url, callback, errback, headers) {
            var xhr = text.createXhr(), header;
            xhr.open('GET', url, true);

            //Allow plugins direct access to xhr headers
            if (headers) {
                for (header in headers) {
                    if (headers.hasOwnProperty(header)) {
                        xhr.setRequestHeader(header.toLowerCase(), headers[header]);
                    }
                }
            }

            //Allow overrides specified in config
            if (masterConfig.onXhr) {
                masterConfig.onXhr(xhr, url);
            }

            xhr.onreadystatechange = function (evt) {
                var status, err;
                //Do not explicitly handle errors, those should be
                //visible via console output in the browser.
                if (xhr.readyState === 4) {
                    status = xhr.status || 0;
                    if (status > 399 && status < 600) {
                        //An http 4xx or 5xx error. Signal an error.
                        err = new Error(url + ' HTTP status: ' + status);
                        err.xhr = xhr;
                        if (errback) {
                            errback(err);
                        }
                    } else {
                        callback(xhr.responseText);
                    }

                    if (masterConfig.onXhrComplete) {
                        masterConfig.onXhrComplete(xhr, url);
                    }
                }
            };
            xhr.send(null);
        };
    } else if (masterConfig.env === 'rhino' || (!masterConfig.env &&
            typeof Packages !== 'undefined' && typeof java !== 'undefined')) {
        //Why Java, why is this so awkward?
        text.get = function (url, callback) {
            var stringBuffer, line,
                encoding = "utf-8",
                file = new java.io.File(url),
                lineSeparator = java.lang.System.getProperty("line.separator"),
                input = new java.io.BufferedReader(new java.io.InputStreamReader(new java.io.FileInputStream(file), encoding)),
                content = '';
            try {
                stringBuffer = new java.lang.StringBuffer();
                line = input.readLine();

                // Byte Order Mark (BOM) - The Unicode Standard, version 3.0, page 324
                // http://www.unicode.org/faq/utf_bom.html

                // Note that when we use utf-8, the BOM should appear as "EF BB BF", but it doesn't due to this bug in the JDK:
                // http://bugs.sun.com/bugdatabase/view_bug.do?bug_id=4508058
                if (line && line.length() && line.charAt(0) === 0xfeff) {
                    // Eat the BOM, since we've already found the encoding on this file,
                    // and we plan to concatenating this buffer with others; the BOM should
                    // only appear at the top of a file.
                    line = line.substring(1);
                }

                if (line !== null) {
                    stringBuffer.append(line);
                }

                while ((line = input.readLine()) !== null) {
                    stringBuffer.append(lineSeparator);
                    stringBuffer.append(line);
                }
                //Make sure we return a JavaScript string and not a Java string.
                content = String(stringBuffer.toString()); //String
            } finally {
                input.close();
            }
            callback(content);
        };
    } else if (masterConfig.env === 'xpconnect' || (!masterConfig.env &&
            typeof Components !== 'undefined' && Components.classes &&
            Components.interfaces)) {
        //Avert your gaze!
        Cc = Components.classes;
        Ci = Components.interfaces;
        Components.utils['import']('resource://gre/modules/FileUtils.jsm');
        xpcIsWindows = ('@mozilla.org/windows-registry-key;1' in Cc);

        text.get = function (url, callback) {
            var inStream, convertStream, fileObj,
                readData = {};

            if (xpcIsWindows) {
                url = url.replace(/\//g, '\\');
            }

            fileObj = new FileUtils.File(url);

            //XPCOM, you so crazy
            try {
                inStream = Cc['@mozilla.org/network/file-input-stream;1']
                           .createInstance(Ci.nsIFileInputStream);
                inStream.init(fileObj, 1, 0, false);

                convertStream = Cc['@mozilla.org/intl/converter-input-stream;1']
                                .createInstance(Ci.nsIConverterInputStream);
                convertStream.init(inStream, "utf-8", inStream.available(),
                Ci.nsIConverterInputStream.DEFAULT_REPLACEMENT_CHARACTER);

                convertStream.readString(inStream.available(), readData);
                convertStream.close();
                inStream.close();
                callback(readData.value);
            } catch (e) {
                throw new Error((fileObj && fileObj.path || '') + ': ' + e);
            }
        };
    }
    return text;
});

/** @license
 * RequireJS plugin for loading JSON files
 * - depends on Text plugin and it was HEAVILY "inspired" by it as well.
 * Author: Miller Medeiros
 * Version: 0.4.0 (2014/04/10)
 * Released under the MIT license
 */
define('json',['text'], function(text){

    var CACHE_BUST_QUERY_PARAM = 'bust',
        CACHE_BUST_FLAG = '!bust',
        jsonParse = (typeof JSON !== 'undefined' && typeof JSON.parse === 'function')? JSON.parse : function(val){
            return eval('('+ val +')'); //quick and dirty
        },
        buildMap = {};

    function cacheBust(url){
        url = url.replace(CACHE_BUST_FLAG, '');
        url += (url.indexOf('?') < 0)? '?' : '&';
        return url + CACHE_BUST_QUERY_PARAM +'='+ Math.round(2147483647 * Math.random());
    }

    //API
    return {

        load : function(name, req, onLoad, config) {
            if (( config.isBuild && (config.inlineJSON === false || name.indexOf(CACHE_BUST_QUERY_PARAM +'=') !== -1)) || (req.toUrl(name).indexOf('empty:') === 0)) {
                //avoid inlining cache busted JSON or if inlineJSON:false
                //and don't inline files marked as empty!
                onLoad(null);
            } else {
                text.get(req.toUrl(name), function(data){
                    if (config.isBuild) {
                        buildMap[name] = data;
                        onLoad(data);
                    } else {
                        onLoad(jsonParse(data));
                    }
                },
                    onLoad.error, {
                        accept: 'application/json'
                    }
                );
            }
        },

        normalize : function (name, normalize) {
            // used normalize to avoid caching references to a "cache busted" request
            if (name.indexOf(CACHE_BUST_FLAG) !== -1) {
                name = cacheBust(name);
            }
            // resolve any relative paths
            return normalize(name);
        },

        //write method based on RequireJS official text plugin by James Burke
        //https://github.com/jrburke/requirejs/blob/master/text.js
        write : function(pluginName, moduleName, write){
            if(moduleName in buildMap){
                var content = buildMap[moduleName];
                write('define("'+ pluginName +'!'+ moduleName +'", function(){ return '+ content +';});\n');
            }
        }

    };
});

define("json!app/config/components/components.config.json", function(){ return {
}
;});

define("json!app/config/components/screens.config.json", function(){ return {
    "layout": {
        "main": "screens/_layout/main.screen"
    },
    "navbar": {
        "main": {
            "left": "screens/_navbar/main/left.screen",
            "right": "screens/_navbar/main/right.screen"
        }
    },
    "sidebar": {
        "main": "screens/_sidebar/main.screen"
    },
    "container": {
        "simple": "screens/_container/simple.screen",
        "sidebar": "screens/_container/sidebar.screen"
    },
    "screens": {
        "home": "screens/home.screen",
        "about": "screens/about.screen"
    }
}
;});

define("json!app/config/routing/pages.config.json", function(){ return {
    "main":                                 {
                                                "layout": "layout-main",
                                                "navbar-left": "navbar-main-left",
                                                "navbar-right": "navbar-main-right",
                                                "container": "container-simple"
                                            },

    "main/home":                            { "main": "screens-home" },

    "main/about":                           { "main": "screens-about" }
}
;});

define("json!app/config/routing/params.config.json", function(){ return {
}
;});

define("json!app/config/routing/routes.config.json", function(){ return {
    "main/home":    "",
    "main/about":   "about"
}
;});

/*!
 * Bootstrap v3.3.7 (http://getbootstrap.com)
 * Copyright 2011-2016 Twitter, Inc.
 * Licensed under the MIT license
 */
if("undefined"==typeof jQuery)throw new Error("Bootstrap's JavaScript requires jQuery");+function(a){var b=a.fn.jquery.split(" ")[0].split(".");if(b[0]<2&&b[1]<9||1==b[0]&&9==b[1]&&b[2]<1||b[0]>3)throw new Error("Bootstrap's JavaScript requires jQuery version 1.9.1 or higher, but lower than version 4")}(jQuery),+function(a){function b(){var a=document.createElement("bootstrap"),b={WebkitTransition:"webkitTransitionEnd",MozTransition:"transitionend",OTransition:"oTransitionEnd otransitionend",transition:"transitionend"};for(var c in b)if(void 0!==a.style[c])return{end:b[c]};return!1}a.fn.emulateTransitionEnd=function(b){var c=!1,d=this;a(this).one("bsTransitionEnd",function(){c=!0});var e=function(){c||a(d).trigger(a.support.transition.end)};return setTimeout(e,b),this},a(function(){a.support.transition=b(),a.support.transition&&(a.event.special.bsTransitionEnd={bindType:a.support.transition.end,delegateType:a.support.transition.end,handle:function(b){if(a(b.target).is(this))return b.handleObj.handler.apply(this,arguments)}})})}(jQuery),+function(a){function b(b){return this.each(function(){var c=a(this),e=c.data("bs.alert");e||c.data("bs.alert",e=new d(this)),"string"==typeof b&&e[b].call(c)})}var c='[data-dismiss="alert"]',d=function(b){a(b).on("click",c,this.close)};d.VERSION="3.3.7",d.TRANSITION_DURATION=150,d.prototype.close=function(b){function c(){g.detach().trigger("closed.bs.alert").remove()}var e=a(this),f=e.attr("data-target");f||(f=e.attr("href"),f=f&&f.replace(/.*(?=#[^\s]*$)/,""));var g=a("#"===f?[]:f);b&&b.preventDefault(),g.length||(g=e.closest(".alert")),g.trigger(b=a.Event("close.bs.alert")),b.isDefaultPrevented()||(g.removeClass("in"),a.support.transition&&g.hasClass("fade")?g.one("bsTransitionEnd",c).emulateTransitionEnd(d.TRANSITION_DURATION):c())};var e=a.fn.alert;a.fn.alert=b,a.fn.alert.Constructor=d,a.fn.alert.noConflict=function(){return a.fn.alert=e,this},a(document).on("click.bs.alert.data-api",c,d.prototype.close)}(jQuery),+function(a){function b(b){return this.each(function(){var d=a(this),e=d.data("bs.button"),f="object"==typeof b&&b;e||d.data("bs.button",e=new c(this,f)),"toggle"==b?e.toggle():b&&e.setState(b)})}var c=function(b,d){this.$element=a(b),this.options=a.extend({},c.DEFAULTS,d),this.isLoading=!1};c.VERSION="3.3.7",c.DEFAULTS={loadingText:"loading..."},c.prototype.setState=function(b){var c="disabled",d=this.$element,e=d.is("input")?"val":"html",f=d.data();b+="Text",null==f.resetText&&d.data("resetText",d[e]()),setTimeout(a.proxy(function(){d[e](null==f[b]?this.options[b]:f[b]),"loadingText"==b?(this.isLoading=!0,d.addClass(c).attr(c,c).prop(c,!0)):this.isLoading&&(this.isLoading=!1,d.removeClass(c).removeAttr(c).prop(c,!1))},this),0)},c.prototype.toggle=function(){var a=!0,b=this.$element.closest('[data-toggle="buttons"]');if(b.length){var c=this.$element.find("input");"radio"==c.prop("type")?(c.prop("checked")&&(a=!1),b.find(".active").removeClass("active"),this.$element.addClass("active")):"checkbox"==c.prop("type")&&(c.prop("checked")!==this.$element.hasClass("active")&&(a=!1),this.$element.toggleClass("active")),c.prop("checked",this.$element.hasClass("active")),a&&c.trigger("change")}else this.$element.attr("aria-pressed",!this.$element.hasClass("active")),this.$element.toggleClass("active")};var d=a.fn.button;a.fn.button=b,a.fn.button.Constructor=c,a.fn.button.noConflict=function(){return a.fn.button=d,this},a(document).on("click.bs.button.data-api",'[data-toggle^="button"]',function(c){var d=a(c.target).closest(".btn");b.call(d,"toggle"),a(c.target).is('input[type="radio"], input[type="checkbox"]')||(c.preventDefault(),d.is("input,button")?d.trigger("focus"):d.find("input:visible,button:visible").first().trigger("focus"))}).on("focus.bs.button.data-api blur.bs.button.data-api",'[data-toggle^="button"]',function(b){a(b.target).closest(".btn").toggleClass("focus",/^focus(in)?$/.test(b.type))})}(jQuery),+function(a){function b(b){return this.each(function(){var d=a(this),e=d.data("bs.carousel"),f=a.extend({},c.DEFAULTS,d.data(),"object"==typeof b&&b),g="string"==typeof b?b:f.slide;e||d.data("bs.carousel",e=new c(this,f)),"number"==typeof b?e.to(b):g?e[g]():f.interval&&e.pause().cycle()})}var c=function(b,c){this.$element=a(b),this.$indicators=this.$element.find(".carousel-indicators"),this.options=c,this.paused=null,this.sliding=null,this.interval=null,this.$active=null,this.$items=null,this.options.keyboard&&this.$element.on("keydown.bs.carousel",a.proxy(this.keydown,this)),"hover"==this.options.pause&&!("ontouchstart"in document.documentElement)&&this.$element.on("mouseenter.bs.carousel",a.proxy(this.pause,this)).on("mouseleave.bs.carousel",a.proxy(this.cycle,this))};c.VERSION="3.3.7",c.TRANSITION_DURATION=600,c.DEFAULTS={interval:5e3,pause:"hover",wrap:!0,keyboard:!0},c.prototype.keydown=function(a){if(!/input|textarea/i.test(a.target.tagName)){switch(a.which){case 37:this.prev();break;case 39:this.next();break;default:return}a.preventDefault()}},c.prototype.cycle=function(b){return b||(this.paused=!1),this.interval&&clearInterval(this.interval),this.options.interval&&!this.paused&&(this.interval=setInterval(a.proxy(this.next,this),this.options.interval)),this},c.prototype.getItemIndex=function(a){return this.$items=a.parent().children(".item"),this.$items.index(a||this.$active)},c.prototype.getItemForDirection=function(a,b){var c=this.getItemIndex(b),d="prev"==a&&0===c||"next"==a&&c==this.$items.length-1;if(d&&!this.options.wrap)return b;var e="prev"==a?-1:1,f=(c+e)%this.$items.length;return this.$items.eq(f)},c.prototype.to=function(a){var b=this,c=this.getItemIndex(this.$active=this.$element.find(".item.active"));if(!(a>this.$items.length-1||a<0))return this.sliding?this.$element.one("slid.bs.carousel",function(){b.to(a)}):c==a?this.pause().cycle():this.slide(a>c?"next":"prev",this.$items.eq(a))},c.prototype.pause=function(b){return b||(this.paused=!0),this.$element.find(".next, .prev").length&&a.support.transition&&(this.$element.trigger(a.support.transition.end),this.cycle(!0)),this.interval=clearInterval(this.interval),this},c.prototype.next=function(){if(!this.sliding)return this.slide("next")},c.prototype.prev=function(){if(!this.sliding)return this.slide("prev")},c.prototype.slide=function(b,d){var e=this.$element.find(".item.active"),f=d||this.getItemForDirection(b,e),g=this.interval,h="next"==b?"left":"right",i=this;if(f.hasClass("active"))return this.sliding=!1;var j=f[0],k=a.Event("slide.bs.carousel",{relatedTarget:j,direction:h});if(this.$element.trigger(k),!k.isDefaultPrevented()){if(this.sliding=!0,g&&this.pause(),this.$indicators.length){this.$indicators.find(".active").removeClass("active");var l=a(this.$indicators.children()[this.getItemIndex(f)]);l&&l.addClass("active")}var m=a.Event("slid.bs.carousel",{relatedTarget:j,direction:h});return a.support.transition&&this.$element.hasClass("slide")?(f.addClass(b),f[0].offsetWidth,e.addClass(h),f.addClass(h),e.one("bsTransitionEnd",function(){f.removeClass([b,h].join(" ")).addClass("active"),e.removeClass(["active",h].join(" ")),i.sliding=!1,setTimeout(function(){i.$element.trigger(m)},0)}).emulateTransitionEnd(c.TRANSITION_DURATION)):(e.removeClass("active"),f.addClass("active"),this.sliding=!1,this.$element.trigger(m)),g&&this.cycle(),this}};var d=a.fn.carousel;a.fn.carousel=b,a.fn.carousel.Constructor=c,a.fn.carousel.noConflict=function(){return a.fn.carousel=d,this};var e=function(c){var d,e=a(this),f=a(e.attr("data-target")||(d=e.attr("href"))&&d.replace(/.*(?=#[^\s]+$)/,""));if(f.hasClass("carousel")){var g=a.extend({},f.data(),e.data()),h=e.attr("data-slide-to");h&&(g.interval=!1),b.call(f,g),h&&f.data("bs.carousel").to(h),c.preventDefault()}};a(document).on("click.bs.carousel.data-api","[data-slide]",e).on("click.bs.carousel.data-api","[data-slide-to]",e),a(window).on("load",function(){a('[data-ride="carousel"]').each(function(){var c=a(this);b.call(c,c.data())})})}(jQuery),+function(a){function b(b){var c,d=b.attr("data-target")||(c=b.attr("href"))&&c.replace(/.*(?=#[^\s]+$)/,"");return a(d)}function c(b){return this.each(function(){var c=a(this),e=c.data("bs.collapse"),f=a.extend({},d.DEFAULTS,c.data(),"object"==typeof b&&b);!e&&f.toggle&&/show|hide/.test(b)&&(f.toggle=!1),e||c.data("bs.collapse",e=new d(this,f)),"string"==typeof b&&e[b]()})}var d=function(b,c){this.$element=a(b),this.options=a.extend({},d.DEFAULTS,c),this.$trigger=a('[data-toggle="collapse"][href="#'+b.id+'"],[data-toggle="collapse"][data-target="#'+b.id+'"]'),this.transitioning=null,this.options.parent?this.$parent=this.getParent():this.addAriaAndCollapsedClass(this.$element,this.$trigger),this.options.toggle&&this.toggle()};d.VERSION="3.3.7",d.TRANSITION_DURATION=350,d.DEFAULTS={toggle:!0},d.prototype.dimension=function(){var a=this.$element.hasClass("width");return a?"width":"height"},d.prototype.show=function(){if(!this.transitioning&&!this.$element.hasClass("in")){var b,e=this.$parent&&this.$parent.children(".panel").children(".in, .collapsing");if(!(e&&e.length&&(b=e.data("bs.collapse"),b&&b.transitioning))){var f=a.Event("show.bs.collapse");if(this.$element.trigger(f),!f.isDefaultPrevented()){e&&e.length&&(c.call(e,"hide"),b||e.data("bs.collapse",null));var g=this.dimension();this.$element.removeClass("collapse").addClass("collapsing")[g](0).attr("aria-expanded",!0),this.$trigger.removeClass("collapsed").attr("aria-expanded",!0),this.transitioning=1;var h=function(){this.$element.removeClass("collapsing").addClass("collapse in")[g](""),this.transitioning=0,this.$element.trigger("shown.bs.collapse")};if(!a.support.transition)return h.call(this);var i=a.camelCase(["scroll",g].join("-"));this.$element.one("bsTransitionEnd",a.proxy(h,this)).emulateTransitionEnd(d.TRANSITION_DURATION)[g](this.$element[0][i])}}}},d.prototype.hide=function(){if(!this.transitioning&&this.$element.hasClass("in")){var b=a.Event("hide.bs.collapse");if(this.$element.trigger(b),!b.isDefaultPrevented()){var c=this.dimension();this.$element[c](this.$element[c]())[0].offsetHeight,this.$element.addClass("collapsing").removeClass("collapse in").attr("aria-expanded",!1),this.$trigger.addClass("collapsed").attr("aria-expanded",!1),this.transitioning=1;var e=function(){this.transitioning=0,this.$element.removeClass("collapsing").addClass("collapse").trigger("hidden.bs.collapse")};return a.support.transition?void this.$element[c](0).one("bsTransitionEnd",a.proxy(e,this)).emulateTransitionEnd(d.TRANSITION_DURATION):e.call(this)}}},d.prototype.toggle=function(){this[this.$element.hasClass("in")?"hide":"show"]()},d.prototype.getParent=function(){return a(this.options.parent).find('[data-toggle="collapse"][data-parent="'+this.options.parent+'"]').each(a.proxy(function(c,d){var e=a(d);this.addAriaAndCollapsedClass(b(e),e)},this)).end()},d.prototype.addAriaAndCollapsedClass=function(a,b){var c=a.hasClass("in");a.attr("aria-expanded",c),b.toggleClass("collapsed",!c).attr("aria-expanded",c)};var e=a.fn.collapse;a.fn.collapse=c,a.fn.collapse.Constructor=d,a.fn.collapse.noConflict=function(){return a.fn.collapse=e,this},a(document).on("click.bs.collapse.data-api",'[data-toggle="collapse"]',function(d){var e=a(this);e.attr("data-target")||d.preventDefault();var f=b(e),g=f.data("bs.collapse"),h=g?"toggle":e.data();c.call(f,h)})}(jQuery),+function(a){function b(b){var c=b.attr("data-target");c||(c=b.attr("href"),c=c&&/#[A-Za-z]/.test(c)&&c.replace(/.*(?=#[^\s]*$)/,""));var d=c&&a(c);return d&&d.length?d:b.parent()}function c(c){c&&3===c.which||(a(e).remove(),a(f).each(function(){var d=a(this),e=b(d),f={relatedTarget:this};e.hasClass("open")&&(c&&"click"==c.type&&/input|textarea/i.test(c.target.tagName)&&a.contains(e[0],c.target)||(e.trigger(c=a.Event("hide.bs.dropdown",f)),c.isDefaultPrevented()||(d.attr("aria-expanded","false"),e.removeClass("open").trigger(a.Event("hidden.bs.dropdown",f)))))}))}function d(b){return this.each(function(){var c=a(this),d=c.data("bs.dropdown");d||c.data("bs.dropdown",d=new g(this)),"string"==typeof b&&d[b].call(c)})}var e=".dropdown-backdrop",f='[data-toggle="dropdown"]',g=function(b){a(b).on("click.bs.dropdown",this.toggle)};g.VERSION="3.3.7",g.prototype.toggle=function(d){var e=a(this);if(!e.is(".disabled, :disabled")){var f=b(e),g=f.hasClass("open");if(c(),!g){"ontouchstart"in document.documentElement&&!f.closest(".navbar-nav").length&&a(document.createElement("div")).addClass("dropdown-backdrop").insertAfter(a(this)).on("click",c);var h={relatedTarget:this};if(f.trigger(d=a.Event("show.bs.dropdown",h)),d.isDefaultPrevented())return;e.trigger("focus").attr("aria-expanded","true"),f.toggleClass("open").trigger(a.Event("shown.bs.dropdown",h))}return!1}},g.prototype.keydown=function(c){if(/(38|40|27|32)/.test(c.which)&&!/input|textarea/i.test(c.target.tagName)){var d=a(this);if(c.preventDefault(),c.stopPropagation(),!d.is(".disabled, :disabled")){var e=b(d),g=e.hasClass("open");if(!g&&27!=c.which||g&&27==c.which)return 27==c.which&&e.find(f).trigger("focus"),d.trigger("click");var h=" li:not(.disabled):visible a",i=e.find(".dropdown-menu"+h);if(i.length){var j=i.index(c.target);38==c.which&&j>0&&j--,40==c.which&&j<i.length-1&&j++,~j||(j=0),i.eq(j).trigger("focus")}}}};var h=a.fn.dropdown;a.fn.dropdown=d,a.fn.dropdown.Constructor=g,a.fn.dropdown.noConflict=function(){return a.fn.dropdown=h,this},a(document).on("click.bs.dropdown.data-api",c).on("click.bs.dropdown.data-api",".dropdown form",function(a){a.stopPropagation()}).on("click.bs.dropdown.data-api",f,g.prototype.toggle).on("keydown.bs.dropdown.data-api",f,g.prototype.keydown).on("keydown.bs.dropdown.data-api",".dropdown-menu",g.prototype.keydown)}(jQuery),+function(a){function b(b,d){return this.each(function(){var e=a(this),f=e.data("bs.modal"),g=a.extend({},c.DEFAULTS,e.data(),"object"==typeof b&&b);f||e.data("bs.modal",f=new c(this,g)),"string"==typeof b?f[b](d):g.show&&f.show(d)})}var c=function(b,c){this.options=c,this.$body=a(document.body),this.$element=a(b),this.$dialog=this.$element.find(".modal-dialog"),this.$backdrop=null,this.isShown=null,this.originalBodyPad=null,this.scrollbarWidth=0,this.ignoreBackdropClick=!1,this.options.remote&&this.$element.find(".modal-content").load(this.options.remote,a.proxy(function(){this.$element.trigger("loaded.bs.modal")},this))};c.VERSION="3.3.7",c.TRANSITION_DURATION=300,c.BACKDROP_TRANSITION_DURATION=150,c.DEFAULTS={backdrop:!0,keyboard:!0,show:!0},c.prototype.toggle=function(a){return this.isShown?this.hide():this.show(a)},c.prototype.show=function(b){var d=this,e=a.Event("show.bs.modal",{relatedTarget:b});this.$element.trigger(e),this.isShown||e.isDefaultPrevented()||(this.isShown=!0,this.checkScrollbar(),this.setScrollbar(),this.$body.addClass("modal-open"),this.escape(),this.resize(),this.$element.on("click.dismiss.bs.modal",'[data-dismiss="modal"]',a.proxy(this.hide,this)),this.$dialog.on("mousedown.dismiss.bs.modal",function(){d.$element.one("mouseup.dismiss.bs.modal",function(b){a(b.target).is(d.$element)&&(d.ignoreBackdropClick=!0)})}),this.backdrop(function(){var e=a.support.transition&&d.$element.hasClass("fade");d.$element.parent().length||d.$element.appendTo(d.$body),d.$element.show().scrollTop(0),d.adjustDialog(),e&&d.$element[0].offsetWidth,d.$element.addClass("in"),d.enforceFocus();var f=a.Event("shown.bs.modal",{relatedTarget:b});e?d.$dialog.one("bsTransitionEnd",function(){d.$element.trigger("focus").trigger(f)}).emulateTransitionEnd(c.TRANSITION_DURATION):d.$element.trigger("focus").trigger(f)}))},c.prototype.hide=function(b){b&&b.preventDefault(),b=a.Event("hide.bs.modal"),this.$element.trigger(b),this.isShown&&!b.isDefaultPrevented()&&(this.isShown=!1,this.escape(),this.resize(),a(document).off("focusin.bs.modal"),this.$element.removeClass("in").off("click.dismiss.bs.modal").off("mouseup.dismiss.bs.modal"),this.$dialog.off("mousedown.dismiss.bs.modal"),a.support.transition&&this.$element.hasClass("fade")?this.$element.one("bsTransitionEnd",a.proxy(this.hideModal,this)).emulateTransitionEnd(c.TRANSITION_DURATION):this.hideModal())},c.prototype.enforceFocus=function(){a(document).off("focusin.bs.modal").on("focusin.bs.modal",a.proxy(function(a){document===a.target||this.$element[0]===a.target||this.$element.has(a.target).length||this.$element.trigger("focus")},this))},c.prototype.escape=function(){this.isShown&&this.options.keyboard?this.$element.on("keydown.dismiss.bs.modal",a.proxy(function(a){27==a.which&&this.hide()},this)):this.isShown||this.$element.off("keydown.dismiss.bs.modal")},c.prototype.resize=function(){this.isShown?a(window).on("resize.bs.modal",a.proxy(this.handleUpdate,this)):a(window).off("resize.bs.modal")},c.prototype.hideModal=function(){var a=this;this.$element.hide(),this.backdrop(function(){a.$body.removeClass("modal-open"),a.resetAdjustments(),a.resetScrollbar(),a.$element.trigger("hidden.bs.modal")})},c.prototype.removeBackdrop=function(){this.$backdrop&&this.$backdrop.remove(),this.$backdrop=null},c.prototype.backdrop=function(b){var d=this,e=this.$element.hasClass("fade")?"fade":"";if(this.isShown&&this.options.backdrop){var f=a.support.transition&&e;if(this.$backdrop=a(document.createElement("div")).addClass("modal-backdrop "+e).appendTo(this.$body),this.$element.on("click.dismiss.bs.modal",a.proxy(function(a){return this.ignoreBackdropClick?void(this.ignoreBackdropClick=!1):void(a.target===a.currentTarget&&("static"==this.options.backdrop?this.$element[0].focus():this.hide()))},this)),f&&this.$backdrop[0].offsetWidth,this.$backdrop.addClass("in"),!b)return;f?this.$backdrop.one("bsTransitionEnd",b).emulateTransitionEnd(c.BACKDROP_TRANSITION_DURATION):b()}else if(!this.isShown&&this.$backdrop){this.$backdrop.removeClass("in");var g=function(){d.removeBackdrop(),b&&b()};a.support.transition&&this.$element.hasClass("fade")?this.$backdrop.one("bsTransitionEnd",g).emulateTransitionEnd(c.BACKDROP_TRANSITION_DURATION):g()}else b&&b()},c.prototype.handleUpdate=function(){this.adjustDialog()},c.prototype.adjustDialog=function(){var a=this.$element[0].scrollHeight>document.documentElement.clientHeight;this.$element.css({paddingLeft:!this.bodyIsOverflowing&&a?this.scrollbarWidth:"",paddingRight:this.bodyIsOverflowing&&!a?this.scrollbarWidth:""})},c.prototype.resetAdjustments=function(){this.$element.css({paddingLeft:"",paddingRight:""})},c.prototype.checkScrollbar=function(){var a=window.innerWidth;if(!a){var b=document.documentElement.getBoundingClientRect();a=b.right-Math.abs(b.left)}this.bodyIsOverflowing=document.body.clientWidth<a,this.scrollbarWidth=this.measureScrollbar()},c.prototype.setScrollbar=function(){var a=parseInt(this.$body.css("padding-right")||0,10);this.originalBodyPad=document.body.style.paddingRight||"",this.bodyIsOverflowing&&this.$body.css("padding-right",a+this.scrollbarWidth)},c.prototype.resetScrollbar=function(){this.$body.css("padding-right",this.originalBodyPad)},c.prototype.measureScrollbar=function(){var a=document.createElement("div");a.className="modal-scrollbar-measure",this.$body.append(a);var b=a.offsetWidth-a.clientWidth;return this.$body[0].removeChild(a),b};var d=a.fn.modal;a.fn.modal=b,a.fn.modal.Constructor=c,a.fn.modal.noConflict=function(){return a.fn.modal=d,this},a(document).on("click.bs.modal.data-api",'[data-toggle="modal"]',function(c){var d=a(this),e=d.attr("href"),f=a(d.attr("data-target")||e&&e.replace(/.*(?=#[^\s]+$)/,"")),g=f.data("bs.modal")?"toggle":a.extend({remote:!/#/.test(e)&&e},f.data(),d.data());d.is("a")&&c.preventDefault(),f.one("show.bs.modal",function(a){a.isDefaultPrevented()||f.one("hidden.bs.modal",function(){d.is(":visible")&&d.trigger("focus")})}),b.call(f,g,this)})}(jQuery),+function(a){function b(b){return this.each(function(){var d=a(this),e=d.data("bs.tooltip"),f="object"==typeof b&&b;!e&&/destroy|hide/.test(b)||(e||d.data("bs.tooltip",e=new c(this,f)),"string"==typeof b&&e[b]())})}var c=function(a,b){this.type=null,this.options=null,this.enabled=null,this.timeout=null,this.hoverState=null,this.$element=null,this.inState=null,this.init("tooltip",a,b)};c.VERSION="3.3.7",c.TRANSITION_DURATION=150,c.DEFAULTS={animation:!0,placement:"top",selector:!1,template:'<div class="tooltip" role="tooltip"><div class="tooltip-arrow"></div><div class="tooltip-inner"></div></div>',trigger:"hover focus",title:"",delay:0,html:!1,container:!1,viewport:{selector:"body",padding:0}},c.prototype.init=function(b,c,d){if(this.enabled=!0,this.type=b,this.$element=a(c),this.options=this.getOptions(d),this.$viewport=this.options.viewport&&a(a.isFunction(this.options.viewport)?this.options.viewport.call(this,this.$element):this.options.viewport.selector||this.options.viewport),this.inState={click:!1,hover:!1,focus:!1},this.$element[0]instanceof document.constructor&&!this.options.selector)throw new Error("`selector` option must be specified when initializing "+this.type+" on the window.document object!");for(var e=this.options.trigger.split(" "),f=e.length;f--;){var g=e[f];if("click"==g)this.$element.on("click."+this.type,this.options.selector,a.proxy(this.toggle,this));else if("manual"!=g){var h="hover"==g?"mouseenter":"focusin",i="hover"==g?"mouseleave":"focusout";this.$element.on(h+"."+this.type,this.options.selector,a.proxy(this.enter,this)),this.$element.on(i+"."+this.type,this.options.selector,a.proxy(this.leave,this))}}this.options.selector?this._options=a.extend({},this.options,{trigger:"manual",selector:""}):this.fixTitle()},c.prototype.getDefaults=function(){return c.DEFAULTS},c.prototype.getOptions=function(b){return b=a.extend({},this.getDefaults(),this.$element.data(),b),b.delay&&"number"==typeof b.delay&&(b.delay={show:b.delay,hide:b.delay}),b},c.prototype.getDelegateOptions=function(){var b={},c=this.getDefaults();return this._options&&a.each(this._options,function(a,d){c[a]!=d&&(b[a]=d)}),b},c.prototype.enter=function(b){var c=b instanceof this.constructor?b:a(b.currentTarget).data("bs."+this.type);return c||(c=new this.constructor(b.currentTarget,this.getDelegateOptions()),a(b.currentTarget).data("bs."+this.type,c)),b instanceof a.Event&&(c.inState["focusin"==b.type?"focus":"hover"]=!0),c.tip().hasClass("in")||"in"==c.hoverState?void(c.hoverState="in"):(clearTimeout(c.timeout),c.hoverState="in",c.options.delay&&c.options.delay.show?void(c.timeout=setTimeout(function(){"in"==c.hoverState&&c.show()},c.options.delay.show)):c.show())},c.prototype.isInStateTrue=function(){for(var a in this.inState)if(this.inState[a])return!0;return!1},c.prototype.leave=function(b){var c=b instanceof this.constructor?b:a(b.currentTarget).data("bs."+this.type);if(c||(c=new this.constructor(b.currentTarget,this.getDelegateOptions()),a(b.currentTarget).data("bs."+this.type,c)),b instanceof a.Event&&(c.inState["focusout"==b.type?"focus":"hover"]=!1),!c.isInStateTrue())return clearTimeout(c.timeout),c.hoverState="out",c.options.delay&&c.options.delay.hide?void(c.timeout=setTimeout(function(){"out"==c.hoverState&&c.hide()},c.options.delay.hide)):c.hide()},c.prototype.show=function(){var b=a.Event("show.bs."+this.type);if(this.hasContent()&&this.enabled){this.$element.trigger(b);var d=a.contains(this.$element[0].ownerDocument.documentElement,this.$element[0]);if(b.isDefaultPrevented()||!d)return;var e=this,f=this.tip(),g=this.getUID(this.type);this.setContent(),f.attr("id",g),this.$element.attr("aria-describedby",g),this.options.animation&&f.addClass("fade");var h="function"==typeof this.options.placement?this.options.placement.call(this,f[0],this.$element[0]):this.options.placement,i=/\s?auto?\s?/i,j=i.test(h);j&&(h=h.replace(i,"")||"top"),f.detach().css({top:0,left:0,display:"block"}).addClass(h).data("bs."+this.type,this),this.options.container?f.appendTo(this.options.container):f.insertAfter(this.$element),this.$element.trigger("inserted.bs."+this.type);var k=this.getPosition(),l=f[0].offsetWidth,m=f[0].offsetHeight;if(j){var n=h,o=this.getPosition(this.$viewport);h="bottom"==h&&k.bottom+m>o.bottom?"top":"top"==h&&k.top-m<o.top?"bottom":"right"==h&&k.right+l>o.width?"left":"left"==h&&k.left-l<o.left?"right":h,f.removeClass(n).addClass(h)}var p=this.getCalculatedOffset(h,k,l,m);this.applyPlacement(p,h);var q=function(){var a=e.hoverState;e.$element.trigger("shown.bs."+e.type),e.hoverState=null,"out"==a&&e.leave(e)};a.support.transition&&this.$tip.hasClass("fade")?f.one("bsTransitionEnd",q).emulateTransitionEnd(c.TRANSITION_DURATION):q()}},c.prototype.applyPlacement=function(b,c){var d=this.tip(),e=d[0].offsetWidth,f=d[0].offsetHeight,g=parseInt(d.css("margin-top"),10),h=parseInt(d.css("margin-left"),10);isNaN(g)&&(g=0),isNaN(h)&&(h=0),b.top+=g,b.left+=h,a.offset.setOffset(d[0],a.extend({using:function(a){d.css({top:Math.round(a.top),left:Math.round(a.left)})}},b),0),d.addClass("in");var i=d[0].offsetWidth,j=d[0].offsetHeight;"top"==c&&j!=f&&(b.top=b.top+f-j);var k=this.getViewportAdjustedDelta(c,b,i,j);k.left?b.left+=k.left:b.top+=k.top;var l=/top|bottom/.test(c),m=l?2*k.left-e+i:2*k.top-f+j,n=l?"offsetWidth":"offsetHeight";d.offset(b),this.replaceArrow(m,d[0][n],l)},c.prototype.replaceArrow=function(a,b,c){this.arrow().css(c?"left":"top",50*(1-a/b)+"%").css(c?"top":"left","")},c.prototype.setContent=function(){var a=this.tip(),b=this.getTitle();a.find(".tooltip-inner")[this.options.html?"html":"text"](b),a.removeClass("fade in top bottom left right")},c.prototype.hide=function(b){function d(){"in"!=e.hoverState&&f.detach(),e.$element&&e.$element.removeAttr("aria-describedby").trigger("hidden.bs."+e.type),b&&b()}var e=this,f=a(this.$tip),g=a.Event("hide.bs."+this.type);if(this.$element.trigger(g),!g.isDefaultPrevented())return f.removeClass("in"),a.support.transition&&f.hasClass("fade")?f.one("bsTransitionEnd",d).emulateTransitionEnd(c.TRANSITION_DURATION):d(),this.hoverState=null,this},c.prototype.fixTitle=function(){var a=this.$element;(a.attr("title")||"string"!=typeof a.attr("data-original-title"))&&a.attr("data-original-title",a.attr("title")||"").attr("title","")},c.prototype.hasContent=function(){return this.getTitle()},c.prototype.getPosition=function(b){b=b||this.$element;var c=b[0],d="BODY"==c.tagName,e=c.getBoundingClientRect();null==e.width&&(e=a.extend({},e,{width:e.right-e.left,height:e.bottom-e.top}));var f=window.SVGElement&&c instanceof window.SVGElement,g=d?{top:0,left:0}:f?null:b.offset(),h={scroll:d?document.documentElement.scrollTop||document.body.scrollTop:b.scrollTop()},i=d?{width:a(window).width(),height:a(window).height()}:null;return a.extend({},e,h,i,g)},c.prototype.getCalculatedOffset=function(a,b,c,d){return"bottom"==a?{top:b.top+b.height,left:b.left+b.width/2-c/2}:"top"==a?{top:b.top-d,left:b.left+b.width/2-c/2}:"left"==a?{top:b.top+b.height/2-d/2,left:b.left-c}:{top:b.top+b.height/2-d/2,left:b.left+b.width}},c.prototype.getViewportAdjustedDelta=function(a,b,c,d){var e={top:0,left:0};if(!this.$viewport)return e;var f=this.options.viewport&&this.options.viewport.padding||0,g=this.getPosition(this.$viewport);if(/right|left/.test(a)){var h=b.top-f-g.scroll,i=b.top+f-g.scroll+d;h<g.top?e.top=g.top-h:i>g.top+g.height&&(e.top=g.top+g.height-i)}else{var j=b.left-f,k=b.left+f+c;j<g.left?e.left=g.left-j:k>g.right&&(e.left=g.left+g.width-k)}return e},c.prototype.getTitle=function(){var a,b=this.$element,c=this.options;return a=b.attr("data-original-title")||("function"==typeof c.title?c.title.call(b[0]):c.title)},c.prototype.getUID=function(a){do a+=~~(1e6*Math.random());while(document.getElementById(a));return a},c.prototype.tip=function(){if(!this.$tip&&(this.$tip=a(this.options.template),1!=this.$tip.length))throw new Error(this.type+" `template` option must consist of exactly 1 top-level element!");return this.$tip},c.prototype.arrow=function(){return this.$arrow=this.$arrow||this.tip().find(".tooltip-arrow")},c.prototype.enable=function(){this.enabled=!0},c.prototype.disable=function(){this.enabled=!1},c.prototype.toggleEnabled=function(){this.enabled=!this.enabled},c.prototype.toggle=function(b){var c=this;b&&(c=a(b.currentTarget).data("bs."+this.type),c||(c=new this.constructor(b.currentTarget,this.getDelegateOptions()),a(b.currentTarget).data("bs."+this.type,c))),b?(c.inState.click=!c.inState.click,c.isInStateTrue()?c.enter(c):c.leave(c)):c.tip().hasClass("in")?c.leave(c):c.enter(c)},c.prototype.destroy=function(){var a=this;clearTimeout(this.timeout),this.hide(function(){a.$element.off("."+a.type).removeData("bs."+a.type),a.$tip&&a.$tip.detach(),a.$tip=null,a.$arrow=null,a.$viewport=null,a.$element=null})};var d=a.fn.tooltip;a.fn.tooltip=b,a.fn.tooltip.Constructor=c,a.fn.tooltip.noConflict=function(){return a.fn.tooltip=d,this}}(jQuery),+function(a){function b(b){return this.each(function(){var d=a(this),e=d.data("bs.popover"),f="object"==typeof b&&b;!e&&/destroy|hide/.test(b)||(e||d.data("bs.popover",e=new c(this,f)),"string"==typeof b&&e[b]())})}var c=function(a,b){this.init("popover",a,b)};if(!a.fn.tooltip)throw new Error("Popover requires tooltip.js");c.VERSION="3.3.7",c.DEFAULTS=a.extend({},a.fn.tooltip.Constructor.DEFAULTS,{placement:"right",trigger:"click",content:"",template:'<div class="popover" role="tooltip"><div class="arrow"></div><h3 class="popover-title"></h3><div class="popover-content"></div></div>'}),c.prototype=a.extend({},a.fn.tooltip.Constructor.prototype),c.prototype.constructor=c,c.prototype.getDefaults=function(){return c.DEFAULTS},c.prototype.setContent=function(){var a=this.tip(),b=this.getTitle(),c=this.getContent();a.find(".popover-title")[this.options.html?"html":"text"](b),a.find(".popover-content").children().detach().end()[this.options.html?"string"==typeof c?"html":"append":"text"](c),a.removeClass("fade top bottom left right in"),a.find(".popover-title").html()||a.find(".popover-title").hide()},c.prototype.hasContent=function(){return this.getTitle()||this.getContent()},c.prototype.getContent=function(){var a=this.$element,b=this.options;return a.attr("data-content")||("function"==typeof b.content?b.content.call(a[0]):b.content)},c.prototype.arrow=function(){return this.$arrow=this.$arrow||this.tip().find(".arrow")};var d=a.fn.popover;a.fn.popover=b,a.fn.popover.Constructor=c,a.fn.popover.noConflict=function(){return a.fn.popover=d,this}}(jQuery),+function(a){function b(c,d){this.$body=a(document.body),this.$scrollElement=a(a(c).is(document.body)?window:c),this.options=a.extend({},b.DEFAULTS,d),this.selector=(this.options.target||"")+" .nav li > a",this.offsets=[],this.targets=[],this.activeTarget=null,this.scrollHeight=0,this.$scrollElement.on("scroll.bs.scrollspy",a.proxy(this.process,this)),this.refresh(),this.process()}function c(c){return this.each(function(){var d=a(this),e=d.data("bs.scrollspy"),f="object"==typeof c&&c;e||d.data("bs.scrollspy",e=new b(this,f)),"string"==typeof c&&e[c]()})}b.VERSION="3.3.7",b.DEFAULTS={offset:10},b.prototype.getScrollHeight=function(){return this.$scrollElement[0].scrollHeight||Math.max(this.$body[0].scrollHeight,document.documentElement.scrollHeight)},b.prototype.refresh=function(){var b=this,c="offset",d=0;this.offsets=[],this.targets=[],this.scrollHeight=this.getScrollHeight(),a.isWindow(this.$scrollElement[0])||(c="position",d=this.$scrollElement.scrollTop()),this.$body.find(this.selector).map(function(){var b=a(this),e=b.data("target")||b.attr("href"),f=/^#./.test(e)&&a(e);return f&&f.length&&f.is(":visible")&&[[f[c]().top+d,e]]||null}).sort(function(a,b){return a[0]-b[0]}).each(function(){b.offsets.push(this[0]),b.targets.push(this[1])})},b.prototype.process=function(){var a,b=this.$scrollElement.scrollTop()+this.options.offset,c=this.getScrollHeight(),d=this.options.offset+c-this.$scrollElement.height(),e=this.offsets,f=this.targets,g=this.activeTarget;if(this.scrollHeight!=c&&this.refresh(),b>=d)return g!=(a=f[f.length-1])&&this.activate(a);if(g&&b<e[0])return this.activeTarget=null,this.clear();for(a=e.length;a--;)g!=f[a]&&b>=e[a]&&(void 0===e[a+1]||b<e[a+1])&&this.activate(f[a])},b.prototype.activate=function(b){
this.activeTarget=b,this.clear();var c=this.selector+'[data-target="'+b+'"],'+this.selector+'[href="'+b+'"]',d=a(c).parents("li").addClass("active");d.parent(".dropdown-menu").length&&(d=d.closest("li.dropdown").addClass("active")),d.trigger("activate.bs.scrollspy")},b.prototype.clear=function(){a(this.selector).parentsUntil(this.options.target,".active").removeClass("active")};var d=a.fn.scrollspy;a.fn.scrollspy=c,a.fn.scrollspy.Constructor=b,a.fn.scrollspy.noConflict=function(){return a.fn.scrollspy=d,this},a(window).on("load.bs.scrollspy.data-api",function(){a('[data-spy="scroll"]').each(function(){var b=a(this);c.call(b,b.data())})})}(jQuery),+function(a){function b(b){return this.each(function(){var d=a(this),e=d.data("bs.tab");e||d.data("bs.tab",e=new c(this)),"string"==typeof b&&e[b]()})}var c=function(b){this.element=a(b)};c.VERSION="3.3.7",c.TRANSITION_DURATION=150,c.prototype.show=function(){var b=this.element,c=b.closest("ul:not(.dropdown-menu)"),d=b.data("target");if(d||(d=b.attr("href"),d=d&&d.replace(/.*(?=#[^\s]*$)/,"")),!b.parent("li").hasClass("active")){var e=c.find(".active:last a"),f=a.Event("hide.bs.tab",{relatedTarget:b[0]}),g=a.Event("show.bs.tab",{relatedTarget:e[0]});if(e.trigger(f),b.trigger(g),!g.isDefaultPrevented()&&!f.isDefaultPrevented()){var h=a(d);this.activate(b.closest("li"),c),this.activate(h,h.parent(),function(){e.trigger({type:"hidden.bs.tab",relatedTarget:b[0]}),b.trigger({type:"shown.bs.tab",relatedTarget:e[0]})})}}},c.prototype.activate=function(b,d,e){function f(){g.removeClass("active").find("> .dropdown-menu > .active").removeClass("active").end().find('[data-toggle="tab"]').attr("aria-expanded",!1),b.addClass("active").find('[data-toggle="tab"]').attr("aria-expanded",!0),h?(b[0].offsetWidth,b.addClass("in")):b.removeClass("fade"),b.parent(".dropdown-menu").length&&b.closest("li.dropdown").addClass("active").end().find('[data-toggle="tab"]').attr("aria-expanded",!0),e&&e()}var g=d.find("> .active"),h=e&&a.support.transition&&(g.length&&g.hasClass("fade")||!!d.find("> .fade").length);g.length&&h?g.one("bsTransitionEnd",f).emulateTransitionEnd(c.TRANSITION_DURATION):f(),g.removeClass("in")};var d=a.fn.tab;a.fn.tab=b,a.fn.tab.Constructor=c,a.fn.tab.noConflict=function(){return a.fn.tab=d,this};var e=function(c){c.preventDefault(),b.call(a(this),"show")};a(document).on("click.bs.tab.data-api",'[data-toggle="tab"]',e).on("click.bs.tab.data-api",'[data-toggle="pill"]',e)}(jQuery),+function(a){function b(b){return this.each(function(){var d=a(this),e=d.data("bs.affix"),f="object"==typeof b&&b;e||d.data("bs.affix",e=new c(this,f)),"string"==typeof b&&e[b]()})}var c=function(b,d){this.options=a.extend({},c.DEFAULTS,d),this.$target=a(this.options.target).on("scroll.bs.affix.data-api",a.proxy(this.checkPosition,this)).on("click.bs.affix.data-api",a.proxy(this.checkPositionWithEventLoop,this)),this.$element=a(b),this.affixed=null,this.unpin=null,this.pinnedOffset=null,this.checkPosition()};c.VERSION="3.3.7",c.RESET="affix affix-top affix-bottom",c.DEFAULTS={offset:0,target:window},c.prototype.getState=function(a,b,c,d){var e=this.$target.scrollTop(),f=this.$element.offset(),g=this.$target.height();if(null!=c&&"top"==this.affixed)return e<c&&"top";if("bottom"==this.affixed)return null!=c?!(e+this.unpin<=f.top)&&"bottom":!(e+g<=a-d)&&"bottom";var h=null==this.affixed,i=h?e:f.top,j=h?g:b;return null!=c&&e<=c?"top":null!=d&&i+j>=a-d&&"bottom"},c.prototype.getPinnedOffset=function(){if(this.pinnedOffset)return this.pinnedOffset;this.$element.removeClass(c.RESET).addClass("affix");var a=this.$target.scrollTop(),b=this.$element.offset();return this.pinnedOffset=b.top-a},c.prototype.checkPositionWithEventLoop=function(){setTimeout(a.proxy(this.checkPosition,this),1)},c.prototype.checkPosition=function(){if(this.$element.is(":visible")){var b=this.$element.height(),d=this.options.offset,e=d.top,f=d.bottom,g=Math.max(a(document).height(),a(document.body).height());"object"!=typeof d&&(f=e=d),"function"==typeof e&&(e=d.top(this.$element)),"function"==typeof f&&(f=d.bottom(this.$element));var h=this.getState(g,b,e,f);if(this.affixed!=h){null!=this.unpin&&this.$element.css("top","");var i="affix"+(h?"-"+h:""),j=a.Event(i+".bs.affix");if(this.$element.trigger(j),j.isDefaultPrevented())return;this.affixed=h,this.unpin="bottom"==h?this.getPinnedOffset():null,this.$element.removeClass(c.RESET).addClass(i).trigger(i.replace("affix","affixed")+".bs.affix")}"bottom"==h&&this.$element.offset({top:g-b-f})}};var d=a.fn.affix;a.fn.affix=b,a.fn.affix.Constructor=c,a.fn.affix.noConflict=function(){return a.fn.affix=d,this},a(window).on("load",function(){a('[data-spy="affix"]').each(function(){var c=a(this),d=c.data();d.offset=d.offset||{},null!=d.offsetBottom&&(d.offset.bottom=d.offsetBottom),null!=d.offsetTop&&(d.offset.top=d.offsetTop),b.call(c,d)})})}(jQuery);
define("bootstrap/js", ["jquery"], function(){});

define('loadCss',['text'], function (text) {
    
    

    var cssOutDir;
    var dirBaseUrl;
    var buildMap = {};
    var cssConfig;
    var cssLocation = {};

    function checkIfLoaded(link, fn) {
        var engine = window.navigator.userAgent.match(/Trident\/([^ ;]*)|AppleWebKit\/([^ ;]*)|Opera\/([^ ;]*)|rv\:([^ ;]*)(.*?)Gecko\/([^ ;]*)|MSIE\s([^ ;]*)|AndroidWebKit\/([^ ;]*)/) || 0,
            loadInterval,
            useOnload,
            key;

        if (engine[2] || engine[8]) {
            useOnload = false;
        }

        if (useOnload) {
            link.onload = function () {
                link.onload = function () {
                };
                setTimeout(fn, 7);
            }
        } else {
            loadInterval = setInterval(function () {
                for (key in document.styleSheets) {
                    if (document.styleSheets.hasOwnProperty(key)) {
                        if (document.styleSheets[key].href === link.href) {
                            clearInterval(loadInterval);
                            fn();
                        }
                    }
                }
            }, 10);
        }
    }

    return {
        load: function (name, req, onLoad, config) {
            if (config.isBuild && ((req.toUrl(name).indexOf('empty:') === 0) || (req.toUrl(name).indexOf('http:') === 0) || (req.toUrl(name).indexOf('https:') === 0))) {
                //avoid inlining cache busted JSON or if inlineJSON:false
                //and don't inline files marked as empty!
                onLoad(null);
            } else {
                if (config.isBuild) {
                    cssConfig = config.css;

                    if (config.cssOutDir) {
                        cssOutDir = config.cssOutDir;
                    } else {
                        throw new Error('Must specify \'cssOutDir\' config parameter');
                    }

                    dirBaseUrl = config.dirBaseUrl;

                    var file = req.toUrl(name);
                    file = file.replace(config.dirBaseUrl, '') + '.css';

                    buildMap[name] = file;

                    onLoad();
                } else {

                    debugger;

                    var parsed = text.parseName(name),
                        nonStripName = parsed.moduleName + (parsed.ext ? '.' + parsed.ext : '')
                    
                    var url = req.toUrl("css.css");
                                        
                    if (config.cssConfig) {
                        if (config.cssConfig[name]) {
                            url = req.toUrl(config.cssConfig[name]);
                        }
                    }

                    var head = document.getElementsByTagName('head')[0],
                        dataSelector = nonStripName.replace(/\/|:|\./g, '-'),
                        link;

                    dataSelector = dataSelector.replace(/(\-+)/g, '-');

                    if (!document.querySelector('[data-css-loaded=' + dataSelector + ']')) {
                        link = document.createElement('link');

                        link.setAttribute('href', url);
                        link.setAttribute('rel', 'stylesheet');
                        link.setAttribute('type', 'text/css');

                        checkIfLoaded(link, function () {
                            link.setAttribute('data-css-loaded', dataSelector);
                            onLoad();
                        });

                        head.appendChild(link);
                    }
                }
            }
        },
        normalize: function (name, normalize) {
            if (name.substr(name.length - 4, 4) === '.css') {
                name = name.substr(0, name.length - 4);
            }
            return normalize(name);
        },
        write: function(pluginName, moduleName, write) {
            if (moduleName in buildMap) {
                var source = path.resolve(dirBaseUrl, buildMap[moduleName]);

                var found = "";
                var file = "css.css";

                if (cssConfig.bundles) {
                    for (var bundleName in cssConfig.bundles) {
                        var bundle = cssConfig.bundles[bundleName];
                        
                        for (var i = 0; i < bundle.length; i++) {
                            if (moduleName == bundle[i]) {
                                found = moduleName;
                                file = bundleName + ".css";
                                cssLocation[moduleName] = file;
                            }
                        }
                    }
                }

                var target = path.resolve(cssOutDir, file);

                var fs = require.nodeRequire('fs-extra');
                var css = require.nodeRequire('css');
                var util = require.nodeRequire('util');


                var cssConfTarget = path.resolve(cssOutDir, "css.js");
                fs.writeFileSync(cssConfTarget, "require.config({ cssConfig: " +  util.inspect(cssLocation) + "})", 'utf-8');
                
                text.get(source, function(data) {
                    fs.appendFileSync(target, data);

                    var dirSource = path.dirname(source);
                    var dirTarget = path.dirname(target);

                    var ast = css.parse(data);

                    for (var i = 0; i < ast.stylesheet.rules.length; i++) {
                        var rule = ast.stylesheet.rules[i];

                        if (rule.type == 'font-face') {
                            for (var j = 0; j < rule.declarations.length; j++) {
                                var declaration = rule.declarations[j];

                                if (declaration.property == 'src') {
                                    var matches = declaration.value.match(/url\((.*?)\)/g);

                                    for (var k = 0; k < matches.length; k++) {
                                        var url = matches[k];

                                        url = url.replace("\'", "");
                                        url = url.replace("\"", "");

                                        var from = url.indexOf("(");
                                        var to = url.lastIndexOf(")");

                                        url = url.substring(from + 1, to);

                                        var options = url.indexOf("?");

                                        if (options != -1) {
                                            url = url.substring(0, options);
                                        }

                                        var fontSource = path.resolve(dirSource, url);
                                        var fontTarget = path.resolve(dirTarget, url);

                                        fs.copySync(fontSource, fontTarget);
                                    }
                                }
                            }
                        }
                    }
                });
            }
        }
    }
});

define("json!qk-alchemy/main.json", function(){ return {
    "namespaces": {
        "layout": {
            "": "components/layout.component",
            "container": "components/layout/container.component",
            "navbar": {
                "": "components/layout/navbar.component",
                "button": "components/layout/navbar/button.component",
                "dropdown": {
                    "": "components/layout/navbar/dropdown.component",
                    "divider": "components/layout/navbar/dropdown/divider.component",
                    "header": "components/layout/navbar/dropdown/header.component",
                    "link": "components/layout/navbar/dropdown/link.component"
                },
                "link": "components/layout/navbar/link.component"
            },
            "sidebar": {
                "": "components/layout/sidebar.component",
                "imagebutton": "components/layout/sidebar/imagebutton.component",
                "link": "components/layout/sidebar/link.component",
                "search": "components/layout/sidebar/search.component",
                "title": "components/layout/sidebar/title.component"
            },
            "submenu": {
                "": "components/layout/submenu.component",
                "button": "components/layout/submenu/button.component"
            }
        },
        "pager": "components/pager.component",
        "panel-collapsable": "components/panel/collapsable.component",
        "switch": "components/switch.component"
    },
    "prefix": "al",
    "version": "0.5.1"
}
;});

/***************************************************************************************************
LoadingOverlay - A flexible loading overlay jQuery plugin
    Author          : Gaspare Sganga
    Version         : 1.5.4
    License         : MIT
    Documentation   : https://gasparesganga.com/labs/jquery-loading-overlay/
****************************************************************************************************/
!function(A,B){function C(C,g){var E=(C=A(C)).is("body"),I=C.data("LoadingOverlayCount");if(I===B&&(I=0),0===I){var o=A("<div>",{class:"loadingoverlay",css:{"background-color":g.color,position:"relative",display:"flex","flex-direction":"column","align-items":"center","justify-content":"center"}});if(g.zIndex!==B&&o.css("z-index",g.zIndex),g.image&&o.css({"background-image":"url("+g.image+")","background-position":g.imagePosition,"background-repeat":"no-repeat"}),g.fontawesome&&A("<div>",{class:"loadingoverlay_fontawesome "+g.fontawesome}).appendTo(o),g.custom&&A(g.custom).appendTo(o),E?o.css({position:"fixed",top:0,left:0,width:"100%",height:"100%"}):o.css("position","fixed"===C.css("position")?"fixed":"absolute"),Q(C,o,g,E),g.resizeInterval>0){var w=setInterval(function(){Q(C,o,g,E)},g.resizeInterval);C.data("LoadingOverlayResizeIntervalId",w)}g.fade?!0===g.fade?g.fade=[400,200]:"string"!=typeof g.fade&&"number"!=typeof g.fade||(g.fade=[g.fade,g.fade]):g.fade=[0,0],C.data({LoadingOverlay:o,LoadingOverlayFadeOutDuration:g.fade[1]}),o.hide().appendTo("body").fadeIn(g.fade[0])}I++,C.data("LoadingOverlayCount",I)}function g(C,g){var Q=(C=A(C)).data("LoadingOverlayCount");if(Q!==B)if(Q--,g||Q<=0){var E=C.data("LoadingOverlayResizeIntervalId");E&&clearInterval(E),C.data("LoadingOverlay").fadeOut(C.data("LoadingOverlayFadeOutDuration"),function(){A(this).remove()}),C.removeData(["LoadingOverlay","LoadingOverlayCount","LoadingOverlayFadeOutDuration","LoadingOverlayResizeIntervalId"])}else C.data("LoadingOverlayCount",Q)}function Q(B,C,g,Q){if(!Q){var E="fixed"===B.css("position")?B.position():B.offset();C.css({top:E.top+parseInt(B.css("border-top-width"),10),left:E.left+parseInt(B.css("border-left-width"),10),width:B.innerWidth(),height:B.innerHeight()})}var I=Q?A(window):B,o="auto";g.size&&"auto"!=g.size&&(o=Math.min(I.innerWidth(),I.innerHeight())*parseFloat(g.size)/100,g.maxSize&&o>parseInt(g.maxSize,10)&&(o=parseInt(g.maxSize,10)+"px"),g.minSize&&o<parseInt(g.minSize,10)&&(o=parseInt(g.minSize,10)+"px")),C.css("background-size",o),C.children(".loadingoverlay_fontawesome").css("font-size",o)}var E={color:"rgba(255, 255, 255, 0.8)",custom:"",fade:!0,fontawesome:"",image:"data:image/gif;base64,R0lGODlhZABkAKUAADQyNJyanGRmZMzOzExOTLS2tISChOzq7ERCRKyqrHR2dNze3FxaXMTCxIyOjPT29Dw6PKSipGxubNTW1FRWVLy+vIyKjPTy9ExKTLSytHx+fOTm5GRiZMzKzJSWlPz+/DQ2NJyenGxqbNTS1FRSVLy6vISGhOzu7ERGRKyurHx6fOTi5FxeXMTGxJSSlPz6/Dw+PKSmpHRydNza3P///wAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACH/C05FVFNDQVBFMi4wAwEAAAAh+QQJBQA0ACwAAAAAZABkAAAG/kCacEgsGo/IJO1SEEBAosJFSa1ar9jswQQBeAEgyyFLLpvNL893DXC9zvC4XDggsb+EwXzPtyZAd14gCX2FhkQRgIEAIYeOSAMWIgoxY1UpioEpj5xCFx6ZACQVH1QjFIt5nY8PIV1sKCtUaYsOpVcfb6tWM6iBJlUnJqEAJidYKxYaFbq7SSXEXxQPVQ8VEjBQFVNXDypeKCPOSR8ZiwAox50rLF8Z40kV0V7Tqw8WXgQT8EgzDIvAdm1I4WFAM35EPqSAcYeAul25ECZ5EYPAGgH7JGo08mFACAcOChy4tbHkkA8PDppcybKly5cwY8rc8+HEiBYDRs509qKF/goCCAhIaEBy56MBFtcQaGCU04ukbFgsaErlQAQFETZgGbAIRAmqEx0oskDNirlFMcAieWDHCwtZVkqce6fWyAMBXyQ8pHKCYcOMdROOEIBBQIssAQI5KBs44YEWcLGcELvGWONCHyZ40OBhQtHLoEOLHk26tOnTqFOrXs26tevXEj+0MCFDBTPYSi64QPAFhgFLrl8c2HCC5IsUvNeAiMB49YsCFBCwICrkgIRABICvboEBz1QaC7oHmuEa1JdBQhZAZfOdtXlBdE8oCERBa+tTX94KeZ58TYjPqfWkAAsaiDPEcX6B4UFzrV1wAoNCbBCCCSG0h9uFGGao4YYc/nbo4YcghijiiCW9sMEMG6i04QsjKKCICICJ9sACE6wAoRILcMAGBRZe9kIIDKDAQALcWBGCYgDWVcIrACBQQpJHtHOHAHs1dt0aGhRJhZRR2QeaCGwooKUSBgSiwY1qRcBGDCpCkqAgh4l2wpUAKOBlFS9UQIEiBFRQ2gsDFKAHGR8skEAIKSwAJYmMNuroo5BGSkSbHa6wmQEljNnJBzOMUGVJMxCgCAwWfOrIARpggAIFBSw6zgl4sZGAq3uc8M0ag5bUAApT0jrHAG8CoMFKBfQnDZp9tDDlSh3wyoYEvsoxgrNfOLDSA2Uq5ycuKzQAGaVHnOBCJrGwtEKsUwDAEAOyRbyQgQAoIMBBAeAasUEMArBgQq4rndCCB4myWwSwa8DAbzXDPRBtU/M9++E/O35I5xcCfNgAMdt2+EACe4JAAZsgvrBABRUsUK+knAQBACH5BAkFADQALAAAAABkAGQAAAb+QJpwSCwaj8gk7bNKaVSx2UtJrVqv2CytwgJ4AZTCVEsum7ED0veLaJzfcPhDsV4LTvG83jpR170oLXuDhEQdBH9eMBVXHwcHF4VnLwMJGQtXfYkAKB1VlBoMFAIekZJYLxMUXiAQBitVc5sseEovATB1LBMfp1Yjq3UyD1UtKH8gBVUNIIkSsL5KDxabjFQfBYhfMCljSQ8Cm8m90UgzXYkaVi8LMSoKIVJVExibACbE5Ucj2n8CvsbsScinr8gCBpvUnaJnTwPBgkMeGNhUwtcDdIlSkINI5NyfgdE6NPt4gOORCQJycbKwodyHEMfszDCJ5ESDFClGPLTYwgT+i1EhWtIcKu3AhhMbiSpdyrSp06dQoya5sOKEN6kcTyRQIEBGgFpYC14woRIACAklw+oLkMjATrVJUhWQ16jfGgoT4Fb50AIRCmtWLoysE0gvlRfUvGi4agtCok6GbYX44iApFTr+hEau6YKFAc1WOsT8Mm6zLataXlQIZrYEY9N6PjwYkKLFBcuwc+vezbu379/AgwsfTry48ePIk1950CFFA1PKr6GEQJ1ChdfIcS/gUAdDC9zFHzTI0ILgiwiDv6iAjjxFLgQJhpzQkIhAWuQXEHohkO8C/T8UgGbcA/qBkc956SnG3nHuAcANESuEs0Yg4BH3QgsFlEfEBzP+CNAMCAR8F91eM1QwwVsjpqjiiiy26OKLMMYo44w01gjXBy/kWCGLFxQgAgEsxADWbw9AosUDISCwhgUowvbBBBYoYMEA2CExgZJrwFCRb/l9wcJMV0SQiAm/ZVBHDDsWMdkfGqRpWAJ1hFClEQ0kEsJvE5S1CBYbSFAHAQLq9kIMx4AQQ5NIrKABCiDAIAAmwX1wVBkPTFBBBwvaqOmmnHbq6aegKiHpADrR+EIIBCCAggILuKnHCw1IwIADgQ71QQx1iABNNC806AUFmdJ0QoFfaFTOASLUkUJTE9jlRWXlLMDas01tQKwXIbgKxwEy1KFMUx78mRcWJ0wwwgFZ2grxQQn9CIBoVgqMRIAYjUxgAAkkKNDBnEY80JMGMdRK1AW0FbABv0WcgBEABOy63APpGlbAHx7IKGYdZMZY55kynuDnFwHOeIAHLLDgAKQzvnDCwaEqFQQAIfkECQUANAAsAAAAAGQAZAAABv5AmnBILBqPyKTwMqtUZheldEqtWq/ClQMDAMBMC6x4TMZeZKCuWnAou9/wGERN93zg+Dz1JaHTWSd6goNEJwJ+ahQrhIxJLxuBVQ8iiF0sG1QPJSYqHhONZh4YIBAsJQ9UEWmIJlQTHH4BkaBSJxZ+MCl3tYd+BItSGwyIICGotEoFMIgos0ozGnQCA1QhlQAUn8hIDwbXBVUnAyEhLSe7Si8s1wAF6NuFMtceoBcE7DEv8EYP0ZUpoD6s+7bPyIcEq+iAaAPKwzUUIwry8+ZHF60TFCqF0CexyAMHLFCgkFDhGK0BAhKC8BClo8EFA0Y4o/VhRQoLCjw04Oiy5/6RDw8u8PRJtKjRo0iTKh304cWDB++W7jtQwoUBFyU2RFXyYUIICwFabJX6TMGyLiAUaJvyogSFOQBQxCBb5YCChGpYmFQyAAGuDHSlvFA1j8otRApaBj5yQt41FoqTwELEIsziIxsGVvo1hRJlTJeNHNCMiABoJTHwdnEwNPQSE+wktD5yoA8dCpZdE/nQAsW1FlRqmlglIbduIg9CqAbA2grQE0+PI+FNAQYIGCwK7JWe58GEFiMicx9Pvrz58+jTq1/Pvr379/B9PtoeX8oFUTAQmFgxtj6RC7BJA4x/MPFHRAtcKJTAbO3NwAEGHMwwxAcxVKIBfe05oIYDRP5UiMiF/mm42oEJ0pECg+zNEJIAEg5xwWFrnFZfgVFdEAMB1zmglX/BncPjj0AGKeSQRBZp5JFIJqnkktx90B+RLyxQQAAVGHjkCw0M0wWL6b2wQgvGUZGZH7KdxxsLBHDQwBUNIALDWuRNEqMVKbgJnHkPZGRJmHyphsKA5L0QQBogOIAhEhf4syGKx52QggYxiDfFfQSgQIAHhwr5wQIj7Mjkp6CGKuqopJZqxQMrMKRkBwJggIEBgNLkaAAdZCrRAmd1IYGqtKiIlgtIueAHCHfS8oIHKvHqk2N0ZPBkHon6USxRDilEDTLJKTRTTyvco4YG23J1gY9XLHCXF08hJNWCCRRQ4IGMU5yQgAIyhKDsFDal0IKtEn1wwQYb8OtRAHCBYICkQq6QaxfXGjkDIhUguYFvaoDAp5AvxHDWSgL790IFJmignakk7xMEACH5BAkFADQALAAAAABkAGQAAAb+QJpwSCwaj8ik8HVaLU4vpXRKrVqvy4KKRFBkHtiweBxOoABoACxEbrvftMU5jYaN4Pj8NAKipy16gYJDJn5pEoOJeR6GaBpWJy0VM1GKVi8jFiwCMRsfVCMIhiANVCcBcyAsE5WWSh8Vc2giM1UOfXQarUkvFrhpJAOuUjMMhrpUFzEUaCghB1QTv7kXw0kxEKMnVS8bCxMbYFQBjQAEE9ZIjI3oihrlMB3pRzHTaduKDuUEd/NFEwQMsfikaEA5Afj8DfmQIVuac65evPODooXCIxUUsGDhYIG1Aw5kUahwEcmDDQd2uXowIEaMAh5LypxJs6bNmzhz6tzJM8/+hwUNSlRYoHLKiwElOlTrWeVBBhYw1LCIsZTKCg0EYKAQsYLplA8JRNGBwIbKAQl+KGzwqqRDwEbCpjQYFYEtkhchygFwQCXvMYJ2iVwoVA7RnkaPAhd5oK9wtKh0QJBUTORDCntp6k55EAIyGhPiKA9ZIaARCmjJCghAMTWhaCEfOshCA2FylQ8vHrwA/HrhBhMEUBDQsIB3bzgXNrg+zry58+fQo0ufTr269evYsy+ZUCJBgRnGtRtRxgAGBBgMElR90cGABBNEs58wYA+EhW0vEnjGUKGo9AKYAQBCATRMwAwdAqx1XWnliEBDBvbAYJF1L4jVCAw0pOBQGhL+XveCZ4ZgOAAJfrAQk3UMNiIADZz9AkIG/kWXgl4pCPFABQIQIMEAoVl3ggKNKLCceENsYIEsCDigIJFHsBSDByEMEB6TVFZp5ZVYZqnlllx26eWXrlwwQQcjDHnlBi6cAYMGSzrHxJRK4LUhACZAB5IA911xQIrNtNkbXn2A4AKcR6xwIIe1NNdLGirEeMQFKqTVY2+wqEmgFZWmAcKEzj0wQgEjTErFAhpQoICUYKaq6qqsturqq7CyekIMMijQgqOC4KYbTi/IkAYEMeCax1EahWDmRQbRwUJXwyzAILA3zUgHDO240gIGh9zUQYknWrIAC2mUVdMLaKEBQgpXwuLxQQkicHTsRRuEoIAGBVRFxQcTRBDCCOka0YSoND1wwgWEHhEbBRCAQEADBYt3QrloMPAukQccqgZqWV7gaxosTCzewSAoXEHDRC6QQAzFxaqyJUEAACH5BAkFADQALAAAAABkAGQAAAb+QJpwSCwaj8jk8HW5vJTQqHRKrQ4/q5jBEFt8rOCwGDzjgAAAEGsybrvftJcETQdwHvC8PjqA1dEgLXuDhEMlZ38gKYWMeg0Qf2gFVl+NYActIQkzeFInFJEoJ1IvAyowICQhF5ZTKxKIKKtTJSh1IJNRHw0EfxajrUovGn8wJZVQLxUKKCgKFZ1QD6CJGcFKAxiREk9SHxcbGyfIUB2RaAqs10cFCJEE3Ywp5wACG+tHLbZ/LPGFDfQkAMNH5AKHSCHIETrhJ5IHfwSFzOhFx8RARh8yNKQj4GLEIQs8KNBQIJqlBxkEwIBBQMW9jzCPfNjQocIEkzFz6tzJs6f+z59AgwodKuXBggkrcE45sAAiUSgzTHCgwMHCBIVKTgSgQIJDCqxPjUxg8YfBjCkXVPyJADaskAMizlFwemQAIjoEDrhF0mBfpAFS5hUDvNeI4HMxpBSIBINN4SIZ6AHIBWUFRTrcHhcZcPnPAlIFLlNwrHnIAwvnNFB5MSGEgxReShfZoOCPgBWUPrQt/SCFAgoSSsoeTry48ePIkytfzry58+fQoxN8sWDECrrSxWpgQIKFhs8FWySoMC76iwLa6pCoUIk2xxHRZ6T/QwH3C9R1FHhcHkFyAhorHFQHAfA9Vxs9qi1A1oCEOSeDZKo9YIJtej3ngWQhSLQgACj+tLDbcX2c05gQM8VgggcbYJfcCyHcBUgKKkp3ngAowIACBxXEmB0NGwxQwQD77SjkkEQWaeSRSCap5JJMjvHCDAM0teQHHQhAAAoYSNCCjkV8cMAKG3zo1gMxQLKWmEtUIAMLEmTAJVEdzFcHBA2WcxkMHRB3AX6poXnaHxIQt8GGkVBQoRIXEFMHC4JScw4BLwkTwh8OEAeXZBQodcQCAuAVaWksSlbpFA8U8FqQj73yqKY7jjBHHQKQduQGKWgggQYphDnlAxc8gGaTwAYr7LDEXkNdASVc8KseH7yJTwJmroHPASkEMICzrVzgFwAOsDrICw6gQYKsOS3wh35d16ywoTU8XWAmGiZ4u8cDagEAQ4E8hdAQC3W2soIJCpQgL0EXVOBBCFeB8QK2XQ4Mk25goMQCC24y2YI7HAqi5AcJ1JHAstA10BAMGiv5QAIEUJCAw0I2W+zLOgUBACH5BAkFADQALAAAAABkAGQAAAb+QJpwSCwaj8ikcslsOp/Q5WOQSAwe0ax2q724SAAQyYPlms9oWggEaIdj6bi8+cC43YTyfM+nLWB3bRAbfYVyB4CBMCeGjUMXAxUtBy9PKoEAGk4fBykqEh4TH45NByqJAh2VTQssdyyErDJsbSgNo6RJLw6BHCubCyEaGjELuEsvFrRuDAu5SQtggQXHTB8XJ9VLF4l3IHDPRx0omCHaewuYbQ7hRxvSdxWOJ8t3Ie1Gu4Gwjh8imDAG4DPywAQMEDAkiCI1gUKgGOcGflhRYYKefhNMUKAgIcXAj0pebFhwISLIkyhTqlzJsqXLlzBjSrlwUaajBxkMqDBQ4UL+lA0BNIQ4YJOOgW4IPPhs8qEFATcIJhQN6aBem3tNTly6I2HVVCMzXGEiYLLICjt3UBD9aqQFWkyMmKx4mjYuWyId6GKqieSBhUCa7hbZ8A8TiyczFNCS8EswkQ8prIKQt2lDixgtNpT9+iDGMhAp+FpznOTDhhgOUmQjzbq169ewY8ueTbu27du4c+vG9+KE193bEkgQoCDFbxovDmygtPvDBAnLIGhYS6OzHRQR7N4+IUOdgzIlusHwmLuD1TYEnL3Y6kbB0tsR1LXpgFxBIAnaaweQD4CyZ3vH0VaBfDBIRcMJVbVhQiy4bSBWIO4N8cAMFYlGW1N6tcHCDMD+KTGDRgRQ4ACDHSaxwgQHbFbiiiy26OKLMMYo44w01mgjEheEIAAFAiSQXxMvPBCgYx8M4NArBjoRjAUhzKCiTSsUFogAFhqxwixtCPCeYy8kcF4bLTAV2R0FtHaBAfyZAGR8d0TQmlb8KeBEBQjcIRBrD/AinwdOeEELGa19UEE3gYwAxQYVaPbaAy6cxyeMJ3hATi1KyThFAh6kYFGNHzx546egXvjAAQesZmkHDgyngY8xfhBBhiAY0FhKQb7gKRoNQKCOCVt+dEAIDCgwwK1cXPCgIregFAEtAsxayACTquPBkOF0Vwt9jRRQp3wmVJmLB26w4EwjLWzrHbVTz2xgAgsCVEDsFiccG4i7KT2wAHWOpCCfBCSyNoMLHoxLhwljLeRaK1n2q8QDFQhAAAoiesvWOOgZCsUDG8xQkmwIA9AsjR+MoIEJBodq8skDBQEAIfkECQUANAAsAAAAAGQAZAAABv5AmnBILBqPyKRyyWw6n9Dla1IqLV7RrHarfUQoMASrhOWaz2haAQJoA2CTtHzuZLndGrp+X8Tc2wJ8gnoCfwB5g4lDHxcbB2VOFWxuMAtPDxMpEQMnik8NKhwiKReXKSwwMAIVkEsXAShtICoHnkwTfm0wEQ9PLwstLRutSh8ZMH8mxLZFGn8EM4oPhX8o0cxHL3Z/A4ovsX8wDdhHHzLhcYkvFIYoI+RHDX8KnYkfAYYCvfBFHykEMFBo2GDrgAYQbggQ5HfkxABL2E4U0KDAw0KGGDNq3Mixo8ePIEOKHEmypMkPExIESLEiy4cBBWYsM3mkAAEIICBwaPHhyf6Kc20UlKKZpASyOyjSMXkRAKGbFESRXFBgCIADJyck/JER9ciCbX8CNTlB9Q6irkRWUAvr5MUxNyBaoC3ywETVGE9OhABDIcbMriMI/GFxscmDBRNW7JtL5MMIsBJm9GQ85/CEYZQza97MubPnz6BDix5NurTp06gZTghgIUZhIYxODD19wgUCWRgKtBqggoWKAZNJvwgxyQ0GnkJWsGvD4hrpDSSqahgaozgIvKVHVAVAYWEIpwBAhDDdYTsFiCNyAXBnegG4PxLqvSjAAAYFVqYfuDAEokLwDydscEJwpa2gAHggBLBYakY8UIACAmggF4MUVmjhhRhmqOGGHP526OGHIG7xwgABmBDBCgReeIBdlHgwmxMrDHBAinNdYAF4skQARQMCECCBUpR1oB5SCyqhlhsy/EXTBzFsB0A3TczAgBssFNnVcE5WgJUBsoSg5EkZ4HgHkEtsEIICMdST2QzLPUMjgwW810ZSGn5QgQAogICCAgN8idoHBwzQwgRqhmjooYiW9sIDfqb2wQoFeOBBAu/U2YEAxZGQQaO2fPDCm3xsIFg1BYCKzQsteJBBoYJ8wGVVArSk0QC5BMCpGSdEVxUME2bUZBscsLrHDEP+UcJGLUyiTF4ZCIAAAjJU8CISom4X10YPZKCAA68pcUBZcFkwrREfqLAdC1QQYWtqgw6IGV4Efk5w1B9+BTmqIectYYycAHhgZVQROAlCAU2YKQALJkBJ2T0CJ3BhwNYSbGEL9z5DZmp1bRfAuqVtAK4bJoxL4QYpCBCQBNJqFAQAIfkECQUANAAsAAAAAGQAZAAABv5AmnBILBqPyKRyyWw6n1Dma3P6RK/YrHZhEYhCB614TB4eOCAAAGS6lN9wZ0RNBwzi+HxRU1cn9IB4Ln0AFYGHRS8XD1EzKHUUJ09TJSUDjIhOKxEaLgMvkxUCKCgKE1ZNLwUUajAumJlKDyJpABQtqE0fGy0Dkk8TJH0xsUsZfQq/gR8hhJHFSSZ9LCuILxaEBAvQSDF9EsqAH97TbtxGJwx0MCm5gQssfSnnSCsmBBK4sR8zIjAwKEKAokcQyYMBAza4K8iwocOHECNKnEixosWLGDPSu9ChxISBUR6E0dhkgQAMMEiYGOnkQgQYAAhkAEnSyAJhdZI5+VABwf66DTWPfPBQiw6IO6k89CkQ1MgDFYQAEEsVoI+hpkReQCU0z8kAdWoomMM6JEXRVtt2ttAgwcQpskROGKgDIgQsJydO3IUr5EAICigEFNjLV8yHDw8OF17MuLHjx5AjS55MubLly5gza05ysMGChZuHvKhAAQYEGAqqEXnQosCnyx8aYPjGkkYEnxhKXD6xlW4GVBcI0OFAU/KG2YRMYApOh0XxyBseJR8bAgIAGEwtn1AQNUauCyVitHge+UUJmHVYACWiOLMq4WoEfA595ESBFANA09/Pv7///wAGKOCABBZo4GMfXDBAATO8oN9mDxTgkxocjBfFCyeQ19QLGf5MSAcBE0CxggYCBBAOWSsIEJUGk0izxm+FNSBdHzA8aMQF3KnhgYYkVYAeIYQh8UEGMBHQgY0aDYBTHwRA8cAIDAYZFI5RheBfin208d8GDgjAggQpnMjfBwcsIOaBaKap5hgYHrCBlKGtEIIMLIjgCY9xKFhABi2cec4IEpxFQAJIlrGBBSRAAAIGMqRV0AqBEgLDCIc8IMNZAHCgGj0vmBUVABLgOcYxUZkgKiAX8PEpCuvpIcOnAmzKzQUifAoACkjpwUpUFIS4kapRoSCrQRMEoIABMSxwKg0SfKoeQZ1iSocAhT4Qg4cAkFBCoTQU8KkDcCJi0qctMEEkIWsYULrECSoyOQNDHyhJSAiFbsDBpxpwu0COaoDILSInOEABAQSokB8TFczYBwWOKvHBBDHE0EG43Hxwwga1LVHAj0yqG5qMn2qzn72fKrCsZOf2gYKv+z2QAHxhXdXfCxN4IIECMazwbyBBAAAh+QQJBQA0ACwAAAAAZABkAAAG/kCacEgsGo/IpHLJbDqf0Kh0Sq1CLxmNpfWyer/fiwkGAKBSXbB63RyAymXCgU2vFzNw+MbOp7fyADBzfYRhCm8AICFpTg8HGxcfhU8XLSkle1ArHgIKKSdPHwsuHCwmI5NOLiiBGitRLyegUAcKeRSDqUkLEHAgMZKFDYhwEbpKFYAmD4UfEYAAGsdJM4CLk8nW00gfJnACC6kbAnkoudtFDxUeFSfBzSsKKCgS4ej3ShsbzPj9/v8AAwocSLCgwYMIEyr092LFiFcLC71wQQEDhQCznhyIoCJBxohHXnjLY+LCkxMm3oCIwAhkkQms8oCY8WQCg2/8XBYpQQZQ/oUnKzjAUdBSp5AWPfO0CFWCBQoBE4wauSACEItzTEQN2PBO6pABLOBQaNHVqxVRBTwUWFDW7JcPbd3KnUu3rt27ePPq3cu3r9+/gAMXeXGgqGAiHzaYQACDRIqcQkR1gOh3BjlfASAP4IBBAOW9D0IQizOAiAE4AfxesAUIRAYiGuB4UM1a5ushI5x69hsaGoHSQ7Rmqhw2jwPIh2l8WKEBBogzyJMPcWRYuvXr2LNr3869u/fvgU+MqDAhevIHGRigQNC5Q1ydLy4cePA+5Mg8EBKYj/hhgoReCLjAVRMFQEOaWSPc5IsKHyFBlYFleLBfQg+c1loBTMxAAIQA/gjQYEQzFAeIAkxMsCGEAmAVkU0GSsDEARRwqMGHC50ggYEOMCEShynUh9AHMYwWSFRMnBAjNDOa9UIAMQFAQAM+EjGAAKO5ItcHLXhgQghshbJBASZo4EAFJmn3wQsPvBAleGy22WYs9G2njgcGOJDBgJMkNsAAK1S3zQkuIAAHBBIQSQgWIpBAAAcB+KnLAy70YlWZfDiTVCIWTDjJABhAGAMhKwgZSAn4vBADhwIQkgCEJqxpxwsecEgAIS5AqICmfZiKahMfHNBBBAlMEEkTpxpogqOFDNAkIJ8y0YJQZUCggT1LrHBpGSD8hM8FDohKAI0vHZmHBJQm8UEAWEIu488JDgDCACpL7AgNCCk08UAKR8IQQrn9DOCABBqUgKsQCygIjQKuCqFPwghNQAKKyO61gsEjMmyXvNBgaN0KIg41MF8DHBKtCcNZ98EJA6RA3seEBAEAIfkECQUANAAsAAAAAGQAZAAABv5AmnBILBqPyKRyyWw6n9CodEqtQj+TSGZl7Xq/rwIBAmGNvuj080QCuAGah3pOL67ebtapzp8fMHgKF32EYCkEICAUA1EfFycvhVEXK3tRLwMhMQsfUCcZKioRB5JOByYcEg2lNA8RMG4gGqxMDm8CXJIzbXgTtEoCbwSMkiMQeAAFv0kBIG4CpJILFMi+y0cbLhQKI52SD81vCt7XRi8PD+TfFQoSKZbl8fLz9PX29/j5+vv8/f7/AAMKpPJhgAEOFhZIeTCiwAw5A498SICHQAd1Sz5kgGURY0QaB3i9MQCPyQUFbzxE+khkAAJkLKI1eWHiTQqPEWegQCahJP6TFRoEeBjEksgLFXhAxFj55MUFpkWHLFDgDIUHn1GtnBjQYgLErGDDih1LtqzZs2jTql3Ltq1bGi86RNA0AupbIgc8IAKgKALWtweoIgNggmjaBx0EEBDRYmWEwW+UpX0RA5YbGAnkMIDsRoLaCZvxUJhBwxlnFGorHMMDowSN1ZAJpLb8pjUNFpwByFC7gAMyCgpT5K6gNgxtEAU6ndAA2cRXtC8mBNUwgNwJB3sBEAhh+K7RASliFJiA07v58+jTq1/Pvr379+wvbHie/sMMAxQIMHDw9+OHFwCWh0QBO4lGXlYHRMACARJU0J0SKwAymAQbRLUcHgjEQB8SHv5wBoFkLCUAmxsYKLTEC8FwphJLR0GWARMv+MaZAxsC9ABKg8XQBHOcxSBgPx90OBgxS7TAGQFnFLUAAcgo0J8RDpj2BggvZjUBCyiAgIIJFTpxQQgUmMZCAXaxdEEL4/14xAsLVFBACyuoCd+cdNZp551CzFBAAimMUGMfJ6xQZjkfFMDAaiRcJQkWLsjAgQYd0PNBCRJO6cKgagwQ2mUVyNnHBiJwZiIfD2wqzKjXdFDgYCEQsoCUtaUgj2ozEtIBZ63GM0ClyOjYxAMbzLDCAZgasQBkyMlzgAScdbnEBgGQkAgLCTyIxAfMwuTsNR+0sGpKcl6AFB4QBODEAFi41RbpPJgwGYtfTWQwohsooJrEBwt4wAIFDhxYzwMDvPmnER/gOFgE6D0QKmQeoPcBjzmm1wCs9G7r3QcO0AYADMSp90AGChBAgQaNsffCCRtscIKnhAQBACH5BAkFADQALAAAAABkAGQAAAb+QJpwSCwaj8ikcslsOp/QqHRKrUofL6t2yxVeQiRKKtstm5efAgwAQHTO8PjwFWGzM/K8+VOCsFFveoJbDzEULAVkUC+Kg08vH1SQUi8jMREtD45NDwUqDhubNC0sbBgJoksdCGwmjXknBnYAMK+pRDF2HCeOKwKzAKG3RwMEbB62cReydijJwy8dHgW8jh8DFGwgBcNJH5OiHycFBQuR3ejp6uvs7e7v8PHy7y8PFw/n84MfKykmMhYyCNOnZ4AAP9oUzCAIKxswAAoOMFxyIoGHFs+MfLDw0E6MfBOLzMBgR8JAJQcYdGSjoFrIIhpmgYiRccgMYytZnHxJ4wP+CWAmLjBZ4bCjgJ08f83yoGnJCwUrAThoynNIHzsEBjhpAaIjCq1VibyIIYCCAoxOPnjoOCZskQ8HFpwAyeRFBQEwYCAQMICuWy0PFgxYUfOv4cOIEytezLix48eQI0sOe2JAgwEuJyt50UAEARQkZKDVjITOmlkIEhRG/GJFAAspJAoZgMLrwsgfKuAEIGCFkABRQ0hewQGYgywyoiqQ3KL2LAESoa7UILmDczsCeOVamULyBgnAPES66dU37gGl2Gio9qLA9T8VVh+GWyAG5iITFFAgQEDDbdJK8DPBCn4BaOCBCCao4IIMNujggxBG6MgFJajAggbxLfZNgUr+LCACMAZk5tYHMyTgQAwLyEfDUw+BwNRhIxTFQAUc4tfVQxRMYNgFStnBgmxL1NERCBUYtspDLTQhZIvc/FXBabM0uUQDKwFi2AokyaQjEw/sNosEIvKkFjAaULVEMcBQsABiHxiCAgUehOnNCCbsR4EJSP11glxTBDbBBipKKOighBZqqBEXjFBBBwfUKIejt6ygHwIYSJDhIONooEEEeUbaIxsIFADpFgdocBoIDHS6yQsO3DgLAWbC8QFwwEgQayrfrbSlHC8UZQcGuw6zQHEdFZnHA1DaAUMD6RyQXEfBBnjBBgdcMKoQL6T36n/DtOmqj/I9UCEJDJjQgXxkH6TwLQAmXJtHqcCgkGQTGbyXlRMneAClBECmk69zCowg3wZessGCig9MEEMILciZzq1LqNviCAxGsC4AIDC7YAkXg7Dmghf4yoYE7kKGzSw6OfjCBCEooEEMG5QsmTgXBJpHEAAh+QQJBQA0ACwAAAAAZABkAAAG/kCacEgsGo/IpHLJbDqf0Kh0Sq1ar9is9TMwmUYfrXjcXHAAAMGKzG5+LpPNK9pBoAmjth55cbBIFAoND08rLGgCG3uLQlwMaJAgLoROMx4ea4yLGyKQngAFmjQfKxMXokofGRCfkCyniy8FAgwWiqhHDxatkCh5iwOPaDG4RxcKvGgwLYwVKJAaxUa6yQAwE4wLhwAgKdJFHwUgyQKUey8dEhQhsN9DJyrJzJofLw9h7kULyJ4wKfj5Ah6IoYAFCwcD5gRcSOPFiQMnzDGcSLGixYsYxdQDmBHVgxEFQmRI2FHUCRcEIBEI0K6kHgvjPEEIoNClkhcLKhyA0iIZ/ooKNpU8MDAORAiJSnYl81AzaJEGnjDMYyKhmgakToU4+ESsSbxkDrBmjeEJRKgmKar9y2rkwDYAGm4xuUCBVyK2Rj5YMpFiAZQBdT2RwIb3yAexTA6EYEGABbvCkCNLnky5suXLmDNr3sy5s+d8HzZMyPS5yQoLLBiwsEC6tOERb9EwGMCR84URFWaYO8Dvk4ATn1doQAPCA6UBrHgN8PzCRUxrJYQUqNaV84FOnqLRmJ7MW+cDVT2ZEDLBDi/CnD9EeA6jg5ALBngpaLn5RAgYAAisFbJCwfM0C9S22QsbbHBCU6OkoIAACiQAnGtMHCYghBRWaOGFGGao4YYc/nbo4YeofHBACgGkcMCEkaEoVATmcZMCYlmF1kACLez0RAb49RPdZDOIMA4EGrR2U2CfSGAjZC/0xo1xTWzwn0roFbZASp6wIJcSKyRDwHKRLfCMJxRcmcQDX35ipWQPnJEdfUl4wIsHKgbVQo750ebECSb8Z0KcTi3ggAIhiDlXARpIoEEBMFr4wAWJgujoo5BGKukSH5ywwAoIZvhBAjKwIIADM+DywAAVYDrRCwEkhwYLfjHywQgiIIAACi5kKo0zrShg6xjafBICn4t84AIvEDR6hSqtUHDkNy+YkMyybHzg5icoRPmNB09aY+wQb1ywq2FpfRLmQiMQCYkDZ8COskACBpiQwArp0rCAuQB4wJAsdAKggKBIzKAmNyLwe8QLDbylwYMLceGAABKkcEK8SqIxnhOhVVDABAhLdkC+ymzL2QwcWwNthReU2Uu8nE3rSXUZ9vElCkxyOGoMMQzg8aRtBAEAOw==",imagePosition:"center center",maxSize:"100px",minSize:"20px",resizeInterval:50,size:"50%",zIndex:2147483647};A.LoadingOverlaySetup=function(B){A.extend(!0,E,B)},A.LoadingOverlay=function(B,Q){switch(B.toLowerCase()){case"show":C("body",A.extend(!0,{},E,Q));break;case"hide":g("body",Q)}},A.fn.LoadingOverlay=function(B,Q){switch(B.toLowerCase()){case"show":var I=A.extend(!0,{},E,Q);return this.each(function(){C(this,I)});case"hide":return this.each(function(){g(this,Q)})}}}(jQuery);
define("loading-overlay", function(){});

/**
    @binding overlay Blocks the element with an overlay when the specified observable is true
*/
define('qk-alchemy/bindings/overlay',['knockout', 'jquery', 'loading-overlay'], function(ko, $) {

    function showOverlay(element, value) {
        if (value) {
            $(element).LoadingOverlay('show');
        } else {
            $(element).LoadingOverlay('hide', true);
        }
    }

    ko.bindingHandlers.overlay = {
        init: function(element, valueAccessor, allBindings, viewModel, bindingContext) {
            $.LoadingOverlaySetup({
                color: "rgba(200, 200, 200, 0.8)",
                resizeInterval: 50,
                fade: false
            });

            var value = ko.unwrap(valueAccessor());
            showOverlay(element, value);
        },
        update: function(element, valueAccessor, allBindings, viewModel, bindingContext) {
            var value = ko.unwrap(valueAccessor());
            showOverlay(element, value);
        }
    };
});

define('qk-alchemy/main',[
    'module',
    'knockout',
    'jquery',
    'quark',
    'json!./main.json',
    'bootstrap/js',
    'loadCss!bootstrap/css',
    'loadCss!qk-alchemy/css/sidebar.css',
    'loadCss!qk-alchemy/css/navbar.css',
    'loadCss!qk-alchemy/css/submenu.css',
    './bindings/overlay'
], function(mod, ko, $, $$, config) {

    return $$.module(mod, config);
});

define('app/startup',[
    'knockout',
    'quark',
    'json!./config/components/components.config.json',
    'json!./config/components/screens.config.json',
    'json!./config/routing/pages.config.json',
    'json!./config/routing/params.config.json',
    'json!./config/routing/routes.config.json',
    'bootstrap/js',
    'loadCss!bootstrap/css',
    'loadCss!font-awesome/css',
    'qk-alchemy/main'
], function(ko, $$, components, screens, pages, params, routes) {
    // Register all components and screens
    $$.registerComponents(components);
    $$.registerComponents(screens);

    // Configure the routing system
    $$.routing.pages(pages, params);
    $$.routing.mapRoute(routes);

    // Start Quark Application
    $$.routing.activateHasher();
    $$.start();
});

define('text!screens/_layout/main.screen.html',[],function () { return '<quark-component>\r\n    <al-layout params="containerFluid: false">\r\n        <al-layout-navbar params="brand: \'Test\', pageName: \'main/home\'">\r\n            <!-- left -->\r\n                <!-- ko outlet: \'navbar-left\' -->\r\n                <!-- /ko -->\r\n            <!-- /left -->\r\n            <!-- right -->\r\n                <!-- ko outlet: \'navbar-right\' -->\r\n                <!-- /ko -->\r\n            <!-- /right -->\r\n        </al-layout-navbar>\r\n\r\n        <!-- ko outlet: \'container\' -->\r\n        <!-- /ko -->\r\n    </al-layout>\r\n</quark-component>\r\n';});

define('screens/_layout/main.screen',[
    'quark',
    'knockout',
    'text!./main.screen.html'
], function($$, ko, template) {

    function LayoutMainScreen(params, $scope, $imports) {
        var self = this;
    }

    return $$.component(LayoutMainScreen, template);
});

define('text!screens/_navbar/main/left.screen.html',[],function () { return '<!-- quark-component -->\r\n    <al-layout-navbar-link virtual params="text: \'Home\',\r\n                              iconFont: \'fa fa-home\',\r\n                              pageName: \'main/home\'">\r\n    </al-layout-navbar-link>\r\n    <al-layout-navbar-link virtual params="text: \'About\',\r\n                                           iconFont: \'fa fa-book\',\r\n                                           pageName: \'main/about\'">\r\n    </al-layout-navbar-link>\r\n<!-- /quark-component -->\r\n';});

define('screens/_navbar/main/left.screen',[
    'quark',
    'knockout',
    'text!./left.screen.html'
], function($$, ko, template) {

    function NavbarMainLeftScreen(params, $scope, $imports) {
        var self = this;
    }

    return $$.component(NavbarMainLeftScreen, template);
});

define('text!screens/_navbar/main/right.screen.html',[],function () { return '<!-- quark-component -->\r\n<!-- /quark-component -->\r\n';});

define('screens/_navbar/main/right.screen',[
    'quark',
    'knockout',
    'text!./right.screen.html'
], function($$, ko, template) {

    function NavbarMainRightScreen(params, $scope, $imports) {
        var self = this;
    }

    return $$.component(NavbarMainRightScreen, template);
});

define('text!screens/_container/simple.screen.html',[],function () { return '<quark-component>\r\n    <al-layout-container params="containerFluid: false">\r\n        <!-- ko outlet: \'main\' -->\r\n        <!-- /ko -->\r\n    </al-layout-container>\r\n</quark-component>\r\n';});

define('screens/_container/simple.screen',[
    'quark',
    'knockout',
    'text!./simple.screen.html'
], function($$, ko, template) {

    function ContainerSimpleScreen(params, $scope, $imports) {
        var self = this;
    }

    return $$.component(ContainerSimpleScreen, template);
});

define('text!screens/_container/sidebar.screen.html',[],function () { return '<quark-component>\r\n    <!-- ko outlet: \'sidebar\' -->\r\n    <!-- /ko -->\r\n\r\n    <al-layout-container params="containerFluid: true">\r\n        <!-- ko outlet: \'main\' -->\r\n        <!-- /ko -->\r\n    </al-layout-container>\r\n</quark-component>\r\n';});

define('screens/_container/sidebar.screen',[
    'quark',
    'knockout',
    'text!./sidebar.screen.html'
], function($$, ko, template) {

    function ContainerSidebarScreen(params, $scope, $imports) {
        var self = this;
    }

    return $$.component(ContainerSidebarScreen, template);
});

define('text!screens/home.screen.html',[],function () { return '<quark-component>\r\n    <h1 data-bind="text: model.name"></h1>\r\n    <p data-bind="text: model.description"></p>\r\n</quark-component>\r\n';});

define('screens/home.screen',[
    'quark',
    'knockout',
    'text!./home.screen.html'
], function($$, ko, template) {

    function HomeScreen(params, $scope, $imports) {
        var self = this;

        this.name = "Welcome to Test application";
        this.description = "Prueba de Quark";
    }

    return $$.component(HomeScreen, template);
});

define('text!screens/about.screen.html',[],function () { return '<quark-component>\r\n    <h1>About Test application</h1>\r\n    <div class="well pull-right">\r\n        <p>\r\n            <strong>License:</strong> MIT\r\n        </p>\r\n        <p>\r\n            <strong>Keywords:</strong>\r\n            <span class="label label-primary">\r\n                Quark\r\n            </span>\r\n\r\n            &nbsp;\r\n            <span class="label label-primary">\r\n                test\r\n            </span>\r\n\r\n            &nbsp;\r\n            <span class="label label-primary">\r\n                quark\r\n            </span>\r\n\r\n        </p>\r\n        <p>\r\n            <strong>Authors:</strong>\r\n            <ul>\r\n\r\n                <li>\r\n                    fllopez\r\n                </li>\r\n\r\n            </ul>\r\n        </p>\r\n        <p>\r\n            <strong>Homepage:</strong>\r\n            <a href=""></a>\r\n        </p>\r\n    </div>\r\n    <p>\r\n        Application developed with Quark.js.\r\n    </p>\r\n</quark-component>\r\n';});

define('screens/about.screen',[
    'quark',
    'knockout',
    'text!./about.screen.html'
], function($$, ko, template) {

    function HomeScreen(params, $scope, $imports) {
        var self = this;
    }

    return $$.component(HomeScreen, template);
});

define('controllers/main.controller',[
    'quark',
    'knockout'
], function($$, ko) {

    function MainController() {
        var self = this;
    }

    return MainController;
});

define('controllers/main/home.controller',[
    'quark',
    'knockout'
], function($$, ko) {

    function MainHomeController() {
        var self = this;
    }

    return MainHomeController;
});

define('controllers/main/about.controller',[
    'quark',
    'knockout'
], function($$, ko) {

    function MainAboutController() {
        var self = this;
    }

    return MainAboutController;
});

define('text!qk-alchemy/components/pager.component.html',[],function () { return '<quark-component>\r\n    <!-- ko content -->\r\n    <!-- /ko -->\r\n\r\n    <!-- ko if: model.pages() > 0 -->\r\n        <nav>\r\n            <ul class="pagination">\r\n                <li data-bind="css: { disabled: model.page() == 0 }">\r\n                    <a href="#" data-bind="click: previous">\r\n                        <span>&laquo;</span>\r\n                    </a>\r\n                </li>\r\n                <!-- ko foreach: pageArray -->\r\n                    <li data-bind="css: { active: $parent.model.page() == $data }">\r\n                        <a href="#" data-bind="text: $data + 1, click: $parent.setPage">\r\n                        </a>\r\n                    </li>\r\n                <!-- /ko -->\r\n                <li data-bind="css: { disabled: model.page() == (model.pages() - 1) }">\r\n                    <a href="#" data-bind="click: next">\r\n                        <span>&raquo;</span>\r\n                    </a>\r\n                </li>\r\n            </ul>\r\n        </nav>\r\n    <!-- /ko -->\r\n</quark-component>\r\n';});

/**
    @component Adds a pager to the specified content. It can be used to page any
    array on the browser. It exposes a pageData property with the data
    to show on the current page. The content can be bound to this property to show
    the information of a given page.
    @allowContent
*/
define('qk-alchemy/components/pager.component',[
    'quark',
    'knockout',
    'text!./pager.component.html'
], function($$, ko, template) {

    function PagerComponent(params, $scope, $imports) {
        var self = this;

        var pageSizeDefault = 10;

        $$.parameters({
            /**
                @parameter Array Data to page.
                @observable @exposed
            */
            data: ko.observableArray(),
            /**
                @parameter int The Max number of records to show on each page.
                @observable @exposed
            */
            pageSize: ko.observable(pageSizeDefault),
            /**
                @parameter int The zero index number of the current page
                @observable @exposed
            */
            page: ko.observable(0)
        }, params, this);

        /**
            @property int Total record count in the data parameter
            @computed
        */
        this.recordCount = ko.pureComputed(function() {
            if ($$.isArray(self.data())) {
                return self.data().length;
            } else {
                return 0;
            }
        });

        /**
            @property int Number of pages given the record count and the page size
            @computed
        */
        this.pages = ko.pureComputed(function() {
            var count = self.recordCount();
            var pageSize = self.pageSize();

            return Math.floor(count / pageSize) + ((count % pageSize) != 0 ? 1 : 0);
        });

        /**
            @property Array The data to show on the current page. The content can be
            bound to this property allowing to show only the data of the active page.
            @computed
        */
        this.pageData = ko.pureComputed(function() {
            var page = self.page();
            var pageSize = self.pageSize();
            var recordCount = self.recordCount();

            var start = page * pageSize;
            var end = start + pageSize;

            return self.data().slice(start, end);
        });

        $scope.pageArray = ko.pureComputed(function() {
            var pages = [];

            for (var i = 0; i < self.pages(); i++) {
                pages.push(i);
            }

            return pages;
        });

        $scope.setPage = function(page) {
            self.page(page);
        }

        $scope.next = function() {
            self.page(self.page() + 1);
        }

        $scope.previous = function() {
            self.page(self.page() - 1);
        }

        var subscriptions = {
            pageSize: self.pageSize.subscribe(function(newValue) {
                if (newValue == 0) {
                    self.pageSize(pageSizeDefault);
                }
            }),
            page: self.page.subscribe(function(newValue) {
                if (newValue < 0) {
                    self.page(0);
                }

                var pageSize = self.pages() - 1;

                if (newValue > pageSize) {
                    self.page(pageSize);
                }
            })
        }

        this.dispose = function() {
            subscriptions.pageSize.dispose();
            subscriptions.page.dispose();
        }

    }

    return $$.component(PagerComponent, template);
});

define('text!qk-alchemy/components/panel/collapsable.component.html',[],function () { return '<quark-component>\r\n    <div class="panel" data-bind="css: panelType">\r\n        <div class="panel-heading" data-bind="click: model.toggle">\r\n            <!-- ko hasContent: \'heading\' -->\r\n                <!-- ko content: \'heading\' -->\r\n                <!-- /ko -->\r\n            <!-- /ko -->\r\n            <!-- ko hasNotContent: \'heading\' -->\r\n                &nbsp;\r\n            <!-- /ko -->\r\n            <span class="pull-right">\r\n                <span data-bind="css: icon"></span>\r\n            </span>\r\n        </div>\r\n        <div class="panel-body" data-bind="visible: !model.collapsed()">\r\n            <!-- ko content: \'content\' -->\r\n            <!-- /ko -->\r\n        </div>\r\n        <!-- ko hasContent: \'footer\' -->\r\n            <div class="panel-footer">\r\n                <!-- ko content: \'footer\' -->\r\n                <!-- /ko -->\r\n            </div>\r\n        <!-- /ko -->\r\n    </div>\r\n</quark-component>\r\n';});

/**
    @component <p>Shows a bootstrap panel that can be collapsed by the user.</p>
    <p>It allows three content tags:
    <ul>
        <li>heading: content to show on the panel heading</li>
        <li>content: content to show on the panel</li>
        <li>footer: content to show on the panel footer</li>
    </ul></p>
    @allowContent
*/
define('qk-alchemy/components/panel/collapsable.component',[
    'knockout',
    'quark',
    'text!./collapsable.component.html'
], function(ko, $$, template) {

    function PanelCollapsableComponent(params, $scope, $imports) {
        var self = this;

        var panelTypes = {
            default: 'panel-default',
            primary: 'panel-primary',
            info: 'panel-info',
            success: 'panel-success',
            warning: 'panel-warning',
            danger: 'panel-danger',
            green: 'panel-green',
            red: 'panel-red'
        };

        $$.parameters({
            /**
                @parameter string Bootstrap type indicating the color style of the panel
                @observable @exposed
            */
            type: ko.observable(),
            /**
                @parameter int True if the panel is collapsed
                @observable @exposed
            */
            collapsed: ko.observable(false),
            /**
                @parameter callback Called when the user clicks on the collapse button
                @observable @exposed
            */
            onClick: function () {}
        }, params, this);

        $scope.panelType = ko.pureComputed(function() {
            if ($$.isDefined(panelTypes[self.type()])) {
                return panelTypes[self.type()];
            } else {
                return "panel panel-default";
            }
        }, self);

        /**
            @method Opens the panel
            @signature open()
        */
        this.open = function() {
            self.collapsed(false);
        }

        /**
            @method Close the panel
            @signature close()
        */
        this.close = function() {
            self.collapsed(true);
        }

        /**
            @method Toggle the panel collapsed state
            @signature toggle()
        */
        this.toggle = function() {
            $$.call(self.onClick);
            self.collapsed(!self.collapsed());
        }

        $scope.icon = ko.pureComputed(function() {
            if (self.collapsed()) {
                return "glyphicon glyphicon-chevron-up";
            } else {
                return "glyphicon glyphicon-chevron-down";
            }
        }, $scope);
    }

    return $$.component(PanelCollapsableComponent, template);
});

;(function(){
/**
 * Require the module at `name`.
 *
 * @param {String} name
 * @return {Object} exports
 * @api public
 */

function require(name) {
  var module = require.modules[name];
  if (!module) throw new Error('failed to require "' + name + '"');

  if (!('exports' in module) && typeof module.definition === 'function') {
    module.client = module.component = true;
    module.definition.call(this, module.exports = {}, module);
    delete module.definition;
  }

  return module.exports;
}

/**
 * Meta info, accessible in the global scope unless you use AMD option.
 */

require.loader = 'component';

/**
 * Internal helper object, contains a sorting function for semantiv versioning
 */
require.helper = {};
require.helper.semVerSort = function(a, b) {
  var aArray = a.version.split('.');
  var bArray = b.version.split('.');
  for (var i=0; i<aArray.length; ++i) {
    var aInt = parseInt(aArray[i], 10);
    var bInt = parseInt(bArray[i], 10);
    if (aInt === bInt) {
      var aLex = aArray[i].substr((""+aInt).length);
      var bLex = bArray[i].substr((""+bInt).length);
      if (aLex === '' && bLex !== '') return 1;
      if (aLex !== '' && bLex === '') return -1;
      if (aLex !== '' && bLex !== '') return aLex > bLex ? 1 : -1;
      continue;
    } else if (aInt > bInt) {
      return 1;
    } else {
      return -1;
    }
  }
  return 0;
}

/**
 * Find and require a module which name starts with the provided name.
 * If multiple modules exists, the highest semver is used.
 * This function can only be used for remote dependencies.

 * @param {String} name - module name: `user~repo`
 * @param {Boolean} returnPath - returns the canonical require path if true,
 *                               otherwise it returns the epxorted module
 */
require.latest = function (name, returnPath) {
  function showError(name) {
    throw new Error('failed to find latest module of "' + name + '"');
  }
  // only remotes with semvers, ignore local files conataining a '/'
  var versionRegexp = /(.*)~(.*)@v?(\d+\.\d+\.\d+[^\/]*)$/;
  var remoteRegexp = /(.*)~(.*)/;
  if (!remoteRegexp.test(name)) showError(name);
  var moduleNames = Object.keys(require.modules);
  var semVerCandidates = [];
  var otherCandidates = []; // for instance: name of the git branch
  for (var i=0; i<moduleNames.length; i++) {
    var moduleName = moduleNames[i];
    if (new RegExp(name + '@').test(moduleName)) {
        var version = moduleName.substr(name.length+1);
        var semVerMatch = versionRegexp.exec(moduleName);
        if (semVerMatch != null) {
          semVerCandidates.push({version: version, name: moduleName});
        } else {
          otherCandidates.push({version: version, name: moduleName});
        }
    }
  }
  if (semVerCandidates.concat(otherCandidates).length === 0) {
    showError(name);
  }
  if (semVerCandidates.length > 0) {
    var module = semVerCandidates.sort(require.helper.semVerSort).pop().name;
    if (returnPath === true) {
      return module;
    }
    return require(module);
  }
  // if the build contains more than one branch of the same module
  // you should not use this funciton
  var module = otherCandidates.sort(function(a, b) {return a.name > b.name})[0].name;
  if (returnPath === true) {
    return module;
  }
  return require(module);
}

/**
 * Registered modules.
 */

require.modules = {};

/**
 * Register module at `name` with callback `definition`.
 *
 * @param {String} name
 * @param {Function} definition
 * @api private
 */

require.register = function (name, definition) {
  require.modules[name] = {
    definition: definition
  };
};

/**
 * Define a module's exports immediately with `exports`.
 *
 * @param {String} name
 * @param {Generic} exports
 * @api private
 */

require.define = function (name, exports) {
  require.modules[name] = {
    exports: exports
  };
};
require.register("abpetkov~transitionize@0.0.3", function (exports, module) {

/**
 * Transitionize 0.0.3
 * https://github.com/abpetkov/transitionize
 *
 * Authored by Alexander Petkov
 * https://github.com/abpetkov
 *
 * Copyright 2013, Alexander Petkov
 * License: The MIT License (MIT)
 * http://opensource.org/licenses/MIT
 *
 */

/**
 * Expose `Transitionize`.
 */

module.exports = Transitionize;

/**
 * Initialize new Transitionize.
 *
 * @param {Object} element
 * @param {Object} props
 * @api public
 */

function Transitionize(element, props) {
  if (!(this instanceof Transitionize)) return new Transitionize(element, props);

  this.element = element;
  this.props = props || {};
  this.init();
}

/**
 * Detect if Safari.
 *
 * @returns {Boolean}
 * @api private
 */

Transitionize.prototype.isSafari = function() {
  return (/Safari/).test(navigator.userAgent) && (/Apple Computer/).test(navigator.vendor);
};

/**
 * Loop though the object and push the keys and values in an array.
 * Apply the CSS3 transition to the element and prefix with -webkit- for Safari.
 *
 * @api private
 */

Transitionize.prototype.init = function() {
  var transitions = [];

  for (var key in this.props) {
    transitions.push(key + ' ' + this.props[key]);
  }

  this.element.style.transition = transitions.join(', ');
  if (this.isSafari()) this.element.style.webkitTransition = transitions.join(', ');
};
});

require.register("component~event@0.1.4", function (exports, module) {
var bind = window.addEventListener ? 'addEventListener' : 'attachEvent',
    unbind = window.removeEventListener ? 'removeEventListener' : 'detachEvent',
    prefix = bind !== 'addEventListener' ? 'on' : '';

/**
 * Bind `el` event `type` to `fn`.
 *
 * @param {Element} el
 * @param {String} type
 * @param {Function} fn
 * @param {Boolean} capture
 * @return {Function}
 * @api public
 */

exports.bind = function(el, type, fn, capture){
  el[bind](prefix + type, fn, capture || false);
  return fn;
};

/**
 * Unbind `el` event `type`'s callback `fn`.
 *
 * @param {Element} el
 * @param {String} type
 * @param {Function} fn
 * @param {Boolean} capture
 * @return {Function}
 * @api public
 */

exports.unbind = function(el, type, fn, capture){
  el[unbind](prefix + type, fn, capture || false);
  return fn;
};
});

require.register("component~query@0.0.3", function (exports, module) {
function one(selector, el) {
  return el.querySelector(selector);
}

exports = module.exports = function(selector, el){
  el = el || document;
  return one(selector, el);
};

exports.all = function(selector, el){
  el = el || document;
  return el.querySelectorAll(selector);
};

exports.engine = function(obj){
  if (!obj.one) throw new Error('.one callback required');
  if (!obj.all) throw new Error('.all callback required');
  one = obj.one;
  exports.all = obj.all;
  return exports;
};

});

require.register("component~matches-selector@0.1.6", function (exports, module) {
/**
 * Module dependencies.
 */

try {
  var query = require('component~query@0.0.3');
} catch (err) {
  var query = require('component~query@0.0.3');
}

/**
 * Element prototype.
 */

var proto = Element.prototype;

/**
 * Vendor function.
 */

var vendor = proto.matches
  || proto.webkitMatchesSelector
  || proto.mozMatchesSelector
  || proto.msMatchesSelector
  || proto.oMatchesSelector;

/**
 * Expose `match()`.
 */

module.exports = match;

/**
 * Match `el` to `selector`.
 *
 * @param {Element} el
 * @param {String} selector
 * @return {Boolean}
 * @api public
 */

function match(el, selector) {
  if (!el || el.nodeType !== 1) return false;
  if (vendor) return vendor.call(el, selector);
  var nodes = query.all(selector, el.parentNode);
  for (var i = 0; i < nodes.length; ++i) {
    if (nodes[i] == el) return true;
  }
  return false;
}

});

require.register("component~closest@1.0.1", function (exports, module) {
/**
 * Module Dependencies
 */

try {
  var matches = require('component~matches-selector@0.1.6')
} catch (err) {
  var matches = require('component~matches-selector@0.1.6')
}

/**
 * Export `closest`
 */

module.exports = closest

/**
 * Closest
 *
 * @param {Element} el
 * @param {String} selector
 * @param {Element} scope (optional)
 */

function closest (el, selector, scope) {
  scope = scope || document.documentElement;

  // walk up the dom
  while (el && el !== scope) {
    if (matches(el, selector)) return el;
    el = el.parentNode;
  }

  // check scope for match
  return matches(el, selector) ? el : null;
}

});

require.register("component~delegate@0.2.3", function (exports, module) {
/**
 * Module dependencies.
 */

var closest = require('component~closest@1.0.1')
  , event = require('component~event@0.1.4');

/**
 * Delegate event `type` to `selector`
 * and invoke `fn(e)`. A callback function
 * is returned which may be passed to `.unbind()`.
 *
 * @param {Element} el
 * @param {String} selector
 * @param {String} type
 * @param {Function} fn
 * @param {Boolean} capture
 * @return {Function}
 * @api public
 */

exports.bind = function(el, selector, type, fn, capture){
  return event.bind(el, type, function(e){
    var target = e.target || e.srcElement;
    e.delegateTarget = closest(target, selector, true, el);
    if (e.delegateTarget) fn.call(el, e);
  }, capture);
};

/**
 * Unbind event `type`'s callback `fn`.
 *
 * @param {Element} el
 * @param {String} type
 * @param {Function} fn
 * @param {Boolean} capture
 * @api public
 */

exports.unbind = function(el, type, fn, capture){
  event.unbind(el, type, fn, capture);
};

});

require.register("component~events@1.0.9", function (exports, module) {

/**
 * Module dependencies.
 */

var events = require('component~event@0.1.4');
var delegate = require('component~delegate@0.2.3');

/**
 * Expose `Events`.
 */

module.exports = Events;

/**
 * Initialize an `Events` with the given
 * `el` object which events will be bound to,
 * and the `obj` which will receive method calls.
 *
 * @param {Object} el
 * @param {Object} obj
 * @api public
 */

function Events(el, obj) {
  if (!(this instanceof Events)) return new Events(el, obj);
  if (!el) throw new Error('element required');
  if (!obj) throw new Error('object required');
  this.el = el;
  this.obj = obj;
  this._events = {};
}

/**
 * Subscription helper.
 */

Events.prototype.sub = function(event, method, cb){
  this._events[event] = this._events[event] || {};
  this._events[event][method] = cb;
};

/**
 * Bind to `event` with optional `method` name.
 * When `method` is undefined it becomes `event`
 * with the "on" prefix.
 *
 * Examples:
 *
 *  Direct event handling:
 *
 *    events.bind('click') // implies "onclick"
 *    events.bind('click', 'remove')
 *    events.bind('click', 'sort', 'asc')
 *
 *  Delegated event handling:
 *
 *    events.bind('click li > a')
 *    events.bind('click li > a', 'remove')
 *    events.bind('click a.sort-ascending', 'sort', 'asc')
 *    events.bind('click a.sort-descending', 'sort', 'desc')
 *
 * @param {String} event
 * @param {String|function} [method]
 * @return {Function} callback
 * @api public
 */

Events.prototype.bind = function(event, method){
  var e = parse(event);
  var el = this.el;
  var obj = this.obj;
  var name = e.name;
  var method = method || 'on' + name;
  var args = [].slice.call(arguments, 2);

  // callback
  function cb(){
    var a = [].slice.call(arguments).concat(args);
    obj[method].apply(obj, a);
  }

  // bind
  if (e.selector) {
    cb = delegate.bind(el, e.selector, name, cb);
  } else {
    events.bind(el, name, cb);
  }

  // subscription for unbinding
  this.sub(name, method, cb);

  return cb;
};

/**
 * Unbind a single binding, all bindings for `event`,
 * or all bindings within the manager.
 *
 * Examples:
 *
 *  Unbind direct handlers:
 *
 *     events.unbind('click', 'remove')
 *     events.unbind('click')
 *     events.unbind()
 *
 * Unbind delegate handlers:
 *
 *     events.unbind('click', 'remove')
 *     events.unbind('click')
 *     events.unbind()
 *
 * @param {String|Function} [event]
 * @param {String|Function} [method]
 * @api public
 */

Events.prototype.unbind = function(event, method){
  if (0 == arguments.length) return this.unbindAll();
  if (1 == arguments.length) return this.unbindAllOf(event);

  // no bindings for this event
  var bindings = this._events[event];
  if (!bindings) return;

  // no bindings for this method
  var cb = bindings[method];
  if (!cb) return;

  events.unbind(this.el, event, cb);
};

/**
 * Unbind all events.
 *
 * @api private
 */

Events.prototype.unbindAll = function(){
  for (var event in this._events) {
    this.unbindAllOf(event);
  }
};

/**
 * Unbind all events for `event`.
 *
 * @param {String} event
 * @api private
 */

Events.prototype.unbindAllOf = function(event){
  var bindings = this._events[event];
  if (!bindings) return;

  for (var method in bindings) {
    this.unbind(event, method);
  }
};

/**
 * Parse `event`.
 *
 * @param {String} event
 * @return {Object}
 * @api private
 */

function parse(event) {
  var parts = event.split(/ +/);
  return {
    name: parts.shift(),
    selector: parts.join(' ')
  }
}

});

require.register("ftlabs~fastclick@v0.6.11", function (exports, module) {
/**
 * @preserve FastClick: polyfill to remove click delays on browsers with touch UIs.
 *
 * @version 0.6.11
 * @codingstandard ftlabs-jsv2
 * @copyright The Financial Times Limited [All Rights Reserved]
 * @license MIT License (see LICENSE.txt)
 */

/*jslint browser:true, node:true*/
/*global define, Event, Node*/


/**
 * Instantiate fast-clicking listeners on the specificed layer.
 *
 * @constructor
 * @param {Element} layer The layer to listen on
 */
function FastClick(layer) {
	
	var oldOnClick, self = this;


	/**
	 * Whether a click is currently being tracked.
	 *
	 * @type boolean
	 */
	this.trackingClick = false;


	/**
	 * Timestamp for when when click tracking started.
	 *
	 * @type number
	 */
	this.trackingClickStart = 0;


	/**
	 * The element being tracked for a click.
	 *
	 * @type EventTarget
	 */
	this.targetElement = null;


	/**
	 * X-coordinate of touch start event.
	 *
	 * @type number
	 */
	this.touchStartX = 0;


	/**
	 * Y-coordinate of touch start event.
	 *
	 * @type number
	 */
	this.touchStartY = 0;


	/**
	 * ID of the last touch, retrieved from Touch.identifier.
	 *
	 * @type number
	 */
	this.lastTouchIdentifier = 0;


	/**
	 * Touchmove boundary, beyond which a click will be cancelled.
	 *
	 * @type number
	 */
	this.touchBoundary = 10;


	/**
	 * The FastClick layer.
	 *
	 * @type Element
	 */
	this.layer = layer;

	if (!layer || !layer.nodeType) {
		throw new TypeError('Layer must be a document node');
	}

	/** @type function() */
	this.onClick = function() { return FastClick.prototype.onClick.apply(self, arguments); };

	/** @type function() */
	this.onMouse = function() { return FastClick.prototype.onMouse.apply(self, arguments); };

	/** @type function() */
	this.onTouchStart = function() { return FastClick.prototype.onTouchStart.apply(self, arguments); };

	/** @type function() */
	this.onTouchMove = function() { return FastClick.prototype.onTouchMove.apply(self, arguments); };

	/** @type function() */
	this.onTouchEnd = function() { return FastClick.prototype.onTouchEnd.apply(self, arguments); };

	/** @type function() */
	this.onTouchCancel = function() { return FastClick.prototype.onTouchCancel.apply(self, arguments); };

	if (FastClick.notNeeded(layer)) {
		return;
	}

	// Set up event handlers as required
	if (this.deviceIsAndroid) {
		layer.addEventListener('mouseover', this.onMouse, true);
		layer.addEventListener('mousedown', this.onMouse, true);
		layer.addEventListener('mouseup', this.onMouse, true);
	}

	layer.addEventListener('click', this.onClick, true);
	layer.addEventListener('touchstart', this.onTouchStart, false);
	layer.addEventListener('touchmove', this.onTouchMove, false);
	layer.addEventListener('touchend', this.onTouchEnd, false);
	layer.addEventListener('touchcancel', this.onTouchCancel, false);

	// Hack is required for browsers that don't support Event#stopImmediatePropagation (e.g. Android 2)
	// which is how FastClick normally stops click events bubbling to callbacks registered on the FastClick
	// layer when they are cancelled.
	if (!Event.prototype.stopImmediatePropagation) {
		layer.removeEventListener = function(type, callback, capture) {
			var rmv = Node.prototype.removeEventListener;
			if (type === 'click') {
				rmv.call(layer, type, callback.hijacked || callback, capture);
			} else {
				rmv.call(layer, type, callback, capture);
			}
		};

		layer.addEventListener = function(type, callback, capture) {
			var adv = Node.prototype.addEventListener;
			if (type === 'click') {
				adv.call(layer, type, callback.hijacked || (callback.hijacked = function(event) {
					if (!event.propagationStopped) {
						callback(event);
					}
				}), capture);
			} else {
				adv.call(layer, type, callback, capture);
			}
		};
	}

	// If a handler is already declared in the element's onclick attribute, it will be fired before
	// FastClick's onClick handler. Fix this by pulling out the user-defined handler function and
	// adding it as listener.
	if (typeof layer.onclick === 'function') {

		// Android browser on at least 3.2 requires a new reference to the function in layer.onclick
		// - the old one won't work if passed to addEventListener directly.
		oldOnClick = layer.onclick;
		layer.addEventListener('click', function(event) {
			oldOnClick(event);
		}, false);
		layer.onclick = null;
	}
}


/**
 * Android requires exceptions.
 *
 * @type boolean
 */
FastClick.prototype.deviceIsAndroid = navigator.userAgent.indexOf('Android') > 0;


/**
 * iOS requires exceptions.
 *
 * @type boolean
 */
FastClick.prototype.deviceIsIOS = /iP(ad|hone|od)/.test(navigator.userAgent);


/**
 * iOS 4 requires an exception for select elements.
 *
 * @type boolean
 */
FastClick.prototype.deviceIsIOS4 = FastClick.prototype.deviceIsIOS && (/OS 4_\d(_\d)?/).test(navigator.userAgent);


/**
 * iOS 6.0(+?) requires the target element to be manually derived
 *
 * @type boolean
 */
FastClick.prototype.deviceIsIOSWithBadTarget = FastClick.prototype.deviceIsIOS && (/OS ([6-9]|\d{2})_\d/).test(navigator.userAgent);


/**
 * Determine whether a given element requires a native click.
 *
 * @param {EventTarget|Element} target Target DOM element
 * @returns {boolean} Returns true if the element needs a native click
 */
FastClick.prototype.needsClick = function(target) {
	
	switch (target.nodeName.toLowerCase()) {

	// Don't send a synthetic click to disabled inputs (issue #62)
	case 'button':
	case 'select':
	case 'textarea':
		if (target.disabled) {
			return true;
		}

		break;
	case 'input':

		// File inputs need real clicks on iOS 6 due to a browser bug (issue #68)
		if ((this.deviceIsIOS && target.type === 'file') || target.disabled) {
			return true;
		}

		break;
	case 'label':
	case 'video':
		return true;
	}

	return (/\bneedsclick\b/).test(target.className);
};


/**
 * Determine whether a given element requires a call to focus to simulate click into element.
 *
 * @param {EventTarget|Element} target Target DOM element
 * @returns {boolean} Returns true if the element requires a call to focus to simulate native click.
 */
FastClick.prototype.needsFocus = function(target) {
	
	switch (target.nodeName.toLowerCase()) {
	case 'textarea':
		return true;
	case 'select':
		return !this.deviceIsAndroid;
	case 'input':
		switch (target.type) {
		case 'button':
		case 'checkbox':
		case 'file':
		case 'image':
		case 'radio':
		case 'submit':
			return false;
		}

		// No point in attempting to focus disabled inputs
		return !target.disabled && !target.readOnly;
	default:
		return (/\bneedsfocus\b/).test(target.className);
	}
};


/**
 * Send a click event to the specified element.
 *
 * @param {EventTarget|Element} targetElement
 * @param {Event} event
 */
FastClick.prototype.sendClick = function(targetElement, event) {
	
	var clickEvent, touch;

	// On some Android devices activeElement needs to be blurred otherwise the synthetic click will have no effect (#24)
	if (document.activeElement && document.activeElement !== targetElement) {
		document.activeElement.blur();
	}

	touch = event.changedTouches[0];

	// Synthesise a click event, with an extra attribute so it can be tracked
	clickEvent = document.createEvent('MouseEvents');
	clickEvent.initMouseEvent(this.determineEventType(targetElement), true, true, window, 1, touch.screenX, touch.screenY, touch.clientX, touch.clientY, false, false, false, false, 0, null);
	clickEvent.forwardedTouchEvent = true;
	targetElement.dispatchEvent(clickEvent);
};

FastClick.prototype.determineEventType = function(targetElement) {
	

	//Issue #159: Android Chrome Select Box does not open with a synthetic click event
	if (this.deviceIsAndroid && targetElement.tagName.toLowerCase() === 'select') {
		return 'mousedown';
	}

	return 'click';
};


/**
 * @param {EventTarget|Element} targetElement
 */
FastClick.prototype.focus = function(targetElement) {
	
	var length;

	// Issue #160: on iOS 7, some input elements (e.g. date datetime) throw a vague TypeError on setSelectionRange. These elements don't have an integer value for the selectionStart and selectionEnd properties, but unfortunately that can't be used for detection because accessing the properties also throws a TypeError. Just check the type instead. Filed as Apple bug #15122724.
	if (this.deviceIsIOS && targetElement.setSelectionRange && targetElement.type.indexOf('date') !== 0 && targetElement.type !== 'time') {
		length = targetElement.value.length;
		targetElement.setSelectionRange(length, length);
	} else {
		targetElement.focus();
	}
};


/**
 * Check whether the given target element is a child of a scrollable layer and if so, set a flag on it.
 *
 * @param {EventTarget|Element} targetElement
 */
FastClick.prototype.updateScrollParent = function(targetElement) {
	
	var scrollParent, parentElement;

	scrollParent = targetElement.fastClickScrollParent;

	// Attempt to discover whether the target element is contained within a scrollable layer. Re-check if the
	// target element was moved to another parent.
	if (!scrollParent || !scrollParent.contains(targetElement)) {
		parentElement = targetElement;
		do {
			if (parentElement.scrollHeight > parentElement.offsetHeight) {
				scrollParent = parentElement;
				targetElement.fastClickScrollParent = parentElement;
				break;
			}

			parentElement = parentElement.parentElement;
		} while (parentElement);
	}

	// Always update the scroll top tracker if possible.
	if (scrollParent) {
		scrollParent.fastClickLastScrollTop = scrollParent.scrollTop;
	}
};


/**
 * @param {EventTarget} targetElement
 * @returns {Element|EventTarget}
 */
FastClick.prototype.getTargetElementFromEventTarget = function(eventTarget) {
	

	// On some older browsers (notably Safari on iOS 4.1 - see issue #56) the event target may be a text node.
	if (eventTarget.nodeType === Node.TEXT_NODE) {
		return eventTarget.parentNode;
	}

	return eventTarget;
};


/**
 * On touch start, record the position and scroll offset.
 *
 * @param {Event} event
 * @returns {boolean}
 */
FastClick.prototype.onTouchStart = function(event) {
	
	var targetElement, touch, selection;

	// Ignore multiple touches, otherwise pinch-to-zoom is prevented if both fingers are on the FastClick element (issue #111).
	if (event.targetTouches.length > 1) {
		return true;
	}

	targetElement = this.getTargetElementFromEventTarget(event.target);
	touch = event.targetTouches[0];

	if (this.deviceIsIOS) {

		// Only trusted events will deselect text on iOS (issue #49)
		selection = window.getSelection();
		if (selection.rangeCount && !selection.isCollapsed) {
			return true;
		}

		if (!this.deviceIsIOS4) {

			// Weird things happen on iOS when an alert or confirm dialog is opened from a click event callback (issue #23):
			// when the user next taps anywhere else on the page, new touchstart and touchend events are dispatched
			// with the same identifier as the touch event that previously triggered the click that triggered the alert.
			// Sadly, there is an issue on iOS 4 that causes some normal touch events to have the same identifier as an
			// immediately preceeding touch event (issue #52), so this fix is unavailable on that platform.
			if (touch.identifier === this.lastTouchIdentifier) {
				event.preventDefault();
				return false;
			}

			this.lastTouchIdentifier = touch.identifier;

			// If the target element is a child of a scrollable layer (using -webkit-overflow-scrolling: touch) and:
			// 1) the user does a fling scroll on the scrollable layer
			// 2) the user stops the fling scroll with another tap
			// then the event.target of the last 'touchend' event will be the element that was under the user's finger
			// when the fling scroll was started, causing FastClick to send a click event to that layer - unless a check
			// is made to ensure that a parent layer was not scrolled before sending a synthetic click (issue #42).
			this.updateScrollParent(targetElement);
		}
	}

	this.trackingClick = true;
	this.trackingClickStart = event.timeStamp;
	this.targetElement = targetElement;

	this.touchStartX = touch.pageX;
	this.touchStartY = touch.pageY;

	// Prevent phantom clicks on fast double-tap (issue #36)
	if ((event.timeStamp - this.lastClickTime) < 200) {
		event.preventDefault();
	}

	return true;
};


/**
 * Based on a touchmove event object, check whether the touch has moved past a boundary since it started.
 *
 * @param {Event} event
 * @returns {boolean}
 */
FastClick.prototype.touchHasMoved = function(event) {
	
	var touch = event.changedTouches[0], boundary = this.touchBoundary;

	if (Math.abs(touch.pageX - this.touchStartX) > boundary || Math.abs(touch.pageY - this.touchStartY) > boundary) {
		return true;
	}

	return false;
};


/**
 * Update the last position.
 *
 * @param {Event} event
 * @returns {boolean}
 */
FastClick.prototype.onTouchMove = function(event) {
	
	if (!this.trackingClick) {
		return true;
	}

	// If the touch has moved, cancel the click tracking
	if (this.targetElement !== this.getTargetElementFromEventTarget(event.target) || this.touchHasMoved(event)) {
		this.trackingClick = false;
		this.targetElement = null;
	}

	return true;
};


/**
 * Attempt to find the labelled control for the given label element.
 *
 * @param {EventTarget|HTMLLabelElement} labelElement
 * @returns {Element|null}
 */
FastClick.prototype.findControl = function(labelElement) {
	

	// Fast path for newer browsers supporting the HTML5 control attribute
	if (labelElement.control !== undefined) {
		return labelElement.control;
	}

	// All browsers under test that support touch events also support the HTML5 htmlFor attribute
	if (labelElement.htmlFor) {
		return document.getElementById(labelElement.htmlFor);
	}

	// If no for attribute exists, attempt to retrieve the first labellable descendant element
	// the list of which is defined here: http://www.w3.org/TR/html5/forms.html#category-label
	return labelElement.querySelector('button, input:not([type=hidden]), keygen, meter, output, progress, select, textarea');
};


/**
 * On touch end, determine whether to send a click event at once.
 *
 * @param {Event} event
 * @returns {boolean}
 */
FastClick.prototype.onTouchEnd = function(event) {
	
	var forElement, trackingClickStart, targetTagName, scrollParent, touch, targetElement = this.targetElement;

	if (!this.trackingClick) {
		return true;
	}

	// Prevent phantom clicks on fast double-tap (issue #36)
	if ((event.timeStamp - this.lastClickTime) < 200) {
		this.cancelNextClick = true;
		return true;
	}

	// Reset to prevent wrong click cancel on input (issue #156).
	this.cancelNextClick = false;

	this.lastClickTime = event.timeStamp;

	trackingClickStart = this.trackingClickStart;
	this.trackingClick = false;
	this.trackingClickStart = 0;

	// On some iOS devices, the targetElement supplied with the event is invalid if the layer
	// is performing a transition or scroll, and has to be re-detected manually. Note that
	// for this to function correctly, it must be called *after* the event target is checked!
	// See issue #57; also filed as rdar://13048589 .
	if (this.deviceIsIOSWithBadTarget) {
		touch = event.changedTouches[0];

		// In certain cases arguments of elementFromPoint can be negative, so prevent setting targetElement to null
		targetElement = document.elementFromPoint(touch.pageX - window.pageXOffset, touch.pageY - window.pageYOffset) || targetElement;
		targetElement.fastClickScrollParent = this.targetElement.fastClickScrollParent;
	}

	targetTagName = targetElement.tagName.toLowerCase();
	if (targetTagName === 'label') {
		forElement = this.findControl(targetElement);
		if (forElement) {
			this.focus(targetElement);
			if (this.deviceIsAndroid) {
				return false;
			}

			targetElement = forElement;
		}
	} else if (this.needsFocus(targetElement)) {

		// Case 1: If the touch started a while ago (best guess is 100ms based on tests for issue #36) then focus will be triggered anyway. Return early and unset the target element reference so that the subsequent click will be allowed through.
		// Case 2: Without this exception for input elements tapped when the document is contained in an iframe, then any inputted text won't be visible even though the value attribute is updated as the user types (issue #37).
		if ((event.timeStamp - trackingClickStart) > 100 || (this.deviceIsIOS && window.top !== window && targetTagName === 'input')) {
			this.targetElement = null;
			return false;
		}

		this.focus(targetElement);

		// Select elements need the event to go through on iOS 4, otherwise the selector menu won't open.
		if (!this.deviceIsIOS4 || targetTagName !== 'select') {
			this.targetElement = null;
			event.preventDefault();
		}

		return false;
	}

	if (this.deviceIsIOS && !this.deviceIsIOS4) {

		// Don't send a synthetic click event if the target element is contained within a parent layer that was scrolled
		// and this tap is being used to stop the scrolling (usually initiated by a fling - issue #42).
		scrollParent = targetElement.fastClickScrollParent;
		if (scrollParent && scrollParent.fastClickLastScrollTop !== scrollParent.scrollTop) {
			return true;
		}
	}

	// Prevent the actual click from going though - unless the target node is marked as requiring
	// real clicks or if it is in the whitelist in which case only non-programmatic clicks are permitted.
	if (!this.needsClick(targetElement)) {
		event.preventDefault();
		this.sendClick(targetElement, event);
	}

	return false;
};


/**
 * On touch cancel, stop tracking the click.
 *
 * @returns {void}
 */
FastClick.prototype.onTouchCancel = function() {
	
	this.trackingClick = false;
	this.targetElement = null;
};


/**
 * Determine mouse events which should be permitted.
 *
 * @param {Event} event
 * @returns {boolean}
 */
FastClick.prototype.onMouse = function(event) {
	

	// If a target element was never set (because a touch event was never fired) allow the event
	if (!this.targetElement) {
		return true;
	}

	if (event.forwardedTouchEvent) {
		return true;
	}

	// Programmatically generated events targeting a specific element should be permitted
	if (!event.cancelable) {
		return true;
	}

	// Derive and check the target element to see whether the mouse event needs to be permitted;
	// unless explicitly enabled, prevent non-touch click events from triggering actions,
	// to prevent ghost/doubleclicks.
	if (!this.needsClick(this.targetElement) || this.cancelNextClick) {

		// Prevent any user-added listeners declared on FastClick element from being fired.
		if (event.stopImmediatePropagation) {
			event.stopImmediatePropagation();
		} else {

			// Part of the hack for browsers that don't support Event#stopImmediatePropagation (e.g. Android 2)
			event.propagationStopped = true;
		}

		// Cancel the event
		event.stopPropagation();
		event.preventDefault();

		return false;
	}

	// If the mouse event is permitted, return true for the action to go through.
	return true;
};


/**
 * On actual clicks, determine whether this is a touch-generated click, a click action occurring
 * naturally after a delay after a touch (which needs to be cancelled to avoid duplication), or
 * an actual click which should be permitted.
 *
 * @param {Event} event
 * @returns {boolean}
 */
FastClick.prototype.onClick = function(event) {
	
	var permitted;

	// It's possible for another FastClick-like library delivered with third-party code to fire a click event before FastClick does (issue #44). In that case, set the click-tracking flag back to false and return early. This will cause onTouchEnd to return early.
	if (this.trackingClick) {
		this.targetElement = null;
		this.trackingClick = false;
		return true;
	}

	// Very odd behaviour on iOS (issue #18): if a submit element is present inside a form and the user hits enter in the iOS simulator or clicks the Go button on the pop-up OS keyboard the a kind of 'fake' click event will be triggered with the submit-type input element as the target.
	if (event.target.type === 'submit' && event.detail === 0) {
		return true;
	}

	permitted = this.onMouse(event);

	// Only unset targetElement if the click is not permitted. This will ensure that the check for !targetElement in onMouse fails and the browser's click doesn't go through.
	if (!permitted) {
		this.targetElement = null;
	}

	// If clicks are permitted, return true for the action to go through.
	return permitted;
};


/**
 * Remove all FastClick's event listeners.
 *
 * @returns {void}
 */
FastClick.prototype.destroy = function() {
	
	var layer = this.layer;

	if (this.deviceIsAndroid) {
		layer.removeEventListener('mouseover', this.onMouse, true);
		layer.removeEventListener('mousedown', this.onMouse, true);
		layer.removeEventListener('mouseup', this.onMouse, true);
	}

	layer.removeEventListener('click', this.onClick, true);
	layer.removeEventListener('touchstart', this.onTouchStart, false);
	layer.removeEventListener('touchmove', this.onTouchMove, false);
	layer.removeEventListener('touchend', this.onTouchEnd, false);
	layer.removeEventListener('touchcancel', this.onTouchCancel, false);
};


/**
 * Check whether FastClick is needed.
 *
 * @param {Element} layer The layer to listen on
 */
FastClick.notNeeded = function(layer) {
	
	var metaViewport;
	var chromeVersion;

	// Devices that don't support touch don't need FastClick
	if (typeof window.ontouchstart === 'undefined') {
		return true;
	}

	// Chrome version - zero for other browsers
	chromeVersion = +(/Chrome\/([0-9]+)/.exec(navigator.userAgent) || [,0])[1];

	if (chromeVersion) {

		if (FastClick.prototype.deviceIsAndroid) {
			metaViewport = document.querySelector('meta[name=viewport]');

			if (metaViewport) {
				// Chrome on Android with user-scalable="no" doesn't need FastClick (issue #89)
				if (metaViewport.content.indexOf('user-scalable=no') !== -1) {
					return true;
				}
				// Chrome 32 and above with width=device-width or less don't need FastClick
				if (chromeVersion > 31 && window.innerWidth <= window.screen.width) {
					return true;
				}
			}

		// Chrome desktop doesn't need FastClick (issue #15)
		} else {
			return true;
		}
	}

	// IE10 with -ms-touch-action: none, which disables double-tap-to-zoom (issue #97)
	if (layer.style.msTouchAction === 'none') {
		return true;
	}

	return false;
};


/**
 * Factory method for creating a FastClick object
 *
 * @param {Element} layer The layer to listen on
 */
FastClick.attach = function(layer) {
	
	return new FastClick(layer);
};


if (typeof define !== 'undefined' && define.amd) {
	module.exports = FastClick.attach;
	module.exports.FastClick = FastClick;
} else {
	window.FastClick = FastClick;
}

});

require.register("component~indexof@0.0.3", function (exports, module) {
module.exports = function(arr, obj){
  if (arr.indexOf) return arr.indexOf(obj);
  for (var i = 0; i < arr.length; ++i) {
    if (arr[i] === obj) return i;
  }
  return -1;
};
});

require.register("component~classes@1.2.1", function (exports, module) {
/**
 * Module dependencies.
 */

var index = require('component~indexof@0.0.3');

/**
 * Whitespace regexp.
 */

var re = /\s+/;

/**
 * toString reference.
 */

var toString = Object.prototype.toString;

/**
 * Wrap `el` in a `ClassList`.
 *
 * @param {Element} el
 * @return {ClassList}
 * @api public
 */

module.exports = function(el){
  return new ClassList(el);
};

/**
 * Initialize a new ClassList for `el`.
 *
 * @param {Element} el
 * @api private
 */

function ClassList(el) {
  if (!el) throw new Error('A DOM element reference is required');
  this.el = el;
  this.list = el.classList;
}

/**
 * Add class `name` if not already present.
 *
 * @param {String} name
 * @return {ClassList}
 * @api public
 */

ClassList.prototype.add = function(name){
  // classList
  if (this.list) {
    this.list.add(name);
    return this;
  }

  // fallback
  var arr = this.array();
  var i = index(arr, name);
  if (!~i) arr.push(name);
  this.el.className = arr.join(' ');
  return this;
};

/**
 * Remove class `name` when present, or
 * pass a regular expression to remove
 * any which match.
 *
 * @param {String|RegExp} name
 * @return {ClassList}
 * @api public
 */

ClassList.prototype.remove = function(name){
  if ('[object RegExp]' == toString.call(name)) {
    return this.removeMatching(name);
  }

  // classList
  if (this.list) {
    this.list.remove(name);
    return this;
  }

  // fallback
  var arr = this.array();
  var i = index(arr, name);
  if (~i) arr.splice(i, 1);
  this.el.className = arr.join(' ');
  return this;
};

/**
 * Remove all classes matching `re`.
 *
 * @param {RegExp} re
 * @return {ClassList}
 * @api private
 */

ClassList.prototype.removeMatching = function(re){
  var arr = this.array();
  for (var i = 0; i < arr.length; i++) {
    if (re.test(arr[i])) {
      this.remove(arr[i]);
    }
  }
  return this;
};

/**
 * Toggle class `name`, can force state via `force`.
 *
 * For browsers that support classList, but do not support `force` yet,
 * the mistake will be detected and corrected.
 *
 * @param {String} name
 * @param {Boolean} force
 * @return {ClassList}
 * @api public
 */

ClassList.prototype.toggle = function(name, force){
  // classList
  if (this.list) {
    if ("undefined" !== typeof force) {
      if (force !== this.list.toggle(name, force)) {
        this.list.toggle(name); // toggle again to correct
      }
    } else {
      this.list.toggle(name);
    }
    return this;
  }

  // fallback
  if ("undefined" !== typeof force) {
    if (!force) {
      this.remove(name);
    } else {
      this.add(name);
    }
  } else {
    if (this.has(name)) {
      this.remove(name);
    } else {
      this.add(name);
    }
  }

  return this;
};

/**
 * Return an array of classes.
 *
 * @return {Array}
 * @api public
 */

ClassList.prototype.array = function(){
  var str = this.el.className.replace(/^\s+|\s+$/g, '');
  var arr = str.split(re);
  if ('' === arr[0]) arr.shift();
  return arr;
};

/**
 * Check if class `name` is present.
 *
 * @param {String} name
 * @return {ClassList}
 * @api public
 */

ClassList.prototype.has =
ClassList.prototype.contains = function(name){
  return this.list
    ? this.list.contains(name)
    : !! ~index(this.array(), name);
};

});

require.register("switchery", function (exports, module) {
/**
 * Switchery 0.8.2
 * http://abpetkov.github.io/switchery/
 *
 * Authored by Alexander Petkov
 * https://github.com/abpetkov
 *
 * Copyright 2013-2015, Alexander Petkov
 * License: The MIT License (MIT)
 * http://opensource.org/licenses/MIT
 *
 */

/**
 * External dependencies.
 */

var transitionize = require('abpetkov~transitionize@0.0.3')
  , fastclick = require('ftlabs~fastclick@v0.6.11')
  , classes = require('component~classes@1.2.1')
  , events = require('component~events@1.0.9');

/**
 * Expose `Switchery`.
 */

module.exports = Switchery;

/**
 * Set Switchery default values.
 *
 * @api public
 */

var defaults = {
    color             : '#64bd63'
  , secondaryColor    : '#dfdfdf'
  , jackColor         : '#fff'
  , jackSecondaryColor: null
  , className         : 'switchery'
  , disabled          : false
  , disabledOpacity   : 0.5
  , speed             : '0.4s'
  , size              : 'default'
};

/**
 * Create Switchery object.
 *
 * @param {Object} element
 * @param {Object} options
 * @api public
 */

function Switchery(element, options) {
  if (!(this instanceof Switchery)) return new Switchery(element, options);

  this.element = element;
  this.options = options || {};

  for (var i in defaults) {
    if (this.options[i] == null) {
      this.options[i] = defaults[i];
    }
  }

  if (this.element != null && this.element.type == 'checkbox') this.init();
  if (this.isDisabled() === true) this.disable();
}

/**
 * Hide the target element.
 *
 * @api private
 */

Switchery.prototype.hide = function() {
  this.element.style.display = 'none';
};

/**
 * Show custom switch after the target element.
 *
 * @api private
 */

Switchery.prototype.show = function() {
  var switcher = this.create();
  this.insertAfter(this.element, switcher);
};

/**
 * Create custom switch.
 *
 * @returns {Object} this.switcher
 * @api private
 */

Switchery.prototype.create = function() {
  this.switcher = document.createElement('span');
  this.jack = document.createElement('small');
  this.switcher.appendChild(this.jack);
  this.switcher.className = this.options.className;
  this.events = events(this.switcher, this);

  return this.switcher;
};

/**
 * Insert after element after another element.
 *
 * @param {Object} reference
 * @param {Object} target
 * @api private
 */

Switchery.prototype.insertAfter = function(reference, target) {
  reference.parentNode.insertBefore(target, reference.nextSibling);
};

/**
 * Set switch jack proper position.
 *
 * @param {Boolean} clicked - we need this in order to uncheck the input when the switch is clicked
 * @api private
 */

Switchery.prototype.setPosition = function (clicked) {
  var checked = this.isChecked()
    , switcher = this.switcher
    , jack = this.jack;

  if (clicked && checked) checked = false;
  else if (clicked && !checked) checked = true;

  if (checked === true) {
    this.element.checked = true;

    if (window.getComputedStyle) jack.style.left = parseInt(window.getComputedStyle(switcher).width) - parseInt(window.getComputedStyle(jack).width) + 'px';
    else jack.style.left = parseInt(switcher.currentStyle['width']) - parseInt(jack.currentStyle['width']) + 'px';

    if (this.options.color) this.colorize();
    this.setSpeed();
  } else {
    jack.style.left = 0;
    this.element.checked = false;
    this.switcher.style.boxShadow = 'inset 0 0 0 0 ' + this.options.secondaryColor;
    this.switcher.style.borderColor = this.options.secondaryColor;
    this.switcher.style.backgroundColor = (this.options.secondaryColor !== defaults.secondaryColor) ? this.options.secondaryColor : '#fff';
    this.jack.style.backgroundColor = (this.options.jackSecondaryColor !== this.options.jackColor) ? this.options.jackSecondaryColor : this.options.jackColor;
    this.setSpeed();
  }
};

/**
 * Set speed.
 *
 * @api private
 */

Switchery.prototype.setSpeed = function() {
  var switcherProp = {}
    , jackProp = {
        'background-color': this.options.speed
      , 'left': this.options.speed.replace(/[a-z]/, '') / 2 + 's'
    };

  if (this.isChecked()) {
    switcherProp = {
        'border': this.options.speed
      , 'box-shadow': this.options.speed
      , 'background-color': this.options.speed.replace(/[a-z]/, '') * 3 + 's'
    };
  } else {
    switcherProp = {
        'border': this.options.speed
      , 'box-shadow': this.options.speed
    };
  }

  transitionize(this.switcher, switcherProp);
  transitionize(this.jack, jackProp);
};

/**
 * Set switch size.
 *
 * @api private
 */

Switchery.prototype.setSize = function() {
  var small = 'switchery-small'
    , normal = 'switchery-default'
    , large = 'switchery-large';

  switch (this.options.size) {
    case 'small':
      classes(this.switcher).add(small)
      break;
    case 'large':
      classes(this.switcher).add(large)
      break;
    default:
      classes(this.switcher).add(normal)
      break;
  }
};

/**
 * Set switch color.
 *
 * @api private
 */

Switchery.prototype.colorize = function() {
  var switcherHeight = this.switcher.offsetHeight / 2;

  this.switcher.style.backgroundColor = this.options.color;
  this.switcher.style.borderColor = this.options.color;
  this.switcher.style.boxShadow = 'inset 0 0 0 ' + switcherHeight + 'px ' + this.options.color;
  this.jack.style.backgroundColor = this.options.jackColor;
};

/**
 * Handle the onchange event.
 *
 * @param {Boolean} state
 * @api private
 */

Switchery.prototype.handleOnchange = function(state) {
  if (document.dispatchEvent) {
    var event = document.createEvent('HTMLEvents');
    event.initEvent('change', true, true);
    this.element.dispatchEvent(event);
  } else {
    this.element.fireEvent('onchange');
  }
};

/**
 * Handle the native input element state change.
 * A `change` event must be fired in order to detect the change.
 *
 * @api private
 */

Switchery.prototype.handleChange = function() {
  var self = this
    , el = this.element;

  if (el.addEventListener) {
    el.addEventListener('change', function() {
      self.setPosition();
    });
  } else {
    el.attachEvent('onchange', function() {
      self.setPosition();
    });
  }
};

/**
 * Handle the switch click event.
 *
 * @api private
 */

Switchery.prototype.handleClick = function() {
  var switcher = this.switcher;

  fastclick(switcher);
  this.events.bind('click', 'bindClick');
};

/**
 * Attach all methods that need to happen on switcher click.
 *
 * @api private
 */

Switchery.prototype.bindClick = function() {
  var parent = this.element.parentNode.tagName.toLowerCase()
    , labelParent = (parent === 'label') ? false : true;

  this.setPosition(labelParent);
  this.handleOnchange(this.element.checked);
};

/**
 * Mark an individual switch as already handled.
 *
 * @api private
 */

Switchery.prototype.markAsSwitched = function() {
  this.element.setAttribute('data-switchery', true);
};

/**
 * Check if an individual switch is already handled.
 *
 * @api private
 */

Switchery.prototype.markedAsSwitched = function() {
  return this.element.getAttribute('data-switchery');
};

/**
 * Initialize Switchery.
 *
 * @api private
 */

Switchery.prototype.init = function() {
  this.hide();
  this.show();
  this.setSize();
  this.setPosition();
  this.markAsSwitched();
  this.handleChange();
  this.handleClick();
};

/**
 * See if input is checked.
 *
 * @returns {Boolean}
 * @api public
 */

Switchery.prototype.isChecked = function() {
  return this.element.checked;
};

/**
 * See if switcher should be disabled.
 *
 * @returns {Boolean}
 * @api public
 */

Switchery.prototype.isDisabled = function() {
  return this.options.disabled || this.element.disabled || this.element.readOnly;
};

/**
 * Destroy all event handlers attached to the switch.
 *
 * @api public
 */

Switchery.prototype.destroy = function() {
  this.events.unbind();
};

/**
 * Enable disabled switch element.
 *
 * @api public
 */

Switchery.prototype.enable = function() {
  if (!this.options.disabled) return;
  if (this.options.disabled) this.options.disabled = false;
  if (this.element.disabled) this.element.disabled = false;
  if (this.element.readOnly) this.element.readOnly = false;
  this.switcher.style.opacity = 1;
  this.events.bind('click', 'bindClick');
};

/**
 * Disable switch element.
 *
 * @api public
 */

Switchery.prototype.disable = function() {
  if (this.options.disabled) return;
  if (!this.options.disabled) this.options.disabled = true;
  if (!this.element.disabled) this.element.disabled = true;
  if (!this.element.readOnly) this.element.readOnly = true;
  this.switcher.style.opacity = this.options.disabledOpacity;
  this.destroy();
};

if (typeof define !== 'undefined' && define.amd) {
	// AMD. Register as an anonymous module.
	define('switchery/js',[],function() {
		
		return Switchery;
	});
} else if (typeof module !== 'undefined' && module.exports) {
	//module.exports = Switchery;
	module.exports.Switchery = Switchery;
} else {
	window.Switchery = Switchery;
}
});

require("switchery");

})();

define('text!qk-alchemy/components/switch.component.html',[],function () { return '<quark-component>\r\n    <input type="checkbox" data-bind="onBind: getElement" />\r\n</quark-component>\r\n';});

/**
    @component A <a href="http://abpetkov.github.io/switchery/">Switchery</a> wrap.
    An ios like switch.
*/
define('qk-alchemy/components/switch.component',[
    'quark',
    'knockout',
    'jquery',
    'switchery/js',
    'text!./switch.component.html',
    'loadCss!switchery/css'
], function($$, ko, $, Switchery, template) {

    function SwitchComponent(params, $scope, $imports) {
        var self = this;

        var element;
        var switchElement;
        var config = {};

        $$.parameters({
            /**
                @parameter bool Indicates that the switch is on or off
                @observable @exposed
            */
            value: ko.observable(false),
            /**
                @parameter bool Indicates if the switch is disabled
                @observable @exposed
            */
            disabled: ko.observable(false)
        }, params, this);

        $$.parameters({
            /**
                @parameter string Color of the switch element (HEX or RGB value)
            */
            color: '#64bd63',
            /**
                @parameter string Secondary color for the background color and border, when the switch is off
            */
            secondaryColor: '#dfdfdf',
            /**
                @parameter string Default color of the jack/handle element
            */
            jackColor: '#fff',
            /**
                @parameter string Color of unchecked jack/handle element
            */
            jackSecondaryColor: null,
            /**
                @parameter string Size of the swich (small, normal, large)
            */
            size: 'small'
        }, params, config);

        function setDisabled() {
            if (self.disabled()) {
                switchElement.disable();
            } else {
                switchElement.enable();
            }
        }

        $scope.getElement = function(dom) {
            element = dom;

            element.checked = self.value();

            switchElement = new Switchery(element, config);

            setDisabled();

            element.onchange = function() {
                if (self.value() != element.checked) {
                    self.value(element.checked);
                }
            };
        }

        var subscriptions = {
            value: self.value.subscribe(function(value) {
                if (element.checked != value) {
                    $(element).trigger('click');
                    element.checked = value;
                }
            }),
            disabled: self.disabled.subscribe(function(value) {
                setDisabled();
            })
        }

        $scope.dispose = function() {
            if (switchElement) {
                switchElement.destroy();
            }

            subscriptions.value.dispose();
            subscriptions.disabled.dispose();
        }
    }

    return $$.component(SwitchComponent, template);
});

require.config({
    cssConfig: {
        'bootstrap/css': 'bootstrap.css',
        'qk-alchemy/css/sidebar': 'alchemy.css',
        'qk-alchemy/css/navbar': 'alchemy.css',
        'qk-alchemy/css/submenu': 'alchemy.css',
        'switchery/css': 'bootstrap.css'
    }
});

require(["app/startup"]);

require.config({
  "bundles": {
    "layout": [
      "text!qk-alchemy/components/layout.component.html",
      "qk-alchemy/components/layout.component",
      "text!qk-alchemy/components/layout/container.component.html",
      "qk-alchemy/lib/utils",
      "qk-alchemy/components/layout/container.component"
    ],
    "sidebar": [
      "text!qk-alchemy/components/layout/sidebar.component.html",
      "qk-alchemy/lib/utils",
      "text!qk-alchemy/components/layout.component.html",
      "qk-alchemy/components/layout.component",
      "qk-alchemy/components/layout/sidebar.component",
      "text!qk-alchemy/components/layout/sidebar/imagebutton.component.html",
      "qk-alchemy/components/layout/sidebar/imagebutton.component",
      "text!qk-alchemy/components/layout/sidebar/link.component.html",
      "qk-alchemy/components/layout/sidebar/link.component",
      "text!qk-alchemy/components/layout/sidebar/search.component.html",
      "qk-alchemy/components/layout/sidebar/search.component",
      "text!qk-alchemy/components/layout/sidebar/title.component.html",
      "qk-alchemy/components/layout/sidebar/title.component"
    ],
    "navbar": [
      "text!qk-alchemy/components/layout/navbar.component.html",
      "qk-alchemy/lib/utils",
      "text!qk-alchemy/components/layout.component.html",
      "qk-alchemy/components/layout.component",
      "qk-alchemy/components/layout/navbar.component",
      "text!qk-alchemy/components/layout/navbar/button.component.html",
      "qk-alchemy/components/layout/navbar/button.component",
      "text!qk-alchemy/components/layout/navbar/dropdown.component.html",
      "qk-alchemy/components/layout/navbar/dropdown.component",
      "text!qk-alchemy/components/layout/navbar/dropdown/divider.component.html",
      "qk-alchemy/components/layout/navbar/dropdown/divider.component",
      "text!qk-alchemy/components/layout/navbar/dropdown/header.component.html",
      "qk-alchemy/components/layout/navbar/dropdown/header.component",
      "text!qk-alchemy/components/layout/navbar/dropdown/link.component.html",
      "qk-alchemy/components/layout/navbar/dropdown/link.component",
      "text!qk-alchemy/components/layout/navbar/link.component.html",
      "qk-alchemy/components/layout/navbar/link.component"
    ]
  }
});
