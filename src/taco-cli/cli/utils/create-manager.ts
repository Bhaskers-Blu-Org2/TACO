﻿/// <reference path="../../../typings/wrench.d.ts" />
/// <reference path="../../../typings/replace.d.ts" />
/// <reference path="../../../typings/tar.d.ts" />

"use strict";
import Q = require ("q");
import path = require ("path");
import fs = require ("fs");
import zlib = require ("zlib");
import wrench = require ("wrench");
import tar = require ("tar");
import replace = require ("replace");
import tacoUtility = require ("taco-utils");
import logger = tacoUtility.Logger;
import resources = tacoUtility.ResourcesManager;
import utils = tacoUtility.UtilHelper;
import cordovaWrapper = require ("./cordova-wrapper");

module CreateManager {
    export class CreateManager {
        /*
         * The following members are public static to expose access to automated tests
         */
        public static TemplateCachePath: string = null;

        /*
         * Other members
         */
        private static TacoOnlyOptions: string[] = ["kit", "cli", "template"];
        private static DefaultTemplateId: string = "blank";
        private static DefaultAppName: string = "HelloTaco";
        private static DefaultAppId: string = "io.taco.myapp";

        /**
         * Creates a kit project using 'cordova create' with the specified template.
         *
         * @param {string} The id of the desired kit
         * @param {string} The id of the desired template
         * @param {string} The path where to create the project
         * @param {string} The id of the app
         * @param {string} The name of the app
         * @param {string} A JSON string whose key/value pairs will be added to the Cordova config file by Cordova
         * @param {[option: string]: any} The options to give to Cordova
         *
         * @return {Q.Promise<string>} A Q promise that is resolved with the template's display name if there are no errors
         */
        public static createKitProjectWithTemplate(kitId: string, templateId: string, path: string, appId?: string, appName?: string, cordovaConfig?: string, options?: { [option: string]: any }): Q.Promise<string> {
            var self = this;
            var templateName: string = null;
            var templateSrcPath: string = null;

            templateId = templateId ? templateId : this.DefaultTemplateId;
            appId = appId ? appId : this.DefaultAppId;
            appName = appName ? appName : this.DefaultAppName;

            return KitHelper.KitHelper.getTemplateInfo(kitId, templateId)
                .then(function (templateInfo: KitHelper.ITemplateInfo): Q.Promise<string> {
                templateName = templateInfo.displayName;

                    return self.findTemplatePath(templateInfo);
                })
                .then(function (templatePath: string): Q.Promise<any> {
                    templateSrcPath = templatePath;
                    options["copy-from"] = templateSrcPath;

                    return cordovaWrapper.create(kitId, path, appId, appName, cordovaConfig, options, self.TacoOnlyOptions);
                })
                .then(function (): Q.Promise<any> {
                    return self.copyRemainingItems(path, templateSrcPath);
                })
                .then(function (): Q.Promise<any> {
                    return self.performTokenReplacements(path, appId, appName);
                })
                .then(function (): Q.Promise<string> {
                    return Q.resolve(templateName);
                });
        }

        /**
         * Creates a kit project using 'cordova create' with the specified custom www resources.
         *
         * @param {string} The id of the desired kit
         * @param {string} The path where to create the project
         * @param {string} The id of the app
         * @param {string} The name of the app
         * @param {string} A JSON string whose key/value pairs will be added to the Cordova config file by Cordova
         * @param {[option: string]: any} The options to give to Cordova
         *
         * @return {Q.Promise<string>} An empty Q promise
         */
        public static createKitProjectWithCustomWww(kitId: string, path: string, appId?: string, appName?: string, cordovaConfig?: string, options?: { [option: string]: any }): Q.Promise<any> {
            appId = appId ? appId : this.DefaultAppId;
            appName = appName ? appName : this.DefaultAppName;

            return cordovaWrapper.create(kitId, path, appId, appName, cordovaConfig, options, this.TacoOnlyOptions);
        }

        private static findTemplatePath(templateInfo: KitHelper.ITemplateInfo): Q.Promise<string> {
            // Look through template cache to find the requested template
            if (!CreateManager.TemplateCachePath) {
                CreateManager.TemplateCachePath = path.join(utils.tacoHome, "templates");
            }

            // TODO sanitize kitId before using it as a folder name?
            var cachedTemplateKitPath: string = path.join(CreateManager.TemplateCachePath, templateInfo.kitId);
            var cachedTemplatePath: string = path.join(cachedTemplateKitPath, templateInfo.id);

            if (!fs.existsSync(cachedTemplatePath)) {
                // Download template's archive file
                // TODO
                // TEMP for now, the templates are in our git repo, so "downloading" a template simply means unzipping it from the repo location
                // to the cache.
                if (!fs.existsSync(templateInfo.archiveUrl)) {
                    return Q.reject<string>("command.create.templatesUnavailable");
                }

                // Cache does not contain the specified template, create the directory tree to cache it
                wrench.mkdirSyncRecursive(cachedTemplateKitPath, 777);

                // Extract the template archive to the cache
                fs.createReadStream(templateInfo.archiveUrl).pipe(zlib.createGunzip()).pipe(tar.Extract({ path: cachedTemplateKitPath }));
            }

            // Return path to template in cache
            return Q.resolve(cachedTemplatePath);
        }

