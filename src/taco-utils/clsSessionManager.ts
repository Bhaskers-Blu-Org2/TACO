/// <reference path="../typings/continuation-local-storage.d.ts" />
/// <reference path="../typings/node.d.ts" />

import cls = require ("continuation-local-storage");
import tacoUtility = require ("./utilHelper");
import UtilHelper = tacoUtility.UtilHelper;

module TacoUtility {
    export class ClsSessionManager {
        private static TacoSessionName: string = "taco session";

        public static runInTacoSession(sessionVariables: { [key: string]: any; }, func: Function): void {
            var session: cls.Session = cls.createNamespace(ClsSessionManager.TacoSessionName);
            session.run(function (): void {
                if (sessionVariables) {
                    Object.keys(sessionVariables).forEach(function (key: string): void {
                        session.set(key, sessionVariables[key]);
                    });
                }

                func.call(this);
            });
        }

        public static getCurrentTacoSessionVariable(key: string): any {
            var session: cls.Session = cls.getNamespace(ClsSessionManager.TacoSessionName);
            if (!session) {
                return null;
            }

            return session.get(key);
        }
    }
}

export = TacoUtility;