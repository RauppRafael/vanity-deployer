import hre from 'hardhat'
import kill from 'tree-kill'
import { HardhatHelpers } from '../helpers/HardhatHelpers'
import { verify } from '../helpers/Verify'
import { storage, StorageType } from '../helpers/Storage'
import { Matcher, MatcherType } from '../helpers/Matcher'
import { CommandBuilder } from '../helpers/CommandBuilder'
import { exec } from 'child_process'
import internal from 'stream'

const getPrivateKey = async (matcher: Matcher) => {
    const command = CommandBuilder.profanity(matcher)
    const addressMatcher = matcher.get(MatcherType.ADDRESS)
    const secretMatcher = matcher.get(MatcherType.SECRET)
    const child = await exec(command)

    let listener: internal.Readable

    const promise: Promise<string> = new Promise((resolve, reject) => {
        listener = child.stdout.on('data', event => {
            const line: string = event.toString().toLowerCase()

            if (line.includes('private') && !!line.match(addressMatcher))
                resolve(line.match(secretMatcher)[0])
        })

        child.on('error', e => {
            if (e.message.includes(command) && e.message.includes('ENOENT'))
                return console.log('Vanity key found')

            reject(e)
        })
    })

    await promise

    listener.pause()

    kill(child.pid, 'SIGTERM')

    return promise
}

const getSigner = pk => new hre.ethers.Wallet(pk, hre.ethers.provider)

const deploy = async (isProxy: boolean, matcher: Matcher) => {
    const mainSigner = (await hre.ethers.getSigners())[0]
    const { gasPrice } = await hre.ethers.provider.getFeeData()
    let privateKey = await storage.find({
        type: StorageType.SECRET,
        name: isProxy ? 'DeployerPrivateKeyProxy' : 'DeployerPrivateKey',
    })

    if (!privateKey)
        privateKey = await getPrivateKey(matcher)

    const contractDeployer = getSigner(privateKey)

    await HardhatHelpers.sendTransaction(
        mainSigner.sendTransaction({
            to: contractDeployer.address,
            gasPrice,
            value: HardhatHelpers.parseEther(.5),
        }),
    )

    const factory = await hre.ethers.getContractFactory(
        isProxy ? 'ERC1967Proxy' : 'Deployer',
        contractDeployer,
    )

    const constructorArguments = isProxy
        ? [
            await storage.find({ type: StorageType.ADDRESS, name: 'Deployer' }),
            (new hre.ethers.utils.Interface(['function initialize(address) external']))
                .encodeFunctionData(
                    'initialize',
                    [process.env.DEPLOYER_ADDRESS],
                ),
        ]
        : []

    const deployerContract = await factory.deploy(...constructorArguments)

    await deployerContract.deployTransaction.wait(2)

    const balance = await hre.ethers.provider.getBalance(contractDeployer.address)

    await HardhatHelpers.sendTransaction(
        contractDeployer.sendTransaction({
            to: mainSigner.address,
            value: balance.sub(hre.ethers.BigNumber.from(21000).mul(gasPrice)),
            gasLimit: 21000,
            gasPrice,
        }),
    )

    await storage.save({
        type: StorageType.ADDRESS,
        name: isProxy ? 'DeployerProxy' : 'Deployer',
        value: deployerContract.address,
    })

    await storage.save({
        type: StorageType.SECRET,
        name: isProxy ? 'DeployerPrivateKeyProxy' : 'DeployerPrivateKey',
        value: privateKey,
    })

    verify.add({
        deployTransaction: deployerContract.deployTransaction,
        address: deployerContract.address,
        constructorArguments,
    })

    if (!isProxy)
        return deploy(true, matcher)
}

export const initializeDeployer = async (matcher: Matcher) => {
    const deployerAddress = await storage.find({
        type: StorageType.ADDRESS,
        name: 'Deployer',
    })
    const deployerProxyAddress = await storage.find({
        type: StorageType.ADDRESS,
        name: 'DeployerProxy',
    })

    if (!deployerAddress)
        await deploy(false, matcher)
    else if (!deployerProxyAddress)
        await deploy(true, matcher)
    else {
        const deployedBytecode = await hre.ethers.provider.getCode(deployerAddress)
        const deployedProxyBytecode = await hre.ethers.provider.getCode(deployerProxyAddress)

        if (deployedBytecode === '0x')
            await deploy(false, matcher)
        else if (deployedProxyBytecode === '0x')
            await deploy(true, matcher)
        else
            throw new Error('Already deployed')
    }

    await verify.execute()
}
