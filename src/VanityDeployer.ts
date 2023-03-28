import { Contract, ContractFactory, ContractTransaction, Overrides } from 'ethers'
import hre from 'hardhat'
import { VanityDeployer__factory } from './types'
import { Bytecode } from './Bytecode'
import { CommandBuilder } from './CommandBuilder'
import { Hardhat } from './Hardhat'
import { getERC1967ProxyFactory } from './helpers/factories'
import { ConstructorArgument } from './helpers/types'
import { Matcher } from './Matcher'
import { Storage, StorageType } from './Storage'
import { VanityInitializer } from './VanityInitializer'
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
        const deployTransaction = await deployer.deployContract(bytecode, salt, overrides)

        return this._verifyAndStoreAddress<T>(
            ContractType.Default,
            await deployer.getAddress(bytecode, salt),
            [],
            name,
            saveAs,
            deployTransaction,
        )
    }

    public async deployAndInitialize<T extends Contract>(
        name: string,
        initializerArguments: ConstructorArgument[],
        saveAs: string = name,
        overrides: Overrides = {},
    ): Promise<T> {
        console.log(`Deploying ${ saveAs }`)

        const { deployer, salt, bytecode } = await this._getContractInfo(name, saveAs, [])

        const factory = await hre.ethers.getContractFactory(name, await Hardhat.mainSigner())

        const deployTransaction = await deployer.deployContractAndInitialize(
            bytecode,
            salt,
            factory.interface.encodeFunctionData('initialize', initializerArguments),
            overrides,
        )

        return await this._verifyAndStoreAddress<T>(
            ContractType.Default,
            await deployer.getAddress(bytecode, salt),
            [],
            name,
            saveAs,
            deployTransaction,
        )
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
        overrides: Overrides = {},
    ): Promise<T> {
        if (!saveAs)
            saveAs = name

        if (!implementation)
            implementation = await this.deploy(name, saveAs, overrides)

        const signer = await Hardhat.mainSigner()
        const constructorArguments = [implementation.address, []]
        const proxySaveAs = `${ saveAs }Proxy`

        const { deployer, salt, bytecode } = await this._getContractInfo(
            'ERC1967Proxy',
            proxySaveAs,
            constructorArguments,
            await getERC1967ProxyFactory(signer),
        )

        const deployTransaction = await deployer.deployContractAndInitialize(
            bytecode,
            salt,
            implementation.interface.encodeFunctionData('initialize', initializerArguments),
            overrides,
        )

        const proxyAddress = await deployer.getAddress(bytecode, salt)

        await this._verifyAndStoreAddress(
            ContractType.Proxy,
            proxyAddress,
            constructorArguments,
            name,
            proxySaveAs,
            deployTransaction,
        )

        return implementation.attach(proxyAddress) as T
    }

    public async deployWithoutVanity<T extends Contract>(
        name: string,
        constructorArguments: ConstructorArgument[],
        saveAs: string = name,
        overrides: Overrides = {},
    ): Promise<T> {
        const contract = await (
            await hre.ethers.getContractFactory(
                name,
                await Hardhat.mainSigner(),
            )
        ).deploy(...constructorArguments, overrides)

        return this._verifyAndStoreAddress<T>(
            ContractType.Default,
            contract.address,
            constructorArguments,
            name,
            saveAs,
            contract.deployTransaction,
        )
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
        const deployerAddress = await Storage.findAddress('DeployerProxy')

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

        let salt = await Storage.findSecret(saltKey)

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

    private async _verifyAndStoreAddress<T extends Contract>(
        contractType: ContractType,
        contractAddress: string,
        constructorArguments: ConstructorArgument[],
        name: string,
        saveAs: string,
        deployTransaction: ContractTransaction,
    ) {
        await Storage.save({ type: StorageType.ADDRESS, name: saveAs, value: contractAddress })

        await Verify.add({
            contractType,
            contractAddress,
            constructorArguments,
            deployTransaction,
        })

        console.log(`Deployed ${ saveAs }`)

        await Hardhat.awaitConfirmation(deployTransaction)

        return (await hre.ethers.getContractFactory(
            name,
            await Hardhat.mainSigner(),
        )).attach(contractAddress) as T
    }

    private async initialize() {
        const deployerAddress = await Storage.findAddress('DeployerProxy')

        if (!deployerAddress || (await hre.ethers.provider.getCode(deployerAddress)) === '0x')
            await this.vanityInitializer.initialize()
    }
}
