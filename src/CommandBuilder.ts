import dayjs, { Dayjs } from 'dayjs'
import path from 'path'
import { Matcher, MatcherType } from './Matcher'
import { exec } from 'child_process'
import internal from 'stream'
import kill from 'tree-kill'
import { sleep } from './helpers/sleep'
import util from 'util'

const execPromise = util.promisify(exec)

export class CommandBuilder {
    private static MIN_DURATION = 3_500

    public static eradicate(
        deployer: string,
        bytecodeFilePath: string,
        matcher: Matcher,
    ) {
        const executable = this._getExecutable('eradicate2')
        const matchingString = matcher.get(MatcherType.COMMAND)

        return this.run(
            `"${ executable }" -A ${ deployer } -i ${ bytecodeFilePath } --matching ${ matchingString }`,
            matcher,
        )
    }

    public static profanity(matcher: Matcher) {
        const executable = this._getExecutable('profanity')
        const matchingString = matcher.get(MatcherType.COMMAND)

        return this.run(
            `"${ executable }" --contract --matching ${ matchingString }`,
            matcher,
        )
    }

    public static async getPublicKey(privateKey: string): Promise<string> {
        const cmd = 'openssl ec -inform DER -text -noout -in - 2>nul | tail -6 | head -5 | sed "s/[ :]//g" | tr -d "\\\\n"'
        const input = `302e0201010420${ privateKey }a00706052b8104000a`
        const hex = input.match(/.{2}/g)?.join('') ?? ''

        try {
            const { stdout, stderr } = await execPromise(`echo "${ hex }" | xxd -r -p | ${ cmd }`)

            if (stdout.length === 0) {
                console.error('openssl error: no output')
                console.error(`stderr: ${ stderr }`)

                return ''
            }

            if (stderr)
                console.error(`stderr: ${ stderr }`)

            return stdout.trim()
        }
        catch (error) {
            console.error(`exec error: ${ error }`)

            return ''
        }
    }

    private static async run(command: string, matcher: Matcher): Promise<string> {
        const addressMatcher = matcher.get(MatcherType.ADDRESS)
        const secretMatcher = matcher.get(MatcherType.SECRET)
        const initialTimestamp = dayjs()
        const child = await exec(command)

        let listener: internal.Readable | undefined
        let matchTimestamp: Dayjs | undefined

        const promise: Promise<string> = new Promise((resolve, reject) => {
            listener = child.stdout?.on('data', async event => {
                const line: string = event.toString().toLowerCase()

                if (!line.match(addressMatcher))
                    return

                matchTimestamp = dayjs()

                if (initialTimestamp.add(this.MIN_DURATION, 'ms').isAfter(matchTimestamp)) {
                    const duration = this.MIN_DURATION - matchTimestamp.diff(initialTimestamp)

                    await sleep(duration)
                }

                listener?.destroy()

                if (child.pid !== undefined)
                    kill(child.pid, 'SIGKILL')

                const result = line.match(secretMatcher)

                if (!result)
                    throw new Error('Line result is null')

                resolve(result[0])
            })

            child.on('exit', code => {
                reject(code)
            })
        })

        try {
            console.log(`Found: ${ await promise }`)
            console.log(`Duration: ${ matchTimestamp?.diff(initialTimestamp, 's', true).toFixed(3) || '-' }s`)

            child.removeAllListeners()

            return promise
        }
        catch (e) {
            return this.run(command, matcher)
        }
    }

    private static _getExecutable(name: string) {
        return path.join(
            __dirname,
            './executables',
            process.platform === 'linux'
                ? `${ name }.x64`
                : name,
        )
    }
}
