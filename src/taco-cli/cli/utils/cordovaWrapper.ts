﻿/**
﻿ *******************************************************
﻿ *                                                     *
﻿ *   Copyright (C) Microsoft. All rights reserved.     *
﻿ *                                                     *
﻿ *******************************************************
﻿ */

/// <reference path="../../../typings/cordovaExtensions.d.ts" />
/// <reference path="../../../typings/node.d.ts" />
/// <reference path="../../../typings/Q.d.ts" />
/// <reference path="../../../typings/semver.d.ts" />

"use strict";

import child_process = require ("child_process");
import os = require ("os");
import path = require ("path");
import Q = require ("q");
import semver = require ("semver");
import util = require ("util");

import cordovaHelper = require ("./cordovaHelper");
import projectHelper = require ("./projectHelper");
import resources = require ("../../resources/resourceManager");
import TacoErrorCodes = require ("../tacoErrorCodes");
import errorHelper = require ("../tacoErrorHelper");
import tacoUtility = require ("taco-utils");

import commands = tacoUtility.Commands;
import packageLoader = tacoUtility.TacoPackageLoader;
import ConfigParser = Cordova.cordova_lib.configparser;

class CordovaWrapper {
    private static CordovaCommandName: string = os.platform() === "win32" ? "cordova.cmd" : "cordova";
    private static CordovaNpmPackageName: string = "cordova";
    private static CordovaRequirementsMinVersion: string = "5.1.0";

    public static cli(args: string[], captureOutput: boolean = false): Q.Promise<string> {
        var deferred = Q.defer<string>();
        var output: string = "";
        var errorOutput: string = "";
        var options: child_process.IExecOptions = captureOutput ? { stdio: "pipe" } : { stdio: "inherit" };
        var proc = child_process.spawn(CordovaWrapper.CordovaCommandName, args, options);

        proc.on("error", function (err: any): void {  
            // ENOENT error thrown if no Cordova.cmd is found
            var tacoError = (err.code === "ENOENT") ?
                errorHelper.get(TacoErrorCodes.CordovaCmdNotFound) :
                errorHelper.wrap(TacoErrorCodes.CordovaCommandFailedWithError, err, args.join(" "));
            deferred.reject(tacoError);
        });

        if (captureOutput) {
            proc.stdout.on("data", function (data: Buffer): void {
                output += data.toString();
            });
            proc.stderr.on("data", function (data: Buffer): void {
                errorOutput += data.toString();
            });
        }

        proc.on("close", function (code: number): void {
            if (code) {
                // Special handling for 'cordova requirements': this Cordova command returns an error when some requirements are not installed, when technically this is not really an error (the command executes
                // correctly and reports that some requirements are missing). In that case, if the captureOutput flag is set, we don't want to report an error. To detect this case, we have to parse the returned
                // error output because there is no specific error code for this case. For now, we just look for the "Some of requirements check failed" sentence.
                if (captureOutput && output && args[0] === "requirements" && code === 1 && errorOutput && errorOutput.indexOf("Some of requirements check failed") !== -1) {
                    deferred.resolve(output);
                } else {
                    var tacoError = errorOutput ?
                        errorHelper.wrap(TacoErrorCodes.CordovaCommandFailedWithError, new Error(errorOutput), args.join(" ")) :
                        errorHelper.get(TacoErrorCodes.CordovaCommandFailed, code, args.join(" "));
                    deferred.reject(tacoError);
                }
            } else {
                if (captureOutput && output) {
                    deferred.resolve(output);
                } else {
                    deferred.resolve("");
                }
            }
        });
        return deferred.promise;
    }

