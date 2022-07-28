import path from 'path'
import { Matcher, MatcherType } from './Matcher'

export class CommandBuilder {
    // TODO improve using in-memory bytecode
    // `./eradicate2 -A ${ deployerAddress } --init-code '${ await this._getBytecode(name, constructorArguments) }' --matching ${ this.matcher.get(MatcherType.COMMAND) }`
    public static eradicate(
        deployer: string,
        bytecodeFilePath: string,
        matcher: Matcher,
    ) {
        const executable = this._getExecutable('eradicate2')
        const matchingString = matcher.get(MatcherType.COMMAND)

        return `./"${ executable }" -A ${ deployer } -i ${ bytecodeFilePath } --matching ${ matchingString }`
    }

    public static profanity(matcher: Matcher) {
        const executable = this._getExecutable('profanity')
        const matchingString = matcher.get(MatcherType.COMMAND)

        return `./"${ executable }" --contract --matching ${ matchingString }`
    }

    private static _getExecutable(name: string) {
        return path.join(__dirname, '../executables', name)
    }
}
