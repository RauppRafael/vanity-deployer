import hre, { upgrades } from 'hardhat'
import { Verify } from './Verify'
import { HardhatHelpers } from './HardhatHelpers'
import { constants, Contract, ContractTransaction, Overrides } from 'ethers'
import { storage, StorageType } from './Storage'
import {
    Deployer__factory,
    GnosisSafe__factory,
    GnosisSafeProxyFactory__factory,
} from '../contract-types'
import { Matcher } from './Matcher'
import { ConstructorArgument } from './types'
import { initializeDeployer } from '../scripts/initialize-deployer'
import { initializeExecutables } from '../scripts/initialize-executables'
import { Bytecode } from './Bytecode'
import { CommandBuilder } from './CommandBuilder'
import { calculateGnosisProxyAddress } from './gnosis'

export class Deployer {
    private readonly matcher: Matcher

    public constructor(startsWith = '', endsWith = '') {
        this.matcher = new Matcher(startsWith, endsWith)
    }

    public async deploy<T extends Contract>(
        name: string,
        saveAs: string = name,
        overrides: Overrides = {},
    ) {
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
    ) {
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
    ) {
        if (!saveAs)
            saveAs = name

        if (!implementation)
            implementation = await this.deploy(name, saveAs)

        const ERC1967Proxy = 'ERC1967Proxy'
        const { deployer, salt, bytecode } = await this._getContractInfo(
            ERC1967Proxy,
            `${ saveAs }Proxy`,
            [implementation.address],
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

    public async deployGnosisSafeProxy(owners: string[], threshold: number, salt: string) {
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

    public async deployProxyWithoutVanity<T extends Contract>(
        name: string,
        initializerArguments: ConstructorArgument[],
        saveAs: string = name,
    ) {
        const proxy = (await upgrades.deployProxy(
            await hre.ethers.getContractFactory(
                name,
                await HardhatHelpers.mainSigner(),
            ),
            initializerArguments,
        )) as T

        await storage.save({ type: StorageType.ADDRESS, name: saveAs, value: proxy.address })

        return proxy
    }

    public async deployAndInitializeWithoutVanity<T extends Contract>(
        name: string,
        initializerArguments: ConstructorArgument[],
        saveAs: string = name
    ) {
        console.log(`Deploying ${ name } without vanity`)

        const contract = await this.deployWithoutVanity<T>(name, [], saveAs)

        const tx = await contract.initialize(...initializerArguments)

        await tx.wait()

        console.log(`${ name } deployed @ ${ contract.address }`)

        return contract
    }

    public async deployWithoutVanity<T extends Contract>(
        name: string,
        constructorArguments: ConstructorArgument[],
        saveAs: string = name,
    ) {
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
    ) {
        await this.initialize()

        const deployer = await this._getContract()
        const salt = await this._getSalt(name, saveAs, deployer.address, constructorArguments)
        const { bytecode } = await Bytecode.generate(name, { constructorArguments })

        return { deployer, salt, bytecode }
    }

    private async _getContract() {
        return Deployer__factory.connect(
            await storage.find({ type: StorageType.ADDRESS, name: 'DeployerProxy' }),
            await HardhatHelpers.mainSigner(),
        )
    }

    private async _getSalt(
        name: string,
        saveAs: string,
        deployerAddress: string,
        constructorArguments: ConstructorArgument[],
    ) {
        const saltKey = saveAs + ':salt'

        let salt = await storage.find({ type: StorageType.SECRET, name: saltKey })

        if (salt)
            return salt

        salt = await CommandBuilder.eradicate(
            deployerAddress,
            (await Bytecode.generate(name, { constructorArguments, saveAs })).filename,
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
            await initializeDeployer(this.matcher)
    }
}
