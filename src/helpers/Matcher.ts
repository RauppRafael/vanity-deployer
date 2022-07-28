export enum MatcherType {
    SECRET,
    ADDRESS,
    COMMAND
}

export class Matcher {
    private readonly matchers: { [type in MatcherType]: RegExp | string }

    constructor(startsWith, endsWith) {
        this.matchers = {
            [MatcherType.SECRET]: new RegExp(/0x(\d|\w){64}/),
            [MatcherType.ADDRESS]: new RegExp(`0x${ startsWith }(\\d|\\w){${ 40 - startsWith.length - endsWith.length }}${ endsWith }`),
            [MatcherType.COMMAND]: `${ startsWith.padEnd(40 - endsWith.length, 'X') }${ endsWith }`,
        }
    }

    get(type: MatcherType) {
        return this.matchers[type]
    }
}
