﻿/**
﻿ * ******************************************************
﻿ *                                                       *
﻿ *   Copyright (C) Microsoft. All rights reserved.       *
﻿ *                                                       *
﻿ *******************************************************
﻿ */
/// <reference path="../../typings/node.d.ts" />
/// <reference path="../../typings/Q.d.ts" />
/// <reference path="../../typings/nconf.d.ts" />
/// <reference path="../../typings/tacoUtils.d.ts" />
/// <reference path="../../typings/express.d.ts" />
/// <reference path="../../typings/expressExtensions.d.ts" />
/// <reference path="../../typings/tacoRemoteLib.d.ts" />
/// <reference path="../../typings/remotebuild.d.ts" />
/// <reference path="../../typings/serve-index.d.ts" />

"use strict";

import express = require ("express");
import fs = require ("fs");
import os = require ("os");
import path = require ("path");
import Q = require ("q");
import serveIndex = require ("serve-index");
import util = require ("util");

import BuildManager = require ("./buildManager");
import HostSpecifics = require ("./hostSpecifics");
import resources = require("../resources/resourceManager");
import selftest = require ("./selftest");
import TacoRemoteConfig = require ("./tacoRemoteConfig");
import utils = require("taco-utils");

interface RequestHandler {
    (req: express.Request, res: express.Response): void;
}

class ServerModuleFactory implements RemoteBuild.IServerModuleFactory {
    public create(conf: RemoteBuild.IRemoteBuildConfiguration, modConfig: RemoteBuild.IServerModuleConfiguration, serverCapabilities: RemoteBuild.IServerCapabilities): Q.Promise<RemoteBuild.IServerModule> {
        var tacoRemoteConf = new TacoRemoteConfig(conf, modConfig);
        return HostSpecifics.hostSpecifics.initialize(tacoRemoteConf).then(function (): RemoteBuild.IServerModule {
            return new Server(tacoRemoteConf, modConfig.mountPath);
        });
    }

    public test(conf: RemoteBuild.IRemoteBuildConfiguration, modConfig: RemoteBuild.IServerModuleConfiguration, serverTestCapabilities: RemoteBuild.IServerTestCapabilities): Q.Promise<any>
    {
        var host = util.format("http%s://%s:%d", utils.UtilHelper.argToBool(conf.secure) ? "s" : "", conf.hostname || os.hostname, conf.port);
        var downloadDir = path.join(conf.serverDir, "selftest", "taco-remote");
        utils.UtilHelper.createDirectoryIfNecessary(downloadDir);
        return selftest.test(host, modConfig.mountPath, downloadDir, /* deviceBuild */ false, serverTestCapabilities.agent).then(function (): Q.Promise<any> {
            return selftest.test(host, modConfig.mountPath, downloadDir, /* deviceBuild */ true, serverTestCapabilities.agent);
        });
    }
}

var serverModuleFactory = new ServerModuleFactory();
export = serverModuleFactory;

class Server implements RemoteBuild.IServerModule {
    private serverConf: TacoRemoteConfig;
    private modPath: string;
    private buildManager: BuildManager;

    constructor(conf: TacoRemoteConfig, modPath: string) {
        this.serverConf = conf;
        this.modPath = modPath;

        // Initialize the build manager (after our app settings are all setup)
        this.buildManager = new BuildManager(conf);
    }

    public getRouter(): express.Router {
        var router = express.Router();
        router.post("/build/tasks", this.submitNewBuild.bind(this));
        router.get("/build/tasks/:id", this.getBuildStatus.bind(this));
        router.get("/build/tasks/:id/log", this.getBuildLog.bind(this));
        router.get("/build/tasks", this.getAllBuildStatus.bind(this));
        router.get("/build/:id", this.getBuildStatus.bind(this));
        router.get("/build/:id/download", this.downloadBuild.bind(this));

        router.get("/build/:id/emulate", this.emulateBuild.bind(this));
        router.get("/build/:id/deploy", this.deployBuild.bind(this));
        router.get("/build/:id/run", this.runBuild.bind(this));
        router.get("/build/:id/debug", this.debugBuild.bind(this));

        router.use("/files", serveIndex(this.buildManager.getBaseBuildDir()));
        router.use("/files", express.static(this.buildManager.getBaseBuildDir()));

        return router;
    }

    public shutdown(): void {
        this.buildManager.shutdown();
    }

    // Submits a new build task
    private submitNewBuild(req: express.Request, res: express.Response): void {
        var self = this;
        Server.RunInSession(req, function (): void {
            var port = self.serverConf.port;
            var modPath = self.modPath;
            self.buildManager.submitNewBuild(req).then(function (buildInfo: utils.BuildInfo): void {
                var contentLocation = util.format("%s://%s:%d/%s/build/tasks/%d", req.protocol, req.host, port, modPath, buildInfo.buildNumber);
                res.set({
                    "Content-Type": "application/json",
                    "Content-Location": contentLocation
                });
                res.status(202).json(buildInfo.localize(resources));
            }, function (err: any): void {
                    res.set({ "Content-Type": "application/json" });
                    res.status(err.code || 400).send({ status: resources.getString("InvalidBuildRequest"), errors: err });
                }).done();
        });
    }

