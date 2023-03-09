import hre from 'hardhat'
import { Signer } from 'ethers'
import { ERC1967Proxy, VanityDeployer, VanityProxy } from './artifacts'

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
