import { Contract, ContractFactory, ContractTransaction, Overrides } from 'ethers'
import hre from 'hardhat'
import { VanityDeployer__factory, } from '../../types'
import { initializeExecutables } from '../scripts/initialize-executables'
import { Bytecode } from './Bytecode'
import { CommandBuilder } from './CommandBuilder'
import { DeployerInitializer } from './DeployerInitializer'
import { getERC1967ProxyFactory } from './factories'
import { HardhatHelpers } from './HardhatHelpers'
import { Matcher } from './Matcher'
import { storage, StorageType } from './Storage'
import { ConstructorArgument } from './types'
import { Verify } from './Verify'

export class Deployer {
    private readonly matcher: Matcher
    private readonly deployerInitializer: DeployerInitializer

    public constructor({
        startsWith,
        endsWith,
    }: {
        startsWith?: string
        endsWith?: string
    }) {
        this.matcher = new Matcher(startsWith || '', endsWith || '')
        this.deployerInitializer = new DeployerInitializer(this.matcher)
    }

    public async deploy<T extends Contract>(
        name: string,
        saveAs: string = name,
        overrides: Overrides = {},
    ): Promise<T> {
        console.log(`Deploying ${ saveAs }`)

        const { deployer, salt, bytecode } = await this._getContractInfo(name, saveAs, [])
        const deployTransaction = await HardhatHelpers.sendTransaction(
            deployer.deployContract(bytecode, salt, overrides),
        )
        const contractAddress = await deployer.getAddress(bytecode, salt)

        await storage.save({ type: StorageType.ADDRESS, name: saveAs, value: contractAddress })

        Verify.add({
            contractAddress,
            deployTransaction,
            isProxy: false,
        })

        return (await hre.ethers.getContractFactory(
            name,
            await HardhatHelpers.mainSigner(),
        )).attach(contractAddress) as T
    }

    public async deployAndInitialize<T extends Contract>(
        name: string,
        initializerArguments: ConstructorArgument[],
        saveAs: string = name,
    ): Promise<T> {
        console.log(`Deploying ${ saveAs }`)

        const { deployer, salt, bytecode } = await this._getContractInfo(name, saveAs, [])

        const factory = await hre.ethers.getContractFactory(name, await HardhatHelpers.mainSigner())

        const deployTransaction = await deployer.deployContractAndInitialize(
            bytecode,
            salt,
            factory.interface.encodeFunctionData('initialize', initializerArguments),
        )

        return await this._verifyAndStoreAddress(
            name,
            saveAs,
            await deployer.getAddress(bytecode, salt),
            deployTransaction,
        ) as T
    }

    public async deployProxy<T extends Contract>(
        name: string,
        initializerArguments: ConstructorArgument[],
        {
            saveAs,
            implementation,
        }: {
            saveAs?: string,
            implementation?: Contract
        } = {},
    ): Promise<T> {
        if (!saveAs)
            saveAs = name

        if (!implementation)
            implementation = await this.deploy(name, saveAs)

        const signer = (await hre.ethers.getSigners())[0]
        const constructorArguments = [implementation.address, []]

        const { deployer, salt, bytecode } = await this._getContractInfo(
            'ERC1967Proxy',
            `${ saveAs }Proxy`,
            constructorArguments,
            await getERC1967ProxyFactory(signer),
        )

        const deployTransaction = await deployer.deployContractAndInitialize(
            bytecode,
            salt,
            implementation.interface.encodeFunctionData('initialize', initializerArguments),
        )

        await HardhatHelpers.sendTransaction(deployTransaction)

        const proxyAddress = await deployer.getAddress(bytecode, salt)

        await storage.save({
            type: StorageType.ADDRESS,
            name: saveAs + 'Proxy',
            value: proxyAddress,
        })

        Verify.add({
            contractAddress: proxyAddress,
            deployTransaction,
            isProxy: true,
            constructorArguments,
        })

        console.log(`Deployed ${ saveAs + 'Proxy' }`)

        return implementation.attach(proxyAddress) as T
    }

    public async deployWithoutVanity<T extends Contract>(
        name: string,
        constructorArguments: ConstructorArgument[],
        saveAs: string = name,
    ): Promise<T> {
        const contract = await (
            await hre.ethers.getContractFactory(
                name,
                await HardhatHelpers.mainSigner(),
            )
        ).deploy(...constructorArguments) as T

        await storage.save({ type: StorageType.ADDRESS, name: saveAs, value: contract.address })

        Verify.add({
            contractAddress: contract.address,
            deployTransaction: contract.deployTransaction,
            isProxy: false,
            constructorArguments,
        })

        return contract
    }

    private async _getContractInfo(
        name: string,
        saveAs: string,
        constructorArguments: ConstructorArgument[],
        factory?: ContractFactory,
    ) {
        await this.initialize()

        const deployer = await this._getContract()
        const { bytecode, filename } = await Bytecode.generate(name, {
            constructorArguments,
            factory,
        })
        const salt = await this._getSalt(filename, saveAs, deployer.address)

        return { deployer, salt, bytecode }
    }

    private async _getContract() {
        const deployerAddress = await storage.find({
            type: StorageType.ADDRESS,
            name: 'DeployerProxy',
        })

        if (!deployerAddress)
            throw new Error('Deployer address not found')

        return VanityDeployer__factory.connect(
            deployerAddress,
            await HardhatHelpers.mainSigner(),
        )
    }

    private async _getSalt(
        bytecodeFilename: string,
        saveAs: string,
        deployerAddress: string,
    ) {
        const saltKey = saveAs + ':salt'

        let salt = await storage.find({ type: StorageType.SECRET, name: saltKey })

        if (salt)
            return salt

        salt = await CommandBuilder.eradicate(
            deployerAddress,
            bytecodeFilename,
            this.matcher,
        )

        await storage.save({ type: StorageType.SECRET, name: saltKey, value: salt })

        return salt
    }

    private async _verifyAndStoreAddress(
        name: string,
        saveAs: string,
        address: string,
        deployTransaction: ContractTransaction,
    ) {
        await storage.save({ type: StorageType.ADDRESS, name: saveAs, value: address })

        Verify.add({
            contractAddress: address,
            deployTransaction,
            isProxy: false,
        })

        console.log(`Deployed ${ saveAs }`)

        await deployTransaction.wait(1)

        return (await hre.ethers.getContractFactory(
            name,
            await HardhatHelpers.mainSigner(),
        )).attach(address)
    }

    private async initialize() {
        await initializeExecutables()

        const deployerAddress = await storage.find({
            type: StorageType.ADDRESS,
            name: 'DeployerProxy',
        })

        if (!deployerAddress || (await hre.ethers.provider.getCode(deployerAddress)) === '0x')
            await this.deployerInitializer.initialize()
    }
}