        private static copyRemainingItems(projectPath: string, templateSrcLocation: string): Q.Promise<any> {
            var options: any = { clobber: false };

            return utils.copyRecursive(templateSrcLocation, projectPath, options);
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

            for (var token in tokens) {
                replaceParams.regex = token;
                replaceParams.replacement = tokens[token];

                replace(replaceParams);
            }

            return Q.resolve(null);
        }
    }
}

// TEMP this will be merged with the real KitHelper module
// TODO move the strings used below to wherever the KitHelper module will be (taco-utils?)
module KitHelper {
    export interface ITemplateInfo {
        id: string;
        kitId: string;
        archiveUrl: string;
        displayName: string;
    }

    interface ITemplateMetaData {
        [kitName: string]: {
            [templateName: string]: {
                name: string;
                url: string;
            };
        };
    }

    export class KitHelper {
        private static getDefaultKit(): Q.Promise<string> {
            // TEMP Return a hard-coded value for now
            return Q.resolve<string>("4.0.0-Kit");
        }

        private static getTemplateMetaData(): Q.Promise<ITemplateMetaData> {
            // TEMP return hard-coded meta-data for now
            var templateMetaData: ITemplateMetaData = {
                default: {
                    blank: {
                        name: "Blank template",
                        url: path.resolve(__dirname, "..", "..", "..", "..", "templates", "default", "blank.tar.gz")
                    },
                    typescript: {
                        name: "Blank TypeScript template",
                        url: path.resolve(__dirname, "..", "..", "..", "..", "templates", "default", "typescript.tar.gz")
                    }
                }
            };

            return Q.resolve(templateMetaData);
        }
        
        /**
         * Looks in the template metadata to collect the info on the specified template
         *
         * @param {string} The id of the desired kit
         * @param {string} The id of the desired template
         *
         * @return {Q.Promise<ITemplateCacheInfo>} A Q promise that is resolved with the ITemplateCacheInfo object as the result, or with null if no metadata was previously loaded
         */
        public static getTemplateInfo(kitId: string, templateId: string): Q.Promise<ITemplateInfo> {
            var self = this;
            var templateMetaData: ITemplateMetaData = null;

            return this.getTemplateMetaData()
                .then(function (metaData: ITemplateMetaData): Q.Promise<string> {
                    templateMetaData = metaData;

                    return kitId ? Q.resolve(kitId) : self.getDefaultKit();
                })
                .then(function (kitId: string): Q.Promise<ITemplateInfo> {
                    var templateInfoPromise: Q.Deferred<ITemplateInfo> = Q.defer<ITemplateInfo>();
                    var templateInfo: ITemplateInfo = { id: templateId, kitId: "", archiveUrl: "", displayName: ""};

                    if (templateMetaData[kitId]) {
                        // Found an override for the specified kit
                        if (templateMetaData[kitId][templateId]) {
                            // Found the specified template
                            templateInfo.kitId = kitId;
                            templateInfo.archiveUrl = templateMetaData[kitId][templateId].url;
                            templateInfo.displayName = templateMetaData[kitId][templateId].name;
                            templateInfoPromise.resolve(templateInfo);
                        } else {
                            // Error, the kit override does not define the specified template id
                            if (templateId === "typescript") {
                                // We have a special error message for typescript
                                logger.logErrorLine(resources.getString("command.create.noTypescript"));
                                templateInfoPromise.reject("command.create.noTypescript");
                            } else {
                                logger.logErrorLine(resources.getString("command.create.templateNotFound", templateId));
                                templateInfoPromise.reject("command.create.templateNotFound");
                            }
                        }
                    } else if (templateMetaData["default"][templateId]) {
                        // Found a default template matching the specified template id
                        templateInfo.kitId = "default";
                        templateInfo.archiveUrl = templateMetaData["default"][templateId].url;
                        templateInfo.displayName = templateMetaData["default"][templateId].name;
                        templateInfoPromise.resolve(templateInfo);
                    } else {
                        // Error, no template matching the specified template id
                        logger.logErrorLine(resources.getString("command.create.templateNotFound", templateId));
                        templateInfoPromise.reject("command.create.templateNotFound");
                    }

                    return templateInfoPromise.promise;
                });
        }
    }
}

export = CreateManager;