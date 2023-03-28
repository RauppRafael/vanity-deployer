import { promises as fs } from 'fs'
import { IVerify } from './Verify'

const NO_SUCH_FILE = 'no such file or directory'
const STORAGE = '.vanity'

export enum StorageType {
    SECRET = 'secrets.json',
    ADDRESS = 'addresses.json',
    VERIFY = 'verify.json',
    BYTECODE = 'bytecode',
}

type StorageData = Record<string, string | IVerify>

export class Storage {
    public static async all({ type }: { type: StorageType }): Promise<StorageData> {
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
    }: {
        type: StorageType
        name: string
    }): Promise<IVerify | string | undefined> {
        return (await this.all({ type }))?.[name]
    }

    public static async findAddress(name: string): Promise<string | undefined> {
        const address = await this.find({ type: StorageType.ADDRESS, name })

        return typeof address === 'string' ? address : undefined
    }

    public static async findSecret(name: string): Promise<string | undefined> {
        const secret = await this.find({ type: StorageType.SECRET, name })

        return typeof secret === 'string' ? secret : undefined
    }

    public static async findVerify(): Promise<Record<string, IVerify>> {
        const all = await this.all({ type: StorageType.VERIFY })
        const allValues = Object.values(all)
        const allFiltered: Record<string, IVerify> = {}

        for (const item of allValues) {
            if (typeof item === 'string')
                throw new Error(`Invalid item format: ${ item }`)

            allFiltered[item.contractAddress.toLowerCase()] = item
        }

        return allFiltered
    }

    public static async saveAll({
        type,
        data,
    }: {
        type: StorageType
        data: StorageData
    }): Promise<void> {
        return await fs.writeFile(
            `${ STORAGE }/${ type }`,
            JSON.stringify(data, null, 4),
        )
    }

    public static async save({
        type,
        name,
        value,
    }: {
        type: StorageType
        name: string
        value: string | IVerify
    }): Promise<string | undefined> {
        const valueIsString = typeof value === 'string'

        if (type === StorageType.BYTECODE) {
            if (!valueIsString)
                throw new Error('Invalid data format')

            await this._openDirectory(STORAGE)
            await this._openDirectory(`${ STORAGE }/${ StorageType.BYTECODE }`)

            const fileName = `${ STORAGE }/${ type }/${ name }`

            await fs.writeFile(fileName, value)

            return fileName
        }

        const all = await this.all({ type })

        all[name] = valueIsString
            ? value.toLowerCase()
            : JSON.stringify(value)

        await this.saveAll({ type, data: all })
    }

    private static async _openDirectory(path: string): Promise<void> {
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
