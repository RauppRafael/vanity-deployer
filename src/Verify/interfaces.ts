import { EtherscanNetworkEntry } from '@nomiclabs/hardhat-etherscan/dist/src/types'

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

/**
 * The Etherscan API parameters from the Hardhat config.
 */
export interface EtherscanAPIConfig {
    key: string;
    endpoints: EtherscanNetworkEntry;
}

/**
 * The response body from an Etherscan API call.
 */
export interface EtherscanResponseBody {
    status: string;
    message: string;
    result: any;
}

export const RESPONSE_OK = '1'
