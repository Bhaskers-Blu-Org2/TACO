﻿/**
﻿ * ******************************************************
﻿ *                                                       *
﻿ *   Copyright (C) Microsoft. All rights reserved.       *
﻿ *                                                       *
﻿ *******************************************************
﻿ */
/// <reference path="../../typings/mocha.d.ts" />
/// <reference path="../../typings/node.d.ts" />
/// <reference path="../../typings/should.d.ts" />
/// <reference path="../../typings/cordovaExtensions.d.ts" />
"use strict";

import should = require("should");
import tacoUtils = require ("taco-utils");

import CordovaWrapper = require ("../cli/utils/cordovaWrapper");
import mockCordova = require ("./utils/mockCordova");

import Commands = tacoUtils.Commands;
import TacoPackageLoader = tacoUtils.TacoPackageLoader;

describe("cordovaWrapper", () => {
    var dummyData: Commands.ICommandData = { options: {}, original: [], remain: [] };
    var functionsCalled: { [index: string]: boolean } = {};
    before((): void => {
        // Set up tests with mocked out Cordova implementation
        var cordova = mockCordova.MockCordova510.default;
        cordova.raw.build = (): Q.Promise<any> => {
            functionsCalled["build"] = true;
            throw new Error("Build Error thrown synchronously");
            return Q({});
        };
        cordova.raw.run = (): Q.Promise<any> => {
            functionsCalled["run"] = true;
            return Q.reject(new Error("Run Rejected Promise"));
        };
        cordova.raw.emulate = (): Q.Promise<any> => {
            functionsCalled["emulate"] = true;
            var deferred = Q.defer();
            setTimeout(() => {
                throw new Error("Emulate Error thrown asynchronously");
            },1);
            return deferred.promise;
        }

        TacoPackageLoader.MockForTests = {
            lazyRequire: (packageName: string, packageId: string, logLevel?: TacoUtility.InstallLogLevel) => {
                if (packageName !== "cordova") {
                    return Q.reject(new Error("Expected to load cordova package"));
                }
                return Q(cordova);
            }
        }
    });

    after((): void => {
        tacoUtils.TacoPackageLoader.MockForTests = null;
    });

    it("should catch synchronous exceptions thrown from cordova", (done: MochaDone): void => {
        CordovaWrapper.build(dummyData).then(() => {
            throw new Error("Should have failed with a synchronous exception")
        }, () => {
            should(functionsCalled["build"]).be.true;
        }).done(() => done(), done);
    });

    it("should handle cordova's rejected promises", (done: MochaDone): void => {
        CordovaWrapper.run(dummyData).then(() => {
            throw new Error("Should have failed with a rejected promise")
        }, () => {
            should(functionsCalled["run"]).be.true;
        }).done(() => done(), done);
    });

    it("should catch asynchronous exceptions thrown from cordova", (done: MochaDone): void => {
        CordovaWrapper.emulate(dummyData).then(() => {
            throw new Error("Should have failed with an asynchronous exception")
        }, () => {
            should(functionsCalled["emulate"]).be.true;
        }).done(() => done(), done);
    });
});