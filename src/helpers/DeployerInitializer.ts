import hre from 'hardhat'
import { Wallet } from 'ethers'
import { getERC1967ProxyFactory, getVanityDeployerFactory } from './factories'
import { HardhatHelpers } from './HardhatHelpers'
import { Verify } from './Verify'
import { storage, StorageType } from './Storage'
import { Matcher } from './Matcher'
import { CommandBuilder } from './CommandBuilder'

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

            const factory = isProxy
                ? await getERC1967ProxyFactory(contractDeployer)
                : await getVanityDeployerFactory(contractDeployer)

            const constructorArguments = isProxy
                ? [
                    (await storage.find({ type: StorageType.ADDRESS, name: 'Deployer' }))!,
                    (new hre.ethers.utils.Interface(['function initialize(address) external']))
                        .encodeFunctionData('initialize', [(await hre.ethers.getSigners())[0].address]),
                ]
                : []

            const deployerContract = await factory.deploy(
                ...constructorArguments,
                { gasPrice: await HardhatHelpers.gasPrice() },
            )

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
                deployTransaction: deployerContract.deployTransaction,
                address: deployerContract.address,
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
