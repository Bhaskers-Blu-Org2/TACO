﻿/// <reference path="../../cli/utils/settings.ts" />

import Settings = require ("../../cli/utils/settings");

module SetupMock {
    export function makeCliMock(onError: (err: Error) => void, onClose: () => void, desiredState: { host: string; port: number; pin: string }, onQuestion?: () => void): {
            question: (question: string, callback: (answer: string) => void) => void;
            close: () => void
        } {
        return {
            question: function (question: string, callback: (answer: string) => void): void {
                switch (question) {
                    case "command.setup.remote.query.host":
                        callback(desiredState.host);
                        break;
                    case "command.setup.remote.query.port":
                        callback(desiredState.port.toString());
                        break;
                    case "command.setup.remote.query.pin":
                        callback(desiredState.pin);
                        break;
                    default:
                        onError(new Error("Unexpected query!"));
                }

                if (onQuestion) {
                    onQuestion();
                }
            },
            close: onClose
        };
    }

    export function saveConfig(platform: string, config: Settings.IRemoteConnectionInfo): Q.Promise<any> {
        return Settings.loadSettings(true).catch(function (): Settings.ISettings {
            return { remotePlatforms: {} };
        }).then(function (settings: Settings.ISettings): Q.Promise<any> {
            settings.remotePlatforms[platform] = config;
            return Settings.saveSettings(settings);
        });
    }
}

export = SetupMock;