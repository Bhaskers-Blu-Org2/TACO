﻿/**
﻿ *******************************************************
﻿ *                                                     *
﻿ *   Copyright (C) Microsoft. All rights reserved.     *
﻿ *                                                     *
﻿ *******************************************************
﻿ */

/// <reference path="../../../typings/adm-zip.d.ts"/>
/// <reference path="../../../typings/replace.d.ts" />
/// <reference path="../../../typings/resourceManager.d.ts"/>
/// <reference path="../../../typings/tacoUtils.d.ts"/>
/// <reference path="../../../typings/tacoKits.d.ts"/>
/// <reference path="../../../typings/wrench.d.ts" />

"use strict";

import AdmZip = require ("adm-zip");
import childProcess = require ("child_process");
import crypto = require ("crypto");
import fs = require ("fs");
import os = require ("os");
import path = require ("path");
import Q = require ("q");
import replace = require ("replace");
import rimraf = require ("rimraf");
import util = require ("util");
import wrench = require ("wrench");

import cordovaHelper = require ("./cordovaHelper");
import cordovaWrapper = require ("./cordovaWrapper");
import resources = require ("../../resources/resourceManager");
import TacoErrorCodes = require ("../tacoErrorCodes");
import errorHelper = require ("../tacoErrorHelper");
import tacoUtility = require ("taco-utils");

import logger = tacoUtility.Logger;
import loggerHelper = tacoUtility.LoggerHelper;
import utils = tacoUtility.UtilHelper;

module TemplateManager {
    export interface ITemplateDescriptor {
        id: string;
        name: string;
    }

    export interface ITemplateList {
        kitId: string;
        templates: ITemplateDescriptor[];
    }
}

class TemplateDescriptor implements TemplateManager.ITemplateDescriptor {
    public id: string;
    public name: string;

    constructor(templateOverrideInfo: TacoKits.ITemplateOverrideInfo) {
        this.id = templateOverrideInfo.templateId;
        this.name = templateOverrideInfo.templateInfo.name;
    }

    public getDescription(): string {
        return resources.getString(this.name);
    }
}

class TemplateManager {
    private static DEFAULT_TEMPLATE_ID: string = "blank";
    private static GIT_FILE_LIST: string[] = [
        ".git",
        ".gitignore",
        ".gitattributes"
    ];
    private static TEMPORARY_TEMPLATE_PREFIX: string = "taco_template_";

    private kitHelper: TacoKits.IKitHelper = null;
    private templateName: string = null;

    constructor(kits: TacoKits.IKitHelper) {
        this.kitHelper = kits;
    }

    private static performTokenReplacements(projectPath: string, appId: string, appName: string): Q.Promise<any> {
        var replaceParams: Replace.IReplaceParameters = {
            regex: "",
            replacement: "",
            paths: [path.resolve(projectPath)],
            recursive: true,
            silent: true
        };

        var tokens: { [token: string]: string } = {
            "\\$appid\\$": appId,
            "\\$projectname\\$": appName
        };

        Object.keys(tokens).forEach(function (token: string): void {
            replaceParams.regex = token;
            replaceParams.replacement = tokens[token];
            replace(replaceParams);
        });

        return Q.resolve(null);
    }

    private static cleanTemporaryTemplateFolder(folderToDelete: string): Q.Promise<any> {
        // Detect whether we need to clean just this folder (git template) or the parent folder (taco kits template)
        // For that, we look for the taco template prefix; if we don't find it, it means we need to delete the parent
        var mustDeleteParent: boolean = path.basename(folderToDelete).indexOf(TemplateManager.TEMPORARY_TEMPLATE_PREFIX) === -1;

        if (mustDeleteParent) {
            // Make sure the parent starts with the taco template prefix
            var parentFolder: string = path.dirname(folderToDelete);

            if (path.basename(parentFolder).indexOf(TemplateManager.TEMPORARY_TEMPLATE_PREFIX) === -1) {
                // Neither the requested folder nor its parent appear to be a temporary taco template; don't do anything
                return Q.resolve({});
            }

            folderToDelete = parentFolder;
        }

        // Attempt to clean the temporary template folder
        var deferred: Q.Deferred<any> = Q.defer<any>();

        rimraf(folderToDelete, function (err: Error): void {
            // This is best effort, resolve the promise whether there was an error or not
            deferred.resolve({});
        });

        return deferred.promise;
    }

