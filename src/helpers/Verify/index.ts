import { getImplementationAddress } from '@openzeppelin/upgrades-core'
import { ContractTransaction } from 'ethers'
import hre from 'hardhat'
import { ERC1967Proxy, VanityDeployer, VanityProxy } from '../artifacts'
import { HardhatHelpers } from '../HardhatHelpers'
import { ConstructorArgument } from '../types'
import { ContractArtifact, ContractType } from './interfaces'
import { Etherscan } from './Etherscan'

interface IVerify {
    contractType: ContractType
    contractAddress: string
    constructorArguments?: ConstructorArgument[]
    deployTransaction: ContractTransaction
    confirmations?: number
}

export class Verify {
    public static batch: IVerify[] = []

    public static add({
        contractType,
        contractAddress,
        constructorArguments = [],
        deployTransaction,
        confirmations = 2,
    }: IVerify): void {
        Verify.batch.push({
            contractAddress,
            constructorArguments,
            contractType,
            deployTransaction,
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
        contractType,
        deployTransaction,
        confirmations = 2,
    }: IVerify): Promise<void> {
        try {
            await deployTransaction.wait(confirmations)

            if (
                contractType === ContractType.VanityProxy ||
                contractType === ContractType.ERC1967Proxy
            ) {
                await Verify._verifyProxy({
                    contractType,
                    contractAddress,
                    constructorArguments,
                    deployTransaction,
                })
            }
            else if (contractType === ContractType.VanityDeployer) {
                await Etherscan.requestEtherscanVerification(
                    contractAddress,
                    VanityDeployer,
                    '',
                )
            }
            else if (contractType === ContractType.Implementation) {
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
                    contractType,
                    contractAddress,
                    constructorArguments,
                    deployTransaction,
                    confirmations: confirmations + 3,
                })
            }

            throw error
        }
    }

    private static async _verifyProxy({
        contractType,
        contractAddress,
        constructorArguments,
    }: IVerify) {
        const provider = hre.network.provider
        const implAddress = await getImplementationAddress(provider, contractAddress)

        let artifact: ContractArtifact | undefined

        if (contractType === ContractType.ERC1967Proxy)
            artifact = ERC1967Proxy
        else if (contractType === ContractType.VanityProxy)
            artifact = VanityProxy

        if (!artifact)
            throw new Error('Contract type is not a valid proxy')

        const contractFactory = await hre.ethers.getContractFactory(
            artifact.abi,
            artifact.bytecode,
            await HardhatHelpers.mainSigner(),
        )

        await Etherscan.requestEtherscanVerification(
            contractAddress,
            artifact,
            contractFactory.interface.encodeDeploy(constructorArguments).replace('0x', ''),
        )

        await Etherscan.linkProxyWithImplementation(contractAddress, implAddress)
    }

    private static _alreadyVerified(message: string) {
        return message.includes('reason: already verified')
            || message.includes('contract source code already verified')
    }
}

export { ContractType }
