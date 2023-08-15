import { ConstructorArgument } from './helpers/types'
import hre from 'hardhat'
import { ContractFactory } from 'ethers'
import { Storage, StorageType } from './Storage'

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
        const bytecode = await Bytecode.getBytecode(name, { constructorArguments, factory })

        const filename = await Storage.save({
            type: StorageType.BYTECODE,
            name: saveAs || name,
            value: bytecode,
        })

        if (!filename)
            throw new Error('Filename cannot be undefined')

        return { filename, bytecode }
    }

    public static async getBytecode(
        name: string,
        {
            constructorArguments,
            factory,
        }: {
            constructorArguments?: ConstructorArgument[]
            factory?: ContractFactory
        } = {},
    ) {
        if (!factory)
            factory = await hre.ethers.getContractFactory(name)

        return constructorArguments?.length
            ? factory.bytecode + factory.interface.encodeDeploy(constructorArguments).replace('0x', '')
            : factory.bytecode
    }
}