    private static copyTemplateItemsToProject(cordovaParameters: Cordova.ICordovaCreateParameters): Q.Promise<any> {
        /*
        Cordova's --copy-from behavior: "cordova create [project path] --copy-from [template path]" supports 2 scenarios: 1) The template is for the entire project; 2) The template is only
        for the www assets.

        Cordova looks for a "www" folder at the root of the specified path ("the template"). If it finds one, then it assumes we are in case 1), otherwise it assumes we are in case 2).

        For case 1), Cordova looks for 4 specific items at the root of the template: "config.xml", "www\", "merges\" and "hooks\". When it finds one of those items, Cordova copies it to the
        user's project, otherwise it uses the default for that particular item. It ignores everything else in the template.

        For case 2), Cordova copies everything it finds in the template over to the "www\" folder of the user's project, and uses default items for everything else ("config.xml", "merges\",
        etc).

        What this means for TACO project creation: If we are in case 1), we need to copy the template items that Cordova ignored. For simplicity, we will simply recursively copy the entire
        template folder to the user's project, while using the "clobber = false" option of the NCP package. That way, all the items get copied over, but those that were already copied by
        Cordova are ignored. If we are in case 2), it means we don't have anything to do, because Cordova already copied all the template items to the "www\" folder of the user's project.
        */

        // If we are in case 2) (see above comment), we need to skip the copy step
        var skipCopy: boolean = !fs.readdirSync(cordovaParameters.copyFrom).some(function (itemPath: string): boolean {
            return path.basename(itemPath) === "www";
        });

        if (skipCopy) {
            return Q.resolve({});
        }

        // If we reach this point, we are in case 1) (see above comment), so we need to perform a recursive copy
        var filterFunc: (itemPath: string) => boolean = function (itemPath: string): boolean {
            // Return true if the item path is not in our list of git files to ignore
            return TemplateManager.GIT_FILE_LIST.indexOf(path.basename(itemPath)) === -1;
        };

        var options: tacoUtility.ICopyOptions = { clobber: false, filter: filterFunc };

        return utils.copyRecursive(cordovaParameters.copyFrom, cordovaParameters.projectPath, options);
    }

    private static cordovaCreate(templatePath: string, cliVersion: string, cordovaParameters: Cordova.ICordovaCreateParameters): Q.Promise<any> {
        cordovaParameters.copyFrom = templatePath;

        return cordovaWrapper.create(cliVersion, cordovaParameters);
    }

    private static createUnusedFolderPath(parentDir: string): string {
        var dirPath: string = path.join(parentDir, TemplateManager.TEMPORARY_TEMPLATE_PREFIX + crypto.pseudoRandomBytes(20).toString("hex"));

        while (fs.existsSync(dirPath)) {
            dirPath = path.join(parentDir, TemplateManager.TEMPORARY_TEMPLATE_PREFIX + crypto.pseudoRandomBytes(20).toString("hex"));
        }

        return dirPath;
    }

    private static gitClone(repo: string, cloneParentDir: string): Q.Promise<string> {
        var deferred: Q.Deferred<any> = Q.defer<any>();

        var destination: string = TemplateManager.createUnusedFolderPath(cloneParentDir);
        var command: string = "git";
        var args: string[] = [
            "clone",
            "--depth",  // Use the "--depth 1" option to minimize bandwidth usage, as we are only interested in the final state of the repo
            "1",
            repo,
            destination
        ];
        var options: childProcess.IExecOptions = { cwd: cloneParentDir, stdio: "inherit" }; // Set cwd for the git child process to be in the temporary dir to ensure any created log or other files get created there

        childProcess.spawn(command, args, options)
            .on("error", function (err: any): void {
                if (err.code === "ENOENT") {
                    // ENOENT error thrown if no git is found
                    deferred.reject(errorHelper.get(TacoErrorCodes.CommandCreateNoGit));
                } else {
                    deferred.reject(err);
                }
            })
            .on("exit", function (code: number): void {
                if (code) {
                    deferred.reject(errorHelper.get(TacoErrorCodes.CommandCreateGitCloneError));
                } else {
                    deferred.resolve(destination);
                }
            });

        return deferred.promise;
    }

    private static acquireFromGit(templateUrl: string, cloneParentDir: string): Q.Promise<string> {
        loggerHelper.logSeparatorLine();
        logger.log(resources.getString("CommandCreateGitTemplateHeader"));

        return TemplateManager.gitClone(templateUrl, cloneParentDir);
    }

