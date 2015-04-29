
declare module TacoUtility {
    class ResourceManager {

        public static LocalesSessionKey: string;
        constructor(resourcesDirectory: string);

        /** ...optionalArgs is only there for typings, function rest params */
        public getString(id: string, ...optionalArgs: any[]): string;
    }
}
