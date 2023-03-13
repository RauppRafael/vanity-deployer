import { getImplementationAddress } from '@openzeppelin/upgrades-core'
import { ContractTransaction } from 'ethers'
import hre from 'hardhat'
import {
    ERC1967ProxyArtifact,
    UpgradesBuildInfoArtifact,
    VanityDeployerArtifact,
    VanityDeployerBuildInfoArtifact,
} from '../artifacts'
import { getERC1967ProxyFactory } from '../factories'
import { HardhatHelpers } from '../HardhatHelpers'
import { ConstructorArgument } from '../types'
import { Etherscan } from './Etherscan'
import { ContractType } from './interfaces'

interface IVerify {
    contractType?: ContractType
    contractAddress: string
    constructorArguments?: ConstructorArgument[]
    deployTransaction: ContractTransaction
    confirmations?: number
}

export class Verify {
    public static batch: IVerify[] = []

    public static add({
        contractType = ContractType.Default,
        contractAddress,
        constructorArguments = [],
        deployTransaction,
        confirmations = 2,
    }: IVerify): void {
        Verify.batch.push({
            contractType,
            contractAddress,
            constructorArguments,
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
        contractType,
        contractAddress,
        constructorArguments = [],
        deployTransaction,
        confirmations = 2,
    }: IVerify): Promise<void> {
        try {
            await deployTransaction.wait(confirmations)

            if (contractType === ContractType.Proxy) {
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
                    '',
                    VanityDeployerArtifact,
                    VanityDeployerBuildInfoArtifact,
                )
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
        contractAddress,
        constructorArguments,
    }: IVerify) {
        const provider = hre.network.provider
        const implAddress = await getImplementationAddress(provider, contractAddress)
        const contractFactory = await getERC1967ProxyFactory(await HardhatHelpers.mainSigner())

        await Etherscan.requestEtherscanVerification(
            contractAddress,
            contractFactory.interface.encodeDeploy(constructorArguments).replace('0x', ''),
            ERC1967ProxyArtifact,
            UpgradesBuildInfoArtifact,
        )

        await Etherscan.linkProxyWithImplementation(contractAddress, implAddress)
    }

    private static _alreadyVerified(message: string) {
        return message.includes('reason: already verified')
            || message.includes('contract source code already verified')
    }
}
