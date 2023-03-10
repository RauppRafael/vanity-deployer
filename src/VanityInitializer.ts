import { Contract, Wallet } from 'ethers'
import hre from 'hardhat'
import { CommandBuilder } from './CommandBuilder'
import { getERC1967ProxyFactory, getVanityDeployerFactory } from './helpers/factories'
import { Hardhat } from './Hardhat'
import { Matcher } from './Matcher'
import { Storage, StorageType } from './Storage'
import { ConstructorArgument } from './helpers/types'
import { Verify } from './Verify'
import { ContractType } from './Verify/interfaces'

export class VanityInitializer {
    constructor(private readonly matcher: Matcher) {
    }

    public async initialize(): Promise<void> {
        const deployerAddress = await Storage.find({
            type: StorageType.ADDRESS,
            name: 'Deployer',
        })
        const deployerProxyAddress = await Storage.find({
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

            let privateKey = await Storage.find({
                type: StorageType.SECRET,
                name: isProxy ? 'DeployerProxy:PrivateKey' : 'Deployer:PrivateKey',
            })

            if (!privateKey)
                privateKey = await CommandBuilder.profanity(this.matcher)

            contractDeployer = this.getSigner(privateKey)

            await Hardhat.transferAllFunds(mainSigner, contractDeployer)

            let deployerContract: Contract | undefined
            let constructorArguments: ConstructorArgument[] = []

            if (isProxy) {
                const factory = await getERC1967ProxyFactory(contractDeployer)
                const implementationAddress = await Storage.find({
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
                    { gasPrice: await Hardhat.gasPrice() },
                )
            }
            else {
                const factory = await getVanityDeployerFactory(contractDeployer)

                deployerContract = await factory.deploy(
                    { gasPrice: await Hardhat.gasPrice() },
                )
            }

            await Hardhat.sendTransaction(deployerContract.deployTransaction)
            await Hardhat.transferAllFunds(contractDeployer, mainSigner)

            await Storage.save({
                type: StorageType.ADDRESS,
                name: isProxy ? 'DeployerProxy' : 'Deployer',
                value: deployerContract.address,
            })

            await Storage.save({
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
                await Hardhat.transferAllFunds(contractDeployer, mainSigner)

            throw error
        }
    }

    private getSigner(pk: string) {
        return new hre.ethers.Wallet(pk, hre.ethers.provider)
    }
}
