import { getImplementationAddress } from '@openzeppelin/upgrades-core'
import { ContractTransaction } from 'ethers'
import hre from 'hardhat'
import { Hardhat } from '../Hardhat'
import {
    ERC1967ProxyArtifact,
    UpgradesBuildInfoArtifact,
    VanityDeployerArtifact,
    VanityDeployerBuildInfoArtifact,
} from '../helpers/artifacts'
import { getERC1967ProxyFactory } from '../helpers/factories'
import { sleep } from '../helpers/sleep'
import { ConstructorArgument } from '../helpers/types'
import { Storage, StorageType } from '../Storage'
import { Etherscan } from './Etherscan'
import { ContractType } from './interfaces'

export interface IVerify {
    contractType?: ContractType
    contractAddress: string
    constructorArguments?: ConstructorArgument[]
    deployTransaction: ContractTransaction
    confirmations?: number
    verified?: number[]
}

export class Verify {
    public static async add({
        contractType = ContractType.Default,
        contractAddress,
        constructorArguments = [],
        deployTransaction,
        confirmations = 2,
    }: IVerify): Promise<void> {
        const value: IVerify = {
            contractType,
            contractAddress,
            constructorArguments,
            deployTransaction,
            confirmations,
        }

        await Storage.save({
            type: StorageType.VERIFY,
            name: contractAddress.toLowerCase(),
            value,
        })
    }

    public static async execute(): Promise<void> {
        const [batch, chain] = await Promise.all([
            Storage.all({ type: StorageType.VERIFY }),
            Hardhat.chainId(),
        ])

        for (const address in batch) {
            const verifyData = batch[address]

            if (typeof verifyData === 'string')
                throw new Error('Invalid verifyData format')

            if (verifyData.verified?.includes(chain))
                continue

            await Verify._verify(verifyData)

            await Storage.save({
                type: StorageType.VERIFY,
                name: address,
                value: {
                    ...verifyData,
                    verified: verifyData.verified
                        ? [...verifyData.verified, chain]
                        : [chain],
                },
            })
        }
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
        finally {
            await sleep(5_000)
        }
    }

    private static async _verifyProxy({
        contractAddress,
        constructorArguments,
    }: IVerify) {
        const provider = hre.network.provider
        const implAddress = await getImplementationAddress(provider, contractAddress)
        const contractFactory = await getERC1967ProxyFactory(await Hardhat.mainSigner())

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
