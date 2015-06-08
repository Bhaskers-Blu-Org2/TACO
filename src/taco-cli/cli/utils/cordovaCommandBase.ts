﻿/**
﻿ *******************************************************
﻿ *                                                     *
﻿ *   Copyright (C) Microsoft. All rights reserved.     *
﻿ *                                                     *
﻿ *******************************************************
﻿ */

/// <reference path="../../../typings/node.d.ts" />
/// <reference path="../../../typings/Q.d.ts" />
/// <reference path="../../../typings/tacoKits.d.ts" />

"use strict";

import path = require ("path");
import Q = require ("q");
import semver = require ("semver");
import util = require ("util");

import cordovaHelper = require ("./cordovaHelper");
import cordovaWrapper = require ("./cordovaWrapper");
import projectHelper = require ("./projectHelper");
import resources = require ("../../resources/resourceManager");
import TacoErrorCodes = require ("../tacoErrorCodes");
import errorHelper = require ("../tacoErrorHelper");
import tacoKits = require ("taco-kits");
import tacoUtility = require ("taco-utils");

import commands = tacoUtility.Commands;
import kitHelper = tacoKits.KitHelper;
import logger = tacoUtility.Logger;
import packageLoader = tacoUtility.TacoPackageLoader;
import tacoProjectHelper = projectHelper.TacoProjectHelper;
import utils = tacoUtility.UtilHelper;

/*
* CordovaCommandBase
*
* Base handler for platform and plugin commands
*/
export class CordovaCommandBase implements commands.IDocumentedCommand {
    private static KnownOptions: Nopt.CommandData = {
        searchpath: String,
        noregistry: String,
        usegit: String,
        variable: Array,
        browserify: Boolean,
        link: Boolean,
        save: Boolean,
        shrinkwrap: Boolean
    };

    private static ShortHands: Nopt.ShortFlags = {
        rm: "remove",
        ls: "list"
    };
    public name: string;
    
    public cordovaCommandParams: cordovaHelper.ICordovaCommandParameters;
    public downloadOptions: cordovaHelper.ICordovaDownloadOptions;
    public info: commands.ICommandInfo;

    /**
     * Abstract method to be implemented by the derived class.
     * Derived classes should override this method for custom override check functionality
     */
    public checkForKitOverrides(kitId: string): Q.Promise<any> {
        throw errorHelper.get(TacoErrorCodes.UnimplementedAbstractMethod);
    }

    /**
     * Checks the component (platform/plugin) specification to determine if the user has attempted an override.
     * Overrides can be packageSpec@<version> / packageSpec@<git-url> / packageSpec@<filepath>
     * Do not check for overrides from kit metadata if user explicitly overrides the package on command-line
     */
    public shouldCheckForOverride(platformSpec: string): boolean {
        var packageVersion: string = platformSpec.indexOf("@") !== 0 ? platformSpec.split("@")[1] : null;
        return !(packageLoader.GitUriRegex.test(platformSpec) || packageLoader.FileUriRegex.test(platformSpec) || (packageVersion && semver.valid(packageVersion)));
    }
   
    /**
     * specific handling for whether this command can handle the args given, otherwise falls through to Cordova CLI
     */
    public canHandleArgs(data: commands.ICommandData): boolean {
        return true;
    }

    public run(data: commands.ICommandData): Q.Promise<any> {
        try {
            this.parseArguments(data);
        } catch (err) {
            return Q.reject(err);
        }

        var self = this;
        var projectInfo: projectHelper.IProjectInfo;
        return tacoProjectHelper.getProjectInfo().then(function (info: projectHelper.IProjectInfo): void {
            projectInfo = info;
        })
            .then(function (): Q.Promise<any> {
            if (!projectInfo.isTacoProject) {
                return Q({});
            }
        })
            .then(function (): Q.Promise<any> {
            var kitId: string = projectInfo.tacoKitId;
            if (kitId) {
                return self.checkForKitOverrides(kitId);
            }
        })
            .then(function (): Q.Promise<any> {
            return cordovaWrapper.InvokeCommand(self.name, projectInfo.cordovaCliVersion, self.cordovaCommandParams);
        });
    }

    /**
     * Parse the arguments and construct the command parameters.
     */
    private parseArguments(args: commands.ICommandData): void {
        console.log("args.original : " + args.original + "\n");
        var commandData: commands.ICommandData = tacoUtility.ArgsHelper.parseArguments(CordovaCommandBase.KnownOptions, CordovaCommandBase.ShortHands, args.original, 0);
        var subCommand: string = commandData.remain[0];
        var remain: string = commandData.remain.slice(1).join();
        var targets: string[] = remain.trim().split(",");
        this.downloadOptions = {
            searchpath: commandData.options["searchpath"],
            noregistry: commandData.options["noregistry"],
            usegit: commandData.options["usegit"],
            cli_variables: {},
            browserify: commandData.options["browserify"],
            link: commandData.options["link"],
            save: commandData.options["save"],
            shrinkwrap: commandData.options["shrinkwrap"]
        };

        var variables: Array<string> = commandData.options["variable"];
        if (variables) {
            var self = this;
            variables.forEach(function (s) {
                var keyval = s.split("=");
                var key = keyval[0].toUpperCase();
                self.downloadOptions.cli_variables[key] = keyval[1];
            });
        }

        this.cordovaCommandParams = {
            subCommand: commandData.remain[0],
            targets: targets,
            downloadOptions: this.downloadOptions
        };
    }

    /**
     * Prints the project creation status message
     */
    private printStatusMessage(platformName: string, version: string): Q.Promise<any> {
        var deferred: Q.Deferred<any> = Q.defer<any>();
        return deferred.promise;
    }
}
