import hre from 'hardhat'
import { ContractTransaction } from 'ethers'
import { ConstructorArgument } from './types'

interface IVerify {
    address: string
    constructorArguments?: ConstructorArgument[]
    confirmations?: number
    deployTransaction: ContractTransaction
}

export class Verify {
    public static batch: IVerify[] = []

    public static add({
        deployTransaction,
        address,
        constructorArguments = [],
        confirmations = 2,
    }: IVerify): void {
        this.batch.push({ deployTransaction, address, constructorArguments, confirmations })
    }

    public static async execute() {
        for (const params of this.batch)
            await this._verify(params)

        this.batch = []
    }

    private static async _verify({
        deployTransaction,
        address,
        constructorArguments = [],
        confirmations = 2,
    }: IVerify): Promise<void> {
        try {
            await deployTransaction.wait(confirmations)

            await hre.run('verify:verify', {
                address: address,
                constructorArguments,
            })
        } catch (_error) {
            const error = _error as Error
            const message = error.message.toLowerCase()

            if (this._alreadyVerified(message))
                return console.log('Contract already verified')

            if (message.toLowerCase().includes('does not have bytecode')) {
                console.log('Still no bytecode')

                return this._verify({
                    deployTransaction,
                    address,
                    constructorArguments,
                    confirmations: confirmations + 3,
                })
            }

            throw error
        }
    }

    private static _alreadyVerified(message: string) {
        return message.includes('reason: already verified')
            || message.includes('contract source code already verified')
    }
}
