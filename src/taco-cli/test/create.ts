﻿/**
﻿ * ******************************************************
﻿ *                                                       *
﻿ *   Copyright (C) Microsoft. All rights reserved.       *
﻿ *                                                       *
﻿ *******************************************************
﻿ */
/// <reference path="../../typings/should.d.ts"/>
/// <reference path="../../typings/mocha.d.ts"/>
/// <reference path="../../typings/rimraf.d.ts"/>
/// <reference path="../../typings/wrench.d.ts"/>
/// <reference path="../../typings/taco-utils.d.ts"/>

"use strict";
var should_module = require("should"); // Note not import: We don't want to refer to should_module, but we need the require to occur since it modifies the prototype of Object.

import Q = require ("q");
import rimraf = require ("rimraf");
import wrench = require ("wrench");
import mocha = require ("mocha");
import path = require ("path");
import fs = require ("fs");
import os = require ("os");
import util = require ("util");
import Create = require ("../cli/create");
import tacoUtils = require ("taco-utils");
import utils = tacoUtils.UtilHelper;
import resources = tacoUtils.ResourcesManager;

interface IScenarioList {
    [scenario: number]: string;
}

describe("taco create", function (): void {
    // Project info
    var testAppId: string = "testId";
    var testAppName: string = "testAppName";
    var testTemplateId: string = "testTemplate";
    var testKitId: string = "testKit";

    // Important paths
    var runFolder: string = path.resolve(os.tmpdir(), "taco_cli_create_test_run");
    var tacoHome: string = path.join(runFolder, "taco_home");
    var templateCache: string = path.join(tacoHome, "templates");
    var copyFromPath: string = path.resolve(__dirname, "resources", "templates", "testKit", "testTemplate");
    var testTemplateKitSrc: string = path.resolve(__dirname, "resources", "templates", testKitId);
    var testTemplateSrc: string = path.join(testTemplateKitSrc, testTemplateId);

    // Commands for the different end to end scenarios to test
    var successScenarios: IScenarioList = {
        1: util.format("--kit 4.0.0-Kit --template typescript %s %s {}", testAppId, testAppName),
        2: util.format("--kit 5.0.0-Kit --template blank %s %s", testAppId, testAppName),
        3: util.format("--kit 4.2.0-Kit --template typescript %s", testAppId),
        4: "--kit 4.2.0-Kit --template blank",
        5: "--kit 5.0.0-Kit --template",
        6: "--kit 4.0.0-Kit",
        7: "--template blank",
        8: "--template",
        9: util.format("--copy-from %s", copyFromPath),
        10: "--cli 4.2.0",
        11: "--unknownParameter"
    };

    var failureScenarios: IScenarioList = {
        1: "--kit",
        2: "--template unknown",
        3: "--template typescript",
        4: "--kit 5.0.0-Kit --template typescript",
        5: util.format("--kit 5.0.0-Kit --template typescript --copy-from %s", copyFromPath),
        6: "--kit 5.0.0-Kit --cli 4.2.0",
        7: "--cli 4.2.0 --template typescript",
        8: util.format("--kit 4.0.0-Kit --template typescript %s %s {}", testAppId, testAppName),
        9: "--kit 5.0.0-Kit --copy-from unknownCopyFromPath",
        10: "--cli unknownCliVersion",
        11: "42"
    };

    function getProjectPath(scenario: number): string {
        return path.join(runFolder, "scenario" + scenario);
    }

    function makeICommandData(scenario: number, scenarioList: IScenarioList): tacoUtils.Commands.ICommandData {
        // Get the scenario's command line
        var args: string[] = scenarioList[scenario].split(" ");

        // Add the project creation path for the scenario to the front of the command line
        args.unshift(getProjectPath(scenario));

        // Build and return the ICommandData object
        return {
            options: {},
            original: args,
            remain: []
        };
    }

    function countProjectItemsRecursive(projectPath: string): number {
        if (!fs.existsSync(projectPath)) {
            throw new Error("Can't count project items; the specified path does not exist");
        }

        var files: string[] = wrench.readdirSyncRecursive(projectPath);

        return files.length;
    }

    function runScenario(scenario: number, expectedFileCount: number): Q.Promise<any> {
        var create = new Create();

        return create.run(makeICommandData(scenario, successScenarios)).then(function (): void {
            var fileCount: number = countProjectItemsRecursive(getProjectPath(scenario));

            fileCount.should.be.exactly(expectedFileCount);
        });
    }

    function runFailureScenario(scenario: number, expectedError?: string): Q.Promise<any> {
        var create = new Create();

        return create.run(makeICommandData(scenario, failureScenarios)).then(function (): Q.Promise<any> {
            throw new Error("Scenario succeeded when it shouldn't have");
        }, function (err: string): Q.Promise<any> {
            if (expectedError) {
                err.should.equal(expectedError);
            }

            return Q.resolve(null);
        });
    }

    before(function (done: MochaDone): void {
        this.timeout(30000);
        // Set ResourcesManager to test mode
        resources.UnitTest = true;

        // Set a temporary location for taco_home
        process.env["TACO_HOME"] = tacoHome;

        // Delete existing run folder if necessary
        rimraf(runFolder, function (err: Error): void {
            if (err) {
                done(err);
            } else {
                // Create the run folder for our tests
                wrench.mkdirSyncRecursive(runFolder, 511); // 511 decimal is 0777 octal
                done();
            }
        });
    });

    after(function (done: MochaDone): void {
        this.timeout(30000);
        rimraf(runFolder, function (err: Error): void {
            if (err) {
                done(err);
            } else {
                done();
            }
        });
    });

    describe("Success scenarios", function (): void {

        // Downloading packages from the internet can take a while.
        this.timeout(50000);

        it("Success scenario 1 [path, id, name, cordovaConfig, kit, template]", function (done: MochaDone): void {
            var scenario: number = 1;

            // Template that will be used: 4.0.0-Kit typescript
            // The template has 84 files and 26 folders, and Cordova will add 1 file and 3 folders, for a total of 114 entries
            runScenario(scenario, 121).then(done, done);
        });

        it("Success scenario 2 [path, id, name, kit, template]", function (done: MochaDone): void {
            var scenario: number = 2;

            // Template that will be used: 4.0.0-Kit blank
            // The template has 64 files and 22 folders, and Cordova will add 1 file and 3 folders, for a total of 90 entries
            runScenario(scenario, 96).then(done, done);
        });

        it("Success scenario 3 [path, id, kit, template]", function (done: MochaDone): void {
            var scenario: number = 3;

            // Template that will be used: default typescript
            // The template has 84 files and 26 folders, and Cordova will add 1 file and 3 folders, for a total of 114 entries
            runScenario(scenario, 121).then(done, done);
        });

        it("Success scenario 4 [path, kit, template]", function (done: MochaDone): void {
            var scenario: number = 4;

            // Template that will be used: default blank
            // The template has 64 files and 22 folders, and Cordova will add 1 file and 3 folders, for a total of 90 entries
            runScenario(scenario, 96).then(done, done);
        });

        it("Success scenario 5 [path, kit, template (no value)]", function (done: MochaDone): void {
            var scenario: number = 5;

            // Template that will be used: 5.0.0-Kit blank
            // The template has 64 files and 22 folders, and Cordova will add 1 file and 3 folders, for a total of 90 entries
            runScenario(scenario, 96).then(done, done);
        });

        it("Success scenario 6 [path, kit]", function (done: MochaDone): void {
            var scenario: number = 6;

            // Template that will be used: 4.0.0-Kit blank
            // The template has 64 files and 22 folders, and Cordova will add 1 file and 3 folders, for a total of 90 entries
            runScenario(scenario, 96).then(done, done);
        });

        it("Success scenario 7 [path, template blank]", function (done: MochaDone): void {
            var scenario: number = 7;

            // Template that will be used: 5.0.0-Kit blank
            // The template has 84 files and 26 folders, and Cordova will add 1 file and 3 folders, for a total of 114 entries
            runScenario(scenario, 96).then(done, done);
        });

        it("Success scenario 8 [path, template (no value)]", function (done: MochaDone): void {
            var scenario: number = 8;

            // Template that will be used: 4.0.0-Kit blank
            // The template has 64 files and 22 folders, and Cordova will add 1 file and 3 folders, for a total of 90 entries
            runScenario(scenario, 96).then(done, done);
        });

        it("Success scenario 9 [path, copy-from]", function (done: MochaDone): void {
            var scenario: number = 9;

            // The copy-from source has 2 files and 1 folder, and Cordova will add 2 files and 4 folders, for a total of 9 entries
            runScenario(scenario, 14).then(done, done);
        });

        it("Success scenario 10 [path, cli]", function (done: MochaDone): void {
            var scenario: number = 10;

            // The default cordova project has 6 files and 7 folders, for a total of 13 entries
            runScenario(scenario, 14).then(done, done);
        });

        it("Success scenario 11 [path, extra unknown parameter]", function (done: MochaDone): void {
            var scenario: number = 11;

            // Template that will be used: default blank
            // The template has 64 files and 22 folders, and Cordova will add 1 file and 3 folders, for a total of 90 entries
            runScenario(scenario, 96).then(done, done);
        });
    });

    describe("Failure scenarios", function (): void {
        it.skip("Failure scenario 1 [path, kit (no value)]", function (done: MochaDone): void {
            // TODO Complete this test after kit story is checked in.
            //
            // Create command should fail if --kit was specified with no value
            var scenario: number = 1;

            runFailureScenario(scenario, "ERROR_ID_HERE").then(done, done);
        });

        it("Failure scenario 2 [path, template (unknown value)]", function (done: MochaDone): void {
            // If a template is not found, create command should fail with an appropriate message
            var scenario: number = 2;

            runFailureScenario(scenario, "taco-kits.exception.InvalidTemplate").then(done, done);
        });

        it.skip("Failure scenario 3 [typescript template with a kit that doesn't have a typescript template]", function (done: MochaDone): void {
            // TODO Enable this test when the real metadata is used; the 5.0.0-Kit will exist and not define a typescript template.
            //
            // Similar to failure scenario 2 (create command should fail when a template is not found), but for typescript templates we have a specific message
            var scenario: number = 3;

            runFailureScenario(scenario, "command.create.noTypescript").then(done, done);
        });

        it.skip("Failure scenario 4 [typescript template with the default kit that doesn't have a typescript template]", function (done: MochaDone): void {
            // TODO Enable this test when the real metadata is used; the 5.0.0-Kit will exist and not define a typescript template.
            //
            // Similar to failure scenario 2 (create command should fail when a template is not found), but for typescript templates we have a specific message
            var scenario: number = 4;

            runFailureScenario(scenario, "command.create.noTypescript").then(done, done);
        });

        it("Failure scenario 5 [path, kit, template, copy-from]", function (done: MochaDone): void {
            // Create command should fail when both --template and --copy-from are specified
            var scenario: number = 5;

            runFailureScenario(scenario, "command.create.notTemplateIfCustomWww").then(done, done);
        });

        it("Failure scenario 6 [path, kit, cli]", function (done: MochaDone): void {
            // Create command should fail when both --kit and --cli are specified
            var scenario: number = 6;

            runFailureScenario(scenario, "command.create.notBothCliAndKit").then(done, done);
        });

        it("Failure scenario 7 [path, cli, template]", function (done: MochaDone): void {
            // Create command should fail when both --cli and --template are specified
            var scenario: number =7;

            runFailureScenario(scenario, "command.create.notBothTemplateAndCli").then(done, done);
        });

        it("Failure scenario 8 [path (value is an existing project)]", function (done: MochaDone): void {
            // Create command should fail when the specified path is a non-empty existing folder (Cordova error)
            var scenario: number = 8;
            var copyDest: string = getProjectPath(scenario);

            wrench.mkdirSyncRecursive(copyDest, 511); // 511 decimal is 0777 octal
            utils.copyRecursive(testTemplateSrc, copyDest).then(function (): void {
                runFailureScenario(scenario).then(done, done);
            });
        });

        it("Failure scenario 9 [copy-from (unknown path)]", function (done: MochaDone): void {
            // Create command should fail when --copy-from is specified with a path that doesn't exist (Cordova error)
            var scenario: number = 9;

            runFailureScenario(scenario).then(done, done);
        });

        it.skip("Failure scenario 10 [cli (unknown value)]", function (done: MochaDone): void {
            // TODO Enable this test when kits story is checked in and cli validation is in place
            //
            // Create command should fail when specified cli version doesn't exist
            var scenario: number = 10;

            runFailureScenario(scenario, "ERROR_ID_HERE").then(done, done);
        });

        it("Failure scenario 11 [path, appId (invalid value)]", function (done: MochaDone): void {
            // Create command should fail when an invalid app ID is specified (Cordova error)
            var scenario: number = 11;

            runFailureScenario(scenario).then(done, done);
        });
    });
});