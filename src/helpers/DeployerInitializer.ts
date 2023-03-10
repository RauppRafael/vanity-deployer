import { Contract, Wallet } from 'ethers'
import hre from 'hardhat'
import { CommandBuilder } from './CommandBuilder'
import { getERC1967ProxyFactory, getVanityDeployerFactory } from './factories'
import { HardhatHelpers } from './HardhatHelpers'
import { Matcher } from './Matcher'
import { storage, StorageType } from './Storage'
import { ConstructorArgument } from './types'
import { Verify } from './Verify'
import { ContractType } from './Verify/interfaces'

export class DeployerInitializer {
    constructor(private readonly matcher: Matcher) {
    }

    public async initialize(): Promise<void> {
        const deployerAddress = await storage.find({
            type: StorageType.ADDRESS,
            name: 'Deployer',
        })
        const deployerProxyAddress = await storage.find({
            type: StorageType.ADDRESS,
            name: 'DeployerProxy',
        })

        if (!deployerAddress) {
            await this.deploy(false)
        }
        else if (!deployerProxyAddress) {
            await this.deploy(true)
        }
        else {
            const deployedBytecode = await hre.ethers.provider.getCode(deployerAddress)
            const deployedProxyBytecode = await hre.ethers.provider.getCode(deployerProxyAddress)

            if (deployedBytecode === '0x')
                await this.deploy(false)
            else if (deployedProxyBytecode === '0x')
                await this.deploy(true)
            else
                throw new Error('Already deployed')
        }

        await Verify.execute()
    }

    private async deploy(isProxy: boolean): Promise<void> {
        const mainSigner = (await hre.ethers.getSigners())[0]
        let contractDeployer: Wallet | undefined

        try {
            console.log(`Deploying deployer${ isProxy ? ' proxy' : '' }`)

            let privateKey = await storage.find({
                type: StorageType.SECRET,
                name: isProxy ? 'DeployerProxy:PrivateKey' : 'Deployer:PrivateKey',
            })

            if (!privateKey)
                privateKey = await CommandBuilder.profanity(this.matcher)

            contractDeployer = this.getSigner(privateKey)

            await HardhatHelpers.transferAllFunds(mainSigner, contractDeployer)

            let deployerContract: Contract | undefined
            let constructorArguments: ConstructorArgument[] = []

            if (isProxy) {
                const factory = await getERC1967ProxyFactory(contractDeployer)
                const implementationAddress = await storage.find({
                    type: StorageType.ADDRESS,
                    name: 'Deployer',
                })

                if (!implementationAddress)
                    throw new Error('Deploying proxy but implementation is not found')

                constructorArguments = [
                    implementationAddress,
                    (new hre.ethers.utils.Interface(['function initialize(address) external']))
                        .encodeFunctionData('initialize', [(await hre.ethers.getSigners())[0].address]),
                ]

                deployerContract = await factory.deploy(
                    ...constructorArguments,
                    { gasPrice: await HardhatHelpers.gasPrice() },
                )
            }
            else {
                const factory = await getVanityDeployerFactory(contractDeployer)

                deployerContract = await factory.deploy(
                    { gasPrice: await HardhatHelpers.gasPrice() },
                )
            }

            await HardhatHelpers.sendTransaction(deployerContract.deployTransaction)
            await HardhatHelpers.transferAllFunds(contractDeployer, mainSigner)

            await storage.save({
                type: StorageType.ADDRESS,
                name: isProxy ? 'DeployerProxy' : 'Deployer',
                value: deployerContract.address,
            })

            await storage.save({
                type: StorageType.SECRET,
                name: isProxy ? 'DeployerProxy:PrivateKey' : 'Deployer:PrivateKey',
                value: privateKey,
            })

            Verify.add({
                contractType: isProxy ? ContractType.Proxy : ContractType.VanityDeployer,
                contractAddress: deployerContract.address,
                deployTransaction: deployerContract.deployTransaction,
                constructorArguments,
            })

            if (!isProxy)
                return this.deploy(true)
        }
        catch (error) {
            console.log('Error: returning funds to main signer')

            if (contractDeployer)
                await HardhatHelpers.transferAllFunds(contractDeployer, mainSigner)

            throw error
        }
    }

    private getSigner(pk: string) {
        return new hre.ethers.Wallet(pk, hre.ethers.provider)
    }
}
