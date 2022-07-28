import hre from 'hardhat'
import crossSpawn from 'cross-spawn'
import kill from 'tree-kill'
import { HardhatHelpers } from '../helpers/HardhatHelpers'
import { verify } from '../helpers/verify'
import { storage, StorageType } from '../helpers/storage'
import { Matcher, MatcherType } from '../helpers/matcher'
import { CommandBuilder } from '../helpers/CommandBuilder'

const getPrivateKey = async (startsWith: string, endsWith: string) => {
    const matcher = new Matcher(startsWith, endsWith)
    const command = CommandBuilder.profanity(matcher)
    const addressMatcher = matcher.get(MatcherType.ADDRESS)
    const secretMatcher = matcher.get(MatcherType.SECRET)
    const child = await crossSpawn(command)

    let listener

    const promise: Promise<string> = new Promise((resolve, reject) => {
        listener = child.stdout.on('data', event => {
            const line: string | undefined = event.toString()?.toLowerCase()

            if (line?.includes('private') && !!line?.match(addressMatcher))
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

const deploy = async ({
    isProxy,
    startsWith,
    endsWith,
}: {
    isProxy: boolean
    startsWith: string
    endsWith: string
}) => {
    const mainSigner = (await hre.ethers.getSigners())[0]
    const { gasPrice } = await hre.ethers.provider.getFeeData()
    let privateKey = await storage.find({
        type: StorageType.SECRET,
        name: isProxy ? 'DeployerPrivateKeyProxy' : 'DeployerPrivateKey',
    })

    if (!privateKey)
        privateKey = await getPrivateKey(startsWith, endsWith)

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

    if (!isProxy) {
        return deploy({ isProxy: true, startsWith, endsWith })
    }
}

export const initializeDeployer = async (startsWith = '', endsWith = '') => {
    const deployerAddress = await storage.find({
        type: StorageType.ADDRESS,
        name: 'Deployer',
    })
    const deployerProxyAddress = await storage.find({
        type: StorageType.ADDRESS,
        name: 'DeployerProxy',
    })

    if (!deployerAddress)
        await deploy({ isProxy: false, startsWith, endsWith })
    else if (!deployerProxyAddress)
        await deploy({ isProxy: true, startsWith, endsWith })
    else {
        const deployedBytecode = await hre.ethers.provider.getCode(deployerAddress)
        const deployedProxyBytecode = await hre.ethers.provider.getCode(deployerProxyAddress)

        if (deployedBytecode === '0x')
            await deploy({ isProxy: false, startsWith, endsWith })
        else if (deployedProxyBytecode === '0x')
            await deploy({ isProxy: true, startsWith, endsWith })
        else
            throw new Error('Already deployed')
    }

    await verify.execute()
}