    public static build(platform: string, commandData: commands.ICommandData): Q.Promise<any> {
        return projectHelper.getProjectInfo().then(function (projectInfo: projectHelper.IProjectInfo): Q.Promise<any> {
            if (projectInfo.cordovaCliVersion) {
                return packageLoader.lazyRequire(CordovaWrapper.CordovaNpmPackageName, CordovaWrapper.CordovaNpmPackageName + "@" + projectInfo.cordovaCliVersion, tacoUtility.InstallLogLevel.taco)
                    .then(function (cordova: typeof Cordova): Q.Promise<any> {
                        return cordova.raw.build(cordovaHelper.toCordovaBuildArguments(platform, commandData));
                });
            } else {
                return CordovaWrapper.cli(["build", platform].concat(cordovaHelper.toCordovaCliArguments(commandData)));
            }
        });
    }

    public static run(platform: string, commandData: commands.ICommandData): Q.Promise<any> {
        return projectHelper.getProjectInfo().then(function (projectInfo: projectHelper.IProjectInfo): Q.Promise<any> {
            if (projectInfo.cordovaCliVersion) {
                return packageLoader.lazyRequire(CordovaWrapper.CordovaNpmPackageName, CordovaWrapper.CordovaNpmPackageName + "@" + projectInfo.cordovaCliVersion, tacoUtility.InstallLogLevel.taco)
                    .then(function (cordova: typeof Cordova): Q.Promise<any> {
                    return cordova.raw.run(cordovaHelper.toCordovaRunArguments(platform, commandData));
                });
            } else {
                return CordovaWrapper.cli(["run", platform].concat(cordovaHelper.toCordovaCliArguments(commandData)));
            }
        });
    }

    public static requirements(platforms: string[]): Q.Promise<any> {
        // Try to see if we are in a taco project
        var projectInfo: projectHelper.IProjectInfo;

        return projectHelper.getProjectInfo()
            .then(function (pi: projectHelper.IProjectInfo): Q.Promise<any> {
                projectInfo = pi;

                // Check cordova version
                if (projectInfo.cordovaCliVersion) {
                    return Q.resolve(projectInfo.cordovaCliVersion);
                }

                return CordovaWrapper.cli(["-v"], true);
            })
            .then(function (version: string): Q.Promise<any> {
                // If the cordova version is older than 5.1.0, the 'requirements' command does not exist
                if (!semver.gte(version, CordovaWrapper.CordovaRequirementsMinVersion)) {
                    return Q.reject(errorHelper.get(TacoErrorCodes.CommandInstallCordovaTooOld));
                }

                return Q.resolve({});
            })
            .then(function (): Q.Promise<any> {
                // Execute the requirements command
                if (projectInfo.cordovaCliVersion) {
                    // If we are in a taco project, use the raw api
                    return packageLoader.lazyRequire(CordovaWrapper.CordovaNpmPackageName, CordovaWrapper.CordovaNpmPackageName + "@" + projectInfo.cordovaCliVersion, tacoUtility.InstallLogLevel.silent)
                        .then(function (cordova: Cordova.ICordova510): Q.Promise<any> {
                            return cordova.raw.requirements(platforms);
                        });
                }

                // Fallback to the global Cordova via the command line
                var args: string[] = ["requirements"];

                if (platforms) {
                    args = args.concat(platforms);
                }

                return CordovaWrapper.cli(args, true); 
            });
    }

    /**
     * Wrapper for 'cordova create' command.
     *
     * @param {string} The version of the cordova CLI to use
     * @param {ICordovaCreateParameters} The cordova create options
     *
     * @return {Q.Promise<any>} An empty promise
     */
    public static create(cordovaCliVersion: string, cordovaParameters: Cordova.ICordovaCreateParameters): Q.Promise<any> {
        return packageLoader.lazyRequire(CordovaWrapper.CordovaNpmPackageName, CordovaWrapper.CordovaNpmPackageName + "@" + cordovaCliVersion, tacoUtility.InstallLogLevel.taco)
            .then(function (cordova: typeof Cordova): Q.Promise<any> {
                cordovaHelper.prepareCordovaConfig(cordovaParameters);

                return cordova.raw.create(cordovaParameters.projectPath, cordovaParameters.appId, cordovaParameters.appName, cordovaParameters.cordovaConfig);
            });
    }

