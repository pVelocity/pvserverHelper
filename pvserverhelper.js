/*global PV*/
'use strict';

/* jshint strict: true */
/* jshint node: true */
/* jshint unused: false */

module.exports = {
    sessionJsapiCache: {},

    addOrGetSessionJsapiObject: function(jsapi, sessionId) {
        if (this.sessionJsapiCache.hasOwnProperty(sessionId)) {
            return this.sessionJsapiCache[sessionId];
        } else {
            jsapi.isCached = true;
            this.sessionJsapiCache[sessionId] = jsapi;
            return jsapi;
        }
    },

    getSessionJsapiObject: function(jsapi, sessionId) {
        if (PV.isObject(this.sessionJsapiCache[sessionId])) {
            return this.sessionJsapiCache[sessionId];
        } else {
            return jsapi;
        }
    },

    removeSessionJsapiObject: function(jsapi, sessionId) {
        if (PV.isObject(this.sessionJsapiCache[sessionId])) {
            var cachedJsapi = this.sessionJsapiCache[sessionId];
            cachedJsapi.isCached = null;
            delete this.sessionJsapiCache[sessionId];
            return cachedJsapi;
        } else {
            return jsapi;
        }
    },

    cleanupForNonCached: function(jsapi) {
        if (PV.isBoolean(jsapi.isCached) && jsapi.isCached) {

        } else {
            this.cleanup(jsapi);
        }
    },

    cleanup: function(jsapi) {
        if (jsapi.mongoConn) {
            jsapi.mongoConn.close();
            jsapi.mongoConn = null;
        }

        if (jsapi.sfdcConn) {
            if (jsapi.sfdc.isSession !== true) {
                jsapi.sfdcConn.logout();
            }
            jsapi.sfdcConn = null;
        }

        if (jsapi.pv) {
            jsapi.pv.logout();
            jsapi.pv = null;
        }
    },

    returnImmediately: function(callback) {
        throw {
            'code': 'RETURN_IMMEDIATELY',
            'callback': function() {
                callback(null, null);
            }
        };
    },

    scriptErrHandler: function(jsapi, callback) {
        var fn = function(err) {

            this.cleanupForNonCached(jsapi);

            if (PV.isString(err.message)) {
                err.message = err.message;
            } else if (PV.isString(err.Message)) {
                err.message = err.Message;
            } else if (PV.isFunction(err.message)) {
                err.message = err.message();
            } else {
                err.message = 'No Relevant Message';
            }

            if (PV.isString(err.code)) {
                err.code = err.code;
            } else if (PV.isString(err.Code)) {
                err.Code = err.Code;
            } else if (PV.isFunction(err.code)) {
                err.code = err.code();
            } else {
                err.code = 'JSAPI2_UNKNOWN_ERROR';
            }

            if (err.code === 'RETURN_IMMEDIATELY' && typeof(err.callback) === 'function') {
                err.callback();
            } else {
                callback({
                    'code': `${err.code}`,
                    'message': `${err.message}`
                }, null);
            }
        }.bind(this);
        return fn;
    },

    genericErrHandler: function(jsapi, callback) {
        var fn = function(err) {
            this.cleanupForNonCached(jsapi);

            callback({
                'code': 'JSAPI2_UNKNOWN_ERROR',
                'message': `The function encountered an unknown error.\n${JSON.stringify(err)}\n`
            }, null);
        }.bind(this);
        return fn;
    },

    setupLogger: function(jsapi) {
        if (PV.isObject(jsapi.logger) === false) {
            jsapi.logger = {};
        }
        jsapi.logger.info = function(message, noTimeStamp) {
            var timedMsg = '';
            if (noTimeStamp) {
                timedMsg = message;
            } else {
                timedMsg = PV.getTimeStamp() + ' - ' + message;
            }
            if (PV.isObject(jsapi.logger) && PV.isFunction(jsapi.logger.log)) {
                jsapi.logger.log('info', timedMsg);
            } else {
                //console.log('INFO: ' + timedMsg);
            }
        };
        jsapi.logger.error = function(error, throwError) {
            var message = 'ERROR';
            if (PV.isString(error.message)) {
                message = error.message;
            } else if (PV.isString(error.Message)) {
                message = error.Message;
            }

            var timedMsg = PV.getTimeStamp() + ' - ' + message;
            if (PV.isObject(jsapi.logger) && PV.isFunction(jsapi.logger.log)) {
                jsapi.logger.log('error', timedMsg);
            } else {
                console.log('ERROR: ' + timedMsg);
            }
            if (throwError !== false) {
                throw error;
            }
        };
        jsapi.logger.startTime = function(message) {
            var timerObj = {
                startTime: new Date(),
                message: message
            };
            return timerObj;
        };
        jsapi.logger.endTime = function(timerObj) {
            var timedMsg = timerObj.message;
            var endTime = new Date();
            var elapsedTime = (endTime - timerObj.startTime) / 1e3;
            timedMsg = timedMsg + ' - ElaspedTime: ' + elapsedTime + 's';
            if (PV.isObject(jsapi.logger) && PV.isFunction(jsapi.logger.log)) {
                jsapi.logger.log('TIMER', timedMsg);
            } else {
                console.log('TIMER: ' + timedMsg);
            }
        };
    },

    exec: function(jsapi, cmd) {
        return new jsapi.pvserver.Promise(function(resolve, reject) {
            try {
                var exec = require('child_process').exec;
                exec(cmd, function(error, stdout, stderr) {
                    if (error) {
                        reject(error);
                    } else {
                        jsapi.logger.info('stdout: ' + stdout, true);
                        jsapi.logger.info('stderr: ' + stderr, true);
                        resolve();
                    }
                });
            } catch (err) {
                reject(err);
            }
        });
    },

    bulkExecute: function(jsapi, bulk) {
        return new jsapi.pvserver.Promise(function(resolve, reject) {
            bulk.execute(function(err, result) {
                if (err) {
                    reject(err);
                } else {
                    resolve(result);
                }
            });
        });
    },

    dropSomeCollections: function(jsapi, matchFunction) {
        return jsapi.mongoConn.listCollections({}).toArray().then(function(result) {
            var promises = [];
            result.forEach(function(collection) {
                if (matchFunction(collection.name)) {
                    promises.push(jsapi.mongoConn.collection(collection.name).dropAsync());
                }
            });
            return jsapi.pvserver.Promise.all(promises);
        });
    },

    dropCollection: function(jsapi, collectionName) {
        return jsapi.mongoConn.listCollections({
            name: collectionName
        }).toArray().then(function(result) {
            if (result.length > 0) {
                return jsapi.mongoConn.collection(collectionName).dropAsync();
            } else {
                return;
            }
        });
    },

    createCollection: function(jsapi, collectionName, drop, indices) {
        return jsapi.mongoConn.listCollections({
            name: collectionName
        }).toArray().then(function(result) {
            if (result.length === 0) {
                return jsapi.mongoConn.createCollectionAsync(collectionName);
            } else if (drop) {
                return jsapi.mongoConn.collection(collectionName).dropAsync();
            } else {
                return false;
            }
        }).then(function(result) {
            if (PV.isObject(result)) {
                return result;
            } else if (drop) {
                return jsapi.mongoConn.createCollectionAsync(collectionName);
            } else {
                return;
            }
        }).then(function(result) {
            if (PV.isObject(result) && (PV.isArray(indices)) || PV.isObject(indices)) {
                return this.createIndices(jsapi, collectionName, indices);
            } else {
                return result;
            }
        }.bind(this));
    },

    createIndices: function(jsapi, collectionName, indices) {
        var promises = [];
        var keys = {};
        var options = {};

        if (PV.isArray(indices)) {
            indices.forEach(function(index) {
                keys = index.keys;
                if (PV.isObject(keys)) {
                    options = index.options;
                    if (PV.isObject(options) === false) {
                        options = {};
                    }
                    promises.push(jsapi.mongoConn.collection(collectionName).ensureIndexAsync(keys, options));
                }
            });
        } else if (PV.isObject(indices)) {
            for (var prop in indices) {
                keys = {};
                options = {};
                if (prop !== '_id_') {
                    var indicesInfo = indices[prop];

                    options.name = prop;

                    for (var i = 0; i < indicesInfo.length; i++) {
                        var index = indicesInfo[i];
                        keys[index[0]] = index[1];
                    }

                    promises.push(jsapi.mongoConn.collection(collectionName).ensureIndexAsync(keys, options));
                }
            }
        }

        return jsapi.pvserver.Promise.all(promises);
    },

    // this replaces your source collection with a projection that includes the lookup fields
    // lookupField: field in lookupCollectionName that is being looked up
    // sourceKey: field in sourceCollectionName used as a key to match with lookupCollectionName
    // lookupKey: fields in lookupCollectionName used $project to construct a key that matches sourceKey
    // defaultValue: a $set value used to set a default for the lookupField
    // rename: field that the lookup will be set to, defaulted to lookupField
    // var lookupInfo = {
    //     'lookupField': {
    //         sourceKey: 'sourceKey',
    //         lookupKey: {
    //             $toUpper: {
    //                 $concat: ['$lookupProperty1', '-', '$lookupProperty2']
    //             }
    //         },
    //         defaultValue: 'defaultValue',
    //         rename: 'rename'
    //     }
    // };
    aggregateLookup: function(jsapi, sourceCollectionName, lookupCollectionName, lookupInfo, lookupOperations) {
        var timestamp = PV.createHash(PV.getTimeStamp());
        var tempLookupCollection = 'AG_' + PV.createHash(lookupCollectionName + '_' + timestamp);
        var tempSourceCollection = 'AG_' + PV.createHash(sourceCollectionName + '_' + timestamp);

        var lookupDuplicate = [];
        var indices = [];

        var project = {
            _id: 0
        };
        for (var lookupField in lookupInfo) {
            project[lookupField] = '$' + lookupField;

            var lookup = lookupInfo[lookupField];
            var lookupKeyString = JSON.stringify(lookup.lookupKey);

            var lookupKey = PV.createHash(lookupKeyString + '1_' + timestamp);
            if (lookupDuplicate.indexOf(lookupKeyString) === -1) {
                project[lookupKey] = PV.isString(lookup.lookupKey) ? '$' + lookup.lookupKey : lookup.lookupKey;
                lookupDuplicate.push(lookupKeyString);
                var keys = {};
                keys[lookupKey] = 1;
                indices.push({
                    keys: keys
                });
            }
        }
        lookupDuplicate = [];

        var promises = [];
        promises.push(jsapi.mongoConn.collection(sourceCollectionName).indexInformationAsync());
        promises.push(this.createCollection(jsapi, tempLookupCollection, true, indices));

        return jsapi.pvserver.Promise.all(promises).then(function(results) {
            var pipeline = [];
            if (PV.isArray(lookupOperations)) {
                lookupOperations.forEach(function(operation) {
                    pipeline.push(operation);
                });
            }

            pipeline.push({
                $project: project
            });

            pipeline.push({
                $out: tempLookupCollection
            });

            var promises = [];
            promises.push(this.getAggregateProjectMapping(jsapi, sourceCollectionName));
            promises.push(this.createCollection(jsapi, tempSourceCollection, true, results[0]));
            promises.push(jsapi.mongoConn.collection(lookupCollectionName).aggregateAsync(pipeline));

            return jsapi.pvserver.Promise.all(promises);
        }.bind(this)).then(function(results) {
            var project = results[0];

            var pipelineLookup = [];
            var pipelineUnwind = [];

            var tempKeyDuplicate = [];

            for (var lookupField in lookupInfo) {
                var lookup = lookupInfo[lookupField];
                var lookupKeyString = JSON.stringify(lookup.lookupKey);

                var lookupKey = PV.createHash(lookupKeyString + '1_' + timestamp);
                var tempKey = PV.createHash(lookup.sourceKey + '2_' + timestamp);
                var lookupFieldKey = PV.createHash(lookupField + '3_' + timestamp);
                if (lookupDuplicate.indexOf(lookupKeyString) === -1 && tempKeyDuplicate.indexOf(tempKey) === -1) {
                    pipelineLookup.push({
                        $lookup: {
                            from: tempLookupCollection,
                            localField: lookup.sourceKey,
                            foreignField: lookupKey,
                            as: tempKey
                        }
                    });

                    pipelineUnwind.push({
                        $unwind: {
                            path: '$' + tempKey,
                            preserveNullAndEmptyArrays: true
                        }
                    });
                }

                project[lookupFieldKey] = '$' + tempKey + '.' + lookupField;

                if (lookupDuplicate.indexOf(lookupKeyString) === -1) {
                    lookupDuplicate.push(lookupKey);
                }
                if (tempKeyDuplicate.indexOf(tempKey) === -1) {
                    tempKeyDuplicate.push(tempKey);
                }
            }

            var pipeline = pipelineLookup.concat(pipelineUnwind);

            pipeline.push({
                $project: project
            });
            pipeline.push({
                $out: tempSourceCollection
            });

            return jsapi.mongoConn.collection(sourceCollectionName).aggregateAsync(pipeline);
        }.bind(this)).then(function() {
            var promises = [];

            promises.push(this.dropCollection(jsapi, tempLookupCollection));
            promises.push(this.dropCollection(jsapi, sourceCollectionName));

            for (var lookupField in lookupInfo) {
                var lookup = lookupInfo[lookupField];
                var lookupFieldKey = PV.createHash(lookupField + '3_' + timestamp);

                var rename = {};
                rename[lookupFieldKey] = PV.isString(lookup.rename) ? lookup.rename : lookupField;

                var filter = {};
                filter[lookupFieldKey] = {
                    $exists: true
                };

                promises.push(jsapi.mongoConn.collection(tempSourceCollection).updateManyAsync(filter, {
                    $rename: rename
                }));

                var defaultValue = lookup.defaultValue;
                if (PV.isNull(defaultValue) === false && PV.isUndefined(defaultValue) === false) {
                    var filter2 = {};
                    filter2[lookupFieldKey] = {
                        $exists: false
                    };
                    var set = {};
                    set[PV.isString(lookup.rename) ? lookup.rename : lookupField] = defaultValue;
                    promises.push(jsapi.mongoConn.collection(tempSourceCollection).updateManyAsync(filter2, {
                        $set: set
                    }));
                }
            }
            return jsapi.pvserver.Promise.all(promises);
        }.bind(this)).then(function() {
            return jsapi.mongoConn.collection(tempSourceCollection).rename(sourceCollectionName);
        }.bind(this));
    },

    createExpressionMapping: function(objectOrArray, accumulator, aggregated, exclude_id) {
        var arr = null;
        if (PV.isArray(objectOrArray)) {
            arr = objectOrArray;
        } else if (PV.isObject(objectOrArray)) {
            arr = Object.keys(objectOrArray);
        }

        var project = {};
        arr.forEach(function(element) {
            var value = null;
            if (aggregated === true) {
                value = '$_id.' + element;
            } else {
                value = '$' + element;
            }
            if (PV.isString(accumulator)) {
                project[element] = {};
                project[element][accumulator] = value;
            } else {
                project[element] = value;
            }
        });
        if (exclude_id !== true) {
            project._id = 0;
        }
        return project;
    },

    find: function(jsapi, collectionName, id, projection) {
        var filter = {};
        if (PV.isString(id)) {
            filter._id = new jsapi.mongodb.ObjectId.createFromHexString(id);
        } else if (PV.isObject(id)) {
            filter._id = id;
        }
        if (PV.isObject(projection) === false) {
            projection = {};
        }
        return jsapi.mongoConn.collection(collectionName).find(filter, projection).toArrayAsync();
    },

    move: function(jsapi, sourceCollection, targetCollection, filter, projection) {
        if (PV.isObject(filter) === false) {
            filter = {};
        }
        if (PV.isObject(projection) === false) {
            projection = {};
        }
        return jsapi.mongoConn.collection(sourceCollection).find(filter, projection).toArrayAsync().then(function(result) {
            if (result.length > 0) {
                return jsapi.mongoConn.collection(targetCollection).insertManyAsync(result);
            } else {
                return result;
            }
        });
    },

    getAggregateProjectMapping: function(jsapi, collectionName, filter) {
        if (PV.isObject(filter) === false) {
            filter = {};
        }
        return jsapi.mongoConn.collection(collectionName).findOneAsync(filter).then(function(result) {
            return this.createExpressionMapping(result);
        }.bind(this));
    },

    cleanupChildren: function(jsapi, collectionName, id, childrenMap) {
        var projection = {};
        for (var child in childrenMap) {
            projection[childrenMap[child]] = 1;
        }

        return this.find(jsapi, collectionName, id, projection).then(function(result) {
            var promises = [];
            var set = {};

            for (var child in childrenMap) {
                var targets = result[0][childrenMap[child]];
                if (PV.isArray(targets)) {
                    set[childrenMap[child]] = [];
                } else {
                    set[childrenMap[child]] = null;
                }

                var filter = null;
                if (PV.isArray(targets)) {
                    filter = {
                        _id: {
                            $in: targets
                        }
                    };
                } else if (PV.isObject(targets)) {
                    filter = {
                        _id: targets
                    };
                }
                if (PV.isObject(filter)) {
                    promises.push(jsapi.mongoConn.collection(child).removeAsync(filter));
                }
            }

            var updateFilter = {};
            if (PV.isString(id)) {
                updateFilter._id = new jsapi.mongodb.ObjectId.createFromHexString(id);
            } else if (PV.isObject(id)) {
                updateFilter._id = id;
            }

            promises.push(jsapi.mongoConn.collection(collectionName).updateOneAsync(updateFilter, {
                $set: set
            }));

            return jsapi.pvserver.Promise.all(promises);
        });
    },

    isEmptyValue: function(value) {
        return PV.isNull(value) || PV.isUndefined(value) ||
            value === '-N/A-' || value === '- N/A -' ||
            (PV.isString(value) && value.trim().length === 0);
    },

    setCallbackTimeout: function(jsapi, timeout, callback) {
        setTimeout(function() {
            if (jsapi.callbackTracker !== true) {
                jsapi.callbackTracker = true;
                callback(null, null);
            }
        }, timeout);
    },

    checkCallbackTimeout: function(jsapi, callback) {
        if (jsapi.callbackTracker !== true) {
            jsapi.callbackTracker = true;
            callback(null, null);
        }
    },

    login: function(jsapi, protocol, host, port, username, password) {
        jsapi.logger.info('Logging in ' + protocol + '://' + host + ':' + port);
        jsapi.pv = new jsapi.pvserver.PVServerAPI(protocol + '://' + host + ':' + port);
        return jsapi.pv.login(username, password, null).then(function(resp) {
            if (this.isResultOk(resp)) {
                return true;
            } else {
                jsapi.logger.error(this.getPVStatus(resp));
                return false;
            }
        }.bind(this));
    },

    loginWithSession: function(jsapi) {
        return new jsapi.pvserver.Promise(function(resolve, reject) {
            if (PV.isObject(jsapi.pv) === false) {
                jsapi.pv = new jsapi.pvserver.PVServerAPI(jsapi.PVSession.engineSessionInfo.url);
                jsapi.pv.login(null, null, jsapi.PVSession.engineSessionInfo.apiKey).then(function(resp) {
                    if (this.isResultOk(resp)) {
                        resolve(true);
                    } else {
                        jsapi.pv = null;
                        jsapi.logger.error(this.getPVStatus(resp));
                        resolve(false);
                    }
                }.bind(this));
            } else {
                resolve(true);
            }
        }.bind(this));
    },

    parseProviderModelUrl: function(url) {
        var info = {};

        var re = /:[\/][\/]([^\/]+)[\/]([^\/?]+)[?\/]?.*/;
        var m = null;
        if ((m = re.exec(url)) !== null) {
            if (m.index === re.lastIndex) {
                re.lastIndex++;
            }
            info.host = m[1];
            info.dbname = m[2];
        } else {
            info.host = null;
            info.dbname = null;
        }

        return info;
    },

    getProviderModelInfo: function(jsapi, tag, params) {
        var infoTag = null;
        if (tag === 'MongoDB') {
            infoTag = 'mongo';
        } else if (tag === 'Salesforce') {
            infoTag = 'sfdc';
        }

        if (PV.isObject(jsapi[infoTag]) === false) {
            jsapi[infoTag] = {};
        }

        try {
            var connectionInfo = jsapi.PVSession.engineSessionInfo.providerModelsByTag[tag];
            for (var prop in connectionInfo) {
                jsapi[infoTag][prop] = connectionInfo[prop];
            }
            jsapi.logger.info(infoTag + ' Engine Session Info');
        } catch (e1) {
            try {
                jsapi[infoTag].modelId = JSON.parse(params.OpRequest).PVRequest.Operation.Params.ProfitModel.text;
                jsapi.logger.info(infoTag + ' OpRequest');
            } catch (e2) {
                try {
                    var domain = tag.toUpperCase();
                    var models = JSON.parse(params.ProviderModels);
                    jsapi[infoTag].modelId = models[domain];
                    jsapi.logger.info(infoTag + ' ProviderModels');
                } catch (e2) {}
            }
        }

        return PV.isString(jsapi[infoTag].modelId);
    },

    createMongoProviderModel: function(jsapi, username, appName, dbHostName, options) {
        jsapi.mongo = {};
        var dataSetQuery = {
            'Type': 'MongoDB',
            'KeyValue': [{
                'Key': 'userId',
                'Value': username
            }, {
                'Key': 'appName',
                'Value': appName
            }, {
                'Key': 'mongoDBHostName',
                'Value': dbHostName
            }]
        };

        jsapi.logger.info('Creating provider model with ' + username + ' for ' + appName + ' accessing ' + dbHostName);
        return jsapi.pv.sendRequest('CreateProviderModel', dataSetQuery).then(function(resp) {
            if (this.isResultOk(resp)) {
                var status = this.getPVStatus(resp);
                jsapi.mongo.modelId = status.ModelId;
                jsapi.logger.info('Getting provider model url with ' + status.ModelId);
                return this.getProviderModelUrl(jsapi, options);
            } else {
                jsapi.mongo.modelId = null;
                jsapi.logger.error(this.getPVStatus(resp));
                return false;
            }
        }.bind(this));
    },

    getProviderModelUrl: function(jsapi, options) {
        return jsapi.pv.sendRequest('GetProviderModelUrl', {
            'ProfitModel': jsapi.mongo.modelId
        }).then(function(resp) {
            if (this.isResultOk(resp)) {
                var status = this.getPVStatus(resp);
                var info = this.parseProviderModelUrl(status.Url);

                jsapi.mongo.host = info.host;
                jsapi.mongo.dbname = info.dbname;

                var optionsStr = PV.convertObjectToStr(options);
                if (optionsStr !== '') {
                    optionsStr = '?' + optionsStr;
                }
                jsapi.mongo.url = status.Url + optionsStr;

                if (PV.isString(info.host) && PV.isString(info.dbname)) {
                    jsapi.logger.info('Mongo Host: ' + jsapi.mongo.host);
                    jsapi.logger.info('Mongo Database: ' + jsapi.mongo.dbname);
                    return true;
                } else {
                    jsapi.logger.error({
                        message: 'Unable to extract Mongo host from data source url',
                        code: 'Parsing Error'
                    });
                    return false;
                }
            } else {
                jsapi.mongo.url = null;
                jsapi.mongo.host = null;
                jsapi.mongo.dbname = null;
                jsapi.logger.error(this.getPVStatus(resp));
                return false;
            }
        }.bind(this));
    },

    setupMongoDBUrl: function(jsapi, serverHost, serverPort, serverUserId, serverPassword, serverAuthDatabase, database, options) {
        return new jsapi.pvserver.Promise(function(resolve, reject) {
            if (PV.isObject(jsapi.mongo) === false) {
                jsapi.mongo = {};
            }
            if (PV.isString(serverHost) && PV.isString(database)) {
                jsapi.mongo.host = serverHost;
                jsapi.mongo.dbname = database;
                var arr = [];
                arr.push('mongodb://');

                if (PV.isString(serverUserId)) {
                    arr.push(encodeURIComponent(serverUserId));

                    if (PV.isString(serverPassword)) {
                        arr.push(':' + encodeURIComponent(serverPassword));
                    }
                    arr.push('@');
                }
                arr.push(serverHost);

                if (PV.isString(serverPort)) {
                    arr.push(':' + serverPort);
                }
                arr.push('/' + database);

                var optionsStr = null;
                if (PV.isString(serverAuthDatabase)) {
                    var optionsObj = {};
                    if (PV.isObject(options)) {
                        for (var k in options) optionsObj[k] = options[k];
                    }
                    optionsObj.authSource = serverAuthDatabase;
                    optionsStr = PV.convertObjectToStr(optionsObj);
                } else {
                    if (PV.isObject(options)) {
                        optionsStr = PV.convertObjectToStr(options);
                    }
                }

                if (optionsStr !== '') {
                    arr.push('?' + optionsStr);
                }
                jsapi.mongo.url = arr.join('');
                resolve(true);
            } else {
                jsapi.mongo.url = null;
                jsapi.mongo.host = null;
                jsapi.mongo.dbname = null;
                jsapi.logger.error({
                    message: 'Missing data source url parameters',
                    code: 'Bad Parameters'
                });
                resolve(false);
            }
        });
    },

    createMongoDB: function(jsapi) {
        return new jsapi.pvserver.Promise(function(resolve, reject) {
            if (PV.isObject(jsapi.mongoConn) === false) {
                if (PV.isObject(jsapi.mongo) && PV.isString(jsapi.mongo.url)) {
                    var MongoClient = jsapi.pvserver.Promise.promisifyAll(jsapi.mongodb);
                    MongoClient.connect(jsapi.mongo.url).then(function(dbconn) {
                        jsapi.mongoConn = dbconn;
                        resolve(true);
                    });
                } else {
                    jsapi.mongoConn = null;
                    jsapi.logger.error({
                        message: 'Missing data source url',
                        code: 'No Connection'
                    });
                    resolve(false);
                }
            } else {
                resolve(true);
            }
        });
    },

    getEntityGroupsAndFields: function(entity, entityArray) {
        var result = null;
        entityArray.forEach(function(obj) {
            if (obj.Name === entity) {
                result = obj;
            }
        });

        result.Groups = result.Groups.Group;
        result.Fields = result.Fields.Field;
        return result;
    },

    convertGroupOrFieldArrayForQueryParams: function(arr) {
        var newArray = [];
        arr.forEach(function(field) {
            if ((typeof field) === 'string') {
                newArray.push({
                    '_attrs': {
                        'name': 'Res1'
                    },
                    '_text': field
                });
            }
        });
        return newArray;
    },

    removeEntityRelationshipGroupAndFields: function(meta, entity, relationshipPatterns, not) {
        if (PV.isBoolean(not) === false) {
            not = false;
        }
        relationshipPatterns.forEach(function(pattern) {
            var relationPattern = entity + '_' + pattern;
            var reg = null;
            eval('reg=/' + relationPattern + '.+/i');
            var groups = meta.Groups;
            var i = 0;
            do {
                if (reg.test(groups[i])) {
                    if (not) {
                        i++;
                    } else {
                        groups.splice(i, 1);
                    }
                } else {
                    if (not) {
                        groups.splice(i, 1);
                    } else {
                        i++;
                    }
                }
            } while (i < groups.length);

            var fields = meta.Fields;
            var j = 0;
            do {
                if (reg.test(fields[j])) {
                    if (not) {
                        j++;
                    } else {
                        fields.splice(j, 1);
                    }
                } else {
                    if (not) {
                        fields.splice(j, 1);
                    } else {
                        j++;
                    }
                }
            } while (j < fields.length);
        });
    },

    getGroupValueFromQueryParams: function(queryParams, objectName, groupName) {
        var result = null;
        var regexp = /^([^=]+)=[']([^']+)[']$/i;
        try {
            var dp = queryParams.SearchCriteria.AndFilter;
            PV.ensureArray(dp.OrFilter).forEach(function(compTerm) {
                var category = compTerm._attrs.category;
                if ((!objectName || (!category || category === objectName)) && compTerm.AndFilter.Filter) {
                    PV.ensureArray(compTerm.AndFilter.Filter).forEach(function(filterTerm) {
                        var matches = regexp.exec(filterTerm);
                        if (matches) {
                            var group = matches[1];
                            var value = matches[2];
                            if (group === groupName) {
                                result = value;
                            }
                        }
                    });
                }
            });
        } catch (ignore) {}
        return result;
    },

    getPVStatus: function(response) {
        var PVStatus = null;

        if (response) {
            PVStatus = response.PVResponse.PVStatus;
        }

        return PVStatus;
    },
    getResultCode: function(response) {
        var code = null;

        if (response) {
            var PVStatus = this.getPVStatus(response);
            if (PVStatus) {
                code = PVStatus.Code;
            }
        }

        return code;
    },
    getResultMessage: function(response) {
        var message = null;

        if (response) {
            var PVStatus = this.getPVStatus(response);
            if (PVStatus) {
                message = PVStatus.Message;
            }
        }

        return message;
    },
    getResultScriptMessage: function(response) {
        var message = null;

        if (response) {
            var PVStatus = this.getPVStatus(response);
            if (PVStatus && PV.isString(PVStatus.SCRIPT_ERROR_MSG)) {
                message = PVStatus.SCRIPT_ERROR_MSG;
            }
        }

        return message;
    },
    isResultOk: function(response) {
        var result = false;

        if (response) {
            var codeText = this.getResultCode(response);
            var message = this.getResultMessage(response);
            if (codeText === 'RPM_PE_STATUS_OK' && message === 'Okay') {
                result = true;
            }
        }
        return result;
    },
    isResultTruncated: function(response) {
        var result = false;

        if (response) {
            var codeText = this.getResultCode(response);
            if (codeText === 'RPM_PE_QUERY_RESULT_TRUNCATED') {
                result = true;
            }
        }
        return result;
    },
    isResultTooLarge: function(response) {
        var result = false;

        if (response) {
            var codeText = this.getResultCode(response);
            var messageText = this.getResultMessage(response);
            if (codeText === 'RPM_PE_QUERY_FAILED' && messageText === 'Error: Request Entity Too Large: head') {
                result = true;
            }
        }
        return result;
    },
    isBulkUpsertInProgress: function(response) {
        var result = false;

        if (response) {
            var codeText = this.getResultCode(response);
            if (codeText === 'RPM_PE_QUERY_RESULT_OK_UPSERT_IN_PROGRESS' ||
                codeText === 'RPM_PE_QUERY_RESULT_TRUNCATED_UPSERT_IN_PROGRESS') {
                result = true;
            }
        }
        return result;
    }
};