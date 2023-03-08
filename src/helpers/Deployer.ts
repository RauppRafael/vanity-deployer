import hre from 'hardhat'
import { getVanityProxyFactory } from './factories'
import { Verify } from './Verify'
import { HardhatHelpers } from './HardhatHelpers'
import { constants, Contract, ContractFactory, ContractTransaction, Overrides } from 'ethers'
import { storage, StorageType } from './Storage'
import {
    VanityDeployer__factory,
    GnosisSafe,
    GnosisSafe__factory,
    GnosisSafeProxyFactory__factory,
} from '../../types'
import { Matcher } from './Matcher'
import { ConstructorArgument } from './types'
import { DeployerInitializer } from './DeployerInitializer'
import { initializeExecutables } from '../scripts/initialize-executables'
import { Bytecode } from './Bytecode'
import { CommandBuilder } from './CommandBuilder'
import { calculateGnosisProxyAddress } from './gnosis'

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
        const deployTransaction = await deployer.deployContract(bytecode, salt, overrides)

        await deployTransaction.wait(1)

        return await this._verifyAndStoreAddress(
            name,
            saveAs,
            await deployer.getAddress(bytecode, salt),
            deployTransaction,
        ) as T
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

        const { deployer, salt, bytecode } = await this._getContractInfo(
            'VanityProxy',
            `${ saveAs }Proxy`,
            [implementation.address],
            await getVanityProxyFactory(signer),
        )

        const deployTransaction = await deployer.deployContractAndInitialize(
            bytecode,
            salt,
            implementation.interface.encodeFunctionData('initialize', initializerArguments),
        )

        await deployTransaction.wait(1)

        const proxyAddress = await deployer.getAddress(bytecode, salt)

        await storage.save({
            type: StorageType.ADDRESS,
            name: saveAs + 'Proxy',
            value: proxyAddress,
        })

        Verify.add({
            address: proxyAddress,
            deployTransaction,
            constructorArguments: [implementation.address],
        })

        console.log(`Deployed ${ saveAs + 'Proxy' }`)

        return implementation.attach(proxyAddress) as T
    }

    public async deployGnosisSafeProxy(
        owners: string[],
        threshold: number,
        salt: string,
    ): Promise<GnosisSafe> {
        const signer = await HardhatHelpers.mainSigner()
        const safeSingleton = GnosisSafe__factory.connect(
            '0xd9Db270c1B5E3Bd161E8c8503c55cEABeE709552',
            signer,
        )
        const factory = await GnosisSafeProxyFactory__factory.connect(
            '0xa6B71E26C5e0845f74c812102Ca7114b6a896AB2',
            signer,
        )
        const initializer = safeSingleton.interface.encodeFunctionData(
            'setup',
            [
                owners,
                threshold,
                constants.AddressZero,
                constants.HashZero,
                constants.AddressZero,
                constants.AddressZero,
                0,
                constants.AddressZero,
            ],
        )

        await (
            await factory.createProxyWithNonce(
                safeSingleton.address,
                initializer,
                salt,
            )
        ).wait(1)

        const proxy = GnosisSafe__factory.connect(
            await calculateGnosisProxyAddress(
                factory,
                safeSingleton.address,
                initializer,
                salt,
            ),
            signer,
        )

        await storage.save({ type: StorageType.ADDRESS, name: 'GnosisSafe', value: proxy.address })

        return proxy
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
            address: contract.address,
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

        Verify.add({ address: address, deployTransaction })

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
