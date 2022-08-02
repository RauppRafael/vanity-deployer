import { ConstructorArgument } from './types'
import hre from 'hardhat'
import { ContractFactory } from 'ethers'
import { storage, StorageType } from './Storage'

export class Bytecode {
    public static async generate(
        name: string,
        constructorArguments?: ConstructorArgument[],
        save?: boolean,
    ) {
        const factory = await hre.ethers.getContractFactory(name) as ContractFactory
        const bytecode = constructorArguments?.length
            ? factory.bytecode + factory.interface.encodeDeploy(constructorArguments).replace('0x', '')
            : factory.bytecode

        return save
            ? storage.save({ type: StorageType.BYTECODE, name, value: bytecode })
            : bytecode
    }
}
