import { Contract, ethers } from 'ethers'

export const calculateGnosisProxyAddress = async (factory: Contract, singleton: string, initializer: string, nonce: number | string) => {
    const deploymentCode = ethers.utils.solidityPack(['bytes', 'uint256'], [await factory.proxyCreationCode(), singleton])
    const salt = ethers.utils.solidityKeccak256(
        ['bytes32', 'uint256'],
        [ethers.utils.solidityKeccak256(['bytes'], [initializer]), nonce],
    )

    return ethers.utils.getCreate2Address(factory.address, salt, ethers.utils.keccak256(deploymentCode))
}
