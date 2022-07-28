import { promises as fs } from 'fs'

export enum StorageType {
    SECRET = 'storage/secrets.json',
    ADDRESS = 'storage/addresses.json',
}

const NO_SUCH_FILE = 'no such file or directory'

class Storage {
    async all({ type }) {
        let contents

        try {
            await (await fs.opendir('storage')).close()
        } catch (e) {
            const error = e as Error

            if (error.message.includes(NO_SUCH_FILE))
                await fs.mkdir('storage')
        }

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
        const all = await this.all({ type })

        all[name] = value.toLowerCase()

        await this.saveAll({ type, data: all })
    }
}

export const storage = new Storage()
