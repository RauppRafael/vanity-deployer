import { Contract, ContractFactory, ContractTransaction, Overrides } from 'ethers'
import hre from 'hardhat'
import { VanityDeployer__factory } from '../types'
import { initializeExecutables } from './scripts/initialize-executables'
import { Bytecode } from './Bytecode'
import { CommandBuilder } from './CommandBuilder'
import { VanityInitializer } from './VanityInitializer'
import { getERC1967ProxyFactory } from './helpers/factories'
import { Hardhat } from './Hardhat'
import { Matcher } from './Matcher'
import { Storage, StorageType } from './Storage'
import { ConstructorArgument } from './helpers/types'
import { Verify } from './Verify'
import { ContractType } from './Verify/interfaces'

export class VanityDeployer {
    private readonly matcher: Matcher
    private readonly vanityInitializer: VanityInitializer

    public constructor({
        startsWith,
        endsWith,
    }: {
        startsWith?: string
        endsWith?: string
    }) {
        this.matcher = new Matcher(startsWith || '', endsWith || '')
        this.vanityInitializer = new VanityInitializer(this.matcher)
    }

    public async deploy<T extends Contract>(
        name: string,
        saveAs: string = name,
        overrides: Overrides = {},
    ): Promise<T> {
        console.log(`Deploying ${ saveAs }`)

        const { deployer, salt, bytecode } = await this._getContractInfo(name, saveAs, [])
        const deployTransaction = await Hardhat.sendTransaction(
            deployer.deployContract(bytecode, salt, overrides),
        )
        const contractAddress = await deployer.getAddress(bytecode, salt)

        await Storage.save({ type: StorageType.ADDRESS, name: saveAs, value: contractAddress })

        Verify.add({ contractAddress, deployTransaction })

        return (await hre.ethers.getContractFactory(
            name,
            await Hardhat.mainSigner(),
        )).attach(contractAddress) as T
    }

    public async deployAndInitialize<T extends Contract>(
        name: string,
        initializerArguments: ConstructorArgument[],
        saveAs: string = name,
    ): Promise<T> {
        console.log(`Deploying ${ saveAs }`)

        const { deployer, salt, bytecode } = await this._getContractInfo(name, saveAs, [])

        const factory = await hre.ethers.getContractFactory(name, await Hardhat.mainSigner())

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

        const signer = await Hardhat.mainSigner()
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

        await Hardhat.sendTransaction(deployTransaction)

        const proxyAddress = await deployer.getAddress(bytecode, salt)

        await Storage.save({
            type: StorageType.ADDRESS,
            name: saveAs + 'Proxy',
            value: proxyAddress,
        })

        Verify.add({
            contractType: ContractType.Proxy,
            contractAddress: proxyAddress,
            deployTransaction,
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
                await Hardhat.mainSigner(),
            )
        ).deploy(...constructorArguments) as T

        await Storage.save({ type: StorageType.ADDRESS, name: saveAs, value: contract.address })

        Verify.add({
            contractAddress: contract.address,
            deployTransaction: contract.deployTransaction,
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
        const deployerAddress = await Storage.find({
            type: StorageType.ADDRESS,
            name: 'DeployerProxy',
        })

        if (!deployerAddress)
            throw new Error('Deployer address not found')

        return VanityDeployer__factory.connect(
            deployerAddress,
            await Hardhat.mainSigner(),
        )
    }

    private async _getSalt(
        bytecodeFilename: string,
        saveAs: string,
        deployerAddress: string,
    ) {
        const saltKey = saveAs + ':salt'

        let salt = await Storage.find({ type: StorageType.SECRET, name: saltKey })

        if (salt)
            return salt

        salt = await CommandBuilder.eradicate(
            deployerAddress,
            bytecodeFilename,
            this.matcher,
        )

        await Storage.save({ type: StorageType.SECRET, name: saltKey, value: salt })

        return salt
    }

    private async _verifyAndStoreAddress(
        name: string,
        saveAs: string,
        address: string,
        deployTransaction: ContractTransaction,
    ) {
        await Storage.save({ type: StorageType.ADDRESS, name: saveAs, value: address })

        Verify.add({ contractAddress: address, deployTransaction })

        console.log(`Deployed ${ saveAs }`)

        await deployTransaction.wait(1)

        return (await hre.ethers.getContractFactory(
            name,
            await Hardhat.mainSigner(),
        )).attach(address)
    }

    private async initialize() {
        await initializeExecutables()

        const deployerAddress = await Storage.find({
            type: StorageType.ADDRESS,
            name: 'DeployerProxy',
        })

        if (!deployerAddress || (await hre.ethers.provider.getCode(deployerAddress)) === '0x')
            await this.vanityInitializer.initialize()
    }
}
