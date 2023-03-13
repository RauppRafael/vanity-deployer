import { promises as fs } from 'fs'

const NO_SUCH_FILE = 'no such file or directory'
const STORAGE = '.vanity'

export enum StorageType {
    SECRET = 'secrets.json',
    ADDRESS = 'addresses.json',
    BYTECODE = 'bytecode',
}

export class Storage {
    public static async all({ type }: { type: StorageType }) {
        let contents

        await this._openDirectory(STORAGE)
        const path = `${ STORAGE }/${ type }`

        try {
            contents = await fs.readFile(path)
        }
        catch (e) {
            const error = e as Error

            if (error.message.includes(NO_SUCH_FILE))
                await fs.writeFile(path, JSON.stringify({}, null, 4))

            contents = await fs.readFile(path)
        }

        return JSON.parse(contents.toString())
    }

    public static async find({
        type,
        name,
    }: { type: StorageType, name: string }): Promise<string | undefined> {
        return (await this.all({ type }))?.[name]
    }

    public static async findAddress(name: string): Promise<string | undefined> {
        return this.find({ type: StorageType.ADDRESS, name })
    }

    public static async saveAll({ type, data }: { type: StorageType, data: string[] }) {
        return await fs.writeFile(
            `${ STORAGE }/${ type }`,
            JSON.stringify(data, null, 4),
        )
    }

    public static async save({
        type,
        name,
        value,
    }: { type: StorageType, name: string, value: string }) {
        if (type === StorageType.BYTECODE) {
            await this._openDirectory(STORAGE)
            await this._openDirectory(`${ STORAGE }/${ StorageType.BYTECODE }`)

            const fileName = `${ STORAGE }/${ type }/${ name }`

            await fs.writeFile(fileName, value)

            return fileName
        }

        const all = await this.all({ type })

        all[name] = value.toLowerCase()

        await this.saveAll({ type, data: all })
    }

    private static async _openDirectory(path: string) {
        try {
            await (await fs.opendir(path)).close()
        }
        catch (e) {
            const error = e as Error

            if (error.message.includes(NO_SUCH_FILE))
                await fs.mkdir(path)
        }
    }
}