    public static getCordovaVersion(): Q.Promise<string> {
        return projectHelper.getProjectInfo().then(function (projectInfo: projectHelper.IProjectInfo): Q.Promise<string> {
            if (projectInfo.cordovaCliVersion) {
                return Q.resolve(projectInfo.cordovaCliVersion);
            } else {
                return CordovaWrapper.cli(["-v"], true).then(function (output: string): string {
                    return output.split("\n")[0];
                });
            }
        });
    }

    /**
     * Static method to get the plugin version specification from the config.xml file
     *
     * @param {string} The name(id) of the cordova plugin
     * @param {string} The path to config.xml of the project
     * @param {string} The cordova CLI version
     *
     * @return {Q.Promise<string>} A promise with the version specification as a string
     */
    public static getPluginVersionSpec(pluginId: string, configXmlPath: string, cordovaCliVersion: string): Q.Promise<string> {
        return packageLoader.lazyRequire(CordovaWrapper.CordovaNpmPackageName, CordovaWrapper.CordovaNpmPackageName + "@" + cordovaCliVersion)
            .then(function (cordova: typeof Cordova): Q.Promise<any> {
            var configParser: ConfigParser = new cordova.cordova_lib.configparser(configXmlPath);
            var pluginEntry: Cordova.ICordovaPlatformPuginInfo = configParser.getPlugin(pluginId);
            var versionSpec: string = pluginEntry ? pluginEntry.spec : "";
            return Q.resolve(versionSpec);
        });
    }

    /**
     * Static method to add the plugin specification to config.xml file
     *
     * @param {ICordovaPlatformPuginInfo} The plugin info
     * @param {string} The path to config.xml of the project
     * @param {string} The cordova CLI version
     *
     * @return {Q.Promise<string>} An empty promise
     */
    public static addPluginVersionSpec(info: Cordova.ICordovaPlatformPuginInfo, configXmlPath: string, cordovaCliVersion: string): Q.Promise<any> {
        return packageLoader.lazyRequire(CordovaWrapper.CordovaNpmPackageName, CordovaWrapper.CordovaNpmPackageName + "@" + cordovaCliVersion)
            .then(function (cordova: typeof Cordova): Q.Promise<any> {
            var configParser: ConfigParser = new cordova.cordova_lib.configparser(configXmlPath);
            var pluginEntry: Cordova.ICordovaPlatformPuginInfo = configParser.getPlugin(info.name);
            if (pluginEntry) {
                configParser.removePlugin(info.name);
            }

            configParser.addPlugin({ name: info.name, spec: info.spec }, info.pluginVariables);
            configParser.write();
            return Q.resolve({});
        });
    }

    /**
     * Static method to remove the plugin specification from the config.xml file
     *
     * @param {ICordovaPlatformPuginInfo} The plugin info
     * @param {string} The path to config.xml of the project
     * @param {string} The cordova CLI version
     *
     * @return {Q.Promise<string>} An empty promise
     */
    public static removePluginVersionSpec(pluginId: string, configXmlPath: string, cordovaCliVersion: string): Q.Promise<any> {
        return packageLoader.lazyRequire(CordovaWrapper.CordovaNpmPackageName, CordovaWrapper.CordovaNpmPackageName + "@" + cordovaCliVersion)
            .then(function (cordova: typeof Cordova): Q.Promise<any> {
            var configParser: ConfigParser = new cordova.cordova_lib.configparser(configXmlPath);
            configParser.removePlugin(pluginId);
            configParser.write();
            return Q.resolve({});
        });
    }

