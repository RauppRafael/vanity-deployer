import {
    Contract,
    ContractFactory,
    ContractTransactionResponse,
    Overrides,
} from 'ethers'
import hre from 'hardhat'
import { VanityDeployer__factory } from './types'
import { Bytecode } from './Bytecode'
import { CommandBuilder, CommandBuilderOptions } from './CommandBuilder'
import { Hardhat } from './Hardhat'
import { getERC1967ProxyFactory } from './helpers/factories'
import { ConstructorArgument } from './helpers/types'
import { Matcher } from './Matcher'
import { Storage, StorageType } from './Storage'
import { VanityInitializer } from './VanityInitializer'
import { Verify } from './Verify'
import { ContractType } from './Verify/interfaces'

export class VanityDeployer {
    public readonly matcher: Matcher
    private readonly vanityInitializer: VanityInitializer
    private readonly commandBuilder: CommandBuilder

    public constructor({
        startsWith,
        endsWith,
        commandBuilderOptions,
    }: {
        startsWith?: string
        endsWith?: string
        commandBuilderOptions?: CommandBuilderOptions
    }) {
        this.matcher = new Matcher(startsWith || '', endsWith || '')
        this.commandBuilder = new CommandBuilder(commandBuilderOptions)
        this.vanityInitializer = new VanityInitializer(this.matcher, this.commandBuilder)
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
            await deployer.calculateAddress(bytecode, salt),
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
            await deployer.calculateAddress(bytecode, salt),
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
        const constructorArguments = [await implementation.getAddress(), []]
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

        const proxyAddress = await deployer.calculateAddress(bytecode, salt)

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

        const deployTransaction = contract.deploymentTransaction()

        if (!deployTransaction)
            throw new Error(`Unable to retrieve deploy transaction for ${ name }`)

        return this._verifyAndStoreAddress<T>(
            ContractType.Default,
            await contract.getAddress(),
            constructorArguments,
            name,
            saveAs,
            deployTransaction,
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
        const salt = await this._getSalt(filename, saveAs, await deployer.getAddress())

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

        salt = await this.commandBuilder.eradicate(
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
        deployTransaction: ContractTransactionResponse,
    ) {
        await Storage.save({ type: StorageType.ADDRESS, name: saveAs, value: contractAddress })

        await Verify.add({
            contractType,
            contractAddress,
            constructorArguments,
            deployTransactionHash: deployTransaction.hash,
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
