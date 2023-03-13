import { ConstructorArgument } from './types'
import hre from 'hardhat'
import { ContractFactory } from 'ethers'
import { storage, StorageType } from './Storage'

export class Bytecode {
    public static async generate(
        name: string,
        {
            saveAs,
            constructorArguments,
            factory,
        }: {
            saveAs?: string
            constructorArguments?: ConstructorArgument[]
            factory?: ContractFactory
        } = {},
    ) {
        if (!factory)
            factory = await hre.ethers.getContractFactory(name)

        const bytecode = constructorArguments?.length
            ? factory.bytecode + factory.interface.encodeDeploy(constructorArguments).replace('0x', '')
            : factory.bytecode

        const filename = await storage.save({
            type: StorageType.BYTECODE,
            name: saveAs || name,
            value: bytecode,
        })

        if (!filename)
            throw new Error('Filename cannot be undefined')

        return {
            filename,
            bytecode,
        }
    }
}
