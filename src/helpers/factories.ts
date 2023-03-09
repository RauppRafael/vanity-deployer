import hre from 'hardhat'
import { Signer } from 'ethers'
import { ERC1967ProxyArtifact, VanityDeployerArtifact, VanityProxyArtifact } from './artifacts'

export const getVanityDeployerFactory = (signer?: Signer) => hre.ethers.getContractFactory(
    VanityDeployerArtifact.abi,
    VanityDeployerArtifact.bytecode,
    signer,
)

export const getERC1967ProxyFactory = (signer?: Signer) => hre.ethers.getContractFactory(
    ERC1967ProxyArtifact.abi,
    ERC1967ProxyArtifact.bytecode,
    signer,
)

export const getVanityProxyFactory = (signer?: Signer) => hre.ethers.getContractFactory(
    VanityProxyArtifact.abi,
    VanityProxyArtifact.bytecode,
    signer,
)
