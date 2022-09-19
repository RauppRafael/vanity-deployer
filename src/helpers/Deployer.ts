import hre from 'hardhat'
import { Verify } from './Verify'
import { HardhatHelpers } from './HardhatHelpers'
import { constants, Contract, ContractTransaction } from 'ethers'
import { storage, StorageType } from './Storage'
import { Deployer__factory, GnosisSafe__factory, GnosisSafeProxyFactory__factory } from '../contract-types'
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

    public async deploy<T extends Contract>(name: string) {
        console.log(`Deploying ${ name }`)

        const { deployer, salt, bytecode } = await this._getContractInfo(name)
        const deployTransaction = await deployer.deployContract(bytecode, salt)

        await deployTransaction.wait(1)

        return await this._verifyAndStoreAddress(
            name,
            await deployer.getAddress(bytecode, salt),
            deployTransaction,
        ) as T
    }

    public async deployAndInitialize<T extends Contract>(name: string, initializerArguments: ConstructorArgument[]) {
        console.log(`Deploying ${ name }`)

        const { deployer, salt, bytecode } = await this._getContractInfo(name)
        const factory = await hre.ethers.getContractFactory(name, await HardhatHelpers.mainSigner())

        const deployTransaction = await deployer.deployContractAndInitialize(
            bytecode,
            salt,
            factory.interface.encodeFunctionData('initialize', initializerArguments),
        )

        return await this._verifyAndStoreAddress(
            name,
            await deployer.getAddress(bytecode, salt),
            deployTransaction,
        ) as T
    }

    public async deployProxy<T extends Contract>(name: string, initializerArguments: ConstructorArgument[]) {
        const implementation = await this.deploy(name)

        const ERC1967Proxy = 'ERC1967Proxy'
        const { deployer, salt, bytecode } = await this._getContractInfo(
            ERC1967Proxy,
            `${ name }Proxy:salt`,
            [implementation.address],
        )

        const deployTransaction = await deployer.deployContractAndInitialize(
            bytecode,
            salt,
            implementation.interface.encodeFunctionData('initialize', initializerArguments),
        )

        await deployTransaction.wait(1)

        const proxyAddress = await deployer.getAddress(bytecode, salt)

        await storage.save({ type: StorageType.ADDRESS, name: name + 'Proxy', value: proxyAddress })

        Verify.add({
            address: proxyAddress,
            deployTransaction,
            constructorArguments: [implementation.address],
        })

        console.log(`Deployed ${ name + 'Proxy' }`)

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

        await factory.createProxyWithNonce(
            safeSingleton.address,
            initializer,
            salt,
        )

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

    public async deployWithoutVanity<T extends Contract>(name: string, args: ConstructorArgument[]) {
        const contract = await (
            await hre.ethers.getContractFactory(
                name,
                await HardhatHelpers.mainSigner(),
            )
        ).deploy(...args) as T

        await storage.save({ type: StorageType.ADDRESS, name, value: contract.address })

        Verify.add({
            address: contract.address,
            deployTransaction: contract.deployTransaction,
            constructorArguments: args,
        })

        return contract
    }

    private async _getContractInfo(
        name: string,
        saltKey = `${ name }:salt`,
        constructorArguments?: ConstructorArgument[],
    ) {
        await this.initialize()

        const deployer = await this._getContract()
        const salt = await this._getSalt(name, deployer.address, saltKey, constructorArguments)
        const bytecode = await Bytecode.generate(name, constructorArguments)

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
        deployerAddress: string,
        saltKey: string,
        constructorArguments?: ConstructorArgument[],
    ) {
        let salt = await storage.find({ type: StorageType.SECRET, name: saltKey })

        if (salt)
            return salt

        salt = await CommandBuilder.eradicate(
            deployerAddress,
            await Bytecode.generate(name, constructorArguments, true),
            this.matcher,
        )

        await storage.save({ type: StorageType.SECRET, name: saltKey, value: salt })

        return salt
    }

    private async _verifyAndStoreAddress(name: string, address: string, deployTransaction: ContractTransaction) {
        await storage.save({ type: StorageType.ADDRESS, name, value: address })

        Verify.add({ address: address, deployTransaction })

        console.log(`Deployed ${ name }`)

        await deployTransaction.wait(1)

        return (await hre.ethers.getContractFactory(
            name,
            await HardhatHelpers.mainSigner(),
        )).attach(address)
    }

    private async initialize() {
        await initializeExecutables()

        const deployerAddress = await storage.find({ type: StorageType.ADDRESS, name: 'DeployerProxy' })

        if (!deployerAddress || (await hre.ethers.provider.getCode(deployerAddress)) === '0x')
            await initializeDeployer(this.matcher)
    }
}
