import { promises as fs } from 'fs'

export enum StorageType {
    SECRET = 'storage/secrets.json',
    ADDRESS = 'storage/addresses.json',
    BYTECODE = 'storage/bytecode',
}

const NO_SUCH_FILE = 'no such file or directory'

class Storage {
    async all({ type }) {
        let contents

        await this._openDirectory('storage')

        try {
            contents = await fs.readFile(type)
        } catch (e) {
            const error = e as Error

            if (error.message.includes(NO_SUCH_FILE))
                await fs.writeFile(type, JSON.stringify({}, null, 4))

            contents = await fs.readFile(type)
        }

        return JSON.parse(contents.toString())
    }

    async find({ type, name }: { type: StorageType, name: string }): Promise<string | undefined> {
        return (await this.all({ type }))?.[name]
    }

    async saveAll({ type, data }: { type: StorageType, data: string[] }) {
        return await fs.writeFile(
            type,
            JSON.stringify(data, null, 4),
        )
    }

    async save({ type, name, value }: { type: StorageType, name: string, value: string }) {
        if (type === StorageType.BYTECODE) {
            await this._openDirectory('storage')
            await this._openDirectory('storage/bytecode')

            const fileName = `${ type }/${ name }`

            await fs.writeFile(fileName, value)

            return fileName
        }

        const all = await this.all({ type })

        all[name] = value.toLowerCase()

        await this.saveAll({ type, data: all })
    }

    private async _openDirectory(path: string) {
        try {
            await (await fs.opendir(path)).close()
        } catch (e) {
            const error = e as Error

            if (error.message.includes(NO_SUCH_FILE))
                await fs.mkdir(path)
        }
    }
}

export const storage = new Storage()
