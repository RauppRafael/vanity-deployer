import { ContractTransaction } from 'ethers'
import hre from 'hardhat'
import { ERC1967ProxyArtifact } from '../artifacts'
import { HardhatHelpers } from '../HardhatHelpers'
import { ConstructorArgument } from '../types'
import { getImplementationAddress } from '@openzeppelin/upgrades-core'
import { Etherscan } from './Etherscan'

interface IVerify {
    contractAddress: string
    constructorArguments?: ConstructorArgument[]
    deployTransaction: ContractTransaction
    isProxy: boolean
    confirmations?: number
}

export class Verify {
    public static batch: IVerify[] = []

    public static add({
        contractAddress,
        constructorArguments = [],
        deployTransaction,
        isProxy,
        confirmations = 2,
    }: IVerify): void {
        Verify.batch.push({
            contractAddress,
            constructorArguments,
            deployTransaction,
            isProxy,
            confirmations,
        })
    }

    public static async execute(): Promise<void> {
        for (const params of Verify.batch)
            await Verify._verify(params)

        Verify.batch = []
    }

    private static async _verify({
        contractAddress,
        constructorArguments = [],
        deployTransaction,
        isProxy,
        confirmations = 2,
    }: IVerify): Promise<void> {
        try {
            await deployTransaction.wait(confirmations)

            if (isProxy) {
                await Verify._verifyProxy({
                    contractAddress,
                    constructorArguments,
                    deployTransaction,
                    isProxy,
                })
            }
            else {
                await hre.run('verify:verify', {
                    address: contractAddress,
                    constructorArguments,
                })
            }
        }
        catch (_error) {
            const error = _error as Error
            const message = error.message.toLowerCase()

            if (Verify._alreadyVerified(message))
                return console.log('Contract already verified')

            if (message.includes('does not have bytecode') || message.includes('has no bytecode')) {
                console.log('Still no bytecode')

                return Verify._verify({
                    contractAddress,
                    constructorArguments,
                    deployTransaction,
                    isProxy,
                    confirmations: confirmations + 3,
                })
            }

            throw error
        }
    }

    private static async _verifyProxy({
        contractAddress,
        constructorArguments,
    }: IVerify) {
        const provider = hre.network.provider
        const implAddress = await getImplementationAddress(provider, contractAddress)

        const contractFactory = await hre.ethers.getContractFactory(
            ERC1967ProxyArtifact.abi,
            ERC1967ProxyArtifact.bytecode,
            await HardhatHelpers.mainSigner(),
        )

        await Etherscan.requestEtherscanVerification(
            contractAddress,
            ERC1967ProxyArtifact,
            contractFactory.interface.encodeDeploy(constructorArguments).replace('0x', ''),
        )

        await Etherscan.linkProxyWithImplementation(contractAddress, implAddress)
    }

    private static _alreadyVerified(message: string) {
        return message.includes('reason: already verified')
            || message.includes('contract source code already verified')
    }
}
