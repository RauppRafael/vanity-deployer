/**
 * Hardhat artifact for a precompiled contract
 */
export interface ContractArtifact {
    contractName: string
    sourceName: string
    abi: any
    bytecode: any
}

/**
 * A contract artifact and the corresponding event that it logs during construction.
 */
export interface VerifiableContractInfo {
    artifact: ContractArtifact
    event: string
}

export enum ContractType {
    VanityDeployer,
    VanityProxy,
    ERC1967Proxy,
    Implementation,
}