    /**
     * Static method to get the engine specification from the config.xml file
     *
     * @param {string} The platform name
     * @param {string} The path to config.xml of the project
     * @param {string} The cordova CLI version
     *
     * @return {Q.Promise<string>} A promise with the version specification as a string
     */
    public static getEngineVersionSpec(platform: string, configXmlPath: string, cordovaCliVersion: string): Q.Promise<string> {
        return packageLoader.lazyRequire(CordovaWrapper.CordovaNpmPackageName, CordovaWrapper.CordovaNpmPackageName + "@" + cordovaCliVersion)
            .then(function (cordova: typeof Cordova): Q.Promise<any> {
            var configParser: ConfigParser = new cordova.cordova_lib.configparser(configXmlPath);
            var engineSpec: string = "";
            var engines: Cordova.ICordovaPlatformPuginInfo[] = configParser.getEngines();
            engines.forEach(function (engineInfo: Cordova.ICordovaPlatformPuginInfo): void {
                if (engineInfo.name.toLowerCase() === platform.toLowerCase()) {
                    engineSpec = engineInfo.spec;
                }
            });
            return Q.resolve(engineSpec);
        });
    }

    /**
     * Static method to add the platform specification to config.xml file
     *
     * @param {string} The platform name
     * @param {string} The version specification for the platform
     * @param {string} The path to config.xml of the project
     * @param {string} The cordova CLI version
     *
     * @return {Q.Promise<string>} An empty promise
     */
    public static addEngineVersionSpec(platform: string, spec: string, configXmlPath: string, cordovaCliVersion: string): Q.Promise<any> {
        return packageLoader.lazyRequire(CordovaWrapper.CordovaNpmPackageName, CordovaWrapper.CordovaNpmPackageName + "@" + cordovaCliVersion)
            .then(function (cordova: typeof Cordova): Q.Promise<any> {
            var configParser: ConfigParser = new cordova.cordova_lib.configparser(configXmlPath);
            configParser.removeEngine(platform);
            configParser.addEngine(platform, spec);
            configParser.write();
            return Q.resolve({});
        });
    }

    /**
     * Static method to remove the platform specification from config.xml file
     *
     * @param {string} The platform name
     * @param {string} The path to config.xml of the project
     * @param {string} The cordova CLI version
     *
     * @return {Q.Promise<string>} An empty promise
     */
    public static removeEngineVersionSpec(platform: string, configXmlPath: string, cordovaCliVersion: string): Q.Promise<any> {
        return packageLoader.lazyRequire(CordovaWrapper.CordovaNpmPackageName, CordovaWrapper.CordovaNpmPackageName + "@" + cordovaCliVersion)
            .then(function (cordova: typeof Cordova): Q.Promise<any> {
            var configParser: ConfigParser = new cordova.cordova_lib.configparser(configXmlPath);
            configParser.removeEngine(platform);
            configParser.write();
            return Q.resolve({});
        });
    }

    /**
     * Static method to invoke a cordova command. Used to invoke the 'platform' or 'plugin' command
     *
     * @param {string} The name of the cordova command to be invoked
     * @param {string} The version of the cordova CLI to use
     * @param {ICordovaCommandParameters} The cordova command parameters
     *
     * @return {Q.Promise<any>} An empty promise
     */
    public static invokeCommand(command: string, cordovaCliVersion: string, platformCmdParameters: Cordova.ICordovaCommandParameters): Q.Promise<any> {
        return packageLoader.lazyRequire(CordovaWrapper.CordovaNpmPackageName, CordovaWrapper.CordovaNpmPackageName + "@" + cordovaCliVersion)
            .then(function (cordova: typeof Cordova): Q.Promise<any> {
            if (command === "platform") {
                return cordova.raw.platform(platformCmdParameters.subCommand, platformCmdParameters.targets, platformCmdParameters.downloadOptions);
            } else if (command === "plugin") {
                return cordova.raw.plugin(platformCmdParameters.subCommand, platformCmdParameters.targets, platformCmdParameters.downloadOptions);
            } else {
                return Q.reject(errorHelper.get(TacoErrorCodes.CordovaCmdNotFound));
            }
        });
    }
}

export = CordovaWrapper;
