import hre from 'hardhat'
import { Signer } from 'ethers'
import VanityDeployer from '../../artifacts/contracts/VanityDeployer.sol/VanityDeployer.json'
import VanityProxy from '../../artifacts/contracts/VanityProxy.sol/VanityProxy.json'
import ERC1967Proxy from '../../artifacts/@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol/ERC1967Proxy.json'

export const getVanityDeployerFactory = (signer?: Signer) => hre.ethers.getContractFactory(
    VanityDeployer.abi,
    VanityDeployer.bytecode,
    signer,
)

export const getERC1967ProxyFactory = (signer?: Signer) => hre.ethers.getContractFactory(
    ERC1967Proxy.abi,
    ERC1967Proxy.bytecode,
    signer,
)

export const getVanityProxyFactory = (signer?: Signer) => hre.ethers.getContractFactory(
    VanityProxy.abi,
    VanityProxy.bytecode,
    signer,
)
