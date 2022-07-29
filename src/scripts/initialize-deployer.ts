import hre from 'hardhat'
import { HardhatHelpers } from '../helpers/HardhatHelpers'
import { Verify } from '../helpers/Verify'
import { storage, StorageType } from '../helpers/Storage'
import { Matcher } from '../helpers/Matcher'
import { CommandBuilder } from '../helpers/CommandBuilder'

const getSigner = pk => new hre.ethers.Wallet(pk, hre.ethers.provider)

const deploy = async (isProxy: boolean, matcher: Matcher) => {
    console.log(`Deploying deployer${ isProxy ? ' proxy' : '' }`)

    const mainSigner = (await hre.ethers.getSigners())[0]
    const { gasPrice } = await hre.ethers.provider.getFeeData()

    let privateKey = await storage.find({
        type: StorageType.SECRET,
        name: isProxy ? 'DeployerProxy:PrivateKey' : 'Deployer:PrivateKey',
    })

    if (!privateKey)
        privateKey = await CommandBuilder.profanity(matcher)

    const contractDeployer = getSigner(privateKey)

    await HardhatHelpers.sendTransaction(
        mainSigner.sendTransaction({
            to: contractDeployer.address,
            gasPrice,
            value: HardhatHelpers.parseEther(.5),
        }),
    )

    const factory = await hre.ethers.getContractFactory(
        isProxy ? 'ERC1967ProxyInitializable' : 'Deployer',
        contractDeployer,
    )

    const constructorArguments = isProxy
        ? [
            await storage.find({ type: StorageType.ADDRESS, name: 'Deployer' }),
            (new hre.ethers.utils.Interface(['function initialize(address) external']))
                .encodeFunctionData('initialize', [process.env.DEPLOYER_ADDRESS]),
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
        name: isProxy ? 'DeployerProxy:PrivateKey' : 'Deployer:PrivateKey',
        value: privateKey,
    })

    Verify.add({
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

    await Verify.execute()
}
