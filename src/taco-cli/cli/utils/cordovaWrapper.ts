﻿/// <reference path="../../../typings/node.d.ts" />
/// <reference path="../../../typings/Q.d.ts" />
/// <reference path="../../../typings/cordovaExtensions.d.ts" />

"use strict";

import child_process = require ("child_process");
import os = require ("os");
import path = require ("path");
import Q = require ("q");
import util = require ("util");

import cordovaUtils = require ("./cordovaUtils");
import resources = require ("../../resources/resourceManager");
import tacoUtility = require ("taco-utils");

import packageLoader = tacoUtility.TacoPackageLoader;

class CordovaWrapper {
    private static CordovaCommandName: string = os.platform() === "win32" ? "cordova.cmd" : "cordova";
    private static CordovaNpmPackageName: string = "cordova";

    public static cli(args: string[]): Q.Promise<any> {
        var deferred = Q.defer();
        var proc = child_process.spawn(CordovaWrapper.CordovaCommandName, args, { stdio: "inherit" });
        proc.on("error", function (err: Error): void {
            deferred.reject(err);
        });
        proc.on("close", function (code: number): void {
            if (code) {
                deferred.reject(new Error(resources.getString("CordovaCommandFailed", code, args.join(" "))));
            } else {
                deferred.resolve({});
            }
        });
        return deferred.promise;
    }

    public static build(platform: string): Q.Promise<any> {
        return CordovaWrapper.cli(["build", platform]);
    }

    /**
     * Wrapper for 'cordova create' command.
     *
     * @param {string} The ID of the kit to use
     * @param {string} The path of the project to create
     * @param {string} The id of the app
     * @param {string} The name of app
     * @param {string} A JSON string whose key/value pairs will be added to the cordova config file in <project path>/.cordova/
     * @param {[option: string]: any} Bag of option flags for the 'cordova create' command
     *
     * @return {Q.Promise<any>} An empty promise
     */
    public static create(cordovaCli: string, cordovaParameters: cordovaUtils.ICordovaCreateParameters): Q.Promise<any> {
        return packageLoader.lazyRequire(CordovaWrapper.CordovaNpmPackageName, cordovaCli)
            .then(function (cordova: Cordova.ICordova): Q.Promise<any> {
                cordovaUtils.prepareCordovaConfig(cordovaParameters);

            return cordova.raw.create(cordovaParameters.projectPath, cordovaParameters.appId, cordovaParameters.appName, cordovaParameters.cordovaConfig);
        });
    }
}

export = CordovaWrapper;