    /**
     * Creates a kit project using 'cordova create' with the specified template.
     *
     * @param {string} The id of the desired kit
     * @param {string} The id of the desired template
     * @param {string} The version of the desired cordova CLI
     * @param {ICordovaCreateParameters} The cordova parameters for the create command
     *
     * @return {Q.Promise<string>} A Q promise that is resolved with the template's display name if there are no errors
     */
    public createKitProjectWithTemplate(kitId: string, templateId: string, cordovaCliVersion: string, cordovaParameters: Cordova.ICordovaCreateParameters): Q.Promise<string> {
        var self: TemplateManager = this;

        templateId = templateId ? templateId : TemplateManager.DEFAULT_TEMPLATE_ID;

        return this.acquireTemplate(templateId, kitId)
            .then(function (templatePath: string): Q.Promise<any> {
                return TemplateManager.cordovaCreate(templatePath, cordovaCliVersion, cordovaParameters);
            })
            .then(function (): Q.Promise<any> {
                return TemplateManager.copyTemplateItemsToProject(cordovaParameters);
            })
            .then(function (): Q.Promise<any> {
                return TemplateManager.cleanTemporaryTemplateFolder(cordovaParameters.copyFrom);
            })
            .then(function (): Q.Promise<any> {
                return TemplateManager.performTokenReplacements(cordovaParameters.projectPath, cordovaParameters.appId, cordovaParameters.appName);
            })
            .then(function (): Q.Promise<string> {
                return Q.resolve(self.templateName);
            });
    }

    /**
     * Get a list of the available templates for a kit
     *
     * @param {string} The id of the desired kit
     *
     * @return {ITemplateList} An object containing the kitId and its available templates
     */
    public getTemplatesForKit(kitId: string): Q.Promise<TemplateManager.ITemplateList> {
        return this.kitHelper.getTemplatesForKit(kitId)
            .then(function (kitOverride: TacoKits.IKitTemplatesOverrideInfo): Q.Promise<TemplateManager.ITemplateList> {
                return Q.resolve({
                    kitId: kitOverride.kitId,
                    templates: kitOverride.templates.map((t: TacoKits.ITemplateOverrideInfo) => new TemplateDescriptor(t))
            });
        });
    }

    /**
     * Get a list of all available templates
     *
     * @return {ITemplateList} An object containing the kitId and its available templates
     */
    public getAllTemplates(): Q.Promise<TemplateManager.ITemplateList> {
        return this.kitHelper.getAllTemplates()
            .then(function (results: TacoKits.ITemplateOverrideInfo[]): Q.Promise<TemplateManager.ITemplateList> {
                return Q.resolve({
                    kitId: "",
                    templates: results.map((templateInfo: TacoKits.ITemplateOverrideInfo) => new TemplateDescriptor(templateInfo))
                });
            });
    }

    /**
     * Get the number of entries in the specified template
     *
     * @param {string} kitId The id of the desired kit
     * @param {string} templateId The id of the desired template
     *
     * @return {Q.Promise<number>} A promise resolved with the number of entries in the template
     */
    public getTemplateEntriesCount(kitId: string, templateId: string): Q.Promise<number> {
        return this.kitHelper.getTemplateOverrideInfo(kitId, templateId)
            .then(function (templateOverrideInfo: TacoKits.ITemplateOverrideInfo): number {
                var templateZip: AdmZip = new AdmZip(templateOverrideInfo.templateInfo.url);

                return templateZip.getEntries().length - 1; // We substract 1, because the returned count includes the root folder of the template
            });
    }

    private acquireTemplate(templateId: string, kitId: string, tempTemplateDir: string = os.tmpdir()): Q.Promise<string> {
        if (/^https?:\/\//.test(templateId)) {
            this.templateName = resources.getString("CommandCreateGitTemplateName");

            return TemplateManager.acquireFromGit(templateId, tempTemplateDir)
                .then(function (templateLocation: string): string {
                    loggerHelper.logSeparatorLine();

                    return templateLocation;
                });
        } else {
            return this.acquireFromTacoKits(templateId, kitId, tempTemplateDir);
        }
    }

    private acquireFromTacoKits(templateId: string, kitId: string, tempTemplateDir: string): Q.Promise<string> {
        var self: TemplateManager = this;

        return this.kitHelper.getTemplateOverrideInfo(kitId, templateId)
            .then(function (templateOverrideForKit: TacoKits.ITemplateOverrideInfo): Q.Promise<string> {
                var templateInfo: TacoKits.ITemplateInfo = templateOverrideForKit.templateInfo;
                var extractDestination: string = TemplateManager.createUnusedFolderPath(tempTemplateDir);

                if (!fs.existsSync(templateInfo.url)) {
                    return Q.reject<string>(errorHelper.get(TacoErrorCodes.CommandCreateTemplatesUnavailable));
                }

                self.templateName = templateInfo.name;
                wrench.mkdirSyncRecursive(extractDestination, 511); // 511 decimal is 0777 octal

                // Extract the template archive to the temporary folder
                var templateZip: AdmZip = new AdmZip(templateInfo.url);

                templateZip.extractAllTo(extractDestination);

                // For taco-kits templates, the template items are not at the root of the archive, but under a root folder with the template ID as the name
                return Q.resolve(path.join(extractDestination, templateId));
            });
    }
}

export = TemplateManager;
