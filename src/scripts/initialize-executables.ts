import { promises as fs } from 'fs'
import path from 'path'

const files = [
    'keccak.cl',
    'profanity.cl',
    'eradicate2.cl',
]

export const initializeExecutables = async () => {
    try {
        await Promise.all(
            files.map(
                file => fs.readFile(`./${ file }`),
            ),
        )
    } catch (e) {
        await Promise.all(
            files.map(
                file => fs.copyFile(path.join(__dirname, '../executables', file), `./${ file }`),
            ),
        )
    }
}
