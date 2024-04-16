import dayjs, { Dayjs } from 'dayjs'
import path from 'path'
import { Matcher, MatcherType } from './Matcher'
import { exec } from 'child_process'
import kill from 'tree-kill'
import { sleep } from './helpers/sleep'
import { promises as fs } from 'fs'
import os from 'os'

export interface CommandBuilderOptions {
    skip?: string
}

export class CommandBuilder {
    private static MIN_DURATION = 3_500
    private readonly optionsString: string = ''

    public constructor(public readonly options: CommandBuilderOptions = {}) {
        if (options.skip)
            this.optionsString += `--skip ${ options.skip }`
    }

    public eradicate(
        deployer: string,
        bytecodeFilePath: string,
        matcher: Matcher,
    ) {
        const executable = CommandBuilder._getExecutable('eradicate2')
        const matchingString = matcher.get(MatcherType.COMMAND)

        return CommandBuilder.run(
            `"${ executable }" -A ${ deployer } -i ${ bytecodeFilePath } --matching ${ matchingString } ${ this.optionsString }`,
            matcher,
        )
    }

    public profanity(matcher: Matcher) {
        const executable = CommandBuilder._getExecutable('profanity')
        const matchingString = matcher.get(MatcherType.COMMAND)

        return CommandBuilder.run(
            `"${ executable }" --contract --matching ${ matchingString } ${ this.optionsString }`,
            matcher,
        )
    }

    private static async run(command: string, matcher: Matcher): Promise<string> {
        await this.initializeExecutables()

        const addressMatcher = matcher.get(MatcherType.ADDRESS)
        const secretMatcher = matcher.get(MatcherType.SECRET)
        const initialTimestamp = dayjs()
        const child = exec(command)

        const result = await new Promise<{
            result: string,
            matchTimestamp: Dayjs,
        }>((resolve, reject) => {
            const listener = child.stdout?.on('data', async event => {
                const line: string = event.toString().toLowerCase()

                if (!line.match(addressMatcher)) return

                const matchTimestamp = dayjs()

                if (initialTimestamp.add(this.MIN_DURATION, 'ms').isAfter(matchTimestamp)) {
                    const duration = this.MIN_DURATION - matchTimestamp.diff(initialTimestamp)

                    await sleep(duration)
                }

                listener?.destroy()

                if (child.pid !== undefined) kill(child.pid, 'SIGTERM')

                const result = line.match(secretMatcher)

                if (result) {
                    resolve({
                        result: result[0],
                        matchTimestamp,
                    })
                }
                else {
                    reject(new Error('Line result is null'))
                }
            })

            child.on('error', err => {
                console.error('error:', err)

                reject(err)
            })

            child.on('exit', code => {
                if (code !== 0)
                    reject(new Error(`Process exited with code ${ code }`))
            })
        })

        console.log(`Found: ${ result.result }`)
        console.log(`Duration: ${ result.matchTimestamp.diff(initialTimestamp, 's', true).toFixed(3) || '-' }s`)

        child.removeAllListeners()

        return result.result
    }

    private static _getExecutable(name: string) {
        return path.join(
            this.executablesPath,
            this.isWindows ? name : `${ name }.x64`,
        )
    }

    private static async initializeExecutables() {
        const clFiles = [
            'keccak.cl',
            'profanity.cl',
            'eradicate2.cl',
        ]
        const executableFiles = [
            'eradicate2.x64',
            'profanity.x64',
        ]

        try {
            await Promise.all(clFiles.map(
                file => fs.readFile(`./${ file }`),
            ))
        }
        catch (e) {
            await Promise.all(clFiles.map(async file => {
                const sourceFile = path.join(this.executablesPath, file)
                const destinationFile = `./${ file }`

                await fs.copyFile(sourceFile, destinationFile)
            }))
        }

        if (!this.isWindows) {
            await Promise.all(executableFiles.map(async file => {
                const sourceFile = path.join(this.executablesPath, file)

                await fs.chmod(sourceFile, 0o777)
            }))
        }
    }

    private static get executablesPath() {
        return path.join(__dirname, './executables')
    }

    private static get isWindows() {
        return os.platform() === 'win32'
    }
}