    // Queries on the status of a build task, used by a client to poll
    private getBuildStatus(req: express.Request, res: express.Response): void {
        var self = this;
        Server.RunInSession(req, function (): void {
            var buildInfo = self.buildManager.getBuildInfo(req.params.id);
            if (buildInfo) {
                buildInfo.localize(resources);
                if (!buildInfo.message) {
                    // We can't localize this in this package, we need to get whichever package serviced the request to localize the request
                    buildInfo.localize(resources);
                }

                res.status(200).json(buildInfo);
            } else {
                res.status(404).send(resources.getString("BuildNotFound", req.params.id));
            }
        });
    }

    // Retrieves log file for a build task, can be used by a client when build failed
    private getBuildLog(req: express.Request, res: express.Response): void {
        var self = this;
        Server.RunInSession(req, function (): void {
            var buildInfo = self.buildManager.getBuildInfo(req.params.id);
            if (buildInfo) {
                res.set("Content-Type", "text/plain");
                self.buildManager.downloadBuildLog(req.params.id, req.query.offset | 0, res);
            } else {
                res.status(404).send(resources.getString("BuildNotFound", req.params.id));
            }
        });
    }

    // Queries on the status of all build tasks
    private getAllBuildStatus(req: express.Request, res: express.Response): void {
        var self = this;
        Server.RunInSession(req, function (): void {
            var allBuildInfo = self.buildManager.getAllBuildInfo();
            res.json(200, allBuildInfo);
        });
    }

    private downloadBuild(req: express.Request, res: express.Response): void {
        var self = this;
        Server.RunInSession(req, function (): void {
            var completedBuildInfo: utils.BuildInfo = self.getCompletedBuildInfo(req, res);
            if (completedBuildInfo != null) {
                self.buildManager.downloadBuild(completedBuildInfo, req, res);
            }
        });
    }

    private emulateBuild(req: express.Request, res: express.Response): void {
        var self = this;
        Server.RunInSession(req, function (): void {
            var completedBuildInfo: utils.BuildInfo = self.getCompletedBuildInfo(req, res);
            if (completedBuildInfo != null) {
                self.buildManager.emulateBuild(completedBuildInfo, req, res);
            }
        });
    }

    private deployBuild(req: express.Request, res: express.Response): void {
        var self = this;
        Server.RunInSession(req, function (): void {
            var completedBuildInfo: utils.BuildInfo = self.getCompletedBuildInfo(req, res);
            if (completedBuildInfo != null) {
                self.buildManager.deployBuild(completedBuildInfo, req, res);
            }
        });
    }

    private runBuild(req: express.Request, res: express.Response): void {
        var self = this;
        Server.RunInSession(req, function (): void {
            var completedBuildInfo: utils.BuildInfo = self.getCompletedBuildInfo(req, res);
            if (completedBuildInfo != null) {
                self.buildManager.runBuild(completedBuildInfo, req, res);
            }
        });
    }

    private debugBuild(req: express.Request, res: express.Response): void {
        var self = this;
        Server.RunInSession(req, function (): void {
            var completedBuildInfo: utils.BuildInfo = self.getCompletedBuildInfo(req, res);
            if (completedBuildInfo != null) {
                self.buildManager.debugBuild(completedBuildInfo, req, res);
            }
        });
    }


    private getCompletedBuildInfo(req: express.Request, res: express.Response): utils.BuildInfo {
        var buildInfo = this.buildManager.getBuildInfo(req.params.id);
        if (!buildInfo) {
            res.status(404).send(resources.getString("BuildNotFound", req.params.id));
            return null;
        }

        if (!buildInfo.buildSuccessful) {
            res.status(404).send(resources.getString("BuildNotCompleted", buildInfo.status));
            return null;
        }

        return buildInfo;
    }

    private static RunInSession(req: express.Request, func: RequestHandler): void {
        var localesKey: string = utils.ResourceManager.LocalesKey;
        var sessionVar: any = {};
        sessionVar[localesKey] = Server.GetAcceptLanguages(req);
        utils.ClsSessionManager.RunInTacoSession(sessionVar, func);
    }

    private static GetAcceptLanguages(req: express.Request): string[] {
        if (req.headers) {
            var acceptLanguages = req.headers["accept-language"] || "";
            if (acceptLanguages !== "") {
                return acceptLanguages.split(",")
                    .map(function (l: string): string {
                        return l.split(";")[0];
                    }).filter(function (l: string): boolean {
                        return l !== "";
                });
            }
        }
        return null;
    }
}
