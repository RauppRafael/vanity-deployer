import dayjs, { Dayjs } from 'dayjs'
import path from 'path'
import { Matcher, MatcherType } from './Matcher'
import { exec } from 'child_process'
import kill from 'tree-kill'
import { sleep } from './helpers/sleep'

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

    private static async run(command: string, matcher: Matcher): Promise<string> {
        const addressMatcher = matcher.get(MatcherType.ADDRESS)
        const secretMatcher = matcher.get(MatcherType.SECRET)
        const initialTimestamp = dayjs()
        const child = await exec(command)

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

            child.stderr?.on('data', data => {
                console.error('error:', data)
            })

            child.on('error', err => {
                console.error('error:', err)

                reject(err)
            })

            child.on('exit', code => {
                console.log(`Process exited with code ${ code }`)
                // if (code !== 0)
                //     reject(new Error(`Process exited with code ${ code }`))
            })
        })

        console.log(`Found: ${ result.result }`)
        console.log(`Duration: ${ result.matchTimestamp.diff(initialTimestamp, 's', true).toFixed(3) || '-' }s`)

        child.removeAllListeners()

        return result.result
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
