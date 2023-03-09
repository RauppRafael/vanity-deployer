import hre from 'hardhat'
import { Signer } from 'ethers'
import { ERC1967ProxyArtifact } from './artifacts'

export const getERC1967ProxyFactory = (signer?: Signer) => hre.ethers.getContractFactory(
    ERC1967ProxyArtifact.abi,
    ERC1967ProxyArtifact.bytecode,
    signer,
)
