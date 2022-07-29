import hre from 'hardhat'
import { verify } from './verify'
import { HardhatHelpers } from './HardhatHelpers'
import { ContractFactory } from 'ethers'
import { storage, StorageType } from './Storage'
import { Deployer__factory } from '../contract-types'
import kill from 'tree-kill'
import { exec } from 'child_process'
import { Matcher, MatcherType } from './Matcher'
import { ConstructorArgument } from './types'
import { CommandBuilder } from './CommandBuilder'
import { initializeDeployer } from '../scripts/initialize-deployer'
import { initializeExecutables } from '../scripts/initialize-executables'
import internal from 'stream'

interface IProxyInfo {
    name: string
    initializer: string
}

export class Deployer {
    private readonly matcher: Matcher

    public constructor(startsWith = '', endsWith = '') {
        this.matcher = new Matcher(startsWith, endsWith)
    }

    public async deploy(
        name: string,
        constructorArguments: ConstructorArgument[],
        proxyInfo?: IProxyInfo,
    ) {
        await this.initialize()

        console.log(`Deploying ${ name }`)

        const deployerContract = await this._getContract()

        const salt = await this._getSalt(
            name,
            constructorArguments,
            deployerContract.address,
            proxyInfo,
        )

        const block = await HardhatHelpers.getBlock()

        let done
        const contractAddressPromise = new Promise((resolve) => {
            deployerContract.on('DeployedContract', (address, _, event) => {
                if (event.blockNumber >= block.number && !done) {
                    resolve(address)
                    done = true
                }
            })
        })

        const deployTransaction = proxyInfo
            ? await deployerContract.deployProxy(
                await this._getBytecode(name, constructorArguments),
                salt,
                proxyInfo.initializer,
            )
            : await deployerContract.deployContract(
                await this._getBytecode(name, constructorArguments),
                salt,
            )

        await deployTransaction.wait(3)

        const contractAddress = await contractAddressPromise as string

        await storage.save({
            type: StorageType.ADDRESS,
            name: proxyInfo
                ? `${ proxyInfo?.name }Proxy`
                : name,
            value: contractAddress,
        })

        verify.add({
            address: contractAddress,
            deployTransaction,
            constructorArguments,
        })

        console.log(`Deployed ${ name }`)

        const signer = await HardhatHelpers.mainSigner()

        return new hre.ethers.Contract(
            contractAddress,
            (await hre.ethers.getContractFactory(name, signer)).interface,
            signer,
        )
    }

    public async deployProxy(name: string, constructorArguments: ConstructorArgument[]) {
        const implementation = await this.deploy(name, [])
        const proxy = await this.deploy(
            'ERC1967Proxy',
            [implementation.address],
            {
                name,
                initializer: implementation.interface.encodeFunctionData('initialize', constructorArguments),
            },
        )

        return implementation.attach(proxy.address)
    }

    private async _getContract() {
        return Deployer__factory.connect(
            await storage.find({ type: StorageType.ADDRESS, name: 'DeployerProxy' }),
            await HardhatHelpers.mainSigner(),
        )
    }

    private async _getBytecode(
        name: string,
        constructorArguments: ConstructorArgument[],
        save?: boolean,
    ) {
        const factory = await hre.ethers.getContractFactory(name) as ContractFactory
        const bytecode = constructorArguments?.length
            ? factory.bytecode + factory.interface.encodeDeploy(constructorArguments).replace('0x', '')
            : factory.bytecode

        return save
            ? storage.save({ type: StorageType.BYTECODE, name, value: bytecode })
            : bytecode
    }

    private async _getSalt(
        name: string,
        constructorArguments: ConstructorArgument[],
        deployerAddress: string,
        proxyInfo?: IProxyInfo,
    ) {
        const saltKey = proxyInfo
            ? `${ proxyInfo.name }Proxy:salt`
            : `${ name }:salt`

        let salt = await storage.find({ type: StorageType.SECRET, name: saltKey })

        if (salt)
            return salt

        const command = CommandBuilder.eradicate(
            deployerAddress,
            await this._getBytecode(name, constructorArguments, true),
            this.matcher,
        )
        const addressMatcher = this.matcher.get(MatcherType.ADDRESS)
        const secretMatcher = this.matcher.get(MatcherType.SECRET)
        const child = await exec(command)

        let listener: internal.Readable

        const promise: Promise<string> = new Promise((resolve, reject) => {
            listener = child.stdout.on('data', event => {
                const line: string = event.toString().toLowerCase()

                if (line.includes('salt') && !!line.match(addressMatcher))
                    resolve(line.match(secretMatcher)[0])
            })

            child.on('error', e => {
                if (e.message.includes(command) && e.message.includes('ENOENT'))
                    return console.log('Vanity address found')

                reject(e)
            })
        })

        salt = await promise

        listener.pause()

        kill(child.pid, 'SIGTERM')

        await storage.save({ type: StorageType.SECRET, name: saltKey, value: salt })

        return promise
    }

    private async initialize() {
        await initializeExecutables()

        if (!await storage.find({ type: StorageType.ADDRESS, name: 'DeployerProxy' }))
            await initializeDeployer(this.matcher)
    }
}
