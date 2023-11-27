import { Wallet, Interface } from 'ethers'
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
        const deployerAddress = await Storage.findAddress('Deployer')
        const deployerProxyAddress = await Storage.findAddress('DeployerProxy')

        if (!deployerAddress || !await Hardhat.isContract(deployerAddress))
            await this.deploy(false)
        else if (!deployerProxyAddress || !await Hardhat.isContract(deployerProxyAddress))
            await this.deploy(true)
        else
            throw new Error('Already deployed')

        await Verify.execute()
    }

    private async deploy(isProxy: boolean): Promise<void> {
        console.log(`Deploying deployer${ isProxy ? ' proxy' : '' }`)

        const mainSigner = await Hardhat.mainSigner()
        const contractDeployer = await this.getContractDeployer(isProxy)

        try {
            await Hardhat.transferAllFunds(mainSigner, contractDeployer)

            const factory = await this.getDeployerFactory(contractDeployer, isProxy)

            let deployerContract: Awaited<ReturnType<typeof factory.deploy>>
            let constructorArguments: ConstructorArgument[] = []

            if (isProxy) {
                const implementationAddress = await Storage.findAddress('Deployer')

                if (!implementationAddress)
                    throw new Error('Deploying proxy but implementation is not found')

                constructorArguments = [
                    implementationAddress,
                    (new Interface(['function initialize(address) external']))
                        .encodeFunctionData('initialize', [mainSigner.address]),
                ]

                deployerContract = await factory.deploy(
                    ...constructorArguments,
                    { gasPrice: await Hardhat.gasPrice() },
                )
            }
            else {
                deployerContract = await factory.deploy(
                    { gasPrice: await Hardhat.gasPrice() },
                )
            }

            const deployerContractAddress = await deployerContract.getAddress()
            const deploymentTransaction = deployerContract.deploymentTransaction()

            if (!deploymentTransaction)
                throw new Error(`Unable to find transaction hash for ${ deployerContractAddress }`)

            await Hardhat.awaitConfirmation(deploymentTransaction)
            await Hardhat.transferAllFunds(contractDeployer, mainSigner)

            await Storage.save({
                type: StorageType.ADDRESS,
                name: isProxy ? 'DeployerProxy' : 'Deployer',
                value: deployerContractAddress,
            })

            await Verify.add({
                contractType: isProxy ? ContractType.Proxy : ContractType.VanityDeployer,
                contractAddress: deployerContractAddress,
                deployTransactionHash: deploymentTransaction.hash,
                constructorArguments,
            })

            if (!isProxy)
                return this.deploy(true)
        }
        catch (error) {
            console.log('Error: returning funds to main signer')

            try {
                if (contractDeployer)
                    await Hardhat.transferAllFunds(contractDeployer, mainSigner)
            }
            catch (e) {
                console.error(e)
            }

            throw error
        }
    }

    private async getContractDeployer(isProxy: boolean) {
        let privateKey = await Storage.findSecret(
            isProxy
                ? 'DeployerProxy:PrivateKey'
                : 'Deployer:PrivateKey',
        )

        if (!privateKey) {
            privateKey = await CommandBuilder.profanity(this.matcher)

            await Storage.save({
                type: StorageType.SECRET,
                name: isProxy ? 'DeployerProxy:PrivateKey' : 'Deployer:PrivateKey',
                value: privateKey,
            })
        }

        return new hre.ethers.Wallet(privateKey, hre.ethers.provider)
    }

    private getDeployerFactory(contractDeployer: Wallet, isProxy: boolean) {
        return isProxy
            ? getERC1967ProxyFactory(contractDeployer)
            : getVanityDeployerFactory(contractDeployer)
    }
}
