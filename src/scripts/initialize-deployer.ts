import hre from 'hardhat'
import { Wallet } from 'ethers'
import { HardhatHelpers } from '../helpers/HardhatHelpers'
import { Verify } from '../helpers/Verify'
import { storage, StorageType } from '../helpers/Storage'
import { Matcher } from '../helpers/Matcher'
import { CommandBuilder } from '../helpers/CommandBuilder'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'

const getSigner = pk => new hre.ethers.Wallet(pk, hre.ethers.provider)

const deploy = async (isProxy: boolean, matcher: Matcher) => {
    let mainSigner: SignerWithAddress
    let contractDeployer: Wallet

    try {
        console.log(`Deploying deployer${ isProxy ? ' proxy' : '' }`)

        mainSigner = (await hre.ethers.getSigners())[0]

        let privateKey = await storage.find({
            type: StorageType.SECRET,
            name: isProxy ? 'DeployerProxy:PrivateKey' : 'Deployer:PrivateKey',
        })

        if (!privateKey)
            privateKey = await CommandBuilder.profanity(matcher)

        contractDeployer = getSigner(privateKey)

        await HardhatHelpers.transferAllFunds(mainSigner, contractDeployer)

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

        const deployerContract = await factory.deploy(
            ...constructorArguments,
            { gasPrice: await HardhatHelpers.gasPrice() },
        )

        await deployerContract.deployTransaction.wait(2)

        await HardhatHelpers.transferAllFunds(contractDeployer, mainSigner)

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

    } catch(error) {
        console.log('Error: returning funds to main signer')

        await HardhatHelpers.transferAllFunds(contractDeployer, mainSigner)
    }
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

    if (!deployerAddress) {
        await deploy(false, matcher)
    } else if (!deployerProxyAddress) {
        await deploy(true, matcher)
    } else {
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
