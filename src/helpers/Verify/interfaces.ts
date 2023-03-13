/**
 * Hardhat artifact for a precompiled contract
 */
export interface ContractArtifact {
    contractName: string
    sourceName: string
    abi: any
    bytecode: any
}

export enum ContractType {
    VanityDeployer,
    Proxy,
    Default,
}
